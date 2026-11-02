import type { TemplateCategory, TemplateType } from "@prisma/client";

export interface TemplateDef {
  type: TemplateType;
  category: TemplateCategory;
  name: string;
  subject: string;
  body: string;
}

export const DOCUMENT_TEMPLATE_TYPES = ["PRE_REPORT", "REVIEW_DRAWING", "SITE_VISIT_DRAWING", "RESULT_VIDEO"] as const;
export const EMAIL_TEMPLATE_TYPES = ["REVIEW_SLIDES_EMAIL", "REVIEW_MINUTES_EMAIL", "SITE_VISIT_MINUTES_EMAIL"] as const;

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  PRE_REPORT: "事前規劃及分析報告書",
  REVIEW_DRAWING: "審查會議後修正圖說",
  SITE_VISIT_DRAWING: "會勘後修正圖說",
  RESULT_VIDEO: "成果影片",
  REVIEW_SLIDES_EMAIL: "審查會議前寄送簡報",
  REVIEW_MINUTES_EMAIL: "審查會議後寄送會議紀錄",
  SITE_VISIT_MINUTES_EMAIL: "會勘後寄送會勘紀錄",
};

/** 預設公文範本（主旨＝subject；說明＝body，每行一點） */
export const DEFAULT_DOCUMENT_TEMPLATES: TemplateDef[] = [
  {
    type: "PRE_REPORT",
    category: "DOCUMENT",
    name: "事前規劃及分析報告書",
    subject: "檢送「{projectName}」{schoolName}事前－規劃及分析報告書，附件詳如說明二，請查照。",
    body: [
      "一、依據本案徵求服務建議書第肆點規定及貴局{notificationDateROC}電子郵件辦理。",
      "二、附件網址：{attachmentUrl}，下載密碼：{attachmentPassword}(請於{downloadDeadlineROC}前下載)。",
    ].join("\n"),
  },
  {
    type: "REVIEW_DRAWING",
    category: "DOCUMENT",
    name: "審查會議後修正圖說",
    subject: "檢送「{projectName}」{schoolName}審查會議後修正規劃圖說，附件詳如說明二，請查照。",
    body: [
      "一、依據本案徵求服務建議書第肆點規定辦理。",
      "二、附件網址：{attachmentUrl}，下載密碼：{attachmentPassword}（請於{downloadDeadlineROC}前下載）。",
    ].join("\n"),
  },
  {
    type: "SITE_VISIT_DRAWING",
    category: "DOCUMENT",
    name: "會勘後修正圖說",
    subject: "檢送「{projectName}」{schoolName}會勘後修正規劃圖說，附件詳如說明二，請查照。",
    body: [
      "一、依據本案徵求服務建議書第肆點規定辦理。",
      "二、附件網址：{attachmentUrl}，密碼：{attachmentPassword}（請於{downloadDeadlineROC}前下載）。",
    ].join("\n"),
  },
  {
    type: "RESULT_VIDEO",
    category: "DOCUMENT",
    name: "成果影片",
    subject: "檢送「{projectName}」{schoolName}成果影片，附件詳如說明二，請查照。",
    body: [
      "一、依據本案徵求服務建議書第肆點規定辦理。",
      "二、附件網址：{attachmentUrl}，下載密碼：{attachmentPassword}（請於{downloadDeadlineROC}前下載）。",
    ].join("\n"),
  },
];

export const DEFAULT_EMAIL_TEMPLATES: TemplateDef[] = [
  {
    type: "REVIEW_SLIDES_EMAIL",
    category: "EMAIL",
    name: "審查會議前寄送簡報",
    subject: "【{projectName}】{schoolName}審查會議簡報",
    body: [
      "您好，",
      "有關「{projectName}」{notificationRoundText}之{schoolName}，審查簡報因檔案較大，煩請至以下連結下載，",
      "",
      "{attachmentUrl}",
      "",
      "請您查收，謝謝。",
      "",
      "{signature}",
    ].join("\n"),
  },
  {
    type: "REVIEW_MINUTES_EMAIL",
    category: "EMAIL",
    name: "審查會議後寄送會議紀錄",
    subject: "【{projectName}】{schoolName}審查會議紀錄",
    body: [
      "您好，",
      "有關{eventDayWord}{eventMonthDay}辦理之{schoolName}審查會議，會議記錄如附件所示，",
      "",
      "請查收，謝謝。",
      "",
      "{signature}",
    ].join("\n"),
  },
  {
    type: "SITE_VISIT_MINUTES_EMAIL",
    category: "EMAIL",
    name: "會勘後寄送會勘紀錄",
    subject: "【{projectName}】{schoolName}現場會勘紀錄",
    body: [
      "您好，",
      "有關{eventDayWord}{eventMonthDay}辦理之{schoolName}現場會勘，會勘紀錄如附件所示，",
      "",
      "請查收，謝謝。",
      "",
      "{signature}",
    ].join("\n"),
  },
];

/**
 * 舊版系統預設範本（用於自動升級：資料庫中仍為未修改過之舊預設時，啟動時改用新預設並新增版本）。
 * 使用者自行修改過的範本不會被覆蓋。
 */
export const LEGACY_DEFAULT_TEMPLATES: { type: TemplateType; subject: string; body: string }[] = [
  {
    type: "PRE_REPORT",
    subject: "檢送「{projectName}」{schoolName}事前－規劃及分析報告書，附件詳如說明三，請查照。",
    body: [
      "一、依據本案徵求服務建議書第肆點規定辦理。",
      "二、依據貴局{notificationDateROC}電子郵件辦理。",
      "三、附件網址：{attachmentUrl}，下載密碼：{attachmentPassword}（請於{downloadDeadlineROC}前下載）。",
    ].join("\n"),
  },
  {
    type: "REVIEW_SLIDES_EMAIL",
    subject: "【{projectName}】{schoolName}審查會議簡報",
    body: [
      "{agencyContact} 您好：",
      "",
      "有關「{projectName}」{schoolName}審查會議訂於{eventDateTime}{eventLocationText}召開，",
      "檢附審查會議簡報（附件：{attachmentNames}），敬請參閱。",
      "",
      "如有任何問題，歡迎隨時與我們聯繫，謝謝。",
      "",
      "{companyName}",
      "{senderName} 敬上",
    ].join("\n"),
  },
  {
    type: "REVIEW_MINUTES_EMAIL",
    subject: "【{projectName}】{schoolName}審查會議紀錄",
    body: [
      "{agencyContact} 您好：",
      "",
      "有關「{projectName}」{schoolName}於{eventDateTime}召開之審查會議，",
      "檢附會議紀錄（附件：{attachmentNames}），敬請查閱；如有需修正之處，請不吝告知。",
      "",
      "謝謝。",
      "",
      "{companyName}",
      "{senderName} 敬上",
    ].join("\n"),
  },
  {
    type: "SITE_VISIT_MINUTES_EMAIL",
    subject: "【{projectName}】{schoolName}現場會勘紀錄",
    body: [
      "{agencyContact} 您好：",
      "",
      "有關「{projectName}」{schoolName}於{eventDateTime}辦理之現場會勘，",
      "檢附會勘紀錄（附件：{attachmentNames}），敬請查閱；如有需修正之處，請不吝告知。",
      "",
      "謝謝。",
      "",
      "{companyName}",
      "{senderName} 敬上",
    ].join("\n"),
  },
];

export const ALL_DEFAULT_TEMPLATES = [...DEFAULT_DOCUMENT_TEMPLATES, ...DEFAULT_EMAIL_TEMPLATES];

/** 範本可用之變數說明 */
export const TEMPLATE_VARIABLES: Record<TemplateCategory, { key: string; label: string }[]> = {
  DOCUMENT: [
    { key: "projectName", label: "計畫名稱" },
    { key: "schoolName", label: "學校名稱" },
    { key: "district", label: "行政區" },
    { key: "agencyName", label: "機關名稱" },
    { key: "notificationDateROC", label: "機關通知日（民國）" },
    { key: "reviewMeetingDateROC", label: "審查會議日（民國）" },
    { key: "siteVisitDateROC", label: "會勘日（民國）" },
    { key: "attachmentUrl", label: "附件網址" },
    { key: "attachmentPassword", label: "下載密碼" },
    { key: "downloadDeadlineROC", label: "下載期限（民國）" },
    { key: "companyName", label: "公司名稱" },
  ],
  EMAIL: [
    { key: "projectName", label: "計畫名稱" },
    { key: "schoolName", label: "學校名稱" },
    { key: "agencyName", label: "機關名稱" },
    { key: "agencyContact", label: "機關承辦人" },
    { key: "eventDateTime", label: "會議或會勘日期時間" },
    { key: "eventDate", label: "會議或會勘日期" },
    { key: "eventLocation", label: "地點" },
    { key: "eventLocationText", label: "「於○○」地點文字" },
    { key: "attachmentNames", label: "附件名稱" },
    { key: "attachmentUrl", label: "下載連結（草稿頁填寫）" },
    { key: "notificationRoundText", label: "「第11次通知」" },
    { key: "eventMonthDay", label: "會議或會勘月/日（10/5）" },
    { key: "eventDayWord", label: "「昨日」「今日」等相對日期" },
    { key: "signature", label: "寄件人簽名檔（個人帳號設定）" },
    { key: "companyName", label: "公司名稱" },
    { key: "senderName", label: "寄件人姓名" },
  ],
};
