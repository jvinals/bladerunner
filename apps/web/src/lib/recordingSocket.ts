import { io, Socket } from 'socket.io-client';

/**
 * NestJS Socket.IO runs on the API origin. In dev, `io('/recording')` would hit Vite (5173)
 * and only work if the dev proxy forwards `/socket.io` reliably — connecting directly to
 * `VITE_API_URL` avoids that and matches production (separate API host).
 */
export function createRecordingSocket(): Socket {
  const api = import.meta.env.VITE_API_URL;
  const origin = typeof api === 'string' && api.trim().length > 0 ? api.replace(/\/$/, '') : '';
  const url = origin ? `${origin}/recording` : '/recording';

  return io(url, {
    path: '/socket.io',
    // Polling first works through more proxies; websocket upgrades after handshake
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 12,
    reconnectionDelay: 400,
  });
}
