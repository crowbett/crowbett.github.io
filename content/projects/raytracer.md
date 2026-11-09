---
title: raytracer
tagline: A C++20 path tracer with light sampling, MIS and a SAH BVH.
lang: C++
tags: path tracing, Monte Carlo, importance sampling, BVH
repo:
demo: live
demo_try: Drag the divider over the ceiling. The left half finds the lamp only by chance, so at the same samples per pixel it stays grainy.
group: graphics
order: 10
metric: 187.5 ms for the book 1 cover (400x225, 50 spp), from 8.865 s single-threaded with no BVH
metric_source: BENCH.md, hyperfine, Apple M3 Pro; 12 threads, SAH BVH
---
- Follows *Ray Tracing in One Weekend* books 1 to 3, then goes past them: next-event estimation with MIS (power heuristic) and Russian roulette is the default integrator.
- A tiled `std::thread` renderer whose image is bit-identical at any thread count, over a flattened BVH built with a binned surface area heuristic.
- Measured light sampling: on the Cornell box, book 3's light/material mixture leaves 3.55× to 3.78× less RMSE than material-only sampling at 16 to 256 spp (BENCH.md).
- Header-only, no dependencies; `make gate` builds and tests it under ASan/UBSan, optimized and under ThreadSanitizer.

## How the demo works

The renderer's own scenes, BVH and integrators, compiled from C++ to WebAssembly and running on one thread. It starts rendering as soon as it loads. Each call traces one more sample per pixel for a band of rows, with both strategies on the same rows, so the two halves always have equal spp.

Every call also returns the renderer's noise estimate (est. RMSE, from each pixel's sample variance, not from a reference image). The chart plots it on log-log axes against samples per pixel, or against each half's measured render time, beside the 1/√n line. Tapping the image adds 32 samples to every pixel in a band of rows, in both halves. The bar beside the image shows samples per row, and your extra samples are drawn in blue.
