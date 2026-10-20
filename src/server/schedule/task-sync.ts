import type { Prisma, PrismaClient, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dbDateToISOOrNull, isoToDbDate, taipeiDateOf, type ISODate } from "@/lib/dates";
import type { BusinessDayService } from "@/server/business-days/business-day-service";
import { loadBusinessDayService } from "@/server/business-days/calendar-repository";
import { DEFAULT_DEADLINE_RULES, type DeadlineRuleDef } from "./deadline-rules";
import { ADMIN_ONLY_TASKS } from "./task-types";
import {
  calculateSchedule,
  diffSchedule,
  type ExistingTaskSnapshot,
  type ScheduleAnchors,
  type ScheduleChange,
} from "./schedule-calculator";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ChangeSource = "CASE_DATE_CHANGE" | "CALENDAR_RECALC" | "RULE_CHANGE" | "CASE_CREATED" | "MANUAL_RECALC";

/** 讀取期限規則；資料庫尚無規則時使用預設值 */
export async function loadDeadlineRules(db: DbClient = prisma): Promise<DeadlineRuleDef[]> {
  const rows = await db.deadlineRule.findMany({ orderBy: { sortOrder: "asc" } });
  if (!rows.length) return DEFAULT_DEADLINE_RULES;
  const byType = new Map(rows.map((r) => [r.taskType, r]));
  // 若有新增工作類型尚未建立規則，補上預設
  return DEFAULT_DEADLINE_RULES.map((d) => {
    const r = byType.get(d.taskType);
    return r
      ? {
          taskType: r.taskType,
          title: r.title,
          description: r.description ?? "",
          anchor: r.anchor,
          offsetBusinessDays: r.offsetBusinessDays,
          enabled: r.enabled,
          sortOrder: r.sortOrder,
        }
      : d;
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function anchorsFromCase(c: {
  notificationDate: Date | null;
  reviewMeetingDateTime: Date | null;
  siteVisitDateTime: Date | null;
  finalReportNoticeDate?: Date | null;
  finalReportApprovedDate?: Date | null;
}): ScheduleAnchors {
  return {
    notificationDate: dbDateToISOOrNull(c.notificationDate),
    reviewMeetingDate: c.reviewMeetingDateTime ? taipeiDateOf(c.reviewMeetingDateTime) : null,
    siteVisitDate: c.siteVisitDateTime ? taipeiDateOf(c.siteVisitDateTime) : null,
    finalReportNoticeDate: dbDateToISOOrNull(c.finalReportNoticeDate),
    finalReportApprovedDate: dbDateToISOOrNull(c.finalReportApprovedDate),
  };
}

async function loadExistingTasks(db: DbClient, caseId: string): Promise<ExistingTaskSnapshot[]> {
  const tasks = await db.task.findMany({ where: { caseId } });
  return tasks.map((t) => ({
    id: t.id,
    taskType: t.taskType,
    title: t.title,
    status: t.status,
    calculatedDueDate: dbDateToISOOrNull(t.calculatedDueDate),
    dueDateEstimated: t.dueDateEstimated,
    overrideDueDate: dbDateToISOOrNull(t.overrideDueDate),
  }));
}

export interface ComputeContext {
  bds?: BusinessDayService;
  rules?: DeadlineRuleDef[];
  db?: DbClient;
}

/** 計算案件期程異動（不寫入資料庫），供變更日期前之差異預覽 */
export async function computeCaseScheduleChanges(
  caseId: string,
  anchors: ScheduleAnchors,
  ctx: ComputeContext = {},
): Promise<ScheduleChange[]> {
  const db = ctx.db ?? prisma;
  const [bds, rules, existing] = await Promise.all([
    ctx.bds ?? loadBusinessDayService(),
    ctx.rules ?? loadDeadlineRules(db),
    loadExistingTasks(db, caseId),
  ]);
  const effective: Partial<Record<string, ISODate | null>> = {};
  for (const t of existing) if (t.overrideDueDate) effective[t.taskType] = t.overrideDueDate;
  const computed = calculateSchedule(anchors, rules, bds, { effectiveDueDates: effective });
  return diffSchedule(existing, computed);
}

export interface SyncOptions extends ComputeContext {
  actorId: string | null;
  source: ChangeSource;
  reason?: string;
}

/**
 * 依案件目前日期重新計算並寫入工作期限：
 * 新建缺少之工作、更新未完成且未鎖定之期限、保留已完成紀錄、寫入異動歷史。
 */
export async function syncCaseTasks(caseId: string, options: SyncOptions): Promise<ScheduleChange[]> {
  const db = options.db ?? prisma;
  const schoolCase = await db.schoolCase.findUniqueOrThrow({ where: { id: caseId } });
  const anchors = anchorsFromCase(schoolCase);
  const rules = options.rules ?? (await loadDeadlineRules(db));
  const changes = await computeCaseScheduleChanges(caseId, anchors, { ...options, rules, db });
  const ruleByType = new Map(rules.map((r) => [r.taskType, r]));
  // 創稿工作由專案經理（管理員）負責
  let pmId: string | null | undefined;
  const assigneeFor = async (type: TaskType) => {
    if (!ADMIN_ONLY_TASKS.includes(type)) return schoolCase.responsibleUserId;
    pmId ??= await projectManagerId(db);
    return pmId ?? schoolCase.responsibleUserId;
  };

  for (const ch of changes) {
    if (ch.action === "CREATE" && ch.newDate) {
      const rule = ruleByType.get(ch.taskType);
      const task = await db.task.upsert({
        where: { caseId_taskType: { caseId, taskType: ch.taskType } },
        create: {
          caseId,
          taskType: ch.taskType,
          title: rule?.title ?? ch.title,
          description: rule?.description,
          calculatedDueDate: isoToDbDate(ch.newDate),
          dueDateEstimated: ch.estimated,
          assignedUserId: await assigneeFor(ch.taskType),
        },
        update: {},
      });
      ch.taskId = task.id;
      await db.taskDueDateHistory.create({
        data: {
          taskId: task.id,
          previousDate: null,
          newDate: isoToDbDate(ch.newDate),
          changeSource: "CREATED",
          reason: options.reason ?? "系統依期限規則建立",
          changedById: options.actorId,
        },
      });
    } else if ((ch.action === "UPDATE" || ch.action === "CLEAR") && ch.taskId) {
      // 再次確認狀態，避免與並行之完成操作衝突
      const updated = await db.task.updateMany({
        where: { id: ch.taskId, status: { notIn: ["COMPLETED", "CANCELLED"] }, overrideDueDate: null },
        data: {
          calculatedDueDate: ch.newDate ? isoToDbDate(ch.newDate) : null,
          dueDateEstimated: ch.newDate ? ch.estimated : false,
        },
      });
      if (updated.count && ch.previousDate !== ch.newDate) {
        await db.taskDueDateHistory.create({
          data: {
            taskId: ch.taskId,
            previousDate: ch.previousDate ? isoToDbDate(ch.previousDate) : null,
            newDate: ch.newDate ? isoToDbDate(ch.newDate) : null,
            changeSource: options.source,
            reason: options.reason,
            changedById: options.actorId,
          },
        });
      }
    }
  }
  return changes;
}

/** 所有案件期限與最新日曆／規則之差異（日曆或規則更新後預覽用） */
export async function computeAllScheduleChanges(ctx: ComputeContext = {}): Promise<
  { caseId: string; schoolName: string; projectCode: string; changes: ScheduleChange[] }[]
> {
  const db = ctx.db ?? prisma;
  const [bds, rules] = await Promise.all([ctx.bds ?? loadBusinessDayService(), ctx.rules ?? loadDeadlineRules(db)]);
  const cases = await db.schoolCase.findMany({
    where: { status: { in: ["ACTIVE", "ON_HOLD"] } },
    orderBy: { projectCode: "asc" },
  });
  const out = [];
  for (const c of cases) {
    const changes = await computeCaseScheduleChanges(c.id, anchorsFromCase(c), { bds, rules, db });
    out.push({ caseId: c.id, schoolName: c.schoolName, projectCode: c.projectCode, changes });
  }
  return out;
}

/** 專案經理：最早建立的啟用中管理員 */
export async function projectManagerId(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string | null> {
  const pm = await db.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return pm?.id ?? null;
}

/** 將目前不是指派給管理員的創稿工作（含已完成）改由專案經理負責（可重複執行） */
export async function assignDraftTasksToPm(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  const pm = await projectManagerId(db);
  if (!pm) return 0;
  const r = await db.task.updateMany({
    where: {
      taskType: { in: ADMIN_ONLY_TASKS },
      OR: [{ assignedUserId: null }, { assignedUser: { role: { not: "ADMIN" } } }],
    },
    data: { assignedUserId: pm },
  });
  return r.count;
}
