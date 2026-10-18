import { createServer } from 'vite';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import electron from 'electron';

await build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', packages: 'external', sourcemap: true });
await build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const server = await createServer();
await server.listen();
const env = { ...process.env, ORBIT_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.once('exit', async code => { await server.close(); process.exit(code ?? 0); });
process.once('SIGINT', () => child.kill());
