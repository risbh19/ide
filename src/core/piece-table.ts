export interface Piece { source: 0 | 1; start: number; length: number }
export interface Selection { anchor: number; head: number }
export interface Edit { start: number; end: number; text: string }
interface History { pieces: Piece[]; selection: Selection[] }

/** Immutable original buffer + append-only additions. History shares both buffers. */
export class PieceTable {
  private original: string;
  private additions = '';
  private pieces: Piece[];
  private past: History[] = [];
  private future: History[] = [];
  private cached: string | undefined;
  private starts: number[] | undefined;
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
  private snapshot(): History { return { pieces: this.pieces.map(p => ({ ...p })), selection: this.selection.map(s => ({ ...s })) }; }
  private restore(state: History): void { this.pieces = state.pieces; this.selection = state.selection; this.invalidate(); }
  private invalidate(): void { this.cached = undefined; this.starts = undefined; this.version++; }
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
    this.past.push(this.snapshot());
    if (this.past.length > 500) this.past.shift();
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
  }
  /** Convert a native input/IME transaction into the smallest contiguous edit. */
  reconcile(text: string, selection: Selection[]): void {
    const before = this.text;
    if (before === text) { this.selection = selection; return; }
    let start = 0, a = before.length, b = text.length;
    while (start < a && start < b && before[start] === text[start]) start++;
    while (a > start && b > start && before[a - 1] === text[b - 1]) { a--; b--; }
    this.apply([{ start, end: a, text: text.slice(start, b) }], selection);
  }
  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.snapshot()); this.restore(previous); return true;
  }
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.snapshot()); this.restore(next); return true;
  }
}
