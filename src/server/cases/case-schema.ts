import { z } from "zod";
import { isISODate } from "@/lib/dates";

export const DEFAULT_PROJECT_NAME = "115年度臺北市通學區規劃分析案";

export const TAIPEI_DISTRICTS = [
  "中正區", "大同區", "中山區", "松山區", "大安區", "萬華區",
  "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區",
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `不可超過 ${max} 字`)
    .optional()
    .transform((v) => (v ? v : null));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || isISODate(v), "日期格式錯誤")
  .transform((v) => (v ? v : null));

const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), "日期時間格式錯誤")
  .transform((v) => (v ? v : null));

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .refine((v) => !v || /^https?:\/\//i.test(v), "網址需以 http:// 或 https:// 開頭")
  .transform((v) => (v ? v : null));

export const caseInputSchema = z.object({
  projectCode: z
    .string()
    .trim()
    .min(1, "請輸入案件編號")
    .max(50, "案件編號不可超過 50 字")
    .regex(/^[A-Za-z0-9\-_.]+$/, "案件編號僅可使用英數字、-、_、."),
  projectName: z.string().trim().min(1, "請輸入計畫名稱").max(200),
  schoolName: z.string().trim().min(1, "請輸入學校名稱").max(100),
  district: optionalText(20),
  agencyName: optionalText(100),
  agencyContact: optionalText(100),
  agencyEmail: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || v.split(/[,;，；\s]+/).filter(Boolean).every((e) => z.string().email().safeParse(e).success), "Email 格式錯誤")
    .transform((v) => (v ? v : null)),
  /** 負責人：可直接指定帳號，或填寫姓名與 Email（新 Email 會自動建立提醒收件帳號） */
  responsibleUserId: z.string().trim().optional().transform((v) => (v ? v : null)),
  responsibleName: z.string().trim().max(50, "負責人姓名不可超過 50 字").optional().transform((v) => (v ? v : null)),
  responsibleEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, "負責人 Email 格式錯誤")
    .transform((v) => (v ? v : null)),
  notificationDate: optionalDate,
  notificationRound: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{1,3}$/.test(v), "第幾次通知請填數字")
    .transform((v) => (v ? Number(v) : null)),
  reviewMeetingDateTime: optionalDateTime,
  reviewMeetingLocation: optionalText(200),
  siteVisitDateTime: optionalDateTime,
  siteVisitLocation: optionalText(200),
  siteVisitUploadUrl: optionalUrl,
  finalReportNoticeDate: optionalDate,
  finalReportApprovedDate: optionalDate,
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).default("ACTIVE"),
  notes: optionalText(5000),
  dateChangeReason: optionalText(500),
});

export type CaseInput = z.input<typeof caseInputSchema>;
export type CaseParsed = z.output<typeof caseInputSchema>;

export const CASE_STATUS_LABELS = {
  ACTIVE: "執行中",
  ON_HOLD: "暫停",
  COMPLETED: "已結案",
  CANCELLED: "已取消",
} as const;
