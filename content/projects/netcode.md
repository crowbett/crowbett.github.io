---
title: netcode
tagline: Rollback netcode in Rust for a deterministic 60 Hz arena with an authoritative UDP server.
lang: Rust
tags: rollback, client-side prediction, snapshot interpolation, UDP, determinism
repo:
demo: live
demo_try: Steer with WASD, the arrow keys or a drag, then raise latency and loss and watch the rollbacks.
order: 9
metric: 0 desyncs and 0 hash mismatches in a 30 s soak of 4 bots over UDP at 100 ms latency, 20 ms jitter and 2% loss
metric_source: README.md, Soak (measured 2026-10-07)
---
- A float-free, fixed-point simulation at 60 Hz. The server compares every client's hash of its confirmed state with its own history.
- Clients predict their own player and roll back and resimulate when a snapshot disagrees. Everyone else is interpolated. Snapshots are deltas against the last one the client confirmed.
- A seeded lag simulator for latency, jitter, loss, duplication and reordering sits under the transport. A soak over real UDP loopback gates every commit.
- Stateless HMAC cookie handshake, redundant input batches, an adaptive input margin and Prometheus metrics.

## How the demo works

netcode's real server and client session code, compiled from Rust to WebAssembly, runs a six-player match on simulated 60 Hz ticks. You drive player 0, netcode's bots drive the rest, and every datagram is encoded, passed through netcode's lag simulator both ways and decoded. Unlike the UDP build, the demo skips the connect handshake and handles packets only at tick boundaries.
