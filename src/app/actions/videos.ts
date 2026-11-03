"use server";
import { requireAdminForAction } from "@/lib/auth";
import { runAction } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/server/errors";
import { deleteCase } from "@/server/cases/case-service";
import { isStandaloneKind, STANDALONE_KINDS, type StandaloneKind } from "@/server/videos/standalone-kinds";
import { createVideo, updateVideo, type VideoInput } from "@/server/videos/video-service";

function kindOf(kind: StandaloneKind) {
  if (!isStandaloneKind(kind)) throw new ValidationError("項目類型錯誤");
  return STANDALONE_KINDS[kind];
}

export async function createVideoAction(input: VideoInput, kind: StandaloneKind = "RESULT_VIDEO") {
  return runAction(async () => {
    kindOf(kind);
    await createVideo(await requireAdminForAction(), input, kind);
  }, `已新增${STANDALONE_KINDS[kind]?.label ?? ""}`);
}

export async function updateVideoAction(id: string, input: VideoInput, kind: StandaloneKind = "RESULT_VIDEO") {
  return runAction(async () => {
    kindOf(kind);
    await updateVideo(await requireAdminForAction(), id, input, kind);
  }, `${STANDALONE_KINDS[kind]?.label ?? ""}已更新`);
}

export async function deleteVideoAction(id: string, kind: StandaloneKind = "RESULT_VIDEO") {
  return runAction(async () => {
    const k = kindOf(kind);
    const user = await requireAdminForAction();
    const v = await prisma.schoolCase.findFirst({ where: { id, caseType: kind }, select: { projectCode: true } });
    if (!v) throw new NotFoundError(`找不到此${k.label}`);
    // 已於刪除視窗確認，連同公文一併刪除
    await deleteCase(user, id, { confirmCode: v.projectCode });
  }, `已刪除${STANDALONE_KINDS[kind]?.label ?? ""}`);
}
