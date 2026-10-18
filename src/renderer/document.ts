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
  get dirty(): boolean { return this.model.text !== this.savedText || this.eol !== this.savedEol || (!this.path && this.model.length > 0); }
  saved(data: FileData, writtenText = data.text): void {
    this.path = data.path; this.name = data.path.split(/[\\/]/).at(-1)!; this.hash = data.hash;
    this.savedText = writtenText; this.eol = data.eol; this.savedEol = data.eol; this.external = false; this.deleted = false;
  }
}
