---
title: AnchorFlow
tagline: A warehouse management system in Go that ran a multi-store shipping floor, with an engine that picks the package for each order.
lang: Go
tags: warehouse, 3D bin packing, Postgres, WebAssembly
repo:
demo: live
demo_try: Watch carts get picked, packed and labelled, then repeat a coffee basket until shape history answers, or move a product to another bin.
group: services
order: 16
metric: Shape history accuracy 98.6% on the same basket, 89.1% on the same shape, 67.0% on the same kinds
metric_source: 25,021 shipments, train/test disjoint in time, internal/packsuggest/shape_key.go line 1
---
- One Go service (Chi, Postgres, Redis) with a Next.js floor UI: Shopify orders in, then pick, pack, rate shopping and labels through ShipEngine, printed by its own agent on thermal printers.
- The fit engine names the cheapest package a basket fits. Boxes are packed by an extreme-point packer, and mailers by a flat-bag model (girth, fill, bulge) calibrated on 13,348 packed orders.
- Warehouse rules come first. The engine answers only where no rule does, and it stays silent when nothing on the shelf fits.
- Where the engine declines a basket, shape history answers from how the same basket or the same shape shipped before, from a model the server rebuilds every 24 hours over a 76-day window.

## How the demo works

The demo org's floor runs on AnchorFlow's own packages compiled to WebAssembly: `internal/warehouse`, `internal/models`, `internal/qrcode`, `internal/packsuggest`, `internal/packfit` and `internal/labelzpl`. Its four stores, 25 products, customers and bins are made up, the same ones the local demo seeds.

- **Order and pick.** A cart takes four orders, one tote each. Their lines are sorted into walk order by `models.CompareBinWalk`, and each stop's bin label is encoded and read back by `qrcode`, as the handheld scans it.
- **Pack.** Each tote goes through the suggestion pyramid (`packsuggest`). The demo org has no packaging rules, so the fit engine answers first. It declines the coffee store's bags and mugs; for those, shape history answers once the same basket or shape has shipped at least 3 times with 70 % in one package, and otherwise the fit engine tries any package. The ladder shows each step and why it did or did not answer, and the drawing is `packfit.PlanFor`'s arrangement of the basket in the package the packer took.
- **Learn.** Every shipment is tallied into the shape model with the same code the 24-hour refresh runs. The demo keeps the last 1,000 shipments and updates after each one, so you can watch it learn.
- **Label.** The binary writes the 4x6 label and the packing slip as ZPL (`labelzpl`), and the page draws that ZPL.
- **Manifest and writeback** call the carrier and Shopify, so they stay on the server.

Set the orders to the same basket again to watch shape history take over, or tell the packer to take another package for a coffee order and see shape history start suggesting it. Move a product to another bin: `warehouse.ParseBin` checks the label against the aisle layout (aisle A-01 has odd-numbered bins only), and the next cart walks there. A pack call took 1,078.389 to 1,810.078 µs as WebAssembly in Node on an Apple M3 Pro (`cmd/webdemo/BENCH.md`, 3 runs).
