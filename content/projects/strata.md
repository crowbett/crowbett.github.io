---
title: strata
tagline: A native iPad 3D-printing slicer with a Rust core, working offline on the device.
lang: Rust, Swift
tags: geometry, slicing, G-code, UniFFI, SwiftUI
repo:
demo: planned
order: 8
metric: a 3DBenchy with 5,868 facets removed and 239 flipped repairs to 0 open edges, volume within 0.5%
metric_source: docs/features.md, mesh repair (measured)
---
strata slices STL models into G-code on the iPad itself: perimeters, infill, a Metal build-plate view,
part placement, and printing straight from the app over Moonraker, OctoPrint and PrusaLink.
The slicing engine is Rust, exposed to SwiftUI through UniFFI. strata is a codename.

The planned demo compiles the same Rust slicing core to WebAssembly: load a model and scrub through its layers.
