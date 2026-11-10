# Design

How the site looks and behaves. A change that contradicts this file updates it in the same commit, and site.css tokens change together with it.

## Feel

- **An instrument panel**: cold paper, black rules, one signal blue, dark screens only where real output runs. Labelled, ruled, exact.
- Made by someone who measures before claiming: data set like data, nothing decorative that is not also information, fast on a cheap phone.
- **Depth comes from layers that mean something**: a band, a sheet sliding over it, the screens that run real code, glass only where a bar floats over content.
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
- Theme follows `prefers-color-scheme`, or the header switch.
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
- Never scale to exactly 0 (start from `scale(0.001)`); `site.Check` rejects a zero scale in built CSS, HTML or JS.
- `prefers-reduced-motion: reduce` turns every transition and animation off; demos do not auto-play.
- **Entrances ride the scroll**: things arrive as the page moves and never on a timer, so a still page is a finished page. They move by `translate` and `rotate` only, never opacity, so text is readable at every scroll position. Home: project names and the titles "Play it", "Work" and "All N projects" are split into letters by kinetic.js (kerning off for them, split or not, so the split shifts nothing; the link or heading keeps its name in `aria-label`) and each letter drops 0.6em and turns 12° into place, staggered 4% of the panel's entry per letter; index cards rise 2.5rem. Project pages: the write-up panel and pager cards rise; the live wall's tiles rise; on Numbers each bar grows to its length and each card rises. All over the first 200 to 280 px of entry. No page-load stagger.
- **Things that follow**: under a mouse a row of the Work index shows that project's recorded clip on a card that trails the pointer (18% of the gap each frame); the footer's address lifts letter by letter under the pointer; the stage's words shift up to 16 px against the camera as it leans. A panel's live demo wipes down over its clip.
- **The arena** draws trails behind every player, throws a burst from a taken flag, counts three before a game and shows the count large when it ends; the tallies pop when they count. Scroll-driven effects, where `animation-timeline` is supported and motion is allowed: the stage and project head sink (scale 0.93, opacity 0.25) as the sheet covers them; on home each project panel sinks the same way as the next slides over it, while the arriving panel's screen rises into place (from scale 0.86, 12vh down) and its text lifts in behind it, both finished by the time the panel covers the screen; The pager cards' hover light follows the pointer.
- **Numbers move only when they count real data**: the stage dials count passes the tracer finished in this tab; the demo percentage follows bytes received. No scrambles or decorative counters.
- **Diagram motion**: each mask holds a rest and a mid-motion pose; motion is a `step-end` `opacity` flip between them, once when 60% on screen (web/assets/motion.js; A-B-A-B-A over 1.6 s) and looping while a row is hovered or focused. It ends on the rest pose.
- **Page to page**: cross-document view transitions; the header holds still and the page slides. Opening or leaving a project names only its title and diagram (web/assets/vt.js, a classic head script because `pagereveal` fires before modules run), so they fly between the home row and the project page, and between projects, in `--d-spring`.
- Checks: e2e requires CLS 0 at load on every page and counts `document.getAnimations()` with and without reduced motion on home, a project page and the smoke demo.

## Home

For: who this is, what they build, and that the proof runs (`templates/home.html`).

- **Layers**, back to front: the page (`--bg`), the stage pinned under the header, the work sheet (rounded top, `--band-edge` shadow) that slides up over it, then the project panels, each sliding up over the last, the index of all projects (a sheet) sliding over the last panel, and bars that float over content: the header (`--glass`) and on home the dock while a panel is current.
- **Stage**: a plain `--band` in the page's theme. Left (or above, under 64rem) the `h1`: the name in the display face at up to 4.5rem, so it never outshouts the render, then the role line in `--band-dim`, the hook (the tracer and its size, then the live count), a "See the work" key and a link to the full demo.
- The picture is the raytracer demo itself (`site.HomeStage`: Cornell box, 480 px, seed 1). `web/assets/stage.js` loads the 111 KB build once per spare core (cores − 1, up to 8), each copy in its own worker and each owning every Nth 8-row stripe, material-only sampling on the left canvas and NEE + MIS on the right, split by a divider (drag its line, or arrow keys on its grip). The bridge keys a row's samples by seed, row and count, so the copies trace the picture one copy would: the 64 spp poster re-recorded with 8 copies came out byte for byte the file one copy made (measured 2026-11-09). The hud's right end says how many cores are tracing.
- **Orbit**: a drag anywhere off the split line swings the camera about the point the scene looks at, up to 18° of yaw and 14° of pitch, which keeps the eye inside the Cornell box's opening. Each copy re-aims (the bridge's `camera` call), sweeps its stripes once at 1 to 8 rows per stripe stretched to fit (as many as keep a sweep near 33 ms), aims again to clear the sweep's samples and then traces in full, so the box turns under the hand and sharpens when it stops. The hud reads the yaw and pitch, then "Reset view" (double-click does the same). A "Drag to orbit" chip sits on the picture until the first drag. Under a mouse, with motion allowed and only while the stage is already rendering, the camera leans up to 45% of that range toward the pointer anywhere on the stage, easing a fifth of the way each frame, until a drag takes the view. Reduced motion and touch get the drag only. The slug and state sit above the picture and the two sampling labels below it, in plain text on the band, not over the render. Under them three dials in the sans with `tabular-nums`, measured in this tab: samples per pixel, samples/s over the last 2 s, and the noise ratio left ÷ right from the binary's own RMSE estimates. It stops at 512 spp. The loading line and any error sit on a dark plate at the picture's foot, as a panel's do.
- **Fit**: from 64rem the picture is sized by the screen's height as well as its column (down to 23rem), and the scenes pill shares a row with the run key, so the dials end above the fold down to a 1280×720 screen (under about 780 px tall the key wraps below the pill). The key keeps the width of its widest label.
- It starts by itself after `load` while the stage is on screen and not covered by the sheet, and pauses when either changes or the tab hides. With reduced motion, Save-Data, a 2g/3g connection or fewer than 4 cores it does not start; "Render it here" does. Until then it shows `web/reel/stage.webp`, the same render recorded at 64 spp by `go run ./cmd/stage`, labelled "recorded".
- **Arena** (`web/assets/arena.js`): the band after the stage, so the home page has something to play before the list starts. The netcode demo's binary runs a six-player match (its real server and rollback clients on simulated 60 Hz ticks, every datagram through its codec and lag simulator). Three flags stand in the arena; a flag is taken when a player's position on the server reaches it, so on a slow link the visitor's own screen arrives first and the dashed ring (where the server has them) catches up. The flags, the tally and the autopilot are the page's and say so; positions, rollbacks and hash checks are the binary's. A new flag lands on the one of eight seeded draws farthest from every bot. Left from 64rem: "Play it", the claim, how to steer, the link (the demo's own presets: "LAN, 0 ms", "the soak's link, 100 ms", "mobile, 180 ms"), a filled "Play, 45 seconds" key, five dials (you, bots, time, rollbacks, desyncs) and a status line. Right: the arena on a dark screen with a legend. Below 64rem the arena comes straight after the how-to line.
  - It starts on its own under the stage's rules once 35% on screen, with an autopilot steering player 0 toward the nearest flag, and pauses off screen. Play hands over player 0 for 2,700 ticks: the pointer steers (the ball heads for it), or the arrow keys and WASD while the arena has focus; a click or Space dashes; Escape stops. On touch a drag steers and lifting dashes, and the page does not scroll from the arena while a game is on.
  - The result is one sentence from the binary's counters: flags taken by each side, the link, rollbacks on the visitor's client and state hashes the server compared in those 45 seconds, and the desyncs it found. The best count is kept in localStorage.
  - The stage's "Play the arena" key jumps to it; without scripts the band and that key are not drawn.
- **Scenes**: a pill under the picture switches between the square, light-sampled scenes (`site.StageScenes`: Cornell box, glass sphere, smoke, under the raytracer demo's own labels). Picking one is consent to render: the tracer loads it, the dials reset to measured values from pass one, and the new picture wipes in band by band over the last. Only the Cornell box has a poster.
- **Work**: the sheet holds "Work", "N projects, M with a live demo" and the index: a panel with a cell per group (`site.Groups`; two columns, four from 64rem), headed by the group's link (`#g-<key>`, also the project crumb's target) and its count, then a row per project: number, name in the display face, language from 40rem. A row fills `--block` on hover or focus, jumps to its panel (`#p-<slug>`) and hands the panel focus. Then one full-screen dark panel per project (`.reel`, `web/assets/work.js`), grouped and ordered as before (live first within each group, numbered `01`… at build time).
- **Panel**: the stage's band at full height under the header, rounded on top with a shadow cast up over the panel it covers. Left from 64rem (5fr / 7fr), above on narrower screens: the group name (an `h3` on a group's first panel), number and name in the display face (the page link), one size for every name: up to 6.5rem, capped so the widest (edgecache) fits its column on one line, the tagline in `--band-dim`, the metric behind a `--band-signal` rule, then a filled "Run it live" key (runs the demo in the panel, see Live panel; without JS a link to the project's `#demo`) or a plain "Source on request" / "Source on GitHub" label, and the language. Right, or below: a 16:10 screen with the project's poster (lazy) or quorum's diagram, its bottom fading into the screen so a clip's cut-off row reads as deliberate, an "NN / 15" chip in the bottom-left corner (over the fade, not the content).
- **Stack**: each panel pins under the header and the next slides up over it. The covered panel sinks (the scroll-driven `sink`, on a view timeline of the panel above it that `work.js` names) and panels buried two or more deep get `opacity: 0` (`data-gone`): never seen, not drawn, links still focusable. A panel taller than the screen pins once its bottom edge is in view.
- **Current**: the panel covering the middle of the screen, by the panels' flow positions. Only it plays its clip (`web/reel/<slug>.mp4`, recorded by `cmd/reel` from `internal/site/showcase.go`); reduced motion or Save-Data shows posters only. Focus landing in a panel (Tab, j/k, a link) brings that panel up first, so nothing focused sits under another panel. Without JS the panels stack in plain flow and the stage does not pin.
- The panel's screen opens its project (pointer only: `tabindex=-1`, `aria-hidden`; the name is the keyboard path), and the current panel's screen flies into the project head (`screen` view transition). On hover an "Open →" chip rises in at the bottom right and the picture leans in 3%.
- **Live panel** (`web/assets/panel.js`): on a live panel "Run it live" runs the demo in place; nothing downloads before the press. The clip plays on while it loads, progress on a dark plate at the screen's foot. Ready, the demo covers the screen's column on `--surface` with `--lift` (the whole panel below 64rem), headed by a mono bar: "Live demo", `~N KB · ready in N ms`, "Full page", and Stop below 64rem. The key and the dock's key read "Stop", sized to their widest label. One panel at a time; covered, scrolled away, peeked or replaced, it stops, its worker ends and the clip returns. Opacity fades in only with motion allowed.
- **Intro** (vt.js, home.css): once per browser, when a visit lands on home with motion welcome. The stage's words rise in three steps while the poster traces in from the top in 14 bands, as the tracer fills a frame; the split and the figure's labels follow. 1.5 s; any key, click, wheel or touch ends it.
- Project pages link their group in the crumb and end with previous / next in the same order.
- **Diagrams** (`templates/diagrams.html`, `cmd/dither`): one line drawing per slug, one accent element naming the idea, showing a behaviour its project page states. `go run ./cmd/dither` renders each at 112×54 (index, home share card) and 224×108 with labels (facts, project share cards), both poses, dithered to one bit (Bayer 8×8): `web/assets/dg/<slug>-<size>.png`, 30 files, 27,025 B (measured 2026-11-09). The labelled size is stored at 2x: the drawing is dithered at one pixel per CSS pixel and doubled, and its 7 px labels are drawn at 2x and thresholded, because at 1x Martian Mono turned "redis" into "eedis". CSS masks (`.dm`) take `currentColor` for ink and `--signal` for accent, so one PNG serves both themes and hover. The build fails on a mask older than its drawing (`web/assets/dg/.sums`) or a missing `.dm-<slug>` rule or `url()`.

## Every byte

For: showing there are levels under each demo, on the numbers page (`templates/numbers.html`, `web/assets/levels.js`, `web/assets/numbers.css`).

- **Rows**: one grid, Level / Bytes / Functions / Share, every row a disclosure with a chevron that turns open. Each level indents one step and draws a hairline guide per ancestor; a row's share is of its parent, with a bar in its language's colour. Function rows carry a dash, data and "N more" rows a dot. Under 40rem the Functions column and row notes go and the step halves.
- **Bottom level**: a function opens onto a dark screen panel (as the demo screens) with its instructions in mono: offset, bytes and nested text, the signature in signal colour, the first 400 lines and a "Show all" key. Narrow screens drop the bytes column.
- Each level is drawn the first time it opens; nothing past the binaries downloads until a binary row opens.

## Live wall

For: every demo running at once, to browse by eye (`templates/live.html`, `web/assets/wall.js`, `web/assets/live.css`).

- **Head**: the numbers page's band: crumb, "Live" at `--t-h1`, a lede giving the gzip range of the binaries from the lock, and one note that says either that tiles start in view (up to the cap) or that nothing downloads before Run (both share a cell).
- **Tiles**: one column, two from 64rem. Each is a 16:10 screen (the desktop poster, lazy), then name (the project link) and tagline, with a Run key and a mono status of fixed width ("still · ~N KB", "live · ready in N ms") beside the name, below it under 30rem. A live tile covers its poster with the demo on `--surface`, opened on the element its recording is framed on; the box does not scroll, so the page never gets stuck in a tile, and Tab still reaches every control.
- **Running**: tiles at least half in view for 300 ms start in page order up to the cap (4; 2 under 48rem or with a coarse pointer); a tile that leaves stops and ends its worker. Stop holds a tile until it leaves. Reduced motion, Save-Data, 2g/3g or fewer than 4 cores: posters only, and Run starts one, stopping the one least in view at the cap.
- Reached from the home count line, the footer and the palette; no nav entry.

## Navigation

- **Search key** in the top bar opens the command palette (web/assets/palette.js, loaded on first use; `/search.json` from the build). ⌘K, Ctrl+K or `/` anywhere. Without JS it is a link to the home index. The key label has a fixed box, so filling it in moves nothing.
- **Palette**: a modal `<dialog>` with a combobox over a listbox. "This page" actions first (run the demo, full screen, previous / next, work index), then projects with their diagram, language, group and a live or source label, then Contact (copy or write an email), so ⌘K then Enter never copies the email. A `--block` "Go to" plate heads it like a demo frame; the backdrop is flat `--bg` at 88%, no blur or shadow. Title hits rank first; a subsequence matches too ("rlim" finds ratelimitd).
- **Keys sheet** (web/assets/keys.js): `?`, the footer's "Keyboard shortcuts" (hidden where nothing hovers) or the palette opens every shortcut in the palette's frame, grouped by where it works.
- **Here**: on a project page from 48rem the header names the project beside the brand once its title has scrolled under the bar (a pointer mirror, `aria-hidden`).
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
  - Facts: the 224×108 diagram mask, `language`, `topics`, `area` (the group's link, then the other projects in it), for a live demo `demo binary` (bytes after gzip and before) and `built with` (toolchain and pinned commit), both from `demos.lock.json` and cited to the numbers page, then `source` (the repo, or "Private, on request: email me" as a mailto naming the project).

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
- No scroll-jacking, custom cursors, typing or scramble effects, or carousels: the reel scrolls natively; panels pin and slide. One thing moves on its own, stoppable and off under reduced motion: the arena's attract mode. No banners or tickers drifting across the page.
- No skill bars, logo walls, social links or follower counts.
- No third-party anything (fonts, analytics, embeds).
- No layout that needs JavaScript: with scripts off every page reads correctly and only demo buttons are inert.
- No dark-only or light-only design.
