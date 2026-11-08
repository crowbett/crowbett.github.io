---
title: lobby
tagline: A game backend in Go: skill matchmaking, WebSocket lobbies, leaderboards and game-server handoff.
lang: Go
tags: matchmaking, WebSocket, Redis, HMAC
repo:
demo: live
demo_try: Tap the skill axis to queue your own player, then watch its window widen until someone fits.
order: 14
metric: 433.5 short-handed handoffs per 1000-bot squad run before refill, 0 after (medians of 6)
metric_source: results/swarm/20260924-113450.md, Ryzen 7 3700X, loaded box
---
- Matchmaking whose skill window widens with wait, from 50 to 400 points over 30 s. `Queue.Step` is pure and deterministic, and a property test checks it against an O(n²) oracle over 400 seeds.
- WebSocket lobbies with heartbeat and reconnect, Redis sorted-set leaderboards, and an HMAC-signed handoff that a real netcode server enforces seat by seat.
- Squad refill: when a player walks out of a forming squad, the rest go back into the queue as one unit and keep their wait. The A/B ran on a loaded box against a build with uncommitted changes (`-dirty` in the results file).
- A 1000-bot swarm at 200 bots/s matched every bot, with a p99 time-to-match of 234 ms (`results/swarm/20260919-133804.md`).

## How the demo works

lobby's own `match` and `handoff` packages, compiled to WebAssembly. Each band is `match.Window` for that player's wait, and every 100 ms of simulated time the real `Queue.Step` forms the groups; each room's handoff tokens are minted and verified by `handoff.Static`. The walk-out and refill room model is the demo's own, following `internal/lobby` without sockets.
