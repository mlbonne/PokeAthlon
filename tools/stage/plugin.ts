import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the conversion page writes its output. */
const OUT_ROOT = fileURLToPath(new URL('../../assets/stadium/brawl/', import.meta.url));

/**
 * Tiny dev-server endpoint for the stage converter: the browser cannot write files, so the page
 * POSTs each finished GLB / PNG / JSON here and this middleware puts it under assets/stadium/brawl/.
 */
export function stageWriter(): Plugin {
  return {
    name: 'pokeathlon-stage-writer',
    configureServer(server) {
      server.middlewares.use('/__stage/write', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const rel = normalize(url.searchParams.get('path') ?? '').replace(/^[/\\]+/, '');
        if (!rel || rel === '.' || rel.startsWith('..') || rel.includes(`..${sep}`) || /[<>:"|?*]/.test(rel)) {
          res.statusCode = 400;
          res.end('bad path');
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const dest = join(OUT_ROOT, rel);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, Buffer.concat(chunks));
        res.statusCode = 200;
        res.end(`wrote ${rel} (${Buffer.concat(chunks).length} bytes)`);
      });
    },
  };
}
