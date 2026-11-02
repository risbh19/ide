# Performance evidence

Measured on Windows 11 x64, Intel Core Ultra 5 125H, Electron 42.11.15. Desktop fixture files contain repeated short TypeScript statements (`void 0;` plus comments). The test retains previously opened tabs. LSP and the normal editor input, tokenization, recovery and rendering paths remain enabled. Samples are from one machine and are not universal performance guarantees.

`pnpm benchmark:desktop` opens a visible isolated Electron instance, disables Electron background throttling for measurement, performs 30 native input insertions and 20 scroll positions per size, and records completion through two animation frames. Open timings include automation/navigation overhead. Scrolling includes frame pacing; this is not a pure render-function benchmark. Workspace search scans the fixture directory; it skips files above 1 MiB. Browser metrics report renderer working set, not a heap leak measurement.

| UTF-8 file bytes | Open ms | Input median / p95 ms | Scroll median / p95 ms | Search ms | Renderer working set MiB |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 16,384 | 127 | 15 / 59 | 33 / 35 | 15 | 155 |
| 524,288 | 246 | 29 / 41 | 33 / 38 | 8 | 231 |
| 1,048,476 | 445 | 51 / 59 | 33 / 36 | 14 | 465 |

Before reducing the opening limit, the 5,242,780-byte case opened in 2.27 s, showed 560 ms median / 1,989 ms p95 input latency, and reached 1,032 MiB renderer working set. The visible window became minimized during that run, so its roughly 2 s scroll-frame timings are not reliable foreground scrolling measurements. The substantial typing and memory costs, together with the native full-document architecture, do not support the old 5 MB claim. Release 1 therefore limits disk opening to 1 MiB. A separate core benchmark still demonstrated that the model alone was much cheaper than the full app; core timings must not be presented as desktop responsiveness.

After the fixes, `pnpm benchmark` on Node 24.22.2 measured near-1 MiB initial indexing/tokenization around 96 ms and 50 repeated model+tokenizer edits around 3.7 ms median / 9.3 ms p95. A separate regression replaces a 1 MiB document 45 times and asserts that retained additions stay below 32 MiB while remaining undo/redo works. This bounds that fixture's retained text, not all process memory.

Native beforeinput hints avoid the old prefix/suffix scan for common typing/deletion/paste. Indexed line starts update from edits and viewport reads no longer split all text. Unchanged tokenizer calls reuse their result. Each changed document still materializes a full string and visits all tokenizer lines; full native textarea layout, local recovery serialization and whole-document LSP updates remain costs. Large/minified lines, unusually long grapheme sequences and many open tabs can perform worse.

Reproduce with the pinned runtime and lockfile:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm benchmark
pnpm benchmark:desktop
```

Machine-readable results and screenshots are written below `.orbit-test/benchmark/` and `.orbit-test/performance-*/`. The release evidence bundle retains the accepted run and the earlier near-5 MiB characterization. Hidden/minimized-window timing experiments are excluded from the accepted 1 MiB table.
