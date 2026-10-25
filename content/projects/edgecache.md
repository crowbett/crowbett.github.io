---
title: edgecache
tagline: An RFC 9111 HTTP caching reverse proxy in Go.
lang: Go
tags: HTTP caching, RFC 9111, reverse proxy
repo: https://github.com/crowbett/edgecache
demo: live
order: 4
metric: 0.65 ms p50 cached against a 50 ms origin (39,253 rps, 99.9% hit ratio)
metric_source: Ryzen 7 3700X, README benchmarks, results/20260922-181426
---
edgecache sits in front of one origin and implements HTTP caching by the RFC: freshness and validation,
`stale-while-revalidate` and `stale-if-error`, `Vary`, request collapsing with a detached leader,
memory and disk tiers, a purge API and hand-written Prometheus metrics. The caching packages use the
Go standard library only; OpenTelemetry tracing and metrics, off by default, is the one third-party
dependency.

The demo runs edgecache's own cache engine and in-memory store, compiled to WebAssembly, in front of a
scripted origin on a simulated clock. Pick a preset or set the origin's response headers and a list of
request times: each request shows what the engine answered (HIT, MISS, STALE, REVALIDATED or BYPASS),
the `Age` it sent, which version of the body you got, and what reached the origin.
