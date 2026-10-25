---
title: strata
tagline: A native iPad 3D-printing slicer with a Rust core, working offline on the device.
lang: Rust, Swift
tags: geometry, slicing, G-code, UniFFI, SwiftUI
repo:
demo: live
demo_try: Slice a calibration model or your own STL, OBJ or 3MF, then scrub through its layers' toolpaths.
order: 8
metric: a 3DBenchy with 5,868 facets removed and 239 flipped repairs to 0 open edges, volume within 0.5%
metric_source: docs/features.md, mesh repair (measured)
---
strata slices STL models into G-code on the iPad itself: perimeters, infill, a Metal build-plate view,
part placement, and printing straight from the app over Moonraker, OctoPrint and PrusaLink.
The slicing engine is Rust, exposed to SwiftUI through UniFFI. strata is a codename.

The demo runs strata's Rust slicing engine, the crate the iPad app is built on, compiled to WebAssembly
in your tab. It builds one of strata's calibration models, or parses the STL, OBJ or 3MF you open (the
file stays in your browser), repairs the mesh and stands it on the plate, then slices it at the layer
height you pick with the engine's default settings. Each layer's toolpaths are drawn by kind, from the
engine's own output; the slice time is measured in your browser around that one call. It shows
toolpaths, not a print: strata's first real print is still pending.
