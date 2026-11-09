---
title: kvlite
tagline: An embedded bitcask-style key-value store for Go with zero dependencies.
lang: Go
tags: storage engine, log-structured, crash safety
repo: https://github.com/crowbett/kvlite
demo: live
demo_try: Put a key of your own, then pull the plug. kvlite reopens from its files, and Get shows whether your key survived.
group: storage
order: 5
metric: Get in 3.50 µs sequential / 6.04 µs random (100 B values)
metric_source: README benchmark table, against bbolt and pebble on the same workload
---
- Append-only segments and an in-memory keydir: one map lookup and one `ReadAt` per `Get`.
- crc32c on every record, hint files for fast startup and crash-safe compaction.
- TTLs, atomic batches and sorted snapshot iterators. It is the storage layer under [quorum](/projects/quorum/).

## How the demo works

kvlite's own engine, compiled to WebAssembly, writes real segment, hint and MANIFEST files to an in-memory file system. A seeded workload puts and deletes 12 keys; every record drawn was decoded from those files by kvlite's own segment reader, at its real byte offset, and the keydir row shows where each key's newest record lives. When the engine reports the chosen share of its bytes dead (and at least 256 B), the page calls Compact and the live records move into a fresh sealed segment. Pull the plug drops the store without Close, cuts bytes off the end of the active segment and reopens it: kvlite truncates any torn record, and the page compares the files before and after to show which writes were lost. Put, Get and Delete run your own key through the same engine.
