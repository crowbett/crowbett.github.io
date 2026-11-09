---
title: edgecache
tagline: An RFC 9111 HTTP caching reverse proxy in Go.
lang: Go
tags: HTTP caching, RFC 9111, reverse proxy
repo: https://github.com/crowbett/edgecache
demo: live
demo_try: Set the origin's cache headers and request times, and see which requests hit, go stale or reach the origin.
group: services
order: 4
metric: 0.65 ms p50 cached against a 50 ms origin (39,253 rps, 99.9% hit ratio)
metric_source: Ryzen 7 3700X, README benchmarks, results/20260922-181426
---
- HTTP caching by the RFC in front of one origin: freshness and validation, `stale-while-revalidate`, `stale-if-error` and `Vary`.
- Request collapsing with a detached leader, memory and disk tiers, a purge API and hand-written Prometheus metrics.
- The caching packages use the Go standard library only. OpenTelemetry, off by default, is the one third-party dependency.

## How the demo works

edgecache's own cache engine and in-memory store, compiled to WebAssembly, in front of a scripted origin on a simulated clock. Each request shows the engine's answer (HIT, MISS, STALE, REVALIDATED or BYPASS), the `Age` it sent, the body version you got and what reached the origin.
