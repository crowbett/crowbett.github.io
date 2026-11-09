---
title: strata
tagline: A native iPad 3D-printing slicer with a Rust core, working offline on the device.
lang: Rust, Swift
tags: geometry, slicing, G-code, UniFFI, SwiftUI
repo:
demo: live
demo_try: Watch the XY test piece build up layer by layer, then change the layer height or open your own STL, OBJ or 3MF.
group: graphics
order: 8
metric: 0 open edges after repairing a 3DBenchy with 5,868 facets removed and 239 flipped, volume within 0.5%
metric_source: docs/features.md, mesh repair (measured)
---
- Slices models into G-code on the iPad itself: perimeters, infill, part placement and a Metal build-plate view.
- Prints straight from the app over Moonraker, OctoPrint and PrusaLink.
- A Rust slicing engine exposed to SwiftUI through UniFFI. strata is a codename.

## How the demo works

The Rust engine the iPad app is built on, compiled to WebAssembly. It builds a calibration model or opens your file (which stays in your browser), repairs the mesh, stands it on the plate and slices it at your layer height. The page draws every layer's toolpaths as the engine returns them: a nozzle traces them in the order they were generated, and the layers stack up in 3D. The G-code planner, which reorders paths and adds travel, is not in the demo, and these are toolpaths, not a print: strata's first real print is still pending.
