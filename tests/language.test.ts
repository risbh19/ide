import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LanguageClient } from '../src/main/language';
import type { Diagnostic } from '../src/shared/types';

test('real LSP emits diagnostics using the original Windows document path', { timeout: 25000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-lsp-'));
  const file = path.join(root, 'sample.ts');
  const text = "const broken: number = 'wrong';\n";
  await fs.writeFile(file, text);
  let resolveDiagnostics: (items: Diagnostic[]) => void;
  const diagnostics = new Promise<Diagnostic[]>(resolve => resolveDiagnostics = resolve);
  const client = new LanguageClient(path.resolve('node_modules/typescript-language-server/lib/cli.mjs'), (event, value) => {
    if (event === 'diagnostics' && (value as Diagnostic[]).some(d => d.severity === 1)) resolveDiagnostics(value as Diagnostic[]);
  });
  try {
    client.start(root); await client.open(file, text);
    const result = await diagnostics;
    assert.equal(result[0].path, file);
    assert.match(result.map(d => d.message).join('\n'), /not assignable/);
    await client.change(file, "const message = 'hello';\nmessage.\n");
    const items = await client.complete(file, "const message = 'hello';\nmessage.".length);
    assert.ok(items.some(item => item.label === 'toUpperCase'));
  } finally { await client.stop(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('rapid LSP restarts, close/reopen and shutdown use only the current workspace', { timeout: 35000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-lsp-lifecycle-'));
  const other = path.join(root, 'other'); await fs.mkdir(other);
  const file = path.join(other, 'current.ts'); await fs.writeFile(file, 'let amount = 1;\namount.');
  const events: Diagnostic[][] = [];
  const client = new LanguageClient(path.resolve('node_modules/typescript-language-server/lib/cli.mjs'), (event, value) => { if (event === 'diagnostics') events.push(value as Diagnostic[]); });
  try {
    client.start(root); const obsolete = client.open(path.join(root, 'old.ts'), "const bad: number = 'wrong';");
    client.start(root); client.start(other); await obsolete;
    await client.open(file, 'let amount = 1;\namount.');
    assert.ok((await client.complete(file, 'let amount = 1;\namount.'.length)).some(item => item.label === 'toFixed'));
    await client.close(file); await client.open(file, "let amount = 'hello';\namount.");
    assert.ok((await client.complete(file, "let amount = 'hello';\namount.".length)).some(item => item.label === 'toUpperCase'));
    assert.ok(events.every(items => items.every(item => item.path === file)));
    await client.stop(); await client.stop();
  } finally { await client.stop(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('a missing real language server reports failure and remains stoppable', { timeout: 20000 }, async () => {
  const statuses: string[] = [];
  const client = new LanguageClient(path.resolve('missing-language-server.mjs'), (event, value) => { if (event === 'language-status') statuses.push(String(value)); });
  try {
    client.start(process.cwd()); await assert.rejects(client.open(path.resolve('missing.ts'), 'let value = 1;'));
    assert.ok(statuses.some(status => status.startsWith('Unavailable:')));
  } finally { await client.stop(); }
});
