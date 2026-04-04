import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AgentContextBundle = {
  general: string;
  projectManual: string;
  /**
   * Screens visited (from stored markdown), structured map excerpt, optional Mermaid.
   * Does not include the `# Discovery Summary` narrative section — that is never sent to LLMs.
   */
  discoveryInjection: string;
};

const MAX_GENERAL = 16_000;
const MAX_MANUAL = 16_000;
const MAX_DISCOVERY_MARKDOWN = 12_000;
const MAX_DISCOVERY_JSON = 8_000;
const MAX_DISCOVERY_MERMAID = 8_000;

@Injectable()
export class AgentContextService {
  private readonly logger = new Logger(AgentContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single block for vision/codegen prompts (merge order: general → manual → discovery).
   */
  async getPromptInjectionBlock(userId: string, projectId: string | null | undefined): Promise<string> {
    const bundle = await this.loadBundle(userId, projectId);
    return this.formatPromptBlock(bundle);
  }

  /**
   * Structured fields for optimized-prompt `appContext` JSON.
   * `discoveryContext` excludes the long `# Discovery Summary` markdown narrative.
   */
  async getAppContextKnowledgeFields(
    userId: string,
    projectId: string | null | undefined,
  ): Promise<{ general: string; projectManual: string; discoveryContext: string }> {
    const b = await this.loadBundle(userId, projectId);
    return {
      general: b.general,
      projectManual: b.projectManual,
      discoveryContext: b.discoveryInjection,
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
    if (bundle.discoveryInjection.trim()) {
      parts.push(
        `Project discovery (screens visited + structured map; narrative summary omitted):\n${bundle.discoveryInjection.trim()}`,
      );
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
      return { general, projectManual: '', discoveryInjection: '' };
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId.trim(), userId },
      include: { agentKnowledge: true },
    });
    if (!project) {
      return { general, projectManual: '', discoveryInjection: '' };
    }

    const k = project.agentKnowledge;
    const rawManual = k?.manualInstructions ?? '';
    const projectManual = truncate(rawManual, MAX_MANUAL);
    if (projectManual.length < rawManual.length) {
      this.logger.log(`Agent context: truncated project manual for project ${projectId} (chars=${MAX_MANUAL})`);
    }

    const rawDisc = k?.discoverySummaryMarkdown ?? '';
    const discWithoutSummaryNarrative = stripDiscoverySummarySection(rawDisc);
    const discMd = truncate(discWithoutSummaryNarrative, MAX_DISCOVERY_MARKDOWN);
    if (discMd.length < discWithoutSummaryNarrative.length) {
      this.logger.log(`Agent context: truncated discovery markdown for project ${projectId} (chars=${MAX_DISCOVERY_MARKDOWN})`);
    }

    const rawMermaid = k?.discoveryNavigationMermaid ?? '';
    const discMermaid = rawMermaid ? truncate(rawMermaid.trim(), MAX_DISCOVERY_MERMAID) : '';
    if (discMermaid && discMermaid.length < rawMermaid.length) {
      this.logger.log(`Agent context: truncated discovery Mermaid for project ${projectId} (chars=${MAX_DISCOVERY_MERMAID})`);
    }

    let discoveryInjection = discMd;
    if (k?.discoveryStructured != null) {
      let jsonStr = '';
      try {
        jsonStr = JSON.stringify(k.discoveryStructured);
      } catch {
        jsonStr = '';
      }
      if (jsonStr) {
        const ex = truncate(jsonStr, MAX_DISCOVERY_JSON);
        if (ex.length < jsonStr.length) {
          this.logger.log(`Agent context: truncated discovery JSON for project ${projectId} (chars=${MAX_DISCOVERY_JSON})`);
        }
        discoveryInjection = [discMd.trim(), `Structured map (excerpt):\n${ex}`].filter(Boolean).join('\n\n');
      }
    }
    if (discMermaid) {
      discoveryInjection = [discoveryInjection.trim(), `Navigation map (Mermaid):\n${discMermaid}`]
        .filter(Boolean)
        .join('\n\n');
    }

    return { general, projectManual, discoveryInjection };
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n… [truncated]`;
}

/** Drop the `# Discovery Summary` H1 section and everything after it (never injected into LLM prompts). */
function stripDiscoverySummarySection(markdown: string): string {
  const m = /^#\s+Discovery Summary\s*$/im.exec(markdown);
  if (!m || m.index === undefined) return markdown;
  return markdown.slice(0, m.index).trimEnd();
}
