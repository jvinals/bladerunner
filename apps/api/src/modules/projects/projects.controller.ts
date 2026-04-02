import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { ProjectDiscoveryService } from './project-discovery.service';
import { CreateProjectDto, PatchAgentKnowledgeDto, UpdateProjectDto } from './projects.dto';

@ApiTags('projects')
@Controller('projects')
@UseGuards(ClerkAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectDiscovery: ProjectDiscoveryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all projects for the user' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  findAll(@Req() req: { user: { sub: string } }) {
    const userId = req.user.sub;
    return this.projectsService.findAll(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  create(@Req() req: { user: { sub: string } }, @Body() dto: CreateProjectDto) {
    const userId = req.user.sub;
    return this.projectsService.create(userId, dto);
  }

  @Get(':id/agent-knowledge')
  @ApiOperation({ summary: 'Project agent knowledge (manual + discovery artifacts)' })
  async getAgentKnowledge(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    return this.projectsService.getAgentKnowledge(id, req.user.sub);
  }

  @Patch(':id/agent-knowledge')
  @ApiOperation({ summary: 'Update project manual agent instructions' })
  async patchAgentKnowledge(
    @Param('id') id: string,
    @Req() req: { user: { sub: string } },
    @Body() dto: PatchAgentKnowledgeDto,
  ) {
    return this.projectsService.patchAgentKnowledge(id, req.user.sub, dto);
  }

  @Post(':id/discovery/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel in-progress app discovery' })
  async cancelDiscovery(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    return this.projectDiscovery.cancel(id, req.user.sub);
  }

  @Post(':id/discovery')
  @HttpCode(202)
  @ApiOperation({ summary: 'Run or refresh app discovery (async)' })
  async triggerDiscovery(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    return this.projectDiscovery.trigger(id, req.user.sub);
  }

  @Get(':id/discovery/agent-log')
  @ApiOperation({ summary: 'Last persisted discovery agent log (NDJSON from docs/logs on the API host)' })
  async getDiscoveryAgentLog(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    return this.projectsService.getDiscoveryAgentLog(id, req.user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by ID' })
  @ApiResponse({ status: 200, description: 'Project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async findOne(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    const userId = req.user.sub;
    const project = await this.projectsService.findOne(id, userId);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  update(
    @Param('id') id: string,
    @Req() req: { user: { sub: string } },
    @Body() dto: UpdateProjectDto,
  ) {
    const userId = req.user.sub;
    return this.projectsService.update(id, userId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(@Param('id') id: string, @Req() req: { user: { sub: string } }) {
    const userId = req.user.sub;
    await this.projectsService.remove(id, userId);
  }
}
