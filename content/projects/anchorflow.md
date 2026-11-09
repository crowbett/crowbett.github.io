---
title: AnchorFlow
tagline: A warehouse management system in Go that ran a multi-store shipping floor, with an engine that picks the package for each order.
lang: Go
tags: warehouse, 3D bin packing, Postgres, WebAssembly
repo:
demo: live
demo_try: Watch orders get packed, then drop your own order on the line or take the top pick off the shelf.
group: services
order: 16
metric: 1.56 to 10.79 ms to judge a 10-unit basket against 31 packages
metric_source: Apple M3 Pro, cmd/webdemo/BENCH.md (median of 3, native)
---
- One Go service (Chi, Postgres, Redis) with a Next.js floor UI: Shopify orders in, then pick, pack, rate shopping and labels through ShipEngine, printed by its own agent on thermal printers.
- The fit engine names the cheapest package a basket fits. Boxes are packed by an extreme-point packer, and mailers by a flat-bag model (girth, fill, bulge) calibrated on 13,348 packed orders.
- Warehouse rules come first. The engine answers only where no rule does, and it stays silent when nothing on the shelf fits.

## How the demo works

AnchorFlow's own `internal/packfit` package, compiled to WebAssembly, runs a packing floor against its reference catalog of 31 boxes, mailers and inserts (dimensions in inches). Orders arrive at random on simulated floor time, built from item shapes the engine's own tests use. The engine picks each order's package, and the items drop into it where the engine placed them, seen from above and from the front.

The engine takes the cheapest mailer an order fits, and a box only when no mailer will do. Its rules come first: liquids, hats and shakers must go in a box, plain poly carries only soft goods, and specialty boxes are kept for their own items. The tally counts boxes and mailers, cost, fill and the packages picked most. Drop your own order on the line, or take packaging off the shelf: the engine re-judges every order packed so far and says how many picks changed and what it did to the cost.
