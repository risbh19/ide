import { contextBridge, ipcRenderer } from 'electron';
import type { OrbitAPI } from '../shared/types';

const listen = (channel: string, callback: (value: any) => void) => {
  const listener = (_event: unknown, value: unknown) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const api: OrbitAPI = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  list: path => ipcRenderer.invoke('list', path),
  files: () => ipcRenderer.invoke('files'),
  read: path => ipcRenderer.invoke('read', path),
  openFile: () => ipcRenderer.invoke('open-file'),
  save: input => ipcRenderer.invoke('save', input),
  saveAs: input => ipcRenderer.invoke('save-as', input),
  create: input => ipcRenderer.invoke('create', input),
  search: (query, sensitive) => ipcRenderer.invoke('search', query, sensitive),
  git: () => ipcRenderer.invoke('git'),
  languageOpen: (path, text) => ipcRenderer.invoke('language-open', path, text),
  languageChange: (path, text) => ipcRenderer.invoke('language-change', path, text),
  complete: (path, offset) => ipcRenderer.invoke('complete', path, offset),
  hover: (path, offset) => ipcRenderer.invoke('hover', path, offset),
  definition: (path, offset) => ipcRenderer.invoke('definition', path, offset),
  format: path => ipcRenderer.invoke('format', path),
  terminalStart: (cols, rows) => ipcRenderer.invoke('terminal-start', cols, rows),
  terminalWrite: (id, text) => ipcRenderer.send('terminal-write', id, text),
  terminalResize: (id, cols, rows) => ipcRenderer.send('terminal-resize', id, cols, rows),
  terminalStop: id => ipcRenderer.send('terminal-stop', id),
  confirm: (message, detail, buttons) => ipcRenderer.invoke('confirm', message, detail, buttons),
  setDirty: dirty => ipcRenderer.send('set-dirty', dirty),
  closeReady: () => ipcRenderer.send('close-ready'),
  window: action => ipcRenderer.send('window', action),
  onFile: callback => listen('file-event', callback),
  onDiagnostics: callback => listen('diagnostics', callback),
  onLanguageStatus: callback => listen('language-status', callback),
  onTerminal: callback => listen('terminal', callback),
  onCommand: callback => listen('command', callback),
};
contextBridge.exposeInMainWorld('orbit', api);
