import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome130' },
  server: { host: '127.0.0.1', strictPort: true, port: 5173 },
});
