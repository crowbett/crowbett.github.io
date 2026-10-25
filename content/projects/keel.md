---
title: keel
tagline: A distributed SQL database in Rust, built simulation-first.
lang: Rust
tags: distributed SQL, MVCC, multi-Raft, deterministic simulation
repo:
demo: live
demo_try: Run a seed, run it again for the same digest bit for bit, then try another seed's fault schedule.
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

The demo is keel's real simulator, compiled from Rust to WebAssembly and running in your tab; keel's
source is private. One run is one seed of keel's register workload: five Raft servers replicate a
register while three clients read, write and compare-and-set, and a nemesis crashes, restarts, pauses,
partitions and clock-skews the servers, then heals everything and requires every client to make
progress. The digest is a hash of every event the simulator traced along the way: each scheduling step,
timer, message and fault, and each random value keel's nodes draw. Run the same seed again and it matches bit for bit; another seed
gives another fault schedule. The client history is checked for linearizability by keel's own checker,
and the run time is measured in your browser around that one call.
