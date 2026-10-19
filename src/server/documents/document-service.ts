import type { DocumentStatus, DocumentType, Prisma, TaskType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { dbDateToISOOrNull, isISODate, isoToDbDate, taipeiToday } from "@/lib/dates";
import { writeAudit } from "@/server/audit/audit";
import { assertCanComplete, assertCaseAccess, caseAccessWhere } from "@/server/auth/permissions";
import type { AuthUser } from "@/server/auth/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { isAdmin } from "@/server/auth/types";
import { orderBy } from "@/server/query-utils";
import { renderTemplate } from "@/server/templates/template-renderer";
import { getActiveTemplate } from "@/server/templates/template-service";
import { buildDocumentVariables, splitBodyLines } from "./document-variables";
import { getOrganization } from "@/server/settings/settings-service";
import { defaultAttachmentPassword, downloadDeadlineFor } from "./attachment-defaults";

const DRAFT_TASK: Record<DocumentType, TaskType> = {
  PRE_REPORT: "PRE_REPORT_DRAFT",
  REVIEW_DRAWING: "REVIEW_DRAWING_DRAFT",
  SITE_VISIT_DRAWING: "SITE_VISIT_DRAWING_DRAFT",
};
const DISPATCH_TASK: Record<DocumentType, TaskType> = {
  PRE_REPORT: "PRE_REPORT_DISPATCH",
  REVIEW_DRAWING: "REVIEW_DRAWING_DISPATCH",
  SITE_VISIT_DRAWING: "SITE_VISIT_DRAWING_DISPATCH",
};

/** 下載密碼不以明文存入主旨／說明，保留變數，於預覽與匯出時才代入 */
const KEEP_IN_STORAGE = ["attachmentPassword"];


export async function createDocumentDraft(user: AuthUser, input: { caseId: string; documentType: DocumentType; taskId?: string | null }) {
  await assertCaseAccess(user, input.caseId, "edit");
  const schoolCase = await prisma.schoolCase.findUniqueOrThrow({ where: { id: input.caseId } });
  const template = await getActiveTemplate(input.documentType);
  const org = await getOrganization();
  const vars = buildDocumentVariables({ schoolCase, companyName: org.companyName });
  const subject = renderTemplate(template.subject, vars, { keep: [...KEEP_IN_STORAGE, "attachmentUrl", "downloadDeadlineROC"] }).text;
  const body = renderTemplate(template.body, vars, { keep: [...KEEP_IN_STORAGE, "attachmentUrl", "downloadDeadlineROC"] }).text;
  const taskId =
    input.taskId ??
    (await prisma.task.findUnique({ where: { caseId_taskType: { caseId: input.caseId, taskType: DRAFT_TASK[input.documentType] } }, select: { id: true } }))?.id ??
    null;
  // 預設下載密碼（CD80@＋提供報告／圖面日期）與下載期限（創稿日期＋14 天）
  const today = taipeiToday();
  const pw = await defaultAttachmentPassword(input.caseId, input.documentType);
  const doc = await prisma.officialDocument.create({
    data: {
      attachmentPasswordEnc: pw ? encryptSecret(pw.password) : null,
      downloadDeadline: isoToDbDate(downloadDeadlineFor(today)),
      caseId: input.caseId,
      taskId,
      templateId: template.id,
      documentType: input.documentType,
      recipient: "如行文單位",
      primaryRecipients: schoolCase.agencyName,
      ccRecipients: null,
      attachments: "",
      subject,
      body,
      draftDate: isoToDbDate(today),
      createdById: user.id,
    },
  });
  await writeAudit({ actorId: user.id, action: "DOCUMENT_CREATE", entityType: "OfficialDocument", entityId: doc.id, summary: `建立公文草稿：${schoolCase.schoolName}` });
  return doc;
}

const optionalDate = z.string().optional().refine((v) => !v || isISODate(v), "日期格式錯誤");

export const documentUpdateSchema = z.object({
  recipient: z.string().trim().max(200).optional(),
  subject: z.string().trim().min(1, "請輸入主旨").max(2000),
  body: z.string().trim().min(1, "請輸入說明").max(20000),
  attachments: z.string().trim().max(1000).optional(),
  attachmentUrl: z.string().trim().max(2000).optional().refine((v) => !v || /^https?:\/\//i.test(v), "附件網址需以 http(s):// 開頭"),
  /** 留空表示不變更；輸入 "__CLEAR__" 表示清除 */
  attachmentPassword: z.string().max(200).optional(),
  downloadDeadline: optionalDate,
  primaryRecipients: z.string().trim().max(1000).optional(),
  ccRecipients: z.string().trim().max(1000).optional(),
  draftDate: optionalDate,
  dispatchDate: optionalDate,
});

export async function updateDocument(user: AuthUser, id: string, input: z.input<typeof documentUpdateSchema>) {
  const doc = await prisma.officialDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError("找不到公文");
  await assertCaseAccess(user, doc.caseId, "edit");
  if (doc.status === "DISPATCHED" || doc.status === "CANCELLED") throw new ValidationError("已發文或作廢之公文不可修改");
  const parsed = documentUpdateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "資料格式錯誤");
  const p = parsed.data;
  const data: Prisma.OfficialDocumentUpdateInput = {
    recipient: p.recipient || null,
    subject: p.subject,
    body: p.body,
    attachments: p.attachments || null,
    attachmentUrl: p.attachmentUrl || null,
    downloadDeadline: p.downloadDeadline ? isoToDbDate(p.downloadDeadline) : null,
    primaryRecipients: p.primaryRecipients || null,
    ccRecipients: p.ccRecipients || null,
    draftDate: p.draftDate ? isoToDbDate(p.draftDate) : null,
    dispatchDate: p.dispatchDate ? isoToDbDate(p.dispatchDate) : null,
  };
  if (p.attachmentPassword === "__CLEAR__") data.attachmentPasswordEnc = null;
  else if (p.attachmentPassword) data.attachmentPasswordEnc = encryptSecret(p.attachmentPassword);
  const updated = await prisma.officialDocument.update({ where: { id }, data });
  await writeAudit({ actorId: user.id, action: "DOCUMENT_UPDATE", entityType: "OfficialDocument", entityId: id, summary: "儲存公文草稿" });
  return updated;
}

async function completeLinkedTask(tx: Prisma.TransactionClient, caseId: string, taskType: TaskType, at: Date) {
  await tx.task.updateMany({
    where: { caseId, taskType, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    data: { status: "COMPLETED", actualCompletedAt: at },
  });
}

/** 標記已創稿（僅完成創稿工作，不代表正式發文） */
export async function markDocumentDrafted(user: AuthUser, id: string) {
  assertCanComplete(user);
  const doc = await prisma.officialDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError("找不到公文");
  await assertCaseAccess(user, doc.caseId, "edit");
  if (doc.status !== "DRAFT") throw new ValidationError("僅草稿狀態可標記為已創稿");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.officialDocument.update({
      where: { id },
      data: { status: "DRAFTED", draftCompletedAt: now, draftDate: doc.draftDate ?? isoToDbDate(taipeiToday(now)) },
    });
    await completeLinkedTask(tx, doc.caseId, DRAFT_TASK[doc.documentType], now);
    await writeAudit({ actorId: user.id, action: "DOCUMENT_DRAFTED", entityType: "OfficialDocument", entityId: id, summary: "標記公文已創稿" }, tx);
  });
}

const dispatchSchema = z.object({
  documentNumber: z.string().trim().min(1, "請輸入正式發文字號").max(100),
  dispatchDate: z.string().refine(isISODate, "請輸入發文日期"),
});

/** 標記已發文：正式發文字號必須由使用者輸入（系統不自動編號） */
export async function markDocumentDispatched(user: AuthUser, id: string, input: z.input<typeof dispatchSchema>) {
  assertCanComplete(user);
  const doc = await prisma.officialDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError("找不到公文");
  await assertCaseAccess(user, doc.caseId, "edit");
  if (doc.status === "DISPATCHED") throw new ValidationError("此公文已標記發文");
  if (doc.status === "CANCELLED") throw new ValidationError("已作廢之公文不可發文");
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "資料格式錯誤");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.officialDocument.update({
      where: { id },
      data: {
        status: "DISPATCHED",
        documentNumber: parsed.data.documentNumber,
        dispatchDate: isoToDbDate(parsed.data.dispatchDate),
        dispatchCompletedAt: now,
        draftCompletedAt: doc.draftCompletedAt ?? now,
      },
    });
    await completeLinkedTask(tx, doc.caseId, DISPATCH_TASK[doc.documentType], now);
    await writeAudit(
      { actorId: user.id, action: "DOCUMENT_DISPATCHED", entityType: "OfficialDocument", entityId: id, summary: `標記公文已發文，發文字號：${parsed.data.documentNumber}` },
      tx,
    );
  });
}

export async function cancelDocument(user: AuthUser, id: string) {
  const doc = await prisma.officialDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError("找不到公文");
  await assertCaseAccess(user, doc.caseId, "edit");
  if (doc.status === "DISPATCHED") throw new ValidationError("已發文之公文不可作廢");
  await prisma.officialDocument.update({ where: { id }, data: { status: "CANCELLED" } });
  await writeAudit({ actorId: user.id, action: "DOCUMENT_CANCEL", entityType: "OfficialDocument", entityId: id, summary: "公文草稿作廢" });
}

/**
 * 永久刪除公文。已發文之公文屬正式紀錄，僅管理員可刪除。
 * 刪除不會改變對應工作的完成狀態；操作紀錄保留主旨與發文字號。
 */
export async function deleteDocument(user: AuthUser, id: string) {
  const doc = await prisma.officialDocument.findUnique({ where: { id }, include: { schoolCase: { select: { schoolName: true } } } });
  if (!doc) throw new NotFoundError("找不到公文");
  await assertCaseAccess(user, doc.caseId, "edit");
  if (doc.status === "DISPATCHED" && !isAdmin(user)) throw new ForbiddenError("已發文之公文僅管理員可刪除");
  await prisma.officialDocument.delete({ where: { id } });
  await writeAudit({
    actorId: user.id,
    action: "DOCUMENT_DELETE",
    entityType: "OfficialDocument",
    entityId: id,
    summary: `刪除公文：${doc.schoolCase.schoolName}（${doc.status === "DISPATCHED" ? `已發文，字號 ${doc.documentNumber ?? "—"}` : "未發文"}）`,
    changes: { documentType: doc.documentType, status: doc.status, subject: doc.subject, documentNumber: doc.documentNumber },
  });
}

export async function getDocumentForEdit(user: AuthUser, id: string) {
  const doc = await prisma.officialDocument.findUnique({
    where: { id },
    include: { schoolCase: true, createdBy: { select: { name: true } }, template: { select: { version: true, name: true } } },
  });
  if (!doc) throw new NotFoundError("找不到公文");
  await assertCaseAccess(user, doc.caseId, "view");
  const { attachmentPasswordEnc, ...rest } = doc;
  return { ...rest, attachmentPassword: decryptSecret(attachmentPasswordEnc), hasAttachmentPassword: !!attachmentPasswordEnc };
}

/** 產生預覽／匯出用之最終主旨與說明（代入下載密碼等即時欄位） */
export function renderDocumentContent(doc: {
  subject: string;
  body: string;
  attachmentUrl: string | null;
  attachmentPassword: string | null;
  downloadDeadline: Date | null;
  schoolCase: Parameters<typeof buildDocumentVariables>[0]["schoolCase"];
}, companyName = "") {
  const vars = buildDocumentVariables({
    schoolCase: doc.schoolCase,
    attachmentUrl: doc.attachmentUrl,
    attachmentPassword: doc.attachmentPassword,
    downloadDeadline: dbDateToISOOrNull(doc.downloadDeadline),
    companyName,
  });
  const subject = renderTemplate(doc.subject, vars);
  const body = renderTemplate(doc.body, vars);
  return { subject: subject.text, bodyLines: splitBodyLines(body.text), missing: [...new Set([...subject.missing, ...body.missing])] };
}

export interface DocumentListQuery {
  q?: string;
  status?: string;
  documentType?: string;
  caseId?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function listDocuments(user: AuthUser, query: DocumentListQuery) {
  const filters: Prisma.OfficialDocumentWhereInput[] = [{ schoolCase: caseAccessWhere(user) }];
  if (query.status && ["DRAFT", "DRAFTED", "DISPATCHED", "CANCELLED"].includes(query.status)) filters.push({ status: query.status as DocumentStatus });
  if (query.documentType && ["PRE_REPORT", "REVIEW_DRAWING", "SITE_VISIT_DRAWING"].includes(query.documentType)) filters.push({ documentType: query.documentType as DocumentType });
  if (query.caseId) filters.push({ caseId: query.caseId });
  if (query.q) {
    const q = query.q.trim();
    filters.push({ OR: [{ subject: { contains: q, mode: "insensitive" } }, { documentNumber: { contains: q, mode: "insensitive" } }, { schoolCase: { schoolName: { contains: q, mode: "insensitive" } } }] });
  }
  const where = { AND: filters };
  const sortable = ["createdAt", "dispatchDate", "status", "documentType", "updatedAt"];
  const sort = sortable.includes(query.sort ?? "") ? query.sort! : "createdAt";
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 5), 100);
  const page = Math.max(query.page ?? 1, 1);
  const [total, items] = await Promise.all([
    prisma.officialDocument.count({ where }),
    prisma.officialDocument.findMany({
      where,
      orderBy: [orderBy(sort, query.dir === "asc" ? "asc" : "desc", ["dispatchDate"])] as Prisma.OfficialDocumentOrderByWithRelationInput[],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, documentType: true, subject: true, status: true, documentNumber: true, dispatchDate: true, draftDate: true,
        draftCompletedAt: true, dispatchCompletedAt: true, createdAt: true, updatedAt: true,
        schoolCase: { select: { id: true, schoolName: true, projectCode: true } },
      },
    }),
  ]);
  return { total, page, pageSize, items };
}
