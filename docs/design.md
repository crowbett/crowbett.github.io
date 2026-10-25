# Design

How the site looks and behaves, and why. Every Design-track task in `docs/tasks.md` cites a section here; a change that contradicts this file updates it in the same commit.

## Feel

**A lab notebook that runs.** Quiet, exact, typographic pages where the only loud things are the measured numbers and the live systems.

A visitor should read it as the work of someone who measures before claiming: data set like data, nothing decorative that is not also information, and a page that is fast and steady on a cheap phone.

## References (studied 2026-10-24, headless captures at 1280 px)

Principles taken, not pixels.

| Site | What it does well | What we take |
|---|---|---|
| ciechanow.ski (Bartosz Ciechanowski) | The interactive demo *is* the explanation; one sentence before each demo says what to do with it ("drag", "use the slider"). Calm 700 px measure, one strong colour. | Every demo is introduced by one instruction sentence; prose and demo share one column. |
| samwho.dev (Sam Rose) | Each essay card carries a small animated SVG of the idea itself, so the index is a gallery of mechanisms, not titles. | Project cards show a small diagram of the system (V3), not an icon. |
| tigerbeetle.com | Numbers as typographic objects: big numeral, small caption (100K-500K TPS; 00:00:10 real time for 01:56:40 simulated). | Metrics get their own type role (mono, tabular figures) with the source as a caption, never buried in prose. |
| raft.github.io (RaftScope) | The canonical Raft picture: five servers in a ring with term and role, logs as a grid beside them. | The visual grammar the quorum demo frame must leave room for: diagram left, log or table right, stacked on phones. |
| stripe.com/blog | ~65-character measure, tight large headings, metadata in a left gutter, faint visible grid rules. | Desktop project pages put metadata in a gutter beside the prose; hairline rules show structure. |
| antithesis.com | Small uppercase monospace eyebrow labels ("RELEASE WITH CONFIDENCE") above serif display type; one warm accent on a deep ground. | Mono eyebrow labels for section and field names; one warm accent. |
| paco.me (Paco Coursey) | Hierarchy from two text colours and weight, almost no size changes; a three-column index of title + one-line description. | Hierarchy from colour (text, text-2, text-3) before size. Fewer sizes, used consistently. |
| brittanychiang.com | Sticky two-column desktop layout; small spaced uppercase labels for dates; tinted pills for tech. | Tag pills tinted, not outlined boxes; labels in small caps-like mono. |
| maggieappleton.com | The hero is one sentence that says who and what ("Maggie makes visual essays about..."). | The home hero reads as one sentence, name inside it. |
| jepsen.io | Research credibility from plain, dense, sourced writing; no marketing chrome. | Tone: plain claims with their source; no superlatives. |
| danluu.com | Loads instantly; the text is the product. | Performance is a design feature: no layout shift, tiny CSS, no blocking fonts. |
| joshwcomeau.com | Dark theme with depth (layered surfaces, not pure black); embedded demos framed consistently. | Dark is designed, not inverted: three surface levels, warm graphite, never #000. |
| rauno.me | Confident type and restraint; one gesture per page. | One accent gesture per page (the live demo button or the metric), not ten. |
| vercel.com/geist/colors | Each colour step has one job (background, border, text) so contrast is decided once. | Tokens are named by role, and every text/background pair is AA-checked once here. |
| fly.io/blog | Full illustration system. | Counter-example: illustration needs an illustrator; we do not imitate it. |

## Type

Prose stays in the platform UI face (SF on Apple, Segoe on Windows, Roboto on Android): zero bytes, best hinting on each OS. The identity is carried by one self-hosted monospace used for data and labels: metrics, sizes, tags, eyebrows, demo chrome.

- `--sans`: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- `--mono`: JetBrains Mono (OFL 1.1, no reserved font name), variable `wght` limited to 400-700, subset to printable ASCII plus `© ± µ · × – — ‘ ’ “ ” … ← ↑ → ↓ − ≤ ≥`: 9,796 bytes woff2 (measured). Preloaded, `font-display: optional` so it never swaps in late and shifts layout; a visitor on a slow first load sees the fallback `ui-monospace, "SF Mono", Menlo, Consolas, monospace` for that page. Licence ships beside it (`web/assets/fonts/OFL.txt`).
- Figures: `font-variant-numeric: tabular-nums` wherever numbers sit in columns or update live.

Scale (rem at 16 px root; body is 17 px):

| Token | Size | Line height | Use |
|---|---|---|---|
| `--t-label` | 0.75rem mono, +0.06em tracking, uppercase | 1.4 | eyebrows, field names, demo chrome |
| `--t-small` | 0.875rem | 1.5 | meta, captions, footer |
| `--t-body` | 1.0625rem | 1.65 | prose |
| `--t-lede` | 1.1875rem → 1.3125rem (clamp) | 1.5 | ledes, card titles |
| `--t-h2` | 1.375rem → 1.625rem | 1.25 | section heads |
| `--t-h1` | 2.25rem → 3.5rem | 1.05 | page titles |
| `--t-display` | 2.5rem → 4.5rem | 1.0 | home hero only |

Headings: weight 680, tracking −0.025em at h1, −0.035em at display. Prose and every block in the prose column share `--measure: 42rem` (a `ch` measure differs per font, so mono and sans blocks ended at different right edges). No more than three sizes visible in one viewport outside the hero.

## Colour

Named by role. Light is warm paper, dark is warm graphite; both first-class. Contrast measured 2026-10-24 with the WCAG 2 relative-luminance formula; ratios in brackets are against `bg` / `surface` / `sunken`, or the named ground. `TestTokenContrast` (e2e/quality_test.go) re-measures every pair below from site.css on every run; the table was regenerated from it on 2026-10-24.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#fbfaf7` | `#121110` | page |
| `--surface` | `#ffffff` | `#1a1917` | cards, demo frame |
| `--sunken` | `#f3f1ec` | `#262420` | code, demo output wells |
| `--line` | `#e5e1d8` | `#3b3732` | hairlines, card borders (decorative) |
| `--line-strong` | `#cfc9bd` | `#47423b` | dividers that carry structure |
| `--control-line` | `#8a8376` (3.6 / 3.8) | `#7a7469` (4.1 / 3.8) | input and secondary-button borders (3:1 minimum) |
| `--text` | `#1b1a17` (16.7 / 17.4 / 15.4) | `#edeae4` (15.7 / 14.6 / 12.9) | body, headings |
| `--text-2` | `#57534b` (7.3 / 7.7 / 6.8) | `#aaa499` (7.6 / 7.1 / 6.3) | ledes, meta |
| `--text-3` | `#6b665c` (5.5 / 5.7 / 5.1) | `#958f84` (5.9 / 5.5 / 4.8) | captions, sources |
| `--accent` | `#b0421c` (5.5 / 5.8 / 5.1) | `#f0875a` (7.5 / 7.0 / 6.1) | links, primary action, focus ring |
| `--on-accent` | `#ffffff` (5.8 on accent) | `#1a0f0a` (7.4 on accent) | text on accent fills |
| `--accent-tint` | `#f7e8e0` (accent on it 4.8) | `#3a2219` (5.8) | selected, hover wash |
| `--live` | `#1b7547` (5.5 / 5.7 / 5.1) | `#5cc58f` (8.8 / 8.2 / 7.3) | "live" state only |
| `--live-tint` | `#e2f0e7` (4.8) | `#16291f` (7.2) | live badge ground |
| `--danger` | `#b3261e` (6.3 / 6.5 / 5.8) | `#ff8a80` (8.3 / 7.7 / 6.8) | errors only |
| `--danger-tint` | `#fbe9e7` (5.6) | `#3a1a18` (6.9) | error panel ground |

Rules: one accent; green means live and nothing else; red means error and nothing else. `--line` is decorative; any control boundary (inputs, secondary buttons) uses a colour with ≥ 3:1 against its ground (WCAG 1.4.11), set in V2. Theme follows `prefers-color-scheme`; no toggle (a toggle needs a blocking script in `<head>` to avoid a flash, and the OS setting is the visitor's stated choice).

## Space, layout, radius

- Spacing steps (px): 4, 8, 12, 16, 24, 32, 48, 64, 96. Nothing off-scale.
- Page gutter 16 px on phones, 32 px from 48rem; content max 72rem; prose `--measure` 42rem.
- Vertical rhythm: sections 64 px apart on desktop, 48 px on phones; within a block, 8-16 px.
- Card padding 16 px on phones, 24 px from 48rem (24 px on a 390 px screen left a 292 px text column).
- Desktop project pages (≥ 64rem): metadata gutter (lang, tags, status, source) left of the prose column, Stripe-style. Phones: single column, metadata under the title.
- Radius: 6 px for controls and cards, 10 px for the demo frame, 999 px for pills. Hairline borders (1 px), no shadows in dark; at most one soft shadow (`0 1px 2px` at 6% black) in light.

## Motion

- Durations: 120 ms for hover/press feedback, 200 ms for state changes (demo start, reveal), never above 300 ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` for entering, `cubic-bezier(0.4, 0, 1, 1)` for leaving.
- Animate `opacity` and `transform` only; nothing that moves layout.
- `prefers-reduced-motion: reduce` turns every transition and animation off, and demos do not auto-play.
- No scroll-triggered reveals of content that should already be readable; no page-load stagger longer than 200 ms total.
- **Diagram motion** (samwho's moving thumbnails, Ciechanowski's "the drawing does the explaining"): each diagram's accent element acts out its mechanism: Raft leaders pulse and heartbeats march (quorum, keel), bars rise and the denied overflow marches (ratelimitd), the miss path marches (edgecache), the active segment fills (kvlite), the running worker pulses and the retry loop marches (jobrun), the queried function pulses (codegraph), the nozzle sweeps the layer (strata). It plays once, 300 ms after load, where the diagram is the subject (the two feature cards, the project page facts), and loops while a card is hovered or keyboard-focused. 1.6 s per cycle: this is content, not UI feedback, so the 300 ms cap does not apply, but every keyframe starts and ends on the static drawing, so a screenshot, a print or reduced motion always shows the finished picture. `stroke-dashoffset` is animated alongside transform and opacity; it repaints, never relayouts.
- **UI feedback:** the card arrow nudges 3 px and the title turns accent on hover/focus (120 ms); buttons press 1 px; the demo mount, the progress row and the error panel rise 4 px and fade in over 200 ms.
- **Checks:** e2e measures CLS at load on every page (must be 0) and counts `document.getAnimations()` with and without `prefers-reduced-motion: reduce` on home, a project page and the smoke demo (0 with, more than 0 without, so the check cannot pass vacuously).

## Home

What it is for: in one look, who this is, what they build, and that the proof is runnable. Good looks like a visitor reading the headline, then scanning eight mechanisms they recognise before reading a word of a card.

- **Hero** (Maggie Appleton's sentence hero; Antithesis's mono kicker): role as an accent mono kicker, then one display sentence with the name on its own line ("I'm Corbett." never wraps mid-phrase), then one lede paragraph with the proof method and the honest demo status. The words are the scaffold's; only their arrangement changed.
- **Work index**: an eyebrow rule with the count on the right (`8 projects`, plus `· N live` once demos ship), counted at build time, so it is always true.
- **Cards** (samwho's mechanism thumbnails): the first two projects by `order` are full-width feature rows from 54rem (diagram left, text right); the rest sit two to a row, one column on phones. Each card is a diagram panel on `--sunken`, then title, tagline in `--text-2`, the metric in mono, and a foot under a dashed rule with lang, "Private source" and a `→` (all mono) that turns accent on hover, so every card has the same skeleton with or without a metric. Only "Live demo" gets a pill (green tint with a dot); the planned state is said once in the hero, not eight times.
- **Diagrams** (`templates/diagrams.html`): one inline SVG line drawing per slug, viewBox 240×120, 1.5 px strokes in `--text-3` that stay 1.5 px at any size (`vector-effect: non-scaling-stroke`), one accent element that names the idea (the Raft leaders, the rate limit, the cache, the active segment, the running worker, the queried function, the layer being printed). Labels (`.t`, keel's key ranges) show only at feature size, where they are legible. Inline so they theme with CSS variables and need no request; ~0.6 KB each. A project with no drawing yet renders its card without the panel (`.card-fig:has(> .dg:empty)`); add a drawing when adding a project.

## Project page

What it is for: a visitor checks the claim, then runs it. Good looks like the evidence and its source read before the prose, and the facts (language, topics, demo, source) answered without scrolling.

- **Header**: crumb, h1, tagline as lede, full width up to 52rem.
- **Facts** (Stripe's docs gutter; jepsen's metadata column): from 64rem a 14rem sticky column left of the text with the project's diagram (2:1, the same drawing as its card) and a `dl` of Language, Topics, Demo (only when live: a pill linking to the frame) and Source (repo or "Private, on request" linking to the mailto line at the foot). On phones the same block sits under the header with the labels in a two-column grid.
- **Evidence**: one box, accent left rule, mono label `EVIDENCE`, the metric in mono (body size on desktop, 15 px on phones), its source in sans below. "Evidence", not "Measured": keel's metric is a gate, not a measurement.
- **Body** at `--measure`; the source line closes the column.

## Demo frame

One frame for every demo, built by the site (`templates/project.html`, `web/assets/demo.js`); the demo's `ui.js` only fills the mount.

- **Title bar:** a dot and "Live demo" on the left; on the right the runtime and the transfer size in mono (`WebAssembly · ~1,215 KB`, gzip bytes from the lock). The project name is already the h1, so it is not repeated.
- **Before start:** the start button (the page's one accent fill) and one honest sentence: runs in your browser, nothing downloads until you start it.
- **Loading:** the worker streams the fetch and reports decompressed bytes. GitHub Pages sends .wasm gzipped, so Content-Length is the compressed size and useless for progress; the page compares received bytes with the raw size from the lock (`data-bytes`) and shows a determinate bar and a percentage, then "Starting…" while the binary instantiates. The button reads "Loading…"; the note gives way to the bar. Without `data-bytes` (the smoke page) the bar is indeterminate and counts KB. Screen readers get one status ("Downloading the demo…"), not every percent.
- **Running:** the mount, full frame width; the bar and note go away. Focus moves to the first control the demo renders, or to the mount.
- **Error:** the status becomes a `--danger-tint` panel above the button, "The demo failed to start." in `--danger` then the message verbatim. The start button turns into "Try again" (one action, not two buttons) and takes focus; it starts a fresh worker.
- **Planned:** the same frame, dashed and unfilled, hollow dot, heading "Demo", one sentence. Every project page has the same shape.

## What we will not do

No photo, illustration, mascot, emoji section markers or stock icons. No gradients as decoration, glass, glow or noise textures. No scroll-jacking, parallax, custom cursors, typing effects or carousels. No skill bars, logo walls, social links or follower counts. No third-party anything (fonts, analytics, embeds). No layout that needs JavaScript; with scripts off every page reads correctly and only the demo button is inert. No dark-only or light-only design.

## Decisions log

- 2026-10-24 V1: direction "a lab notebook that runs". System sans for prose, one self-hosted mono for data (byte budget decided in V2). Warm rust accent kept from the scaffold: distinctive against the usual blue, and AA in both themes as measured above. No theme toggle (see Colour).
- 2026-10-24 V2: JetBrains Mono over Geist Mono (same size, 12,976 vs 13,052 B before the weight limit; longer track record at small sizes) and IBM Plex Mono (16,852 B, and its "Plex" reserved name forbids shipping a subset under that name). Chrome does not implement the `ui-monospace` generic, so before V2 Chrome on macOS fell through to Menlo; self-hosting makes the data face identical everywhere.
- 2026-10-24 V2: font rebuilt with fonttools 4.x: `fonttools varLib.instancer JetBrainsMono[wght].ttf wght=400:700`, then `pyftsubset --unicodes=U+0020-007E,U+00A9,U+00B1,U+00B5,U+00B7,U+00D7,U+2013,U+2014,U+2018-201D,U+2026,U+2190-2193,U+2212,U+2264-2265 --flavor=woff2 --layout-features=kern --name-IDs='*'` (keeps the licence name records; drops `calt`, so `->` never turns into a ligature). New `Fonts` budget in `site check`: 32 KiB of woff2 in total.
- 2026-10-24 V2 review, round 1: blocks in the project column ended at three right edges (fixed with `--measure`); 140 px dead gap between hero and Work on desktop (section gap 96 → 64 px); phone cards too padded (24 → 16 px). Round 2: remaining weaknesses belong to V3/V4: the name appears twice at the top of home, "Demo coming" and "Private source" pills look identical, the metric box and the planned-demo notice stack as two boxes, and a metric source like `go test ./internal/sim -seeds 10000` can wrap after its hyphen on phones.
- 2026-10-24 V3: fresh-eyes review round 1 (screenshots only) said "maybe": flat hierarchy, "Demo coming" eight times read as unfinished, diagrams undersized and uneven in ink, phone hero orphaned "consensus,", dark card bands nearly invisible. Fixes: feature rows, live-only pill, non-scaling strokes with outlined bars, phone display size 2rem, dark `--sunken` #22201d → #262420, `--line` #2e2b27 → #36322d, `--text-3` #8f897e → #958f84 (keeps 4.8:1 on the new sunken). keel got key-range labels, edgecache a cache with entries and a dashed miss path, jobrun a backoff axis, strata a nozzle on the layer being printed.
- 2026-10-24 V3 rounds 2-3: feature text centred, bands shortened, one diagram scale across feature and grid (grid band 184 px, feature diagram ≤ 12rem, feature split 5:7), jobrun backoff ticks in body ink, dark `--line` → #3b3732. Round 3: no MAJOR findings; all eight diagrams read as their systems; verdict "maybe, leaning yes" because the grid is a familiar shape. The memorable lever moves to V5 (diagram motion) and V3b re-judges it.
- 2026-10-24 V1: e2e screenshots inherit the OS colour scheme (this machine is dark), so light pages were never reviewed. V2 makes e2e shoot both schemes explicitly.
- 2026-10-24 V4: the project page gets a facts column and one evidence box, and the frame absorbs the planned notice (V2 carry-over: two stacked boxes). Round 1: "Being built" said three times (facts row, frame spec, sentence) → once; the desktop diagram tile was a tall empty box → 2:1; the mono metric wrapped hard on phones → 15 px there. Round 2 (loading, error and ready states shot with a throttled server and the ratelimitd demo): note, bar and disabled button stacked three lines while loading → note hidden, button says "Loading…"; size printed without separators → `thousands()` in the build; the "nothing downloads" note stayed true-looking after a failed download → hidden in the error state. Accepted: a metric source with a command can still wrap after a hyphen on phones (no CSS control over hyphen breaks short of `nowrap`, which would overflow).
- 2026-10-24 V4: progress throttling started `last` at 0 and `performance.now()` in a fresh worker starts near 0, so the first chunk was swallowed and only the final count arrived; the new e2e check caught it before it shipped.
- 2026-10-24 V5: hover loops use duplicate keyframes (`dg-pulse-l` beside `dg-pulse`): a feature card already ran `dg-pulse` once, and re-applying the same name does not restart it, so the loop would start mid-cycle with a jump. The cost is ~0.4 KB. Leaving a feature card replays its once-animation (a soft settle); leaving a grid card snaps to the static drawing. Accepted: both end on the static picture.
- 2026-10-24 V5: CLS is measured before a demo starts. Running the smoke demo shifted the content below it by 0.0017 (measured) more than 500 ms after the click, as the frame grows to fit the result; that is content the visitor asked for, and reserving its height would mean guessing each demo's size. No page-load reveal: the content is readable at first paint and a fade would only delay LCP.
- 2026-10-24 V6: quality gates in `make e2e` (e2e/quality_test.go). Token contrast for every §Colour pair in both schemes; axe-core 4.10.3 (vendored test-only in e2e/testdata/axe, MPL-2.0, same SHA-256 from cdnjs and unpkg, injected through DevTools so the CSP is untouched) on every page, viewport and scheme with WCAG 2.0/2.1 A+AA and 2.2 AA tags, after finishing entrance animations (a mid-fade scan flagged ratelimitd's labels on 2 of 4 runs); a Tab walk at desktop that must visit every visible focusable in document order with a ≥ 2 px `:focus-visible` outline (demo controls included, after the demo starts); every resource on the page's origin plus a strict CSP; CLS 0 at load; LCP ≤ 2.5 s and CLS 0 from a server that answers like a slow mobile link (150 ms to first byte, 200 KB/s). Chrome's network emulation, rule-based or classic, left the navigation request unthrottled (first byte 2 ms, measured), so the throttle lives in the test server. Measured: LCP 420 ms home, 432 ms quorum. Each check failed once on a deliberate break (text-3 #a39e94; `:focus-visible { outline: none }`; an off-origin img with `img-src https:`; an img without alt; 600 KB of CSS → LCP 3.7 s).
- 2026-10-24 V6: the first run after the edgecache demo landed failed axe `scrollable-region-focusable` at 390 px (its request table scrolls sideways). Fixed at the frame, not by weakening the check: demo.js gives any overflowing horizontal scroller in the mount `tabindex="0"` (and a fallback region label), re-checked on re-render and resize; recorded in docs/demo-contract.md, with C3 asking the demo for a real label.
