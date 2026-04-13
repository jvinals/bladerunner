import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { NavigationsService } from './navigations.service';
import { NavigationPlayService } from './navigation-play.service';
import { SkyvernClientError } from './skyvern-client.service';
import {
  CreateNavigationDto,
  ImproveNavigationActionInstructionDto,
  NavigationPlayStartDto,
  PatchNavigationActionDto,
  UpdateNavigationDto,
} from './navigations.dto';

@ApiTags('navigations')
@Controller('navigations')
@UseGuards(ClerkAuthGuard)
export class NavigationsController {
  constructor(
    private readonly navigations: NavigationsService,
    private readonly navigationPlay: NavigationPlayService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List navigations' })
  list(@Req() req: { user: { sub: string } }) {
    return this.navigations.findAll(req.user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Create navigation' })
  create(@Req() req: { user: { sub: string } }, @Body() dto: CreateNavigationDto) {
    return this.navigations.create(req.user.sub, {
      name: dto.name,
      url: dto.url,
      intent: dto.intent,
      desiredOutput: dto.desiredOutput,
      projectId: dto.projectId,
      autoSignIn: dto.autoSignIn,
      autoSignInClerkOtpMode: dto.autoSignInClerkOtpMode ?? null,
    });
  }

  @Get(':id/recording-session')
  @ApiOperation({ summary: 'Live recording/play session flags for Continue recording UI' })
  recordingSession(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.navigations.getLiveSessions(id, req.user.sub);
  }

  @Post(':id/actions/improve-instruction')
  @ApiOperation({ summary: 'LLM-improve a draft action instruction for Skyvern navigation_goal' })
  improveActionInstruction(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() dto: ImproveNavigationActionInstructionDto,
  ) {
    return this.navigations.improveActionInstruction(id, req.user.sub, dto);
  }

  @Patch(':id/actions/:sequence')
  @ApiOperation({
    summary:
      'Update one recorded step — optional action_instruction, action_type, input_value, input_mode (at least one)',
  })
  patchNavigationAction(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Param('sequence', ParseIntPipe) sequence: number,
    @Body() dto: PatchNavigationActionDto,
  ) {
    return this.navigations.patchNavigationAction(id, req.user.sub, sequence, dto);
  }

  @Delete(':id/actions/:sequence')
  @ApiOperation({ summary: 'Delete one recorded step and renumber remaining actions' })
  deleteNavigationAction(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Param('sequence', ParseIntPipe) sequence: number,
  ) {
    return this.navigations.deleteNavigationAction(id, req.user.sub, sequence);
  }

  @Post(':id/play/start')
  @ApiOperation({ summary: 'Start Skyvern workflow run against browser-worker CDP' })
  async playStart(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() body: NavigationPlayStartDto,
  ) {
    try {
      return await this.navigationPlay.startPlay(id, req.user.sub, body?.parameters);
    } catch (err) {
      if (err instanceof SkyvernClientError) {
        throw new BadGatewayException(err.message);
      }
      throw err;
    }
  }

  @Post(':id/play/stop')
  @ApiOperation({ summary: 'Cancel Skyvern play run' })
  playStop(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.navigationPlay.stopPlay(id, req.user.sub);
  }

  @Get(':id/skyvern-workflow')
  @ApiOperation({ summary: 'Get Skyvern workflow definition JSON (same payload as Play sync)' })
  getSkyvernWorkflow(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.navigationPlay.getSkyvernWorkflowDefinition(id, req.user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get navigation' })
  findOne(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.navigations.findOne(id, req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update navigation fields' })
  patch(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateNavigationDto,
  ) {
    return this.navigations.updateFields(id, req.user.sub, {
      name: dto.name,
      intent: dto.intent,
      desiredOutput: dto.desiredOutput,
      projectId: dto.projectId,
      autoSignIn: dto.autoSignIn,
      autoSignInClerkOtpMode: dto.autoSignInClerkOtpMode,
      runMode: dto.runMode,
    });
  }
}
