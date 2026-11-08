---
title: jobrun
tagline: A durable job queue on Postgres in one Go binary, with no broker.
lang: Go
tags: job queue, Postgres, gRPC, cron
repo: https://github.com/crowbett/jobrun
demo: live
demo_try: See a cron expression's next ten runs in any time zone, or the delay after each failed attempt.
order: 6
metric: ~1,030 jobs/s completed at saturation with the default 16 workers
metric_source: README results, one Windows 11 box, Postgres 17, medians of 3 runs
---
- `SELECT ... FOR UPDATE SKIP LOCKED` plus `LISTEN/NOTIFY` does the dispatching, with no broker.
- Fenced leases, out-of-process workers over gRPC, cron, retries with backoff and a retryable dead-letter state.
- Exactly-once side effects for in-process handlers on the transaction path, and W3C trace context from enqueue to run.

## How the demo works

jobrun's own cron parser (`internal/cronx`) and retry policy (`job.Policy`), compiled to WebAssembly. See the next ten runs of a cron expression, including across a daylight-saving change, or the delay after each failed attempt and the attempt that dead-letters the job.
