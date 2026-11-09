---
title: keel
tagline: A distributed SQL database in Rust, built simulation-first.
lang: Rust
tags: distributed SQL, MVCC, multi-Raft, deterministic simulation
repo:
demo: live
demo_try: Run a seed twice for the same digest, bit for bit, then try another seed's fault schedule.
group: storage
order: 2
metric: 10,000 randomized fault seeds gate each storage, Raft and multi-Raft milestone
metric_source: README milestone table
---
- Every line of the data plane runs unmodified inside a deterministic simulator that owns time, scheduling, the network and the disk.
- A seed reproduces a run bit for bit, so any bug a fault test finds can be replayed and turned into a regression test.
- Built so far: the simulator and linearizability checker, an LSM storage engine, Raft, and multi-Raft ranges with splits and leases.
- Tested the FoundationDB and TigerBeetle way, designed after CockroachDB: range-sharded MVCC on multi-Raft, serializable transactions, the Postgres wire protocol.

## How the demo works

keel's real simulator, compiled from Rust to WebAssembly. Each seed runs five Raft servers and three clients while a nemesis crashes, pauses, partitions and clock-skews the servers. The digest hashes every traced event, and keel's own checker verifies the history is linearizable.
