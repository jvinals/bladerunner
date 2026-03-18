import { Controller, Get, Param, NotFoundException, UseGuards, Req } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
@UseGuards(ClerkAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List all projects' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  findAll(@Req() req: any) {
    const userId = req.user.sub;
    return this.projectsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by ID' })
  @ApiResponse({ status: 200, description: 'Project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.sub;
    const project = this.projectsService.findOne(id, userId);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }
}
