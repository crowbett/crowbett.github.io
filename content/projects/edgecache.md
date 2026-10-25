---
title: edgecache
tagline: An RFC 9111 HTTP caching reverse proxy in Go.
lang: Go
tags: HTTP caching, RFC 9111, reverse proxy
repo: https://github.com/crowbett/edgecache
demo: planned
order: 4
metric: 0.65 ms p50 cached against a 50 ms origin (39,253 rps, 99.9% hit ratio)
metric_source: Ryzen 7 3700X, README benchmarks, results/20260922-181426
---
edgecache sits in front of one origin and implements HTTP caching by the RFC: freshness and validation,
`stale-while-revalidate` and `stale-if-error`, `Vary`, request collapsing with a detached leader,
memory and disk tiers, a purge API and hand-written Prometheus metrics. The caching packages use the
Go standard library only; OpenTelemetry tracing and metrics, off by default, is the one third-party
dependency.

The planned demo runs its real RFC 9111 freshness logic in your browser: set response headers and a
clock, and see when each request is a hit, stale, revalidated or a miss.
