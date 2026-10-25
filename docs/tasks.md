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

### F2 CI wall clock has no headroom · order 7 · deps: none · status: done 2026-10-24 (1117599, fc20758, 15f7905)
Measured 2026-10-24: after D2 (4a78b9c) the Pages job took 61 s (e2e 30.9 s). Two fixes went in: `-parallel 12` (82ecd2e; e2e on the PR workflow 13.9 / 21.3 / 14.4 s) and opening tabs one at a time (this commit; locally TestSite 10.5-12.5 s against 19.9-31.0 s). On CI the spread stays wide: the same commit ran e2e in 15.6 s and 27.2 s (Pages jobs 40 s and 59 s), and on some runners every browser test starts ~9 s late (TestDemoFrame 11.7 s against 2.8 s), which looks like a cold Chrome start. Skipping screenshots on CI showed no clear gain (e2e 28.3 / 24.8 / 20.7 s). Fixed cost outside e2e is ~22 s (setup-go 8-11 s downloads Go 1.27 each run, deploy 7 s). Ideas: one shared Chrome for all e2e tests, fewer duplicate demo boots, caching the Go toolchain.
Go toolchain from go.dev plus a build cache (348bab6) took setup from 8-11 s to 2-3 s. Ten dispatched Pages runs after it (348bab6 ×4, 2f52864 ×6): 46, 48, 50, 45, 73, 40, 47, 55, 54, 64 s, so 2 of 10 over. The spread is e2e alone: on 2f52864 one run took 48.3 s in e2e and the next 21.1 s. One Chrome and one site build for the whole e2e package (this commit), against main, four PR runs each with `-v` (PRs #4, #5): jobs 43 / 31 / 40 / 34 s (e2e 27.4 / 21.2 / 24.2 / 21.4 s) against 33 / 49 / 50 / 45 s (e2e 18.1 / 36.9 / 35.3 / 31.9 s). In three of four main runs every test that started its own Chrome began ~18-25 s late (TestDemoFrame 18.2-24.6 s against 0.9-1.3 s shared).
Done when: ten consecutive Pages runs finish under 60 s, timings listed here.
Shared Chrome landed (1117599), but ten dispatched Pages runs after it still spread 40-73 s (55, 73, 53, 41, 48, 42, 63, 56, 40, 72 s; e2e 19.6-50.8 s). PR experiments with `-v` (#6 `-parallel 12`, #7 `-parallel 6`, six runs each, 4-vCPU Xeon 8573C runners): TestSite took 14-20 s in both, while e2e minus TestSite (TestMain, mostly the Chrome cold start) ranged ~1-20 s, so parallelism is not the lever. fc20758 starts Chrome in a background step before checkout to warm the disk cache, and TestMain builds the site while Chrome launches: eight PR runs (#8) took 25-37 s (e2e 13.2-23.5 s). One of them failed TestDemoFailures: the call after a timeout rejected after 227 ms against a 100 ms limit, though `send()` rejects synchronously; the main thread was busy. 15f7905 replaced the wall-clock limit with a stricter, load-independent check: the rejection must settle before a zero-delay timer fires. Eleven consecutive Pages runs from 15f7905 on (two pushes, nine dispatches): 40, 41, 40, 49, 52, 45, 41, 44, 53, 51, 39 s, all under 60 s. The slowest of them left 7 s of headroom.

### F3 Local e2e stalls as a whole under machine load · order 8 · deps: F2 · status: blocked (needs the next local stall, caught by the logging below)
Seen 2026-10-24, locally only. Two of ~10 local runs failed together: every TestSite tab hit the 90 s deadline, pages without a demo as well (keel, home), with load averages of ~26 and ~12-17 from other processes (measured with `uptime`). The next run passed in 12-15 s. None of the 11 consecutive Pages runs in F2 or the 20 PR runs on #6-#8 did this. `newTab` starts the 90 s clock before it waits for `tabMu`, so a single stalled `Target.createTarget` in the shared Chrome runs out every queued test's clock. Why Chrome stalls is not known. Next step: log per-tab open time and Chrome's own stderr on the next stall, then decide whether to start the deadline after the lock, put a timeout on opening a tab, or relaunch Chrome.
Done when: the cause is named with evidence and fixed, or ten local runs under load (above 10) pass.
Instrumented (this commit): `newTab` logs any tab that takes over 5 s to open, with its wait for the lock, and locally Chrome's own output goes to `$TMPDIR/crowbett-e2e-chrome.log`, whose path is printed when a run fails. A passing run already logs repeated `CVDisplayLinkCreateWithCGDisplay failed` errors from Chrome's macOS display code. One hypothesis, not tested: frame scheduling stalls when no display link is available, for example while the display sleeps.

## Go demos (one bridge each, see docs/demo-contract.md)

### D1 ratelimitd: algorithm race · order 10 · deps: S1 · status: done 2026-10-24 (ratelimitd b730ede, f5d5c37, 2420562, 6a63fcb; site 05c9267; Pages job 45 s)
Bridge in `~/dev/ratelimitd/cmd/webdemo` over the pure `Step` functions in `internal/algo/{gcra,tokenbucket,slidingwindow}` (GCRA: `gcra.Step(state, limit.Params, cost, nowUS)`). One call simulates a traffic pattern (steady, burst, ramp, attack; seeded) through all three algorithms with the same limit and returns per-bucket allowed/denied series. UI: pick pattern + limit + burst, SVG chart of the three side by side, totals per algorithm.
Done when: ratelimitd gate green with the bridge and its handler test; pinned and built here; project page live with demoChecks proving three series rendered; screenshots reviewed at both widths.

### D2 edgecache: freshness timeline · order 11 · deps: S1 · status: done 2026-10-24 (edgecache c0e5efd, 373b43d; site: this commit)
Bridge over `internal/rfc9111` (the real freshness/validation logic). Visitor edits response headers (`Cache-Control`, `Age`, `Expires`, `ETag`, `Vary`) and request headers, then scrubs a clock; each request shows hit / stale / must-revalidate / miss with the RFC 9111 reason. Presets: max-age, s-maxage, stale-while-revalidate, no-cache, Vary.
Size risk: `rfc9111` takes `http.Header`, so the bridge imports `net/http`; measure the gzipped binary before building the UI and stop if it breaks the 2 MiB budget (options: TinyGo, or a budget decision in PLAN.md).
Done when: as D1, with a demoCheck that a preset produces the expected outcome sequence.
Size probe (2026-10-24): a minimal js/wasm main importing `internal/rfc9111` + `net/http` + `encoding/json` built to 6,555,043 bytes, 1,819,664 gzipped (measured), under the 2 MiB budget with ~270 KB to spare.
Decision (2026-10-24): drive the real engine (`internal/cache` over `internal/memstore`) instead of bare rfc9111, because the orchestration that turns a policy decision into HIT/STALE/REVALIDATED (`metaFor`, `refreshedMeta`) is unexported and copying it would be reimplementation. Probe of engine + memstore + json: 7,204,662 bytes, 1,992,498 gzipped (measured), ~104 KB under budget. The finished bridge came out at 2,176,744 gzipped (lock entry), over 2 MiB: budget raised to 2.25 MiB, decision and measurements in PLAN.md. The bridge found an engine bug: a miss sent `Age: 0` instead of the origin's corrected age (fixed in edgecache c0e5efd).

### D3 jobrun: cron and backoff · order 12 · deps: S1 · status: done 2026-10-24 (jobrun 9eef3d2, d8d00c4; site: this commit)
Bridge over `internal/cronx` (parse + next) and the retry backoff from `job.Policy` (`internal/job`; find the function that computes the next delay, do not reimplement). Visitor types a cron expression and a start time and sees the next 10 runs, or fails a job N times and sees the backoff schedule.
Done when: as D1; parse errors show the parser's own message.

### D4 kvlite: live store · order 13 · deps: S1 · status: done 2026-10-24 (kvlite 327ca18, 22a4489, 7a97ccf; site: this commit)
Rewritten 2026-10-24: the original assumption was wrong. Browser Go does have a filesystem hook: js/wasm sends every `os` file call to `globalThis.fs`, which is ENOSYS only because nothing provides it. A site-owned in-memory `fs` (`web/assets/memfs.js`) runs kvlite unchanged, so no seam is added and the library and its benchmark table (measured on the README's machine) stay as they are. memfs was validated by running kvlite's own test suite as js/wasm under Node: all pass except four tests whose goroutines spin without blocking (wasm is cooperative) and two that read testdata from disk (measured). Bridge: put/delete/get, compact, crash (drop without Close, remove the O_EXCL LOCK file, tear N bytes off the active segment, reopen), reset; every segment decoded with `segment.OpenReader`, store-wide live/dead bytes from `Stats` (per-segment liveness needs the internal keydir, i.e. reimplementation), the engine's own slog lines. The store's clock is simulated (`WithClock`), so the same clicks write the same bytes.
Done when: as D1; a torn crash shows kvlite's own recovery log line.

### Q0 quorum: simulator stepper · order 20 · deps: S1 · status: todo
`internal/sim.Run` has no per-tick hook. Add a stepper in package `sim` (it needs the unexported cluster) that exposes: new(seed, nodes), tick(n), crash(id), restart(id), isolate(id), heal(), propose(value), and a state snapshot (per node: up, state, term, lead, committed, applied, last index; plus in-flight messages). It must reuse `runTick`/`faults` logic, not fork it, and a test must show the stepper and `Run` produce the same trace for the same seed and no manual actions.
Done when: quorum gate green (including `go test ./internal/sim -seeds 10000`), pushed.

### D5 quorum: Raft cluster you can break · order 21 · deps: Q0 · status: todo
Bridge `cmd/webdemo` over the stepper. Build needs the kvlite sibling (`siblings` in the lock). UI: five nodes in a ring, role and term on each, messages in flight, log bars with the commit index; buttons for crash leader, partition, heal, propose, step and play (play off when reduced motion is set). The page says plainly that this is the real quorum consensus code and that the source is private.
Before building: quorum and its kvlite import still use the old `github.com/corbettjouett00-sudo/...` module paths, which would be embedded in the public binary. Rename both to `github.com/crowbett/...` first (own commits, gates green).
Done when: as D1; demoCheck: crash the leader, step, and a new leader with a higher term appears.

### C1 Role line vs Rust projects · order 14 · deps: none · status: done 2026-10-24 (this commit)
Requested by the design session (2026-10-24). The home kicker and every page's description print `Owner.Role` = "Backend engineer (Go)" (`internal/site/build.go`), while keel, codegraph and strata are Rust (strata also Swift). Decide whether the role should name both languages; the design shows it as a small label above the hero, so any short phrase fits.
Done when: the role line is true for every project the site shows.
Decision: "Software engineer (Go, Rust)". Five projects are Go and three are Rust, so both languages are named. "Backend" was dropped because strata is an iPad slicer, not a backend. Swift (strata's UI) is left out to keep the label short; it is listed on strata's own page. Only the home share card prints the role, so it alone was regenerated.

### C2 ratelimitd ui.css uses retired tokens · order 15 · deps: none · status: done 2026-10-24 (this commit)
Requested by the design session (2026-10-24). `web/demos/ratelimitd/ui.css` (247c22f) reads `--muted` and `--code-bg`, which V2 replaced; both are undefined, so the "denied" legend swatch is invisible, denied bars fall back to black at 35% opacity, and the chart wells have no background. Use `--text-2` (or `--text-3`) for muted text and fills and `--sunken` for wells; docs/demo-contract.md now lists the tokens demos may use.
Done when: ratelimitd's ui.css uses only tokens listed in the contract and its screenshots show the denied bars and legend swatch in both schemes.
`--muted` and `--code-bg` were already gone on main (now `--text-3` and `--sunken`); the file still read `--sp-1..4`, `--t-label` and `--t-small`, now their literal values. The build now fails when a demo's ui.css reads a property that is neither a contract token nor defined in that file (`DemoTokens`, internal/site/check.go); all five demos pass.

### C3 edgecache: label the scrolling table · order 16 · deps: none · status: done 2026-10-24 (this commit)
Requested by the design session (2026-10-24). V6's axe scan found `.ec-scroll` (web/demos/edgecache/ui.js) scrolls sideways at 390 px with no keyboard access (WCAG 2.1.1). The frame now makes overflowing scroll boxes focusable and names them "Scrollable area" (docs/demo-contract.md §Frame); a real name is better.
Done when: `.ec-scroll` carries an `aria-label` that names its content (e.g. "Request log").
`.ec-scroll` is labelled "Request log", checked in e2e at both widths. The sweep found the frame skipped `role="region"` whenever a box brought its own label, which left jobrun's labelled `.jr-scroll` a focusable div with no role; the frame now adds the role to any scroll box without one.

### C4 strata card has no evidence line · order 17 · deps: none · status: todo
Requested by the design session (2026-10-24, V3b review). strata is the only card without a `metric`, so its card has an empty slot where every other card states evidence. If strata's repo has a measured, sourced number (slice time for a reference model, layer count, binary size), add it with `metric_source`; otherwise leave it and say so here.
Done when: strata has a sourced metric, or this task records that none exists yet.

### C5 One line of what each live demo lets you do · order 18 · deps: none · status: todo
Requested by the design session (2026-10-24, V3b review round 3). The reviewer asked for each live card on home to say what a visitor can do in the demo ("Fire 1,000 requests and watch the limit hold", say), so the two demos read as things to try, not just projects. That is project copy, so it is the demo track's: add an optional one-line front-matter field (e.g. `demo_try`) to each live project, true to what its UI does. The design session will render it on the feature card once the field exists.
Done when: every live project has the field, and a design-track task to render it is filed.

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

### V3b Home page memorable · order 104.5 · deps: V5 · status: doing (4f944f0, a4da0df, 7f2f2f5; round 4 pending)
Split from V3 on 2026-10-24. After three fresh-eyes rounds V3 has no MAJOR findings, but the verdict is "maybe, leaning yes": below the hero it is still a familiar card layout (design.md decisions log). The lever left is motion in the diagrams (samwho's thumbnails are memorable because they move), which is V5's. When V5 lands, re-run the V8 method on home.
Done when: a fresh-eyes reviewer rates home "would remember this site" (yes, not maybe) and the screenshots back it.

### V4 Project page and demo frame · order 103 · deps: V2 · status: done 2026-10-24 (aaf4500)
Per design.md §Demo frame and §Space (metadata gutter): header, metric presentation with its source, body typography, and one consistent demo frame for every demo: title bar, size, loading progress with real bytes (stream the fetch), clear error state with retry, focus handling. Works for planned and live projects.
Done when: smoke demo shows real byte progress and a styled error (force one in e2e), screenshots reviewed.
Carry-over from V2 review (design.md decisions log): the metric box and the planned-demo notice stack as two boxes; a metric source with a command (`go test ./internal/sim -seeds 10000`) wraps after its hyphen on phones.

### V5 Motion and feel · order 104 · deps: V3, V4 · status: done 2026-10-24 (5671275)
Per design.md §Motion: micro-interactions that make it feel crafted: hover/focus states, page-load reveal, card transitions, demo start transition. CSS-first, ≤ 200 ms for UI feedback, all off under `prefers-reduced-motion`. No layout shift.
Done when: e2e asserts CLS = 0 on every page and no animation runs with reduced motion emulated.

### V6 Quality gates · order 105 · deps: V2 · status: done 2026-10-24 (3a6f572, d793f4a)
In e2e: both color schemes (absorbs old P1), WCAG AA contrast on the text/ground pairs in design.md §Colour, an accessibility scan (vendor axe-core into e2e/testdata, test-only, never shipped), keyboard tab order reaches every control with a visible focus ring, LCP and CLS budgets from the Performance API, and no request leaves the origin. CI stays under 60 s.
Done when: all of those run in `make e2e` and pass, and a deliberately broken case fails each one once.

### V7 Share and meta · order 106 · deps: V3 · status: done 2026-10-24 (d77b0f2)
`og:image` per page (absorbs old P2): static PNGs made once from design.md's type and colour (render with headless Chrome in a `cmd/` tool, commit the PNGs), ≤ 100 KB each, checked by `site check`. Favicon set, theme-color in both schemes, a good 404.
Done when: links pasted into iMessage/Slack/Discord preview well (check the tags with a validator page), site check enforces the image budget.

### V8 Fresh-eyes review · order 107 · deps: V5, V6, V7 · status: todo
Give a reviewer agent only the screenshots (no code, no design.md; the findings are then checked against design.md §What we will not do) and ask it to critique like a senior product designer: first impression, hierarchy, type, spacing, color, consistency, what looks amateur. Fix every major finding, re-shoot, repeat until a round returns no major findings.
Done when: two consecutive rounds have no major findings; findings and fixes logged in design.md.

### V9 Project-specific drawings for edgecache and jobrun · order 108 · deps: V3b · status: todo
Round 7 of the home review: edgecache (client, cache, origin) and jobrun (queue, workers) are textbook box-and-arrow drawings that say nothing only this project does, unlike ratelimitd's Redis fallback, kvlite's active segment or quorum's partitioned follower. Draw one behaviour each project's page states (read the page copy first; the drawing must not claim what the page does not), in the shared outline vocabulary, with the same once-on-view motion.
Done when: each drawing shows a behaviour quoted from its project page, and a fresh-eyes reviewer names it without being told.

## Owner only

### U1 Make more repos public · status: user
The owner said more repos should go public later. Never change visibility. When the owner names a repo, update its page (`repo:` URL, drop "private source") in the same commit they approve.

### U2 Custom domain · status: user
### U3 Showcase platform for other developers · status: user
Parked: no proven paid demand (docs/research.md). Only revisit on the owner's say-so.
