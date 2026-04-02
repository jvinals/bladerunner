import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { CreateProjectDto, PatchAgentKnowledgeDto, UpdateProjectDto } from './projects.dto';
import { ProjectDiscoveryService } from './project-discovery.service';

const PROJECT_COLORS = [
  '#4B90FF', '#56A34A', '#EAB508', '#E05252',
  '#9333EA', '#F97316', '#06B6D4', '#EC4899',
  '#8B5CF6', '#14B8A6', '#84CC16', '#6366F1',
];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectDiscovery: ProjectDiscoveryService,
    private readonly recording: RecordingService,
  ) {}

  findAll(userId: string) {
    return this.prisma.project
      .findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { agentKnowledge: { select: { discoveryAgentLogFile: true } } },
      })
      .then((rows) =>
        rows.map(({ agentKnowledge, ...p }) => ({
          ...p,
          discoveryAgentLogFile: agentKnowledge?.discoveryAgentLogFile ?? null,
        })),
      );
  }

  async findOne(id: string, userId: string) {
    return this.prisma.project.findFirst({
      where: { id, userId },
    });
  }

  async create(userId: string, dto: CreateProjectDto) {
    const color = dto.color ?? await this.nextColor(userId);
    return this.prisma.project.create({
      data: {
        userId,
        name: dto.name.trim(),
        kind: dto.kind ?? 'WEB',
        url: dto.url?.trim() || null,
        artifactUrl: dto.artifactUrl?.trim() || null,
        color,
        testUserEmail: dto.testUserEmail?.trim() || null,
        testUserPassword: dto.testUserPassword || null,
        testEmailProvider: dto.testEmailProvider ?? null,
      },
    });
  }

  private async nextColor(userId: string): Promise<string> {
    const count = await this.prisma.project.count({ where: { userId } });
    return PROJECT_COLORS[count % PROJECT_COLORS.length];
  }

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    const existing = await this.findOne(id, userId);
    if (!existing) throw new NotFoundException(`Project ${id} not found`);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.kind != null ? { kind: dto.kind } : {}),
        ...(dto.url !== undefined ? { url: dto.url?.trim() || null } : {}),
        ...(dto.artifactUrl !== undefined ? { artifactUrl: dto.artifactUrl?.trim() || null } : {}),
        ...(dto.color != null ? { color: dto.color } : {}),
        ...(dto.testUserEmail !== undefined ? { testUserEmail: dto.testUserEmail?.trim() || null } : {}),
        ...(dto.testUserPassword !== undefined ? { testUserPassword: dto.testUserPassword || null } : {}),
        ...(dto.testEmailProvider !== undefined ? { testEmailProvider: dto.testEmailProvider ?? null } : {}),
      },
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id, userId);
    if (!existing) throw new NotFoundException(`Project ${id} not found`);
    await this.prisma.project.delete({ where: { id } });
  }

  async getAgentKnowledge(id: string, userId: string) {
    const existing = await this.findOne(id, userId);
    if (!existing) throw new NotFoundException(`Project ${id} not found`);
    let k = await this.prisma.projectAgentKnowledge.findUnique({ where: { projectId: id } });
    const st = k?.discoveryStatus;
    const looksActive = st === 'queued' || st === 'running';
    const busyHere = this.projectDiscovery.isDiscoveryBusy(id);
    if (looksActive && !busyHere) {
      const errMsg =
        'Discovery was interrupted (server restart or process ended). Run app discovery again.';
      k = await this.prisma.projectAgentKnowledge.update({
        where: { projectId: id },
        data: {
          discoveryStatus: 'failed',
          discoveryCompletedAt: new Date(),
          discoveryError: errMsg,
        },
      });
    }
    return {
      projectId: id,
      manualInstructions: k?.manualInstructions ?? null,
      discoveryStatus: k?.discoveryStatus ?? 'idle',
      discoveryStartedAt: k?.discoveryStartedAt?.toISOString() ?? null,
      discoveryCompletedAt: k?.discoveryCompletedAt?.toISOString() ?? null,
      discoveryError: k?.discoveryError ?? null,
      discoverySummaryMarkdown: k?.discoverySummaryMarkdown ?? null,
      discoveryStructured: k?.discoveryStructured ?? null,
      discoveryNavigationMermaid: k?.discoveryNavigationMermaid ?? null,
      discoveryAgentLogFile: k?.discoveryAgentLogFile ?? null,
      updatedAt: k?.updatedAt?.toISOString() ?? null,
    };
  }

  /** NDJSON discovery agent log from `docs/logs/` (last completed or failed run). */
  async getDiscoveryAgentLog(projectId: string, userId: string) {
    const existing = await this.findOne(projectId, userId);
    if (!existing) throw new NotFoundException(`Project ${projectId} not found`);
    const k = await this.prisma.projectAgentKnowledge.findUnique({
      where: { projectId },
      select: { discoveryAgentLogFile: true },
    });
    const basename = k?.discoveryAgentLogFile?.trim();
    if (!basename) {
      throw new NotFoundException('No discovery agent log file recorded yet for this project');
    }
    const lines = await this.recording.readDiscoveryAgentLogFile(basename);
    return { filename: basename, lines };
  }

  async patchAgentKnowledge(id: string, userId: string, dto: PatchAgentKnowledgeDto) {
    const existing = await this.findOne(id, userId);
    if (!existing) throw new NotFoundException(`Project ${id} not found`);
    const manual = dto.manualInstructions;
    if (manual != null && manual.length > 16_000) {
      throw new BadRequestException('manualInstructions exceeds maximum length');
    }
    const discMd = dto.discoverySummaryMarkdown;
    if (discMd != null && discMd.length > 120_000) {
      throw new BadRequestException('discoverySummaryMarkdown exceeds maximum length');
    }
    const discMermaid = dto.discoveryNavigationMermaid;
    if (discMermaid != null && discMermaid.length > 500_000) {
      throw new BadRequestException('discoveryNavigationMermaid exceeds maximum length');
    }
    await this.prisma.projectAgentKnowledge.upsert({
      where: { projectId: id },
      create: {
        projectId: id,
        ...(manual !== undefined ? { manualInstructions: manual } : {}),
        ...(discMd !== undefined ? { discoverySummaryMarkdown: discMd } : {}),
        ...(dto.discoveryStructured !== undefined
          ? {
              discoveryStructured:
                dto.discoveryStructured === null ? Prisma.JsonNull : (dto.discoveryStructured as object),
            }
          : {}),
        ...(discMermaid !== undefined ? { discoveryNavigationMermaid: discMermaid } : {}),
      },
      update: {
        ...(manual !== undefined ? { manualInstructions: manual } : {}),
        ...(discMd !== undefined ? { discoverySummaryMarkdown: discMd } : {}),
        ...(dto.discoveryStructured !== undefined
          ? {
              discoveryStructured:
                dto.discoveryStructured === null ? Prisma.JsonNull : (dto.discoveryStructured as object),
            }
          : {}),
        ...(discMermaid !== undefined ? { discoveryNavigationMermaid: discMermaid } : {}),
      },
    });
    return this.getAgentKnowledge(id, userId);
  }
}
