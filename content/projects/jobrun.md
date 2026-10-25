---
title: jobrun
tagline: A durable job queue on Postgres in one Go binary, with no broker.
lang: Go
tags: job queue, Postgres, gRPC, cron
repo: https://github.com/crowbett/jobrun
demo: planned
order: 6
metric: saturates at ~1,030 jobs/s completed with the default 16 workers
metric_source: README results, one Windows 11 box, Postgres 17, medians of 3 runs
---
`SELECT ... FOR UPDATE SKIP LOCKED` plus `LISTEN/NOTIFY` does the dispatching. On top: fenced leases,
out-of-process workers over gRPC, a cron scheduler, retries with backoff, a dead-letter state you can
retry, exactly-once side effects for in-process handlers on the transaction path, and W3C trace context from enqueue to run.

The planned demo runs its real cron parser and retry schedule in your browser: type a cron
expression and see the next runs, or fail a job and watch the backoff.
