import { z } from "zod";
import { prisma } from "@/lib/db";
import { isISODate, isoToDbDate } from "@/lib/dates";
import { writeAudit } from "@/server/audit/audit";
import { assertAdmin, caseAccessWhere } from "@/server/auth/permissions";
import type { AuthUser } from "@/server/auth/types";
import { NotFoundError, ValidationError } from "@/server/errors";
import { syncCaseTasks } from "@/server/schedule/task-sync";

/**
 * 成果影片：獨立於通學區學校案件的項目（製作影片的學校可能與通學區案件不同）。
 * 資料存於 SchoolCase（caseType = RESULT_VIDEO），只產生一項「提供成果影片」工作，
 * 因此可共用工作待辦、行事曆與每日提醒，但不會出現在學校案件列表與儀表板案件進度中。
 */
export const VIDEO_PROJECT_NAME = "成果影片";

const videoSchema = z.object({
  /** 所屬計畫（公文主旨「檢送「{projectName}」…」使用） */
  projectName: z.string().trim().max(200).optional().transform((v) => v || VIDEO_PROJECT_NAME),
  schoolName: z.string().trim().min(1, "請輸入學校名稱").max(100),
  district: z.string().trim().max(20).optional().transform((v) => v || null),
  responsibleUserId: z.string().trim().min(1, "請選擇負責人"),
  dueDate: z.string().trim().refine(isISODate, "請選擇期限"),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
});
export type VideoInput = z.input<typeof videoSchema>;

function parse(input: VideoInput) {
  const p = videoSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "資料格式錯誤", p.error.flatten().fieldErrors as Record<string, string[]>);
  return p.data;
}

async function assertActiveUser(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!u?.isActive) throw new ValidationError("負責人帳號不存在或已停用", { responsibleUserId: ["請重新選擇負責人"] });
}

async function nextVideoCode(): Promise<string> {
  const rows = await prisma.schoolCase.findMany({ where: { projectCode: { startsWith: "VIDEO-" } }, select: { projectCode: true } });
  const max = Math.max(0, ...rows.map((r) => Number(/^VIDEO-(\d+)/.exec(r.projectCode)?.[1] ?? 0)));
  return `VIDEO-${String(max + 1).padStart(3, "0")}`;
}

export async function listVideos(user: AuthUser) {
  const rows = await prisma.schoolCase.findMany({
    where: { AND: [caseAccessWhere(user), { caseType: "RESULT_VIDEO" }] },
    include: {
      responsibleUser: { select: { id: true, name: true } },
      tasks: {
        where: { taskType: { in: user.role === "ADMIN" ? ["RESULT_VIDEO", "RESULT_VIDEO_DRAFT"] : ["RESULT_VIDEO"] } },
        select: { id: true, taskType: true, status: true, calculatedDueDate: true, overrideDueDate: true, actualCompletedAt: true },
      },
      documents: { select: { id: true, status: true }, orderBy: { createdAt: "desc" } },
    },
  });
  return rows
    .map((r) => ({ ...r, task: r.tasks.find((t) => t.taskType === "RESULT_VIDEO") ?? null, draft: r.tasks.find((t) => t.taskType === "RESULT_VIDEO_DRAFT") ?? null }))
    .sort((a, b) => (a.resultVideoDueDate?.getTime() ?? Infinity) - (b.resultVideoDueDate?.getTime() ?? Infinity));
}

export async function createVideo(user: AuthUser, input: VideoInput) {
  assertAdmin(user);
  const p = parse(input);
  await assertActiveUser(p.responsibleUserId);
  const projectCode = await nextVideoCode();
  return prisma.$transaction(async (tx) => {
    const c = await tx.schoolCase.create({
      data: {
        caseType: "RESULT_VIDEO",
        projectCode,
        projectName: p.projectName,
        schoolName: p.schoolName,
        district: p.district,
        responsibleUserId: p.responsibleUserId,
        resultVideoDueDate: isoToDbDate(p.dueDate),
        notes: p.notes,
      },
    });
    await syncCaseTasks(c.id, { actorId: user.id, source: "CASE_CREATED", reason: "新增成果影片", db: tx });
    await writeAudit({ actorId: user.id, action: "CASE_CREATE", entityType: "SchoolCase", entityId: c.id, summary: `新增成果影片 ${p.schoolName}（期限 ${p.dueDate}）` }, tx);
    return c;
  });
}

export async function updateVideo(user: AuthUser, id: string, input: VideoInput & { reason?: string }) {
  assertAdmin(user);
  const p = parse(input);
  const existing = await prisma.schoolCase.findFirst({ where: { id, caseType: "RESULT_VIDEO" } });
  if (!existing) throw new NotFoundError("找不到此成果影片");
  if (p.responsibleUserId !== existing.responsibleUserId) await assertActiveUser(p.responsibleUserId);
  return prisma.$transaction(async (tx) => {
    const c = await tx.schoolCase.update({
      where: { id },
      data: { projectName: p.projectName, schoolName: p.schoolName, district: p.district, responsibleUserId: p.responsibleUserId, resultVideoDueDate: isoToDbDate(p.dueDate), notes: p.notes },
    });
    await syncCaseTasks(id, { actorId: user.id, source: "CASE_DATE_CHANGE", reason: input.reason?.trim() || "更新成果影片", db: tx });
    await tx.task.updateMany({ where: { caseId: id, taskType: "RESULT_VIDEO", status: { not: "COMPLETED" } }, data: { assignedUserId: p.responsibleUserId } });
    await writeAudit({ actorId: user.id, action: "CASE_UPDATE", entityType: "SchoolCase", entityId: id, summary: `更新成果影片 ${p.schoolName}（期限 ${p.dueDate}）` }, tx);
    return c;
  });
}
