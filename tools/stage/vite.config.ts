import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { stageWriter } from './plugin';

/**
 * Dev-only converter app for the Pokémon Stadium 2 (Brawl) rip in stage-assets/.
 *
 *   npx vite --config tools/stage/vite.config.ts
 *   open http://localhost:5199/convert.html?run=1
 *
 * The browser parses the COLLADA 1.4.1 copies, bakes the bind pose, splits meshes by bone and
 * writes GLBs through the stageWriter middleware. Nothing here is part of the shipped client.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../stage-assets/', import.meta.url)),
  server: { port: 5199, strictPort: true },
  plugins: [stageWriter()],
  build: { target: 'es2022' },
});
