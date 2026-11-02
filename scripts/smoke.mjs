import { _electron as electron, expect } from '@playwright/test';
import executablePath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.orbit-test', `run-${Date.now()}`);
const workspace = path.join(root, 'workspace');
const testEnv = { ...process.env, ORBIT_WORKSPACE: workspace, ORBIT_TEST_DATA: path.join(root, 'profile') };
delete testEnv.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const binary = packaged ? path.resolve(`release/Orbit-${process.platform}-${process.arch}/Orbit${process.platform === 'win32' ? '.exe' : ''}`) : executablePath;
const args = packaged ? [] : [path.resolve('.')];
await fs.mkdir(root, { recursive: true });
await fs.cp(path.resolve('starter'), workspace, { recursive: true });
const app = await electron.launch({
  executablePath: binary, args,
  env: testEnv,
  timeout: 30000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Renderer:', message.text()); });
  await expect(page.locator('.tab.active')).toContainText('main.ts');
  await expect(page.locator('.code-input')).toHaveValue(/createProject/);
  await page.screenshot({ path: path.join(root, '01-editor.png') });
  console.log('PASS: desktop launched with a real starter workspace');

  await page.getByRole('button', { name: 'New file in workspace', exact: true }).click();
  await page.getByRole('textbox', { name: 'File name or path', exact: true }).fill('smoke.ts');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  let editor = page.locator('.code-input').first();
  await expect(page.locator('.tab.active')).toContainText('smoke.ts');
  await editor.fill("const projectName: string = 'Orbit';\nconsole.log(projectName);\n");
  await editor.press('Control+s');
  await expect.poll(() => fs.readFile(path.join(workspace, 'smoke.ts'), 'utf8')).toContain('projectName');
  console.log('PASS: create, edit, and atomic save');

  await editor.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in file', exact: true }).fill('projectName');
  await page.getByRole('textbox', { name: 'Replace with', exact: true }).fill('projectLabel');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(editor).toHaveValue("const projectLabel: string = 'Orbit';\nconsole.log(projectLabel);\n");
  await page.getByRole('button', { name: 'Close find', exact: true }).click();
  await editor.press('Control+z');
  await expect(editor).toHaveValue("const projectName: string = 'Orbit';\nconsole.log(projectName);\n");
  console.log('PASS: find/replace is a single reversible transaction');

  await editor.press('Control+Home');
  await editor.press('Control+f');
  await page.getByRole('textbox', { name: 'Find in file', exact: true }).fill('projectName');
  await page.getByRole('button', { name: 'Next match', exact: true }).click();
  await page.getByRole('button', { name: 'Close find', exact: true }).click();
  await editor.press('Control+d');
  await expect(page.locator('#status-cursor')).toHaveText('2 cursors');
  await page.keyboard.insertText('renamed');
  await expect(editor).toHaveValue("const renamed: string = 'Orbit';\nconsole.log(renamed);\n");
  await editor.press('Control+z');
  await expect(editor).toHaveValue(/const projectName/);
  await editor.press('Control+y');
  await expect(editor).toHaveValue(/const renamed/);
  await editor.press('Escape');
  console.log('PASS: multi-cursor editing and undo/redo');

  await editor.press('Control+\\');
  await expect(page.locator('.code-input')).toHaveCount(2);
  const splitEditor = page.locator('.code-input').nth(1);
  await splitEditor.press('Control+End');
  await page.keyboard.insertText('// split view synchronized\n');
  await expect(editor).toHaveValue(/split view synchronized/);
  await splitEditor.press('Control+s');
  await splitEditor.press('Control+\\');
  await expect(page.locator('.code-input')).toHaveCount(1);
  console.log('PASS: split panes share document changes');

  await editor.press('Control+Shift+f');
  await expect(page.locator('.findbar')).toBeHidden();
  await page.getByRole('textbox', { name: 'Search workspace', exact: true }).fill('split view synchronized');
  await expect(page.locator('.search-hit')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.search-hit').click();
  await expect(page.locator('#status-cursor')).toContainText('Ln 3');
  console.log('PASS: workspace search navigates to results');

  await editor.fill("const message = 'Orbit';\nmessage.");
  await editor.press('Control+End');
  await editor.press('Control+Space');
  await expect(page.locator('.completions')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.completions')).toContainText('toUpperCase');
  await editor.press('Escape');
  const hover = await page.evaluate(async file => window.orbit.hover(file, 8), path.join(workspace, 'smoke.ts'));
  expect(hover.text).toContain('message');
  console.log('PASS: real LSP completions and hover information');

  await editor.fill("const broken: number = 'wrong';\n");
  await expect.poll(async () => Number(await page.locator('#problem-count').textContent()), { timeout: 30000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: /PROBLEMS/ }).click();
  await expect(page.locator('#problems-host')).toContainText('not assignable');
  await page.screenshot({ path: path.join(root, '02-diagnostics.png') });
  console.log('PASS: language diagnostics reach the Problems panel');

  await editor.fill("console.log('ORBIT_RUN_OK');\n");
  await editor.press('Control+s');
  const terminalResult = await page.evaluate(async () => {
    let data = '';
    const session = await window.orbit.terminalStart(90, 12);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); window.orbit.terminalStop(session.id); reject(new Error('PTY output timed out: ' + data)); }, 15000);
      const off = window.orbit.onTerminal(event => {
        if (event.id !== session.id) return;
        data += event.data ?? '';
        if (data.includes('ORBIT_EXECUTED_120')) { clearTimeout(timer); off(); window.orbit.terminalStop(session.id); resolve(true); }
      });
      window.orbit.terminalResize(session.id, 120, 20);
      window.orbit.terminalWrite(session.id, "Write-Output ('ORBIT_' + 'EXECUTED_' + $Host.UI.RawUI.WindowSize.Width)\r");
    });
  });
  expect(terminalResult).toBe(true);
  console.log('PASS: ConPTY resizes and executes PowerShell commands');

  await editor.press('Control+p');
  await page.locator('#palette-input').fill('main.ts');
  await page.locator('#palette-input').press('Enter');
  await expect(page.locator('.tab.active')).toContainText('main.ts');
  const definition = await page.evaluate(async file => {
    const data = await window.orbit.read(file);
    await window.orbit.languageOpen(file, data.text);
    return window.orbit.definition(file, data.text.indexOf("createProject('"));
  }, path.join(workspace, 'main.ts'));
  expect(definition.path).toBe(path.join(workspace, 'src/project.ts'));
  console.log('PASS: quick open and cross-file go-to-definition');

  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await editor.press('F5');
  await expect(page.locator('.xterm-rows')).toContainText('Hello, builder.', { timeout: 15000 });
  await page.screenshot({ path: path.join(root, '03-orbit.png') });
  console.log('PASS: Run executes the starter project in the visible terminal');

  await fs.appendFile(path.join(workspace, 'main.ts'), '\n// external watch marker\n');
  await expect(editor).toHaveValue(/external watch marker/, { timeout: 15000 });
  await editor.press('Control+End');
  await page.keyboard.insertText('// local dirty marker\n');
  await fs.appendFile(path.join(workspace, 'main.ts'), '// concurrent disk change\n');
  await expect(page.locator('.external-banner')).toBeVisible({ timeout: 15000 });
  await expect(editor).toHaveValue(/local dirty marker/);
  expect(await fs.readFile(path.join(workspace, 'main.ts'), 'utf8')).not.toContain('local dirty marker');
  console.log('PASS: external file reload and dirty-buffer conflict protection');

  // Save a dirty recovery buffer, then verify a fresh app process restores it.
  await editor.press('Control+End');
  await page.keyboard.insertText('// recovery marker\n');
  await page.waitForTimeout(600);
  expect(errors).toEqual([]);
  console.log('Screenshots:', root);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
  await app.close();
  const restored = await electron.launch({ executablePath: binary, args, env: testEnv });
  try {
    const restoredPage = await restored.firstWindow();
    await expect(restoredPage.locator('.code-input')).toHaveValue(/recovery marker/);
    console.log('PASS: unsaved document recovery across process restart');
    const lateMessagesSafe = await restored.evaluate(({ BrowserWindow, ipcMain }) => {
      const window = BrowserWindow.getAllWindows()[0], sender = window.webContents, senderFrame = sender.mainFrame;
      window.destroy();
      const event = { sender, senderFrame };
      for (const [channel, ...args] of [['set-dirty', true], ['terminal-write', 'closed', 'x'], ['terminal-resize', 'closed', 80, 24], ['terminal-stop', 'closed'], ['close-ready'], ['window', 'close']]) ipcMain.emit(channel, event, ...args);
      return true;
    });
    expect(lateMessagesSafe).toBe(true);
    console.log('PASS: late IPC after window destruction is ignored without a main-process exception');
  } finally { await restored.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await restored.close(); }
} catch (error) {
  console.error('Smoke test failed:', error);
  const window = app.windows()[0];
  if (window) await window.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {});
}
