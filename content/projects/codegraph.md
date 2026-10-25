---
title: codegraph
tagline: A Rust CLI and MCP server that answers "who calls this, and what breaks if I change it" across 8 languages.
lang: Rust
tags: static analysis, MCP, call graphs
repo: https://github.com/crowbett/codegraph
demo: live
demo_try: Pick a function in a small Rust sample and see who calls it and what it calls, with each edge's confidence.
order: 7
metric: 99.5% callers recall, 0.6% false call edges vs SCIP ground truth
metric_source: 16 repos / 1,079 files, docs/ACCURACY.md
---
codegraph builds a call and reference graph for AI agents and measures every edge's accuracy against
compiler-grade ground truth (scip-go, rust-analyzer, scip-typescript, scip-python). Edges it marks
`exact` are 99.9% correct (47,193 of 47,258).

The demo runs codegraph's indexer, resolver and SQLite graph compiled to WebAssembly: it indexes a
four-file Rust sample in your tab and lists the callers and callees the resolver reports for the
function you pick, each with the confidence codegraph gives it. Calls it cannot resolve, such as those
into the standard library or `e.is_fatal()`, whose receiver type it does not infer, are listed as
unresolved. Every answer matches native codegraph's on the same files
(`crates/codegraph-web/check.mjs` in the repo).
