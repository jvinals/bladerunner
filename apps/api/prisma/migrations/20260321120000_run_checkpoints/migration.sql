-- CreateTable
CREATE TABLE "run_checkpoints" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "after_step_sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "page_url" TEXT,
    "storage_state_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_checkpoints_run_id_idx" ON "run_checkpoints"("run_id");

-- CreateIndex
CREATE INDEX "run_checkpoints_user_id_idx" ON "run_checkpoints"("user_id");

-- AddForeignKey
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
