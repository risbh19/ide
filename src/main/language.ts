import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node';
import type { Completion, Definition, Diagnostic, Hover, TextEdit } from '../shared/types';

interface Position { line: number; character: number }
interface Range { start: Position; end: Position }
const supported = (file: string) => /\.(tsx?|jsx?|mjs|cjs)$/i.test(file);
const position = (text: string, offset: number): Position => { const rows = text.slice(0, offset).split('\n'); return { line: rows.length - 1, character: rows.at(-1)!.length }; };
const offset = (text: string, p: Position): number => { const rows = text.split('\n'); let n = 0; for (let i = 0; i < p.line && i < rows.length; i++) n += rows[i].length + 1; return Math.min(text.length, n + p.character); };

/** A real stdio LSP client. The renderer only sees normalized, serializable results. */
export class LanguageClient {
  private child?: ChildProcessWithoutNullStreams;
  private connection?: MessageConnection;
  private ready?: Promise<void>;
  private root = '';
  private documents = new Map<string, { text: string; version: number }>();
  constructor(private serverPath: string, private emit: (event: string, value: unknown) => void) {}

  start(root: string): void {
    this.root = root;
    const stopped = this.stop(); this.documents.clear();
    this.emit('language-status', 'Starting TypeScript…');
    this.ready = stopped.then(() => this.initialize(root)).catch(error => { this.emit('language-status', `Unavailable: ${(error as Error).message}`); throw error; });
    void this.ready.catch(() => {});
  }
  private async initialize(root: string): Promise<void> {
    const child = this.child = spawn(process.execPath, [this.serverPath, '--stdio'], {
      cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
    });
    child.on('error', error => this.emit('language-status', `Unavailable: ${error.message}`));
    child.stderr.on('data', () => {});
    const connection = this.connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
    connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: { range: Range; message: string; severity?: number }[] }) => {
      let file: string; try { file = fileURLToPath(params.uri); } catch { return; }
      // LSP URI libraries normalize Windows drive casing; keep the editor's original spelling.
      if (process.platform === 'win32') file = [...this.documents.keys()].find(key => key.toLowerCase() === file.toLowerCase()) ?? file;
      const text = this.documents.get(file)?.text ?? '';
      const diagnostics: Diagnostic[] = params.diagnostics.map(d => ({ path: file, line: d.range.start.line + 1, column: d.range.start.character + 1, start: offset(text, d.range.start), end: offset(text, d.range.end), message: d.message, severity: d.severity ?? 1 }));
      this.emit('diagnostics', diagnostics.length ? diagnostics : [{ path: file, line: 0, column: 0, start: 0, end: 0, message: '', severity: 0 }]);
    });
    connection.onRequest('workspace/configuration', (params: { items: unknown[] }) => params.items.map(() => ({})));
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.listen();
    await this.request('initialize', {
      processId: process.pid, rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
      capabilities: { textDocument: { completion: { completionItem: { snippetSupport: false } }, hover: { contentFormat: ['plaintext'] }, publishDiagnostics: { relatedInformation: true }, synchronization: { didSave: true } }, workspace: { configuration: true } },
      initializationOptions: { hostInfo: 'Orbit', preferences: { includeCompletionsForModuleExports: false } },
    });
    await connection.sendNotification('initialized', {});
    this.emit('language-status', 'TypeScript ready');
  }
  private async request<T>(method: string, params: unknown): Promise<T> {
    if (!this.connection) throw new Error('Language server is offline.');
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        this.connection.sendRequest<T>(method, params),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Language server timed out.')), 15000); }),
      ]);
    } finally { clearTimeout(timer!); }
  }
  async open(file: string, text: string): Promise<void> {
    if (!supported(file)) return;
    await this.ready;
    if (this.documents.has(file)) { await this.change(file, text); return; }
    this.documents.set(file, { text, version: 1 });
    await this.connection?.sendNotification('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: /\.tsx$/.test(file) ? 'typescriptreact' : /\.jsx$/.test(file) ? 'javascriptreact' : /\.ts$/.test(file) ? 'typescript' : 'javascript', version: 1, text } });
  }
  async change(file: string, text: string): Promise<void> {
    if (!supported(file)) return;
    await this.ready;
    const doc = this.documents.get(file);
    if (!doc) { await this.open(file, text); return; }
    doc.text = text; doc.version++;
    await this.connection?.sendNotification('textDocument/didChange', { textDocument: { uri: pathToFileURL(file).href, version: doc.version }, contentChanges: [{ text }] });
  }
  private params(file: string, at: number) { return { textDocument: { uri: pathToFileURL(file).href }, position: position(this.documents.get(file)?.text ?? '', at) }; }
  async complete(file: string, at: number): Promise<Completion[]> {
    if (!supported(file)) return [];
    await this.ready;
    const text = this.documents.get(file)?.text ?? '';
    const result = await this.request<any>('textDocument/completion', this.params(file, at));
    const prefix = /[\w$]*$/.exec(text.slice(0, at))![0];
    return (Array.isArray(result) ? result : result?.items ?? []).slice(0, 80).map((item: any) => ({ label: item.label, detail: item.detail, insertText: item.textEdit?.newText ?? item.insertText ?? item.label, start: item.textEdit?.range ? offset(text, item.textEdit.range.start) : at - prefix.length, end: item.textEdit?.range ? offset(text, item.textEdit.range.end) : at }));
  }
  async hover(file: string, at: number): Promise<Hover | null> {
    if (!supported(file)) return null;
    await this.ready;
    const result = await this.request<any>('textDocument/hover', this.params(file, at));
    const content = result?.contents;
    if (!content) return null;
    return { text: (Array.isArray(content) ? content : [content]).map(c => typeof c === 'string' ? c : c.value ?? '').join('\n\n') };
  }
  async definition(file: string, at: number): Promise<Definition | null> {
    if (!supported(file)) return null;
    await this.ready;
    const result = await this.request<any>('textDocument/definition', this.params(file, at));
    const item = Array.isArray(result) ? result[0] : result;
    if (!item) return null;
    const range = item.targetSelectionRange ?? item.range;
    let targetFile = fileURLToPath(item.targetUri ?? item.uri);
    if (process.platform === 'win32' && path.parse(targetFile).root.toLowerCase() === path.parse(this.root).root.toLowerCase()) targetFile = path.join(path.parse(this.root).root, targetFile.slice(path.parse(targetFile).root.length));
    return { path: targetFile, line: range.start.line + 1, column: range.start.character + 1 };
  }
  async format(file: string): Promise<TextEdit[]> {
    if (!supported(file)) return [];
    await this.ready;
    const text = this.documents.get(file)?.text ?? '';
    const result = await this.request<any[]>('textDocument/formatting', { textDocument: { uri: pathToFileURL(file).href }, options: { tabSize: 2, insertSpaces: true } });
    return (result ?? []).map(edit => ({ start: offset(text, edit.range.start), end: offset(text, edit.range.end), text: edit.newText }));
  }
  async stop(): Promise<void> {
    const connection = this.connection, child = this.child;
    this.connection = undefined; this.child = undefined;
    if (!child) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        connection?.sendRequest('shutdown').catch(() => {}),
        new Promise(resolve => timer = setTimeout(resolve, 1200)),
      ]);
      clearTimeout(timer);
      await connection?.sendNotification('exit').catch(() => {});
      child.stdin.end();
      if (child.exitCode === null) await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => timer = setTimeout(resolve, 1200)),
      ]);
      clearTimeout(timer);
      if (child.exitCode === null && child.pid) {
        if (process.platform === 'win32') await new Promise<void>(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
        else child.kill();
      }
    } finally { clearTimeout(timer); connection?.dispose(); }
  }
}
