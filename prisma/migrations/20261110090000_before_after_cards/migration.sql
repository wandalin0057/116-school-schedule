-- 改善前後對照圖卡改為獨立項目（每所學校＋機關另行指定之通學區）
ALTER TYPE "CaseType" ADD VALUE IF NOT EXISTS 'BEFORE_AFTER_CARDS';
ALTER TABLE "SchoolCase" ADD COLUMN "cardSource" TEXT;
