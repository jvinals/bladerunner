import { Controller, Get, Post, Param, Query, Body, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RunsService } from './runs.service';
import { CreateRunDto, RunQueryDto } from './runs.dto';

@ApiTags('runs')
@Controller('runs')
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
  findAll(@Query() query: RunQueryDto) {
    return this.runsService.findAll(query);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard KPI metrics' })
  @ApiResponse({ status: 200, description: 'Dashboard KPI data' })
  getDashboard() {
    return this.runsService.getDashboardKpis();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single run by ID' })
  @ApiResponse({ status: 200, description: 'Run details' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  findOne(@Param('id') id: string) {
    const run = this.runsService.findOne(id);
    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    return run;
  }

  @Get(':id/findings')
  @ApiOperation({ summary: 'Get findings for a run' })
  @ApiResponse({ status: 200, description: 'List of findings' })
  findFindings(@Param('id') id: string) {
    return this.runsService.findFindings(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new run' })
  @ApiResponse({ status: 201, description: 'Run created successfully' })
  create(@Body() createRunDto: CreateRunDto) {
    return this.runsService.create(createRunDto);
  }
}
