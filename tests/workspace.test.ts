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
