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
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';

@ApiTags('projects')
@Controller('projects')
@UseGuards(ClerkAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

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
