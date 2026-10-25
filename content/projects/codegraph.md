---
title: codegraph
tagline: A Rust CLI and MCP server that answers "who calls this, and what breaks if I change it" across 8 languages.
lang: Rust
tags: static analysis, MCP, call graphs
repo: https://github.com/crowbett/codegraph
demo: planned
order: 7
metric: 99.5% callers recall, 0.6% false call edges vs SCIP ground truth
metric_source: 16 repos / 1,079 files, docs/ACCURACY.md
---
codegraph builds a call and reference graph for AI agents and measures every edge's accuracy against
compiler-grade ground truth (scip-go, rust-analyzer, scip-typescript, scip-python). Edges it marks
`exact` are 99.9% correct (47,193 of 47,258).

The planned demo indexes a small sample repository in your browser and lets you ask who calls a function.
