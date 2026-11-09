---
title: grepall
tagline: Trigram-indexed code search in Go across every git repo on a machine, from CLI, web UI or MCP.
lang: Go
tags: code search, trigram index, regexp, MCP
repo:
demo: live
demo_try: Watch the tour type a query, then type your own and see its trigrams' posting lists narrow 283 files to candidates on every keystroke.
group: tools
order: 11
metric: Query latency p50 12.8 ms · p90 80 ms · p99 254 ms
metric_source: 82 repos / 62,339 files, Windows 11, 16 cores, README.md Numbers
---
- One memory-mapped shard per repository: trigram posting lists, per-file line tables and CRC-32C-checked sections, rebuilt only when HEAD or the work tree changes.
- A regexp becomes a boolean trigram query the way Russ Cox's codesearch does it, written from scratch over Go's `regexp/syntax` and checked against a brute-force oracle over random regexps and documents.
- Indexing never runs repo-controlled code, skips secrets even when git tracks them, and never follows a symlink or junction out of a repo.
- The latency above was measured over 14 mixed queries × 20 runs while the machine's CPU load was 88–97%.

## How the demo works

grepall's own shard builder, query planner, posting lists and matcher, compiled to WebAssembly. On arrival it indexes 283 files from 34 packages of the Go 1.27.3 standard library (BSD licence), one shard per package, and draws each shard as it lands. A tour then types queries one key at a time. Every keystroke plans the query, reads each trigram's posting list from the index, takes the candidates and verifies them with the real matcher, and the board shows each list, the candidates and the matches over all 283 files. Pause it and type your own query or regexp.
