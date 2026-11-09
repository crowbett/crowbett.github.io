---
title: ratelimitd
tagline: A distributed rate limiter in Go that degrades limits instead of taking the API down when Redis fails.
lang: Go
tags: rate limiting, GCRA, Redis, gRPC
repo: https://github.com/crowbett/ratelimitd
demo: live
demo_try: Launch the attack. GCRA and the token bucket turn away almost exactly the same requests; the sliding window lets a different share through.
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

ratelimitd's own `Step` functions, compiled to WebAssembly. Each run is one `race` call: 60 seconds of seeded traffic in one of the bridge's four shapes, through all three algorithms at your limit and burst. The binary answers with allowed and denied counts for each of 240 time slices, and the floor plays them back on simulated time: each dot is one request, and the strips show allowed and denied per second. The order of dots inside one slice is drawn, not reported.

Launch the attack (or fire a burst) re-runs the same seed with the flood timed to start now; moving the limit or burst re-runs it too. The traffic before it doesn't depend on that timing, so the requests and verdicts you already saw stay the same. The binary reports counts only, not each algorithm's tokens, TAT or wait.

GCRA and the token bucket enforce the same limit with different state, so their lanes match up to integer rounding. The sliding window has no burst and estimates a moving window from two counts, so it lets a different share through.
