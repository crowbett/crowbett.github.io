---
title: AnchorFlow
tagline: A warehouse management system in Go that ran a multi-store shipping floor, with an engine that picks the package for each order.
lang: Go
tags: warehouse, 3D bin packing, Postgres, WebAssembly
repo:
demo: planned
group: services
order: 16
metric: 1.56 to 10.79 ms to judge a 10-unit basket against 31 packages
metric_source: Apple M3 Pro, cmd/webdemo/BENCH.md (median of 3, native)
---
- One Go service (Chi, Postgres, Redis) with a Next.js floor UI: Shopify orders in, then pick, pack, rate shopping and labels through ShipEngine, printed by its own agent on thermal printers.
- The fit engine names the cheapest package a basket fits. Boxes are packed by an extreme-point packer, and mailers by a flat-bag model (girth, fill, bulge) calibrated on 13,348 packed orders.
- Warehouse rules come first. The engine answers only where no rule does, and it stays silent when nothing on the shelf fits.

