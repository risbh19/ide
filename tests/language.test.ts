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
