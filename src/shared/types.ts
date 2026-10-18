export interface FileEntry { name: string; path: string; kind: 'file' | 'directory' }
export interface FileData { path: string; text: string; hash: string; eol: 'LF' | 'CRLF' }
export interface Workspace { path: string; name: string; recent: string[] }
export interface SearchHit { path: string; line: number; column: number; text: string }
export interface Diagnostic { path: string; line: number; column: number; message: string; severity: number; start: number; end: number }
export interface Completion { label: string; detail?: string; insertText: string; start: number; end: number }
export interface Definition { path: string; line: number; column: number }
export interface Hover { text: string }
export interface TextEdit { start: number; end: number; text: string }
export interface FileEvent { type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }
export interface OrbitAPI {
  bootstrap(): Promise<{ workspace: Workspace; version: string }>;
  chooseFolder(): Promise<Workspace | null>;
  list(path?: string): Promise<FileEntry[]>;
  files(): Promise<string[]>;
  read(path: string): Promise<FileData>;
  openFile(): Promise<FileData | null>;
  save(input: { path: string; text: string; hash: string; eol: 'LF' | 'CRLF'; force?: boolean }): Promise<FileData>;
  saveAs(input: { name: string; text: string }): Promise<FileData | null>;
  create(input: { path: string; kind: 'file' | 'directory' }): Promise<string>;
  search(query: string, caseSensitive: boolean): Promise<{ hits: SearchHit[]; truncated: boolean }>;
  git(): Promise<{ branch: string; files: { path: string; status: string }[] } | null>;
  languageOpen(path: string, text: string): Promise<void>;
  languageChange(path: string, text: string): Promise<void>;
  complete(path: string, offset: number): Promise<Completion[]>;
  hover(path: string, offset: number): Promise<Hover | null>;
  definition(path: string, offset: number): Promise<Definition | null>;
  format(path: string): Promise<TextEdit[]>;
  terminalStart(cols: number, rows: number): Promise<{ id: string; shell: string }>;
  terminalWrite(id: string, text: string): void;
  terminalResize(id: string, cols: number, rows: number): void;
  terminalStop(id: string): void;
  confirm(message: string, detail: string, buttons: string[]): Promise<number>;
  setDirty(dirty: boolean): void;
  closeReady(): void;
  window(action: 'minimize' | 'maximize' | 'close'): void;
  onFile(callback: (event: FileEvent) => void): () => void;
  onDiagnostics(callback: (items: Diagnostic[]) => void): () => void;
  onLanguageStatus(callback: (status: string) => void): () => void;
  onTerminal(callback: (event: { id: string; data?: string; exitCode?: number }) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
}

declare global { interface Window { orbit: OrbitAPI } }
