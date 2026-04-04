-- CreateEnum
CREATE TYPE "EvaluationStepKind" AS ENUM ('LLM', 'ORCHESTRATOR_NAVIGATE', 'ORCHESTRATOR_AUTO_SIGN_IN');

-- AlterTable
ALTER TABLE "evaluation_steps" ADD COLUMN "step_kind" "EvaluationStepKind" NOT NULL DEFAULT 'LLM';

-- AlterTable
ALTER TABLE "project_agent_knowledge" ADD COLUMN "discovery_steps_json" JSONB;
