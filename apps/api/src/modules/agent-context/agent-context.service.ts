import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AgentContextBundle = {
  general: string;
  projectManual: string;
};

const MAX_GENERAL = 16_000;
const MAX_MANUAL = 16_000;

@Injectable()
export class AgentContextService {
  private readonly logger = new Logger(AgentContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single block for vision/codegen prompts (merge order: general → manual).
   * Discovery outputs (summary, structured map, Mermaid) are never sent to LLMs.
   */
  async getPromptInjectionBlock(userId: string, projectId: string | null | undefined): Promise<string> {
    const bundle = await this.loadBundle(userId, projectId);
    return this.formatPromptBlock(bundle);
  }

  /**
   * Structured fields for optimized-prompt `appContext` JSON (no discovery fields).
   */
  async getAppContextKnowledgeFields(
    userId: string,
    projectId: string | null | undefined,
  ): Promise<{ general: string; projectManual: string }> {
    const b = await this.loadBundle(userId, projectId);
    return {
      general: b.general,
      projectManual: b.projectManual,
    };
  }

  formatPromptBlock(bundle: AgentContextBundle): string {
    const parts: string[] = [];
    if (bundle.general.trim()) {
      parts.push(`General (user workspace):\n${bundle.general.trim()}`);
    }
    if (bundle.projectManual.trim()) {
      parts.push(`Project manual notes:\n${bundle.projectManual.trim()}`);
    }
    return parts.join('\n\n---\n\n');
  }

  private async loadBundle(userId: string, projectId: string | null | undefined): Promise<AgentContextBundle> {
    const userRow = await this.prisma.userAgentContext.findUnique({ where: { userId } }).catch(() => null);
    const general = truncate(userRow?.generalInstructions ?? '', MAX_GENERAL);
    if (general.length < (userRow?.generalInstructions?.length ?? 0)) {
      this.logger.log(`Agent context: truncated general instructions for user (chars=${MAX_GENERAL})`);
    }

    if (!projectId?.trim()) {
      return { general, projectManual: '' };
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId.trim(), userId },
      include: { agentKnowledge: true },
    });
    if (!project) {
      return { general, projectManual: '' };
    }

    const k = project.agentKnowledge;
    const rawManual = k?.manualInstructions ?? '';
    const projectManual = truncate(rawManual, MAX_MANUAL);
    if (projectManual.length < rawManual.length) {
      this.logger.log(`Agent context: truncated project manual for project ${projectId} (chars=${MAX_MANUAL})`);
    }

    return { general, projectManual };
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n… [truncated]`;
}
