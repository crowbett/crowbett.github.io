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
- `--mono`: a self-hosted variable monospace (candidate: JetBrains Mono, OFL, `wght` axis), subset to printable ASCII plus `µ × · – — … → ← ↑ ↓ ≤ ≥ ±`, `font-display: swap`, falling back to `ui-monospace, "SF Mono", Menlo, Consolas, monospace`. Target ≤ 30 KB woff2, measured in V2; if it cannot fit, ship `ui-monospace` and record why.
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

Headings: weight 650-700, tracking −0.02em at h1 and above. Prose measure 65ch max. No more than three sizes visible in one viewport outside the hero.

## Colour

Named by role. Light is warm paper, dark is warm graphite; both first-class. Contrast measured 2026-10-24 with the WCAG 2 relative-luminance formula; ratios in brackets are against `bg` / `surface` / `sunken`, or the named ground. V6 re-measures them in e2e on every run.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#fbfaf7` | `#121110` | page |
| `--surface` | `#ffffff` | `#1a1917` | cards, demo frame |
| `--sunken` | `#f3f1ec` | `#22201d` | code, demo output wells |
| `--line` | `#e5e1d8` | `#2e2b27` | hairlines, card borders (decorative) |
| `--line-strong` | `#cfc9bd` | `#47423b` | dividers that carry structure |
| `--text` | `#1b1a17` (16.7 / 17.4 / 15.4) | `#edeae4` (15.7 / 14.6 / 13.5) | body, headings |
| `--text-2` | `#57534b` (7.3 / 7.7 / 6.8) | `#aaa499` (7.6 / 7.1 / 6.6) | ledes, meta |
| `--text-3` | `#6b665c` (5.5 / 5.7 / 5.1) | `#8f897e` (5.4 / 5.1 / 4.7) | captions, sources |
| `--accent` | `#b0421c` (5.5 / 5.8 / 5.1) | `#f0875a` (7.5 / 7.0 / 6.4) | links, primary action, focus ring |
| `--on-accent` | `#ffffff` (5.8 on accent) | `#1a0f0a` (7.5 on accent) | text on accent fills |
| `--accent-tint` | `#f7e8e0` (accent on it 4.8) | `#3a2219` (5.9) | selected, hover wash |
| `--live` | `#1b7547` (5.5 / 5.7 / 5.1) | `#5cc58f` (8.8 / 8.2 / 7.6) | "live" state only |
| `--live-tint` | `#e2f0e7` (4.9) | `#16291f` (7.2) | live badge ground |
| `--danger` | `#b3261e` (6.3 / 6.5 / 5.8) | `#ff8a80` (8.3 / 7.7 / 7.1) | errors only |
| `--danger-tint` | `#fbe9e7` (5.6) | `#3a1a18` (6.9) | error panel ground |

Rules: one accent; green means live and nothing else; red means error and nothing else. `--line` is decorative; any control boundary (inputs, secondary buttons) uses a colour with ≥ 3:1 against its ground (WCAG 1.4.11), set in V2. Theme follows `prefers-color-scheme`; no toggle (a toggle needs a blocking script in `<head>` to avoid a flash, and the OS setting is the visitor's stated choice).

## Space, layout, radius

- Spacing steps (px): 4, 8, 12, 16, 24, 32, 48, 64, 96. Nothing off-scale.
- Page gutter 16 px on phones, 32 px from 48rem; content max 72rem; prose 65ch.
- Vertical rhythm: sections 64-96 px apart on desktop, 48 px on phones; within a block, 8-16 px.
- Desktop project pages (≥ 64rem): metadata gutter (lang, tags, status, source) left of the prose column, Stripe-style. Phones: single column, metadata under the title.
- Radius: 6 px for controls and cards, 10 px for the demo frame, 999 px for pills. Hairline borders (1 px), no shadows in dark; at most one soft shadow (`0 1px 2px` at 6% black) in light.

## Motion

- Durations: 120 ms for hover/press feedback, 200 ms for state changes (demo start, reveal), never above 300 ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` for entering, `cubic-bezier(0.4, 0, 1, 1)` for leaving.
- Animate `opacity` and `transform` only; nothing that moves layout.
- `prefers-reduced-motion: reduce` turns every transition and animation off, and demos do not auto-play.
- No scroll-triggered reveals of content that should already be readable; no page-load stagger longer than 200 ms total.

## Demo frame

One frame for every demo, built by the site (`templates/project.html`, `web/assets/demo.js`); the demo's `ui.js` only fills the mount.

- **Title bar:** eyebrow label `LIVE DEMO`, the project name, and on the right the runtime (`Go → WebAssembly`) and the download size, in mono.
- **Before start:** one instruction sentence (Ciechanowski), the start button (the page's one accent fill), and the honest size. Nothing downloads until clicked.
- **Loading:** a determinate progress bar from the streamed fetch with real bytes (`412 / 1,190 KB`), then "starting". Indeterminate only when the server sends no length.
- **Running:** the mount, full frame width; controls above output; output in a `--sunken` well. Wide charts scroll inside the well, never the page.
- **Error:** `--danger-tint` panel inside the frame, the error message verbatim, and a Retry button that starts a fresh worker. Focus moves to the panel heading.
- **Focus:** on start, focus moves to the first control the demo renders, or the frame heading if none.
- Same frame on planned projects, rendered as an inert "demo in progress" state, so every project page has the same shape.

## What we will not do

No photo, illustration, mascot, emoji section markers or stock icons. No gradients as decoration, glass, glow or noise textures. No scroll-jacking, parallax, custom cursors, typing effects or carousels. No skill bars, logo walls, social links or follower counts. No third-party anything (fonts, analytics, embeds). No layout that needs JavaScript; with scripts off every page reads correctly and only the demo button is inert. No dark-only or light-only design.

## Decisions log

- 2026-10-24 V1: direction "a lab notebook that runs". System sans for prose, one self-hosted mono for data (byte budget decided in V2). Warm rust accent kept from the scaffold: distinctive against the usual blue, and AA in both themes as measured above. No theme toggle (see Colour).
- 2026-10-24 V1: e2e screenshots inherit the OS colour scheme (this machine is dark), so light pages were never reviewed. V2 makes e2e shoot both schemes explicitly.
