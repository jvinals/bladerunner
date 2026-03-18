import { Controller, Get, Post, Param, Query, Body, NotFoundException, UseGuards, Req } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RunsService } from './runs.service';
import { CreateRunDto, RunQueryDto } from './runs.dto';

@ApiTags('runs')
@Controller('runs')
@UseGuards(ClerkAuthGuard)
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Get()
  @ApiOperation({ summary: 'List all runs with optional filtering' })
  @ApiResponse({ status: 200, description: 'Paginated list of runs' })
  @ApiQuery({ name: 'status', required: false, enum: ['queued', 'running', 'passed', 'failed', 'needs_review', 'cancelled'] })
  @ApiQuery({ name: 'platform', required: false, enum: ['desktop', 'mobile', 'pwa'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  findAll(@Req() req: any, @Query() query: RunQueryDto) {
    const userId = req.user.sub;
    return this.runsService.findAll(userId, query);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard KPI metrics' })
  @ApiResponse({ status: 200, description: 'Dashboard KPI data' })
  getDashboard(@Req() req: any) {
    const userId = req.user.sub;
    return this.runsService.getDashboardKpis(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single run by ID' })
  @ApiResponse({ status: 200, description: 'Run details' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  findOne(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    const run = this.runsService.findOne(id, userId);
    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    return run;
  }

  @Get(':id/findings')
  @ApiOperation({ summary: 'Get findings for a run' })
  @ApiResponse({ status: 200, description: 'List of findings' })
  findFindings(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.runsService.findFindings(id, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new run' })
  @ApiResponse({ status: 201, description: 'Run created successfully' })
  create(@Req() req: any, @Body() createRunDto: CreateRunDto) {
    const userId = req.user.sub;
    return this.runsService.create(userId, createRunDto);
  }
}
