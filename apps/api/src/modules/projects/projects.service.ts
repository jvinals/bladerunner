import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    return this.prisma.project.findFirst({
      where: { id, userId },
    });
  }

  async create(userId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        userId,
        name: dto.name.trim(),
        kind: dto.kind ?? 'WEB',
        url: dto.url?.trim() || null,
        artifactUrl: dto.artifactUrl?.trim() || null,
      },
    });
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
      },
    });
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id, userId);
    if (!existing) throw new NotFoundException(`Project ${id} not found`);
    await this.prisma.project.delete({ where: { id } });
  }
}
