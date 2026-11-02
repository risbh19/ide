export interface Piece { source: 0 | 1; start: number; length: number }
export interface Selection { anchor: number; head: number }
export interface Edit { start: number; end: number; text: string }
interface History { pieces: Piece[]; selection: Selection[]; cost: number }

/** Immutable original buffer + append-only additions. History shares both buffers. */
export class PieceTable {
  private original: string;
  private additions = '';
  private pieces: Piece[];
  private past: History[] = [];
  private future: History[] = [];
  private cached: string | undefined;
  private starts: number[] | undefined;
  private compactAt = 8 * 1024 * 1024;
  selection: Selection[] = [{ anchor: 0, head: 0 }];
  version = 0;

  constructor(text = '') {
    this.original = text;
    this.pieces = text.length ? [{ source: 0, start: 0, length: text.length }] : [];
  }
  get text(): string {
    return this.cached ??= this.pieces.map(p => (p.source ? this.additions : this.original).slice(p.start, p.start + p.length)).join('');
  }
  get length(): number { return this.pieces.reduce((n, p) => n + p.length, 0); }
  lineText(line: number): string { return this.text.slice(this.lineStarts[line - 1] ?? this.length, (this.lineStarts[line] ?? this.length + 1) - 1); }
  statistics() { return { pieces: this.pieces.length, additions: this.additions.length, undo: this.past.length, redo: this.future.length }; }
  get lineStarts(): number[] {
    if (!this.starts) {
      this.starts = [0];
      for (let i = 0; i < this.text.length; i++) if (this.text.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
    return this.starts;
  }
  position(offset: number): { line: number; column: number } {
    offset = Math.max(0, Math.min(offset, this.length));
    const lines = this.lineStarts;
    let low = 0, high = lines.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (lines[mid] <= offset) low = mid; else high = mid; }
    return { line: low + 1, column: offset - lines[low] + 1 };
  }
  offset(line: number, column = 1): number {
    const row = Math.max(0, Math.min(line - 1, this.lineStarts.length - 1));
    return Math.min(this.lineStarts[row] + Math.max(0, column - 1), (this.lineStarts[row + 1] ?? this.length + 1) - 1);
  }
  private snapshot(cost = 0): History { return { pieces: this.pieces.map(p => ({ ...p })), selection: this.selection.map(s => ({ ...s })), cost }; }
  private restore(state: History): void { this.pieces = state.pieces; this.selection = state.selection; this.invalidate(); }
  private invalidate(): void { this.cached = undefined; this.starts = undefined; this.version++; }
  private compact(): void {
    if (this.additions.length < this.compactAt) return;
    const all = [this.pieces, ...this.past.map(s => s.pieces), ...this.future.map(s => s.pieces)];
    const ranges = all.flat().filter(p => p.source === 1).map(p => ({ start: p.start, end: p.start + p.length, target: 0 })).sort((a, b) => a.start - b.start);
    const merged: typeof ranges = [];
    for (const range of ranges) { const last = merged.at(-1); if (last && range.start <= last.end) last.end = Math.max(last.end, range.end); else merged.push({ ...range }); }
    let size = 0;
    const chunks = merged.map(range => { range.target = size; size += range.end - range.start; return this.additions.slice(range.start, range.end); });
    for (const pieces of all) for (const piece of pieces) if (piece.source === 1) {
      let low = 0, high = merged.length;
      while (low + 1 < high) { const mid = (low + high) >>> 1; if (merged[mid].start <= piece.start) low = mid; else high = mid; }
      piece.start = merged[low].target + piece.start - merged[low].start;
    }
    this.additions = chunks.join(''); this.compactAt = this.additions.length + 8 * 1024 * 1024;
  }
  private range(start: number, end: number): Piece[] {
    const result: Piece[] = [];
    let offset = 0;
    for (const piece of this.pieces) {
      const a = Math.max(start, offset), b = Math.min(end, offset + piece.length);
      if (a < b) result.push({ source: piece.source, start: piece.start + a - offset, length: b - a });
      offset += piece.length;
      if (offset >= end) break;
    }
    return result;
  }
  apply(edits: Edit[], selection?: Selection[]): void {
    if (!edits.length) return;
    const sorted = [...edits].sort((a, b) => a.start - b.start);
    let lastEnd = -1;
    for (const edit of sorted) {
      if (edit.start < 0 || edit.end > this.length || edit.end < edit.start || edit.start < lastEnd) throw new RangeError('Edits must be in bounds and may not overlap.');
      lastEnd = edit.end;
    }
    let nextStarts: number[] | undefined;
    if (this.starts) {
      nextStarts = []; let index = 0, delta = 0;
      for (const edit of sorted) {
        while (index < this.starts.length && this.starts[index] <= edit.start) nextStarts.push(this.starts[index++] + delta);
        while (index < this.starts.length && this.starts[index] <= edit.end) index++;
        for (let i = 0; i < edit.text.length; i++) if (edit.text.charCodeAt(i) === 10) nextStarts.push(edit.start + delta + i + 1);
        delta += edit.text.length - (edit.end - edit.start);
      }
      while (index < this.starts.length) nextStarts.push(this.starts[index++] + delta);
    }
    this.past.push(this.snapshot(sorted.reduce((cost, edit) => cost + edit.text.length + edit.end - edit.start, 0)));
    let bytes = this.past.reduce((n, s) => n + s.cost * 2, 0), count = this.past.reduce((n, s) => n + s.pieces.length, 0);
    while (this.past.length > 1 && (this.past.length > 500 || bytes > 32 * 1024 * 1024 || count > 100000)) { const old = this.past.shift()!; bytes -= old.cost * 2; count -= old.pieces.length; }
    this.future = [];
    const next: Piece[] = [];
    let cursor = 0;
    for (const edit of sorted) {
      next.push(...this.range(cursor, edit.start));
      if (edit.text) { next.push({ source: 1, start: this.additions.length, length: edit.text.length }); this.additions += edit.text; }
      cursor = edit.end;
    }
    next.push(...this.range(cursor, this.length));
    this.pieces = [];
    for (const piece of next) {
      const previous = this.pieces.at(-1);
      if (previous && previous.source === piece.source && previous.start + previous.length === piece.start) previous.length += piece.length;
      else this.pieces.push(piece);
    }
    if (selection) this.selection = selection.map(s => ({ anchor: Math.max(0, Math.min(s.anchor, this.length)), head: Math.max(0, Math.min(s.head, this.length)) }));
    this.invalidate();
    this.starts = nextStarts;
    this.compact();
  }
  /** Convert a native input/IME transaction into the smallest contiguous edit. */
  reconcile(text: string, selection: Selection[], hint?: { selection: Selection; type: string }): void {
    const before = this.text;
    if (before === text) { this.selection = selection; return; }
    if (hint) {
      let start = Math.min(hint.selection.anchor, hint.selection.head), end = Math.max(hint.selection.anchor, hint.selection.head);
      const delta = text.length - before.length;
      if (hint.type === 'deleteContentBackward' && start === end && delta < 0) start = Math.max(0, start + delta);
      else if (hint.type === 'deleteContentForward' && start === end && delta < 0) end = Math.min(before.length, end - delta);
      if (hint.type === 'insertText' || hint.type === 'insertFromPaste' || hint.type === 'deleteContentBackward' || hint.type === 'deleteContentForward' || hint.type === 'deleteByCut') {
        const added = delta + end - start;
        if (added >= 0) { this.apply([{ start, end, text: text.slice(start, start + added) }], selection); return; }
      }
    }
    let start = 0, a = before.length, b = text.length;
    while (start < a && start < b && before[start] === text[start]) start++;
    while (a > start && b > start && before[a - 1] === text[b - 1]) { a--; b--; }
    this.apply([{ start, end: a, text: text.slice(start, b) }], selection);
  }
  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.snapshot(previous.cost)); this.restore(previous); return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.snapshot(next.cost)); this.restore(next); return true;
  }
}
