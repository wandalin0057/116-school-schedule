-- 新增獨立工項：提供成果影片（僅部分學校，依案件「成果影片期限」建立）
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'RESULT_VIDEO';
ALTER TYPE "DeadlineAnchor" ADD VALUE IF NOT EXISTS 'RESULT_VIDEO_DUE';
ALTER TABLE "SchoolCase" ADD COLUMN "resultVideoDueDate" DATE;
