---
title: adfactory
tagline: One source clip in, every platform's ad out: cropped, captioned, loudness-normalised and verified.
lang: Go
tags: video pipeline, ffmpeg, reframing, captions, loudness, QC
repo:
demo: live
demo_try: Grab the presenter and drag them across the frame; all nine deliverables re-plan on every move.
group: tools
order: 18
metric: 37/37 QC ok on NVENC
metric_source: README platform table, the real fixture matrix on Windows 11 (Ryzen 7 3700X, RTX 3070, loaded box)
---
- A manifest says what to assemble: the cuts, the on-screen copy, the captions, the brand. A spec table says how to deliver it: size, safe zones, codec, loudness, duration limits. One manifest renders correctly to every platform, and adding a platform is a table row.
- Delivers Reels, TikTok, Shorts, 4:5 and 1:1 feed, YouTube, broadcast and stills from one source. Every file it writes is measured again against its target's spec, and a file that fails goes to `out/rejected/` with the numbers.
- Reframes from subject detection: it splits the source into shots and anchors each shot's crop, or follows the subject as it moves. It refuses a layout that would break a word mid-line or put two blocks of type on top of each other, and it warns when type covers a face.
- Loudness is measured in two passes. When a linear gain would push the peaks past the ceiling, the render says so before encoding, and quotes what that much headroom deficit cost on measured mixes.

## How the demo works

adfactory's own planning code, compiled from Go to WebAssembly. The source is a synthetic 15 second scene drawn as shapes: a presenter walks across one shot, then a hard cut to a product. The page hands the engine that scene's detector boxes and the narration's word timings. The engine segments the shots, proposes crop anchors, then plans every platform you switch on: crop windows, hook and caption layout (with its refusals), occlusion and face-cover warnings, upscale and the loudness plan for the mix you pick. The five mixes are measured ones from the project's own fixture matrix. Each deliverable shows the engine's verdict and its reason. Drag the presenter, move the copy or change the cut, and every plan is made again. ffmpeg can't run in a browser, so nothing is encoded here and QC, which measures the delivered files, doesn't run. The verdicts are the checks a render makes before it calls ffmpeg.
