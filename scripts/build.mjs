import { build } from 'esbuild';
import { build as viteBuild } from 'vite';

await build({
  entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs',
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', sourcemap: true,
});
await build({
  entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs',
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
});
await viteBuild();
console.log('Orbit is ready. Run pnpm start.');
