---
title: kvlite
tagline: An embedded bitcask-style key-value store for Go with zero dependencies.
lang: Go
tags: storage engine, log-structured, crash safety
repo: https://github.com/crowbett/kvlite
demo: live
demo_try: Put, delete and compact, then crash with the last write torn and watch kvlite recover from its own files.
group: storage
order: 5
metric: Get in 3.50 µs sequential / 6.04 µs random (100 B values)
metric_source: README benchmark table, against bbolt and pebble on the same workload
---
- Append-only segments and an in-memory keydir: one map lookup and one `ReadAt` per `Get`.
- crc32c on every record, hint files for fast startup and crash-safe compaction.
- TTLs, atomic batches and sorted snapshot iterators. It is the storage layer under [quorum](/projects/quorum/).

## How the demo works

kvlite's own engine, compiled to WebAssembly, on an in-memory file system. Puts and deletes append to a real segment file. Compact merges the sealed segments and swaps the MANIFEST. Crash and reopen can tear bytes off the last write and lets recovery truncate them. The record tables are decoded by kvlite's own segment reader.
