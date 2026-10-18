import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FileData, FileEntry, SearchHit } from '../shared/types';

const exec = promisify(execFile);
const ignored = new Set(['node_modules', '.git', 'dist', 'release', '.next', '.cache', '.venv', '__pycache__', 'coverage', '.orbit-test']);
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

export class WorkspaceFS {
  root = '';
  private approved = new Set<string>();
  async setRoot(root: string): Promise<void> {
    const real = await fs.realpath(root);
    if (!(await fs.stat(real)).isDirectory()) throw new Error('Choose a directory.');
    this.root = real; this.approved.clear();
  }
  async approve(file: string): Promise<void> { this.approved.add(path.resolve(file)); }
  async authorize(file: string): Promise<string> {
    const target = path.resolve(file);
    if (!this.root || (!inside(this.root, target) && !this.approved.has(target))) throw new Error('This path is outside the open workspace.');
    // Follow the nearest existing ancestor, preventing symlink/junction escapes on writes too.
    let ancestor = target;
    while (true) {
      try {
        const real = await fs.realpath(ancestor);
        if (!inside(this.root, real) && !this.approved.has(target)) throw new Error('Symbolic link points outside the workspace.');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    return target;
  }
  async list(directory = this.root): Promise<FileEntry[]> {
    const safe = await this.authorize(directory);
    const entries = await fs.readdir(safe, { withFileTypes: true });
    return entries.filter(e => !ignored.has(e.name) && !e.isSymbolicLink())
      .map(e => ({ name: e.name, path: path.join(safe, e.name), kind: e.isDirectory() ? 'directory' as const : 'file' as const }))
      .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
  }
  async files(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string) => {
      if (files.length >= 12000) return;
      for (const entry of await this.list(dir)) {
        if (files.length >= 12000) break;
        if (entry.kind === 'directory') await walk(entry.path);
        else files.push(entry.path);
      }
    };
    await walk(this.root); return files;
  }
  async read(file: string): Promise<FileData> {
    const safe = await this.authorize(file);
    if ((await fs.stat(safe)).size > 5 * 1024 * 1024) throw new Error('This editor supports text files up to 5 MB.');
    const bytes = await fs.readFile(safe);
    if (bytes.includes(0)) throw new Error('Binary files cannot be opened in the text editor.');
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('This file is not valid UTF-8 text.'); }
    const raw = bytes.toString('utf8');
    return { path: safe, text: raw.replace(/\r\n/g, '\n'), hash: hash(bytes), eol: raw.includes('\r\n') ? 'CRLF' : 'LF' };
  }
  async save(input: { path: string; text: string; hash: string; eol: 'LF' | 'CRLF'; force?: boolean }): Promise<FileData> {
    const safe = await this.authorize(input.path);
    let existing: Buffer | null = null;
    try { existing = await fs.readFile(safe); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!input.force && (existing ? hash(existing) !== input.hash : Boolean(input.hash))) throw new Error('CONFLICT: The file changed on disk.');
    const raw = input.eol === 'CRLF' ? input.text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : input.text;
    const temporary = path.join(path.dirname(safe), `.${path.basename(safe)}.${randomUUID()}.tmp`);
    try {
      const mode = existing ? (await fs.stat(safe)).mode : undefined;
      await fs.writeFile(temporary, raw, { encoding: 'utf8', flag: 'wx', mode });
      await fs.rename(temporary, safe);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return { path: safe, text: input.text, hash: hash(raw), eol: input.eol };
  }
  async create(relative: string, kind: 'file' | 'directory'): Promise<string> {
    if (!relative.trim() || path.isAbsolute(relative)) throw new Error('Enter a relative path inside the workspace.');
    const safe = await this.authorize(path.join(this.root, relative));
    if (kind === 'directory') await fs.mkdir(safe);
    else { await fs.mkdir(path.dirname(safe), { recursive: true }); await fs.writeFile(safe, '', { flag: 'wx' }); }
    return safe;
  }
  async search(query: string, caseSensitive: boolean): Promise<{ hits: SearchHit[]; truncated: boolean }> {
    if (!query.trim() || query.length > 1000) return { hits: [], truncated: false };
    const needle = caseSensitive ? query : query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const file of await this.files()) {
      try {
        if ((await fs.stat(file)).size > 1024 * 1024) continue;
        const bytes = await fs.readFile(file);
        if (bytes.includes(0)) continue;
        const rows = bytes.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < rows.length; i++) {
          const column = (caseSensitive ? rows[i] : rows[i].toLowerCase()).indexOf(needle);
          if (column >= 0) hits.push({ path: file, line: i + 1, column: column + 1, text: rows[i].slice(0, 400) });
          if (hits.length >= 500) return { hits, truncated: true };
        }
      } catch { /* A file can disappear while indexing. */ }
    }
    return { hits, truncated: false };
  }
  async git(): Promise<{ branch: string; files: { path: string; status: string }[] } | null> {
    try {
      const options = { cwd: this.root, timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 };
      const [branch, status, top] = await Promise.all([
        exec('git', ['branch', '--show-current'], options),
        exec('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.'], options),
        exec('git', ['rev-parse', '--show-toplevel'], options),
      ]);
      const records = status.stdout.split('\0');
      const files: { path: string; status: string }[] = [];
      for (let i = 0; i < records.length; i++) {
        const record = records[i]; if (!record) continue;
        files.push({ path: path.join(top.stdout.trim(), record.slice(3)), status: record.slice(0, 2).trim() });
        if (/R|C/.test(record.slice(0, 2))) i++;
      }
      return { branch: branch.stdout.trim() || 'detached', files };
    } catch { return null; }
  }
}
