/** `npm run server`: the PokéAthlon room server (M7). Players connect with ws://<this PC>:<port>. */
import { networkInterfaces } from 'node:os';
import { DEFAULT_PORT } from '@pokeathlon/net';
import { startServer } from './server';

const port = Number(process.env.PORT ?? process.argv[2] ?? DEFAULT_PORT);
const s = await startServer({ port });
console.log(`PokéAthlon room server on port ${s.port}`);
console.log(`  this PC:          ws://localhost:${s.port}`);
for (const list of Object.values(networkInterfaces())) {
  for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`  same network:     ws://${a.address}:${s.port}`);
}
console.log('Friends elsewhere need a tunnel or port forwarding (see docs/design/M7-online.md §3).');
setInterval(() => process.stdout.write(`\r${s.rooms.roomCount} room(s) open   `), 5000).unref();
