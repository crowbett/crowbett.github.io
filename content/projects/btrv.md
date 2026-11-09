---
title: btrv
tagline: Reads Btrieve, Pervasive.SQL and Actian Zen data files without the engine.
lang: Go
tags: file formats, Btrieve, data recovery, CSV and SQLite export
repo:
demo: live
demo_try: Watch btrv map and read the sample, then press Corrupt page and see where the reader stops.
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

btrv's page reader, page map, dictionary loader, layout inference and export loop, compiled from Go to WebAssembly. The sample is a synthetic 6.x table with its FILE, FIELD and INDEX dictionaries, written by btrv's own test generator, with deleted records, free pages and stale page copies left in it.

On arrival the binary describes the file one page header at a time, and each square of the map takes its page's kind: header, allocation table, data, variable, index, free or unreferenced. Then the reader walks the data pages in its own order. Each page fills as its records are decoded, and the decoded rows appear beside the map. Pause, Step, Reset and a speed control drive the walk.

Pick any page for what the binary says about it. On a data page, pick a row to see each field's byte range and decoded value. **Corrupt page** flips one header byte in this tab's copy, and btrv maps and reads the file again. A bad data or variable page stops the read with an error rather than skip it. A bad index page is flagged, and every row is still read. Your own files are read inside this tab and are never uploaded; the demo takes up to 32 MiB at a time. CSV and JSON Lines downloads come from the same export code as the command line. SQLite export is in the command only, because its SQLite driver does not build for WebAssembly.
