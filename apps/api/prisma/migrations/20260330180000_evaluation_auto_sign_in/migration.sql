-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN "auto_sign_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "evaluations" ADD COLUMN "auto_sign_in_clerk_otp_mode" TEXT;
