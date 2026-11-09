---
title: quorum
tagline: A linearizable, Raft-replicated key-value store in Go, with the consensus layer written from scratch.
lang: Go
tags: Raft, consensus, deterministic simulation, linearizability
repo:
demo: planned
order: 1
metric: 10,000 simulated seeds in about 30 s, each one replayable bit for bit
metric_source: README, go test ./internal/sim -seeds 10000
---
- Its own Raft implementation, with no hashicorp/raft or etcd/raft. Each replica keeps its state in [kvlite](/projects/kvlite/).
- A deterministic simulator sweeps thousands of seeds through crashes, partitions, and dropped and duplicated messages.
- A linearizability checker (porcupine) runs against histories from a real 5-node cluster over TCP.
- A chaos harness kills, pauses and partitions real processes, and every invariant has a mutation check, so a check that cannot fail is caught.

## Planned demo

The same simulator in your browser: step a five-node cluster, crash the leader, cut the network and watch a new election and log repair.
