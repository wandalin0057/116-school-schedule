-- 成果影片改為獨立項目（不屬於通學區學校案件）
CREATE TYPE "CaseType" AS ENUM ('SCHOOL_ZONE', 'RESULT_VIDEO');
ALTER TABLE "SchoolCase" ADD COLUMN "caseType" "CaseType" NOT NULL DEFAULT 'SCHOOL_ZONE';
CREATE INDEX "SchoolCase_caseType_idx" ON "SchoolCase"("caseType");
