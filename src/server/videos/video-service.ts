import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isISODate, isoToDbDate } from "@/lib/dates";
import { writeAudit } from "@/server/audit/audit";
import { assertAdmin, caseAccessWhere } from "@/server/auth/permissions";
import type { AuthUser } from "@/server/auth/types";
import { NotFoundError, ValidationError } from "@/server/errors";
import { syncCaseTasks } from "@/server/schedule/task-sync";
import { STANDALONE_KINDS, type StandaloneKind } from "./standalone-kinds";

/**
 * 獨立項目（成果影片、成效分析及成果報告書）：不屬於通學區學校案件（學校可能不同）。
 * 資料存於 SchoolCase（caseType = RESULT_VIDEO／RESULT_REPORT），依機關通知日推算繳交工作與前一工作天之創稿，
 * 因此可共用工作待辦、行事曆、公文與每日提醒，但不會出現在學校案件列表與儀表板案件進度中。
 */
export const VIDEO_PROJECT_NAME = "成果影片";
/** 全案報告未填學校時，名稱記為「全案」（行事曆、提醒信與公文主旨使用） */
const WHOLE_PROJECT = "全案";

const optionalDate = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || isISODate(v), "日期格式錯誤")
  .transform((v) => v || null);

const schema = z.object({
  /** 所屬計畫（公文主旨「檢送「{projectName}」…」使用） */
  projectName: z.string().trim().max(200).optional().transform((v) => v || VIDEO_PROJECT_NAME),
  schoolName: z.string().trim().max(100).optional().transform((v) => v ?? ""),
  district: z.string().trim().max(20).optional().transform((v) => v || null),
  responsibleUserId: z.string().trim().min(1, "請選擇負責人"),
  /** 機關通知日 */
  noticeDate: optionalDate,
  /** 成果影片：機關審核同意通知日（15 秒版本） */
  approvedDate: optionalDate,
  /** 圖卡：本案規劃（PLANNED）或機關另行指定（DESIGNATED） */
  cardSource: z.enum(["PLANNED", "DESIGNATED"]).optional(),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
});
export type VideoInput = z.input<typeof schema>;

function parse(input: VideoInput, kind: StandaloneKind) {
  const p = schema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "資料格式錯誤", p.error.flatten().fieldErrors as Record<string, string[]>);
  if (!p.data.schoolName) {
    if (STANDALONE_KINDS[kind].schoolRequired) throw new ValidationError("請輸入學校名稱", { schoolName: ["請輸入學校名稱"] });
    p.data.schoolName = WHOLE_PROJECT;
  }
  if (kind !== "RESULT_VIDEO") p.data.approvedDate = null;
  if (kind === "BEFORE_AFTER_CARDS") p.data.cardSource ??= "PLANNED";
  else p.data.cardSource = undefined;
  return p.data;
}

function toDbFields(p: ReturnType<typeof parse>) {
  return {
    projectName: p.projectName,
    schoolName: p.schoolName,
    district: p.district,
    responsibleUserId: p.responsibleUserId,
    notificationDate: p.noticeDate ? isoToDbDate(p.noticeDate) : null,
    resultVideoApprovedDate: p.approvedDate ? isoToDbDate(p.approvedDate) : null,
    cardSource: p.cardSource ?? null,
    notes: p.notes,
  };
}

async function assertActiveUser(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!u?.isActive) throw new ValidationError("負責人帳號不存在或已停用", { responsibleUserId: ["請重新選擇負責人"] });
}

async function nextCode(prefix: string): Promise<string> {
  const rows = await prisma.schoolCase.findMany({ where: { projectCode: { startsWith: prefix } }, select: { projectCode: true } });
  const max = Math.max(0, ...rows.map((r) => Number(r.projectCode.slice(prefix.length).match(/^\d+/)?.[0] ?? 0)));
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

const mainTypes = (kind: StandaloneKind) => STANDALONE_KINDS[kind].stages.map((s) => s.taskType);

export async function listVideos(user: AuthUser, kind: StandaloneKind = "RESULT_VIDEO") {
  const k = STANDALONE_KINDS[kind];
  const admin = user.role === "ADMIN";
  const types = k.stages.flatMap((s) => (admin ? [s.taskType, s.draftTaskType] : [s.taskType]));
  const rows = await prisma.schoolCase.findMany({
    where: { AND: [caseAccessWhere(user), { caseType: kind }] },
    include: {
      responsibleUser: { select: { id: true, name: true } },
      tasks: {
        where: { taskType: { in: types } },
        select: { id: true, taskType: true, status: true, calculatedDueDate: true, overrideDueDate: true, actualCompletedAt: true },
      },
      documents: { select: { id: true, status: true, documentType: true }, orderBy: { createdAt: "desc" } },
    },
    orderBy: [{ notificationDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    ...r,
    stages: k.stages.map((s) => ({
      ...s,
      task: r.tasks.find((t) => t.taskType === s.taskType) ?? null,
      draft: r.tasks.find((t) => t.taskType === s.draftTaskType) ?? null,
      document: r.documents.find((d) => d.documentType === s.documentType) ?? null,
    })),
  }));
}

export async function createVideo(user: AuthUser, input: VideoInput, kind: StandaloneKind = "RESULT_VIDEO") {
  assertAdmin(user);
  const k = STANDALONE_KINDS[kind];
  const p = parse(input, kind);
  await assertActiveUser(p.responsibleUserId);
  const projectCode = await nextCode(k.codePrefix);
  return prisma.$transaction(async (tx) => {
    const c = await tx.schoolCase.create({ data: { caseType: kind, projectCode, ...toDbFields(p) } });
    await syncCaseTasks(c.id, { actorId: user.id, source: "CASE_CREATED", reason: `新增${k.label}`, db: tx });
    await writeAudit({ actorId: user.id, action: "CASE_CREATE", entityType: "SchoolCase", entityId: c.id, summary: `新增${k.label} ${p.schoolName}` }, tx);
    return c;
  });
}

export async function updateVideo(user: AuthUser, id: string, input: VideoInput & { reason?: string }, kind: StandaloneKind = "RESULT_VIDEO") {
  assertAdmin(user);
  const k = STANDALONE_KINDS[kind];
  const p = parse(input, kind);
  const existing = await prisma.schoolCase.findFirst({ where: { id, caseType: kind } });
  if (!existing) throw new NotFoundError(`找不到此${k.label}`);
  if (p.responsibleUserId !== existing.responsibleUserId) await assertActiveUser(p.responsibleUserId);
  return prisma.$transaction(async (tx) => {
    const c = await tx.schoolCase.update({ where: { id }, data: toDbFields(p) });
    await syncCaseTasks(id, { actorId: user.id, source: "CASE_DATE_CHANGE", reason: input.reason?.trim() || `更新${k.label}`, db: tx });
    await tx.task.updateMany({ where: { caseId: id, taskType: { in: mainTypes(kind) }, status: { not: "COMPLETED" } }, data: { assignedUserId: p.responsibleUserId } });
    await writeAudit({ actorId: user.id, action: "CASE_UPDATE", entityType: "SchoolCase", entityId: id, summary: `更新${k.label} ${p.schoolName}` }, tx);
    return c;
  });
}

/** 學校案件對應之圖卡項目編號（同一校只建立一筆） */
export const cardCodeFor = (schoolProjectCode: string) => `CARD-${schoolProjectCode}`;

/**
 * 學校案件填寫「機關同意備查日」後，自動建立（或更新）該校的改善前後對照圖卡項目。
 * 圖卡為獨立項目，學校案件本身不產生圖卡工作。
 */
export async function syncCardForSchoolCase(
  tx: Prisma.TransactionClient,
  c: { projectCode: string; projectName: string; schoolName: string; district: string | null; responsibleUserId: string; finalReportApprovedDate: Date | null },
  actorId: string | null,
) {
  if (!c.finalReportApprovedDate) return null;
  const projectCode = cardCodeFor(c.projectCode);
  const existing = await tx.schoolCase.findUnique({ where: { projectCode } });
  if (existing && existing.notificationDate?.getTime() === c.finalReportApprovedDate.getTime()) return existing;
  const card = existing
    ? await tx.schoolCase.update({ where: { id: existing.id }, data: { notificationDate: c.finalReportApprovedDate } })
    : await tx.schoolCase.create({
        data: {
          caseType: "BEFORE_AFTER_CARDS",
          cardSource: "PLANNED",
          projectCode,
          projectName: c.projectName,
          schoolName: c.schoolName,
          district: c.district,
          responsibleUserId: c.responsibleUserId,
          notificationDate: c.finalReportApprovedDate,
        },
      });
  await syncCaseTasks(card.id, { actorId, source: existing ? "CASE_DATE_CHANGE" : "CASE_CREATED", reason: "學校案件填寫機關同意備查日", db: tx });
  return card;
}
