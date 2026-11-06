import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg } from '@pokeathlon/net';
import { RoomServer } from './rooms';

/** Messages larger than this are dropped (an input is ~60 bytes). */
const MAX_MESSAGE = 16 * 1024;

export interface Started {
  port: number;
  rooms: RoomServer;
  close(): Promise<void>;
}

/** Start the room server on `port` (0 = any free port), or attached to an existing HTTP server. */
export function startServer(opts: { port?: number; server?: Server } = {}): Promise<Started> {
  const rooms = new RoomServer();
  const wss = opts.server ? new WebSocketServer({ server: opts.server, maxPayload: MAX_MESSAGE }) : new WebSocketServer({ port: opts.port ?? 0, maxPayload: MAX_MESSAGE });
  wss.on('connection', (ws: WebSocket) => {
    const c = rooms.connect({
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(),
    });
    ws.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        return;
      }
      if (msg && typeof msg === 'object' && typeof msg.t === 'string') rooms.handle(c, msg);
    });
    ws.on('close', () => rooms.disconnect(c));
    ws.on('error', () => ws.close());
  });
  const sync = setInterval(() => rooms.tickSync(), 500);
  return new Promise((resolve) => {
    const ready = () => {
      const addr = wss.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : 0,
        rooms,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(sync);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => done());
          }),
      });
    };
    if (opts.server) ready();
    else wss.on('listening', ready);
  });
}
