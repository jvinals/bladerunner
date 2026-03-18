import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AgentsService } from './agents.service';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all agents' })
  @ApiResponse({ status: 200, description: 'List of registered agents' })
  findAll() {
    return this.agentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an agent by ID' })
  @ApiResponse({ status: 200, description: 'Agent details' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  findOne(@Param('id') id: string) {
    const agent = this.agentsService.findOne(id);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} not found`);
    }
    return agent;
  }
}
