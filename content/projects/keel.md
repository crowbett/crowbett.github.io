---
title: keel
tagline: A distributed SQL database in Rust, built simulation-first.
lang: Rust
tags: distributed SQL, MVCC, multi-Raft, deterministic simulation
repo:
demo: live
demo_try: Give it a seed of your own. Run my seed plays it twice, and the two trace digests come back identical.
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

keel's real simulator, compiled from Rust to WebAssembly. Each call runs one seed: five Raft servers and three clients run while a nemesis crashes, pauses, partitions and clock-skews the servers, then heals them and gives the cluster time to recover. The page replays that seed's fault schedule on its own simulated clock, so you watch nodes go down and the network split, and then it moves on to the next seed. Each bar is one seed that has been checked, and keel's own checker says whether its history is linearizable. Run your own seed twice and the trace digest comes back identical, bit for bit.
