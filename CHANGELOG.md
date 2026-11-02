# Changelog

## 0.1.0 — first verified release candidate

- Removed the conflicting CI pnpm version and pinned the Node 24 build runtime; retained the existing reproducible lockfile.
- Rejected stale formatting, completion and hover results, including caret movement and edits followed by undo.
- Serialized document and filesystem saves; preserved typing and line-ending changes during save acknowledgements and CRLF during Save As. Rechecked disk hashes before rename and after acknowledgement.
- Kept dirty buffers open when typing continues during Save-and-close; protected deleted files and guarded repeated close requests.
- Protected external reload/recovery reads from newer edits and watched explicitly opened/saved files.
- Canonicalized workspace path aliases before containment checks and save queuing, including Windows runner short paths, while retaining junction-escape protection.
- Retried bounded Windows sharing-lock rename failures, rechecking disk hashes before every attempt and retaining the destination until a successful rename.
- Serialized language-server restarts, sent didClose, ignored diagnostics for obsolete workspaces/closed documents, and canceled obsolete terminal startups.
- Cleared old workspace panes, diagnostics and pending per-document language updates; verified normal child-process cleanup.
- Routed application shortcuts before editor/terminal input so Quick Open works from the terminal and Ctrl+Tab does not insert indentation.
- Added incremental line indexing, native beforeinput edit hints, cached unchanged tokenization and undo-buffer compaction. Removed whole-document splitting from viewport scrolling.
- Made recovery persistence failures visible with a persistent warning.
- Replaced the unverified 5 MB opening claim with a measured 1 MiB opening limit.
- Expanded Windows source/packaged smoke coverage, real integration tests, benchmark evidence and packaged source provenance.
