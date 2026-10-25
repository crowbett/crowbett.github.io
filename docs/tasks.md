# Tasks

The work queue as a dependency graph. A task is **ready** when its status is `todo` and every task in `deps` is `done`. Pick the ready task with the lowest `order`. Statuses: `todo`, `doing`, `done`, `blocked (reason)`, `user` (only the owner can do it; never start one).

Two sessions work this graph at once. **Tracks:** everything under "Design track" belongs to the design session (`docs/design-loop-prompt.md`); everything else belongs to the demo session (`docs/loop-prompt.md`). Each session only picks tasks from its own track; add cross-track requests as new `todo` tasks in the other track.

When you finish a task, set it `done` with the date and commit SHA(s). If a task turns out bigger than planned, split it here into new ids before continuing. New ideas go in at the bottom as `todo` with deps and a done-when line.

## Ship

### S1 First deploy · order 1 · deps: none · status: done 2026-10-24 (aa3fc49, cd7a0a3)
Create public repo `crowbett/crowbett.github.io`, push `main`, enable Pages with build type "GitHub Actions", watch the run.
Done when: https://crowbett.github.io/ returns 200, every project page and `/demos/smoke/` load, and the smoke demo answers in a real browser session (headless e2e pointed at the live URL or a manual curl + chromedp check).

### S2 Measure wasm delivery · order 2 · deps: S1 · status: done 2026-10-24 (Pages gzips .wasm; see docs/research.md)
`curl -sI -H 'Accept-Encoding: gzip' https://crowbett.github.io/wasm/smoke.wasm`: record `content-type`, `content-encoding`, transferred size in `docs/research.md`. If Pages does not compress `.wasm`, decide (record in PLAN.md) whether the size shown on the button should be the raw size.
Done when: the "Downloads ~N KB" text on every demo button matches what a visitor actually transfers.

## Fixes

### E0 edgecache README claim · order 5 · deps: none · status: done 2026-10-24 (edgecache e04f3da, site b931dea)
edgecache's README line 5 says "standard library only", but `go.mod` has OpenTelemetry and gRPC and `internal/http/handlers.go` imports `otelhttp`. Reword it truthfully (e.g. caching logic on the standard library, OpenTelemetry for tracing) in the edgecache repo, gate, push.
Done when: README and this site's edgecache page say the same true thing.

### F1 CI e2e over 60 s · order 6 · deps: none · status: done 2026-10-24 (site db0574a; Pages job 33 s after)
After b931dea the Pages job took 77-91 s: e2e ran 56-57 s on CI against 16-24 s before. Measured on a debug branch: chromedp chose `/usr/bin/chromium`, which cold-starts in 25 s on ubuntu-24.04, against 1.3 s for `google-chrome`; the page subtests themselves took 8.5 s. e2e now names `google-chrome` on CI.
Done when: the Pages job is back under 60 s.

## Go demos (one bridge each, see docs/demo-contract.md)

### D1 ratelimitd: algorithm race · order 10 · deps: S1 · status: done 2026-10-24 (ratelimitd b730ede, f5d5c37, 2420562, 6a63fcb; site: the commit that adds this line)
Bridge in `~/dev/ratelimitd/cmd/webdemo` over the pure `Step` functions in `internal/algo/{gcra,tokenbucket,slidingwindow}` (GCRA: `gcra.Step(state, limit.Params, cost, nowUS)`). One call simulates a traffic pattern (steady, burst, ramp, attack; seeded) through all three algorithms with the same limit and returns per-bucket allowed/denied series. UI: pick pattern + limit + burst, SVG chart of the three side by side, totals per algorithm.
Done when: ratelimitd gate green with the bridge and its handler test; pinned and built here; project page live with demoChecks proving three series rendered; screenshots reviewed at both widths.

### D2 edgecache: freshness timeline · order 11 · deps: S1 · status: todo
Bridge over `internal/rfc9111` (the real freshness/validation logic). Visitor edits response headers (`Cache-Control`, `Age`, `Expires`, `ETag`, `Vary`) and request headers, then scrubs a clock; each request shows hit / stale / must-revalidate / miss with the RFC 9111 reason. Presets: max-age, s-maxage, stale-while-revalidate, no-cache, Vary.
Size risk: `rfc9111` takes `http.Header`, so the bridge imports `net/http`; measure the gzipped binary before building the UI and stop if it breaks the 2 MiB budget (options: TinyGo, or a budget decision in PLAN.md).
Done when: as D1, with a demoCheck that a preset produces the expected outcome sequence.
Size probe (2026-10-24): a minimal js/wasm main importing `internal/rfc9111` + `net/http` + `encoding/json` built to 6,555,043 bytes, 1,819,664 gzipped (measured), under the 2 MiB budget with ~270 KB to spare. Keep the bridge to rfc9111 only.

### D3 jobrun: cron and backoff · order 12 · deps: S1 · status: todo
Bridge over `internal/cronx` (parse + next) and the retry backoff from `job.Policy` (`internal/job`; find the function that computes the next delay, do not reimplement). Visitor types a cron expression and a start time and sees the next 10 runs, or fails a job N times and sees the backoff schedule.
Done when: as D1; parse errors show the parser's own message.

### D4 kvlite: live store · order 13 · deps: S1 · status: todo
Browser Go has no filesystem and kvlite has no filesystem seam today. First: in kvlite, add the smallest file-system interface that keeps the on-disk default unchanged (own PR, kvlite gate + benchmarks show no regression, measured). Then a bridge over an in-memory implementation: put/delete/get, segment list with live/dead bytes, compaction.
Done when: as D1, plus the kvlite benchmark table is re-measured and still true. If the seam would hurt the library, mark this `blocked` with the reason instead.

### Q0 quorum: simulator stepper · order 20 · deps: S1 · status: todo
`internal/sim.Run` has no per-tick hook. Add a stepper in package `sim` (it needs the unexported cluster) that exposes: new(seed, nodes), tick(n), crash(id), restart(id), isolate(id), heal(), propose(value), and a state snapshot (per node: up, state, term, lead, committed, applied, last index; plus in-flight messages). It must reuse `runTick`/`faults` logic, not fork it, and a test must show the stepper and `Run` produce the same trace for the same seed and no manual actions.
Done when: quorum gate green (including `go test ./internal/sim -seeds 10000`), pushed.

### D5 quorum: Raft cluster you can break · order 21 · deps: Q0 · status: todo
Bridge `cmd/webdemo` over the stepper. Build needs the kvlite sibling (`siblings` in the lock). UI: five nodes in a ring, role and term on each, messages in flight, log bars with the commit index; buttons for crash leader, partition, heal, propose, step and play (play off when reduced motion is set). The page says plainly that this is the real quorum consensus code and that the source is private.
Before building: quorum and its kvlite import still use the old `github.com/corbettjouett00-sudo/...` module paths, which would be embedded in the public binary. Rename both to `github.com/crowbett/...` first (own commits, gates green).
Done when: as D1; demoCheck: crash the leader, step, and a new leader with a higher term appears.

### C1 Role line vs Rust projects · order 14 · deps: none · status: todo
Requested by the design session (2026-10-24). The home kicker and every page's description print `Owner.Role` = "Backend engineer (Go)" (`internal/site/build.go`), while keel, codegraph and strata are Rust (strata also Swift). Decide whether the role should name both languages; the design shows it as a small label above the hero, so any short phrase fits.
Done when: the role line is true for every project the site shows.

### C2 ratelimitd ui.css uses retired tokens · order 15 · deps: none · status: todo
Requested by the design session (2026-10-24). `web/demos/ratelimitd/ui.css` (247c22f) reads `--muted` and `--code-bg`, which V2 replaced; both are undefined, so the "denied" legend swatch and bars lose their colour and the chart wells have no background. Use `--text-2` (or `--text-3`) for muted text and fills and `--sunken` for wells; docs/demo-contract.md now lists the tokens demos may use.
Done when: ratelimitd's ui.css uses only tokens listed in the contract and its screenshots show the denied bars and legend swatch in both schemes.

## Rust demos

### R0 Rust build path · order 30 · deps: D1 · status: todo
Extend `cmd/wasm` with a `kind` per demo (`go` default, `rust`): `cargo build --release --target wasm32-unknown-unknown` from the exported tree using the repo's `rust-toolchain.toml`, no wasm-bindgen. Bridge ABI: exports `alloc(len) -> ptr`, `call(method_ptr, method_len, params_ptr, params_len) -> ptr` returning a length-prefixed JSON buffer, `free`. `demo-worker.js` picks the loader by kind (the lock can be emitted as `/wasm/manifest.json`). Same JSON contract, same `{"error"}` rule. A Rust smoke demo proves it in e2e.
Done when: a Rust smoke binary passes e2e alongside the Go one, and docs/demo-contract.md documents the Rust bridge.

### D6 strata: slice in the browser · order 31 · deps: R0 · status: todo
Bridge over strata's Rust slicing core (not the Swift app): load a bundled small STL (or one the visitor picks; parse in Rust), slice with default settings, return layer paths; UI scrubs layers on a canvas and shows layer count and slice time. No claim about print quality (the real print is still pending in strata's PLAN).
Done when: as D1, built from a pinned strata commit.

### D7 codegraph: who calls this · order 32 · deps: R0 · status: todo
Spike first: can codegraph's parsers (likely tree-sitter, which has C code) build for wasm32? If not in a day, mark `blocked` with what failed. If yes: index a small bundled sample repo and answer callers/callees queries.
Done when: as D1, or `blocked` with evidence.

### D8 keel: simulation in the browser · order 33 · deps: R0 · status: todo
Spike: run keel's deterministic simulator for one small seed in wasm32 and stream the trace. Show a seed replaying bit for bit (run twice, same digest) and a fault schedule.
Done when: as D1, or `blocked` with evidence.

## Design track

Owner: the design session. It owns `templates/`, `web/assets/` (site.css, demo.js loading/error UX, icons, fonts, images), the home and project page layout, `docs/design.md`, and the page-level e2e checks. It does not touch project repos, `web/demos/<slug>/ui.js`, `wasm/`, `demos.lock.json` or project copy. The `demo-*` class names and the `mount(el, demo)` contract are shared: change them only together with `docs/demo-contract.md`, without breaking live demos.

### V1 Design direction · order 100 · deps: S1 · status: done 2026-10-24 (2e61260)
Study 10+ standout engineer portfolios and product sites (name each and what it does well). Write `docs/design.md`: the one-sentence feel, type scale, color tokens for light and dark, spacing, radius, motion rules (durations, easing, reduced motion), the demo frame, and what we will not do.
Done when: design.md exists and every later V task cites it.

### V2 Foundation: type, tokens, themes · order 101 · deps: V1 · status: done 2026-10-24 (550ee15)
Implement design.md §Type, §Colour, §Space in site.css (a self-hosted variable woff2 is allowed if it earns its bytes; subset it, `font-display: swap`, budget recorded in PLAN.md). Light and dark both first-class; no theme toggle (design.md §Colour). e2e shoots both schemes so light is reviewed too.
Done when: every page matches design.md in both themes at 390 and 1280 px, screenshots reviewed.

### V3 Home page · order 102 · deps: V2 · status: done 2026-10-24 (9f7c55c; split: the "would remember" verdict moved to V3b)
Per design.md §Feel and §References (Maggie Appleton's sentence hero, samwho's mechanism cards): a hero that says who and what in one look, and a project grid where each card shows what the project does visually (SVG diagram or static capture per project, not a stock icon), with live/planned state honest.
Done when: a fresh-eyes reviewer (V8 method) rates it "would remember this site" and the screenshots back it.
Carry-over from V2 review: the name appears twice at the top (brand and h1); "Demo coming" and "Private source" pills look identical.

### V3b Home page memorable · order 104.5 · deps: V5 · status: todo
Split from V3 on 2026-10-24. After three fresh-eyes rounds V3 has no MAJOR findings, but the verdict is "maybe, leaning yes": below the hero it is still a familiar card layout (design.md decisions log). The lever left is motion in the diagrams (samwho's thumbnails are memorable because they move), which is V5's. When V5 lands, re-run the V8 method on home.
Done when: a fresh-eyes reviewer rates home "would remember this site" (yes, not maybe) and the screenshots back it.

### V4 Project page and demo frame · order 103 · deps: V2 · status: done 2026-10-24 (this commit)
Per design.md §Demo frame and §Space (metadata gutter): header, metric presentation with its source, body typography, and one consistent demo frame for every demo: title bar, size, loading progress with real bytes (stream the fetch), clear error state with retry, focus handling. Works for planned and live projects.
Done when: smoke demo shows real byte progress and a styled error (force one in e2e), screenshots reviewed.
Carry-over from V2 review (design.md decisions log): the metric box and the planned-demo notice stack as two boxes; a metric source with a command (`go test ./internal/sim -seeds 10000`) wraps after its hyphen on phones.

### V5 Motion and feel · order 104 · deps: V3, V4 · status: todo
Per design.md §Motion: micro-interactions that make it feel crafted: hover/focus states, page-load reveal, card transitions, demo start transition. CSS-first, ≤ 200 ms for UI feedback, all off under `prefers-reduced-motion`. No layout shift.
Done when: e2e asserts CLS = 0 on every page and no animation runs with reduced motion emulated.

### V6 Quality gates · order 105 · deps: V2 · status: todo
In e2e: both color schemes (absorbs old P1), WCAG AA contrast on the text/ground pairs in design.md §Colour, an accessibility scan (vendor axe-core into e2e/testdata, test-only, never shipped), keyboard tab order reaches every control with a visible focus ring, LCP and CLS budgets from the Performance API, and no request leaves the origin. CI stays under 60 s.
Done when: all of those run in `make e2e` and pass, and a deliberately broken case fails each one once.

### V7 Share and meta · order 106 · deps: V3 · status: todo
`og:image` per page (absorbs old P2): static PNGs made once from design.md's type and colour (render with headless Chrome in a `cmd/` tool, commit the PNGs), ≤ 100 KB each, checked by `site check`. Favicon set, theme-color in both schemes, a good 404.
Done when: links pasted into iMessage/Slack/Discord preview well (check the tags with a validator page), site check enforces the image budget.

### V8 Fresh-eyes review · order 107 · deps: V5, V6, V7 · status: todo
Give a reviewer agent only the screenshots (no code, no design.md; the findings are then checked against design.md §What we will not do) and ask it to critique like a senior product designer: first impression, hierarchy, type, spacing, color, consistency, what looks amateur. Fix every major finding, re-shoot, repeat until a round returns no major findings.
Done when: two consecutive rounds have no major findings; findings and fixes logged in design.md.

## Owner only

### U1 Make more repos public · status: user
The owner said more repos should go public later. Never change visibility. When the owner names a repo, update its page (`repo:` URL, drop "private source") in the same commit they approve.

### U2 Custom domain · status: user
### U3 Showcase platform for other developers · status: user
Parked: no proven paid demand (docs/research.md). Only revisit on the owner's say-so.
