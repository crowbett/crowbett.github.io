---
title: jobrun
tagline: A durable job queue on Postgres in one Go binary, with no broker.
lang: Go
tags: job queue, Postgres, gRPC, cron
repo: https://github.com/crowbett/jobrun
demo: live
demo_try: Press Enqueue flaky job and watch its retries wait out the backoff, then type your own cron expression.
group: services
order: 6
metric: ~1,030 jobs/s completed at saturation with the default 16 workers
metric_source: README results, one Windows 11 box, Postgres 17, medians of 3 runs
---
- `SELECT ... FOR UPDATE SKIP LOCKED` plus `LISTEN/NOTIFY` does the dispatching, with no broker.
- Fenced leases, out-of-process workers over gRPC, cron, retries with backoff and a retryable dead-letter state.
- Exactly-once side effects for in-process handlers on the transaction path, and W3C trace context from enqueue to run.

## How the demo works

A small scheduler runs on simulated time, driven by jobrun's own cron parser (`internal/cronx`) and retry policy (`job.Policy`), compiled to WebAssembly. Every fire time comes from cronx and every retry delay is a full-jitter draw from job.Policy; the workers, handler run times and which attempts fail are the page's stand-ins for real handlers, and workers claim jobs in jobrun's order (priority, then run_at). It opens just after an outage, so you can see the retries spread out. Enqueue a flaky job of your own, turn jitter off and cause another outage to see every retry wait exactly the cap, or type a cron expression and time zone to see its fires on the timeline and its next five runs.
