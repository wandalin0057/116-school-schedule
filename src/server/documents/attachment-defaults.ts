import type { DocumentType, TaskType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addCalendarDays, dbDateToISOOrNull, type ISODate } from "@/lib/dates";
import { TASK_TYPE_LABELS } from "@/server/schedule/task-types";

/** 附件下載密碼所依據之「提供報告或圖面」工作 */
const PROVIDE_TASK: Record<DocumentType, TaskType> = {
  PRE_REPORT: "PRE_REPORT_PROVIDE",
  REVIEW_DRAWING: "REVIEW_DRAWING_DISPATCH",
  SITE_VISIT_DRAWING: "SITE_VISIT_DRAWING_DISPATCH",
  RESULT_VIDEO: "RESULT_VIDEO",
  RESULT_REPORT: "RESULT_REPORT",
  RESULT_VIDEO_SHORT: "RESULT_VIDEO_SHORT",
};

export const PASSWORD_PREFIX = "CD80@";
/** 下載期限＝創稿日期＋14 天 */
export const DOWNLOAD_DAYS = 14;

/** 下載密碼：CD80@ ＋ 提供報告或圖面日期（月日四碼），例如 10/19 → CD80@1019 */
export function passwordForDate(date: ISODate): string {
  return `${PASSWORD_PREFIX}${date.slice(5, 7)}${date.slice(8, 10)}`;
}

export function downloadDeadlineFor(draftDate: ISODate): ISODate {
  return addCalendarDays(draftDate, DOWNLOAD_DAYS);
}

/** 依案件工作期限產生預設下載密碼（找不到日期時回傳 null） */
export async function defaultAttachmentPassword(caseId: string, documentType: DocumentType) {
  const taskType = PROVIDE_TASK[documentType];
  const t = await prisma.task.findUnique({ where: { caseId_taskType: { caseId, taskType } }, select: { overrideDueDate: true, calculatedDueDate: true } });
  const date = t ? dbDateToISOOrNull(t.overrideDueDate ?? t.calculatedDueDate) : null;
  return date ? { password: passwordForDate(date), date, source: TASK_TYPE_LABELS[taskType] } : null;
}
