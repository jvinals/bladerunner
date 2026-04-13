-- CreateTable
CREATE TABLE "navigations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Navigation',
    "url" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "desired_output" TEXT NOT NULL,
    "progress_summary" TEXT,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'QUEUED',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_message" TEXT,
    "run_mode" "EvaluationRunMode" NOT NULL DEFAULT 'continuous',
    "auto_sign_in" BOOLEAN NOT NULL DEFAULT false,
    "auto_sign_in_clerk_otp_mode" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "navigations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "navigations_user_id_idx" ON "navigations"("user_id");

-- CreateIndex
CREATE INDEX "navigations_user_id_created_at_idx" ON "navigations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "navigations_project_id_idx" ON "navigations"("project_id");

-- AddForeignKey
ALTER TABLE "navigations" ADD CONSTRAINT "navigations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
