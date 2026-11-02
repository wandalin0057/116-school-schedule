"use server";
import { requireAdminForAction } from "@/lib/auth";
import { runAction } from "@/lib/action-result";
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
  return runAction(async () => deleteCase(await requireAdminForAction(), id), "已刪除成果影片");
}
