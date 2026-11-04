import { defineConfig } from 'vite';

export default defineConfig({
  // Imported sprites/portraits live in the repo-level /assets folder.
  publicDir: '../../assets',
  base: './',
  server: { port: 5173, strictPort: true },
  // three.js alone is ~600 kB minified; split it out later if load time matters.
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
