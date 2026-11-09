# Design

How the site looks and behaves. Design-track tasks in `docs/tasks.md` cite sections here; a change that contradicts this file updates it in the same commit, and site.css tokens change together with it.

## Feel

- **An instrument panel**: cold paper, black rules, one signal blue, a dark screen that shows real output, lamps that light only when something is live. Labelled, ruled, exact.
- Made by someone who measures before claiming: data set like data, nothing decorative that is not also information, fast on a cheap phone.
- Never the default AI-built look (`~/research/reports/Striking engineer portfolio design.md`).
- References (principles, not pixels): teenage.engineering, oxide.computer, tigerbeetle.com, ciechanow.ski, samwho.dev, jepsen.io, danluu.com.

## Type

Four self-hosted OFL faces, 26,908 bytes of woff2 in total (measured 2026-10-26), built by `make fonts` (`scripts/fonts.sh`) from google/fonts at a pinned commit, sha256-checked:

- `--display`: Archivo Expanded (`wdth 125, wght 800`, 7,752 B). Headings, the name, row names. Tracking −0.03em, −0.05em at h1.
- `--sans`: Archivo (`wdth 100, wght 400`, 7,704 B). Prose. No bold cut; emphasis is colour or the display face.
- `--mono`: Martian Mono (`wdth 100`, `wght 400-700`, 9,076 B), so 600 in demos and mask labels is real bold. Labels, metrics, tags, keys, demo chrome; lowercase, no tracking, no uppercase.
- `--dots`: Doto (`ROND 0, wght 700`, 2,376 B). Instrument numerals only: replay readouts, the 404 code.
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
| `--screen` | `#0b0d10` | `#060709` | the replay screen |
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
- Radius 0 (`--r-1: 0`, which demos read); only lamps are round. No shadows.
- Keys: flat squares, 1 px `--rule` border, hover fills `--block`, a press sinks 2 px in 40 ms and springs back on `--spring-snappy`.
- `.cells`: mono cells on the hairline ground, for demo output that is a set of values.
- Coarse pointers: keys, buttons and demo fields at least 44 px tall; demo inputs, selects and textareas at ≥ 16px.

## Motion

- Durations: 120 ms colour, 200 ms state changes, 300 ms (`--d-spring`) springs; never above 300 ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` in, `cubic-bezier(0.4, 0, 1, 1)` out; `linear()` springs (mass 1): `--spring-snappy` (stiffness 900, damping 36: ~302 ms, 9.5% overshoot) for keys, `--spring-soft` (300, 30: ~282 ms, no overshoot) for the demo mount and status.
- Animate `opacity` and `transform` only; never `mask-position` or layout.
- Never scale to exactly 0 (start from `scale(0.001)`); `site.Check` rejects a zero scale in built CSS, HTML or JS (F6).
- `prefers-reduced-motion: reduce` turns every transition and animation off; demos do not auto-play.
- No scroll-triggered reveals of content that should already be readable; no page-load stagger.
- **Numbers move only when they count real data**: replay readouts count the run's totals with the wipe; the demo percentage follows bytes received. No scrambles or decorative counters; with reduced motion or no JS, figures never move (`TestHeroTicker`).
- **Diagram motion**: each mask holds a rest and a mid-motion pose; motion is a `step-end` `opacity` flip between them, once when 60% on screen (web/assets/motion.js; A-B-A-B-A over 1.6 s) and looping while a row is hovered or focused. It ends on the rest pose.
- Checks: e2e requires CLS 0 at load on every page and counts `document.getAnimations()` with and without reduced motion on home, a project page and the smoke demo.

## Home

For: who this is, what they build, and that the proof runs (`templates/home.html`).

- **Hero**: one `h1` sentence in sans, `--text-2`, opening with the name in the display face in `--text`; then the hook (live count, "run live in your browser") and one key per live demo linking to its `#demo`. From 64rem: 3fr/2fr, sentence left, hook and keys right, bottom-aligned. No role line on the page; the role is in the meta description.
- **Replay**: one real ratelimitd GCRA run (`race`, attack at 10× the limit, seed 1) from the WebAssembly build (`data/hero-trace.json`), drawn at build time on a graticule screen: 480×200 from 40rem, 320×240 below. Denied above, allowed below, each lane on its own labelled scale (dashed "N/s peak", vermilion "N/s limit"); the attack window shaded and labelled. A 1.8 s wipe reveals the bars.
- Doto readouts (allowed in `--live`, denied, limit) from the trace: under the screen on phones, a 15rem column from 64rem.
- "Run it in your browser" is the page's one filled key. On click only, `web/assets/hero.js` loads the build, repeats the recorded call, compares the whole answer, replays the wipe and lights "N/N buckets identical in your browser" with a link to the full demo. Without JS it is inert. `TestHeroRun` clicks it; `TestHeroTrace` re-runs the call every deploy (docs/demo-contract.md §Home replay).
- **Work index**: "Work" and "N projects, M live" (build-time counts), a search box (`/` focuses, Escape clears) and one chip per group, then one section per group (`group` front matter, `site.Groups`), live first within each, numbered `01`… at build time so a filtered row keeps its number. Filters live in the URL (`?q=`, `?g=`). Project pages link their group in the crumb and end with previous / next in the same order. Each row (`row` in `templates/layout.html`) is one link (to `#demo` when live): number, diagram, name, language, tagline, metric, action. Action: a lit "Live demo" lamp and "Run it" key, or an unlit "Source on request" / "Source on GitHub" lamp and "Details" key.
  - Under 40rem: number, diagram and name over language on one line; tagline, metric and action (lamp left, key right) stacked below.
  - 40rem to 64rem: two columns of cards, an odd last card spanning both, action at the foot.
  - From 64rem: a seven-column subgrid table under an `aria-hidden` `--sunken` head (`#`, `mechanism`, `project`, `lang`, `what it is`, `evidence`, `demo`).
  - Hover and focus fill the row with `--block`, turn its text, diagram and lamp `--on-block`, invert the key and loop the diagram.
- **Diagrams** (`templates/diagrams.html`, `cmd/dither`): one line drawing per slug, one accent element naming the idea, showing a behaviour its project page states. `go run ./cmd/dither` renders each at 112×54 (index, home share card) and 224×108 with labels (facts, project share cards), both poses, dithered to one bit (Bayer 8×8): `web/assets/dg/<slug>-<size>.png`, 16 files, 11,702 B (measured). CSS masks (`.dm`) take `currentColor` for ink and `--signal` for accent, so one PNG serves both themes and hover. The build fails on a mask older than its drawing (`web/assets/dg/.sums`) or a missing `.dm-<slug>` rule or `url()`.

## Project page

For: a visitor checks the claim, then runs it. Order: header, demo frame (live only), write-up with facts (`templates/project.html`).

- **Header** (panel): crumb (`Work / slug`), title at `--t-h1` in the display face, tagline as lede, then the evidence: a `--block` "Evidence" plate, the metric in mono, its source in mono `--t-label`. From 48rem, 7fr/5fr: lede left, evidence right; without a metric the lede spans. "Evidence", not "Measured": keel's metric is a gate.
- **Demo frame**: full page width between header and write-up.
- **Write-up and facts** (one panel): stacked on phones, 7fr/5fr from 48rem.
  - Body: bullets with 6 px `--signal` square markers, then `## How the demo works` (or `## Planned demo`), whose heading renders as a mono `--t-label` label in `--text-3`.
  - Facts: the 224×108 diagram mask, `language`, `topics` and `source` (the repo, or "Private, on request: email me" as a mailto naming the project).

## Demo frame

One frame for every demo, built by the site (`templates/project.html`, `web/assets/demo.js`); `ui.js` only fills the mount.

- **Plate**: `--block` hairline cells: lamp and "Live demo" left, `WebAssembly, ~N KB` (gzip bytes from the lock) right. The name is already the h1.
- **Instruction**: the project's `demo_try` line, before the button.
- **Before start**: the filled start key and "Runs in your browser. Nothing downloads until you start."
- **Loading**: Pages gzips .wasm, so progress compares decompressed bytes with the lock's raw size (`data-bytes`): bar and percentage, then "Starting…"; the button reads "Loading…". Without `data-bytes` (smoke) the bar is indeterminate. Screen readers get one status.
- **Running**: the mount at full width; focus moves to the mount itself, so Tab reaches the first control. Mount buttons wrap on phones.
- **Error**: a `--danger-tint` panel above the button, "The demo failed to start." in `--danger` then the message verbatim; the button becomes "Try again", takes focus and starts a fresh worker.
- **No demo yet**: no frame.

## What we will not do

- No photo, illustration, mascot, emoji section markers or stock icons.
- No cream paper, warm-clay accents, uppercase tracked eyebrows, identical card grids or "→" appended to links.
- No decorative gradients, glass, glow, blur or noise textures.
- No scroll-jacking, parallax, custom cursors, typing or scramble effects, or carousels.
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
