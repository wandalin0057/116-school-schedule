import type { DocumentType, TaskType } from "@prisma/client";

/** 獨立項目（不屬於通學區學校案件）：成果影片、成效分析及成果報告書 */
export type StandaloneKind = "RESULT_VIDEO" | "RESULT_REPORT";

/** 每一階段＝一項繳交工作＋前一個工作天之創稿（可產生公文） */
export interface StandaloneStage {
  label: string;
  taskType: TaskType;
  draftTaskType: TaskType;
  documentType: DocumentType;
  /** 計算基準日欄位 */
  dateField: "notificationDate" | "resultVideoApprovedDate";
}

export const STANDALONE_KINDS: Record<
  StandaloneKind,
  { label: string; codePrefix: string; path: string; schoolHint: string; schoolRequired: boolean; stages: StandaloneStage[] }
> = {
  RESULT_VIDEO: {
    label: "成果影片",
    codePrefix: "VIDEO-",
    path: "/videos",
    schoolHint: "例如：臺北市大安區仁愛國民小學",
    schoolRequired: true,
    stages: [
      { label: "3 分鐘", taskType: "RESULT_VIDEO", draftTaskType: "RESULT_VIDEO_DRAFT", documentType: "RESULT_VIDEO", dateField: "notificationDate" },
      { label: "15 秒版本", taskType: "RESULT_VIDEO_SHORT", draftTaskType: "RESULT_VIDEO_SHORT_DRAFT", documentType: "RESULT_VIDEO_SHORT", dateField: "resultVideoApprovedDate" },
    ],
  },
  RESULT_REPORT: {
    label: "成效分析及成果報告書",
    codePrefix: "REPORT-",
    path: "/reports",
    schoolHint: "全案報告可留空",
    schoolRequired: false,
    stages: [{ label: "報告書", taskType: "RESULT_REPORT", draftTaskType: "RESULT_REPORT_DRAFT", documentType: "RESULT_REPORT", dateField: "notificationDate" }],
  },
};

export const isStandaloneKind = (t: string): t is StandaloneKind => t in STANDALONE_KINDS;
