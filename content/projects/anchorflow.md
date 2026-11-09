---
title: AnchorFlow
tagline: A warehouse management system in Go that ran a multi-store shipping floor, with an engine that picks the package for each order.
lang: Go
tags: warehouse, 3D bin packing, Postgres, WebAssembly
repo:
demo: live
demo_try: Build a basket, take packaging off the shelf, and see which box or mailer the engine picks and how the items sit in it.
group: services
order: 16
metric: 1.56 to 10.79 ms to judge a 10-unit basket against 31 packages
metric_source: Apple M3 Pro, cmd/webdemo/BENCH.md (median of 3, native)
---
- One Go service (Chi, Postgres, Redis) with a Next.js floor UI: Shopify orders in, then pick, pack, rate shopping and labels through ShipEngine, printed by its own agent on thermal printers.
- The fit engine names the cheapest package a basket fits. Boxes are packed by an extreme-point packer, and mailers by a flat-bag model (girth, fill, bulge) calibrated on 13,348 packed orders.
- Warehouse rules come first. The engine answers only where no rule does, and it stays silent when nothing on the shelf fits.

## How the demo works

AnchorFlow's own `internal/packfit` package, compiled to WebAssembly, runs against its reference catalog of 31 boxes, mailers and inserts (dimensions in inches). Each change to the basket or the shelf asks the engine again.

The engine takes the cheapest mailer the basket fits, and a box only when no mailer will do. Its rules decide which packages it may use at all: liquids, hats and shakers must go in a box, plain poly carries only soft goods, and specialty boxes are kept for their own items. The table gives the engine's own reason for every package it passed over. The drawings show the answer's arrangement from above and from the front.
