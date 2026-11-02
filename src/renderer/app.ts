import './style.css';
import { icon, fileIcon } from './icons';
import { escapeHTML, languageFor } from '../core/tokenizer';
import { Document } from './document';
import { EditorView } from './editor';
import { TerminalPanel } from './terminal';
import type { Diagnostic, FileData, FileEntry, Workspace } from '../shared/types';

const api = window.orbit;
const $ = <T extends HTMLElement = HTMLElement>(query: string): T => document.querySelector<T>(query)!;
const baseName = (file: string) => file.split(/[\\/]/).at(-1) ?? file;
const relative = (file: string, root: string) => file.startsWith(root) ? file.slice(root.length + 1).replace(/\\/g, '/') : file.replace(/\\/g, '/');
const button = (action: string, name: string, title: string, cls = '') => `<button class="icon-button ${cls}" data-action="${action}" title="${title}" aria-label="${title}">${icon(name)}</button>`;
const safely = (work: () => void | Promise<unknown>) => { try { Promise.resolve(work()).catch(error => toast((error as Error).message, true)); } catch (error) { toast((error as Error).message, true); } };
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string, error = false): void {
  const host = $('#toast'); host.textContent = message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  host.classList.toggle('error-toast', error); host.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => host.hidden = true, 5000);
}

class OrbitApp {
  private workspace!: Workspace;
  private docs: Document[] = [];
  private active?: Document;
  private primary: EditorView;
  private secondary?: EditorView;
  private focused: EditorView;
  private terminal: TerminalPanel;
  private files: string[] = [];
  private expanded = new Set<string>();
  private directories = new Map<string, FileEntry[]>();
  private mode: 'files' | 'search' | 'git' | 'settings' = 'files';
  private panel: 'terminal' | 'problems' = 'terminal';
  private panelVisible = true;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private watcherTimer?: ReturnType<typeof setTimeout>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private searchTicket = 0;
  private workspaceTicket = 0;
  private languageTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private fontSize = Number(localStorage.getItem('orbit-font') ?? 14);
  private paletteKind: 'commands' | 'files' | 'line' = 'commands';
  private paletteRows: { label: string; detail: string; icon: string; run: () => void }[] = [];
  private paletteIndex = 0;
  private gitInfo: Awaited<ReturnType<typeof api.git>> = null;
  private saving = new Map<string, Promise<boolean>>();
  private closing = new Set<string>();
  private commands = [
    { id: 'open-folder', label: 'Open Folder…', key: 'Ctrl+Shift+O', icon: 'folderOpen' },
    { id: 'open-file', label: 'Open File…', key: 'Ctrl+O', icon: 'files' },
    { id: 'new-file', label: 'New Untitled File', key: 'Ctrl+N', icon: 'newFile' },
    { id: 'create-file', label: 'Create File in Workspace…', key: '', icon: 'newFile' },
    { id: 'create-folder', label: 'Create Folder in Workspace…', key: '', icon: 'newFolder' },
    { id: 'save', label: 'Save File', key: 'Ctrl+S', icon: 'save' },
    { id: 'save-as', label: 'Save File As…', key: 'Ctrl+Shift+S', icon: 'save' },
    { id: 'save-all', label: 'Save All Files', key: '', icon: 'save' },
    { id: 'quick-open', label: 'Go to File…', key: 'Ctrl+P', icon: 'search' },
    { id: 'go-line', label: 'Go to Line…', key: 'Ctrl+G', icon: 'arrow' },
    { id: 'find', label: 'Find in File', key: 'Ctrl+F', icon: 'search' },
    { id: 'project-search', label: 'Search Workspace', key: 'Ctrl+Shift+F', icon: 'search' },
    { id: 'split', label: 'Toggle Split Editor', key: 'Ctrl+\\', icon: 'split' },
    { id: 'toggle-terminal', label: 'Toggle Terminal', key: 'Ctrl+`', icon: 'terminal' },
    { id: 'problems', label: 'Show Problems', key: 'Ctrl+Shift+M', icon: 'warning' },
    { id: 'format', label: 'Format Document', key: 'Shift+Alt+F', icon: 'code' },
    { id: 'definition', label: 'Go to Definition', key: 'F12', icon: 'arrow' },
    { id: 'hover', label: 'Show Type Information', key: 'F1', icon: 'info' },
    { id: 'run', label: 'Run Active File', key: 'F5', icon: 'play' },
    { id: 'source-control', label: 'Show Source Control', key: '', icon: 'git' },
    { id: 'settings', label: 'Editor Preferences', key: 'Ctrl+,', icon: 'settings' },
    { id: 'welcome', label: 'Show Welcome', key: '', icon: 'orbit' },
  ];

  constructor() {
    $('#app').innerHTML = `
      <header class="titlebar"><div class="brand">${icon('orbit')}<span>orbit</span><span class="version">IDE</span></div><div class="menu"><button data-action="menu-file">File</button><button data-action="menu-edit">Edit</button><button data-action="menu-view">View</button><button data-action="run">Run</button></div><button class="command-center" data-action="palette">${icon('search')}<span id="title-workspace">Your workspace</span><kbd>Ctrl K</kbd></button><div class="window-controls">${button('minimize', 'minimize', 'Minimize')}${button('maximize', 'maximize', 'Maximize')}${button('close-window', 'close', 'Close window')}</div></header>
      <div class="workbench"><nav class="activity-bar" aria-label="Workspace views"><div><button class="activity active" data-mode="files" title="Explorer" aria-label="Explorer">${icon('files')}</button><button class="activity" data-mode="search" title="Search (Ctrl+Shift+F)" aria-label="Workspace search">${icon('search')}</button><button class="activity" data-mode="git" title="Source control" aria-label="Source control">${icon('git')}<span class="git-count" hidden></span></button><button class="activity" data-action="toggle-terminal" title="Terminal (Ctrl+backtick)" aria-label="Toggle terminal">${icon('terminal')}</button></div><div><span class="local-indicator" title="Local workspace"></span><button class="activity" data-mode="settings" title="Preferences" aria-label="Preferences">${icon('settings')}</button></div></nav>
      <aside class="sidebar"><div class="sidebar-heading"><span id="sidebar-title">EXPLORER</span><div id="sidebar-tools">${button('create-file', 'newFile', 'New file in workspace')}${button('create-folder', 'newFolder', 'New folder')}${button('refresh', 'refresh', 'Refresh explorer')}</div></div><div class="sidebar-content" id="sidebar-content"></div><div class="sidebar-footer">${icon('folder')}<span id="workspace-location"></span><span class="local-tag">LOCAL</span></div></aside><div class="sidebar-resizer" title="Resize sidebar"></div>
      <main class="main-area"><div class="tabs-bar"><div class="tabs" role="tablist" aria-label="Open files"></div><div class="editor-actions">${button('run', 'play', 'Run active file (F5)')}${button('split', 'split', 'Split editor (Ctrl+backslash)')}${button('palette', 'more', 'Commands')}</div></div><div class="breadcrumb"><span id="breadcrumb-path">Welcome</span><div><span class="editor-engine">${icon('bolt')} PIECE TABLE</span></div></div><div class="external-banner" hidden><span>This file changed on disk.</span><button data-action="reload-file">Reload</button><button data-action="overwrite-file">Keep my changes & save</button></div><div class="editors" id="editors"><div class="welcome" id="welcome"></div></div><div class="panel-resizer" title="Resize panel"></div><section class="bottom-panel"><div class="panel-heading"><div class="panel-tabs"><button data-panel="terminal" class="active">TERMINAL</button><button data-panel="problems">PROBLEMS <span id="problem-count">0</span></button></div><div class="panel-tools"><span id="shell-name">shell</span>${button('new-terminal', 'plus', 'New terminal')}${button('clear-terminal', 'refresh', 'Clear terminal')}${button('hide-panel', 'close', 'Hide panel')}</div></div><div class="terminal-host" id="terminal-host"></div><div class="problems-host" id="problems-host" hidden></div></section></main></div>
      <footer class="statusbar"><div><span class="status-orbit">${icon('orbit')}</span><button data-action="source-control" id="status-branch">${icon('git')}<span>No repository</span></button><button data-action="problems" id="status-problems">${icon('error')}<span>0</span>${icon('warning')}<span>0</span></button><span class="status-language" id="language-status"><span class="status-dot"></span>TypeScript LSP</span></div><div><button id="status-cursor" data-action="go-line">Ln 1, Col 1</button><button data-action="settings">Spaces: 2</button><span>UTF-8</span><button id="status-eol" data-action="toggle-eol">LF</button><span id="status-file-language">Plain text</span><button data-action="palette" title="Command palette">${icon('command')}</button></div></footer>
      <div class="modal-backdrop" id="palette-backdrop" hidden><div class="palette" role="dialog" aria-label="Command palette" aria-modal="true"><div class="palette-input-row">${icon('search')}<input id="palette-input" aria-label="Search commands or files" placeholder="Type a command…" autocomplete="off" spellcheck="false"><kbd>ESC</kbd></div><div class="palette-label" id="palette-label">COMMANDS</div><div class="palette-results" id="palette-results"></div><div class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span>orbit</span></div></div></div>
      <div class="modal-backdrop" id="prompt-backdrop" hidden><form class="prompt" id="prompt-form"><h2 id="prompt-title"></h2><label id="prompt-label" for="prompt-input"></label><input id="prompt-input" autocomplete="off" spellcheck="false" required><p>Paths are relative to the current workspace.</p><div><button type="button" data-action="cancel-prompt">Cancel</button><button type="submit" class="primary-button">Create</button></div></form></div><div class="toast" id="toast" role="status" hidden></div>`;
    this.primary = new EditorView({ change: doc => this.changed(doc), cursor: doc => this.cursor(doc), focus: view => this.focused = view, command: cmd => safely(() => this.command(cmd)) });
    this.focused = this.primary;
    this.primary.setFont(this.fontSize);
    this.terminal = new TerminalPanel($('#terminal-host'), shell => $('#shell-name').textContent = shell.replace('.exe', ''));
    this.events(); this.resizers();
  }

  async initialize(): Promise<void> {
    const { workspace } = await api.bootstrap(); this.workspace = workspace;
    this.updateWorkspaceLabels();
    await this.refreshTree();
    this.restore();
    if (!this.docs.length) {
      try { await this.open(this.files.find(file => baseName(file) === 'main.ts') ?? this.files.find(file => /\.md$/i.test(file)) ?? this.files[0]); }
      catch { this.showWelcome(); }
    }
    void this.refreshGit();
    await this.terminal.start();
    this.renderProblems();
  }

  private events(): void {
    document.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action) safely(() => this.command(action));
      const mode = target.closest<HTMLElement>('[data-mode]')?.dataset.mode;
      if (mode) this.setMode(mode as typeof this.mode);
      const tab = target.closest<HTMLElement>('[data-tab]');
      if (tab && !target.closest('[data-close-tab]')) { const doc = this.docs.find(d => d.id === tab.dataset.tab); if (doc) this.activate(doc); }
      const close = target.closest<HTMLElement>('[data-close-tab]');
      if (close) { const doc = this.docs.find(d => d.id === close.dataset.closeTab); if (doc) safely(() => this.close(doc)); }
      const panel = target.closest<HTMLElement>('[data-panel]')?.dataset.panel;
      if (panel) this.showPanel(panel as typeof this.panel);
    });
    document.addEventListener('keydown', event => this.keydown(event), { capture: true });
    $('#palette-input').addEventListener('input', () => this.renderPalette());
    $('#palette-input').addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); this.paletteIndex = (this.paletteIndex + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, this.paletteRows.length)) % Math.max(1, this.paletteRows.length); this.drawPalette(); }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.choosePalette(this.paletteIndex); }
    });
    $('#palette-backdrop').addEventListener('mousedown', event => { if (event.target === $('#palette-backdrop')) this.closePalette(); });
    $('#palette-results').addEventListener('click', event => { const index = (event.target as HTMLElement).closest<HTMLElement>('[data-palette-index]')?.dataset.paletteIndex; if (index !== undefined) this.choosePalette(Number(index)); });
    $('#sidebar-content').addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-path]'); if (!target) return;
      const file = target.dataset.path!;
      if (target.dataset.kind === 'directory') safely(async () => { if (this.expanded.has(file)) this.expanded.delete(file); else { this.expanded.add(file); this.directories.set(file, await api.list(file)); } this.renderTree(); });
      else safely(async () => { await this.open(file); if (target.dataset.line) this.focused.goTo(Number(target.dataset.line), Number(target.dataset.column ?? 1)); });
    });
    api.onCommand(cmd => safely(() => this.command(cmd)));
    api.onFile(event => {
      clearTimeout(this.watcherTimer); this.watcherTimer = setTimeout(() => { void this.refreshTree(); void this.refreshGit(); }, 350);
      const doc = this.docs.find(d => d.path === event.path);
      if (!doc) return;
      if (event.type === 'unlink') { doc.deleted = true; doc.external = true; this.updateChrome(); return; }
      if (event.type === 'change' || event.type === 'add') safely(async () => {
        const snapshot = doc.snapshot();
        const data = await api.read(event.path);
        if (!this.docs.includes(doc) || doc.path !== event.path) return;
        if (data.hash === doc.hash) return;
        if (!doc.dirty && doc.unchanged(snapshot) && !this.saving.has(doc.id)) { doc.model.reconcile(data.text, doc.model.selection); doc.saved(data); this.syncViews(doc); await api.languageChange(doc.path, doc.model.text); }
        else doc.external = true;
        this.updateChrome(); this.persistSoon();
      });
    });
    api.onDiagnostics(items => {
      if (!items.length) return;
      const doc = this.docs.find(d => d.path === items[0].path); if (!doc) return;
      doc.diagnostics = items.filter(d => d.severity > 0); this.renderProblems(); this.syncViews(doc, false);
    });
    api.onLanguageStatus(status => { $('#language-status').title = status; $('#language-status').classList.toggle('offline', status.startsWith('Unavailable')); });
    $('#problems-host').addEventListener('click', event => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-problem-path]'); if (target) safely(async () => { await this.open(target.dataset.problemPath!); this.focused.goTo(Number(target.dataset.line), Number(target.dataset.column)); }); });
    window.addEventListener('beforeunload', () => this.persist());
  }

  private keydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (event.key === 'Escape') { this.closePalette(); $('#prompt-backdrop').hidden = true; return; }
    let command = '';
    if (mod && key === 's') command = event.shiftKey ? 'save-as' : 'save';
    if (mod && key === 'n') command = 'new-file';
    if (mod && key === 'o') command = event.shiftKey ? 'open-folder' : 'open-file';
    if (mod && key === 'p') { event.preventDefault(); event.stopPropagation(); this.openPalette(event.shiftKey ? 'commands' : 'files'); return; }
    if (mod && key === 'k') command = 'palette';
    if (mod && key === 'g') command = 'go-line';
    if (mod && key === '\\') command = 'split';
    if (mod && key === '`') command = 'toggle-terminal';
    if (mod && key === 'f' && event.shiftKey) command = 'project-search';
    if (mod && key === 'm' && event.shiftKey) command = 'problems';
    if (mod && key === ',') command = 'settings';
    if (mod && key === 'w') command = 'close-file';
    if (event.altKey && event.shiftKey && key === 'f') command = 'format';
    if (event.key === 'F5') command = 'run';
    if (mod && event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); if (!this.docs.length) return;
      const at = this.docs.indexOf(this.active!); this.activate(this.docs[(at + (event.shiftKey ? -1 : 1) + this.docs.length) % this.docs.length]); return;
    }
    if (mod && (key === '=' || key === '+' || key === '-')) { event.preventDefault(); event.stopPropagation(); this.setFont(this.fontSize + (key === '-' ? -1 : 1)); return; }
    if (command) { event.preventDefault(); event.stopPropagation(); safely(() => this.command(command)); }
  }

  private async command(command: string): Promise<void> {
    switch (command) {
      case 'palette': this.openPalette('commands'); break;
      case 'menu-file': this.openPalette('commands', 'file'); break;
      case 'menu-edit': this.openPalette('commands', 'format'); break;
      case 'menu-view': this.openPalette('commands', 'show'); break;
      case 'quick-open': this.openPalette('files'); break;
      case 'go-line': this.openPalette('line'); break;
      case 'open-folder': await this.chooseFolder(); break;
      case 'open-file': { const data = await api.openFile(); if (data) this.openData(data); break; }
      case 'new-file': { const doc = new Document(`Untitled-${this.docs.filter(d => !d.path).length + 1}.ts`); this.docs.push(doc); this.activate(doc); break; }
      case 'create-file': await this.create('file'); break;
      case 'create-folder': await this.create('directory'); break;
      case 'save': if (this.active) await this.save(this.active); break;
      case 'save-as': if (this.active) await this.save(this.active, true); break;
      case 'save-all': await this.saveAll(); break;
      case 'close-file': if (this.active) await this.close(this.active); break;
      case 'refresh': await this.refreshTree(); break;
      case 'find': this.focused.openFind(); break;
      case 'project-search': this.setMode('search'); $('#project-search').focus(); break;
      case 'source-control': this.setMode('git'); break;
      case 'settings': this.setMode('settings'); break;
      case 'split': this.toggleSplit(); break;
      case 'toggle-terminal': if (this.panelVisible && this.panel === 'terminal') this.hidePanel(); else { this.showPanel('terminal'); this.terminal.focus(); } break;
      case 'hide-panel': this.hidePanel(); break;
      case 'problems': this.showPanel('problems'); break;
      case 'new-terminal': this.terminal.stop(); this.showPanel('terminal'); await this.terminal.start(); this.terminal.focus(); break;
      case 'clear-terminal': this.terminal.clear(); break;
      case 'format': await this.format(); break;
      case 'definition': await this.definition(); break;
      case 'hover': await this.focused.showHover(); break;
      case 'run': await this.run(); break;
      case 'reload-file': await this.reload(); break;
      case 'overwrite-file': if (this.active) await this.save(this.active, false, true); break;
      case 'toggle-eol': if (this.active) { this.active.eol = this.active.eol === 'LF' ? 'CRLF' : 'LF'; $('#status-eol').textContent = this.active.eol; this.updateChrome(); this.persistSoon(); toast(`Line endings set to ${this.active.eol}. Save to apply.`); } break;
      case 'welcome': this.showWelcome(); break;
      case 'cancel-prompt': $('#prompt-backdrop').hidden = true; break;
      case 'font-increase': this.setFont(this.fontSize + 1); break;
      case 'font-decrease': this.setFont(this.fontSize - 1); break;
      case 'minimize': api.window('minimize'); break;
      case 'maximize': api.window('maximize'); break;
      case 'close-window': api.window('close'); break;
      case 'quit': if (await this.confirmUnsaved('Save your changes before closing Orbit?')) { this.persist(); api.closeReady(); } break;
    }
  }

  private updateWorkspaceLabels(): void {
    $('#title-workspace').textContent = this.workspace.name;
    $('#workspace-location').textContent = this.workspace.name; $('#workspace-location').title = this.workspace.path;
    document.title = `${this.workspace.name} — Orbit`;
  }
  private async chooseFolder(): Promise<void> {
    if (!(await this.confirmUnsaved('Save your changes before switching workspaces?'))) return;
    const next = await api.chooseFolder(); if (!next) return;
    this.persist(); this.workspaceTicket++; this.searchTicket++; clearTimeout(this.searchTimer);
    for (const timer of this.languageTimers.values()) clearTimeout(timer);
    this.languageTimers.clear(); this.workspace = next; this.docs = []; this.active = undefined;
    this.secondary?.dispose(); this.secondary = undefined; this.focused = this.primary; this.primary.clearDocument();
    this.terminal.stop(); this.gitInfo = null; this.directories.clear(); this.expanded.clear(); this.updateWorkspaceLabels();
    await this.refreshTree(); this.restore(); this.renderProblems();
    if (!this.docs.length) this.showWelcome();
    void this.refreshGit(); if (this.panelVisible && this.panel === 'terminal') await this.terminal.start();
  }
  private async confirmUnsaved(message: string): Promise<boolean> {
    if (!this.docs.some(d => d.dirty)) return true;
    const choice = await api.confirm(message, 'Unsaved files: ' + this.docs.filter(d => d.dirty).map(d => d.name).join(', '), ['Save All', 'Discard Changes', 'Cancel']);
    if (choice === 2) return false;
    if (choice === 0) return await this.saveAll() && !this.docs.some(d => d.dirty);
    // Discard is explicit: recovery must not resurrect the discarded buffers.
    this.docs = this.docs.filter(doc => Boolean(doc.path) && !doc.deleted);
    for (const doc of this.docs) if (doc.dirty) { doc.model.reconcile(doc.savedText, [{ anchor: 0, head: 0 }]); doc.eol = doc.savedEol; }
    for (const doc of this.docs) this.syncViews(doc); this.updateChrome();
    return true;
  }

  private async refreshTree(): Promise<void> {
    const root = this.workspace.path, ticket = this.workspaceTicket;
    const entries = await api.list();
    if (ticket !== this.workspaceTicket) return;
    this.directories.set(root, entries);
    for (const dir of this.expanded) { try { this.directories.set(dir, await api.list(dir)); } catch { this.expanded.delete(dir); } }
    const files = await api.files();
    if (ticket !== this.workspaceTicket) return;
    this.files = files;
    if (this.mode === 'files') this.renderTree();
  }
  private renderTree(): void {
    if (this.mode !== 'files') return;
    const html: string[] = [];
    if (this.docs.length) {
      html.push(`<div class="tree-section">${icon('down')} OPEN EDITORS <span>${this.docs.length}</span></div>`);
      for (const doc of this.docs) html.push(`<button class="open-editor ${this.active === doc ? 'selected' : ''}" data-tab="${doc.id}">${fileIcon(doc.name)}<span>${escapeHTML(doc.name)}</span>${doc.dirty ? '<span class="dirty-dot"></span>' : ''}</button>`);
    }
    html.push(`<div class="tree-section workspace-tree-heading">${icon('down')} <span>${escapeHTML(this.workspace.name.toUpperCase())}</span><span class="workspace-badge">WORKSPACE</span></div>`);
    const walk = (directory: string, depth: number) => {
      for (const entry of this.directories.get(directory) ?? []) {
        const isDir = entry.kind === 'directory', expanded = this.expanded.has(entry.path);
        const status = this.gitInfo?.files.find(f => f.path === entry.path)?.status;
        html.push(`<button class="tree-entry ${isDir ? 'directory' : ''} ${entry.path === this.active?.path ? 'selected' : ''}" style="padding-left:${14 + depth * 16}px" data-path="${escapeHTML(entry.path)}" data-kind="${entry.kind}" title="${escapeHTML(relative(entry.path, this.workspace.path))}">${isDir ? `${icon(expanded ? 'down' : 'chevron', 'tree-chevron')}${icon(expanded ? 'folderOpen' : 'folder', 'tree-folder')}` : `<span class="tree-spacer"></span>${fileIcon(entry.name)}`}<span>${escapeHTML(entry.name)}</span>${status ? `<small class="git-status">${escapeHTML(status)}</small>` : ''}</button>`);
        if (expanded) walk(entry.path, depth + 1);
      }
    };
    walk(this.workspace.path, 0);
    if (!this.files.length) html.push(`<div class="sidebar-empty">Your next idea starts here.<button class="text-button" data-action="create-file">Create a file ${icon('arrow')}</button></div>`);
    $('#sidebar-content').innerHTML = html.join('');
  }
  private setMode(mode: typeof this.mode): void {
    this.searchTicket++; clearTimeout(this.searchTimer);
    this.mode = mode;
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
    $('#sidebar-title').textContent = { files: 'EXPLORER', search: 'SEARCH', git: 'SOURCE CONTROL', settings: 'PREFERENCES' }[mode];
    $('#sidebar-tools').hidden = mode !== 'files';
    if (mode === 'files') this.renderTree();
    if (mode === 'search') this.renderSearch();
    if (mode === 'git') { this.renderGit(); void this.refreshGit(); }
    if (mode === 'settings') this.renderSettings();
  }
  private renderSearch(): void {
    $('#sidebar-content').innerHTML = `<div class="search-controls"><div class="search-field">${icon('search')}<input id="project-search" placeholder="Search workspace…" aria-label="Search workspace" spellcheck="false"></div><label class="search-option"><input type="checkbox" id="case-sensitive"> Match case</label><p id="search-summary">Search text across your project.</p></div><div id="search-results"></div>`;
    const search = () => { clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => safely(() => this.projectSearch()), 220); };
    $('#project-search').addEventListener('input', search); $('#case-sensitive').addEventListener('change', search);
  }
  private async projectSearch(): Promise<void> {
    const query = $<HTMLInputElement>('#project-search').value, ticket = ++this.searchTicket;
    $('#search-summary').textContent = query ? 'Searching…' : 'Search text across your project.';
    const result = await api.search(query, $<HTMLInputElement>('#case-sensitive').checked);
    if (ticket !== this.searchTicket || this.mode !== 'search') return;
    $('#search-summary').textContent = `${result.hits.length}${result.truncated ? '+' : ''} results ${query ? `for “${query}”` : ''}`;
    let last = '';
    $('#search-results').innerHTML = result.hits.map(hit => {
      const title = hit.path !== last ? `<div class="search-file">${fileIcon(hit.path)}${escapeHTML(relative(hit.path, this.workspace.path))}</div>` : ''; last = hit.path;
      return `${title}<button class="search-hit" data-kind="file" data-path="${escapeHTML(hit.path)}" data-line="${hit.line}" data-column="${hit.column}"><small>${hit.line}</small><span>${escapeHTML(hit.text.trim())}</span></button>`;
    }).join('');
  }
  private async refreshGit(): Promise<void> {
    const ticket = this.workspaceTicket, info = await api.git();
    if (ticket !== this.workspaceTicket) return;
    this.gitInfo = info;
    $('#status-branch').innerHTML = `${icon('git')}<span>${escapeHTML(this.gitInfo?.branch ?? 'No repository')}</span>`;
    const badge = $<HTMLElement>('.git-count'); badge.hidden = !this.gitInfo?.files.length; badge.textContent = String(this.gitInfo?.files.length ?? 0);
    if (this.mode === 'git') this.renderGit(); else if (this.mode === 'files') this.renderTree();
  }
  private renderGit(): void {
    if (!this.gitInfo) { $('#sidebar-content').innerHTML = `<div class="sidebar-empty">${icon('git')}<h3>No Git repository</h3><p>Open a folder with a Git repository to see its branch and changed files.</p><button class="text-button" data-action="open-folder">Open folder ${icon('arrow')}</button></div>`; return; }
    $('#sidebar-content').innerHTML = `<div class="git-heading">${icon('git')}<strong>${escapeHTML(this.gitInfo.branch)}</strong><span>${this.gitInfo.files.length} changes</span></div><div class="tree-section">WORKING TREE</div>${this.gitInfo.files.map(file => `<button class="tree-entry" data-path="${escapeHTML(file.path)}" data-kind="file">${fileIcon(file.path)}<span>${escapeHTML(relative(file.path, this.workspace.path))}</span><small class="git-status">${escapeHTML(file.status)}</small></button>`).join('')}${!this.gitInfo.files.length ? '<div class="sidebar-empty">Your working tree is clean.</div>' : ''}<div class="sidebar-note">Use the terminal to stage, commit, and push changes.</div>`;
  }
  private renderSettings(): void {
    $('#sidebar-content').innerHTML = `<div class="preferences"><span class="eyebrow">MAKE IT YOURS</span><h2>A little more you.</h2><p>A focused environment for the way you think.</p><label>Editor font size</label><div class="font-control">${button('font-decrease', 'minimize', 'Decrease font')}<span>${this.fontSize}px</span>${button('font-increase', 'plus', 'Increase font')}</div><label>Color theme</label><div class="theme-preview"><span></span><span></span><span></span><span></span><strong>Midnight mint</strong>${icon('check')}</div><label>Keyboard essentials</label><div class="shortcut-list"><span>Commands<kbd>Ctrl Shift P</kbd></span><span>Find a file<kbd>Ctrl P</kbd></span><span>Save<kbd>Ctrl S</kbd></span><span>Multi-cursor<kbd>Ctrl D</kbd></span><span>Add cursor<kbd>Alt Click</kbd></span><span>Type information<kbd>F1</kbd></span><span>Definition<kbd>F12</kbd></span><span>Run file<kbd>F5</kbd></span></div><div class="preferences-about">${icon('orbit')}<strong>Orbit</strong><span>0.1.0 · Built from curiosity.</span></div></div>`;
  }
  private setFont(size: number): void {
    this.fontSize = Math.min(24, Math.max(11, size)); localStorage.setItem('orbit-font', String(this.fontSize));
    this.primary.setFont(this.fontSize); this.secondary?.setFont(this.fontSize); if (this.mode === 'settings') this.renderSettings();
  }

  private async open(path?: string): Promise<void> {
    if (!path) { this.showWelcome(); return; }
    const existing = this.docs.find(d => d.path === path);
    if (existing) { this.activate(existing); return; }
    const ticket = this.workspaceTicket, data = await api.read(path);
    if (ticket === this.workspaceTicket) this.openData(data);
  }
  private openData(data: FileData): void {
    const existing = this.docs.find(d => d.path === data.path);
    if (existing) { this.activate(existing); return; }
    const doc = new Document(baseName(data.path), data.text, data); this.docs.push(doc); this.activate(doc);
    void api.languageOpen(doc.path, doc.model.text).catch(() => {});
  }
  private activate(doc: Document): void {
    this.active = doc;
    $('#welcome').hidden = true;
    if (!this.primary.element.isConnected) $('#editors').append(this.primary.element);
    this.primary.element.hidden = false;
    if (this.secondary) this.secondary.element.hidden = false;
    if (this.focused === this.secondary && this.secondary) this.secondary.setDocument(doc);
    else { this.focused = this.primary; this.primary.setDocument(doc); }
    this.updateChrome(); this.cursor(doc); this.focused.textarea.focus(); this.persistSoon();
  }
  private updateChrome(): void {
    $('.tabs').innerHTML = this.docs.map(doc => `<div class="tab ${this.active === doc ? 'active' : ''}" role="tab" aria-selected="${this.active === doc}" data-tab="${doc.id}" title="${escapeHTML(doc.path || doc.name)}">${fileIcon(doc.name)}<span>${escapeHTML(doc.name)}</span>${doc.dirty ? '<span class="dirty-dot"></span>' : ''}<button class="tab-close" data-close-tab="${doc.id}" aria-label="Close ${escapeHTML(doc.name)}">${icon('close')}</button></div>`).join('') || '<div class="welcome-tab">' + icon('orbit') + ' Welcome</div>';
    const path = this.active?.path ? relative(this.active.path, this.workspace.path).split('/') : [this.active?.name ?? 'Welcome'];
    $('#breadcrumb-path').innerHTML = `<span>${escapeHTML(this.workspace.name)}</span>${path.map(part => `${icon('chevron')}<span>${escapeHTML(part)}</span>`).join('')}`;
    const banner = $('.external-banner'); banner.hidden = !this.active?.external;
    if (this.active?.external) banner.querySelector('span')!.textContent = this.active.deleted ? 'This file was removed from disk. Save to restore it.' : 'This file changed on disk. Choose which version to keep.';
    api.setDirty(this.docs.some(doc => doc.dirty));
    if (this.mode === 'files') this.renderTree();
  }
  private changed(doc: Document): void {
    doc.diagnostics = []; this.renderProblems();
    this.syncViews(doc, false);
    this.updateChrome(); this.persistSoon();
    clearTimeout(this.languageTimers.get(doc.id));
    if (doc.path) this.languageTimers.set(doc.id, setTimeout(() => { this.languageTimers.delete(doc.id); if (this.docs.includes(doc)) void api.languageChange(doc.path, doc.model.text).catch(() => {}); }, 240));
  }
  private syncViews(doc: Document, sync = true): void {
    for (const view of [this.primary, this.secondary]) if (view?.doc === doc) view.refresh(sync || view !== this.focused);
  }
  private cursor(doc: Document): void {
    const selection = doc.model.selection.at(-1)!, pos = doc.model.position(selection.head);
    $('#status-cursor').textContent = doc.model.selection.length > 1 ? `${doc.model.selection.length} cursors` : `Ln ${pos.line}, Col ${pos.column}`;
    $('#status-eol').textContent = doc.eol; $('#status-file-language').textContent = languageFor(doc.name);
    if (this.active !== doc) { this.active = doc; this.updateChrome(); }
  }
  private async save(doc: Document, as = false, force = false): Promise<boolean> {
    const previous = this.saving.get(doc.id);
    const work = (async () => { if (previous) await previous.catch(() => false); return this.performSave(doc, as, force); })();
    this.saving.set(doc.id, work);
    try { return await work; } finally { if (this.saving.get(doc.id) === work) this.saving.delete(doc.id); }
  }
  private async performSave(doc: Document, as: boolean, force: boolean): Promise<boolean> {
    const text = doc.model.text, eol = doc.eol, oldPath = doc.path;
    try {
      const data = !doc.path || as ? await api.saveAs({ name: doc.name, text, eol, openPaths: this.docs.filter(other => other !== doc && other.path).map(other => other.path) }) : await api.save({ path: doc.path, text, hash: doc.hash, eol, force });
      if (!data) return false;
      const duplicate = this.docs.find(other => other !== doc && other.path.toLowerCase() === data.path.toLowerCase());
      if (duplicate) { duplicate.external = true; }
      if (oldPath && oldPath !== data.path) void api.languageClose(oldPath).catch(() => {});
      doc.saved(data, text, true); this.updateChrome(); this.persistSoon();
      void this.checkSaved(doc, data);
      void api.languageOpen(doc.path, doc.model.text).catch(() => {}); void this.refreshTree(); void this.refreshGit();
      toast(`Saved ${doc.name}`); return true;
    } catch (error) {
      if ((error as Error).message.includes('CONFLICT:')) {
        if (as || !oldPath) { toast('The Save As target changed on disk. Use Save As again to review the target.', true); return false; }
        doc.external = true; this.updateChrome();
        const choice = await api.confirm('The file changed on disk.', 'Overwrite the disk version with your changes, or cancel to review and reload it.', ['Overwrite', 'Cancel']);
        if (choice === 0) return this.performSave(doc, false, true);
        return false;
      }
      throw error;
    }
  }
  private async checkSaved(doc: Document, written: FileData): Promise<void> {
    try {
      const disk = await api.read(written.path);
      if (!this.docs.includes(doc) || doc.path !== written.path || doc.hash !== written.hash) return;
      if (disk.hash !== written.hash) { doc.external = true; this.updateChrome(); this.persistSoon(); }
    } catch {
      if (this.docs.includes(doc) && doc.path === written.path && doc.hash === written.hash) { doc.external = true; this.updateChrome(); this.persistSoon(); }
    }
  }
  private async saveAll(): Promise<boolean> { for (const doc of this.docs) if ((doc.dirty || this.saving.has(doc.id)) && !(await this.save(doc))) return false; return !this.docs.some(doc => doc.dirty); }
  private async close(doc: Document): Promise<void> {
    if (this.closing.has(doc.id)) return;
    this.closing.add(doc.id);
    try { await this.performClose(doc); } finally { this.closing.delete(doc.id); }
  }
  private async performClose(doc: Document): Promise<void> {
    if (doc.dirty) {
      const choice = await api.confirm(`Save changes to ${doc.name}?`, 'Your edits have not been saved to disk.', ['Save', 'Discard', 'Cancel']);
      if (choice === 2 || (choice === 0 && (!(await this.save(doc)) || doc.dirty))) return;
    }
    if (this.saving.has(doc.id)) { await this.saving.get(doc.id); if (doc.dirty) return; }
    clearTimeout(this.languageTimers.get(doc.id)); this.languageTimers.delete(doc.id);
    if (doc.path) void api.languageClose(doc.path).catch(() => {});
    const index = this.docs.indexOf(doc); if (index < 0) return; this.docs.splice(index, 1);
    if (this.secondary?.doc === doc) { this.secondary.dispose(); this.secondary = undefined; this.focused = this.primary; }
    if (this.active === doc || this.primary.doc === doc) {
      const next = this.docs[Math.min(index, this.docs.length - 1)];
      if (next) { this.focused = this.primary; this.activate(next); } else { this.active = undefined; this.showWelcome(); }
    }
    this.updateChrome(); this.persistSoon(); this.renderProblems();
  }
  private async reload(): Promise<void> {
    const doc = this.active; if (!doc?.path) return;
    if (doc.dirty && await api.confirm(`Reload ${doc.name}?`, 'Your unsaved edits will be replaced with the version on disk.', ['Reload', 'Cancel']) !== 0) return;
    const snapshot = doc.snapshot(), data = await api.read(doc.path);
    if (!this.docs.includes(doc) || !doc.unchanged(snapshot)) { toast('The document changed while reloading. Try again.', true); return; }
    doc.model.reconcile(data.text, [{ anchor: 0, head: 0 }]); doc.saved(data); this.syncViews(doc); this.updateChrome(); this.persistSoon(); await api.languageChange(doc.path, doc.model.text);
  }
  private async create(kind: 'file' | 'directory'): Promise<void> {
    $('#prompt-title').textContent = kind === 'file' ? 'Create a new file' : 'Create a new folder';
    $('#prompt-label').textContent = kind === 'file' ? 'File name or path' : 'Folder name';
    const input = $<HTMLInputElement>('#prompt-input'); input.value = ''; input.placeholder = kind === 'file' ? 'src/your-next-idea.ts' : 'src';
    $('#prompt-backdrop').hidden = false; input.focus();
    const form = $<HTMLFormElement>('#prompt-form');
    form.onsubmit = event => {
      event.preventDefault(); safely(async () => {
        const result = await api.create({ path: input.value.trim(), kind });
        $('#prompt-backdrop').hidden = true;
        // Reveal newly created nested files in the explorer.
        let parent = result.replace(/[\\/][^\\/]+$/, '');
        while (parent.length > this.workspace.path.length) { this.expanded.add(parent); parent = parent.replace(/[\\/][^\\/]+$/, ''); }
        await this.refreshTree(); if (kind === 'file') await this.open(result); else toast('Folder created');
      });
    };
  }

  private toggleSplit(): void {
    if (this.secondary) { this.secondary.dispose(); this.secondary = undefined; this.focused = this.primary; if (this.primary.doc) { this.active = this.primary.doc; this.updateChrome(); } return; }
    if (!this.active) return;
    this.secondary = new EditorView({ change: doc => this.changed(doc), cursor: doc => this.cursor(doc), focus: view => { this.focused = view; if (view.doc) this.cursor(view.doc); }, command: cmd => safely(() => this.command(cmd)) });
    this.secondary.setFont(this.fontSize); $('#editors').append(this.secondary.element); this.secondary.setDocument(this.active); this.focused = this.secondary; this.secondary.textarea.focus();
  }
  private showPanel(panel: typeof this.panel): void {
    this.panel = panel; this.panelVisible = true; $('.bottom-panel').hidden = false; $('.panel-resizer').hidden = false;
    $('#terminal-host').hidden = panel !== 'terminal'; $('#problems-host').hidden = panel !== 'problems';
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach(el => el.classList.toggle('active', el.dataset.panel === panel));
    if (panel === 'terminal') { void this.terminal.start(); setTimeout(() => this.terminal.resize(), 0); }
  }
  private hidePanel(): void { this.panelVisible = false; $('.bottom-panel').hidden = true; $('.panel-resizer').hidden = true; }
  private renderProblems(): void {
    const diagnostics = this.docs.flatMap(doc => doc.diagnostics);
    const errors = diagnostics.filter(d => d.severity === 1).length, warnings = diagnostics.filter(d => d.severity === 2).length;
    $('#problem-count').textContent = String(diagnostics.length);
    $('#status-problems').innerHTML = `${icon('error')}<span>${errors}</span>${icon('warning')}<span>${warnings}</span>`;
    $('#problems-host').innerHTML = diagnostics.length ? diagnostics.map(d => `<button class="problem-item" data-problem-path="${escapeHTML(d.path)}" data-line="${d.line}" data-column="${d.column}">${icon(d.severity === 1 ? 'error' : 'warning', d.severity === 1 ? 'error' : 'warning')}<span>${escapeHTML(d.message)}</span><small>${escapeHTML(baseName(d.path))}:${d.line}:${d.column}</small></button>`).join('') : `<div class="no-problems"><span>${icon('check')}</span><strong>All clear.</strong><p>No problems in your open files.</p></div>`;
  }
  private async format(): Promise<void> {
    const doc = this.active; if (!doc?.path) { toast('Save a JavaScript or TypeScript file to format it.'); return; }
    const snapshot = doc.snapshot();
    await api.languageChange(doc.path, doc.model.text);
    const edits = await api.format(doc.path);
    if (!this.docs.includes(doc) || !doc.unchanged(snapshot)) { toast('Document changed; formatting was skipped. Run Format again.'); return; }
    if (edits.length) { doc.model.apply(edits, doc.model.selection); this.syncViews(doc); this.changed(doc); toast('Document formatted'); }
    else toast('No formatting changes');
  }
  private async definition(): Promise<void> {
    const doc = this.active; if (!doc?.path) return;
    const snapshot = doc.snapshot(), at = this.focused.textarea.selectionStart;
    await api.languageChange(doc.path, doc.model.text);
    const result = await api.definition(doc.path, at);
    if (this.active !== doc || !doc.unchanged(snapshot)) return;
    if (!result) { toast('No definition found here.'); return; }
    await this.open(result.path); this.focused.goTo(result.line, result.column);
  }
  private async run(): Promise<void> {
    const doc = this.active; if (!doc) return;
    if (doc.dirty || !doc.path) { if (!(await this.save(doc)) || doc.dirty) return; }
    const ext = doc.path.split('.').at(-1)?.toLowerCase();
    const runner = /^(ts|js|mjs|cjs)$/.test(ext ?? '') ? 'node' : ext === 'py' ? 'python' : '';
    if (!runner) { toast('Run supports .ts, .js, .mjs, .cjs and .py files. Other tools can run in the terminal.'); return; }
    this.showPanel('terminal');
    const escaped = doc.path.replace(/'/g, "''");
    const onWindows = navigator.userAgent.includes('Windows');
    const quoted = onWindows ? `'${escaped}'` : `'${doc.path.replace(/'/g, "'\\''")}'`;
    await this.terminal.run(`${runner} ${quoted}`);
  }

  private openPalette(kind: typeof this.paletteKind, initial = ''): void {
    this.paletteKind = kind; $('#palette-backdrop').hidden = false;
    const input = $<HTMLInputElement>('#palette-input'); input.value = initial;
    input.placeholder = kind === 'commands' ? 'Type a command…' : kind === 'files' ? 'Find a file by name…' : 'Go to line (e.g. 24:3)…';
    $('#palette-label').textContent = kind === 'commands' ? 'COMMANDS' : kind === 'files' ? 'FILES IN WORKSPACE' : 'GO TO LINE';
    input.focus(); this.renderPalette();
  }
  private closePalette(): void { if (!$('#palette-backdrop').hidden) { $('#palette-backdrop').hidden = true; this.focused.textarea.focus(); } }
  private renderPalette(): void {
    const query = $<HTMLInputElement>('#palette-input').value.toLowerCase().trim();
    if (this.paletteKind === 'commands') this.paletteRows = this.commands.filter(c => c.label.toLowerCase().includes(query)).map(c => ({ label: c.label, detail: c.key, icon: c.icon, run: () => safely(() => this.command(c.id)) }));
    if (this.paletteKind === 'files') {
      const score = (file: string) => {
        const target = relative(file, this.workspace.path).toLowerCase(); let at = -1, n = 0;
        for (const char of query) { const next = target.indexOf(char, at + 1); if (next < 0) return -1; n += next === at + 1 ? 4 : 1; at = next; }
        return n + (baseName(file).toLowerCase().startsWith(query) ? 20 : 0) - target.length * .01;
      };
      this.paletteRows = this.files.map(file => ({ file, score: score(file) })).filter(f => f.score >= 0).sort((a, b) => b.score - a.score).slice(0, 60).map(({ file }) => ({ label: baseName(file), detail: relative(file, this.workspace.path), icon: 'files', run: () => safely(() => this.open(file)) }));
    }
    if (this.paletteKind === 'line') {
      const [line, column] = query.split(':').map(Number);
      this.paletteRows = [{ label: `Go to line ${line > 0 ? line : 1}${column > 0 ? `, column ${column}` : ''}`, detail: this.active?.name ?? '', icon: 'arrow', run: () => this.focused.goTo(line || 1, column || 1) }];
    }
    this.paletteIndex = 0; this.drawPalette();
  }
  private drawPalette(): void {
    $('#palette-results').innerHTML = this.paletteRows.map((row, i) => `<button class="palette-item ${i === this.paletteIndex ? 'selected' : ''}" data-palette-index="${i}">${this.paletteKind === 'files' ? fileIcon(row.label) : icon(row.icon)}<span>${escapeHTML(row.label)}</span><small>${escapeHTML(row.detail)}</small></button>`).join('') || '<div class="palette-empty">No matches. Try a different search.</div>';
    $('#palette-results .selected')?.scrollIntoView({ block: 'nearest' });
  }
  private choosePalette(index: number): void { const row = this.paletteRows[index]; if (!row) return; this.closePalette(); row.run(); }

  private showWelcome(): void {
    this.primary.element.hidden = true; if (this.secondary) this.secondary.element.hidden = true;
    $('#welcome').hidden = false;
    $('#welcome').innerHTML = `<div class="welcome-content"><div class="welcome-mark">${icon('orbit')}</div><span class="eyebrow">YOUR SPACE TO BUILD</span><h1>Small beginnings.<br><span>Infinite possibilities.</span></h1><p>A quiet place for your next big idea.<br>Open a project, follow your curiosity, make something yours.</p><div class="welcome-actions"><button class="primary-button" data-action="open-folder">${icon('folderOpen')}Open a folder<kbd>Ctrl Shift O</kbd></button><button data-action="new-file">${icon('newFile')}Create a file${icon('arrow')}</button></div><div class="welcome-divider"></div><div class="welcome-tips"><div>${icon('command')}<strong>Find your flow</strong><p>Every command, one shortcut.</p><kbd>Ctrl Shift P</kbd></div><div>${icon('code')}<strong>Built from the buffer up</strong><p>Custom editor. Real language tools.</p><span>Piece table + LSP</span></div></div><div class="welcome-bottom"><span class="status-dot"></span>Local by nature. Yours by design.<span>ORBIT / 0.1</span></div></div>`;
    this.updateChrome();
  }
  private persistSoon(): void { clearTimeout(this.persistTimer); this.persistTimer = setTimeout(() => this.persist(), 400); }
  private persist(): void {
    if (!this.workspace) return;
    try {
      const session = { active: this.active?.id, docs: this.docs.map(doc => ({ id: doc.id, path: doc.path, name: doc.name, text: doc.model.text, savedText: doc.savedText, hash: doc.hash, eol: doc.eol, savedEol: doc.savedEol, deleted: doc.deleted, external: doc.external, selection: doc.model.selection, scrollTop: doc.scrollTop })) };
      localStorage.setItem(`orbit-session:${this.workspace.path}`, JSON.stringify(session));
      document.body.classList.remove('recovery-failed'); $('#recovery-warning')?.remove();
    } catch {
      document.body.classList.add('recovery-failed');
      if (!$('#recovery-warning')) { const warning = document.createElement('div'); warning.id = 'recovery-warning'; warning.setAttribute('role', 'alert'); warning.textContent = 'Session recovery could not be saved. Save your files to disk before closing.'; $('#editors').before(warning); }
    }
  }
  private restore(): void {
    try {
      const raw = localStorage.getItem(`orbit-session:${this.workspace.path}`); if (!raw) return;
      const session = JSON.parse(raw);
      for (const item of session.docs) {
        const doc = new Document(item.name, item.text);
        Object.assign(doc, { id: item.id, path: item.path, savedText: item.savedText, hash: item.hash, eol: item.eol, savedEol: item.savedEol ?? item.eol, deleted: Boolean(item.deleted), external: Boolean(item.external), scrollTop: item.scrollTop });
        doc.model.selection = item.selection;
        this.docs.push(doc);
        if (doc.path) {
          void api.languageOpen(doc.path, doc.model.text).catch(() => {});
          const snapshot = doc.snapshot();
          void api.read(doc.path).then(data => {
            if (!this.docs.includes(doc)) return;
            if (data.hash !== doc.hash) {
              if (!doc.dirty && doc.unchanged(snapshot)) { doc.model.reconcile(data.text, doc.model.selection); doc.saved(data); this.syncViews(doc); void api.languageChange(doc.path, doc.model.text).catch(() => {}); }
              else doc.external = true;
              this.updateChrome();
            }
          }).catch(() => { if (this.docs.includes(doc)) { doc.deleted = true; doc.external = true; this.updateChrome(); } });
        }
      }
      const active = this.docs.find(d => d.id === session.active) ?? this.docs[0]; if (active) this.activate(active);
    } catch { this.docs = []; }
  }
  private resizers(): void {
    const attach = (selector: string, vertical: boolean) => {
      const handle = $(selector);
      handle.addEventListener('pointerdown', event => {
        handle.setPointerCapture(event.pointerId); handle.classList.add('dragging');
        const move = (e: PointerEvent) => {
          if (vertical) { const height = Math.min(window.innerHeight - 300, Math.max(120, window.innerHeight - e.clientY - 26)); $('.bottom-panel').style.height = `${height}px`; }
          else $('.sidebar').style.width = `${Math.min(440, Math.max(180, e.clientX - 52))}px`;
        };
        const stop = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.classList.remove('dragging'); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop, { once: true });
      });
    };
    attach('.sidebar-resizer', false); attach('.panel-resizer', true);
  }
}

const app = new OrbitApp();
safely(() => app.initialize());
