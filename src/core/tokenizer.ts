type State = 'normal' | 'comment' | 'template';
interface Line { input: string; state: State; end: State; html: string }
export const escapeHTML = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const keywords = new Set('abstract async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield'.split(' '));
const types = new Set('any boolean number string never unknown object Promise Array Map Set Record Partial console Math JSON Date Error'.split(' '));

/** Stateful, per-line lexer. Unchanged lines reuse tokens when their entering state matches. */
export class Tokenizer {
  private lines: Line[] = [];
  private language = '';
  private text = '';
  private html: string[] = [];
  tokenize(text: string, language: string): string[] {
    if (text === this.text && language === this.language && this.html.length) return this.html;
    if (language !== this.language) { this.lines = []; this.language = language; }
    const rows = text.split('\n');
    let state: State = 'normal';
    const result: Line[] = [];
    for (let i = 0; i < rows.length; i++) {
      const old = this.lines[i];
      if (old?.input === rows[i] && old.state === state) { result.push(old); state = old.end; continue; }
      const start = state;
      const tokens: string[] = [];
      let j = 0;
      const emit = (kind: string, value: string) => tokens.push(kind ? `<span class="tok-${kind}">${escapeHTML(value)}</span>` : escapeHTML(value));
      while (j < rows[i].length) {
        const remaining = rows[i].slice(j);
        if (language === 'Markdown' || language === 'Plain text') { emit(language === 'Markdown' && /^\s*#/.test(rows[i]) ? 'keyword' : '', remaining); break; }
        if (state === 'comment') {
          const end = remaining.indexOf('*/');
          if (end < 0) { emit('comment', remaining); break; }
          emit('comment', remaining.slice(0, end + 2)); j += end + 2; state = 'normal'; continue;
        }
        if (state === 'template') {
          let end = 0;
          while (end < remaining.length) { if (remaining[end] === '\\') { end += 2; continue; } if (remaining[end++] === '`') { state = 'normal'; break; } }
          emit('string', remaining.slice(0, end)); j += end; continue;
        }
        if (remaining.startsWith('//') || (language === 'Python' && remaining.startsWith('#'))) { emit('comment', remaining); break; }
        if (remaining.startsWith('/*')) { emit('comment', '/*'); state = 'comment'; j += 2; continue; }
        if (remaining[0] === '`') { emit('string', '`'); state = 'template'; j++; continue; }
        const match = /^("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|\b\d+(?:\.\d+)?\b|[\p{L}_$][\p{L}\p{N}_$]*|\s+|.)/u.exec(remaining)!;
        const value = match[0];
        let kind = '';
        if (/^["']/.test(value)) kind = 'string';
        else if (/^\d/.test(value)) kind = 'number';
        else if (keywords.has(value)) kind = 'keyword';
        else if (types.has(value)) kind = 'type';
        else if (/^[\p{L}_$]/u.test(value) && /^\s*\(/.test(remaining.slice(value.length))) kind = 'function';
        else if (/^[{}()[\].,;:]$/.test(value)) kind = 'punctuation';
        emit(kind, value); j += value.length;
      }
      result.push({ input: rows[i], state: start, end: state, html: tokens.join('') || ' ' });
    }
    this.lines = result;
    this.text = text;
    return this.html = result.map(line => line.html);
  }
}

export function languageFor(path: string): string {
  const ext = path.split('.').at(-1)?.toLowerCase();
  return ({ ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', json: 'JSON', css: 'CSS', html: 'HTML', md: 'Markdown', py: 'Python', rs: 'Rust', c: 'C', cpp: 'C++', yaml: 'YAML', yml: 'YAML' } as Record<string, string>)[ext ?? ''] ?? 'Plain text';
}
