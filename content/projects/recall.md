---
title: recall
tagline: Personal search over everything you've touched: one local index over code, docs, git history, Claude Code conversations, browser history and notes.
lang: Rust
tags: search, BM25, hybrid ranking, MCP
repo:
demo: live
demo_try: Watch the corpus stream into the index and the tour's queries rank, then type your own query, filter by source or index a note of yours.
group: tools
order: 18
metric: BM25 query latency p50 1.2–2.2 ms
metric_source: 37 812 documents, README Numbers (real machine, 2026-09-25)
---
- One Tantivy index over five sources, searched from the terminal and by Claude through a read-only MCP server.
- Incremental: a source is re-read only when a file's mtime or size changed, and rewritten only when its content hash changed.
- Optional hybrid search: a local embedding model in a Python sidecar, merged with BM25 by reciprocal rank fusion.
- Private by construction: nothing leaves the machine, and obvious secrets are redacted before anything is stored.

## How the demo works

recall's own source parsers, redaction, Tantivy index and ranking, compiled from Rust to WebAssembly, index a small synthetic project in your tab: a fake Go job queue's files, its git log, three Claude Code sessions and a notes folder. Nothing on the page comes from a real machine. Each query runs through recall's query parser, then BM25 over title (boosted 2×) and body with English stemming, all terms required and falling back to any term when none match. Tantivy's own explanation of each score is split into its terms' idf and tf. The hero draws the BM25 list and the vector list fusing into the final ranking, each document's line running from its rank in a lane to its fused rank.

Two parts of recall don't run in the browser, and the page says so. The real embedding model, bge-small in a Python sidecar, doesn't ship, so the vector lane is recall's own `builtin:hash` embedder: a 256-dimension hash of each word, deterministic and offline, which recall's README marks as not for real semantic quality. The browser-history source reads Chrome's SQLite file and is left out of the build. The in-browser index is rebuilt in memory after each source or note you add.
