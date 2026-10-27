import { CalendarDays, ChevronLeft, ChevronRight, Download, List, Rows3 } from "lucide-react";
import Link from "next/link";
import { ListControls } from "@/components/common/list-controls";
import { AddHolidayButton } from "@/components/settings/calendar-admin";
import { EmptyState, PageHeader } from "@/components/common/page-header";
import { buildHref } from "@/components/common/table-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  addCalendarDays,
  diffCalendarDays,
  endOfMonth,
  formatROCShort,
  formatTaipeiTime,
  isISODate,
  parseISODate,
  startOfMonth,
  startOfWeekMonday,
  taipeiToday,
  weekdayZh,
  type ISODate,
} from "@/lib/dates";
import { cn } from "@/lib/utils";
import { caseAccessWhere } from "@/server/auth/permissions";
import { getCalendarEvents, type CalendarEvent } from "@/server/calendar/calendar-view-service";
import type { TaskType } from "@prisma/client";
import { ADMIN_ONLY_TASKS, REMOVED_TASKS, TASK_COLORS, TASK_TYPE_LABELS } from "@/server/schedule/task-types";
import { listUsers } from "@/server/users/user-service";
import { listProjectNames } from "@/server/cases/projects";

export const metadata = { title: "行事曆" };
type SP = Record<string, string | undefined>;

function EventChip({ e }: { e: CalendarEvent }) {
  const c = TASK_COLORS[e.category];
  const done = e.status === "COMPLETED";
  return (
    <Link
      href={`/tasks/${e.taskId}`}
      title={`${e.schoolName}｜${e.title}${e.estimated ? "（暫估）" : ""}`}
      className={cn("block truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight hover:brightness-95", c.bg, c.text, c.border, done && "line-through opacity-60")}
    >
      {e.eventAt && <span className="mr-1 tabular">{formatTaipeiTime(e.eventAt)}</span>}
      {e.schoolName.replace(/^臺北市.{2,3}區/, "")}・{TASK_TYPE_LABELS[e.taskType]}
      {e.estimated && "＊"}
    </Link>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.view === "week" || sp.view === "list" ? sp.view : "month";
  const today = taipeiToday();
  const anchor: ISODate = sp.date && isISODate(sp.date) ? sp.date : today;

  let from: ISODate;
  let to: ISODate;
  let prev: ISODate;
  let next: ISODate;
  let title: string;
  if (view === "month") {
    const ms = startOfMonth(anchor);
    from = startOfWeekMonday(ms);
    to = addCalendarDays(startOfWeekMonday(endOfMonth(anchor)), 6);
    const { year, month } = parseISODate(anchor);
    title = `${year - 1911} 年 ${month} 月`;
    prev = startOfMonth(addCalendarDays(ms, -1));
    next = addCalendarDays(endOfMonth(anchor), 1);
  } else if (view === "week") {
    from = startOfWeekMonday(anchor);
    to = addCalendarDays(from, 6);
    title = `${formatROCShort(from, false)} – ${formatROCShort(to, false)}`;
    prev = addCalendarDays(from, -7);
    next = addCalendarDays(from, 7);
  } else {
    from = anchor;
    to = addCalendarDays(anchor, 59);
    title = `${formatROCShort(from, false)} 起 60 天`;
    prev = addCalendarDays(anchor, -60);
    next = addCalendarDays(anchor, 60);
  }

  const filter = { caseId: sp.caseId, projectName: sp.project, assignedUserId: sp.assignee, taskType: sp.taskType, includeCompleted: true };
  const [{ events, days, hasEstimated }, users, cases, projects] = await Promise.all([
    getCalendarEvents(user, from, to, filter),
    listUsers(),
    prisma.schoolCase.findMany({
      where: { AND: [caseAccessWhere(user), sp.project ? { projectName: sp.project } : {}] },
      select: { id: true, schoolName: true },
      orderBy: { schoolName: "asc" },
    }),
    listProjectNames(user),
  ]);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const dayInfo = new Map(days.map((d) => [d.date, d]));
  const icsParams = new URLSearchParams(Object.entries({ caseId: sp.caseId, project: sp.project, assignee: sp.assignee, taskType: sp.taskType }).filter(([, v]) => v) as [string, string][]);
  const currentMonth = parseISODate(anchor).month;

  const viewLink = (v: string, label: string, Icon: React.ElementType) => (
    <Link href={buildHref("/calendar", sp, { view: v })} className={cn("inline-flex items-center gap-1 rounded px-3 py-1", view === v && "bg-primary text-white")}>
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="行事曆"
        description="依工作期限顯示；不同工作類型以顏色區分，點擊可開啟工作詳情。"
        actions={
          <>
            {user.role === "ADMIN" && <AddHolidayButton />}
            <Button asChild variant="outline">
              <a href={`/api/calendar/ics?${icsParams.toString()}`}>
                <Download />
                匯出 ICS
              </a>
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button asChild variant="outline" size="icon">
                <Link href={buildHref("/calendar", sp, { date: prev })} aria-label="上一頁">
                  <ChevronLeft />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref("/calendar", sp, { date: null })}>今天</Link>
              </Button>
              <Button asChild variant="outline" size="icon">
                <Link href={buildHref("/calendar", sp, { date: next })} aria-label="下一頁">
                  <ChevronRight />
                </Link>
              </Button>
              <h2 className="ml-2 text-lg font-semibold">{title}</h2>
            </div>
            <div className="inline-flex rounded-md border bg-white p-0.5 text-sm">
              {viewLink("month", "月", CalendarDays)}
              {viewLink("week", "週", Rows3)}
              {viewLink("list", "清單", List)}
            </div>
          </div>
          <ListControls
            showSearch={false}
            filters={[
              { name: "project", label: "計畫", allLabel: "全部計畫", options: projects.map((p) => ({ value: p, label: p })) },
              { name: "caseId", label: "學校", options: cases.map((c) => ({ value: c.id, label: c.schoolName })) },
              { name: "assignee", label: "承辦人", options: users.map((u) => ({ value: u.id, label: u.name })) },
              { name: "taskType", label: "工作類型", options: Object.entries(TASK_TYPE_LABELS)
                  .filter(([value]) => !REMOVED_TASKS.includes(value as TaskType) && (user.role === "ADMIN" || !ADMIN_ONLY_TASKS.includes(value as TaskType)))
                  .map(([value, label]) => ({ value, label })) },
            ]}
          />
          <div className="flex flex-wrap gap-3 text-xs">
            {Object.values(TASK_COLORS).map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1">
                <span className={cn("h-2.5 w-2.5 rounded-full", c.dot)} />
                {c.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />
              非工作天
            </span>
            {hasEstimated && <span className="text-amber-700">＊ 期間內有年度未取得完整官方日曆，期限為暫估</span>}
          </div>
        </div>

        {view === "list" ? (
          events.length ? (
            <div className="divide-y">
              {[...byDate.entries()].map(([date, list]) => (
                <div key={date} className="flex flex-col gap-2 p-3 sm:flex-row">
                  <div className={cn("w-40 shrink-0 text-sm font-semibold", date === today && "text-primary")}>
                    {formatROCShort(date)}
                    {dayInfo.get(date)?.description && <span className="block text-xs font-normal text-rose-700">{dayInfo.get(date)?.description}</span>}
                  </div>
                  <div className="grid flex-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((e) => (
                      <Link key={e.id} href={`/tasks/${e.taskId}`} className={cn("rounded-md border p-2 text-sm hover:shadow-sm", TASK_COLORS[e.category].bg, TASK_COLORS[e.category].border)}>
                        <p className="font-medium">{e.schoolName}</p>
                        <p className={cn("text-xs", TASK_COLORS[e.category].text)}>
                          {e.eventAt && `${formatTaipeiTime(e.eventAt)} `}
                          {e.title}
                          {e.estimated && "（暫估）"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {e.assignedName ?? "未指派"}
                          {e.status === "COMPLETED" && "・已完成"}
                          {e.location && `・${e.location}`}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="此期間沒有工作" />
          )
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-7 border-b bg-slate-50 text-center text-xs font-semibold text-slate-600">
              {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
                <div key={w} className="py-1.5">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid min-w-[720px] grid-cols-7">
              {Array.from({ length: diffCalendarDays(from, to) + 1 }, (_, i) => addCalendarDays(from, i)).map((date) => {
                const info = dayInfo.get(date);
                const list = byDate.get(date) ?? [];
                const outside = view === "month" && parseISODate(date).month !== currentMonth;
                return (
                  <div
                    key={date}
                    className={cn(
                      "border-b border-r p-1",
                      view === "week" ? "min-h-[260px]" : "min-h-[110px]",
                      info && !info.isBusinessDay && "bg-slate-100/80",
                      outside && "opacity-50",
                    )}
                  >
                    <div className="mb-1 flex items-start justify-between gap-1">
                      <span className={cn("rounded px-1 text-xs tabular", date === today ? "bg-primary font-bold text-white" : "text-slate-600")}>
                        {parseISODate(date).day}
                        {view === "week" && `（${weekdayZh(date)}）`}
                      </span>
                      {info?.description && <span className="truncate text-[10px] text-rose-700">{info.description}</span>}
                    </div>
                    <div className="space-y-0.5">
                      {(view === "month" ? list.slice(0, 4) : list).map((e) => (
                        <EventChip key={e.id} e={e} />
                      ))}
                      {view === "month" && list.length > 4 && (
                        <Link href={buildHref("/calendar", sp, { view: "list", date })} className="block text-[11px] text-primary hover:underline">
                          另有 {list.length - 4} 項…
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
