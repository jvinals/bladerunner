-- AlterTable
ALTER TABLE "run_steps" ADD COLUMN "excluded_from_playback" BOOLEAN NOT NULL DEFAULT false;
