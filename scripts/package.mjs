import packager from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import './build.mjs';

// Materialize production dependencies instead of asking a hoist-only pruner to walk pnpm links.
const project = process.cwd();
const stage = path.resolve('.orbit-package');
if (path.dirname(stage) !== project) throw new Error('Packaging directory must be inside the project.');
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(stage, { recursive: true });
const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).trim());
const buildInfo = { version: manifest.version, sourceCommit, dirty, node: process.version, platform: process.platform, arch: process.arch, lockfileSha256: createHash('sha256').update(await fs.readFile('pnpm-lock.yaml')).digest('hex') };
await fs.writeFile(path.join(stage, 'build-info.json'), JSON.stringify(buildInfo, null, 2));
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ ...manifest, scripts: undefined, devDependencies: undefined }, null, 2));
for (const name of ['dist', 'starter', 'README.md', 'CHANGELOG.md', 'docs']) await fs.cp(name, path.join(stage, name), { recursive: true });
const copied = new Set();
async function copyDependency(name, from, modules, optional = false) {
  const resolver = createRequire(path.join(from, 'package.json'));
  let source;
  for (const directory of resolver.resolve.paths(name) ?? []) {
    const candidate = path.join(directory, name);
    if (await fs.stat(path.join(candidate, 'package.json')).catch(() => null)) { source = await fs.realpath(candidate); break; }
  }
  if (!source) { if (optional) return; throw new Error(`Cannot resolve ${name} from ${from}`); }
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  if (pkg.os && !pkg.os.includes(process.platform) || pkg.cpu && !pkg.cpu.includes(process.arch)) return;
  const target = path.join(modules, name);
  if (copied.has(target)) return;
  copied.add(target);
  await fs.cp(source, target, { recursive: true, filter: entry => !path.relative(source, entry).split(path.sep).includes('node_modules') });
  const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies };
  for (const child of Object.keys(dependencies)) await copyDependency(child, source, path.join(target, 'node_modules'), child in (pkg.optionalDependencies ?? {}));
}
for (const name of Object.keys(manifest.dependencies)) await copyDependency(name, project, path.join(stage, 'node_modules'));
const paths = await packager({
  dir: stage, name: 'Orbit', out: path.resolve('release'), overwrite: true,
  platform: process.platform, arch: process.arch,
  prune: false, asar: false,
  executableName: 'Orbit',
});
await fs.rm(stage, { recursive: true, force: true });
console.log('Desktop application:', paths.join('\n'));
