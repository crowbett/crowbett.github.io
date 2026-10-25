---
title: kvlite
tagline: An embedded bitcask-style key-value store for Go with zero dependencies.
lang: Go
tags: storage engine, log-structured, crash safety
repo: https://github.com/crowbett/kvlite
demo: live
demo_try: Put and delete keys, compact the segments, then crash with the last write torn and watch kvlite recover from its own files.
order: 5
metric: Get in 3.50 µs sequential / 6.04 µs random (100 B values)
metric_source: README benchmark table, against bbolt and pebble on the same workload
---
Append-only segments, an in-memory keydir (one map lookup and one `ReadAt` per `Get`), hint files
for fast startup, crc32c on every record, TTLs, atomic batches, sorted snapshot iterators and
crash-safe compaction. It is the storage layer under [quorum](/projects/quorum/).

The demo runs kvlite's own engine, compiled to WebAssembly, on an in-memory file system in your
tab. Puts and deletes append records to a real segment file; Compact rotates the active segment,
merges the sealed ones into a new segment with a hint file and swaps the MANIFEST; Crash and
reopen drops the store without closing it, can tear bytes off the last write, and lets kvlite's
recovery truncate the torn tail. The record tables are decoded from the files the engine wrote,
by its own segment reader.
