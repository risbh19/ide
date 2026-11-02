import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import * as pty from '@lydell/node-pty';
import { WorkspaceFS } from './workspace';
import { LanguageClient } from './language';

if (process.env.ORBIT_TEST_DATA) app.setPath('userData', process.env.ORBIT_TEST_DATA);
app.setName('Orbit');
const workspace = new WorkspaceFS();
let win: BrowserWindow;
let watcher: FSWatcher | undefined;
let language: LanguageClient;
let settings: { workspace?: string; recent?: string[] } = {};
let dirty = false, allowClose = false;
const terminals = new Map<string, pty.IPty>();
const emit = (channel: string, value: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(channel, value); };
const describe = () => ({ path: workspace.root, name: path.basename(workspace.root), recent: settings.recent ?? [] });
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

async function activateWorkspace(root: string) {
  await workspace.setRoot(root);
  await watcher?.close();
  terminals.forEach(terminal => { try { terminal.kill(); } catch {} }); terminals.clear();
  language.start(workspace.root);
  watcher = chokidar.watch(workspace.root, {
    ignoreInitial: true, depth: 12, awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 50 },
    ignored: file => /(^|[\\/])(node_modules|\.git|dist|release|\.next|\.cache|\.venv|\.orbit-test)([\\/]|$)/.test(path.relative(workspace.root, file)) || /\.[a-f\d-]{36}\.tmp$/.test(file),
  });
  watcher.on('all', (type, file) => emit('file-event', { type, path: file }));
  watcher.on('error', error => console.error('Watcher:', error));
  settings.workspace = workspace.root;
  settings.recent = [workspace.root, ...(settings.recent ?? []).filter(x => x !== workspace.root)].slice(0, 8);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2));
  return describe();
}

function registerIPC() {
  const handle = (channel: string, callback: (...args: any[]) => any) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted sender.');
    return callback(...args);
  });
  handle('bootstrap', () => ({ workspace: describe(), version: app.getVersion() }));
  handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Open workspace', properties: ['openDirectory'] });
    return result.canceled ? null : activateWorkspace(result.filePaths[0]);
  });
  handle('list', file => workspace.list(file));
  handle('files', () => workspace.files());
  handle('read', file => workspace.read(file));
  handle('open-file', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Open file', defaultPath: workspace.root, properties: ['openFile'] });
    if (result.canceled) return null;
    await workspace.approve(result.filePaths[0]); watcher?.add(result.filePaths[0]); return workspace.read(result.filePaths[0]);
  });
  handle('save', input => workspace.save(input));
  handle('save-as', async input => {
    const result = await dialog.showSaveDialog(win, { defaultPath: path.join(workspace.root, path.basename(input.name)), title: 'Save file' });
    if (result.canceled || !result.filePath) return null;
    const key = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
    if (input.openPaths?.some((file: string) => key(file) === key(result.filePath!))) throw new Error('This file is already open in another tab. Close that tab before saving here.');
    await workspace.approve(result.filePath);
    watcher?.add(result.filePath);
    const existing = await workspace.read(result.filePath).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    return workspace.save({ path: result.filePath, text: input.text, hash: existing?.hash ?? '', eol: input.eol });
  });
  handle('create', input => workspace.create(input.path, input.kind));
  handle('search', (query, sensitive) => workspace.search(query, sensitive));
  handle('git', () => workspace.git());
  handle('language-open', async (file, text) => { await workspace.authorize(file); return language.open(file, text); });
  handle('language-change', async (file, text) => { await workspace.authorize(file); return language.change(file, text); });
  handle('language-close', async file => { await workspace.authorize(file); return language.close(file); });
  for (const method of ['complete', 'hover', 'definition'] as const) handle(method, async (file, at) => { await workspace.authorize(file); return language[method](file, at); });
  handle('format', async file => { await workspace.authorize(file); return language.format(file); });
  handle('terminal-start', (cols, rows) => {
    const shell = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : process.env.SHELL || '/bin/bash';
    const terminalEnv = { ...process.env, TERM: 'xterm-256color' } as Record<string, string>;
    // Keep the host shell's own modules; a bundled parent runtime may inject incompatible modules.
    if (process.platform === 'win32' && terminalEnv.PSModulePath) terminalEnv.PSModulePath = terminalEnv.PSModulePath.split(';').filter(dir => !/[\\/]codex-runtimes[\\/]/i.test(dir)).join(';');
    delete terminalEnv.ELECTRON_RUN_AS_NODE;
    const terminal = pty.spawn(shell, process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : [], {
      name: 'xterm-256color', cols: Math.max(20, Math.min(500, cols)), rows: Math.max(2, Math.min(200, rows)),
      cwd: workspace.root, env: terminalEnv,
    });
    const id = randomUUID(); terminals.set(id, terminal);
    terminal.onData(data => emit('terminal', { id, data }));
    terminal.onExit(({ exitCode }) => { emit('terminal', { id, exitCode }); terminals.delete(id); });
    return { id, shell: path.basename(shell) };
  });
  handle('confirm', (message, detail, buttons) => dialog.showMessageBox(win, { message, detail, buttons, type: 'question', cancelId: buttons.length - 1, defaultId: 0, noLink: true }).then(r => r.response));
  ipcMain.on('terminal-write', (event, id, text) => { if (event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && typeof text === 'string') terminals.get(id)?.write(text); });
  ipcMain.on('terminal-resize', (event, id, cols, rows) => { if (event.sender === win.webContents && Number.isFinite(cols) && Number.isFinite(rows)) { try { terminals.get(id)?.resize(Math.max(2, Math.min(500, cols)), Math.max(2, Math.min(200, rows))); } catch {} } });
  ipcMain.on('terminal-stop', (event, id) => { if (event.sender === win.webContents) { try { terminals.get(id)?.kill(); } catch {} terminals.delete(id); } });
  ipcMain.on('set-dirty', (event, value) => { if (event.sender === win.webContents) dirty = Boolean(value); });
  ipcMain.on('close-ready', event => { if (event.sender === win.webContents) { allowClose = true; win.close(); } });
  ipcMain.on('window', (event, action) => {
    if (event.sender !== win.webContents) return;
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
  });
}

app.whenReady().then(async () => {
  try { settings = JSON.parse(await fs.readFile(settingsPath(), 'utf8')); } catch {}
  language = new LanguageClient(path.join(app.getAppPath(), 'node_modules/typescript-language-server/lib/cli.mjs'), emit);
  let root = process.env.ORBIT_WORKSPACE ?? settings.workspace;
  if (!root || !(await fs.stat(root).catch(() => null))?.isDirectory()) {
    root = path.join(app.getPath('userData'), 'Hello Orbit');
    await fs.mkdir(root, { recursive: true });
    await fs.cp(path.join(app.getAppPath(), 'starter'), root, { recursive: true, force: false, errorOnExist: false });
  }
  await activateWorkspace(root);
  win = new BrowserWindow({
    title: 'Orbit', width: 1400, height: 920, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#11151b', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  registerIPC();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.once('ready-to-show', () => { if (!process.env.ORBIT_TEST_DATA || process.env.ORBIT_TEST_VISIBLE) win.show(); });
  win.on('close', event => { if (dirty && !allowClose) { event.preventDefault(); emit('command', 'quit'); } });
  win.on('closed', () => { terminals.forEach(t => { try { t.kill(); } catch {} }); terminals.clear(); });
  if (process.env.ORBIT_DEV_URL === 'http://127.0.0.1:5173') await win.loadURL(process.env.ORBIT_DEV_URL);
  else await win.loadFile(path.join(__dirname, 'renderer/index.html'));
}).catch(error => { dialog.showErrorBox('Orbit could not start', error.stack ?? error.message); app.quit(); });
app.on('window-all-closed', () => app.quit());
let cleanedUp = false;
app.on('before-quit', event => {
  if (cleanedUp) return;
  event.preventDefault();
  if (win && !win.isDestroyed()) { win.close(); return; }
  terminals.forEach(t => { try { t.kill(); } catch {} }); terminals.clear();
  void Promise.allSettled([language?.stop(), watcher?.close()]).finally(() => { cleanedUp = true; app.quit(); });
});
