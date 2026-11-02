import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceFS } from '../src/main/workspace';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-fs-'));
  const workspace = new WorkspaceFS(); await workspace.setRoot(root);
  return { root, workspace, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
test('open/edit/save preserves CRLF and refuses an external-edit conflict', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    const file = path.join(root, 'a.ts'); await fs.writeFile(file, 'a\r\nb\r\n');
    const opened = await workspace.read(file); assert.equal(opened.text, 'a\nb\n'); assert.equal(opened.eol, 'CRLF');
    const saved = await workspace.save({ ...opened, text: 'c\nd\n' });
    assert.equal(await fs.readFile(file, 'utf8'), 'c\r\nd\r\n');
    await fs.writeFile(file, 'external');
    await assert.rejects(() => workspace.save({ ...saved, text: 'mine' }), /CONFLICT/);
    assert.equal(await fs.readFile(file, 'utf8'), 'external');
    await workspace.save({ ...saved, text: 'mine', force: true }); assert.equal(await fs.readFile(file, 'utf8'), 'mine');
  } finally { await cleanup(); }
});
test('workspace paths cannot traverse out of the selected root', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    await assert.rejects(() => workspace.read(path.join(root, '../secret')), /outside/);
    await assert.rejects(() => workspace.create('../escape.ts', 'file'), /outside/);
    await workspace.create('src/main.ts', 'file');
    await assert.rejects(() => workspace.create('src/main.ts', 'file'), /EEXIST/);
    assert.deepEqual((await workspace.list()).map(e => e.name), ['src']);
  } finally { await cleanup(); }
});
test('project search returns accurate locations and ignores binary/generated files', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    await fs.writeFile(path.join(root, 'main.ts'), 'hello\nconst Orbit = 3;\n');
    await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 79, 114, 98, 105, 116]));
    await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules/dep.js'), 'Orbit');
    const result = await workspace.search('orbit', false);
    assert.equal(result.hits.length, 1); assert.equal(result.hits[0].line, 2); assert.equal(result.hits[0].column, 7);
    assert.equal((await workspace.search('orbit', true)).hits.length, 0);
    await assert.rejects(() => workspace.read(path.join(root, 'binary')), /Binary/);
  } finally { await cleanup(); }
});

test('concurrent saves cannot both overwrite the same expected disk revision', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    const file = path.join(root, 'race.ts'); await fs.writeFile(file, 'base');
    const original = await workspace.read(file);
    const results = await Promise.allSettled([workspace.save({ ...original, text: 'first' }), workspace.save({ ...original, text: 'second' })]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
    assert.match(String((results[1] as PromiseRejectedResult).reason), /CONFLICT/);
    assert.equal(await fs.readFile(file, 'utf8'), 'first');
    assert.deepEqual(await fs.readdir(root), ['race.ts']);
  } finally { await cleanup(); }
});

test('junction containment applies to reads, writes and nested creation', async () => {
  const { root, workspace, cleanup } = await fixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.ts'), 'outside');
    await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(workspace.read(path.join(root, 'link/secret.ts')), /outside/);
    await assert.rejects(workspace.save({ path: path.join(root, 'link/new.ts'), text: 'bad', hash: '', eol: 'LF' }), /outside/);
    await assert.rejects(workspace.create('link/nested/new.ts', 'file'), /outside/);
    assert.equal(await fs.readFile(path.join(outside, 'secret.ts'), 'utf8'), 'outside');
  } finally { await cleanup(); await fs.rm(outside, { recursive: true, force: true }); }
});

test('opening enforces the measured 1 MiB limit without truncating oversized content', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    const file = path.join(root, 'large.ts'); await fs.writeFile(file, 'x'.repeat(1024 * 1024));
    assert.equal((await workspace.read(file)).text.length, 1024 * 1024);
    await fs.appendFile(file, 'x'); await assert.rejects(workspace.read(file), /1 MiB/);
    assert.equal((await fs.stat(file)).size, 1024 * 1024 + 1);
  } finally { await cleanup(); }
});
