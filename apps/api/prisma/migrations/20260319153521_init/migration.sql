-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RECORDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('DESKTOP', 'MOBILE', 'PWA');

-- CreateEnum
CREATE TYPE "StepAction" AS ENUM ('NAVIGATE', 'CLICK', 'TYPE', 'SCROLL', 'SELECT', 'HOVER', 'SCREENSHOT', 'ASSERT', 'WAIT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StepOrigin" AS ENUM ('MANUAL', 'AI_DRIVEN');

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RECORDING',
    "platform" "Platform" NOT NULL DEFAULT 'DESKTOP',
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "action" "StepAction" NOT NULL,
    "selector" TEXT,
    "value" TEXT,
    "instruction" TEXT NOT NULL,
    "playwright_code" TEXT NOT NULL,
    "origin" "StepOrigin" NOT NULL DEFAULT 'MANUAL',
    "duration_ms" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_recordings" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'webm',
    "url" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runs_user_id_idx" ON "runs"("user_id");

-- CreateIndex
CREATE INDEX "run_steps_run_id_idx" ON "run_steps"("run_id");

-- CreateIndex
CREATE INDEX "run_steps_user_id_idx" ON "run_steps"("user_id");

-- CreateIndex
CREATE INDEX "run_recordings_run_id_idx" ON "run_recordings"("run_id");

-- AddForeignKey
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_recordings" ADD CONSTRAINT "run_recordings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
