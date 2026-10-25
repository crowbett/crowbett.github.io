---
title: jobrun
tagline: A durable job queue on Postgres in one Go binary, with no broker.
lang: Go
tags: job queue, Postgres, gRPC, cron
repo: https://github.com/crowbett/jobrun
demo: live
demo_try: Type a cron expression and a time zone to see the next ten runs, or set a retry policy and see the delay after each failed attempt.
order: 6
metric: ~1,030 jobs/s completed at saturation with the default 16 workers
metric_source: README results, one Windows 11 box, Postgres 17, medians of 3 runs
---
`SELECT ... FOR UPDATE SKIP LOCKED` plus `LISTEN/NOTIFY` does the dispatching. On top: fenced leases,
out-of-process workers over gRPC, a cron scheduler, retries with backoff, a dead-letter state you can
retry, exactly-once side effects for in-process handlers on the transaction path, and W3C trace context from enqueue to run.

The demo runs jobrun's own cron parser (`internal/cronx`) and retry policy (`job.Policy`), compiled to
WebAssembly. Type a cron expression and a time zone to see the next ten runs, including what happens
across a daylight-saving change, or set a backoff policy to see the delay after each failed attempt
and the attempt that sends the job to the dead-letter state.
