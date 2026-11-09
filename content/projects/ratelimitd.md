---
title: ratelimitd
tagline: A distributed rate limiter in Go that degrades limits instead of taking the API down when Redis fails.
lang: Go
tags: rate limiting, GCRA, Redis, gRPC
repo: https://github.com/crowbett/ratelimitd
demo: live
demo_try: Race GCRA, token bucket and sliding window on the same traffic, at your limit and burst.
group: services
order: 3
metric: 43,574 decisions/s at a 6.83 ms p99 over gRPC against Redis
metric_source: Ryzen 7 3700X, results/bench/20260919-121852.md
---
- GCRA, token bucket and sliding window, each decided in one atomic Redis Lua call.
- When Redis is unreachable, a circuit breaker falls back to local limits: an outage loosens limits instead of failing requests.
- On one saturated key it allowed 0.3963 of requests, against 0.3963 expected from the closed form.
- The README also records the goal it missed (50k/s at p99 under 5 ms on the Redis path) and why.

## How the demo works

ratelimitd's own `Step` functions, compiled to WebAssembly. The same seeded requests go through all three; each chart shows allowed and denied per half second over 30 seconds.

GCRA and the token bucket enforce the same limit with different state, so their charts match up to integer rounding. The sliding window has no burst and estimates a moving window from two counts, so it can briefly let through more than the limit.
