import {
  Controller,
  Get,
  Post,
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
import { Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RunsService } from './runs.service';
import { RecordingService } from '../recording/recording.service';
import {
  StartRecordingDto,
  StopRecordingDto,
  StartPlaybackDto,
  StopPlaybackDto,
  InstructDto,
  RunQueryDto,
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
      'Uses API env (same as E2E). Appends a tagged CUSTOM step for playback skip. Requires an active recording session.',
  })
  @ApiResponse({ status: 200, description: 'Sign-in completed; synthetic step returned' })
  @ApiResponse({ status: 400, description: 'Clerk / MailSlurp env not configured' })
  @ApiResponse({ status: 404, description: 'No active recording session' })
  @ApiResponse({ status: 503, description: 'Sign-in flow failed' })
  async clerkAutoSignInRecording(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.recordingService.clerkAutoSignInDuringRecording(id, userId);
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
      skipUntilSequence: dto.skipUntilSequence,
      skipStepIds: dto.skipStepIds,
    });
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
