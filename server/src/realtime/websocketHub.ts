import http from 'http';
import crypto from 'crypto';
import { subscribeToEvents, SystemEvent } from '../engine/events';
import { logger } from '../config/logger';

interface SocketLike {
  write(data: Buffer | string): void;
  on(event: 'data' | 'close' | 'error', listener: (...args: any[]) => void): void;
  destroy(): void;
}

const sockets = new Set<SocketLike>();

function encodeFrame(message: string): Buffer {
  const payload = Buffer.from(message);
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

export function broadcastRealtimeEvent(event: SystemEvent): void {
  const frame = encodeFrame(JSON.stringify(event));
  for (const socket of sockets) {
    try {
      socket.write(frame);
    } catch (err) {
      logger.error({ err }, 'Failed to write websocket event');
      socket.destroy();
      sockets.delete(socket);
    }
  }
}

export function attachWebSocketHub(server: http.Server): void {
  subscribeToEvents(broadcastRealtimeEvent);

  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key || Array.isArray(key)) {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));

    sockets.add(socket);
    socket.write(encodeFrame(JSON.stringify({
      event_type: 'socket.connected',
      entity_type: 'system',
      entity_id: null,
      payload: { connected_clients: sockets.size },
      created_at: new Date(),
    })));

    socket.on('data', () => {
      // This dashboard channel is server-push only; client messages are ignored.
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
}
