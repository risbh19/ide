# Orbit 0.1.0 — Release 1 candidate

This is the first verification pass for the desktop editor scope. The version remains 0.1.0. Use the release handoff/evidence manifest for the exact tested source commit, checksums and CI conclusion; this document is not itself a passing CI assertion.

The candidate retains Electron, TypeScript, the custom piece-table editor model, native textarea input and existing integrations. It covers multi-cursor editing, find/replace, highlighting, tabs/split panes, workspace file operations and external changes, JS/TS language intelligence, PTY/run, bounded workspace search, Git status and local session recovery.

Reliability fixes cover stale async edits/results, saves during typing, queued requests, Save As line endings/target conflicts, dirty/deleted close protection, workspace lifecycle and recovery failure visibility. The opening limit is now 1 MiB based on measured desktop costs; see `performance.md`. Saves are rename-based and are not advertised as crash-durable.

## Reproduce on Windows x64

```sh
git checkout <sourceCommit-from-build-info.json>
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:app
pnpm package
pnpm test:package
pnpm benchmark
pnpm benchmark:desktop
```

Use Node 24.22.2 and pnpm 11.25.0. Extract the complete portable folder and run `Orbit.exe`. Source identity is recorded in `resources/app/build-info.json`; `dirty` must be false for the handed-off candidate. Compare the distributed ZIP/executable with the handoff SHA-256 manifest.

Smoke tests exercise real LSP completions/diagnostics/hover/definition/formatting, PowerShell ConPTY resizing/execution, JS/TS Run, Git status, filesystem conflicts, multi-cursor undo/redo, split sync, stale async response rejection, quota failures and restart recovery. Separate tests verify containment and repeated-edit buffer compaction. Screenshots and timing evidence accompany the candidate.

Known limits are detailed in `limitations.md`. The candidate is release-ready only after the required Windows source and packaged checks and the Windows CI job pass. A public release is not created by these scripts.
