---
title: mcpbridge
tagline: Translates MCP between the 2024 session protocol and the stateless 2026-07-28 spec, both ways.
lang: Go
tags: MCP, protocol translation, JSON-RPC, conformance testing
repo:
demo: live
demo_try: Press Send mine and follow your request across the bridge; the inspector shows what changed, key by key.
group: tools
order: 13
metric: 289/291 official MCP conformance checks through the bridge, 101 scenario runs
metric_source: docs/conformance.md, suite 0.2.0-alpha.10, re-checked by CI on every push
---
- The 2026-07-28 MCP spec removed the `initialize` handshake and sessions. mcpbridge answers the handshake itself, keeps the session, and adds the per-request `_meta` a stateless server requires. In reverse it performs the handshake for a modern client against a legacy server.
- Every frame is translated to spec or refused with an explicit `unsupported:` error. Nothing is approximated.
- The 2 failing checks are one structural limit. A legacy server never names its input requests, so the bridge mints keys (`in1`) where a scenario expects `user_name`, and it answers three concurrent requests over sequential rounds because stdio carries no sign that they belong together.
- One Go binary on the standard library alone; it also runs as an HTTP sidecar serving clients of either era on one endpoint.

## How the demo works

mcpbridge's translation engines, compiled to WebAssembly, sit between a scripted client and the repo's own conformance fixture servers, all in your browser. Each client frame is one call into the bridge; every frame it reports on all four legs then crosses the sequence diagram on a simulated clock, and a frame the bridge rewrote changes size and colour where it passes through. The scenarios play one after another; you can send your own request into the live session, run a scenario against the other server era, and compare any frame with the one it came from, key by key. Bridge-minted ids use a fixed nonce so a replay is identical.
