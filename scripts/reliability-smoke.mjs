import { _electron as electron, expect } from '@playwright/test';
import executablePath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve('.orbit-test', `reliability-${Date.now()}`), workspace = path.join(root, 'workspace');
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, 'main.ts'), 'const n={value:1}\n');
await promisify(execFile)('git', ['init', '--initial-branch=orbit-smoke', workspace], { windowsHide: true });
const env = { ...process.env, ORBIT_WORKSPACE: workspace, ORBIT_TEST_DATA: path.join(root, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const binary = packaged ? path.resolve(`release/Orbit-${process.platform}-${process.arch}/Orbit.exe`) : executablePath;
const args = packaged ? [] : [path.resolve('.')];
const app = await electron.launch({ executablePath: binary, args, env, timeout: 30000 });
let page;
const errors = [];
// Delay the real handler's response to reproduce races deterministically. FS/LSP/PTY stay real.
async function hold(channel) {
  await app.evaluate(({ ipcMain }, channel) => {
    const original = ipcMain._invokeHandlers.get(channel);
    let release; const gate = new Promise(resolve => release = resolve);
    globalThis.orbitGate = { release, calls: 0, channel, original };
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...args) => { globalThis.orbitGate.calls++; const result = await original(...args); await gate; return result; });
  }, channel);
}
async function reached() { await expect.poll(() => app.evaluate(() => globalThis.orbitGate.calls)).toBeGreaterThan(0); }
async function release() {
  await app.evaluate(({ ipcMain }) => {
    const gate = globalThis.orbitGate; if (!gate) return;
    gate.release(); ipcMain.removeHandler(gate.channel); ipcMain.handle(gate.channel, gate.original); delete globalThis.orbitGate;
  });
}
async function command(query) {
  await page.keyboard.press('Control+Shift+p'); await page.locator('#palette-input').fill(query); await page.locator('#palette-input').press('Enter');
}
async function confirmWith(response) {
  await app.evaluate(({ dialog }, response) => { globalThis.originalConfirm ??= dialog.showMessageBox; dialog.showMessageBox = async () => ({ response, checkboxChecked: false }); }, response);
}
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
  const editor = page.locator('.code-input').first();
  await expect(editor).toHaveValue('const n={value:1}\n');
  await page.getByRole('button', { name: 'Source control', exact: true }).click();
  await expect(page.locator('.git-heading')).toContainText('orbit-smoke');
  await expect(page.locator('.tree-entry')).toContainText('main.ts');
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  console.log('PASS: Git branch and untracked-file status use the real fixture repository');
  await hold('format'); await editor.press('Alt+Shift+f'); await reached();
  await editor.press('Control+End'); await page.keyboard.insertText('// typed during format\n');
  const typed = await editor.inputValue(); await release();
  await expect(page.locator('#toast')).toContainText('formatting was skipped'); await expect(editor).toHaveValue(typed);
  await editor.press('Alt+Shift+f'); await expect(editor).toHaveValue('const n = { value: 1 }\n// typed during format\n');
  console.log('PASS: stale real-LSP formatting rejected; fresh formatting applies');
  const beforeCompletion = await editor.inputValue();
  await editor.fill("const message = 'hello';\nmessage."); await hold('complete');
  await editor.press('Control+End'); await editor.press('Control+Space'); await reached();
  await editor.press('Control+Home'); await release();
  await expect(page.locator('.completions')).toBeHidden();
  await expect(editor).toHaveValue("const message = 'hello';\nmessage."); await editor.fill(beforeCompletion);
  console.log('PASS: moving the caret rejects a delayed real-LSP completion response');

  await hold('save'); await editor.press('Control+s'); await reached();
  await editor.press('Control+End'); await page.keyboard.insertText('// newer save\n');
  await page.locator('#status-eol').click();
  await editor.press('Control+s'); await release();
  await expect.poll(() => fs.readFile(path.join(workspace, 'main.ts'), 'utf8')).toContain('// newer save\r\n');
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
  console.log('PASS: queued save includes newer typing and preserves EOL changes');

  await editor.press('Control+End'); await page.keyboard.insertText('// close race\n');
  await confirmWith(2); await editor.press('Control+w'); await expect(editor).toHaveValue(/close race/);
  await confirmWith(0); await hold('save'); await editor.press('Control+w'); await reached();
  await editor.press('Control+End'); await page.keyboard.insertText('// typed while closing\n'); await release();
  await expect(page.locator('.tab.active')).toContainText('main.ts'); await expect(editor).toHaveValue(/typed while closing/);
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(1); await editor.press('Control+s');
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
  console.log('PASS: Cancel close and edits during Save-and-close preserve the buffer');

  await hold('read'); await fs.appendFile(path.join(workspace, 'main.ts'), '// external read race\n'); await reached();
  await editor.press('Control+End'); await page.keyboard.insertText('// typed during external read\n'); await release();
  await expect(page.locator('.external-banner')).toBeVisible(); await expect(editor).toHaveValue(/typed during external read/);
  expect(await editor.inputValue()).not.toContain('external read race');
  await page.getByRole('button', { name: 'Keep my changes & save', exact: true }).click();
  await expect(page.locator('.external-banner')).toBeHidden(); await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
  console.log('PASS: delayed external reads cannot replace typing; explicit overwrite keeps the local buffer');

  const saveAs = path.join(workspace, "copy's.ts");
  await app.evaluate(({ dialog }, filePath) => { globalThis.originalSaveAs = dialog.showSaveDialog; dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, saveAs);
  await editor.press('Control+Shift+s');
  await expect(page.locator('.tab.active')).toContainText("copy's.ts");
  expect(await fs.readFile(saveAs, 'utf8')).toContain('\r\n');
  await expect.poll(() => fs.readFile(saveAs, 'utf8')).toContain('typed while closing');
  await editor.fill("console.log('ORBIT_QUOTED_RUN');\n"); await editor.press('F5');
  await expect(page.locator('.xterm-rows')).toContainText('ORBIT_QUOTED_RUN', { timeout: 20000 });
  console.log('PASS: Save As preserves CRLF and handles apostrophes in filenames');

  await editor.fill('🌍 one 🌍 two\n');
  await editor.evaluate(el => { el.setSelectionRange(2, 2); el.dispatchEvent(new Event('select')); });
  await page.waitForTimeout(30);
  await editor.press('Backspace'); await expect(editor).toHaveValue(' one 🌍 two\n');
  await editor.press('Control+z'); await expect(editor).toHaveValue('🌍 one 🌍 two\n');
  await editor.evaluate(el => {
    el.setSelectionRange(0, 2); el.dispatchEvent(new Event('compositionstart'));
    el.setRangeText('你好', 0, 2, 'end'); el.dispatchEvent(new InputEvent('input', { data: '你好', inputType: 'insertCompositionText', isComposing: true }));
    el.dispatchEvent(new Event('compositionend'));
  });
  await expect(editor).toHaveValue('你好 one 🌍 two\n'); await editor.press('Control+z'); await expect(editor).toHaveValue('🌍 one 🌍 two\n');
  console.log('PASS: native Unicode deletion and an IME event sequence undo correctly');

  await page.evaluate(() => { Storage.prototype.orbitOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('Injected quota failure', 'QuotaExceededError'); }; });
  await editor.press('Control+End'); await page.keyboard.insertText('// recovery quota\n');
  await expect(page.locator('#recovery-warning')).toContainText('Save your files to disk');
  await editor.press('Control+s'); await expect.poll(() => fs.readFile(saveAs, 'utf8')).toContain('recovery quota');
  await page.evaluate(() => Storage.prototype.setItem = Storage.prototype.orbitOriginalSetItem);
  await editor.press('Control+End'); await page.keyboard.insertText('// persistence restored\n');
  await expect(page.locator('#recovery-warning')).toHaveCount(0);
  await editor.press('Control+s'); await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
  await fs.unlink(saveAs); await expect(page.locator('.external-banner')).toContainText('removed from disk');
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(1);
  console.log('PASS: quota failure is visible, disk saves work, external deletion protects the only copy');

  // Switch the real workspace while LSP requests and terminals have been used.
  const next = path.join(root, 'next'); await fs.mkdir(next); await fs.writeFile(path.join(next, 'next.ts'), 'let next = 1;\n');
  await fs.writeFile(path.join(next, 'run.js'), "console.log('ORBIT_JS_EXECUTION');\n");
  await fs.writeFile(path.join(next, 'run.py'), "print('ORBIT_PY_EXECUTION')\n");
  await confirmWith(2); await command('Open Folder'); await expect(editor).toHaveValue(/persistence restored/);
  await confirmWith(1);
  await app.evaluate(({ dialog }, next) => { globalThis.originalOpen = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [next] }); }, next);
  await command('Open Folder'); await expect(page.locator('#title-workspace')).toHaveText('next');
  await expect(page.locator('.tab')).toHaveCount(0); await expect(page.locator('#problem-count')).toHaveText('0');
  await page.keyboard.press('Control+p'); await page.locator('#palette-input').fill('next.ts'); await page.locator('#palette-input').press('Enter');
  await expect(editor).toHaveValue('let next = 1;\n');
  await editor.press('Control+End'); await page.keyboard.insertText('next.'); await editor.press('Control+Space');
  await expect(page.locator('.completions')).toContainText('toFixed', { timeout: 30000 }); await editor.press('Escape');
  await editor.fill('let next = 1;\n'); await editor.press('Control+s');
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
  await hold('terminal-start'); await page.getByRole('button', { name: 'New terminal', exact: true }).click(); await reached();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.orbitGate.calls)).toBe(2); await release();
  await expect(page.locator('.xterm')).toHaveCount(1);
  for (const [file, result] of [['run.js', 'ORBIT_JS_EXECUTION'], ['run.py', 'ORBIT_PY_EXECUTION']]) {
    await page.keyboard.press('Control+p'); await page.locator('#palette-input').fill(file); await page.locator('#palette-input').press('Enter');
    await expect(page.locator('.tab.active')).toContainText(file); await editor.press('F5');
    await expect(page.locator('.xterm-rows')).toContainText(result, { timeout: 20000 });
  }
  console.log('PASS: canceled terminal startups do not replace the active PTY; JS and Python Run execute');
  const beforeTabCycle = await editor.inputValue(); await editor.press('Control+Tab'); await editor.press('Control+Shift+Tab');
  await expect(page.locator('.tab.active')).toContainText('run.py'); await expect(editor).toHaveValue(beforeTabCycle);
  await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0);
  console.log('PASS: Ctrl+Tab cycles tabs without inserting indentation');
  await page.screenshot({ path: path.join(root, 'reliability.png') }); expect(errors).toEqual([]);
  console.log('PASS: workspace switch clears old panes/diagnostics and restarts real LSP');

  await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.originalConfirm; dialog.showSaveDialog = globalThis.originalSaveAs; dialog.showOpenDialog = globalThis.originalOpen; });
  const mainPid = await app.evaluate(() => process.pid);
  const children = process.platform === 'win32' ? JSON.parse((await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `$all = Get-CimInstance Win32_Process; $parents = @(${mainPid}); $ids = @(); while ($parents.Count) { $next = @($all | Where-Object { $parents -contains $_.ParentProcessId }); $parents = @($next | Select-Object -ExpandProperty ProcessId); $ids += $parents }; ConvertTo-Json -InputObject @($ids) -Compress`], { windowsHide: true })).stdout || '[]') : [];
  const childPids = Array.isArray(children) ? children : [children];
  await app.evaluate(({ app }) => app.quit()); await app.close();
  if (process.platform === 'win32') await expect.poll(async () => {
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `@(${childPids.join(',')}) | ForEach-Object { if (Get-Process -Id $_ -ErrorAction SilentlyContinue) { $_ } }`], { windowsHide: true }); return result.stdout.trim();
  }).toBe('');
  console.log('PASS: normal app quit cleans up captured language-server and PTY child processes');
  console.log('Reliability evidence:', root);
} catch (error) { if (page) await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error; }
finally {
  await release().catch(() => {});
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
}
