# Orbit

A focused desktop IDE with a text editor built from scratch. TypeScript, Electron, a piece table, and a real language server. No Monaco or CodeMirror.

## Run it

Install **Node.js 22.18+** and **pnpm 10+**, then:

```sh
pnpm install
pnpm build
pnpm start
```

For renderer hot reload:

```sh
pnpm dev
```

The first launch creates a writable **Hello Orbit** workspace in the app's user-data directory. Open your own folder with **Ctrl+Shift+O**. This is a desktop app; it does not require a backend, an account, or a cloud service.

## What works in 0.1

- A custom piece-table document model, atomic edit transactions, 500-step undo/redo, line/column indexing, and IME input through a native textarea.
- Multi-cursor editing with **Ctrl+D** and **Alt+Click**, indentation, auto-indent, line duplication, and line comments.
- Incremental line tokenization with multiline state. Highlighting and line numbers render only the visible viewport. The input layer uses native text selection, clipboard, and accessibility behavior.
- A real file explorer, nested file/folder creation, tabs, split panes, adjustable panels, font preferences, command palette, fuzzy file navigation, and find/replace.
- UTF-8 text editing, LF/CRLF preservation, atomic saves, external file watching, conflict detection, dirty-file prompts, and local session recovery.
- A stdio **Language Server Protocol** client connected to `typescript-language-server`: JavaScript/TypeScript completions, hover information, go-to-definition, diagnostics, and formatting.
- A real **ConPTY/PTY** terminal rendered with xterm.js, plus a run command for JS, TS, and Python files. Runtimes must be installed on the host. TypeScript Run uses Node's type stripping and requires Node 22.18+.
- Literal workspace search and a Git branch/working-tree view. Git operations run in the terminal using your installed Git.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Commands | Ctrl+Shift+P / Ctrl+K |
| Go to file | Ctrl+P |
| Open folder / file | Ctrl+Shift+O / Ctrl+O |
| New / save / save as | Ctrl+N / Ctrl+S / Ctrl+Shift+S |
| Close / cycle tabs | Ctrl+W / Ctrl+Tab |
| Find / workspace search | Ctrl+F / Ctrl+Shift+F |
| Go to line | Ctrl+G |
| Split editor | Ctrl+backslash |
| Toggle terminal | Ctrl+backtick |
| Problems | Ctrl+Shift+M |
| Next occurrence / add cursor | Ctrl+D / Alt+Click |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Comment / duplicate line | Ctrl+/ / Alt+Shift+Down |
| Completion / type info / definition | Ctrl+Space / F1 / F12 |
| Format / run | Shift+Alt+F / F5 |
| Font size / preferences | Ctrl+Plus / Ctrl+Minus / Ctrl+, |

## Build a desktop distribution

```sh
pnpm package
pnpm test:package
```

On Windows, run `release/Orbit-win32-x64/Orbit.exe`. The entire directory is the portable application; keep its resources alongside the executable. Packaging uses the host platform and architecture.

The Windows GitHub Actions workflow also builds, tests, and uploads the portable application as the **Orbit-windows** artifact.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:app
```

The core tests compare 5,000 randomized edits with a string oracle and exercise undo history, Unicode, lexer state, filesystem containment, CRLF, save conflicts, binary detection, and search. The Electron smoke test uses an isolated workspace/profile under `.orbit-test/`, exercises the actual UI, real language server, and real PowerShell PTY, and captures screenshots. The smoke test currently targets Windows.

## Project map

```text
src/core/        Piece table and incremental tokenizer
src/main/        Electron lifecycle, filesystem, LSP, terminal, preload bridge
src/renderer/    Editor, workbench UI, terminal rendering, session recovery
src/shared/      Typed IPC contract
starter/         First-launch sample workspace
tests/           Core and filesystem tests
scripts/         Build, dev, packaging, desktop smoke tests
```

The renderer is sandboxed with context isolation and no Node integration. A small typed preload bridge exposes specific operations. File access is limited to the selected workspace and explicitly opened files; resolved paths prevent symlink traversal. The editor renders source as escaped text. Executing a project through the terminal runs it with the user's normal local permissions.

## Current limits and next phases

This is the first working release of the project described in `docs/project-plan.md`. Text files are limited to 5 MB, search indexes at most 12,000 files and returns up to 500 matching lines, and generated/dependency directories are skipped. Highlighting is strongest for JavaScript/TypeScript; other languages use a lightweight generic lexer. The native input layer retains the full document even though highlighted rendering is virtualized. Session recovery uses local browser storage and can be limited by its quota.

The next phases are a DAP debugger, configurable language servers, a plugin host, richer parsers, and a fully custom text layout engine. They are not included in 0.1. Windows is the tested platform; macOS/Linux code paths need platform testing.
