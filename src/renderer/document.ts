import { PieceTable } from '../core/piece-table';
import { Tokenizer } from '../core/tokenizer';
import type { Diagnostic, FileData } from '../shared/types';

export class Document {
  id = crypto.randomUUID();
  path = '';
  name: string;
  model: PieceTable;
  tokenizer = new Tokenizer();
  savedText: string;
  hash = '';
  eol: 'LF' | 'CRLF' = 'LF';
  savedEol: 'LF' | 'CRLF' = 'LF';
  external = false;
  deleted = false;
  diagnostics: Diagnostic[] = [];
  scrollTop = 0;
  scrollLeft = 0;
  constructor(name: string, text = '', data?: FileData) {
    this.name = name; this.savedText = text; this.model = new PieceTable(text);
    if (data) { this.path = data.path; this.hash = data.hash; this.eol = data.eol; this.savedEol = data.eol; }
  }
  get dirty(): boolean { return this.deleted || this.model.text !== this.savedText || this.eol !== this.savedEol || (!this.path && this.model.length > 0); }
  snapshot() { return { model: this.model, version: this.model.version, path: this.path, eol: this.eol, hash: this.hash }; }
  unchanged(snapshot: ReturnType<Document['snapshot']>): boolean {
    return this.model === snapshot.model && this.model.version === snapshot.version && this.path === snapshot.path && this.eol === snapshot.eol && this.hash === snapshot.hash;
  }
  saved(data: FileData, writtenText = data.text, preserveEol = false): void {
    this.path = data.path; this.name = data.path.split(/[\\/]/).at(-1)!; this.hash = data.hash;
    this.savedText = writtenText; if (!preserveEol) this.eol = data.eol; this.savedEol = data.eol; this.external = false; this.deleted = false;
  }
}
