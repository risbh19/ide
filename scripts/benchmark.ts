import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PieceTable } from '../src/core/piece-table';
import { Tokenizer } from '../src/core/tokenizer';
import { WorkspaceFS } from '../src/main/workspace';

const report: any = { at: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0]?.model, cases: [] };
const root = path.resolve('.orbit-test/benchmark'); await fs.mkdir(root, { recursive: true });
const workspace = new WorkspaceFS(); await workspace.setRoot(root);
for (const size of [16 * 1024, 512 * 1024, 1024 * 1024 - 100]) {
  const text = 'void 0; // Orbit benchmark line\n'.repeat(Math.ceil(size / 31)).slice(0, size);
  const file = path.join(root, `size-${size}.ts`); await fs.writeFile(file, text);
  let start = performance.now(); const data = await workspace.read(file); const readMs = performance.now() - start;
  start = performance.now(); const table = new PieceTable(data.text); void table.lineStarts;
  const lexer = new Tokenizer(); lexer.tokenize(table.text, 'TypeScript'); const openMs = performance.now() - start;
  const samples: number[] = [];
  for (let i = 0; i < 50; i++) {
    start = performance.now(); const at = Math.floor(table.length / 2);
    table.selection = [{ anchor: at, head: at }];
    table.reconcile(table.text.slice(0, at) + 'x' + table.text.slice(at), [{ anchor: at + 1, head: at + 1 }], { selection: table.selection[0], type: 'insertText' });
    void table.position(at); lexer.tokenize(table.text, 'TypeScript'); samples.push(performance.now() - start);
  }
  start = performance.now(); for (let i = 0; i < 100; i++) { const line = 1 + Math.floor((table.lineStarts.length - 1) * i / 100); for (let j = line; j < Math.min(table.lineStarts.length, line + 40); j++) table.lineText(j); }
  const viewportReadsMs = performance.now() - start;
  start = performance.now(); const search = await workspace.search('missing benchmark needle', false); const searchMs = performance.now() - start;
  samples.sort((a, b) => a - b);
  report.cases.push({ bytes: size, readMs, openMs, editMedianMs: samples[25], editP95Ms: samples[47], viewportReads100Ms: viewportReadsMs, searchMs, searchHits: search.hits.length, model: table.statistics(), heapUsedMB: process.memoryUsage().heapUsed / 1024 / 1024 });
}
await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
