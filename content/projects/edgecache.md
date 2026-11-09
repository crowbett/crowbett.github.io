---
title: edgecache
tagline: An RFC 9111 HTTP caching reverse proxy in Go.
lang: Go
tags: HTTP caching, RFC 9111, reverse proxy
repo: https://github.com/crowbett/edgecache
demo: live
demo_try: Press Send my request to reload through the running edge, then change the origin policy and watch the same traffic replay.
group: services
order: 4
metric: 0.65 ms p50 cached against a 50 ms origin (39,253 rps, 99.9% hit ratio)
metric_source: Ryzen 7 3700X, README benchmarks, results/20260922-181426
---
- HTTP caching by the RFC in front of one origin: freshness and validation, `stale-while-revalidate`, `stale-if-error` and `Vary`.
- Request collapsing with a detached leader, memory and disk tiers, a purge API and hand-written Prometheus metrics.
- The caching packages use the Go standard library only. OpenTelemetry, off by default, is the one third-party dependency.

## How the demo works

edgecache's own cache engine and in-memory store, compiled to WebAssembly, sit in front of a scripted origin on a simulated clock. Clients send GETs on a schedule. As each one comes due, the bridge replays the run so far through a fresh engine (the clock is simulated, so the replay gives the same answers), and the page draws what the engine answered: X-Cache (HIT, STALE, REVALIDATED, MISS or BYPASS), the `Age` header, the body version, and every request it sent to the origin, including background revalidations. The age chart plots the reported `Age` values. The origin chart counts client requests against origin requests in 10 s buckets. Your own request joins the running schedule. A new origin policy replays all the requests so far under the new headers. Each run starts with an empty cache and holds up to 40 requests, the most the bridge takes in one call.
