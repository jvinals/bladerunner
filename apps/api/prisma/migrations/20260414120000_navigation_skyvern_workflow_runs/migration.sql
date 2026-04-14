-- CreateEnum
CREATE TYPE "SkyvernWorkflowRunLifecycleStatus" AS ENUM ('created', 'queued', 'running', 'timed_out', 'failed', 'terminated', 'completed', 'canceled');

-- CreateTable
CREATE TABLE "navigation_skyvern_workflow_runs" (
    "id" TEXT NOT NULL,
    "navigation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "skyvern_run_id" TEXT NOT NULL,
    "skyvern_workflow_permanent_id" TEXT NOT NULL,
    "run_started_at" TIMESTAMP(3) NOT NULL,
    "last_status" "SkyvernWorkflowRunLifecycleStatus" NOT NULL,
    "finished_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "browser_mode" TEXT NOT NULL,
    "skyvern_run_snapshot_json" JSONB,
    "skyvern_timeline_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "navigation_skyvern_workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "navigation_skyvern_workflow_run_blocks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "block_index" INTEGER NOT NULL,
    "skyvern_block_label" TEXT NOT NULL,
    "navigation_action_sequence" INTEGER,
    "skyvern_timeline_status" TEXT,
    "skyvern_block_started_at" TIMESTAMP(3),
    "skyvern_block_completed_at" TIMESTAMP(3),
    "exclusive_app_duration_ms" INTEGER,
    "metrics_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "navigation_skyvern_workflow_run_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "navigation_skyvern_workflow_runs_skyvern_run_id_key" ON "navigation_skyvern_workflow_runs"("skyvern_run_id");

-- CreateIndex
CREATE INDEX "navigation_skyvern_workflow_runs_navigation_id_run_started_at_idx" ON "navigation_skyvern_workflow_runs"("navigation_id", "run_started_at" DESC);

-- CreateIndex
CREATE INDEX "navigation_skyvern_workflow_runs_user_id_idx" ON "navigation_skyvern_workflow_runs"("user_id");

-- CreateIndex
CREATE INDEX "navigation_skyvern_workflow_run_blocks_run_id_idx" ON "navigation_skyvern_workflow_run_blocks"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "navigation_skyvern_workflow_run_blocks_run_id_block_index_key" ON "navigation_skyvern_workflow_run_blocks"("run_id", "block_index");

-- AddForeignKey
ALTER TABLE "navigation_skyvern_workflow_runs" ADD CONSTRAINT "navigation_skyvern_workflow_runs_navigation_id_fkey" FOREIGN KEY ("navigation_id") REFERENCES "navigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigation_skyvern_workflow_run_blocks" ADD CONSTRAINT "navigation_skyvern_workflow_run_blocks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "navigation_skyvern_workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
