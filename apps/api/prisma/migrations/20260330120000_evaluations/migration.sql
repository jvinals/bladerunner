-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvaluationStepDecision" AS ENUM ('retry', 'advance', 'ask_human', 'finish');

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Evaluation',
    "url" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "desired_output" TEXT NOT NULL,
    "progress_summary" TEXT,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_steps" (
    "id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "page_url" TEXT,
    "thinking_text" TEXT,
    "proposed_code" TEXT,
    "expected_outcome" TEXT,
    "actual_outcome" TEXT,
    "error_message" TEXT,
    "decision" "EvaluationStepDecision",
    "analyzer_rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_questions" (
    "id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "step_sequence" INTEGER,
    "prompt" TEXT NOT NULL,
    "options_json" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "selected_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),

    CONSTRAINT "evaluation_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_reports" (
    "id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'markdown',
    "content" TEXT NOT NULL,
    "structured_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluations_user_id_idx" ON "evaluations"("user_id");

-- CreateIndex
CREATE INDEX "evaluations_user_id_created_at_idx" ON "evaluations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "evaluation_steps_evaluation_id_sequence_idx" ON "evaluation_steps"("evaluation_id", "sequence");

-- CreateIndex
CREATE INDEX "evaluation_questions_evaluation_id_idx" ON "evaluation_questions"("evaluation_id");

-- CreateIndex
CREATE INDEX "evaluation_reports_evaluation_id_idx" ON "evaluation_reports"("evaluation_id");

-- AddForeignKey
ALTER TABLE "evaluation_steps" ADD CONSTRAINT "evaluation_steps_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_questions" ADD CONSTRAINT "evaluation_questions_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_reports" ADD CONSTRAINT "evaluation_reports_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
