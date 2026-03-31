import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { EvaluationsService } from './evaluations.service';
import { EvaluationOrchestratorService } from './evaluation-orchestrator.service';
import { AnswerHumanDto, CreateEvaluationDto, UpdateEvaluationDto } from './evaluations.dto';
import { RecordingService } from '../recording/recording.service';

@ApiTags('evaluations')
@Controller('evaluations')
@UseGuards(ClerkAuthGuard)
export class EvaluationsController {
  constructor(
    private readonly evaluations: EvaluationsService,
    private readonly orchestrator: EvaluationOrchestratorService,
    private readonly recording: RecordingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List evaluations' })
  list(@Req() req: { user: { sub: string } }) {
    return this.evaluations.findAll(req.user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Create evaluation (queued)' })
  create(@Req() req: { user: { sub: string } }, @Body() dto: CreateEvaluationDto) {
    return this.evaluations.create(req.user.sub, {
      name: dto.name,
      url: dto.url,
      intent: dto.intent,
      desiredOutput: dto.desiredOutput,
      projectId: dto.projectId,
      autoSignIn: dto.autoSignIn,
      autoSignInClerkOtpMode: dto.autoSignInClerkOtpMode ?? null,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get evaluation with steps, questions, latest report' })
  findOne(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.evaluations.findOne(id, req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update name, intent, and/or desired output (not while RUNNING)' })
  patch(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateEvaluationDto,
  ) {
    return this.evaluations.updateFields(id, req.user.sub, {
      name: dto.name,
      intent: dto.intent,
      desiredOutput: dto.desiredOutput,
      projectId: dto.projectId,
      autoSignIn: dto.autoSignIn,
      autoSignInClerkOtpMode: dto.autoSignInClerkOtpMode,
    });
  }

  @Post(':id/reprocess')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Clear prior run artifacts and queue a new autonomous run (failed, completed, cancelled, or waiting for human)',
  })
  async reprocess(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    const userId = req.user.sub;
    await this.recording.stopEvaluationSession(id, userId).catch(() => {});
    await this.evaluations.resetForReprocess(id, userId);
    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3619df' },
      body: JSON.stringify({
        sessionId: '3619df',
        hypothesisId: 'H3',
        location: 'evaluations.controller.ts:reprocess',
        message: 'reprocess after resetForReprocess',
        data: { evaluationId: id },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const scheduled = this.orchestrator.scheduleRun(id, userId);
    return { accepted: true, scheduled, evaluationId: id };
  }

  @Post(':id/start')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start autonomous evaluation run (async)' })
  start(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    const scheduled = this.orchestrator.scheduleRun(id, req.user.sub);
    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3619df' },
      body: JSON.stringify({
        sessionId: '3619df',
        hypothesisId: 'H4',
        location: 'evaluations.controller.ts:start',
        message: 'POST /evaluations/:id/start',
        data: { evaluationId: id, scheduled },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return { accepted: true, scheduled, evaluationId: id };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel evaluation' })
  async cancel(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    const userId = req.user.sub;
    try {
      await this.evaluations.findOne(id, userId);
    } catch {
      throw new NotFoundException();
    }
    await this.evaluations.updateStatus(id, userId, 'CANCELLED', { completedAt: new Date() });
    await this.recording.stopEvaluationSession(id, userId);
    return { ok: true };
  }

  @Post(':id/human-answer')
  @HttpCode(202)
  @ApiOperation({ summary: 'Answer pending human verification question' })
  humanAnswer(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() dto: AnswerHumanDto,
  ) {
    void this.orchestrator.resumeAfterHumanAnswer(id, req.user.sub, dto.questionId, dto.selectedIndex);
    return { accepted: true, evaluationId: id };
  }
}
