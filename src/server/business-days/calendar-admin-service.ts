import { z } from "zod";
import { prisma } from "@/lib/db";
import { dbDateToISO, isISODate, isoToDbDate, type ISODate } from "@/lib/dates";
import { writeAudit } from "@/server/audit/audit";
import { assertAdmin } from "@/server/auth/permissions";
import type { AuthUser } from "@/server/auth/types";
import { ValidationError } from "@/server/errors";
import { computeAllScheduleChanges, syncCaseTasks } from "@/server/schedule/task-sync";
import { BusinessDayService, type CalendarDayEntry } from "./business-day-service";
import { parseCalendarFile, type ParsedCalendar } from "./calendar-import";
import { loadBusinessDayService, loadCalendarData } from "./calendar-repository";

type CaseChanges = Awaited<ReturnType<typeof computeAllScheduleChanges>>;

/** 僅保留有實際影響之異動（含已鎖定但系統建議日期不同者，供參考） */
function onlySignificant(all: CaseChanges): CaseChanges {
  return all
    .map((d) => ({
      ...d,
      changes: d.changes.filter(
        (c) => c.action === "UPDATE" || c.action === "CREATE" || c.action === "CLEAR" || (c.action === "SKIP_LOCKED" && c.newDate !== c.overrideDueDate),
      ),
    }))
    .filter((d) => d.changes.length);
}

export async function getCalendarOverview() {
  const [years, overrides, days] = await Promise.all([
    prisma.calendarYear.findMany({ orderBy: { year: "desc" }, include: { importedBy: { select: { name: true } }, _count: { select: { days: true } } } }),
    prisma.businessDayOverride.findMany({ orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } } } }),
    prisma.holidayCalendar.findMany({ orderBy: { date: "asc" } }),
  ]);
  return { years, overrides, days };
}

/** 以匯入內容建立暫時性的工作日曆，計算期限差異（不寫入） */
async function candidateService(parsed: ParsedCalendar) {
  const data = await loadCalendarData();
  const years = new Map(data.years);
  const days = new Map(data.days);
  for (const y of parsed.years) {
    for (const key of [...days.keys()]) if (key.startsWith(`${y.year}-`)) days.delete(key);
    for (const d of y.days) days.set(d.date, { kind: d.kind, description: d.description } satisfies CalendarDayEntry);
    years.set(y.year, { isComplete: y.isComplete, source: parsed.source });
  }
  return new BusinessDayService({ years, days, overrides: data.overrides });
}

export async function previewCalendarImport(user: AuthUser, fileName: string, text: string, declaredComplete: boolean) {
  assertAdmin(user);
  let parsed: ParsedCalendar;
  try {
    parsed = parseCalendarFile(fileName, text, { declaredComplete });
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "檔案解析失敗");
  }
  const bds = await candidateService(parsed);
  const diffs = await computeAllScheduleChanges({ bds });
  return { parsed, diffs: onlySignificant(diffs) };
}

export async function applyCalendarImport(
  user: AuthUser,
  args: { fileName: string; text: string; declaredComplete: boolean; source: string; reason: string },
) {
  assertAdmin(user);
  if (!args.reason.trim()) throw new ValidationError("請填寫匯入原因");
  const parsed = parseCalendarFile(args.fileName, args.text, { declaredComplete: args.declaredComplete });
  await prisma.$transaction(async (tx) => {
    for (const y of parsed.years) {
      await tx.holidayCalendar.deleteMany({ where: { year: y.year } });
      await tx.calendarYear.upsert({
        where: { year: y.year },
        create: { year: y.year, isComplete: y.isComplete, source: args.source || parsed.source || args.fileName, sourceNote: args.reason, importedById: user.id },
        update: { isComplete: y.isComplete, source: args.source || parsed.source || args.fileName, sourceNote: args.reason, importedById: user.id, importedAt: new Date() },
      });
      if (y.days.length) {
        await tx.holidayCalendar.createMany({
          data: y.days.map((d) => ({ year: y.year, date: isoToDbDate(d.date), kind: d.kind, description: d.description })),
        });
      }
    }
    await writeAudit(
      {
        actorId: user.id,
        action: "CALENDAR_IMPORT",
        entityType: "CalendarYear",
        entityId: parsed.years.map((y) => y.year).join(","),
        summary: `匯入辦公日曆 ${parsed.years.map((y) => `${y.year}${y.isComplete ? "（完整）" : "（非完整）"}`).join("、")}，原因：${args.reason}`,
        changes: { years: parsed.years.map((y) => ({ year: y.year, days: y.days.length, isComplete: y.isComplete })), warnings: parsed.warnings.slice(0, 20) },
      },
      tx,
    );
  });
  return parsed;
}

const overrideSchema = z.object({
  date: z.string().refine(isISODate, "日期格式錯誤"),
  kind: z.enum(["HOLIDAY", "MAKEUP_WORKDAY"]),
  reason: z.string().trim().min(2, "請填寫異動原因").max(500),
});

function parseOverride(input: z.input<typeof overrideSchema>) {
  const p = overrideSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "資料格式錯誤");
  return p.data;
}

/** 預覽新增休假日／補行上班日後，各案件期限的變化（不寫入） */
export async function previewBusinessDayOverride(user: AuthUser, input: z.input<typeof overrideSchema>) {
  assertAdmin(user);
  const data = parseOverride({ ...input, reason: input.reason || "預覽" });
  const current = await loadBusinessDayService();
  const overrides = new Map(current.getData().overrides);
  overrides.set(data.date, { kind: data.kind, description: data.reason, reason: data.reason });
  return onlySignificant(await computeAllScheduleChanges({ bds: current.withData({ overrides }) }));
}

/** 進行中案件依目前日曆重新計算期限（已完成、人工鎖定者不變） */
async function recalcActiveCases(actorId: string, reason: string) {
  const cases = await prisma.schoolCase.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, select: { id: true } });
  let updated = 0;
  let created = 0;
  for (const c of cases) {
    const changes = await syncCaseTasks(c.id, { actorId, source: "CALENDAR_RECALC", reason });
    updated += changes.filter((x) => x.action === "UPDATE" || x.action === "CLEAR").length;
    created += changes.filter((x) => x.action === "CREATE").length;
  }
  return { updated, created };
}

/** 新增休假日（例如颱風假）或補行上班日，並自動重新計算所有進行中案件的期限 */
export async function addBusinessDayOverride(user: AuthUser, input: z.input<typeof overrideSchema>) {
  assertAdmin(user);
  const p = { data: parseOverride(input) };
  const existing = await prisma.businessDayOverride.findUnique({ where: { date: isoToDbDate(p.data.date) } });
  const row = await prisma.businessDayOverride.upsert({
    where: { date: isoToDbDate(p.data.date) },
    create: { date: isoToDbDate(p.data.date), kind: p.data.kind, reason: p.data.reason, createdById: user.id },
    update: { kind: p.data.kind, reason: p.data.reason, createdById: user.id },
  });
  await writeAudit({
    actorId: user.id,
    action: existing ? "CALENDAR_OVERRIDE_UPDATE" : "CALENDAR_OVERRIDE_ADD",
    entityType: "BusinessDayOverride",
    entityId: row.id,
    summary: `${p.data.date} 設為${p.data.kind === "HOLIDAY" ? "休假日" : "補行上班日"}，原因：${p.data.reason}`,
    changes: { date: p.data.date, kind: p.data.kind, previousKind: existing?.kind ?? null },
  });
  const label = `${p.data.date} ${p.data.kind === "HOLIDAY" ? "休假" : "補行上班"}：${p.data.reason}`;
  return { row, ...(await recalcActiveCases(user.id, label)) };
}

export async function removeBusinessDayOverride(user: AuthUser, id: string, reason: string) {
  assertAdmin(user);
  if (!reason?.trim()) throw new ValidationError("請填寫刪除原因");
  const row = await prisma.businessDayOverride.findUnique({ where: { id } });
  if (!row) throw new ValidationError("找不到此筆調整");
  await prisma.businessDayOverride.delete({ where: { id } });
  await writeAudit({
    actorId: user.id,
    action: "CALENDAR_OVERRIDE_REMOVE",
    entityType: "BusinessDayOverride",
    entityId: id,
    summary: `刪除 ${dbDateToISO(row.date)} 之工作天調整，原因：${reason}`,
    changes: { date: dbDateToISO(row.date), kind: row.kind },
  });
  return recalcActiveCases(user.id, `刪除 ${dbDateToISO(row.date)} 工作天調整：${reason}`);
}

/** 依目前日曆與規則，預覽所有進行中案件之期限差異 */
export async function previewRecalculation() {
  return onlySignificant(await computeAllScheduleChanges());
}

export async function applyRecalculation(user: AuthUser, reason: string, source: "CALENDAR_RECALC" | "RULE_CHANGE" = "CALENDAR_RECALC") {
  assertAdmin(user);
  const cases = await prisma.schoolCase.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, select: { id: true } });
  let updated = 0;
  let created = 0;
  for (const c of cases) {
    const changes = await syncCaseTasks(c.id, { actorId: user.id, source, reason });
    updated += changes.filter((x) => x.action === "UPDATE" || x.action === "CLEAR").length;
    created += changes.filter((x) => x.action === "CREATE").length;
  }
  await writeAudit({ actorId: user.id, action: "SCHEDULE_RECALC", entityType: "Task", summary: `重新計算期限：更新 ${updated} 筆、新建 ${created} 筆，原因：${reason}` });
  return { updated, created };
}

export type CalendarDayView = { date: ISODate; kind: string; description: string | null };
