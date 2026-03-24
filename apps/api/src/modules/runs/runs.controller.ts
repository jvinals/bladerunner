import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  NotFoundException,
  UseGuards,
  Req,
  Res,
  Sse,
  Header,
  HttpCode,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { access } from 'fs/promises';
import { Response, type Request } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RunsService } from './runs.service';
import { RecordingService } from '../recording/recording.service';
import {
  StartRecordingDto,
  StopRecordingDto,
  StartPlaybackDto,
  ClerkAutoSignInRecordingDto,
  StopPlaybackDto,
  AdvancePlaybackToDto,
  InstructDto,
  ReRecordStepDto,
  PatchRunStepDto,
  RunQueryDto,
  SuggestSkipAfterChangeDto,
  BulkSkipReplayDto,
  AppendAiPromptStepRecordingDto,
  TestAiPromptStepDto,
} from './runs.dto';
import { Observable, Subject } from 'rxjs';

@ApiTags('runs')
@Controller('runs')
@UseGuards(ClerkAuthGuard)
export class RunsController {
  constructor(
    private readonly runsService: RunsService,
    private readonly recordingService: RecordingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all runs with optional filtering' })
  @ApiResponse({ status: 200, description: 'Paginated list of runs' })
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

  @Post('record/start')
  @ApiOperation({ summary: 'Start recording a new run' })
  @ApiResponse({ status: 201, description: 'Recording started' })
  async startRecording(@Req() req: any, @Body() dto: StartRecordingDto) {
    const userId = req.user.sub;
    const run = await this.recordingService.startRecording(userId, dto.name, dto.url, dto.projectId);
    return { runId: run.id, status: 'recording' };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a run and its steps' })
  @ApiResponse({ status: 204, description: 'Run deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete while recording' })
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.runsService.deleteOne(id, req.user.sub);
  }

  @Post('record/stop')
  @ApiOperation({ summary: 'Stop recording a run' })
  @ApiResponse({ status: 200, description: 'Recording stopped' })
  async stopRecording(@Req() req: any, @Body() dto: StopRecordingDto) {
    const userId = req.user.sub;
    const run = await this.recordingService.stopRecording(dto.runId, userId);
    if (!run) throw new NotFoundException('Run not found or not recording');
    return run;
  }

  @Post(':id/recording/clerk-auto-sign-in')
  @HttpCode(200)
  @ApiOperation({
    summary: 'During recording: run Clerk + MailSlurp sign-in once on the remote browser',
    description:
      'Uses API env (same as E2E). Removes any manual steps after the first navigate, then appends six canonical TYPE/CLICK steps. Requires an active recording session.',
  })
  @ApiResponse({ status: 200, description: 'Sign-in completed; last synthetic step returned' })
  @ApiResponse({ status: 400, description: 'Clerk / MailSlurp env not configured' })
  @ApiResponse({ status: 404, description: 'No active recording session' })
  @ApiResponse({ status: 503, description: 'Sign-in flow failed' })
  async clerkAutoSignInRecording(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ClerkAutoSignInRecordingDto,
  ) {
    const userId = req.user.sub;
    return this.recordingService.clerkAutoSignInDuringRecording(id, userId, {
      clerkOtpMode: dto?.clerkOtpMode,
    });
  }

  @Post(':id/recording/ai-prompt-step')
  @HttpCode(201)
  @ApiOperation({
    summary: 'During recording: append an AI prompt step',
    description:
      'Requires an active recording session. Creates a RunStep with `AI_PROMPT` origin, persists a checkpoint, and emits `step` on the recording socket.',
  })
  @ApiResponse({ status: 201, description: 'Step created' })
  @ApiResponse({ status: 400, description: 'No active recording session' })
  async appendAiPromptStepRecording(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AppendAiPromptStepRecordingDto,
  ) {
    const userId = req.user.sub;
    const step = await this.recordingService.appendAiPromptStepDuringRecording(id, userId, dto);
    return { step };
  }

  @Post('playback/stop')
  @ApiOperation({ summary: 'Stop an in-progress playback session' })
  @ApiResponse({ status: 200, description: 'Playback stopped' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async stopPlayback(@Req() req: any, @Body() dto: StopPlaybackDto) {
    const userId = req.user.sub;
    const ok = await this.recordingService.stopPlayback(dto.playbackSessionId, userId);
    if (!ok) throw new NotFoundException('Playback session not found');
    return { ok: true };
  }

  @Post('playback/pause')
  @ApiOperation({ summary: 'Pause an in-progress playback session' })
  @ApiResponse({ status: 200, description: 'Playback paused' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async pausePlayback(@Req() req: any, @Body() dto: StopPlaybackDto) {
    const userId = req.user.sub;
    const ok = await this.recordingService.pausePlayback(dto.playbackSessionId, userId);
    if (!ok) throw new NotFoundException('Playback session not found');
    return { ok: true };
  }

  @Post('playback/resume')
  @ApiOperation({ summary: 'Resume a paused playback session' })
  @ApiResponse({ status: 200, description: 'Playback resumed' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async resumePlayback(@Req() req: any, @Body() dto: StopPlaybackDto) {
    const userId = req.user.sub;
    const ok = await this.recordingService.resumePlayback(dto.playbackSessionId, userId);
    if (!ok) throw new NotFoundException('Playback session not found');
    return { ok: true };
  }

  @Post('playback/advance-one')
  @ApiOperation({ summary: 'While paused: run exactly one step, then pause again' })
  @ApiResponse({ status: 200, description: 'Playback resumed for one step' })
  @ApiResponse({ status: 400, description: 'Not paused' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async advancePlaybackOne(@Req() req: any, @Body() dto: StopPlaybackDto) {
    const userId = req.user.sub;
    const ok = await this.recordingService.resumePlaybackAfterOneStep(dto.playbackSessionId, userId);
    if (!ok) throw new NotFoundException('Playback session not found');
    return { ok: true };
  }

  @Post('playback/advance-to')
  @ApiOperation({ summary: 'While paused: run until stopAfterSequence completes, then pause' })
  @ApiResponse({ status: 200, description: 'Playback resumed' })
  @ApiResponse({ status: 400, description: 'Not paused or invalid sequence' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async advancePlaybackTo(@Req() req: any, @Body() dto: AdvancePlaybackToDto) {
    const userId = req.user.sub;
    const ok = await this.recordingService.resumePlaybackUntilSequence(
      dto.playbackSessionId,
      userId,
      dto.stopAfterSequence,
    );
    if (!ok) throw new NotFoundException('Playback session not found');
    return { ok: true };
  }

  @Post('playback/restart')
  @HttpCode(201)
  @ApiOperation({ summary: 'Stop current playback and start a new session with the same options' })
  @ApiResponse({ status: 201, description: 'New playback started' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async restartPlayback(@Req() req: any, @Body() dto: StopPlaybackDto) {
    const userId = req.user.sub;
    const result = await this.recordingService.restartPlayback(dto.playbackSessionId, userId);
    if (!result) throw new NotFoundException('Playback session not found');
    return result;
  }

  @Get('playback/:playbackSessionId')
  @ApiOperation({ summary: 'Snapshot of an active playback session (options + paused state)' })
  @ApiResponse({ status: 200, description: 'Active session snapshot' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getPlaybackSession(@Req() req: any, @Param('playbackSessionId') playbackSessionId: string) {
    const userId = req.user.sub;
    const snap = this.recordingService.getPlaybackSessionSnapshot(playbackSessionId, userId);
    if (!snap) throw new NotFoundException('Playback session not found');
    return snap;
  }

  @Post(':id/instruct')
  @ApiOperation({ summary: 'Send a natural language instruction to the active recording' })
  @ApiResponse({ status: 200, description: 'Instruction executed, step returned' })
  async instruct(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: InstructDto,
  ) {
    const userId = req.user.sub;
    const step = await this.recordingService.executeInstruction(id, userId, dto.instruction);
    return { step };
  }

  @Post(':id/steps/:stepId/re-record')
  @ApiOperation({
    summary: 'Re-capture an existing step by instruction (active recording only)',
    description: 'Executes the instruction like /instruct but updates the step row in place.',
  })
  @ApiResponse({ status: 200, description: 'Step updated' })
  @ApiResponse({ status: 404, description: 'No session or step not found' })
  async reRecordStep(
    @Req() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: ReRecordStepDto,
  ) {
    const userId = req.user.sub;
    const step = await this.recordingService.reRecordStep(id, userId, stepId, dto.instruction);
    return { step };
  }

  @Post(':id/steps/purge-skipped')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Delete all steps marked “skip replay” (excludedFromPlayback) and renumber the rest',
  })
  @ApiResponse({ status: 200, description: '{ deleted: number }' })
  async purgeSkippedSteps(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.recordingService.purgeSkippedSteps(id, userId);
  }

  @Post(':id/steps/suggest-skip-after-change')
  @HttpCode(200)
  @ApiOperation({
    summary: 'LLM: suggest forward steps to mark skip replay after a step add/edit',
    description:
      'Returns steps strictly after the anchor that are not already skipped. Empty when no LLM or nothing to suggest.',
  })
  @ApiResponse({ status: 200, description: '{ suggestions: { stepId, reason }[] }' })
  async suggestSkipAfterChange(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SuggestSkipAfterChangeDto,
  ) {
    const userId = req.user.sub;
    return this.recordingService.suggestSkipReplayAfterChange(id, userId, dto.anchorStepId);
  }

  @Post(':id/steps/bulk-skip-replay')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark multiple steps as skip replay (validated against anchor sequence)',
  })
  @ApiResponse({ status: 200, description: '{ updated: number }' })
  async bulkSkipReplay(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: BulkSkipReplayDto,
  ) {
    const userId = req.user.sub;
    return this.recordingService.bulkMarkSkipReplay(id, userId, dto.anchorStepId, dto.stepIds);
  }

  @Patch(':id/steps/:stepId')
  @ApiOperation({
    summary: 'Update step instruction and/or enable/disable AI prompt mode',
    description:
      'AI prompt steps store a human prompt; playback runs LLM + screenshot against the live DOM (not fixed codegen).',
  })
  @ApiResponse({ status: 200, description: 'Step updated' })
  async patchRunStep(
    @Req() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: PatchRunStepDto,
  ) {
    const userId = req.user.sub;
    const step = await this.recordingService.patchRunStep(id, userId, stepId, dto);
    return { step };
  }

  @Post(':id/steps/:stepId/test-ai-step')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Test an AI prompt step on the live page (recording or playback session)',
    description:
      'Runs AI prompt test: default `phase=full` is vision + LLM + codegen + execute on the page. `phase=generate` runs vision + codegen only; `phase=run` executes stored Playwright (after a successful generate for the same instruction). Optional body `instruction` overrides the stored prompt for this run only. Progress is pushed over the recording socket as `aiPromptTestProgress`; cancel via `POST .../abort-ai-test` or by closing the HTTP connection.',
  })
  @ApiResponse({ status: 200, description: 'Test result' })
  async testAiPromptStep(
    @Req() req: Request & { user: { sub: string } },
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: TestAiPromptStepDto,
  ) {
    const userId = req.user.sub;
    const ac = new AbortController();
    this.recordingService.registerAiPromptTestAbort(id, stepId, ac);
    const onClose = () => ac.abort();
    req.on('close', onClose);
    try {
      return await this.recordingService.testAiPromptStep(id, userId, stepId, {
        instruction: dto?.instruction,
        signal: ac.signal,
        phase: dto?.phase,
      });
    } finally {
      req.off('close', onClose);
      this.recordingService.unregisterAiPromptTestAbort(id, stepId);
    }
  }

  @Post(':id/steps/:stepId/abort-ai-test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Abort an in-flight AI prompt Test',
    description:
      'Best-effort abort of the vision/LLM request. Generated Playwright may still run briefly after the model returns.',
  })
  @ApiResponse({ status: 200, description: '{ ok: true }' })
  async abortAiPromptTest(
    @Req() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    const userId = req.user.sub;
    return this.recordingService.abortAiPromptTest(id, userId, stepId);
  }

  @Post(':id/steps/:stepId/reset-ai-test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reset browser to state before the last AI prompt Test',
    description:
      'Restores URL + cookies + storage from a snapshot taken at the start of the last test, or from the checkpoint after the previous step.',
  })
  @ApiResponse({ status: 200, description: '{ ok: true }' })
  async resetAiPromptTest(
    @Req() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    const userId = req.user.sub;
    return this.recordingService.resetAiPromptTest(id, userId, stepId);
  }

  @Delete(':id/steps/:stepId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'During recording: delete the last step',
    description:
      'Only allowed while recording and only for the most recently recorded step (e.g. discard an AI step draft).',
  })
  @ApiResponse({ status: 204, description: 'Step removed' })
  async deleteLastRunStepDuringRecording(
    @Req() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    const userId = req.user.sub;
    await this.recordingService.deleteLastRunStepDuringRecording(id, userId, stepId);
  }

  @Post(':id/playback/start')
  @HttpCode(201)
  @ApiOperation({ summary: 'Start replaying a completed run in a new browser session (preview)' })
  @ApiResponse({ status: 201, description: 'Playback started; join socket room run:<playbackSessionId>' })
  async startPlayback(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: StartPlaybackDto,
  ) {
    const userId = req.user.sub;
    return this.recordingService.startPlayback(userId, id, {
      delayMs: dto.delayMs,
      autoClerkSignIn: dto.autoClerkSignIn,
      clerkOtpMode: dto.clerkOtpMode,
      skipUntilSequence: dto.skipUntilSequence,
      skipStepIds: dto.skipStepIds,
      playThroughSequence: dto.playThroughSequence,
    });
  }

  @Get(':id/checkpoints')
  @ApiOperation({
    summary: 'List app-state checkpoints (storage snapshots after each recorded step)',
    description:
      'Checkpoints are written while recording when `RECORDING_CHECKPOINTS` is enabled (default). Prefix replay remains the deterministic way to reach a step.',
  })
  @ApiResponse({ status: 200, description: 'Checkpoint rows for the run' })
  async runCheckpoints(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.runsService.findCheckpoints(id, userId);
  }

  @Get(':id/checkpoints/:checkpointId/thumbnail')
  @ApiOperation({ summary: 'JPEG thumbnail captured at a checkpoint' })
  @ApiResponse({ status: 200, description: 'image/jpeg' })
  @Header('Cache-Control', 'private, max-age=3600')
  async checkpointThumbnail(
    @Req() req: any,
    @Param('id') runId: string,
    @Param('checkpointId') checkpointId: string,
  ): Promise<StreamableFile> {
    const userId = req.user.sub;
    const run = await this.runsService.findOne(runId, userId);
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    const checkpoint = await this.runsService.findCheckpointById(checkpointId, runId, userId);
    if (!checkpoint?.thumbnailPath) throw new NotFoundException('Checkpoint thumbnail not found');
    const { artifactDir } = this.recordingService.getRunArtifactFilePaths(runId, userId);
    const absPath = require('path').join(artifactDir, checkpoint.thumbnailPath);
    await access(absPath).catch(() => { throw new NotFoundException('Thumbnail file missing'); });
    return new StreamableFile(createReadStream(absPath), { type: 'image/jpeg' });
  }

  @Get(':id/recording/video')
  @ApiOperation({ summary: 'Stream the session screen recording (MP4 preferred, WebM legacy)' })
  @ApiResponse({ status: 200, description: 'video/mp4 or video/webm stream' })
  @Header('Cache-Control', 'private, max-age=3600')
  async getRecordingVideo(@Req() req: any, @Param('id') id: string): Promise<StreamableFile> {
    const userId = req.user.sub;
    const run = await this.runsService.findOne(id, userId);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    const paths = this.recordingService.getRunArtifactFilePaths(id, userId);
    let filePath: string;
    let mime: string;
    let filename: string;
    try {
      await access(paths.recordingVideoMp4);
      filePath = paths.recordingVideoMp4;
      mime = 'video/mp4';
      filename = `run-${id}.mp4`;
    } catch {
      try {
        await access(paths.recordingVideoWebm);
        filePath = paths.recordingVideoWebm;
        mime = 'video/webm';
        filename = `run-${id}.webm`;
      } catch {
        throw new NotFoundException('Recording video not available for this run');
      }
    }
    return new StreamableFile(createReadStream(filePath), {
      type: mime,
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Get(':id/recording/thumbnail')
  @ApiOperation({ summary: 'JPEG thumbnail extracted from the session recording' })
  @ApiResponse({ status: 200, description: 'image/jpeg' })
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'private, max-age=86400')
  async getRecordingThumbnail(@Req() req: any, @Param('id') id: string): Promise<StreamableFile> {
    const userId = req.user.sub;
    const run = await this.runsService.findOne(id, userId);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    const paths = this.recordingService.getRunArtifactFilePaths(id, userId);
    try {
      await access(paths.thumbnailPath);
    } catch {
      throw new NotFoundException('Thumbnail not available for this run');
    }
    return new StreamableFile(createReadStream(paths.thumbnailPath), {
      type: 'image/jpeg',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single run by ID' })
  @ApiResponse({ status: 200, description: 'Run details' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async findOne(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    const run = await this.runsService.findOne(id, userId);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return run;
  }

  @Get(':id/steps')
  @ApiOperation({ summary: 'Get all steps for a run' })
  @ApiResponse({ status: 200, description: 'List of steps' })
  async findSteps(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.runsService.findSteps(id, userId);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get lightweight run status' })
  async getStatus(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    const status = await this.runsService.getRunStatus(id, userId);
    if (!status) throw new NotFoundException(`Run ${id} not found`);
    return status;
  }

  @Get(':id/screenshot')
  @ApiOperation({ summary: 'Get the latest screencast frame as JPEG' })
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'no-cache')
  async getScreenshot(
    @Req() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const frame = this.recordingService.getLatestFrame(id);
    if (!frame) {
      res.status(404).json({ message: 'No frame available' });
      return;
    }
    res.set('Content-Type', 'image/jpeg');
    res.send(frame);
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'SSE stream of recording events (frames, steps, status)' })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  streamEvents(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const userId = req.user.sub;

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    const onStep = (runId: string, step: any) => {
      if (runId === id) {
        res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
      }
    };

    const onFrame = (runId: string, frameBase64: string) => {
      if (runId === id) {
        res.write(`event: frame\ndata: ${JSON.stringify({ data: frameBase64 })}\n\n`);
      }
    };

    const onStatus = (runId: string, status: any) => {
      if (runId === id) {
        res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
        if (status.status === 'completed' || status.status === 'failed') {
          cleanup();
          res.end();
        }
      }
    };

    this.recordingService.on('step', onStep);
    this.recordingService.on('frame', onFrame);
    this.recordingService.on('status', onStatus);

    const cleanup = () => {
      this.recordingService.off('step', onStep);
      this.recordingService.off('frame', onFrame);
      this.recordingService.off('status', onStatus);
    };

    req.on('close', cleanup);
  }
}
