---
title: codegraph
tagline: A Rust CLI and MCP server that answers "who calls this, and what breaks if I change it" across 8 languages.
lang: Rust
tags: static analysis, MCP, call graphs
repo: https://github.com/crowbett/codegraph
demo: live
demo_try: Tap any function, or search for bump, and follow its callers and callees outward one hop at a time.
group: tools
order: 7
metric: 99.5% callers recall, 0.6% false call edges vs SCIP ground truth
metric_source: 16 repos / 1,079 files, docs/ACCURACY.md
---
- A call and reference graph for AI agents, served from a CLI and an MCP server.
- Every edge's accuracy is measured against compiler-grade ground truth: scip-go, rust-analyzer, scip-typescript and scip-python.
- Edges it marks `exact` are 99.9% correct (47,193 of 47,258).

## How the demo works

codegraph's indexer, resolver and SQLite graph, compiled to WebAssembly, index a four-file Rust sample in your tab. The graph is drawn from one `callees` query per function, and a tour then walks it along those edges. Picking a function, a search or a source line asks the binary for its callers and callees, then asks again for each function reached, one hop at a time; the binary resolves names, `Type::method` and `file:line` itself, and marks calls through a trait as `via`. Calls it cannot resolve, such as those into the standard library, are counted as unresolved. Its callers and callees of every function match native codegraph on the same files (`crates/codegraph-web/check.mjs`).
