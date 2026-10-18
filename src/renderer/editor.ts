import type { Completion } from '../shared/types';
import { escapeHTML, languageFor } from '../core/tokenizer';
import type { Edit, Selection } from '../core/piece-table';
import { Document } from './document';
import { icon } from './icons';

interface Callbacks {
  change(doc: Document): void;
  cursor(doc: Document): void;
  focus(view: EditorView): void;
  command(command: string): void;
}

export class EditorView {
  element = document.createElement('section');
  doc?: Document;
  textarea: HTMLTextAreaElement;
  private code: HTMLElement;
  private gutter: HTMLElement;
  private decorations: HTMLElement;
  private completion: HTMLElement;
  private tooltip: HTMLElement;
  private findbar: HTMLElement;
  private findInput: HTMLInputElement;
  private replaceInput: HTMLInputElement;
  private findCount: HTMLElement;
  private highlighted: string[] = [];
  private completions: Completion[] = [];
  private selectedCompletion = 0;
  private completionTicket = 0;
  private lineHeight = 24;
  private charWidth = 8.43;
  private fontSize = 14;
  private composing = false;
  private selectionFrame = 0;
  private observer: ResizeObserver;

  constructor(private callbacks: Callbacks) {
    this.element.className = 'editor-pane';
    this.element.innerHTML = `
      <div class="findbar" hidden><div class="find-row"><input class="find-input" aria-label="Find in file" placeholder="Find" spellcheck="false"><span class="find-count"></span><button data-find="previous" title="Previous match (Shift+Enter)" aria-label="Previous match">↑</button><button data-find="next" title="Next match (Enter)" aria-label="Next match">↓</button><button data-find="close" aria-label="Close find">${icon('close')}</button></div><div class="find-row"><input class="replace-input" aria-label="Replace with" placeholder="Replace" spellcheck="false"><button data-find="replace" title="Replace selection">Replace</button><button data-find="all" title="Replace all matches">All</button></div></div>
      <div class="code-viewport"><div class="line-highlight"></div><div class="gutter"></div><div class="highlight-layer" aria-hidden="true"><div class="code-lines"></div></div><div class="editor-decorations" aria-hidden="true"></div><textarea class="code-input" aria-label="Code editor" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea><div class="completions" hidden></div><pre class="hover-tooltip" hidden></pre></div>`;
    this.textarea = this.element.querySelector('textarea')!;
    this.code = this.element.querySelector('.code-lines')!;
    this.gutter = this.element.querySelector('.gutter')!;
    this.decorations = this.element.querySelector('.editor-decorations')!;
    this.completion = this.element.querySelector('.completions')!;
    this.tooltip = this.element.querySelector('.hover-tooltip')!;
    this.findbar = this.element.querySelector('.findbar')!;
    this.findInput = this.element.querySelector('.find-input')!;
    this.replaceInput = this.element.querySelector('.replace-input')!;
    this.findCount = this.element.querySelector('.find-count')!;
    this.textarea.addEventListener('input', () => this.input());
    this.textarea.addEventListener('keydown', event => this.keydown(event));
    this.textarea.addEventListener('beforeinput', event => this.beforeInput(event));
    this.textarea.addEventListener('scroll', () => { if (this.doc) { this.doc.scrollTop = this.textarea.scrollTop; this.doc.scrollLeft = this.textarea.scrollLeft; } this.render(); this.hideCompletion(); this.tooltip.hidden = true; });
    this.textarea.addEventListener('select', () => this.selection());
    this.textarea.addEventListener('keyup', () => this.selection());
    this.textarea.addEventListener('click', event => {
      if (event.altKey && this.doc) {
        const at = this.textarea.selectionStart;
        const prior = this.doc.model.selection.filter(s => s.head !== at);
        this.doc.model.selection = [...prior, { anchor: at, head: at }];
        this.render(); this.callbacks.cursor(this.doc);
      } else if (this.doc) { this.doc.model.selection = [this.nativeSelection()]; this.selection(); }
    });
    this.textarea.addEventListener('focus', () => { this.callbacks.focus(this); this.element.classList.add('focused'); });
    this.textarea.addEventListener('blur', () => { this.element.classList.remove('focused'); this.tooltip.hidden = true; });
    this.textarea.addEventListener('compositionstart', () => { this.composing = true; this.hideCompletion(); });
    this.textarea.addEventListener('compositionend', () => { this.composing = false; this.input(); });
    this.textarea.addEventListener('paste', event => {
      if ((this.doc?.model.selection.length ?? 0) > 1) { event.preventDefault(); this.insert(event.clipboardData?.getData('text/plain').replace(/\r\n/g, '\n') ?? ''); }
    });
    this.completion.addEventListener('mousedown', event => {
      event.preventDefault(); const item = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (item) this.acceptCompletion(Number(item.dataset.index));
    });
    this.findInput.addEventListener('input', () => { this.render(); this.updateFindCount(); });
    this.findInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); this.findNext(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') this.closeFind(); });
    this.findbar.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-find]')?.dataset.find;
      if (action === 'close') this.closeFind();
      if (action === 'next' || action === 'previous') this.findNext(action === 'next' ? 1 : -1);
      if (action === 'replace') this.replaceOne();
      if (action === 'all') this.replaceAll();
    });
    this.observer = new ResizeObserver(() => { this.measure(); this.render(); }); this.observer.observe(this.element);
  }
  private measure(): void {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d')!;
    ctx.font = getComputedStyle(this.textarea).font;
    this.charWidth = ctx.measureText('M').width || 8.43;
  }
  setFont(size: number): void {
    this.fontSize = size; this.lineHeight = Math.round(size * 1.72);
    this.element.style.setProperty('--editor-font-size', `${size}px`);
    this.element.style.setProperty('--line-height', `${this.lineHeight}px`);
    this.measure(); this.render();
  }
  setDocument(doc: Document): void {
    this.doc = doc; this.textarea.value = doc.model.text;
    this.highlighted = doc.tokenizer.tokenize(doc.model.text, languageFor(doc.name));
    const selection = doc.model.selection.at(-1)!;
    this.textarea.setSelectionRange(Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head), selection.anchor > selection.head ? 'backward' : 'forward');
    this.textarea.scrollTop = doc.scrollTop; this.textarea.scrollLeft = doc.scrollLeft;
    this.hideCompletion(); this.tooltip.hidden = true; this.render();
  }
  refresh(sync = true): void {
    if (!this.doc) return;
    if (sync) {
      const top = this.textarea.scrollTop, left = this.textarea.scrollLeft;
      this.textarea.value = this.doc.model.text;
      const s = this.doc.model.selection.at(-1)!;
      this.textarea.setSelectionRange(Math.min(s.anchor, s.head), Math.max(s.anchor, s.head), s.anchor > s.head ? 'backward' : 'forward');
      this.textarea.scrollTop = top; this.textarea.scrollLeft = left;
    }
    this.highlighted = this.doc.tokenizer.tokenize(this.doc.model.text, languageFor(this.doc.name));
    this.render(); this.updateFindCount();
  }
  private nativeSelection(): Selection {
    return this.textarea.selectionDirection === 'backward' ? { anchor: this.textarea.selectionEnd, head: this.textarea.selectionStart } : { anchor: this.textarea.selectionStart, head: this.textarea.selectionEnd };
  }
  private selection(): void {
    cancelAnimationFrame(this.selectionFrame);
    this.selectionFrame = requestAnimationFrame(() => {
      if (!this.doc || document.activeElement !== this.textarea) return;
      if (this.doc.model.selection.length === 1) this.doc.model.selection = [this.nativeSelection()];
      this.callbacks.cursor(this.doc); this.render();
    });
  }
  private input(): void {
    if (!this.doc || this.composing) return;
    this.doc.model.reconcile(this.textarea.value.replace(/\r\n/g, '\n'), [this.nativeSelection()]);
    this.refresh(false); this.callbacks.change(this.doc); this.callbacks.cursor(this.doc);
    const prefix = this.doc.model.text.slice(0, this.textarea.selectionStart);
    if (/[\w$.]$/.test(prefix)) void this.showCompletions(); else this.hideCompletion();
  }
  private beforeInput(event: InputEvent): void {
    if (!this.doc || this.composing || this.doc.model.selection.length < 2) return;
    if (event.inputType === 'insertText' && event.data) { event.preventDefault(); this.insert(event.data); }
    if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') { event.preventDefault(); this.insert('', event.inputType === 'deleteContentBackward' ? -1 : 1); }
  }
  insert(text: string, deletion = 0): void {
    if (!this.doc) return;
    const selections = [...this.doc.model.selection].sort((a, b) => Math.min(a.anchor, a.head) - Math.min(b.anchor, b.head));
    const edits: Edit[] = []; const next: Selection[] = []; let delta = 0;
    for (const s of selections) {
      let start = Math.min(s.anchor, s.head), end = Math.max(s.anchor, s.head);
      if (start === end && deletion) { if (deletion < 0) start = Math.max(0, start - 1); else end = Math.min(this.doc.model.length, end + 1); }
      if (edits.length && start < edits.at(-1)!.end) continue;
      edits.push({ start, end, text });
      const head = start + delta + text.length; next.push({ anchor: head, head }); delta += text.length - (end - start);
    }
    this.doc.model.apply(edits, next); this.changed(); this.reveal();
  }
  private changed(): void { if (this.doc) { this.refresh(); this.callbacks.change(this.doc); this.callbacks.cursor(this.doc); } }
  private keydown(event: KeyboardEvent): void {
    if (!this.doc || event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!this.completion.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') this.hideCompletion();
      else if (event.key === 'Enter' || event.key === 'Tab') this.acceptCompletion(this.selectedCompletion);
      else { this.selectedCompletion = (this.selectedCompletion + (event.key === 'ArrowDown' ? 1 : -1) + this.completions.length) % this.completions.length; this.renderCompletions(); }
      return;
    }
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.doc.model.redo() : this.doc.model.undo(); this.changed(); return; }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); this.doc.model.redo(); this.changed(); return; }
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); this.openFind(); return; }
    if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); this.selectNextOccurrence(); return; }
    if (mod && event.key === ' ') { event.preventDefault(); void this.showCompletions(); return; }
    if (event.key === 'F12') { event.preventDefault(); this.callbacks.command('definition'); return; }
    if (event.key === 'F1' && !mod) { event.preventDefault(); void this.showHover(); return; }
    if (event.key === 'Escape') { this.doc.model.selection = [this.nativeSelection()]; this.hideCompletion(); this.tooltip.hidden = true; this.render(); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) this.indent(-1);
      else if (this.textarea.selectionStart !== this.textarea.selectionEnd && this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd).includes('\n')) this.indent(1);
      else this.insert('  ');
      return;
    }
    if (mod && event.key === '/') { event.preventDefault(); this.toggleComment(); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      const before = this.doc.model.text.slice(0, this.textarea.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = /^\s*/.exec(line)![0];
      this.insert('\n' + indent + (/[{[(]\s*$/.test(line) ? '  ' : '')); return;
    }
    if (event.altKey && event.shiftKey && event.key === 'ArrowDown') { event.preventDefault(); this.duplicateLine(); return; }
    if (this.doc.model.selection.length > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) this.doc.model.selection = [this.nativeSelection()];
  }
  private lineRange(): { start: number; end: number; text: string } {
    const text = this.doc!.model.text, a = this.textarea.selectionStart, b = this.textarea.selectionEnd;
    const start = text.lastIndexOf('\n', Math.max(0, a - 1)) + 1;
    const endIndex = text.indexOf('\n', b);
    const end = endIndex < 0 ? text.length : endIndex;
    return { start: a === 0 ? 0 : start, end, text: text.slice(a === 0 ? 0 : start, end) };
  }
  private indent(direction: number): void {
    const range = this.lineRange();
    const text = range.text.split('\n').map(line => direction > 0 ? '  ' + line : line.replace(/^ {1,2}|^\t/, '')).join('\n');
    this.doc!.model.apply([{ start: range.start, end: range.end, text }], [{ anchor: range.start, head: range.start + text.length }]); this.changed();
  }
  private toggleComment(): void {
    const range = this.lineRange(), rows = range.text.split('\n');
    const uncomment = rows.every(line => /^\s*\/\//.test(line) || !line.trim());
    const text = rows.map(line => uncomment ? line.replace(/^(\s*)\/\/ ?/, '$1') : line.replace(/^(\s*)/, '$1// ')).join('\n');
    this.doc!.model.apply([{ start: range.start, end: range.end, text }], [{ anchor: range.start, head: range.start + text.length }]); this.changed();
  }
  private duplicateLine(): void {
    const range = this.lineRange();
    this.doc!.model.apply([{ start: range.end, end: range.end, text: '\n' + range.text }], [{ anchor: range.end + 1, head: range.end + 1 + range.text.length }]); this.changed();
  }
  private selectNextOccurrence(): void {
    const model = this.doc!.model, text = model.text;
    let { anchor, head } = model.selection.at(-1)!;
    if (anchor === head) {
      while (anchor > 0 && /[\w$]/.test(text[anchor - 1])) anchor--;
      while (head < text.length && /[\w$]/.test(text[head])) head++;
      model.selection = [{ anchor, head }];
    } else {
      const query = text.slice(Math.min(anchor, head), Math.max(anchor, head));
      let at = text.indexOf(query, Math.max(anchor, head));
      if (at < 0) at = text.indexOf(query);
      if (at >= 0 && !model.selection.some(s => Math.min(s.anchor, s.head) === at)) model.selection.push({ anchor: at, head: at + query.length });
    }
    const last = model.selection.at(-1)!;
    this.textarea.setSelectionRange(last.anchor, last.head); this.render(); this.callbacks.cursor(this.doc!);
  }
  goTo(line: number, column = 1): void {
    if (!this.doc) return;
    const at = this.doc.model.offset(line, column);
    this.doc.model.selection = [{ anchor: at, head: at }];
    this.textarea.setSelectionRange(at, at); this.textarea.focus(); this.reveal(); this.render(); this.callbacks.cursor(this.doc);
  }
  private reveal(): void {
    if (!this.doc) return;
    const pos = this.doc.model.position(this.textarea.selectionEnd);
    const y = (pos.line - 1) * this.lineHeight;
    if (y < this.textarea.scrollTop) this.textarea.scrollTop = y;
    if (y + this.lineHeight > this.textarea.scrollTop + this.textarea.clientHeight - 36) this.textarea.scrollTop = y - this.textarea.clientHeight + 70;
    const x = (pos.column - 1) * this.charWidth;
    if (x < this.textarea.scrollLeft) this.textarea.scrollLeft = x;
    if (x > this.textarea.scrollLeft + this.textarea.clientWidth - 60) this.textarea.scrollLeft = x - this.textarea.clientWidth + 80;
  }
  openFind(): void {
    this.findbar.hidden = false;
    if (this.textarea.selectionEnd > this.textarea.selectionStart) this.findInput.value = this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd);
    this.findInput.focus(); this.findInput.select(); this.updateFindCount(); this.render();
  }
  private closeFind(): void { this.findbar.hidden = true; this.render(); this.textarea.focus(); }
  private matches(): number[] {
    const text = this.doc?.model.text ?? '', query = this.findInput.value;
    if (!query) return [];
    const matches: number[] = []; let at = text.indexOf(query);
    while (at >= 0 && matches.length < 10000) { matches.push(at); at = text.indexOf(query, at + query.length); }
    return matches;
  }
  private updateFindCount(): void { if (!this.findbar.hidden) this.findCount.textContent = `${this.matches().length} matches`; }
  private findNext(direction: number): void {
    if (!this.doc) return;
    const matches = this.matches(); if (!matches.length) return;
    const at = direction > 0 ? matches.find(n => n >= this.textarea.selectionEnd) ?? matches[0] : matches.findLast(n => n < this.textarea.selectionStart) ?? matches.at(-1)!;
    this.doc.model.selection = [{ anchor: at, head: at + this.findInput.value.length }];
    this.textarea.setSelectionRange(at, at + this.findInput.value.length); this.reveal(); this.render(); this.callbacks.cursor(this.doc);
  }
  private replaceOne(): void {
    if (!this.doc || !this.findInput.value) return;
    if (this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd) !== this.findInput.value) this.findNext(1);
    if (this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd) === this.findInput.value) { this.doc.model.selection = [this.nativeSelection()]; this.insert(this.replaceInput.value); this.findNext(1); }
  }
  private replaceAll(): void {
    if (!this.doc) return;
    const edits = this.matches().map(start => ({ start, end: start + this.findInput.value.length, text: this.replaceInput.value }));
    if (!edits.length) return;
    this.doc.model.apply(edits, [{ anchor: 0, head: 0 }]); this.changed();
  }
  private caretPoint(): { x: number; y: number } {
    const p = this.doc!.model.position(this.textarea.selectionEnd);
    const row = this.doc!.model.text.split('\n')[p.line - 1].slice(0, p.column - 1).replace(/\t/g, '  ');
    return { x: 90 + row.length * this.charWidth - this.textarea.scrollLeft, y: 18 + p.line * this.lineHeight - this.textarea.scrollTop };
  }
  async showCompletions(): Promise<void> {
    if (!this.doc?.path || this.doc.model.selection.length > 1) return;
    const ticket = ++this.completionTicket, doc = this.doc, at = this.textarea.selectionStart, version = doc.model.version;
    try {
      await window.orbit.languageChange(doc.path, doc.model.text);
      const items = await window.orbit.complete(doc.path, at);
      if (ticket !== this.completionTicket || this.doc !== doc || doc.model.version !== version || document.activeElement !== this.textarea) return;
      this.completions = items; this.selectedCompletion = 0;
      if (items.length) { this.completion.hidden = false; this.renderCompletions(); } else this.hideCompletion();
    } catch { this.hideCompletion(); }
  }
  private renderCompletions(): void {
    const p = this.caretPoint();
    this.completion.style.left = `${Math.max(70, Math.min(p.x, this.element.clientWidth - 340))}px`;
    this.completion.style.top = `${Math.min(p.y, this.textarea.clientHeight - 240)}px`;
    this.completion.innerHTML = this.completions.map((item, i) => `<div role="option" data-index="${i}" class="completion-item ${i === this.selectedCompletion ? 'selected' : ''}"><span class="completion-kind">ƒ</span><span>${escapeHTML(item.label)}</span><small>${escapeHTML(item.detail ?? '')}</small></div>`).join('');
    this.completion.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }
  private acceptCompletion(index: number): void {
    const item = this.completions[index]; if (!item || !this.doc) return;
    this.doc.model.apply([{ start: item.start, end: item.end, text: item.insertText }], [{ anchor: item.start + item.insertText.length, head: item.start + item.insertText.length }]);
    this.hideCompletion(); this.changed(); this.textarea.focus();
  }
  private hideCompletion(): void { this.completionTicket++; this.completion.hidden = true; }
  async showHover(): Promise<void> {
    if (!this.doc?.path) return;
    const doc = this.doc;
    try {
      await window.orbit.languageChange(doc.path, doc.model.text);
      const result = await window.orbit.hover(doc.path, this.textarea.selectionStart);
      if (!result || this.doc !== doc) return;
      const point = this.caretPoint();
      this.tooltip.textContent = result.text; this.tooltip.hidden = false;
      this.tooltip.style.left = `${Math.max(70, Math.min(point.x, this.element.clientWidth - 420))}px`;
      this.tooltip.style.top = `${Math.min(point.y + 4, this.textarea.clientHeight - 180)}px`;
    } catch {}
  }
  render(): void {
    if (!this.doc) return;
    const { scrollTop: top, scrollLeft: left, clientHeight: height } = this.textarea;
    const start = Math.max(0, Math.floor(top / this.lineHeight) - 2), end = Math.min(this.highlighted.length, start + Math.ceil(height / this.lineHeight) + 5);
    const active = this.doc.model.position(this.textarea.selectionEnd).line;
    this.code.style.transform = `translate(${-left}px,${-top}px)`;
    const code: string[] = [], gutter: string[] = [], decorations: string[] = [];
    for (let i = start; i < end; i++) {
      code.push(`<div class="code-line" style="top:${i * this.lineHeight}px">${this.highlighted[i]}</div>`);
      const error = this.doc.diagnostics.find(d => d.line === i + 1);
      gutter.push(`<div class="gutter-line ${active === i + 1 ? 'active' : ''}" style="top:${18 + i * this.lineHeight - top}px" ${error ? `title="${escapeHTML(error.message)}"` : ''}>${error ? `<span class="diagnostic-dot ${error.severity === 1 ? 'error' : 'warning'}"></span>` : ''}${i + 1}</div>`);
    }
    this.code.innerHTML = code.join(''); this.gutter.innerHTML = gutter.join('');
    const highlight = this.element.querySelector<HTMLElement>('.line-highlight')!;
    highlight.style.top = `${18 + (active - 1) * this.lineHeight - top}px`; highlight.style.height = `${this.lineHeight}px`;
    const rows = this.doc.model.text.split('\n');
    const rect = (a: number, b: number, cls: string) => {
      const p = this.doc!.model.position(a), q = this.doc!.model.position(b);
      for (let line = p.line; line <= q.line; line++) {
        if (line - 1 < start || line - 1 >= end) continue;
        const c1 = line === p.line ? p.column - 1 : 0, c2 = line === q.line ? q.column - 1 : rows[line - 1].length;
        const x = rows[line - 1].slice(0, c1).replace(/\t/g, '  ').length * this.charWidth;
        const width = rows[line - 1].slice(c1, c2).replace(/\t/g, '  ').length * this.charWidth;
        decorations.push(`<div class="${cls}" style="left:${90 + x - left}px;top:${18 + (line - 1) * this.lineHeight - top}px;width:${Math.max(cls === 'extra-caret' ? 2 : 4, width)}px;height:${this.lineHeight}px"></div>`);
      }
    };
    for (const s of this.doc.model.selection.slice(0, -1)) rect(Math.min(s.anchor, s.head), Math.max(s.anchor, s.head), s.anchor === s.head ? 'extra-caret' : 'extra-selection');
    if (!this.findbar.hidden) for (const at of this.matches()) rect(at, at + this.findInput.value.length, 'find-match');
    for (const diagnostic of this.doc.diagnostics) if (diagnostic.line) rect(diagnostic.start, diagnostic.end, diagnostic.severity === 1 ? 'squiggle error' : 'squiggle warning');
    this.decorations.innerHTML = decorations.join('');
  }
  dispose(): void { this.observer.disconnect(); cancelAnimationFrame(this.selectionFrame); this.element.remove(); }
}
