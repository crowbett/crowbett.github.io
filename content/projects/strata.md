---
title: strata
tagline: A native iPad 3D-printing slicer with a Rust core, working offline on the device.
lang: Rust, Swift
tags: geometry, slicing, G-code, UniFFI, SwiftUI
repo:
demo: planned
order: 8
---
strata slices STL models into G-code on the iPad itself: perimeters, infill, a Metal build-plate view,
part placement, and printing straight from the app over Moonraker, OctoPrint and PrusaLink.
The slicing engine is Rust, exposed to SwiftUI through UniFFI. strata is a codename.

The planned demo compiles the same Rust slicing core to WebAssembly: load a model and scrub through its layers.
