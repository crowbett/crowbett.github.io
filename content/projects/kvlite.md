---
title: kvlite
tagline: An embedded bitcask-style key-value store for Go with zero dependencies.
lang: Go
tags: storage engine, log-structured, crash safety
repo: https://github.com/crowbett/kvlite
demo: planned
order: 5
metric: Get in 3.50 µs sequential / 6.04 µs random (100 B values)
metric_source: README benchmark table, against bbolt and pebble on the same workload
---
Append-only segments, an in-memory keydir (one map lookup and one `ReadAt` per `Get`), hint files
for fast startup, crc32c on every record, TTLs, atomic batches, sorted snapshot iterators and
crash-safe compaction. It is the storage layer under [quorum](/projects/quorum/).

The planned demo is a live store in your browser: put and delete keys, watch segments fill,
then run compaction and see the dead records go.
