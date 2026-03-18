import { Controller, Get, Param, NotFoundException, UseGuards, Req } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AgentsService } from './agents.service';

@ApiTags('agents')
@Controller('agents')
@UseGuards(ClerkAuthGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all agents' })
  @ApiResponse({ status: 200, description: 'List of registered agents' })
  findAll(@Req() req: any) {
    const userId = req.user.sub;
    return this.agentsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an agent by ID' })
  @ApiResponse({ status: 200, description: 'Agent details' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  findOne(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.sub;
    const agent = this.agentsService.findOne(id, userId);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} not found`);
    }
    return agent;
  }
}
