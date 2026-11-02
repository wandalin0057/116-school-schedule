import type { TaskType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addCalendarDays, startOfWeekMonday, taipeiToday, parseTaipeiDateTime, type ISODate } from "@/lib/dates";
import { caseAccessWhere, taskAccessWhere } from "@/server/auth/permissions";
import type { AuthUser } from "@/server/auth/types";
import { loadBusinessDayService } from "@/server/business-days/calendar-repository";
import { TASK_CATEGORY, type TaskCategory } from "@/server/schedule/task-types";
import { OPEN_WHERE, TASK_INCLUDE } from "@/server/tasks/task-service";
import { TASK_TIMELINE_ORDER } from "@/server/schedule/task-types";
import { computeDueInfo, type DueInfo } from "@/server/tasks/task-utils";

export type DashboardTask = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }> & { due: DueInfo; category: TaskCategory };

/** 儀表板統計：全部由資料庫即時計算 */
export async function getDashboard(user: AuthUser, opts: { mineOnly?: boolean; now?: Date; projectName?: string } = {}) {
  const today = taipeiToday(opts.now);
  const tomorrow = addCalendarDays(today, 1);
  const in7 = addCalendarDays(today, 7);
  const weekStart = startOfWeekMonday(today);
  const weekEnd = addCalendarDays(weekStart, 6);

  const scope: Prisma.TaskWhereInput[] = [taskAccessWhere(user), OPEN_WHERE, { schoolCase: { status: { in: ["ACTIVE", "ON_HOLD"] } } }];
  if (opts.mineOnly) scope.push({ OR: [{ assignedUserId: user.id }, { assignedUserId: null, schoolCase: { responsibleUserId: user.id } }] });

  if (opts.projectName) scope.push({ schoolCase: { projectName: opts.projectName } });

  const caseScope: Prisma.SchoolCaseWhereInput[] = [caseAccessWhere(user), { caseType: "SCHOOL_ZONE" }];
  if (opts.projectName) caseScope.push({ projectName: opts.projectName });
  if (opts.mineOnly) caseScope.push({ OR: [{ responsibleUserId: user.id }, { members: { some: { userId: user.id } } }] });

  const weekFrom = parseTaipeiDateTime(`${weekStart}T00:00`);
  const weekTo = parseTaipeiDateTime(`${addCalendarDays(weekEnd, 1)}T00:00`);

  const [bds, openTasks, weekMeetings, weekSiteVisits, cases] = await Promise.all([
    loadBusinessDayService(),
    prisma.task.findMany({ where: { AND: scope }, include: TASK_INCLUDE }),
    prisma.schoolCase.findMany({
      where: { AND: [...caseScope, { reviewMeetingDateTime: { gte: weekFrom, lt: weekTo } }] },
      orderBy: { reviewMeetingDateTime: "asc" },
      select: { id: true, schoolName: true, reviewMeetingDateTime: true, reviewMeetingLocation: true },
    }),
    prisma.schoolCase.findMany({
      where: { AND: [...caseScope, { siteVisitDateTime: { gte: weekFrom, lt: weekTo } }] },
      orderBy: { siteVisitDateTime: "asc" },
      select: { id: true, schoolName: true, siteVisitDateTime: true, siteVisitLocation: true, siteVisitUploadUrl: true },
    }),
    prisma.schoolCase.findMany({
      where: { AND: [...caseScope, { status: { in: ["ACTIVE", "ON_HOLD"] } }] },
      orderBy: { projectCode: "asc" },
      select: {
        id: true,
        projectCode: true,
        schoolName: true,
        district: true,
        status: true,
        responsibleUser: { select: { name: true } },
        tasks: { select: { id: true, status: true, title: true, taskType: true, calculatedDueDate: true, overrideDueDate: true } },
      },
    }),
  ]);

  const tasks: DashboardTask[] = openTasks
    .map((t) => ({ ...t, due: computeDueInfo(t, bds, today), category: TASK_CATEGORY[t.taskType] }))
    .sort((a, b) => (a.due.dueDate ?? "9999").localeCompare(b.due.dueDate ?? "9999"));
  const withDue = tasks.filter((t) => t.due.dueDate);
  const between = (t: DashboardTask, from: ISODate, to: ISODate) => t.due.dueDate! >= from && t.due.dueDate! <= to;
  const pending = (cat: TaskCategory) => withDue.filter((t) => t.category === cat);

  const progress = cases.map((c) => {
    const active = c.tasks.filter((t) => t.status !== "CANCELLED");
    const done = active.filter((t) => t.status === "COMPLETED").length;
    const open = c.tasks
      .filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED")
      .map((t) => ({ ...t, due: computeDueInfo(t, bds, today) }))
      .filter((t) => t.due.dueDate)
      .sort((a, b) => a.due.dueDate!.localeCompare(b.due.dueDate!));
    return {
      id: c.id,
      projectCode: c.projectCode,
      schoolName: c.schoolName,
      district: c.district,
      status: c.status,
      responsibleName: c.responsibleUser.name,
      total: active.length,
      completed: done,
      percent: active.length ? Math.round((done / active.length) * 100) : 0,
      overdue: open.filter((t) => t.due.isOverdue).length,
      nextTask: open[0] ? { title: open[0].title, dueDate: open[0].due.dueDate, taskType: open[0].taskType } : null,
    };
  });

  return {
    today,
    weekStart,
    weekEnd,
    calendarWarning: bds.hasIncompleteYearBetween(today, addCalendarDays(today, 60)),
    dueToday: withDue.filter((t) => t.due.dueDate === today),
    dueTomorrow: withDue.filter((t) => t.due.dueDate === tomorrow),
    dueNext7: withDue.filter((t) => between(t, tomorrow, in7)),
    overdue: withDue.filter((t) => t.due.isOverdue),
    pendingDraft: pending("DRAFT"),
    pendingDispatch: pending("DISPATCH"),
    pendingEmail: pending("EMAIL"),
    pendingUpload: pending("UPLOAD"),
    /** 依工作類型分組（已依截止日期排序） */
    pendingByType: Object.fromEntries(TASK_TIMELINE_ORDER.map((type) => [type, withDue.filter((t) => t.taskType === type)])) as Record<TaskType, DashboardTask[]>,
    weekMeetings,
    weekSiteVisits,
    progress,
  };
}
