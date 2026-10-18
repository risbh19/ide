# IDE from scratch — implementation plan

The reference project memory describes a phased IDE with a custom text engine, UI, language tooling, filesystem integration, terminal, debugger, and extensions. Its technology choices were open. Orbit chooses a TypeScript/Electron desktop shell and JavaScript/TypeScript as the first language family.

| Phase | Status in Orbit 0.1 |
| --- | --- |
| 1. Open, edit, save, line numbers, scrolling, cursor | Implemented with a piece table and native input layer |
| 2. Syntax highlighting | Implemented with an incremental stateful line tokenizer |
| 3. Explorer, tabs, multiple files | Implemented, including shared-document split panes |
| 4. Language intelligence | Implemented through stdio LSP and typescript-language-server |
| 5. Terminal, run, workspace search | Implemented with PTY/xterm, host runtimes, and bounded search |
| 6. Debugger, extension system | Planned |

## Architectural choices

The piece table retains the original text and an append-only additions buffer. Pieces reference slices of those buffers. A batch of edits creates one history entry, so a multi-cursor replacement is reversible as a unit. Adjacent pieces are coalesced. An indexed line-start cache maps between UTF-16 offsets and line/column positions, matching JavaScript and LSP offset conventions.

The textarea handles selection, clipboard, input methods, and scrolling; Orbit reconciles input events into piece-table transactions. A stateful lexer caches each line's text, entering state, tokens, and exit state. Only visible lines are rendered to the highlight layer. This keeps the core understandable while preserving useful native input behavior.

The main process owns the selected workspace, atomic writes, watches, Git queries, PTYs, and LSP child process. Context isolation keeps those capabilities behind a typed bridge. The renderer owns documents, panes, presentation, and local recovery state. The language server uses the TypeScript installation bundled with the app or project configuration discovered by the server.

## Next milestones

1. A reusable transport/configuration registry for additional language servers.
2. A Debug Adapter Protocol client, breakpoints, stack frames, stepping, and variables.
3. An extension API with command, language, and renderer contribution points.
4. A piece-tree/rope index for very large documents, incremental layout, and stronger Unicode cursor behavior.
5. Tree-sitter parsing, structural editing, richer language-specific highlighting, and automated platform coverage.
