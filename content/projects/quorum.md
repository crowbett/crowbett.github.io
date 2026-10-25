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
quorum replicates a key-value store across a cluster with its own Raft implementation: no hashicorp/raft
or etcd/raft. Each replica keeps its state in [kvlite](/projects/kvlite/), my embedded key-value store.

The claim that it is correct rests on tests rather than prose:

- a deterministic simulator that sweeps thousands of seeds through crashes, partitions, dropped and duplicated messages;
- a linearizability checker (porcupine) run against histories from a real 5-node cluster over TCP;
- a chaos harness that kills, pauses and partitions real processes;
- a mutation check for every invariant, so a check that cannot fail is caught.

The planned demo runs that same simulator in your browser: step a five-node cluster, crash the leader,
cut the network and watch a new election and log repair happen.
