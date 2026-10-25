---
title: ratelimitd
tagline: A distributed rate limiter in Go that degrades limits instead of taking the API down when Redis fails.
lang: Go
tags: rate limiting, GCRA, Redis, gRPC
repo: https://github.com/crowbett/ratelimitd
demo: planned
order: 3
metric: 43,574 decisions/s at a 6.83 ms p99 over gRPC against Redis
metric_source: Ryzen 7 3700X, results/bench/20260919-121852.md
---
GCRA, token bucket and sliding window are each decided in one atomic Redis Lua call. A circuit breaker
falls back to local limits when Redis is unreachable, so an outage loosens limits instead of failing requests.

On a single saturated key it allowed 0.3963 of requests against 0.3963 expected from the closed form.
The README also records the goal it missed (50k/s at p99 under 5 ms on the Redis path) and why.

The planned demo races the three algorithms side by side on the same traffic, in your browser.
