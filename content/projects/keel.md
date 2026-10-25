---
title: keel
tagline: A distributed SQL database in Rust, built simulation-first.
lang: Rust
tags: distributed SQL, MVCC, multi-Raft, deterministic simulation
repo:
demo: planned
order: 2
metric: storage, Raft and multi-Raft milestones each gated on 10,000 randomized fault seeds
metric_source: README milestone table
---
Every line of keel's data plane runs unmodified inside a deterministic simulator that owns time,
scheduling, the network and the disk. A seed reproduces a run bit for bit, so any bug a randomized
fault test finds can be replayed, debugged and turned into a regression test.

The approach follows FoundationDB and TigerBeetle. The architecture follows CockroachDB:
range-sharded MVCC on multi-Raft, serializable transactions and the Postgres wire protocol.
Built so far: the simulator and linearizability checker, an LSM storage engine, Raft, and
multi-Raft ranges with splits and leases.
