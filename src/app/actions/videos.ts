"use server";
import { requireAdminForAction } from "@/lib/auth";
import { runAction } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/server/errors";
import { deleteCase } from "@/server/cases/case-service";
import { createVideo, updateVideo, type VideoInput } from "@/server/videos/video-service";

export async function createVideoAction(input: VideoInput) {
  return runAction(async () => {
    await createVideo(await requireAdminForAction(), input);
  }, "已新增成果影片");
}

export async function updateVideoAction(id: string, input: VideoInput) {
  return runAction(async () => {
    await updateVideo(await requireAdminForAction(), id, input);
  }, "成果影片已更新");
}

export async function deleteVideoAction(id: string) {
  return runAction(async () => {
    const user = await requireAdminForAction();
    const v = await prisma.schoolCase.findFirst({ where: { id, caseType: "RESULT_VIDEO" }, select: { projectCode: true } });
    if (!v) throw new NotFoundError("找不到此成果影片");
    // 已於刪除視窗確認，連同成果影片公文一併刪除
    await deleteCase(user, id, { confirmCode: v.projectCode });
  }, "已刪除成果影片");
}
