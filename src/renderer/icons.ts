const paths: Record<string, string> = {
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-36 12 12)"/><circle cx="12" cy="12" r="3"/><circle cx="19.3" cy="6.8" r="1.4" fill="currentColor" stroke="none"/>',
  files: '<path d="M8 3h7l5 5v12H8z"/><path d="M15 3v6h5M4 7v15h11"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  git: '<circle cx="7" cy="5" r="2"/><circle cx="17" cy="6" r="2"/><circle cx="7" cy="19" r="2"/><path d="M7 7v10M17 8v2a5 5 0 0 1-5 5H7"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  settings: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M3 7V5h7l2 2h9v13H3z"/>',
  folderOpen: '<path d="M3 8V5h7l2 3h8v3M3 11h19l-4 9H3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  newFile: '<path d="M14 3H5v18h14V8zM14 3v6h5M12 12v6M9 15h6"/>',
  newFolder: '<path d="M3 7V5h7l2 2h9v13H3zM12 11v6M9 14h6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-2 8M20 3v7h-7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  command: '<path d="M8 8H5a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H8"/>',
  book: '<path d="M12 5C9 3 6 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m-6 0 6-6"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v5m0 3v1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  save: '<path d="M4 3h13l4 4v14H3V3zM7 3v7h10V3M7 21v-7h10v7"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
};
export const icon = (name: string, cls = '') => `<svg class="icon ${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.code}</svg>`;
export function fileIcon(file: string): string {
  const ext = file.split('.').at(-1)?.toLowerCase() ?? '';
  const types: Record<string, [string, string]> = { ts: ['TS', 'ts'], tsx: ['TS', 'ts'], js: ['JS', 'js'], jsx: ['JS', 'js'], json: ['{ }', 'json'], md: ['M↓', 'md'], css: ['#', 'css'], html: ['<>', 'html'], py: ['Py', 'ts'], yaml: ['Y', 'json'], yml: ['Y', 'json'] };
  const [label, kind] = types[ext] ?? ['◇', 'plain'];
  return `<span class="file-icon ${kind}" aria-hidden="true">${label}</span>`;
}
