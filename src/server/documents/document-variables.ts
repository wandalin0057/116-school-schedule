import { dbDateToISOOrNull, diffCalendarDays, formatROC, formatROCDateTimeLong, parseISODate, taipeiDateOf, taipeiToday, type ISODate } from "@/lib/dates";
import type { TemplateVars } from "@/server/templates/template-renderer";

/** 公文範本變數（純函式） */
export interface DocumentVarsInput {
  schoolCase: {
    projectName: string;
    schoolName: string;
    district?: string | null;
    agencyName?: string | null;
    notificationDate?: Date | null;
    reviewMeetingDateTime?: Date | null;
    siteVisitDateTime?: Date | null;
  };
  attachmentUrl?: string | null;
  attachmentPassword?: string | null;
  downloadDeadline?: ISODate | null;
  companyName?: string;
}

export function buildDocumentVariables(input: DocumentVarsInput): TemplateVars {
  const c = input.schoolCase;
  return {
    projectName: c.projectName,
    schoolName: c.schoolName,
    district: c.district ?? "",
    agencyName: c.agencyName ?? "",
    notificationDateROC: formatROC(dbDateToISOOrNull(c.notificationDate ?? null)),
    reviewMeetingDateROC: c.reviewMeetingDateTime ? formatROC(taipeiDateOf(c.reviewMeetingDateTime)) : "",
    siteVisitDateROC: c.siteVisitDateTime ? formatROC(taipeiDateOf(c.siteVisitDateTime)) : "",
    attachmentUrl: input.attachmentUrl ?? "",
    attachmentPassword: input.attachmentPassword ?? "",
    downloadDeadlineROC: formatROC(input.downloadDeadline ?? null),
    companyName: input.companyName ?? "",
  };
}

export interface EmailVarsInput {
  schoolCase: {
    projectName: string;
    schoolName: string;
    agencyName?: string | null;
    agencyContact?: string | null;
  };
  eventDateTime?: Date | null;
  eventLocation?: string | null;
  attachmentNames?: string | null;
  companyName?: string;
  senderName?: string;
  /** 寄件人簽名檔；未設定時以姓名代替 */
  signature?: string | null;
  /** 機關第幾次通知 */
  notificationRound?: number | null;
  /** 計算「昨日」「今日」之基準時間（預設現在） */
  now?: Date;
}

/** 會議／會勘日相對於今天的說法：今日、昨日、前日；更早則不加 */
export function relativeDayWord(eventDate: ISODate, today: ISODate): string {
  const diff = diffCalendarDays(eventDate, today);
  return diff === 0 ? "今日" : diff === 1 ? "昨日" : diff === 2 ? "前日" : "";
}

export function buildEmailVariables(input: EmailVarsInput): TemplateVars {
  const c = input.schoolCase;
  const eventDate = input.eventDateTime ? taipeiDateOf(input.eventDateTime) : null;
  const md = eventDate ? parseISODate(eventDate) : null;
  return {
    notificationRoundText: input.notificationRound ? `第${input.notificationRound}次通知` : "",
    eventMonthDay: md ? `${md.month}/${md.day}` : "",
    eventDayWord: eventDate ? relativeDayWord(eventDate, taipeiToday(input.now)) : "",
    signature: input.signature?.trim() || input.senderName || "",
    projectName: c.projectName,
    schoolName: c.schoolName,
    agencyName: c.agencyName ?? "",
    agencyContact: c.agencyContact ?? "",
    eventDateTime: formatROCDateTimeLong(input.eventDateTime ?? null),
    eventDate: input.eventDateTime ? formatROC(taipeiDateOf(input.eventDateTime)) : "",
    eventLocation: input.eventLocation ?? "",
    eventLocationText: input.eventLocation ? `於${input.eventLocation}` : "",
    attachmentNames: input.attachmentNames ?? "",
    companyName: input.companyName ?? "",
    senderName: input.senderName ?? "",
  };
}

export const DOCUMENT_TYPE_LABELS = {
  PRE_REPORT: "事前規劃及分析報告書",
  REVIEW_DRAWING: "審查會議後修正圖說",
  SITE_VISIT_DRAWING: "會勘後修正圖說",
  RESULT_VIDEO: "成果影片",
} as const;

export const DOCUMENT_STATUS_LABELS = {
  DRAFT: "草稿",
  DRAFTED: "已創稿",
  DISPATCHED: "已發文",
  CANCELLED: "作廢",
} as const;

/** 將說明欄文字拆為條列 */
export function splitBodyLines(body: string): string[] {
  return body.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
}
