import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { dbDateToISOOrNull, taipeiDateOf, taipeiToday, toTaipeiDateTimeInput, type ISODate } from "@/lib/dates";
import { caseToFormValues } from "@/components/cases/case-form-values";
import { createCase, updateCase } from "@/server/cases/case-service";
import type { CaseInput } from "@/server/cases/case-schema";
import { setTaskOverride } from "@/server/tasks/task-service";
import { writeAudit } from "@/server/audit/audit";
import { ValidationError } from "@/server/errors";
import type { AuthUser } from "@/server/auth/types";
import {
  expandContacts,
  normalizeSchool,
  parseScheduleGrid,
  projectNameForYear,
  timeForPeriod,
  type Cell,
  type ScheduleRow,
} from "./schedule-parser";

const MAX_FILE_BYTES = 5_000_000;

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
  }
  return null;
}

/** 讀取 Excel 每個工作表為二維陣列（合併儲存格只取左上角，避免日期重複） */
export async function readWorkbook(buffer: ArrayBuffer): Promise<{ name: string; grid: Cell[][] }[]> {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new ValidationError("檔案超過 5MB");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ValidationError("無法讀取檔案，請確認是 Excel（.xlsx）格式");
  }
  return wb.worksheets.map((ws) => {
    const grid: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        cells[c - 1] = cell.isMerged && cell.master.address !== cell.address ? null : cellValue(cell.value);
      });
      grid[r - 1] = Array.from(cells, (c) => c ?? null);
    });
    return { name: ws.name, grid: Array.from(grid, (r) => r ?? []) };
  });
}

export interface ImportFile {
  name: string;
  data: ArrayBuffer;
}

export interface PreviewRow extends ScheduleRow {
  projectName: string;
  action: "CREATE" | "UPDATE" | "SKIP";
  existingCaseId: string | null;
  existingProjectCode: string | null;
}

async function parseFiles(files: ImportFile[]): Promise<ScheduleRow[]> {
  if (!files.length) throw new ValidationError("請選擇 Excel 檔案");
  const rows: ScheduleRow[] = [];
  for (const f of files) {
    if (!/\.xlsx$/i.test(f.name)) throw new ValidationError(`「${f.name}」不是 .xlsx 檔案`);
    for (const ws of await readWorkbook(f.data)) rows.push(...parseScheduleGrid(ws.name, ws.grid));
  }
  if (!rows.length) throw new ValidationError("檔案中找不到排程資料（需有「學校名稱」標題列與學校資料）");
  const known = await prisma.schoolCase.findMany({ where: { agencyContact: { not: null } }, distinct: ["agencyContact"], select: { agencyContact: true } });
  expandContacts(
    rows,
    known.map((k) => k.agencyContact!),
  );
  return rows;
}

export async function previewScheduleImport(files: ImportFile[]): Promise<PreviewRow[]> {
  const rows = await parseFiles(files);
  const existing = await prisma.schoolCase.findMany({ where: { caseType: "SCHOOL_ZONE" }, select: { id: true, projectCode: true, projectName: true, schoolName: true } });
  return rows.map((r) => {
    const projectName = projectNameForYear(r.rocYear);
    const hit = existing.find((e) => e.projectName === projectName && normalizeSchool(e.schoolName) === normalizeSchool(r.schoolName));
    return {
      ...r,
      projectName,
      action: !r.notificationDate ? "SKIP" : hit ? "UPDATE" : "CREATE",
      existingCaseId: hit?.id ?? null,
      existingProjectCode: hit?.projectCode ?? null,
    };
  });
}

/** 同一日期保留原本時間；否則依上午／下午給預設時間 */
function eventDateTime(ev: ScheduleRow["reviewMeeting"], current: Date | null): string {
  if (!ev) return current ? toTaipeiDateTimeInput(current) : "";
  if (current && taipeiDateOf(current) === ev.date) return toTaipeiDateTimeInput(current);
  return `${ev.date}T${timeForPeriod(ev.period)}`;
}

function importNotes(r: ScheduleRow): string {
  return [
    r.unit && `交工：${r.unit}`,
    r.location && `學校所在：${r.location}`,
    r.extension && `延伸：${r.extension}`,
    r.remarks.length ? `備註：${r.remarks.join("、")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function newProjectCode(r: ScheduleRow, index: number): Promise<string> {
  const base = `${r.rocYear}-${String(r.order ?? index + 1).padStart(2, "0")}`;
  for (let i = 0; ; i++) {
    const code = i ? `${base}-${i + 1}` : base;
    if (!(await prisma.schoolCase.findUnique({ where: { projectCode: code }, select: { id: true } }))) return code;
  }
}

export interface ImportResult {
  schoolName: string;
  projectName: string;
  projectCode: string | null;
  action: "CREATED" | "UPDATED" | "SKIPPED" | "FAILED";
  message?: string;
  completedTasks?: number;
}

const REASON = "依排程表（Excel）匯入";

export async function applyScheduleImport(user: AuthUser, files: ImportFile[], opts: { completePast: boolean }): Promise<ImportResult[]> {
  const rows = await previewScheduleImport(files);
  const today = taipeiToday();
  const results: ImportResult[] = [];

  for (const [i, r] of rows.entries()) {
    const base = { schoolName: r.schoolName, projectName: r.projectName };
    if (r.action === "SKIP") {
      results.push({ ...base, projectCode: null, action: "SKIPPED", message: "沒有派案日期" });
      continue;
    }
    try {
      const existing = r.existingCaseId ? await prisma.schoolCase.findUniqueOrThrow({ where: { id: r.existingCaseId } }) : null;
      const form = caseToFormValues(existing, { projectName: r.projectName });
      const input: CaseInput = {
        ...form,
        projectCode: existing?.projectCode ?? (await newProjectCode(r, i)),
        projectName: r.projectName,
        schoolName: existing?.schoolName ?? r.schoolName,
        district: r.district ?? form.district,
        agencyContact: r.contact ?? form.agencyContact,
        responsibleUserId: existing?.responsibleUserId ?? user.id,
        responsibleName: "",
        responsibleEmail: "",
        notificationDate: r.notificationDate ?? form.notificationDate,
        reviewMeetingDateTime: eventDateTime(r.reviewMeeting, existing?.reviewMeetingDateTime ?? null),
        siteVisitDateTime: eventDateTime(r.siteVisit, existing?.siteVisitDateTime ?? null),
        notes: form.notes || importNotes(r),
        status: form.status as CaseInput["status"],
        dateChangeReason: REASON,
      };
      const { schoolCase } = existing ? await updateCase(user, existing.id, input) : await createCase(user, input);

      // 交初規 → 提供事前規劃報告書期限（與系統計算不同時鎖定為排程表日期）
      if (r.preReportDate) {
        const t = await prisma.task.findUnique({ where: { caseId_taskType: { caseId: schoolCase.id, taskType: "PRE_REPORT_PROVIDE" } } });
        const due = t ? dbDateToISOOrNull(t.overrideDueDate ?? t.calculatedDueDate) : null;
        if (t && due !== r.preReportDate) {
          await setTaskOverride(user, t.id, { overrideDueDate: r.preReportDate, overrideReason: `${REASON}：交初規` });
        }
      }

      let completedTasks = 0;
      if (opts.completePast) completedTasks = await completePastTasks(schoolCase.id, today);

      results.push({ ...base, projectCode: schoolCase.projectCode, action: existing ? "UPDATED" : "CREATED", completedTasks });
    } catch (e) {
      results.push({ ...base, projectCode: r.existingProjectCode, action: "FAILED", message: e instanceof Error ? e.message : "匯入失敗" });
    }
  }

  const ok = results.filter((x) => x.action === "CREATED" || x.action === "UPDATED").length;
  await writeAudit({
    actorId: user.id,
    action: "CASE_IMPORT",
    entityType: "SchoolCase",
    summary: `匯入排程 ${files.map((f) => f.name).join("、")}：成功 ${ok} 所`,
    changes: { results: results.map((x) => ({ school: x.schoolName, action: x.action, message: x.message ?? null })) },
  });
  return results;
}

/** 期限早於今天且尚未完成的工作標記為已完成（匯入既往排程時避免大量逾期提醒） */
async function completePastTasks(caseId: string, today: ISODate): Promise<number> {
  const tasks = await prisma.task.findMany({ where: { caseId, status: { in: ["NOT_STARTED", "IN_PROGRESS"] } } });
  const past = tasks.filter((t) => {
    const due = dbDateToISOOrNull(t.overrideDueDate ?? t.calculatedDueDate);
    return due !== null && due < today;
  });
  for (const t of past) {
    await prisma.task.update({ where: { id: t.id }, data: { status: "COMPLETED", actualCompletedAt: t.overrideDueDate ?? t.calculatedDueDate } });
  }
  return past.length;
}
