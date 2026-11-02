# Orbit

A focused desktop IDE with a text editor built from scratch. TypeScript, Electron, a piece table, and a real language server. No Monaco or CodeMirror.

## Run it

Install **Node.js 24.22.2** (see `.node-version`) and **pnpm 11.25.0** (see `packageManager`), then:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

For renderer hot reload:

```sh
pnpm dev
```

The first launch creates a writable **Hello Orbit** workspace in the app's user-data directory. Open your own folder with **Ctrl+Shift+O**. This is a desktop app; it does not require a backend, an account, or a cloud service.

## What works in 0.1

- A custom piece-table document model, atomic edit transactions, up to 500 undo/redo steps, incremental line indexing, and IME input through a native textarea. Large transactions can shorten history to keep its text budget near 32 MiB; discarded additions are compacted.
- Multi-cursor editing with **Ctrl+D** and **Alt+Click**, indentation, auto-indent, line duplication, and line comments.
- Incremental line tokenization with multiline state. Highlighting and line numbers render only the visible viewport. The input layer uses native text selection, clipboard, and accessibility behavior.
- A real file explorer, nested file/folder creation, tabs, split panes, adjustable panels, font preferences, command palette, fuzzy file navigation, and find/replace.
- UTF-8 text editing, LF/CRLF preservation (including Save As), temporary-file-and-rename saves, serialized save requests, external file watching, conflict detection, dirty/deleted-file prompts, and local session recovery. Saves are not claimed to survive power loss: files/directories are not fsynced.
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

The Windows GitHub Actions workflow builds, tests, and uploads the portable application as the **Orbit-windows** artifact. The application includes `resources/app/build-info.json` with its source commit, dirty-worktree flag, runtime and lockfile checksum. Use a clean source checkout for a release candidate. Node 26 is outside the supported build range: its ZIP extraction caused the current packager to exit early during verification.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:app
pnpm package
pnpm test:package
pnpm benchmark
pnpm benchmark:desktop
```

The tests compare 5,000 randomized edits with a string oracle and exercise undo history/compaction, Unicode, lexer state, junction containment, CRLF, concurrent saves, size limits, search, and real language-server restarts. Both Electron smoke suites use isolated workspace/profiles under `.orbit-test/`, the actual UI, real language server, real Git, and real PowerShell PTYs. They cover stale formatting/completions, typing during saves/close/external reads, Save As, IME event reconciliation, quota failures, workspace switching, restart recovery and normal process-tree cleanup. Some regression tests delay real IPC responses or inject storage failures; native dialog decisions are selected programmatically. No integration is replaced by a fake server or terminal. Screenshots and benchmark JSON are saved under `.orbit-test/`.

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

Text files opened from disk are limited to **1 MiB (1,048,576 bytes)**. The previous near-5 MiB case produced material desktop stalls and about 1 GiB of renderer working-set memory. On the verified Windows machine, the near-1 MiB case opened in about 0.45 seconds with about 50 ms median / 59 ms p95 input-to-two-frames latency. These are fixture measurements, not a guarantee for every file or machine; see [performance evidence](docs/performance.md).

Search enumerates at most 12,000 files, reads files up to 1 MiB, returns up to 500 matching lines, and skips generated/dependency directories. Highlighting is strongest for JavaScript/TypeScript; other languages use a lightweight generic lexer. The native input layer retains the full document and the tokenizer still visits all lines after an edit, even though rendering is virtualized. Recovery uses quota-limited browser storage; a persistent warning appears when saving a recovery snapshot fails. Save files to disk when that warning is visible. See [limitations](docs/limitations.md) and [release notes](docs/release-notes.md).

The next phases are a DAP debugger, configurable language servers, a plugin host, richer parsers, and a fully custom text layout engine. They are not included in 0.1. Windows is the tested platform; macOS/Linux code paths need platform testing.
