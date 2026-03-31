-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN "project_id" TEXT;

-- CreateIndex
CREATE INDEX "evaluations_project_id_idx" ON "evaluations"("project_id");

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
