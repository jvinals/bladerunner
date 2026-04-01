import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RecordingService } from './recording.service';

@WebSocketGateway({
  namespace: '/recording',
  cors: { origin: '*' },
})
export class RecordingGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RecordingGateway.name);

  constructor(private readonly recordingService: RecordingService) {}

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
    const latest =
      recFrame && recFrame.length > 0
        ? recFrame
        : evalFrame && evalFrame.length > 0
          ? evalFrame
          : discoveryFrame && discoveryFrame.length > 0
            ? discoveryFrame
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
}
