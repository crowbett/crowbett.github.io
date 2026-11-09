# Design

How the site looks and behaves. Design-track tasks in `docs/tasks.md` cite sections here; a change that contradicts this file updates it in the same commit, and site.css tokens change together with it.

## Feel

- **An instrument panel**: cold paper, black rules, one signal blue, dark screens only where real output runs. Labelled, ruled, exact.
- Made by someone who measures before claiming: data set like data, nothing decorative that is not also information, fast on a cheap phone.
- **Depth comes from layers that mean something**: a band, a sheet sliding over it, the screens that run real code, glass only where a bar floats over content.
- Never the default AI-built look (`~/research/reports/Striking engineer portfolio design.md`).
- References (principles, not pixels): teenage.engineering, oxide.computer, tigerbeetle.com, ciechanow.ski, samwho.dev, jepsen.io, danluu.com.

## Type

Three self-hosted OFL faces, 24,532 bytes of woff2 in total (measured 2026-11-09), built by `make fonts` (`scripts/fonts.sh`) from google/fonts at a pinned commit, sha256-checked:

- `--display`: Archivo Expanded (`wdth 125, wght 800`, 7,752 B). Headings, the name, row names. Tracking −0.03em, −0.05em at h1.
- `--sans`: Archivo (`wdth 100, wght 400`, 7,704 B). The one voice: prose, nav, keys, labels, metrics, sources, the work index, links, and big numerals (stage dials, the 404 code) with `tabular-nums`. No bold cut; emphasis is colour or the display face.
- `--mono`: Martian Mono (`wdth 100`, `wght 400-700`, 9,076 B), so 600 in demos and mask labels is real bold. Only code, file paths and live instrument readouts (demo cells and controls, timelines, the terminal); lowercase, no tracking, no uppercase.
- Subset, features and axes are in `scripts/fonts.sh` (no hinting, name records kept); licences in `web/assets/fonts/OFL-*.txt`.
- All preloaded with `font-display: optional`, so nothing swaps in late.
- `tabular-nums` wherever numbers sit in columns or update live. Prose stops at `--measure: 42rem`.

Fluid `clamp()` scale from a 360 to a 1280 px viewport (Utopia), so no breakpoint jumps a size:

| Token | Size (360 → 1280 px) | Use |
|---|---|---|
| `--t-label` | 0.6875rem mono, fixed | demo chrome (a demo token) |
| `--t-meta` | 0.8125rem sans, fixed | labels, nav, keys, footer, sources |
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
| `--accent` | `#2b3bd6` (7.1 / 7.7 / 6.3) | `#919ffc` (7.9 / 7.4 / 6.6) | blue ink: links |
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
| `--screen` | `#0b0d10` | `#060709` | stage, panel and project screens |
| `--screen-ink` | `#dde3e8` (15.1) | `#dde3e8` (15.6) | screen text |
| `--screen-dim` | `#8b96a2` (6.5) | `#8b96a2` (6.7) | screen axis labels |
| `--screen-ok` | `#60e09b` (11.7) | `#60e09b` (12.1) | allowed bars |
| `--screen-signal` | `#fb6b44` (6.8 / 6.0) | `#fb6b44` (7.0 / 6.0) | limit line, attack label (on screen / attack) |
| `--deny` | `#66717d` (3.9 / 3.5) | `#66717d` (4.1 / 3.5) | denied bars (on screen / attack) |
| `--attack` | `#2a1410` | `#2a1410` | attack band on the screen |
| `--band` | `--surface` | `--screen` | home stage, reel panels, numbers head, 404 |
| `--band-ink` / `--band-dim` / `--band-signal` | `--text` / `--text-2` / `--signal` | `--screen-ink` / `--screen-dim` / `--screen-signal` | text on the band |

- Signal blue is the one interface colour (ink `--accent`, fill `--block`). Vermilion marks the mechanism, green means live, crimson means error; nothing else.
- `--line` is decorative; a control boundary needs ≥ 3:1 against its ground (WCAG 1.4.11).
- Theme follows `prefers-color-scheme`, or the header switch (V26).
- The band follows the theme; the screens on it (the stage picture, reel clips, code, the terminal) stay dark in both, framed by `--lift`. The project head stays a dark screen.

## Space, layout, radius

- Spacing `--sp-1`…`--sp-9` (px at 360 → 1280): 4 → 4.5, 8 → 9, 12 → 13.5, 16 → 18, 24 → 27, 32 → 36, 48 → 54, 64 → 72, 96 → 108. Nothing off-scale.
- Gutter 16 → 32 px; the frame edge `--edge` is the larger of the gutter and the safe-area insets (`viewport-fit=cover`). Content max 80rem; sections 64 → 96 px apart.
- **The panel**: each module is a CSS grid on a `--line-strong` ground with a 1 px gap, so the gaps are the hairlines and no cell draws a border. Every module is a panel.
- Radius 0 (`--r-1: 0`, which demos read) for panels and keys; screens take `--r-2: 14px` and the work sheet a 28 → 36 px top. Shadows: `--lift` under screens and the sheet only.
- Keys: flat squares, 1 px `--rule` border, hover fills `--block`, a press sinks 2 px in 40 ms and springs back on `--spring-snappy`.
- `.cells`: mono cells on the hairline ground, for demo output that is a set of values.
- Coarse pointers: keys, buttons and demo fields at least 44 px tall; demo inputs, selects and textareas at ≥ 16px.

## Motion

- Durations: 120 ms colour, 200 ms state changes, 300 ms (`--d-spring`) springs; media crossfades (poster to clip, poster to live render) `--d-media` 450–600 ms. Nothing else above 300 ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` in, `cubic-bezier(0.4, 0, 1, 1)` out; `linear()` springs (mass 1): `--spring-snappy` (stiffness 900, damping 36: ~302 ms, 9.5% overshoot) for keys, `--spring-soft` (300, 30: ~282 ms, no overshoot) for the demo mount and status.
- Animate `opacity` and `transform` only; never `mask-position` or layout.
- Never scale to exactly 0 (start from `scale(0.001)`); `site.Check` rejects a zero scale in built CSS, HTML or JS (F6).
- `prefers-reduced-motion: reduce` turns every transition and animation off; demos do not auto-play.
- No scroll-triggered reveals of content that should already be readable; no page-load stagger. Scroll-driven effects, where `animation-timeline` is supported and motion is allowed: the stage and project head sink (scale 0.93, opacity 0.25) as the sheet covers them; on home each project panel sinks the same way as the next slides over it, while the arriving panel's screen rises into place (from scale 0.86, 12vh down) and its text lifts in behind it, both finished by the time the panel covers the screen; The pager cards' hover light follows the pointer.
- **Numbers move only when they count real data**: the stage dials count passes the tracer finished in this tab; the demo percentage follows bytes received. No scrambles or decorative counters.
- **Diagram motion**: each mask holds a rest and a mid-motion pose; motion is a `step-end` `opacity` flip between them, once when 60% on screen (web/assets/motion.js; A-B-A-B-A over 1.6 s) and looping while a row is hovered or focused. It ends on the rest pose.
- **Page to page**: cross-document view transitions; the header holds still and the page slides. Opening or leaving a project names only its title and diagram (web/assets/vt.js, a classic head script because `pagereveal` fires before modules run), so they fly between the home row and the project page, and between projects, in `--d-spring`.
- Checks: e2e requires CLS 0 at load on every page and counts `document.getAnimations()` with and without reduced motion on home, a project page and the smoke demo.

## Home

For: who this is, what they build, and that the proof runs (`templates/home.html`).

- **Layers**, back to front: the page (`--bg`), the stage pinned under the header, the work sheet (rounded top, `--band-edge` shadow) that slides up over it, then the project panels, each sliding up over the last, the index of all projects (a sheet) sliding over the last panel, and bars that float over content: the header (`--glass`) and on home the dock while a panel is current.
- **Stage**: a plain `--band` in the page's theme. Left (or above, under 64rem) the `h1`: the name in the display face at up to 4.5rem, so it never outshouts the render, then the role line in `--band-dim`, the hook (the tracer and its size, then the live count), a "See the work" key and a link to the full demo.
- The picture is the raytracer demo itself (`site.HomeStage`: Cornell box, 480 px, seed 1). `web/assets/stage.js` loads the 110 KB build in a worker and renders it in row bands, material-only sampling on the left canvas and NEE + MIS on the right, split by a draggable divider (pointer or arrow keys). The slug and state sit above the picture and the two sampling labels below it, in plain text on the band, not over the render. Under them three dials in the sans with `tabular-nums`, measured in this tab: samples per pixel, samples/s over the last 2 s, and the noise ratio left ÷ right from the binary's own RMSE estimates. It stops at 512 spp.
- It starts by itself after `load` while the stage is on screen and not covered by the sheet, and pauses when either changes or the tab hides. With reduced motion, Save-Data, a 2g/3g connection or fewer than 4 cores it does not start; "Render it here" does. Until then it shows `web/reel/stage.webp`, the same render recorded at 64 spp by `go run ./cmd/stage`, labelled "recorded".
- **Scenes**: a pill under the picture switches between the square, light-sampled scenes (`site.StageScenes`: Cornell box, glass sphere, smoke, under the raytracer demo's own labels). Picking one is consent to render: the tracer loads it, the dials reset to measured values from pass one, and the new picture wipes in band by band over the last. Only the Cornell box has a poster.
- **Work**: the sheet holds "Work", "N projects, M with a live demo" and an underlined link per group (`site.Groups`, its count beside it as plain text) that jumps to the group's first panel (`#g-<key>`, also the project crumb's target). Then one full-screen dark panel per project (`.reel`, `web/assets/work.js`), grouped and ordered as before (live first within each group, numbered `01`… at build time).
- **Panel**: the stage's band at full height under the header, rounded on top with a shadow cast up over the panel it covers. Left from 64rem (5fr / 7fr), above on narrower screens: the group name (an `h3` on a group's first panel), number and name in the display face (the page link), one size for every name: up to 6.5rem, capped so the widest (edgecache) fits its column on one line, the tagline in `--band-dim`, the metric behind a `--band-signal` rule, then a filled "Run it live" key (to the project's `#demo`, which starts on its own there) or a plain "Source on request" / "Source on GitHub" label, and the language. Right, or below: a 16:10 screen with the project's poster (lazy) or quorum's diagram, its bottom fading into the screen so a clip's cut-off row reads as deliberate, an "NN / 15" chip in the bottom-left corner (over the fade, not the content).
- **Stack**: each panel pins under the header and the next slides up over it. The covered panel sinks (the scroll-driven `sink`, on a view timeline of the panel above it that `work.js` names) and panels buried two or more deep get `opacity: 0` (`data-gone`): never seen, not drawn, links still focusable. A panel taller than the screen pins once its bottom edge is in view.
- **Current**: the panel covering the middle of the screen, by the panels' flow positions. Only it plays its clip (`web/reel/<slug>.mp4`, recorded by `cmd/reel` from `internal/site/showcase.go`); reduced motion or Save-Data shows posters only. Focus landing in a panel (Tab, j/k, a link) brings that panel up first, so nothing focused sits under another panel. Without JS the panels stack in plain flow and the stage does not pin.
- The panel's screen opens its project (pointer only: `tabindex=-1`, `aria-hidden`; the name is the keyboard path), and the current panel's screen flies into the project head (`screen` view transition). On hover an "Open →" chip rises in at the bottom right and the picture leans in 3%.
- Project pages link their group in the crumb and end with previous / next in the same order.
- **Diagrams** (`templates/diagrams.html`, `cmd/dither`): one line drawing per slug, one accent element naming the idea, showing a behaviour its project page states. `go run ./cmd/dither` renders each at 112×54 (index, home share card) and 224×108 with labels (facts, project share cards), both poses, dithered to one bit (Bayer 8×8): `web/assets/dg/<slug>-<size>.png`, 30 files, 27,025 B (measured 2026-11-09). The labelled size is stored at 2x: the drawing is dithered at one pixel per CSS pixel and doubled, and its 7 px labels are drawn at 2x and thresholded, because at 1x Martian Mono turned "redis" into "eedis". CSS masks (`.dm`) take `currentColor` for ink and `--signal` for accent, so one PNG serves both themes and hover. The build fails on a mask older than its drawing (`web/assets/dg/.sums`) or a missing `.dm-<slug>` rule or `url()`.

## Navigation

- **Search key** in the top bar opens the command palette (web/assets/palette.js, loaded on first use; `/search.json` from the build). ⌘K, Ctrl+K or `/` anywhere. Without JS it is a link to the home index. The key label has a fixed box, so filling it in moves nothing.
- **Palette**: a modal `<dialog>` with a combobox over a listbox. "This page" actions first (run the demo, full screen, previous / next, work index), then projects with their diagram, language, group and a live or source label, then Contact (copy or write an email), so ⌘K then Enter never copies the email. A `--block` "Go to" plate heads it like a demo frame; the backdrop is flat `--bg` at 88%, no blur or shadow. Title hits rank first; a subsequence matches too ("rlim" finds ratelimitd).
- **Keys**: `j` / `k` walk the work index (focus the name, centre the item), `[` / `]` step projects. None fire while typing or inside a demo.
- **Prefetch**: an internal link the pointer, a touch or focus rests on is prefetched once.

## Project page

For: a visitor checks the claim, then runs it. Order: header, demo frame (live only), write-up with facts (`templates/project.html`).

- **Head**: the dark stage band of home, sinking as the sheet slides up over it (a view timeline on the sheet). A head without a demo pins under the header while the sheet slides over it (`web/assets/project.js` pins a head taller than the screen once its bottom is in view). A head with a demo does not pin, because anything scrolled to inside a pinned head (a key, a focused control, `#demo`) can land under the sheet. Crumb (`Work / group / slug`) and the title at `--t-h1` with the accent halo span the width; below, the lede in `--screen-dim`, the evidence (a `--block` "Evidence" plate, the metric in mono, its source) on a glass card, then a filled "Run it live" key (jumps to the frame and starts the demo) and "Source on request" / "Source on GitHub". Beside it from 64rem (5fr / 6fr), below on narrower screens: the demo frame, which starts on its own like the home stage (below), with a glow sampled from the recording and then from the running demo's largest canvas. For a project without a demo, its diagram on a 16:10 screen with a "slug · diagram" chip. "Evidence", not "Measured": keel's metric is a gate.
- The title, diagram and screen fly between pages with view transitions; from home the current panel's screen becomes the project's screen.
- **Sheet**: write-up and facts, and previous / next, on the paper sheet with rounded panels.
- **Demo frame**: in the head, lifted with `--lift` off the dark band.
- **Write-up and facts** (one panel): stacked on phones, 7fr/5fr from 48rem.
- **Previous / next**: two cards, each with its project's poster (or diagram) as a thumbnail; the thumbnail sits beside the name from 40rem.
  - Body: bullets with 6 px `--signal` square markers, then `## How the demo works` (or `## Planned demo`), whose heading renders as a mono `--t-label` label in `--text-3`.
  - Facts: the 224×108 diagram mask, `language`, `topics` and `source` (the repo, or "Private, on request: email me" as a mailto naming the project).

## Demo frame

One frame for every demo, built by the site (`templates/project.html`, `web/assets/demo.js`); `ui.js` only fills the mount.

- **Plate**: `--block` hairline cells: lamp and "Live demo" left, `WebAssembly, ~N KB` (gzip bytes from the lock) right-aligned; once running, "ready in N ms" (click to mounted, measured in the visitor's browser) is prepended so nothing shown moves (below 40rem "WebAssembly," drops to make room), then "Full screen" from 40rem where the browser can put an element full screen (its slot is reserved, so it appears without a shift; phones reach it from the palette): the frame fills the display, centred up to 90rem, and demos that track their width use it. The name is already the h1.
- **Instruction**: the project's `demo_try` line, before the button.
- **Before start**: the recorded clip at 16:10 (poster first; the clip plays only while in view and not covered, posters only under reduced motion or Save-Data), then the filled start key and "Above: a recording. Runs live in your browser; nothing downloads until you start." In a project head, where the stage's rules allow it (not reduced motion, Save-Data, 2g/3g or fewer than 4 cores), the note reads "Above: a recording. The live build starts on its own while this is on screen." (both notes share one cell, so the switch moves nothing) and the frame starts once the page has loaded and a quarter of it is on screen; focus stays where it is. On ready the recording is removed.
- **Loading**: Pages gzips .wasm, so progress compares decompressed bytes with the lock's raw size (`data-bytes`): bar and percentage, then "Starting…"; the button reads "Loading…". Without `data-bytes` (smoke) the bar is indeterminate. Screen readers get one status.
- **Running**: the mount at full width; after a click, focus moves to the mount itself, so Tab reaches the first control. Mount buttons wrap on phones.
- **Error**: a `--danger-tint` panel above the button, "The demo failed to start." in `--danger` then the message verbatim; the button becomes "Try again", takes focus and starts a fresh worker.
- **No demo yet**: no frame.

## What we will not do

- No photo, illustration, mascot, emoji section markers or stock icons.
- No cream paper, warm-clay accents, uppercase tracked eyebrows, identical card grids or "→" appended to links.
- No decorative gradients, glow, scanlines, graticule or dot-grid backgrounds, cursor spotlights, sheens or noise textures; glass only on bars over content.
- No pills or chips for navigation, no LED dots for decoration, no lift on hover, no vanity tallies.
- No scroll-jacking, custom cursors, typing or scramble effects, or carousels: the reel scrolls natively; panels pin and slide, and nothing moves on its own.
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
- 2026-11-09 Project heads: project pages take the home stage's layers: a pinned dark head with the demo's clip on a glowing screen, the evidence on glass, "Run it live" starting the demo, a sheet over it, rounded panels, poster cards for previous / next, and the screen flying from the home monitor. Owner: "i want even more layers".
- 2026-11-09 V18: CSS split per page (site, home, project); the stage switches scenes; the monitor opens its project; the 404 moves onto the dark band with a `--screen-signal` code.
- 2026-11-09 V19: live project heads: the demo frame moves into the dark head and starts on its own under the home stage's rules, the recording holding its screen until then; heads with a demo stop pinning; the head sinks with the sheet's entry.
- 2026-11-09 V21: clip polish: every reel clip re-recorded at 3x and 30 fps with the site header hidden, framed to the whole demo panel, opening on a settled frame; the raytracer's "One more sample" key and btrv's bar keep their space. On home, the last panel no longer sinks with nothing over it, names share one size that fits, and the chips sit over the fade. Owner: "all of the little animations look like shit".
- 2026-11-09 V22: two crops per clip. The phone-page recording was scaled up about 1.6x in a 705 px desktop panel and read as blurry and oversized beside the live demo, so each demo is also recorded from a 752 px page at 2x and framed on its visualization; screens about 560 px or wider get it at about 1:1. Owner: "the preview clips still look SO BAD … when you click them though, it's looking good".
- 2026-11-09 V24: pointer feel. A mouse lights the dark screens' graticule around it. Previews tilt toward it under a glare, primary keys lean to it, and index cards play their clip on hover. Posters shimmer until they load, and the dock label rolls with the direction of travel. Touch and reduced motion keep the still page.
- 2026-11-09 V25: the terminal. A dark dialog drops in under the header (full width on a phone) on the same screen palette as the demos. JSON comes back coloured and folded, and each call ends on a measured receipt. `trace` paints the raytracer's output pixelated in place.
- 2026-11-09 V26: a theme switch in the header. Sun and moon morph into each other, and the new theme opens as a circle from the key.
- 2026-11-09 V28: depth layers. A hovered screen's glow, picture and chip move by depth against its tilt, and the index's other cards step back.
- 2026-11-09 V29: scroll depth. Touch screens get layers too: a panel's glow and name arrive at their own speeds as it slides in and settle flat when it pins.
- 2026-11-09 V23: the reel gets a dock and an end. A glass dock floats over the panels: a tick per project grouped by area (hover shows its poster, name and line; click jumps there without starting the clips in between), the current one named, up and down steps, its demo, and "All". The reel ends in an index sheet of every project, filtered by area and language, each card with its demo key; a card opened from it flies into the project page. The "07 / 15" chip on each screen went, since the dock numbers the current one. The dock is a pointer mirror (aria-hidden, no tab stops): keys keep Tab and j/k, and the index is in the tab order. Owner: "I think #2 is what we need, where you can click and do other stuff too".
- 2026-11-09 V20: home work becomes a stack of full-screen project panels like the stage, each sliding up over the last as it sinks, one clip playing; the index and monitor go. The owner asked for every project to open like the raytracer stage, with smooth transitions between them.
- 2026-11-09 V30: the code panel. Real source excerpts in the screen palette under each project's head, lit as the demo runs them: a beam sweeps the excerpt that ran, a hidden tab pings, and the trace reads `method → excerpt`. The flash underlines rather than tints, so text contrast holds mid-flash. Owner: "More layers and more features please".
- 2026-11-09 V31: instruments. A call timeline under each demo and an X-ray overlay with live, measured numbers. Outlines and tags sit on a fixed layer, so the page never reflows. The X-ray toggle lives on the timeline, not the demo head, whose "ready in" stamp must not move. Owner picked both from the feature list.
- 2026-11-09 V32: the numbers page. One sheet of every measured result and every binary size, each with its source. Bar colour names the toolchain and the label beside it says it too, since the three hues sit in the CVD warn band. Owner picked it from the feature list.
- 2026-11-09 V33: search everything. The palette reaches into write-ups and code and lands on the exact passage or line, marked. The index loads only once a query is three letters long, so opening the palette costs nothing extra. Deep links use their own hashes, not text fragments, so they work on every browser and on the page you are already on. Owner picked it from the feature list.
- 2026-11-09 V34: terminal upgrades. Pipes, `code` and `grep`, so the shell reads the site the way a developer reads a repo: `grep lease` finds the line in jobrun's SQL. Only filters read a pipe, and an error is never filtered away. Owner picked it from the feature list.
- 2026-11-09 V35: code peek. A home panel flips to its real source in place, so a visitor sees the code before choosing a project. The excerpt JSON is fetched on first press, so the code stays off the home page until asked for. Owner picked it from the feature list.
- 2026-11-09 V36: autopilot tours and shareable runs. A tour drives the real controls and quotes the binary's own output, so a visitor who never touches a control still sees what the code does. A link stores control values plus the binary sha, so it never replays settings against a different build. Owner picked both from the feature list.
- 2026-11-09 V37: project page layout. The demo is the page, so it gets the full width under a compact head instead of sharing a row with a few lines of text; the code section is gone at the owner's call, and the GitHub link on the home peek is the way to the source for public repositories.
- 2026-11-09 V38: de-slop. Glow, scanlines, graticule, dot paper, spotlight, sheen, rim light, progress bar, magnetic keys, Doto, decorative LED dots, nav pills and the numbers tally go; one sans voice with mono only for code, paths and live readouts; home bands follow the theme on `--band` tokens around dark screens. The owner keeps the reel, dock, tilt and panel motion. Owner: "de-slop" after a review found the site reading as AI-built.
- 2026-11-09 V39: demo copy. Each demo's try line and receipt is written for that demo, in its own shape, because nineteen lines on one template read as generated. Receipts keep their honesty (real work, measured time, numbers only from the binary or the clock) without the stock "in your browser" tail, and counts agree with their nouns.
