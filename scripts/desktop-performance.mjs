import { _electron as electron, expect } from '@playwright/test';
import executablePath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root = path.resolve('.orbit-test', `performance-${Date.now()}`), workspace = path.join(root, 'workspace');
await fs.mkdir(workspace, { recursive: true }); await fs.writeFile(path.join(workspace, 'main.ts'), '// Performance fixture\n');
const sizes = [16384, 524288, 1024 * 1024 - 100];
for (const size of sizes) { const line = 'void 0; // Orbit benchmark line\n'; await fs.writeFile(path.join(workspace, `size-${size}.ts`), line.repeat(Math.ceil(size / line.length)).slice(0, size)); }
const env = { ...process.env, ORBIT_WORKSPACE: workspace, ORBIT_TEST_DATA: path.join(root, 'profile'), ORBIT_TEST_VISIBLE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [path.resolve('.')], env });
const report = { at: new Date().toISOString(), cpu: os.cpus()[0]?.model, platform: `${process.platform}-${process.arch}`, cases: [] };
try {
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { w.webContents.setBackgroundThrottling(false); w.restore(); w.show(); } });
  const page = await app.firstWindow(); page.setDefaultTimeout(60000); const editor = page.locator('.code-input').first();
  await expect(editor).toHaveValue('// Performance fixture\n');
  for (const size of sizes) {
    await page.keyboard.press('Control+p'); await page.locator('#palette-input').fill(`size-${size}.ts`);
    const started = performance.now(); await page.locator('#palette-input').press('Enter');
    await expect(page.locator('.tab.active')).toContainText(`size-${size}.ts`);
    await expect.poll(() => editor.evaluate(el => el.value.length), { timeout: 60000 }).toBe(size);
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const openMs = performance.now() - started;
    await editor.press('Control+Home'); await editor.press('ArrowRight');
    await editor.evaluate(el => {
      window.orbitInputSamples = [];
      if (window.orbitInputListener) el.removeEventListener('beforeinput', window.orbitInputListener, { capture: true });
      window.orbitInputListener = () => { const start = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.orbitInputSamples.push(performance.now() - start))); };
      el.addEventListener('beforeinput', window.orbitInputListener, { capture: true });
    });
    for (let i = 0; i < 30; i++) { await page.keyboard.insertText('x'); await page.waitForTimeout(35); }
    const latency = await page.evaluate(() => window.orbitInputSamples.slice(-30).sort((a, b) => a - b));
    const scroll = await editor.evaluate(async el => { const times = []; for (let i = 0; i < 20; i++) { const start = performance.now(); el.scrollTop = (el.scrollHeight - el.clientHeight) * i / 20; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); times.push(performance.now() - start); } return times.sort((a, b) => a - b); });
    const searchMs = await page.evaluate(async () => { const start = performance.now(); await window.orbit.search('missing desktop benchmark needle', false); return performance.now() - start; });
    const memory = await app.evaluate(async ({ app }) => (await app.getAppMetrics()).map(p => ({ type: p.type, workingSetSizeKB: p.memory.workingSetSize })));
    report.cases.push({ bytes: size, openMs, inputToTwoFramesMedianMs: latency[Math.floor(latency.length / 2)], inputToTwoFramesP95Ms: latency[Math.floor(latency.length * .95)], scrollToTwoFramesMedianMs: scroll[10], scrollToTwoFramesP95Ms: scroll[19], workspaceSearchMs: searchMs, memory });
    console.log(JSON.stringify(report.cases.at(-1)));
  }
  await fs.writeFile(path.join(workspace, 'oversize.ts'), 'x'.repeat(5 * 1024 * 1024 - 100));
  const oversize = await page.evaluate(async file => { try { await window.orbit.read(file); return 'incorrectly accepted'; } catch (error) { return error.message; } }, path.join(workspace, 'oversize.ts'));
  expect(oversize).toContain('1 MiB'); report.oversizeRead = oversize;
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(report, null, 2)); console.log('Desktop performance evidence:', root);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { w.restore(); w.show(); } });
  await page.screenshot({ path: path.join(root, 'large-file.png'), timeout: 15000 });
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close(); }
