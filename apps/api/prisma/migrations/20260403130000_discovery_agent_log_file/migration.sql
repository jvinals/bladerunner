-- Persist basename of the last discovery agent log file (docs/logs/*.log).
ALTER TABLE "project_agent_knowledge" ADD COLUMN "discovery_agent_log_file" TEXT;
