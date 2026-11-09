# Design

How the site looks and behaves. Design-track tasks in `docs/tasks.md` cite sections here; a change that contradicts this file updates it in the same commit, and site.css tokens change together with it.

## Feel

- **An instrument panel**: cold paper, black rules, one signal blue, a dark screen that shows real output, lamps that light only when something is live. Labelled, ruled, exact.
- Made by someone who measures before claiming: data set like data, nothing decorative that is not also information, fast on a cheap phone.
- **Depth comes from layers that mean something**: paper, a sheet sliding over a live screen, glass only where a bar floats over content, glow only sampled from real pixels on a screen.
- Never the default AI-built look (`~/research/reports/Striking engineer portfolio design.md`).
- References (principles, not pixels): teenage.engineering, oxide.computer, tigerbeetle.com, ciechanow.ski, samwho.dev, jepsen.io, danluu.com.

## Type

Four self-hosted OFL faces, 26,908 bytes of woff2 in total (measured 2026-10-26), built by `make fonts` (`scripts/fonts.sh`) from google/fonts at a pinned commit, sha256-checked:

- `--display`: Archivo Expanded (`wdth 125, wght 800`, 7,752 B). Headings, the name, row names. Tracking −0.03em, −0.05em at h1.
- `--sans`: Archivo (`wdth 100, wght 400`, 7,704 B). Prose. No bold cut; emphasis is colour or the display face.
- `--mono`: Martian Mono (`wdth 100`, `wght 400-700`, 9,076 B), so 600 in demos and mask labels is real bold. Labels, metrics, tags, keys, demo chrome; lowercase, no tracking, no uppercase.
- `--dots`: Doto (`ROND 0, wght 700`, 2,376 B). Instrument numerals only: stage dials, the 404 code.
- Subset, features and axes are in `scripts/fonts.sh` (no hinting, name records kept); licences in `web/assets/fonts/OFL-*.txt`.
- All preloaded with `font-display: optional`, so nothing swaps in late.
- `tabular-nums` wherever numbers sit in columns or update live. Prose stops at `--measure: 42rem`.

Fluid `clamp()` scale from a 360 to a 1280 px viewport (Utopia), so no breakpoint jumps a size:

| Token | Size (360 → 1280 px) | Use |
|---|---|---|
| `--t-label` | 0.6875rem mono, fixed | labels, keys, demo chrome, footer |
| `--t-small` | 0.875rem → 0.9rem | captions, sources, facts |
| `--t-body` | 1.0625rem → 1.125rem, line height 1.6 | prose |
| `--t-lede` | 1.1875rem → 1.5rem | ledes |
| `--t-h2` | 1.75rem → 3.25rem | section heads ("Work") |
| `--t-h1` | 2.75rem → 7.5rem, line height 0.88 | project titles |

## Colour

Named by role; light and dark both first-class; screen tokens are the same in both. site.css writes `oklch()`; the hex is the sRGB each renders as. Contrast measured 2026-10-26 (WCAG 2 relative luminance); brackets are against `bg` / `surface` / `sunken`, or the named ground. `TestTokenContrast` (e2e/quality_test.go) re-measures the pairs from site.css on every run.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#f2f5f7` | `#0a0d13` | page |
| `--surface` | `#fcfdfe` | `#12161d` | modules |
| `--sunken` | `#e4e7ec` | `#1c202a` | code, output wells, index head |
| `--line` | `#d3d7de` | `#262b34` | decorative hairlines |
| `--line-strong` | `#a9afb8` | `#3a404c` | panel hairlines and borders |
| `--rule` | `#101317` | `#4b5361` | key borders, load bar, share-card frames |
| `--control-line` | `#7a818a` (3.6 / 3.9) | `#747c8a` (4.6 / 4.3) | input borders (3:1 minimum) |
| `--text` | `#101317` (17.0 / 18.2 / 15.1) | `#e7eaee` (16.1 / 15.0 / 13.5) | body, headings |
| `--text-2` | `#474c55` (7.9 / 8.5 / 7.0) | `#a9afba` (8.8 / 8.2 / 7.4) | ledes, taglines, diagram ink |
| `--text-3` | `#5a606a` (5.8 / 6.2 / 5.1) | `#8f96a3` (6.5 / 6.1 / 5.5) | labels, sources |
| `--accent` | `#2b3bd6` (7.1 / 7.7 / 6.3) | `#919ffc` (7.9 / 7.4 / 6.6) | blue ink: links, 404 code |
| `--accent-hover` | `#1f2aa8` (9.8 / 10.5) | `#b3bcfb` (10.6 / 9.9) | link hover |
| `--accent-tint` | `#dfe4fc` | `#1e2350` | wash behind accent in demo UIs (accent on it 6.2 / 6.1) |
| `--block` | `#2b3bd6` (7.1 on bg) | `#354edb` (3.0 on bg) | blue fill: plates, filled keys, hovered row |
| `--block-hover` | `#1f2aa8` | `#4765e8` | filled key hover |
| `--on-block` | `#ffffff` (7.8 / 10.7 hover) | `#ffffff` (6.4 / 4.9 hover) | text and drawings on blocks |
| `--signal` | `#bd330b` (5.2 / 5.6) | `#fe7249` (7.2 / 6.7) | vermilion: the mechanism, mask accents |
| `--live` | `#106b41` (6.0 / 6.4 / 5.3) | `#50cf8a` (9.8 / 9.2 / 8.2) | lamps for live things only |
| `--live-tint` | `#dbeee3` | `#10271b` | lamp halo |
| `--danger` | `#b41b39` (6.0 / 6.5 / 5.5 on tint) | `#f87584` (7.3 / 6.8 / 6.0 on tint) | errors only (crimson, never the signal) |
| `--danger-tint` | `#fce5e6` | `#39161a` | error panel ground |
| `--screen` | `#0b0d10` | `#060709` | stage and monitor screens |
| `--screen-ink` | `#dde3e8` (15.1) | `#dde3e8` (15.6) | screen text |
| `--screen-dim` | `#8b96a2` (6.5) | `#8b96a2` (6.7) | screen axis labels |
| `--screen-ok` | `#60e09b` (11.7) | `#60e09b` (12.1) | allowed bars |
| `--screen-signal` | `#fb6b44` (6.8 / 6.0) | `#fb6b44` (7.0 / 6.0) | limit line, attack label (on screen / attack) |
| `--deny` | `#66717d` (3.9 / 3.5) | `#66717d` (4.1 / 3.5) | denied bars (on screen / attack) |
| `--attack` | `#2a1410` | `#2a1410` | attack band on the screen |
| `--grat` | `#1a1f26` | `#14181e` | screen graticule |

- Signal blue is the one interface colour (ink `--accent`, fill `--block`). Vermilion marks the mechanism, green means live, crimson means error; nothing else.
- `--line` is decorative; a control boundary needs ≥ 3:1 against its ground (WCAG 1.4.11).
- Theme follows `prefers-color-scheme`; no toggle.

## Space, layout, radius

- Spacing `--sp-1`…`--sp-9` (px at 360 → 1280): 4 → 4.5, 8 → 9, 12 → 13.5, 16 → 18, 24 → 27, 32 → 36, 48 → 54, 64 → 72, 96 → 108. Nothing off-scale.
- Gutter 16 → 32 px; the frame edge `--edge` is the larger of the gutter and the safe-area insets (`viewport-fit=cover`). Content max 80rem; sections 64 → 96 px apart.
- **The panel**: each module is a CSS grid on a `--line-strong` ground with a 1 px gap, so the gaps are the hairlines and no cell draws a border. Every module is a panel.
- Radius 0 (`--r-1: 0`, which demos read) for panels and keys; screens take `--r-2: 14px` and the work sheet a 28 → 36 px top. Shadows: `--lift` under screens and the sheet only.
- Keys: flat squares, 1 px `--rule` border, hover fills `--block`, a press sinks 2 px in 40 ms and springs back on `--spring-snappy`.
- `.cells`: mono cells on the hairline ground, for demo output that is a set of values.
- Coarse pointers: keys, buttons and demo fields at least 44 px tall; demo inputs, selects and textareas at ≥ 16px.

## Motion

- Durations: 120 ms colour, 200 ms state changes, 300 ms (`--d-spring`) springs; media crossfades (monitor layers, poster to live render) `--d-media` 450–600 ms. Nothing else above 300 ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` in, `cubic-bezier(0.4, 0, 1, 1)` out; `linear()` springs (mass 1): `--spring-snappy` (stiffness 900, damping 36: ~302 ms, 9.5% overshoot) for keys, `--spring-soft` (300, 30: ~282 ms, no overshoot) for the demo mount and status.
- Animate `opacity` and `transform` only; never `mask-position` or layout.
- Never scale to exactly 0 (start from `scale(0.001)`); `site.Check` rejects a zero scale in built CSS, HTML or JS (F6).
- `prefers-reduced-motion: reduce` turns every transition and animation off; demos do not auto-play.
- No scroll-triggered reveals of content that should already be readable; no page-load stagger. One scroll-driven effect: the stage sinks (scale 0.93, opacity 0.25) as the sheet covers it, where `animation-timeline` is supported and motion is allowed.
- **Numbers move only when they count real data**: the stage dials count passes the tracer finished in this tab; the demo percentage follows bytes received. No scrambles or decorative counters.
- **Diagram motion**: each mask holds a rest and a mid-motion pose; motion is a `step-end` `opacity` flip between them, once when 60% on screen (web/assets/motion.js; A-B-A-B-A over 1.6 s) and looping while a row is hovered or focused. It ends on the rest pose.
- **Page to page**: cross-document view transitions; the header holds still and the page slides. Opening or leaving a project names only its title and diagram (web/assets/vt.js, a classic head script because `pagereveal` fires before modules run), so they fly between the home row and the project page, and between projects, in `--d-spring`.
- Checks: e2e requires CLS 0 at load on every page and counts `document.getAnimations()` with and without reduced motion on home, a project page and the smoke demo.

## Home

For: who this is, what they build, and that the proof runs (`templates/home.html`).

- **Layers**, back to front: the paper (`--paper`, a dot grid over `--bg`), the stage pinned under the header, the work sheet (rounded top, `--lift` shadow) that slides up over it, the screens on the sheet, and glass bars (`--glass`, backdrop blur) that float over content: the header and, below 48rem, the monitor bar.
- **Stage**: a dark graticule screen in both schemes. Left (or above, under 64rem) the `h1`: the name in the display face at up to 8rem with an accent halo, then the role line in `--screen-dim`, the hook (live count, "the real code, compiled to WebAssembly", the tracer and its size), a "See the work" key and a link to the full demo.
- The picture is the raytracer demo itself (`site.HomeStage`: Cornell box, 480 px, seed 1). `web/assets/stage.js` loads the 110 KB build in a worker and renders it in row bands, material-only sampling on the left canvas and NEE + MIS on the right, split by a draggable divider (pointer or arrow keys). A scan line marks the band; a 12×12 canvas copies the picture, blurred and saturated behind the screen as its glow. Under it three Doto dials measured in this tab: samples per pixel, samples/s over the last 2 s, and the noise ratio left ÷ right from the binary's own RMSE estimates. It stops at 512 spp.
- It starts by itself after `load` while the stage is on screen and not covered by the sheet, and pauses when either changes or the tab hides. With reduced motion, Save-Data, a 2g/3g connection or fewer than 4 cores it does not start; "Render it here" does. Until then it shows `web/reel/stage.webp`, the same render recorded at 64 spp by `go run ./cmd/stage`, labelled "recorded".
- **Work index**: the sheet holds "Work" and "N projects, M with a live demo", then the projects grouped by `group` front matter (`site.Groups`), live first within each, numbered `01`… at build time. Each item: number and name in the display face (the page link), tagline, language, metric, and a lit "Run it live" lamp or an unlit "Source on request" / "Source on GitHub". The current item is in `--text` with a `--block` bar that springs in; the rest sit in `--text-3`, and on a fine pointer hovering one dims the others.
- **Monitor**: a 16:10 screen beside the index (5fr / 7fr from 64rem, halves from 48rem, sticky) or pinned under the header as a glass bar below 48rem. It shows the current project: the muted looping clip of its real demo (`web/reel/<slug>.mp4`, `.webp` poster, recorded by `cmd/reel` from `internal/site/showcase.go`), or quorum's diagram, with a HUD chip "name NN / 15" and a glow sampled from the playing frame. The current item is the last one whose top passed the reading line, 40% down the screen (or of the part below the monitor bar), or the one under the mouse or focus. Layers crossfade in `--d-media`; clips load only near the sheet; reduced motion or Save-Data shows posters only. Without JS the monitor is hidden and the stage does not pin.
- Project pages link their group in the crumb and end with previous / next in the same order.
- **Diagrams** (`templates/diagrams.html`, `cmd/dither`): one line drawing per slug, one accent element naming the idea, showing a behaviour its project page states. `go run ./cmd/dither` renders each at 112×54 (index, home share card) and 224×108 with labels (facts, project share cards), both poses, dithered to one bit (Bayer 8×8): `web/assets/dg/<slug>-<size>.png`, 30 files, 27,025 B (measured 2026-11-09). The labelled size is stored at 2x: the drawing is dithered at one pixel per CSS pixel and doubled, and its 7 px labels are drawn at 2x and thresholded, because at 1x Martian Mono turned "redis" into "eedis". CSS masks (`.dm`) take `currentColor` for ink and `--signal` for accent, so one PNG serves both themes and hover. The build fails on a mask older than its drawing (`web/assets/dg/.sums`) or a missing `.dm-<slug>` rule or `url()`.

## Navigation

- **Search key** in the top bar opens the command palette (web/assets/palette.js, loaded on first use; `/search.json` from the build). ⌘K, Ctrl+K or `/` anywhere. Without JS it is a link to the home index. The key label has a fixed box, so filling it in moves nothing.
- **Palette**: a modal `<dialog>` with a combobox over a listbox. "This page" actions first (run the demo, full screen, previous / next, work index), then projects with their diagram, language, group and a live lamp, then Contact (copy or write an email), so ⌘K then Enter never copies the email. A `--block` "Go to" plate heads it like a demo frame; the backdrop is flat `--bg` at 88%, no blur or shadow. Title hits rank first; a subsequence matches too ("rlim" finds ratelimitd).
- **Keys**: `j` / `k` walk the work index (focus the name, centre the item), `[` / `]` step projects. None fire while typing or inside a demo.
- **Prefetch**: an internal link the pointer, a touch or focus rests on is prefetched once.

## Project page

For: a visitor checks the claim, then runs it. Order: header, demo frame (live only), write-up with facts (`templates/project.html`).

- **Header** (panel): crumb (`Work / slug`), title at `--t-h1` in the display face, tagline as lede, then the evidence: a `--block` "Evidence" plate, the metric in mono, its source in mono `--t-label`. From 48rem, 7fr/5fr: lede left, evidence right; without a metric the lede spans. "Evidence", not "Measured": keel's metric is a gate.
- **Demo frame**: full page width between header and write-up.
- **Write-up and facts** (one panel): stacked on phones, 7fr/5fr from 48rem.
  - Body: bullets with 6 px `--signal` square markers, then `## How the demo works` (or `## Planned demo`), whose heading renders as a mono `--t-label` label in `--text-3`.
  - Facts: the 224×108 diagram mask, `language`, `topics` and `source` (the repo, or "Private, on request: email me" as a mailto naming the project).

## Demo frame

One frame for every demo, built by the site (`templates/project.html`, `web/assets/demo.js`); `ui.js` only fills the mount.

- **Plate**: `--block` hairline cells: lamp and "Live demo" left, `WebAssembly, ~N KB` (gzip bytes from the lock) right-aligned; once running, "ready in N ms" (click to mounted, measured in the visitor's browser) is prepended so nothing shown moves (below 40rem "WebAssembly," drops to make room), then "Full screen" from 40rem where the browser can put an element full screen (its slot is reserved, so it appears without a shift; phones reach it from the palette): the frame fills the display, centred up to 90rem, and demos that track their width use it. The name is already the h1.
- **Instruction**: the project's `demo_try` line, before the button.
- **Before start**: the filled start key and "Runs in your browser. Nothing downloads until you start."
- **Loading**: Pages gzips .wasm, so progress compares decompressed bytes with the lock's raw size (`data-bytes`): bar and percentage, then "Starting…"; the button reads "Loading…". Without `data-bytes` (smoke) the bar is indeterminate. Screen readers get one status.
- **Running**: the mount at full width; focus moves to the mount itself, so Tab reaches the first control. Mount buttons wrap on phones.
- **Error**: a `--danger-tint` panel above the button, "The demo failed to start." in `--danger` then the message verbatim; the button becomes "Try again", takes focus and starts a fresh worker.
- **No demo yet**: no frame.

## What we will not do

- No photo, illustration, mascot, emoji section markers or stock icons.
- No cream paper, warm-clay accents, uppercase tracked eyebrows, identical card grids or "→" appended to links.
- No decorative gradients, glow, blur or noise textures: glow is sampled from a live screen, glass only on bars over content.
- No scroll-jacking, parallax, custom cursors, typing or scramble effects, or carousels: the index scrolls natively and the monitor follows it.
- No skill bars, logo walls, social links or follower counts.
- No third-party anything (fonts, analytics, embeds).
- No layout that needs JavaScript: with scripts off every page reads correctly and only demo buttons are inert.
- No dark-only or light-only design.

## Decisions log

One line each; full reasoning and review rounds are in git (`git log -p docs/design.md`).

- 2026-10-24 V1: no theme toggle. A flash-free toggle needs a blocking script; the OS setting is the visitor's.
- 2026-10-24 V2: self-hosted data face; e2e shoots both schemes. Chrome lacks `ui-monospace`; light went unreviewed.
- 2026-10-24 V4: metric sources may wrap after a hyphen on phones. Only `nowrap` prevents it, and overflows.
- 2026-10-24 V5: CLS measured before a demo starts; no page-load reveal. Demo output is asked for; fades delay LCP.
- 2026-10-24 V6: throttle in the e2e server; axe, origin and CSP at 390 px only. Chrome's emulation skipped navigation; axe everywhere pushed CI to 59 s.
- 2026-10-24 V6: the frame makes overflowing scroll boxes focusable. Fix the page, not the check.
- 2026-10-24 V3b: the hero is a recorded real run on two labelled lanes, kept true by e2e. WASM per visit breaks the slow-link bar.
- 2026-10-24 V7: share cards are static PNGs hashed against `web/og/.sums`. Previews cannot run code; never a stale claim.
- 2026-10-25 V9: edgecache draws request collapsing, jobrun `SKIP LOCKED`. Generic drawings said nothing project-specific.
- 2026-10-25 V8: metrics lead with a number, `~` or capital; no frame without a live demo. Both read unfinished.
- 2026-10-25 V8: one filled key re-runs the hero on click and stamps the match. Proof without a download per visit.
- 2026-10-25 V8: focus moves to the demo mount, not its first control (1e6a669). A focused input can raise a phone keyboard.
- 2026-10-26 V11: instrument panel replaces the lab notebook; `demo_try` moves into the frame. Old look matched the AI-default list.
- 2026-10-26: page-wide wordmark dropped. Owner: "make my name a lot smaller".
- 2026-10-26 V11: no GSAP, anime.js, Lenis, NumberFlow, Paper Shaders or Geist Mono. Bytes, licence, scroll-jacking, CSP, a Vercel tell.
- 2026-10-26 V12: oklch tokens, ink/fill blue split, vermilion signal, crimson danger, Bayer masks, `linear()` springs. One job per colour; dither stays put.
- 2026-10-26 V12: readouts count with the wipe; card hashes cover site.css and fonts. Totals did accumulate; no stale cards.
- 2026-11-08 V13: bullet project pages with a demo note; evidence in the header; write-up and facts one 7fr/5fr panel from 48rem; 2-column index cards from 40rem to 64rem; no hero role line; 44px targets and 16px demo fields on coarse pointers; safe-area gutters; 820×1180 tablet e2e viewport. Owner found it wordy; tablets get a checked layout.
- 2026-11-08 V14: grouped index with search, command palette, title and diagram morph between pages, demo full screen, j/k and [ ] keys, prefetch on intent; e2e emulates touch below 1000 px. Owner: "very user friendly and very interactive. and organized".
- 2026-11-09 V15: fresh-eyes review fixes: work table at 1024–1279 px, legible 2x mask labels, palette as an instrument module (no shadow or blur, contact last), hero keypad, one horizontal inset (`--sp-4`) for header, facts, demo and write-up, one mono face for every demo control, `.cells` stat blocks with the label above the value, a receipt line ending every demo, measured "ready in" on the plate, 404 in a panel. Owner: "find the best looking features a web page can have".
- 2026-11-09 V3b: hero hook moved into the headline, keys dropped, run time as a third readout, burst label kept clear of the lane label at 320 px, palette close button. A fresh-eyes review rated home "maybe": hook buried, keys inflate the hero, run climax weak.
- 2026-11-09 Reel: the grouped table and its search became a scroll reel of project panels, each with a clip of its real demo running and a short description, a sticky rail (desktop) or current-project bar (phone and tablet). Clips are recorded from the pinned binaries and go stale with them like share cards. Owner: "i still feel kind of lost looking at all of it"; wanted "a scroll carousel where each scroll showed a projects animation preview and a small description".
- 2026-11-09 Stage: the home opens on the raytracer rendering live (material vs NEE + MIS, measured dials) on a pinned dark stage; the reel became a type-led index on a sheet that slides over it, with one sticky monitor playing the current clip; paper grid, glass bars, sampled glow, rounded screens and lift shadows. Reverses V3b's "WASM per visit": 110 KB, after load, only on capable devices with motion allowed. Owner: "this ui isn't all that", "we need to add like layers".
