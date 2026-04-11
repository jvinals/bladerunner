import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RecordingService } from './recording.service';
import { NavigationRecordingService } from '../navigations/navigation-recording.service';
import { NavigationsService } from '../navigations/navigations.service';
import { compileToSkyvernWorkflow } from '../navigations/skyvern-compiler';

@WebSocketGateway({
  namespace: '/recording',
  cors: { origin: '*' },
})
export class RecordingGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RecordingGateway.name);

  constructor(
    private readonly recordingService: RecordingService,
    @Inject(forwardRef(() => NavigationRecordingService))
    private readonly navigationRecording: NavigationRecordingService,
    @Inject(forwardRef(() => NavigationsService))
    private readonly navigationsService: NavigationsService,
  ) {}

  afterInit() {
    this.recordingService.on('frame', (runId: string, frameBase64: string) => {
      this.server.to(`run:${runId}`).emit('frame', { runId, data: frameBase64 });
    });

    this.recordingService.on('step', (runId: string, step: any) => {
      this.server.to(`run:${runId}`).emit('step', { runId, step });
    });

    this.recordingService.on('status', (runId: string, status: any) => {
      this.server.to(`run:${runId}`).emit('status', status);
    });

    this.recordingService.on('playbackProgress', (playbackSessionId: string, payload: Record<string, unknown>) => {
      this.server.to(`run:${playbackSessionId}`).emit('playbackProgress', {
        runId: playbackSessionId,
        ...payload,
      });
    });

    this.recordingService.on('aiPromptTestProgress', (roomId: string, payload: Record<string, unknown>) => {
      this.server.to(`run:${roomId}`).emit('aiPromptTestProgress', payload);
    });

    this.recordingService.on('evaluationProgress', (evaluationId: string, payload: Record<string, unknown>) => {
      this.server.to(`run:${evaluationId}`).emit('evaluationProgress', { evaluationId, ...payload });
    });

    this.recordingService.on(
      'evaluationDebugLog',
      (
        evaluationId: string,
        line: { at: string; message: string; detail?: Record<string, unknown> },
      ) => {
        this.server.to(`run:${evaluationId}`).emit('evaluationDebugLog', { evaluationId, ...line });
      },
    );

    this.recordingService.on(
      'discoveryDebugLog',
      (projectId: string, line: { at: string; message: string; detail?: Record<string, unknown> }) => {
        this.server.to(`run:discovery-${projectId}`).emit('discoveryDebugLog', { projectId, ...line });
      },
    );

    this.recordingService.on('discoveryNavigationMermaid', (projectId: string, mermaid: string) => {
      this.server.to(`run:discovery-${projectId}`).emit('discoveryNavigationMermaid', { projectId, mermaid });
    });

    this.recordingService.on('nav:actionRecorded', (navId: string, action: Record<string, unknown>) => {
      this.server.to(`run:${navId}`).emit('nav:actionRecorded', { navId, action });
    });

    this.logger.log('Recording WebSocket gateway initialized');
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { runId: string },
  ) {
    client.join(`run:${data.runId}`);
    this.logger.log(`Client ${client.id} joined run:${data.runId}`);
    /** Catch-up: frames/steps may have been broadcast before this socket joined the room. */
    const recFrame = this.recordingService.getLatestFrame(data.runId);
    const evalFrame = this.recordingService.getLatestEvaluationFrame(data.runId);
    const discoveryPrefix = 'discovery-';
    const discoveryProjectId =
      data.runId.startsWith(discoveryPrefix) ? data.runId.slice(discoveryPrefix.length) : null;
    const discoveryFrame = discoveryProjectId
      ? this.recordingService.getLatestDiscoveryFrame(discoveryProjectId)
      : null;
    const navFrame = this.navigationRecording.getLatestFrame(data.runId);
    const latest =
      recFrame && recFrame.length > 0
        ? recFrame
        : evalFrame && evalFrame.length > 0
          ? evalFrame
          : discoveryFrame && discoveryFrame.length > 0
            ? discoveryFrame
            : navFrame && navFrame.length > 0
              ? navFrame
              : null;
    if (latest && latest.length > 0) {
      client.emit('frame', { runId: data.runId, data: latest.toString('base64') });
    }
    const evalProgress = this.recordingService.getLatestEvaluationProgress(data.runId);
    if (evalProgress) {
      client.emit('evaluationProgress', evalProgress);
    }
    const traceLines = this.recordingService.getEvaluationDebugLogLines(data.runId);
    if (traceLines.length > 0) {
      client.emit('evaluationDebugLogBatch', { evaluationId: data.runId, lines: traceLines });
    }
    if (discoveryProjectId) {
      const discoveryLines = this.recordingService.getDiscoveryDebugLogLines(discoveryProjectId);
      if (discoveryLines.length > 0) {
        client.emit('discoveryDebugLogBatch', { projectId: discoveryProjectId, lines: discoveryLines });
      }
      const mermaid = this.recordingService.getDiscoveryNavigationMermaid(discoveryProjectId);
      if (mermaid) {
        client.emit('discoveryNavigationMermaid', { projectId: discoveryProjectId, mermaid });
      }
    }
    return { event: 'joined', data: { runId: data.runId } };
  }

  @SubscribeMessage('leave')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { runId: string },
  ) {
    client.leave(`run:${data.runId}`);
    return { event: 'left', data: { runId: data.runId } };
  }

  @SubscribeMessage('instruct')
  async handleInstruct(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { runId: string; userId: string; instruction: string },
  ) {
    try {
      const step = await this.recordingService.executeInstruction(
        data.runId,
        data.userId,
        data.instruction,
      );
      return { event: 'instruct:result', data: { step } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { event: 'instruct:error', data: { error: message } };
    }
  }

  @SubscribeMessage('pointer')
  async handlePointer(
    @MessageBody()
    data: {
      runId: string;
      userId: string;
      kind: 'move' | 'down' | 'up' | 'wheel' | 'dblclick';
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
      deltaX?: number;
      deltaY?: number;
    },
  ) {
    await this.recordingService.dispatchRemotePointer(data.runId, data.userId, {
      kind: data.kind,
      x: data.x,
      y: data.y,
      button: data.button,
      deltaX: data.deltaX,
      deltaY: data.deltaY,
    });
    return { ok: true };
  }

  @SubscribeMessage('touch')
  async handleTouch(
    @MessageBody()
    data: {
      runId: string;
      userId: string;
      type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
      touchPoints: Array<{ id: number; x: number; y: number; force?: number }>;
    },
  ) {
    await this.recordingService.dispatchRemoteTouch(data.runId, data.userId, {
      type: data.type,
      touchPoints: data.touchPoints ?? [],
    });
    return { ok: true };
  }

  @SubscribeMessage('clipboard')
  async handleClipboard(
    @MessageBody()
    data: {
      runId: string;
      userId: string;
      action: 'paste' | 'pull' | 'cut';
      text?: string;
    },
  ) {
    if (data.action === 'paste' && data.text != null) {
      await this.recordingService.insertRemoteClipboardText(data.runId, data.userId, data.text);
      return { ok: true };
    }
    if (data.action === 'pull') {
      const text = await this.recordingService.getRemoteSelectionText(data.runId, data.userId);
      return { ok: true, text };
    }
    if (data.action === 'cut') {
      const text = await this.recordingService.cutRemoteSelection(data.runId, data.userId);
      return { ok: true, text };
    }
    return { ok: false };
  }

  @SubscribeMessage('key')
  async handleKey(
    @MessageBody() data: { runId: string; userId: string; type: 'down' | 'up'; key: string },
  ) {
    await this.recordingService.dispatchRemoteKey(data.runId, data.userId, {
      type: data.type,
      key: data.key,
    });
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Navigation recording events (nav:*)
  // -----------------------------------------------------------------------

  @SubscribeMessage('nav:startRecording')
  async handleNavStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { navId: string; userId: string },
  ) {
    try {
      await this.navigationRecording.startSession(data.navId, data.userId);
      this.server.to(`run:${data.navId}`).emit('nav:sessionStarted', { navId: data.navId });
      return { event: 'nav:sessionStarted', data: { navId: data.navId } };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      client.emit('nav:error', { navId: data.navId, error });
      return { event: 'nav:error', data: { navId: data.navId, error } };
    }
  }

  @SubscribeMessage('nav:click')
  async handleNavClick(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { navId: string; userId: string; x: number; y: number },
  ) {
    try {
      if (this.navigationRecording.isPausedForUser(data.navId, data.userId)) {
        return { ok: true, ignored: true };
      }
      const result = await this.navigationRecording.inspectAndClick(
        data.navId,
        data.userId,
        data.x,
        data.y,
      );
      if (result.outcome === 'inputDetected') {
        const elementMeta = result.elementMeta ?? {
          tag: 'input',
          id: null,
          type: null,
          name: null,
          placeholder: null,
          ariaLabel: null,
          textContent: null,
          isInput: true,
        };
        client.emit('nav:inputDetected', {
          navId: data.navId,
          x: result.x,
          y: result.y,
          elementMeta,
        });
        return { event: 'nav:inputDetected', data: { navId: data.navId } };
      }
      this.server.to(`run:${data.navId}`).emit('nav:actionRecorded', {
        navId: data.navId,
        action: result.action,
      });
      return { event: 'nav:actionRecorded', data: { navId: data.navId, action: result.action } };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      client.emit('nav:error', { navId: data.navId, error });
      return { event: 'nav:error', data: { navId: data.navId, error } };
    }
  }

  @SubscribeMessage('nav:inputResolve')
  async handleNavInputResolve(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { navId: string; userId: string; mode: 'static' | 'variable'; value: string },
  ) {
    try {
      if (this.navigationRecording.isPausedForUser(data.navId, data.userId)) {
        return { ok: true, ignored: true };
      }
      const action = await this.navigationRecording.resolveInput(
        data.navId,
        data.userId,
        data.mode,
        data.value,
      );
      this.server.to(`run:${data.navId}`).emit('nav:actionRecorded', {
        navId: data.navId,
        action,
      });
      return { event: 'nav:actionRecorded', data: { navId: data.navId, action } };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      client.emit('nav:error', { navId: data.navId, error });
      return { event: 'nav:error', data: { navId: data.navId, error } };
    }
  }

  @SubscribeMessage('nav:type')
  async handleNavType(
    @MessageBody() data: { navId: string; userId: string; text: string },
  ) {
    try {
      if (this.navigationRecording.isPausedForUser(data.navId, data.userId)) {
        return { ok: true, ignored: true };
      }
      await this.navigationRecording.typeText(data.navId, data.userId, data.text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Ephemeral scroll — updates remote viewport, NOT persisted or compiled. */
  @SubscribeMessage('nav:scroll')
  async handleNavScroll(
    @MessageBody() data: { navId: string; userId: string; deltaX: number; deltaY: number },
  ) {
    try {
      if (this.navigationRecording.isPausedForUser(data.navId, data.userId)) {
        return { ok: true, ignored: true };
      }
      await this.navigationRecording.scrollPage(data.navId, data.userId, data.deltaX, data.deltaY);
    } catch {
      /* transient scroll failure is non-fatal */
    }
    return { ok: true };
  }

  @SubscribeMessage('nav:pause')
  async handleNavPause(@MessageBody() data: { navId: string; userId: string; paused: boolean }) {
    try {
      this.navigationRecording.setPaused(data.navId, data.userId, data.paused);
      this.server.to(`run:${data.navId}`).emit('nav:recordingPaused', {
        navId: data.navId,
        paused: data.paused,
      });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  @SubscribeMessage('nav:cancelRecording')
  async handleNavCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { navId: string; userId: string },
  ) {
    try {
      await this.navigationRecording.cancelSession(data.navId, data.userId);
      this.server.to(`run:${data.navId}`).emit('nav:sessionEnded', {
        navId: data.navId,
        actions: [],
        skyvernWorkflow: null,
        cancelled: true,
      });
      return { event: 'nav:sessionEnded', data: { navId: data.navId, cancelled: true } };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      client.emit('nav:error', { navId: data.navId, error });
      return { event: 'nav:error', data: { navId: data.navId, error } };
    }
  }

  @SubscribeMessage('nav:stopRecording')
  async handleNavStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { navId: string; userId: string },
  ) {
    try {
      const nav = await this.navigationsService.findOne(data.navId, data.userId).catch(() => null);
      const actions = await this.navigationRecording.stopSession(data.navId, data.userId);
      const skyvernWorkflow = nav
        ? compileToSkyvernWorkflow({ id: nav.id, name: nav.name, url: nav.url }, actions)
        : null;
      this.server.to(`run:${data.navId}`).emit('nav:sessionEnded', {
        navId: data.navId,
        actions,
        skyvernWorkflow,
      });
      return { event: 'nav:sessionEnded', data: { navId: data.navId } };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      client.emit('nav:error', { navId: data.navId, error });
      return { event: 'nav:error', data: { navId: data.navId, error } };
    }
  }
}
