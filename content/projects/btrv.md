---
title: btrv
tagline: Reads Btrieve, Pervasive.SQL and Actian Zen data files without the engine.
lang: Go
tags: file formats, Btrieve, data recovery, CSV and SQLite export
repo:
demo: live
demo_try: Select a page of the map for its header, switch to the inferred schema, then damage a page.
group: storage
order: 15
metric: 2,483,585 rows/s read and decoded, 15 columns per record, slowest of 6 runs
metric_source: Apple M3 Pro under load, docs/BENCHMARKS.md
---
- Exports Btrieve pre-6.x to 9.x files, with their DDF dictionaries, to CSV, JSON Lines or SQLite. It ships as one static Go binary with no cgo and no runtime.
- No silent data loss. Every run ends with rows read, rows written and rows with column errors, and quotes the first errors word for word. A column that fails to decode is left empty and counted; the row is never dropped.
- It refuses rather than guesses. 13.x and 16.x files, unknown compression and owner-name protection stop with a clear error.
- Clean-room. Format facts come from public documentation and black-box observation of files, never from disassembling the engine or reading another reader's source.
- The source is private and available on request. This page runs the compiled demo binary.

## How the demo works

btrv's page reader, dictionary loader, layout inference and export loop, compiled from Go to WebAssembly. Files you open are read inside this tab and are never uploaded; the demo takes up to 32 MiB at a time. The sample is a synthetic 6.x table with its FILE, FIELD and INDEX dictionaries, written by btrv's own test generator. It has deleted records, free pages and stale page copies left behind.

The page map draws every physical page in file order. A data page fills as the scan reaches its records. **Damage page** flips one header byte in this tab's copy so you can watch the reader stop with an error rather than skip the page. CSV and JSON Lines downloads come from the same export code as the command line. SQLite export is in the command only, because its SQLite driver does not build for WebAssembly.
