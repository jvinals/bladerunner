-- Wall-clock duration per evaluation step (orchestrator step wall time).
ALTER TABLE "evaluation_steps" ADD COLUMN "step_duration_ms" INTEGER;
