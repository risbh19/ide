import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export class TerminalPanel {
  private terminal?: Terminal;
  private fit?: FitAddon;
  private id = '';
  private buffer: { id: string; data?: string; exitCode?: number }[] = [];
  private observer: ResizeObserver;
  private unsubscribe: () => void;
  private starting = false;
  private started?: Promise<void>;
  private generation = 0;
  constructor(private host: HTMLElement, private onShell: (shell: string) => void) {
    this.unsubscribe = window.orbit.onTerminal(event => {
      if (!this.id && this.starting) { this.buffer.push(event); return; }
      if (event.id !== this.id) return;
      if (event.data) this.terminal?.write(event.data);
      if (event.exitCode !== undefined) { this.terminal?.writeln(`\r\n\x1b[90mProcess exited (${event.exitCode}). Use + to start a new shell.\x1b[0m`); this.id = ''; }
    });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
  }
  async start(): Promise<void> {
    if (this.starting) return this.started;
    if (this.id) { this.resize(); return; }
    this.started = this.initialize(); return this.started;
  }
  private async initialize(): Promise<void> {
    const generation = ++this.generation;
    this.starting = true;
    this.terminal?.dispose(); this.host.innerHTML = '';
    const terminal = this.terminal = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", monospace', fontSize: 12, lineHeight: 1.35,
      cursorBlink: true, allowProposedApi: false, scrollback: 5000, convertEol: false,
      theme: { background: '#11151b', foreground: '#b4becb', cursor: '#9ae4c1', selectionBackground: '#2b3c49', black: '#11151b', red: '#f18c8f', green: '#9ae4c1', yellow: '#e8cf92', blue: '#8eaff0', magenta: '#c5a2ee', cyan: '#8dd5e0', white: '#e3e9ef' },
    });
    this.fit = new FitAddon(); terminal.loadAddon(this.fit); terminal.open(this.host); this.fit.fit();
    try {
      const session = await window.orbit.terminalStart(terminal.cols, terminal.rows);
      if (generation !== this.generation) { window.orbit.terminalStop(session.id); return; }
      this.id = session.id; this.onShell(session.shell);
      for (const event of this.buffer) if (event.id === this.id && event.data) terminal.write(event.data);
      this.buffer = [];
      terminal.onData(text => { if (this.id) window.orbit.terminalWrite(this.id, text); });
      terminal.onResize(({ cols, rows }) => { if (this.id) window.orbit.terminalResize(this.id, cols, rows); });
    } catch (error) { if (generation === this.generation) terminal.writeln(`Could not start terminal: ${(error as Error).message}`); }
    finally { if (generation === this.generation) this.starting = false; }
  }
  resize(): void { if (this.host.clientHeight && this.host.clientWidth) { try { this.fit?.fit(); } catch {} } }
  focus(): void { this.terminal?.focus(); }
  clear(): void { this.terminal?.clear(); }
  async run(command: string): Promise<void> { await this.start(); if (this.id) { window.orbit.terminalWrite(this.id, command + '\r'); this.focus(); } }
  stop(): void { this.generation++; this.starting = false; this.buffer = []; if (this.id) window.orbit.terminalStop(this.id); this.id = ''; this.terminal?.dispose(); this.terminal = undefined; }
  dispose(): void { this.stop(); this.observer.disconnect(); this.unsubscribe(); }
}
