---
title: quorum
tagline: A linearizable, Raft-replicated key-value store in Go, with the consensus layer written from scratch.
lang: Go
tags: Raft, consensus, deterministic simulation, linearizability
repo:
demo: live
demo_try: Crash the leader, or click any node, and watch the election timers run out and a new term win.
group: storage
order: 1
metric: 10,000 simulated seeds in about 30 s, each one replayable bit for bit
metric_source: README, go test ./internal/sim -seeds 10000
---
- Its own Raft implementation, with no hashicorp/raft or etcd/raft. Each replica keeps its state in [kvlite](/projects/kvlite/).
- A deterministic simulator sweeps thousands of seeds through crashes, partitions, and dropped and duplicated messages.
- A linearizability checker (porcupine) runs against histories from a real 5-node cluster over TCP.
- A chaos harness kills, pauses and partitions real processes, and every invariant has a mutation check, so a check that cannot fail is caught.

## How the demo works

quorum's own `raft` core and its deterministic simulator, compiled to WebAssembly. `sim.Stepper` runs the same tick the seed sweep runs, one tick per step of the clock, and every node, message in flight, election timer and log slot on screen is read back from it after each tick. Crashing a node, cutting the leader off with a minority, healing and putting a key are calls into that stepper; a put goes to the leader as a client request, and the simulator's own checks for election safety and state-machine safety run on every step.
