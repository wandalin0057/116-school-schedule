import type { DeadlineAnchor, TaskStatus, TaskType } from "@prisma/client";

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  FINAL_REPORT_SUBMIT: "提送完整規劃及分析報告書",
  BEFORE_AFTER_CARDS: "提供改善前後對照圖卡",
  PRE_REPORT_PROVIDE: "提供事前規劃報告書",
  PRE_REPORT_DRAFT: "事前規劃報告書創稿",
  PRE_REPORT_DISPATCH: "事前規劃報告書提供圖說",
  REVIEW_SLIDES_EMAIL: "提供審查簡報",
  REVIEW_MEETING: "審查會議",
  REVIEW_MINUTES_EMAIL: "Email 審查會議紀錄",
  REVIEW_DRAWING_DRAFT: "審查後修正圖說創稿",
  REVIEW_DRAWING_DISPATCH: "審查後提供修正圖說",
  SITE_VISIT_SLIDES_UPLOAD: "上傳會勘簡報",
  SITE_VISIT: "現場會勘",
  SITE_VISIT_MINUTES_EMAIL: "Email 會勘紀錄",
  SITE_VISIT_DRAWING_DRAFT: "會勘後修正圖說創稿",
  SITE_VISIT_DRAWING_DISPATCH: "會勘後提供修正圖說",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: "未開始",
  IN_PROGRESS: "進行中",
  COMPLETED: "已完成",
  ON_HOLD: "暫緩",
  CANCELLED: "已取消",
};

export const ANCHOR_LABELS: Record<DeadlineAnchor, string> = {
  NOTIFICATION_DATE: "機關通知日",
  REVIEW_MEETING: "審查會議日",
  SITE_VISIT: "會勘日",
  PRE_REPORT_DISPATCH: "事前規劃報告書提供圖說日",
  FINAL_REPORT_NOTICE: "機關通知提送完整報告書日",
  FINAL_REPORT_APPROVED: "機關同意備查日",
};

export type TaskCategory = "DRAFT" | "DISPATCH" | "EMAIL" | "UPLOAD" | "EVENT" | "REPORT";

export const TASK_CATEGORY: Record<TaskType, TaskCategory> = {
  FINAL_REPORT_SUBMIT: "REPORT",
  BEFORE_AFTER_CARDS: "REPORT",
  PRE_REPORT_PROVIDE: "DISPATCH",
  PRE_REPORT_DRAFT: "DRAFT",
  PRE_REPORT_DISPATCH: "DISPATCH",
  REVIEW_SLIDES_EMAIL: "EMAIL",
  REVIEW_MEETING: "EVENT",
  REVIEW_MINUTES_EMAIL: "EMAIL",
  REVIEW_DRAWING_DRAFT: "DRAFT",
  REVIEW_DRAWING_DISPATCH: "DISPATCH",
  SITE_VISIT_SLIDES_UPLOAD: "UPLOAD",
  SITE_VISIT: "EVENT",
  SITE_VISIT_MINUTES_EMAIL: "EMAIL",
  SITE_VISIT_DRAWING_DRAFT: "DRAFT",
  SITE_VISIT_DRAWING_DISPATCH: "DISPATCH",
};

export const TASK_TYPES_BY_CATEGORY = (cat: TaskCategory): TaskType[] =>
  (Object.keys(TASK_CATEGORY) as TaskType[]).filter((t) => TASK_CATEGORY[t] === cat);

/** 工作類型對應之公文類型 */
/** 可「產生公文」的工作：只有創稿（提供報告書／修正圖說不需公文） */
export const TASK_DOCUMENT_TYPE: Partial<Record<TaskType, "PRE_REPORT" | "REVIEW_DRAWING" | "SITE_VISIT_DRAWING">> = {
  PRE_REPORT_DRAFT: "PRE_REPORT",
  REVIEW_DRAWING_DRAFT: "REVIEW_DRAWING",
  SITE_VISIT_DRAWING_DRAFT: "SITE_VISIT_DRAWING",
};

/** 工作類型對應之 Email 範本 */
export const TASK_EMAIL_TYPE: Partial<Record<TaskType, "REVIEW_SLIDES_EMAIL" | "REVIEW_MINUTES_EMAIL" | "SITE_VISIT_MINUTES_EMAIL">> = {
  REVIEW_SLIDES_EMAIL: "REVIEW_SLIDES_EMAIL",
  REVIEW_MINUTES_EMAIL: "REVIEW_MINUTES_EMAIL",
  SITE_VISIT_MINUTES_EMAIL: "SITE_VISIT_MINUTES_EMAIL",
};

/** 行事曆顏色（Tailwind class） */
export const TASK_COLORS: Record<TaskCategory, { bg: string; text: string; border: string; dot: string; label: string }> = {
  DRAFT: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-300", dot: "bg-amber-500", label: "創稿" },
  DISPATCH: { bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-300", dot: "bg-blue-600", label: "提供圖說" },
  EMAIL: { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-300", dot: "bg-emerald-600", label: "Email" },
  UPLOAD: { bg: "bg-violet-50", text: "text-violet-800", border: "border-violet-300", dot: "bg-violet-600", label: "上傳簡報" },
  EVENT: { bg: "bg-rose-50", text: "text-rose-800", border: "border-rose-300", dot: "bg-rose-600", label: "會議／會勘" },
  REPORT: { bg: "bg-teal-50", text: "text-teal-800", border: "border-teal-300", dot: "bg-teal-600", label: "完整報告書／圖卡" },
};

/**
 * 會寄 Email 提醒給負責同事的工作；其餘工作（創稿、提供圖說、會議、紀錄等）只提醒管理員。管理員一律收到全部工作的提醒。
 */
export const COLLEAGUE_REMINDER_TASKS: TaskType[] = [
  "PRE_REPORT_PROVIDE",
  "SITE_VISIT_SLIDES_UPLOAD",
  "REVIEW_SLIDES_EMAIL",
  "SITE_VISIT_DRAWING_DISPATCH",
  "REVIEW_DRAWING_DISPATCH",
];

/** 工作依作業流程（一般期限先後）排列：創稿（通知後第 11 個工作天）→ 提供報告書（第 12 天）→ 提供圖說 → 審查 → 會勘 */
export const TASK_TIMELINE_ORDER: TaskType[] = [
  "PRE_REPORT_DRAFT",
  "PRE_REPORT_PROVIDE",
  "REVIEW_SLIDES_EMAIL",
  "REVIEW_MEETING",
  "REVIEW_MINUTES_EMAIL",
  "REVIEW_DRAWING_DRAFT",
  "REVIEW_DRAWING_DISPATCH",
  "SITE_VISIT_SLIDES_UPLOAD",
  "SITE_VISIT",
  "SITE_VISIT_MINUTES_EMAIL",
  "SITE_VISIT_DRAWING_DRAFT",
  "SITE_VISIT_DRAWING_DISPATCH",
  "FINAL_REPORT_SUBMIT",
  "BEFORE_AFTER_CARDS",
];

/** 已移除之工項（不再建立，既有資料不顯示） */
export const REMOVED_TASKS: TaskType[] = ["PRE_REPORT_DISPATCH"];

/** 只顯示給管理員（專案經理）的工作：各項創稿；一般使用者的工作清單、儀表板、行事曆與案件頁不顯示 */
export const ADMIN_ONLY_TASKS: TaskType[] = ["PRE_REPORT_DRAFT", "REVIEW_DRAWING_DRAFT", "SITE_VISIT_DRAWING_DRAFT"];

export const OPEN_TASK_STATUSES: TaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD"];
export const CLOSED_TASK_STATUSES: TaskStatus[] = ["COMPLETED", "CANCELLED"];
