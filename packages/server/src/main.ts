/**
 * The PokéAthlon room server (M7).
 *
 *   npm run server   rooms only (the game comes from `npm run dev` / `dev:lan`)
 *   npm run host     builds the game, then serves the game AND the rooms on one port (8787),
 *                    so friends need a single address (or a single tunnel)
 */
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@pokeathlon/net';
import { startServer } from './server';
import { gameServer } from './static';

const args = process.argv.slice(2);
const serveGame = args.includes('--serve-game');
const port = Number(process.env.PORT ?? args.find((a) => /^\d+$/.test(a)) ?? DEFAULT_PORT);

let actualPort: number;
let rooms: Awaited<ReturnType<typeof startServer>>['rooms'];
if (serveGame) {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  const http = gameServer(dist);
  rooms = (await startServer({ server: http })).rooms;
  await new Promise<void>((done) => http.listen(port, done));
  const addr = http.address();
  actualPort = typeof addr === 'object' && addr ? addr.port : port;
} else {
  const s = await startServer({ port });
  rooms = s.rooms;
  actualPort = s.port;
}

const what = serveGame ? 'Game + rooms' : 'Room server';
const scheme = serveGame ? 'http' : 'ws';
console.log(`PokéAthlon ${what.toLowerCase()} on port ${actualPort}`);
console.log(`  this PC:        ${scheme}://localhost:${actualPort}${serveGame ? '/?online=1' : ''}`);
for (const list of Object.values(networkInterfaces())) {
  for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`  same network:   ${scheme}://${a.address}:${actualPort}${serveGame ? '/?online=1' : ''}`);
}
console.log(serveGame ? 'Friends elsewhere: share a tunnel to this port (docs/design/M7-online.md).' : 'Friends elsewhere need a tunnel or port forwarding (docs/design/M7-online.md §3).');
setInterval(() => process.stdout.write(`\r${rooms.roomCount} room(s) open   `), 5000).unref();
