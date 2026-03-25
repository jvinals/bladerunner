-- AlterTable
ALTER TABLE "run_steps" ADD COLUMN "recorded_playwright_code" TEXT;

-- Backfill existing rows so the current playback snippet becomes the immutable baseline.
UPDATE "run_steps"
SET "recorded_playwright_code" = "playwright_code"
WHERE "recorded_playwright_code" IS NULL;
