-- CreateEnum
CREATE TYPE "TestEmailProvider" AS ENUM ('MAILSLURP', 'CLERK_TEST_EMAIL');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#4B90FF',
                        ADD COLUMN "test_user_email" TEXT,
                        ADD COLUMN "test_user_password" TEXT,
                        ADD COLUMN "test_email_provider" "TestEmailProvider";
