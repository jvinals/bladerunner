CREATE TABLE "ai_visual_id_tests" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "step_sequence" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "page_url" TEXT,
  "screenshot_path" TEXT NOT NULL,
  "context_path" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_visual_id_tests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_visual_id_tests_run_id_created_at_idx"
ON "ai_visual_id_tests"("run_id", "created_at" DESC);

CREATE INDEX "ai_visual_id_tests_user_id_created_at_idx"
ON "ai_visual_id_tests"("user_id", "created_at" DESC);

ALTER TABLE "ai_visual_id_tests"
ADD CONSTRAINT "ai_visual_id_tests_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
