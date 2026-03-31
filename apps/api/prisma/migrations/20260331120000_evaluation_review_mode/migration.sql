-- CreateEnum
CREATE TYPE "EvaluationRunMode" AS ENUM ('continuous', 'step_review');

-- AlterEnum
ALTER TYPE "EvaluationStatus" ADD VALUE 'WAITING_FOR_REVIEW';

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN "run_mode" "EvaluationRunMode" NOT NULL DEFAULT 'continuous';

-- AlterTable
ALTER TABLE "evaluation_steps" ADD COLUMN "step_title" TEXT,
ADD COLUMN "progress_summary_before" TEXT,
ADD COLUMN "codegen_input_json" JSONB,
ADD COLUMN "codegen_output_json" JSONB,
ADD COLUMN "analyzer_input_json" JSONB,
ADD COLUMN "analyzer_output_json" JSONB;
