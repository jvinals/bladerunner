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

    this.logger.log('Recording WebSocket gateway initialized');
  }

  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { runId: string },
  ) {
    client.join(`run:${data.runId}`);
    this.logger.log(`Client ${client.id} joined run:${data.runId}`);
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
}
