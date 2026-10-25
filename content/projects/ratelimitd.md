---
title: ratelimitd
tagline: A distributed rate limiter in Go that degrades limits instead of taking the API down when Redis fails.
lang: Go
tags: rate limiting, GCRA, Redis, gRPC
repo: https://github.com/crowbett/ratelimitd
demo: live
order: 3
metric: 43,574 decisions/s at a 6.83 ms p99 over gRPC against Redis
metric_source: Ryzen 7 3700X, results/bench/20260919-121852.md
---
GCRA, token bucket and sliding window are each decided in one atomic Redis Lua call. A circuit breaker
falls back to local limits when Redis is unreachable, so an outage loosens limits instead of failing requests.

On a single saturated key it allowed 0.3963 of requests against 0.3963 expected from the closed form.
The README also records the goal it missed (50k/s at p99 under 5 ms on the Redis path) and why.

The demo runs ratelimitd's own GCRA, token bucket and sliding window `Step` functions, compiled to
WebAssembly. Pick a traffic shape, a limit and a burst: the same seeded requests go through all three,
and each chart shows what was allowed and denied in every half second of a 30 second run.

GCRA and the token bucket enforce the same limit with different state (one timestamp, against a token
count and a refill time), so their charts match; at limits that do not divide a second evenly, integer
rounding can shift a few decisions. The sliding window has no burst: it estimates a moving one-second window
from the current and previous one-second counts, so it answers differently and can briefly let through
more than the limit.
