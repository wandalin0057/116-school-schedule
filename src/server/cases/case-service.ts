import type { CaseStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isoToDbDate, parseTaipeiDateTime, taipeiDateOf, type ISODate } from "@/lib/dates";
import { diffFields, writeAudit } from "@/server/audit/audit";
import { assertCanComplete, assertCaseAccess, caseAccessWhere } from "@/server/auth/permissions";
import { isAdmin, type AuthUser } from "@/server/auth/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { orderBy } from "@/server/query-utils";
import type { ScheduleChange } from "@/server/schedule/schedule-calculator";
import { computeCaseScheduleChanges, syncCaseTasks } from "@/server/schedule/task-sync";
import { randomToken } from "@/lib/crypto";
import { hashPassword } from "@/server/auth/password";
import { getDefaultPasswordHash } from "@/server/users/default-password";
import { caseInputSchema, type CaseInput, type CaseParsed } from "./case-schema";

type ResolvedCase = Omit<CaseParsed, "responsibleUserId"> & { responsibleUserId: string };

/**
 * 依負責人 Email 找到帳號；Email 尚無帳號時（限管理員）自動建立「提醒收件帳號」。
 * 自動建立之帳號無法登入（密碼為隨機值），需要登入時由管理員於使用者管理重設密碼。
 */
async function resolveResponsible(actor: AuthUser, p: CaseParsed): Promise<ResolvedCase> {
  if (p.responsibleEmail) {
    const existing = await prisma.user.findUnique({ where: { email: p.responsibleEmail } });
    if (existing) {
      if (!existing.isActive) throw new ValidationError("此負責人帳號已停用，請至使用者管理重新啟用", { responsibleEmail: ["帳號已停用"] });
      return { ...p, responsibleUserId: existing.id };
    }
    if (!isAdmin(actor)) {
      throw new ValidationError("此 Email 尚未建立帳號，請洽管理員新增，或改填既有同事的 Email", { responsibleEmail: ["尚無此帳號"] });
    }
    if (!p.responsibleName) throw new ValidationError("新負責人請填寫姓名", { responsibleName: ["請填寫負責人姓名"] });
    const created = await prisma.user.create({
      data: {
        email: p.responsibleEmail,
        name: p.responsibleName,
        role: "USER",
        passwordHash: (await getDefaultPasswordHash()) ?? (await hashPassword(randomToken(24))),
        mustChangePassword: true,
        reminderPreference: { create: {} },
      },
    });
    await writeAudit({
      actorId: actor.id,
      action: "USER_CREATE",
      entityType: "User",
      entityId: created.id,
      summary: `由學校案件建立負責人帳號 ${created.name}（${created.email}）`,
    });
    return { ...p, responsibleUserId: created.id };
  }
  if (!p.responsibleUserId) throw new ValidationError("請填寫負責人 Email", { responsibleEmail: ["請填寫負責人 Email"] });
  return { ...p, responsibleUserId: p.responsibleUserId };
}

function parseInput(input: CaseInput): CaseParsed {
  const parsed = caseInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "資料格式錯誤", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  return parsed.data;
}

function toDbFields(p: ResolvedCase) {
  return {
    projectCode: p.projectCode,
    projectName: p.projectName,
    schoolName: p.schoolName,
    district: p.district,
    agencyName: p.agencyName,
    agencyContact: p.agencyContact,
    agencyEmail: p.agencyEmail,
    responsibleUserId: p.responsibleUserId,
    notificationDate: p.notificationDate ? isoToDbDate(p.notificationDate) : null,
    notificationRound: p.notificationRound,
    reviewMeetingDateTime: p.reviewMeetingDateTime ? parseTaipeiDateTime(p.reviewMeetingDateTime) : null,
    reviewMeetingLocation: p.reviewMeetingLocation,
    siteVisitDateTime: p.siteVisitDateTime ? parseTaipeiDateTime(p.siteVisitDateTime) : null,
    siteVisitLocation: p.siteVisitLocation,
    siteVisitUploadUrl: p.siteVisitUploadUrl,
    finalReportNoticeDate: p.finalReportNoticeDate ? isoToDbDate(p.finalReportNoticeDate) : null,
    finalReportApprovedDate: p.finalReportApprovedDate ? isoToDbDate(p.finalReportApprovedDate) : null,
    status: p.status as CaseStatus,
    notes: p.notes,
  };
}

async function assertResponsibleUser(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || !u.isActive) throw new ValidationError("負責人不存在或已停用");
}

async function assertUniqueCode(projectCode: string, excludeId?: string) {
  const dup = await prisma.schoolCase.findFirst({
    where: { projectCode: { equals: projectCode, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (dup) throw new ValidationError("案件編號已存在，不可重複", { projectCode: ["案件編號已存在"] });
}

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** 依會議／會勘日期異動，維護 Meeting、SiteVisit 紀錄（保留改期歷史） */
async function syncEventRecords(
  tx: Prisma.TransactionClient,
  caseId: string,
  actorId: string,
  before: { reviewMeetingDateTime: Date | null; siteVisitDateTime: Date | null } | null,
  after: ReturnType<typeof toDbFields>,
  reason: string | null,
) {
  if (!sameInstant(before?.reviewMeetingDateTime ?? null, after.reviewMeetingDateTime)) {
    await tx.meeting.updateMany({ where: { caseId, status: "SCHEDULED" }, data: { status: after.reviewMeetingDateTime ? "RESCHEDULED" : "CANCELLED", changeReason: reason } });
    if (after.reviewMeetingDateTime) {
      await tx.meeting.create({ data: { caseId, scheduledAt: after.reviewMeetingDateTime, location: after.reviewMeetingLocation, createdById: actorId, changeReason: before?.reviewMeetingDateTime ? reason : null } });
    }
  } else if (after.reviewMeetingDateTime) {
    await tx.meeting.updateMany({ where: { caseId, status: "SCHEDULED" }, data: { location: after.reviewMeetingLocation } });
  }
  if (!sameInstant(before?.siteVisitDateTime ?? null, after.siteVisitDateTime)) {
    await tx.siteVisit.updateMany({ where: { caseId, status: "SCHEDULED" }, data: { status: after.siteVisitDateTime ? "RESCHEDULED" : "CANCELLED", changeReason: reason } });
    if (after.siteVisitDateTime) {
      await tx.siteVisit.create({ data: { caseId, scheduledAt: after.siteVisitDateTime, location: after.siteVisitLocation, uploadUrl: after.siteVisitUploadUrl, createdById: actorId, changeReason: before?.siteVisitDateTime ? reason : null } });
    }
  } else if (after.siteVisitDateTime) {
    await tx.siteVisit.updateMany({ where: { caseId, status: "SCHEDULED" }, data: { location: after.siteVisitLocation, uploadUrl: after.siteVisitUploadUrl } });
  }
}

export async function createCase(user: AuthUser, input: CaseInput, meta: { ipAddress?: string | null } = {}) {
  const p = await resolveResponsible(user, parseInput(input));
  await assertResponsibleUser(p.responsibleUserId);
  await assertUniqueCode(p.projectCode);
  const data = toDbFields(p);

  const result = await prisma.$transaction(
    async (tx) => {
      const created = await tx.schoolCase.create({ data });
      // 一般使用者建立案件時若指定他人為負責人，自動將建立者加入為可編輯成員
      if (!isAdmin(user) && p.responsibleUserId !== user.id) {
        await tx.caseMember.create({ data: { caseId: created.id, userId: user.id, role: "EDITOR" } });
      }
      await syncEventRecords(tx, created.id, user.id, null, data, null);
      const changes = await syncCaseTasks(created.id, { actorId: user.id, source: "CASE_CREATED", reason: "建立案件", db: tx });
      await writeAudit(
        { actorId: user.id, action: "CASE_CREATE", entityType: "SchoolCase", entityId: created.id, summary: `新增案件 ${created.projectCode} ${created.schoolName}`, ipAddress: meta.ipAddress },
        tx,
      );
      return { schoolCase: created, changes };
    },
    { timeout: 20000 },
  );
  return result;
}

/** 變更前預覽：計算新日期對各工作期限之影響（不寫入） */
export async function previewCaseUpdate(user: AuthUser, caseId: string, input: CaseInput): Promise<ScheduleChange[]> {
  await assertCaseAccess(user, caseId, "edit");
  const p = parseInput(input);
  const anchors = {
    notificationDate: p.notificationDate as ISODate | null,
    reviewMeetingDate: p.reviewMeetingDateTime ? taipeiDateOf(parseTaipeiDateTime(p.reviewMeetingDateTime)) : null,
    siteVisitDate: p.siteVisitDateTime ? taipeiDateOf(parseTaipeiDateTime(p.siteVisitDateTime)) : null,
    finalReportNoticeDate: p.finalReportNoticeDate as ISODate | null,
    finalReportApprovedDate: p.finalReportApprovedDate as ISODate | null,
  };
  return computeCaseScheduleChanges(caseId, anchors);
}

export async function updateCase(user: AuthUser, caseId: string, input: CaseInput, meta: { ipAddress?: string | null } = {}) {
  await assertCaseAccess(user, caseId, "edit");
  const before = await prisma.schoolCase.findUnique({ where: { id: caseId } });
  if (!before) throw new NotFoundError("找不到此案件");
  const parsed = parseInput(input);
  // 變更負責人之權限需在建立新帳號前檢查
  if (parsed.responsibleEmail && !isAdmin(user) && before.responsibleUserId !== user.id) {
    const current = await prisma.user.findUnique({ where: { id: before.responsibleUserId }, select: { email: true } });
    if (current?.email !== parsed.responsibleEmail) throw new ForbiddenError("僅管理員或案件負責人可變更負責人");
  }
  const p = await resolveResponsible(user, parsed);
  if (p.responsibleUserId !== before.responsibleUserId) {
    if (!isAdmin(user) && before.responsibleUserId !== user.id) throw new ForbiddenError("僅管理員或案件負責人可變更負責人");
    await assertResponsibleUser(p.responsibleUserId);
  }
  if (p.projectCode !== before.projectCode) await assertUniqueCode(p.projectCode, caseId);
  const data = toDbFields(p);
  const fieldDiff = diffFields(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
  const datesChanged =
    "notificationDate" in fieldDiff ||
    "reviewMeetingDateTime" in fieldDiff ||
    "siteVisitDateTime" in fieldDiff ||
    "finalReportNoticeDate" in fieldDiff ||
    "finalReportApprovedDate" in fieldDiff;

  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.schoolCase.update({ where: { id: caseId }, data });
      await syncEventRecords(tx, caseId, user.id, before, data, p.dateChangeReason);
      // 負責人異動時，將未完成且原指派給前負責人之工作轉給新負責人
      if (p.responsibleUserId !== before.responsibleUserId) {
        await tx.task.updateMany({
          where: { caseId, assignedUserId: before.responsibleUserId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
          data: { assignedUserId: p.responsibleUserId },
        });
        // 一般使用者將負責人轉出時，保留其編輯權限
        if (!isAdmin(user) && before.responsibleUserId === user.id) {
          await tx.caseMember.upsert({
            where: { caseId_userId: { caseId, userId: user.id } },
            create: { caseId, userId: user.id, role: "EDITOR" },
            update: { role: "EDITOR" },
          });
        }
        await tx.caseMember.deleteMany({ where: { caseId, userId: p.responsibleUserId } });
      }
      const changes = await syncCaseTasks(caseId, {
        actorId: user.id,
        source: "CASE_DATE_CHANGE",
        reason: p.dateChangeReason ?? (datesChanged ? "案件日期異動" : "案件資料更新"),
        db: tx,
      });
      if (Object.keys(fieldDiff).length) {
        await writeAudit(
          {
            actorId: user.id,
            action: datesChanged ? "CASE_DATE_CHANGE" : "CASE_UPDATE",
            entityType: "SchoolCase",
            entityId: caseId,
            summary: `${datesChanged ? "變更案件日期" : "更新案件"} ${updated.projectCode} ${updated.schoolName}${p.dateChangeReason ? `（原因：${p.dateChangeReason}）` : ""}`,
            changes: {
              fields: fieldDiff,
              taskChanges: changes.filter((c) => c.action !== "UNCHANGED").map((c) => ({ taskType: c.taskType, action: c.action, from: c.previousDate, to: c.newDate })),
            },
            ipAddress: meta.ipAddress,
          },
          tx,
        );
      }
      return { schoolCase: updated, changes };
    },
    { timeout: 20000 },
  );
}

/** 案件列表（含搜尋、篩選、排序、分頁） */
export interface CaseListQuery {
  q?: string;
  status?: string;
  district?: string;
  projectName?: string;
  responsibleUserId?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const CASE_SORT_FIELDS = ["projectCode", "schoolName", "district", "notificationDate", "reviewMeetingDateTime", "siteVisitDateTime", "updatedAt", "status"] as const;

export async function listCases(user: AuthUser, query: CaseListQuery) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 5), 100);
  const page = Math.max(query.page ?? 1, 1);
  const filters: Prisma.SchoolCaseWhereInput[] = [caseAccessWhere(user)];
  if (query.q) {
    const q = query.q.trim();
    filters.push({
      OR: [
        { projectCode: { contains: q, mode: "insensitive" } },
        { schoolName: { contains: q, mode: "insensitive" } },
        { projectName: { contains: q, mode: "insensitive" } },
        { agencyContact: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (query.status && ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].includes(query.status)) filters.push({ status: query.status as CaseStatus });
  if (query.district) filters.push({ district: query.district });
  if (query.projectName) filters.push({ projectName: query.projectName });
  if (query.responsibleUserId) filters.push({ responsibleUserId: query.responsibleUserId });
  const where: Prisma.SchoolCaseWhereInput = { AND: filters };
  const sortField = (CASE_SORT_FIELDS as readonly string[]).includes(query.sort ?? "") ? query.sort! : "projectCode";
  const dir = query.dir === "desc" ? "desc" : "asc";

  const [total, items] = await Promise.all([
    prisma.schoolCase.count({ where }),
    prisma.schoolCase.findMany({
      where,
      orderBy: [orderBy(sortField, dir, ["district", "notificationDate", "reviewMeetingDateTime", "siteVisitDateTime"]), { projectCode: "asc" }] as Prisma.SchoolCaseOrderByWithRelationInput[],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        responsibleUser: { select: { id: true, name: true } },
        tasks: { select: { status: true } },
        _count: { select: { documents: true, emailDrafts: true } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: items.map((c) => ({
      ...c,
      taskTotal: c.tasks.filter((t) => t.status !== "CANCELLED").length,
      taskCompleted: c.tasks.filter((t) => t.status === "COMPLETED").length,
    })),
  };
}

export async function getCaseDetail(user: AuthUser, caseId: string) {
  await assertCaseAccess(user, caseId, "view");
  return prisma.schoolCase.findUniqueOrThrow({
    where: { id: caseId },
    include: {
      responsibleUser: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      tasks: { include: { assignedUser: { select: { id: true, name: true } }, histories: { orderBy: { createdAt: "desc" }, take: 5, include: { changedBy: { select: { name: true } } } } } },
      meetings: { orderBy: { createdAt: "desc" } },
      siteVisits: { orderBy: { createdAt: "desc" } },
      documents: { orderBy: { createdAt: "desc" }, select: { id: true, documentType: true, subject: true, status: true, documentNumber: true, dispatchDate: true, createdAt: true } },
      emailDrafts: { orderBy: { createdAt: "desc" }, select: { id: true, templateType: true, subject: true, status: true, createdAt: true, confirmedSentAt: true } },
    },
  });
}

/**
 * 刪除案件（僅管理員）：一併刪除工作、會議／會勘紀錄、公文與 Email 草稿。
 * 案件已有公文或 Email 草稿時，需輸入案件編號確認，避免誤刪。
 * 操作紀錄保留案件資料與已發文之發文字號。
 */
export async function deleteCase(
  user: AuthUser,
  caseId: string,
  options: { confirmCode?: string; ipAddress?: string | null } = {},
) {
  if (!isAdmin(user)) throw new ForbiddenError("僅管理員可刪除案件");
  const c = await prisma.schoolCase.findUnique({
    where: { id: caseId },
    include: {
      documents: { select: { status: true, documentNumber: true } },
      _count: { select: { tasks: true, emailDrafts: true } },
    },
  });
  if (!c) throw new NotFoundError("找不到此案件");
  const hasRecords = c.documents.length > 0 || c._count.emailDrafts > 0;
  if (hasRecords && options.confirmCode?.trim() !== c.projectCode) {
    throw new ValidationError(`此案件含公文或 Email 草稿，請輸入案件編號「${c.projectCode}」確認刪除`);
  }
  const dispatched = c.documents.filter((d) => d.status === "DISPATCHED").map((d) => d.documentNumber ?? "（無字號）");
  await prisma.$transaction([
    prisma.emailDraft.deleteMany({ where: { caseId } }),
    prisma.officialDocument.deleteMany({ where: { caseId } }),
    prisma.schoolCase.delete({ where: { id: caseId } }),
  ]);
  await writeAudit({
    actorId: user.id,
    action: "CASE_DELETE",
    entityType: "SchoolCase",
    entityId: caseId,
    summary: `刪除案件 ${c.projectCode} ${c.schoolName}（工作 ${c._count.tasks}、公文 ${c.documents.length}、Email 草稿 ${c._count.emailDrafts}）`,
    changes: { projectCode: c.projectCode, projectName: c.projectName, schoolName: c.schoolName, dispatchedDocumentNumbers: dispatched },
    ipAddress: options.ipAddress,
  });
}

export async function setCaseMember(user: AuthUser, caseId: string, memberUserId: string, role: "EDITOR" | "VIEWER" | null) {
  const c = await prisma.schoolCase.findUnique({ where: { id: caseId } });
  if (!c) throw new NotFoundError("找不到此案件");
  if (!isAdmin(user) && c.responsibleUserId !== user.id) throw new ForbiddenError("僅管理員或案件負責人可調整授權");
  if (memberUserId === c.responsibleUserId) throw new ValidationError("負責人已具備完整權限");
  if (role === null) {
    await prisma.caseMember.deleteMany({ where: { caseId, userId: memberUserId } });
  } else {
    const u = await prisma.user.findUnique({ where: { id: memberUserId } });
    if (!u || !u.isActive) throw new ValidationError("使用者不存在或已停用");
    await prisma.caseMember.upsert({ where: { caseId_userId: { caseId, userId: memberUserId } }, create: { caseId, userId: memberUserId, role }, update: { role } });
  }
  await writeAudit({ actorId: user.id, action: "CASE_MEMBER_CHANGE", entityType: "SchoolCase", entityId: caseId, summary: `${role ? "授權" : "移除"}案件成員`, changes: { memberUserId, role } });
}

/** 標記會議或會勘已辦理，同步完成對應工作 */
export async function markEventHeld(user: AuthUser, caseId: string, kind: "REVIEW_MEETING" | "SITE_VISIT", info: { attendees?: string | null; notes?: string | null }) {
  assertCanComplete(user);
  await assertCaseAccess(user, caseId, "edit");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (kind === "REVIEW_MEETING") {
      const n = await tx.meeting.updateMany({ where: { caseId, status: "SCHEDULED" }, data: { status: "HELD", attendees: info.attendees, notes: info.notes } });
      if (!n.count) throw new ValidationError("尚未排定審查會議");
    } else {
      const n = await tx.siteVisit.updateMany({ where: { caseId, status: "SCHEDULED" }, data: { status: "HELD", attendees: info.attendees, notes: info.notes } });
      if (!n.count) throw new ValidationError("尚未排定會勘");
    }
    await tx.task.updateMany({ where: { caseId, taskType: kind, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "COMPLETED", actualCompletedAt: now } });
    await writeAudit({ actorId: user.id, action: "EVENT_HELD", entityType: "SchoolCase", entityId: caseId, summary: kind === "REVIEW_MEETING" ? "審查會議已辦理" : "會勘已辦理" }, tx);
  });
}
