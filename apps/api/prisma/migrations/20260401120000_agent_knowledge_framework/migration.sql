-- CreateEnum
CREATE TYPE "ProjectDiscoveryStatus" AS ENUM ('idle', 'queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "user_agent_context" (
    "user_id" TEXT NOT NULL,
    "general_instructions" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_agent_context_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "project_agent_knowledge" (
    "project_id" TEXT NOT NULL,
    "manual_instructions" TEXT,
    "discovery_status" "ProjectDiscoveryStatus" NOT NULL DEFAULT 'idle',
    "discovery_started_at" TIMESTAMP(3),
    "discovery_completed_at" TIMESTAMP(3),
    "discovery_error" TEXT,
    "discovery_summary_markdown" TEXT,
    "discovery_structured" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_agent_knowledge_pkey" PRIMARY KEY ("project_id")
);

-- AddForeignKey
ALTER TABLE "project_agent_knowledge" ADD CONSTRAINT "project_agent_knowledge_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
