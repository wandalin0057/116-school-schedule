import type { DeadlineAnchor, TaskType } from "@prisma/client";

export interface DeadlineRuleDef {
  taskType: TaskType;
  title: string;
  description: string;
  anchor: DeadlineAnchor;
  /** 正數＝事件後第 N 工作天；負數＝事件前第 N 工作天；0＝事件當日 */
  offsetBusinessDays: number;
  enabled: boolean;
  sortOrder: number;
}

/** 預設期限規則（依通學區規劃案作業流程） */
export const DEFAULT_DEADLINE_RULES: DeadlineRuleDef[] = [
  {
    taskType: "FINAL_REPORT_SUBMIT",
    title: "提送完整之規劃及分析報告書",
    description: "提供會勘後修正圖說後，機關通知次日起 5 個工作天內提送",
    anchor: "FINAL_REPORT_NOTICE",
    offsetBusinessDays: 5,
    enabled: true,
    sortOrder: 130,
  },
  {
    taskType: "FINAL_REPORT_DRAFT",
    title: "完整規劃及分析報告書創稿",
    description: "提送完整之規劃及分析報告書的前一個工作天（機關通知次日起第 4 個工作天）",
    anchor: "FINAL_REPORT_NOTICE",
    offsetBusinessDays: 4,
    enabled: true,
    sortOrder: 125,
  },
  {
    taskType: "BEFORE_AFTER_CARDS_DRAFT",
    title: "改善前後對照圖卡創稿",
    description: "提供改善前後對照圖卡的前一個工作天（同意備查日起第 14 個工作天）",
    anchor: "FINAL_REPORT_APPROVED",
    offsetBusinessDays: 14,
    enabled: true,
    sortOrder: 135,
  },
  {
    taskType: "BEFORE_AFTER_CARDS",
    title: "提供改善前後對照圖卡",
    description: "收到機關同意備查完整之規劃及分析報告書之日起 15 個工作天內提供",
    anchor: "FINAL_REPORT_APPROVED",
    offsetBusinessDays: 15,
    enabled: true,
    sortOrder: 140,
  },
  {
    taskType: "PRE_REPORT_PROVIDE",
    title: "提供事前規劃報告書",
    description: "機關通知日（D0）後第 12 個工作天，由負責同事提供報告書",
    anchor: "NOTIFICATION_DATE",
    offsetBusinessDays: 12,
    enabled: true,
    sortOrder: 7,
  },
  {
    taskType: "PRE_REPORT_DISPATCH",
    title: "提供事前規劃及分析報告書圖說",
    description: "已停用：事前規劃報告書不另列提供圖說工項",
    anchor: "NOTIFICATION_DATE",
    offsetBusinessDays: 12,
    enabled: false,
    sortOrder: 10,
  },
  {
    taskType: "PRE_REPORT_DRAFT",
    title: "建立事前規劃報告書公文草稿",
    description: "機關通知日（D0）後第 11 個工作天完成創稿",
    anchor: "NOTIFICATION_DATE",
    offsetBusinessDays: 11,
    enabled: true,
    sortOrder: 5,
  },
  {
    taskType: "REVIEW_SLIDES_EMAIL",
    title: "提供審查簡報",
    description: "審查會議前第 2 個工作天提供簡報",
    anchor: "REVIEW_MEETING",
    offsetBusinessDays: -2,
    enabled: true,
    sortOrder: 20,
  },
  {
    taskType: "REVIEW_MEETING",
    title: "召開審查會議",
    description: "審查會議當日（D0）",
    anchor: "REVIEW_MEETING",
    offsetBusinessDays: 0,
    enabled: true,
    sortOrder: 25,
  },
  {
    taskType: "REVIEW_MINUTES_EMAIL",
    title: "Email 提供審查會議紀錄",
    description: "審查會議後第 1 個工作天",
    anchor: "REVIEW_MEETING",
    offsetBusinessDays: 1,
    enabled: true,
    sortOrder: 30,
  },
  {
    taskType: "REVIEW_DRAWING_DRAFT",
    title: "建立審查會議後修正圖說公文草稿",
    description: "審查會議後第 2 個工作天",
    anchor: "REVIEW_MEETING",
    offsetBusinessDays: 2,
    enabled: true,
    sortOrder: 35,
  },
  {
    taskType: "REVIEW_DRAWING_DISPATCH",
    title: "提供審查會議後修正規劃圖說",
    description: "審查會議後第 3 個工作天",
    anchor: "REVIEW_MEETING",
    offsetBusinessDays: 3,
    enabled: true,
    sortOrder: 40,
  },
  {
    taskType: "SITE_VISIT_SLIDES_UPLOAD",
    title: "上傳會勘簡報至承辦提供之連結",
    description: "會勘前第 2 個工作天",
    anchor: "SITE_VISIT",
    offsetBusinessDays: -2,
    enabled: true,
    sortOrder: 50,
  },
  {
    taskType: "SITE_VISIT",
    title: "辦理現場會勘",
    description: "會勘當日（D0）",
    anchor: "SITE_VISIT",
    offsetBusinessDays: 0,
    enabled: true,
    sortOrder: 55,
  },
  {
    taskType: "SITE_VISIT_MINUTES_EMAIL",
    title: "Email 提供會勘紀錄",
    description: "會勘後第 1 個工作天",
    anchor: "SITE_VISIT",
    offsetBusinessDays: 1,
    enabled: true,
    sortOrder: 60,
  },
  {
    taskType: "SITE_VISIT_DRAWING_DRAFT",
    title: "建立會勘後修正圖說公文草稿",
    description: "會勘後第 2 個工作天",
    anchor: "SITE_VISIT",
    offsetBusinessDays: 2,
    enabled: true,
    sortOrder: 65,
  },
  {
    taskType: "SITE_VISIT_DRAWING_DISPATCH",
    title: "提供會勘後修正規劃圖說",
    description: "會勘後第 3 個工作天",
    anchor: "SITE_VISIT",
    offsetBusinessDays: 3,
    enabled: true,
    sortOrder: 70,
  },
];
