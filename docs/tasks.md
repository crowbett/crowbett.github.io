# Tasks

The work queue as a dependency graph. A task is **ready** when its status is `todo` and every task in `deps` is `done`; pick the ready task with the lowest `order`. Statuses: `todo`, `doing`, `done`, `blocked (reason)`, `user` (owner only; never start one).

**Tracks:** tasks under "Design track" belong to the design session (`docs/design-loop-prompt.md`), everything else to the demo session (`docs/loop-prompt.md`). Each session picks only from its own track; cross-track requests go in as new `todo` tasks in the other track.

When a task is finished, set it `done` with the date and commit SHA(s) and collapse it to its heading. Split a task that turns out bigger into new ids before continuing. New tasks go at the bottom of their track as `todo` with deps and a done-when line. Full histories of done tasks are in git (`git log -p docs/tasks.md`).

## Ship

### S1 First deploy · status: done 2026-10-24 (aa3fc49, cd7a0a3)
### S2 Measure wasm delivery · status: done 2026-10-24 (Pages gzips .wasm; see docs/research.md)

## Fixes

### E0 edgecache README claim · status: done 2026-10-24 (edgecache e04f3da, site b931dea)
### F1 CI e2e over 60 s · status: done 2026-10-24 (db0574a)
e2e names `google-chrome` on CI: ubuntu-24.04's `/usr/bin/chromium` cold-starts in 25 s against 1.3 s (measured).
### F2 CI wall clock has no headroom · status: done 2026-10-24 (348bab6, 1117599, fc20758, 15f7905)
One shared Chrome and one site build for the whole e2e package, because each extra Chrome cost a cold start on CI; Go toolchain from go.dev plus a build cache.
### F3 Local e2e stalls as a whole under machine load · status: done 2026-10-24 (9b830b7, aa1006b)
Cause: the shared Chrome's GPU process on macOS hung ~2 min and blocked every tab; e2e Chrome runs with `chromedp.DisableGPU` (`E2E_GPU=1` opts back in locally). `newTab` logs tabs slower than 5 s and Chrome's log goes to `$TMPDIR/crowbett-e2e-chrome.log`.
### F5 CI wall clock headroom · status: done 2026-10-25 (548204e, ebb80af, 5ba749a, 94430bd, 82e7554, 500d9ba)
Binaries gzip concurrently and `site.Check` runs as its own test; gate and e2e run under `make -j8` with the gate at `nice -n 10`; idle tabs are reused across page visits; the Tab walk pauses the animation timeline (a 15-25 s key-event stall); demo checks share one 20 s `until` that names the condition that never held.
### F6 Opening the site freezes the laptop · status: done 2026-10-25 (a0b1a56)
Cause: a keyframe scaling a `vector-effect: non-scaling-stroke` shape to exactly 0 pinned the GPU (bisected, measured). `site.Check` rejects any zero-factor scale in built CSS, HTML or JS.

## Go demos (one bridge each, see docs/demo-contract.md)

### D1 ratelimitd: algorithm race · status: done 2026-10-24 (ratelimitd b730ede, f5d5c37, 2420562, 6a63fcb; site 05c9267)
### D2 edgecache: freshness timeline · status: done 2026-10-24 (edgecache c0e5efd, 373b43d; site 4a78b9c)
Drives the real engine (`internal/cache` over `internal/memstore`), not bare rfc9111; the budget raise it forced is recorded in PLAN.md.
### D3 jobrun: cron and backoff · status: done 2026-10-24 (jobrun 9eef3d2, d8d00c4; site fe20f70)
### D4 kvlite: live store · status: done 2026-10-24 (kvlite 327ca18, 22a4489, 7a97ccf; site 82aa6f1)
kvlite runs unchanged on the site-owned in-memory `fs` (`web/assets/memfs.js`).

### Q0 quorum: simulator stepper · order 20 · deps: S1 · status: blocked (quorum archived on GitHub; needs U4)
`internal/sim.Run` has no per-tick hook. Add a stepper in package `sim` exposing new(seed, nodes), tick(n), crash(id), restart(id), isolate(id), heal(), propose(value) and a state snapshot (per node: up, state, term, lead, committed, applied, last index; plus in-flight messages). It must reuse `runTick`/`faults`, not fork them, and a test must show the stepper and `Run` give the same trace for the same seed with no manual actions.
Done when: quorum gate green (including `go test ./internal/sim -seeds 10000`), pushed.
Built 2026-10-24, committed locally in quorum, not pushed: 3c5e606 (follows kvlite's rename to `github.com/crowbett/kvlite`) and 3f92d9f (`internal/sim/stepper.go`; `TestStepperMatchesRun` seeds 1-40, `TestStepperRandomActions` 10,000 seeds). Gate green. The push was refused because the repo is archived (2026-10-20); unarchiving waits for the owner (U4).

### D5 quorum: Raft cluster you can break · order 21 · deps: Q0 · status: todo
Bridge `cmd/webdemo` over the stepper; the build needs the kvlite sibling (`siblings` in the lock). UI: five nodes in a ring with role and term, messages in flight, log bars with the commit index; buttons for crash leader, partition, heal, propose, step and play (play off under reduced motion). The page says plainly that this is the real quorum consensus code and the source is private.
Before building: quorum and its kvlite import still use the old `github.com/corbettjouett00-sudo/...` module paths, which would be embedded in the public binary. Rename both to `github.com/crowbett/...` first (own commits, gates green).
Done when: quorum gate green with the bridge and its handler test; pinned and built here; project page live with a demoCheck that crashes the leader, steps, and sees a new leader with a higher term; screenshots reviewed at both widths.

### C1 Role line vs Rust projects · status: done 2026-10-24 (c00be3c)
Role is "Software engineer (Go, Rust)".
### C2 ratelimitd ui.css uses retired tokens · status: done 2026-10-24 (fe56e52)
The build fails when a demo's ui.css reads a property that is neither a contract token nor its own (`DemoTokens`).
### C3 edgecache: label the scrolling table · status: done 2026-10-24 (8c66c51)
### C4 strata card has no evidence line · status: done 2026-10-24 (a485bc6)
strata quotes mesh repair, not slice time: its docs/features.md timings do not record the machine.
### C5 One line of what each live demo lets you do · status: done 2026-10-24 (35013dd)
`demo_try` is required on a live project and rejected on any other.

## Rust demos

### R0 Rust build path · status: done 2026-10-24 (17be7cf)
### D6 strata: slice in the browser · status: done 2026-10-24 (strata 9269224, 8996fe6; site f56b996)
A large visitor model breaks the contract's ~50 ms per call (Benchy 3.0 s in Node, measured); the worker's 30 s timeout reports it.
### D7 codegraph: who calls this · status: done 2026-10-25 (codegraph 9bd9b13; site 9bd5964)
The resolver runs unchanged on bundled SQLite in memory. First call ~76 ms, over the contract's ~50 ms (measured in Node).
### D8 keel: simulation in the browser · status: done 2026-10-25 (keel 829c328, d2780b4, 6a456cb; site 9ca1dd0)
### D8b Re-pin keel after PR #5 lands · status: done 2026-10-25 (keel 4e92a7d; site 156c464)
### D6b Re-pin strata after PR #219 lands · status: done 2026-10-25 (strata 532b801; site 13bb426)
### D7b Re-pin codegraph after PR #1 lands · status: done 2026-10-25 (codegraph 0dbef57; site 2b1506b)
### F4 CSS budget headroom · status: done 2026-10-25 (bab8955, 54ebd9d; decision in PLAN.md)

## Wave 2 demos (2026-11-08, each with a `webdemo` PR in its repo)

### D9 lobby: matchmaking floor · status: done 2026-11-08 (lobby 3ed17da, PR #1; site 187bbbc)
### D10 raytracer: split-view sampling · status: done 2026-11-08 (raytracer e79a188, PR #1; site 0a8db95)
Adds the `cpp` kind to `cmd/wasm` (wasi-sdk 34.0 via `make wasi-sdk`; no imports allowed).
### D11 grepall: trigram search over Go's source · status: done 2026-11-08 (grepall e2806b0, PR #1; site 0335505)
2,244,121 B gzip against the 2,359,296 B wasm budget: no room left for a bigger corpus.
### D12 mcpbridge: protocol era translator · status: done 2026-11-08 (mcpbridge 5cc4eb5, PR #5; site 7bcab80)
### D13 netcode: rollback arena · status: done 2026-11-08 (netcode 8f311f5, PR #1; site 6d39eb2)
### D14 stash: encrypted dedup backups · status: done 2026-11-08 (stash 35f7189, PR #1; site c7e248a)
### D15 btrv: page map and export · status: done 2026-11-08 (btrv 0519b75, PR #3; site 5f1b16a)
Product teaser: the LICENSE stays proprietary and the page never draws on btrv's business or legal docs.

### P1 Re-pin wave 2 after their PRs land · status: done 2026-11-09 (all seven merged with merge commits; GitHub compare shows each pin behind_by=0 from main, so no re-pin)
Every pin above is a PR head. A merge commit keeps it reachable from main; a squash or rebase merge needs a re-pin to the merged commit (`go run ./cmd/wasm pin <slug> <sha>`, `make wasm`), as D6b-D8b did.
Done when: each of the seven pins is an ancestor of its repo's main.

### F8 CI over 60 s at 15 projects · status: done 2026-11-08 (e53cc6d and the e2e commits before it)
One job ran gate and e2e at ~55 s plus ~10 s of upload and deploy. Now `gate` and three `e2e` shards (`E2E_SHARD=i/3`) run on separate runners and `deploy` waits for them: PR CI wall 37 s (measured). CI skips screenshots and the dark desktop and tablet tabs; tablet tabs check layout only; the slowest tabs start first.

### F7 Does the Tab walk still need its timeline pause · order 37 · deps: none · status: done 2026-11-09 (dropped; draft PRs #16, #17)
From F6: the home Tab walk's 15-25 s stalls (F5) and the GPU freeze were inferred to be the same fault, so the walk may be fast without F5's animation-timeline pause. Not measured on CI.
Done when: three `ci` runs with the pause removed are timed and the pause is kept or dropped on that evidence, recorded here.
Result (measured, three CI runs each, 21 walks per run): with the pause, all walks took 42.6-50.2 s per run, the longest 6.6 s, slowest shard 32-37 s; without it, 45.4-50.7 s, the longest 6.4 s, slowest shard 30-34 s. No 15-25 s stall either way, so the pause and `setPlaybackRate` are gone.

## Open follow-ups (not loop work)

Left open in done tasks; each needs the owner, another repo, or is outside this repo's control.
- F5: Chrome warm-up on CI still depends on runner disk speed; deploy-pages takes 7-14 s and sometimes queues ~40 s in GitHub's `deployment_queued` (F2).
- D7 (codegraph repo): the bench accuracy A/B was not run on the six local-only corpus repos or zustand (`npm install` failed).
- D8 (keel repo): clippy on keel's main fails on `clippy::unused_async_trait_impl`, a lint unknown to clippy 1.96, 1.98.1 and 1.99; keel-web's PR ran with `-A unknown_lints`.
- V11 review (owner call): Doto for the evidence lines too; Doto is a numerals face here and metrics are sentences.
- Wave 2 (owner calls): grepall and stash LICENSE files name the surname; lobby, netcode and raytracer have no LICENSE. mcpbridge's docs/demo.gif predates its 101 / 289/291 numbers. btrv's 2,483,585 rows/s was measured under load (load average ~30); an idle rerun would replace it. stash's `crates/webdemo/.cargo/config.toml` names Homebrew's llvm-ar, so its wasm builds only on this Mac.

## Design track

Owner: the design session. It owns `templates/`, `web/assets/` (site.css, demo.js loading and error UX, icons, fonts, images), the home and project page layout, `docs/design.md` and the page-level e2e checks. It does not touch project repos, `web/demos/<slug>/ui.js`, `wasm/`, `demos.lock.json` or project copy. The `demo-*` class names and the `mount(el, demo)` contract are shared: change them only together with `docs/demo-contract.md`, without breaking live demos.

### V1 Design direction · status: done 2026-10-24 (2e61260)
### V2 Foundation: type, tokens, themes · status: done 2026-10-24 (550ee15)
### V3 Home page · status: done 2026-10-24 (9f7c55c; the "would remember" verdict split to V3b)
### V4 Project page and demo frame · status: done 2026-10-24 (aaf4500)
### V5 Motion and feel · status: done 2026-10-24 (5671275)
### V6 Quality gates · status: done 2026-10-24 (3a6f572, d793f4a)
### V7 Share and meta · status: done 2026-10-24 (d77b0f2)
### V8 Fresh-eyes review · status: done 2026-10-25 (0f0f5c0, 19f6641, 9506d00, 8ebfb10, 7e92c6b; rounds 6 and 7 the two clean rounds in a row)
### V9 Project-specific drawings for edgecache and jobrun · status: done 2026-10-25 (787df98)
### V10 Render demo_try on the live feature cards · status: done 2026-10-24 (6c8fe0f; moved into the demo frame by V11)
### V11 Instrument panel redesign · status: done 2026-10-26 (2cf0801)
### V12 Instrument panel, second pass · status: done 2026-10-26 (26d48ba)

### V3b Home page memorable · order 104.5 · deps: V5 · status: doing (4f944f0, a4da0df, 7f2f2f5, 2f52864, 3cd851f, fc2a0a1, 2c63cc1, c82ef25, b79800e)
V8 rounds 1-7 (2026-10-25) all said "maybe", the last ones "leaning yes for engineers" since the hero re-runs in the browser. What reviewers say is left is owner copy, published identity and the house style.
2026-11-09 review: "maybe" (hook buried in a caption, keys inflate the hero at 1024+, the run climax is weak). Fixed: hook in the headline, keys dropped, measured run time lights a third readout. Next: a fresh-eyes re-review of the shipped page.
Done when: a fresh-eyes reviewer rates home "would remember this site" (yes, not maybe) and the screenshots back it.

### V13 Tighten copy and tablet layout · status: done 2026-11-08 (083e2e3, 7fb2184, 3c2a6e1, 42541b5, e6a9555)
Project pages are bullets plus a demo note with evidence in the header; the home index is 2-column cards from 40rem to 64rem, filterable by live demo and language.

### V14 Organized and interactive · status: done 2026-11-09 (e3479b5, fbd8729, f35ecbe, PR #13 merged as 9a84b58)
Grouped home index with search (`/`), group chips and URL state; previous / next and a group crumb on project pages; command palette (⌘K), j/k and [ ] keys, prefetch on intent; title and diagram morph between pages; demo full screen. Fixes from a fresh-eyes review of the seven wave 2 demos: stale status lines (raytracer, netcode), btrv phone selection and palette, lobby card clipping, mcpbridge select and word breaks, grepall scrolling matches, styled file pickers (stash, btrv). e2e emulates touch on phone and tablet and shoots running demos at 820 px locally. CSS budget 48 KiB (PLAN.md).
Shared readout, legend and stat styles landed in V15.

### V15 Review polish · status: done 2026-11-09 (afd7fb1, b296e59, b765ad6, 64cf058, ec9b814)
Fixes from a fresh-eyes design review: the work table at 1024–1279 px (PR #14), facts overflow at 768–820, garbled diagram labels (labelled masks now 2x), palette house rules and phone layout, uppercase labels in four demos, raytracer readouts that disagreed mid-pass, mixed input faces, the inset jog, field bugs in kvlite, jobrun and edgecache, four stat block formats unified on `.cells`, off-palette legends, codegraph opening on an empty half, tag chips breaking, the 404 panel and hero alignment. Additions: a receipt line in every demo, measured start-up time in the plate, keypad hero keys, palette plate.
Then: every demo on `.cells stack` and `.demo-legend`, colours from demo tokens via `color-mix(in oklab)` (oklch swung orange through magenta on grepall), canvases read tokens through a probe, lowercase field labels; ui.css 54,058 → 50,603 B. Left: the raytracer screen palette mirrors `--screen*`; lobby's 300 ms seat flights cross card headers in flight (by design).

### V16 Work reel · status: done 2026-11-09
The grouped work table became a scroll reel: one panel per project with a looping clip of its live demo (`cmd/reel`, showcases in `internal/site/showcase.go`, `web/reel/`), a sticky rail from 64rem, a current-project bar below, only the centred clip playing, posters only under reduced motion or Save-Data. Clips go stale with the lock entry, `ui.js`, `ui.css` or showcase (`checkReel`). Search moved to the palette (`/`). Found while recording, not fixed: codegraph scrolls the page when a link click focuses the picker; btrv flashes page 40 on Damage / Undo; kvlite's segment table resets its scroll on re-render; stash jumps when the editor is near the viewport top; lobby flights cross card headers. The first four were fixed in V17.

### V17 Stage, index and layers · status: done 2026-11-09
Home opens on the raytracer rendering live on a pinned dark stage (`internal/site/stage.go`, `web/assets/stage.js`, poster by `cmd/stage`), with measured dials and a draggable material / NEE + MIS split; the reel became a type-led index on a sheet sliding over the stage beside one sticky monitor (`web/assets/work.js`); paper grid, glass header, sampled glow, closing footer. Demos open on their clearest state (ratelimitd burst, jobrun DST jump, keel seed 2, lobby squad, netcode 150 ms / 40 / 5%), clips re-recorded at 480 px CSS. `e2e` `stageCheck` and `workCheck` cover both. Closed in V18: lobby flights pass behind the room header strip and the newest room draws over sliding ones; clips iOS refuses (Low Power Mode) start on the next tap or key (`web/assets/play.js`, e2e `refusedCheck`); monitor and head chips sit under the screen instead of over the clip.

### V18 Per-page CSS and stage scenes · status: done 2026-11-09
site.css split into site.css (every page), home.css and project.css; the CSS budget measures what each page links (PLAN.md). The stage switches between three light-sampled scenes. The monitor screen opens its project. Dropped: a monitor evidence caption, since each index entry beside it already shows its metric.

### V19 Live project heads · status: done 2026-11-09
Every live project page opens like the home stage: the demo frame sits in the dark head (beside the text from 64rem, below it on narrower screens) and starts on its own once the page has loaded and the frame is on screen, under the stage's rules (not with reduced motion, Save-Data, 2g/3g or fewer than 4 cores). Until it runs, the recorded clip plays in the frame. Heads with a demo no longer pin, so nothing scrolled to inside one lands under the sheet; the head sinks as the sheet comes up (a view timeline), not with page scroll. The glow follows the running demo's canvas. e2e: desktop light waits for the autostart, then checks for zero layout shift, focus left alone and the recording removed; every other project tab reports 2 cores and clicks to start.

### V20 Full-screen project panels on home · status: done 2026-11-09
The work index and its monitor became a stack of full-screen dark panels, one per project, like the home stage: name, tagline, metric and "Run it live" beside a 16:10 screen playing the project's clip. Each panel pins and the next slides up over it while the covered one sinks (view timelines named by `web/assets/work.js`); buried panels are not drawn; focus brings its panel up. Group pills on the work sheet jump to each group. e2e `workCheck` walks the reel by focus (home tabs emulate a focused page) and checks the panel covers the screen, plays alone and buries the right panels; `refusedCheck` moved to the panels.

### V37 Project page layout · status: done 2026-11-09
The owner asked for it: the hero put a short intro beside a demo about 2,000 px tall, leaving the left column empty for most of the scroll (jobrun's page was 4,144 px tall, measured), and they did not like "The code". On wide screens the head is now the title, then the claim and its measured result side by side, then the demo across the full width (jobrun's page: 3,173 px, measured). The "The code" section and everything that led to it are removed: the demo's "The code it runs" link, the timeline's "ran" row, `code.js`, and palette code hits. The terminal's `code` and `grep` still read find.json. The home Code peek now links to the excerpt's lines on GitHub at the pinned commit for the 5 public repositories (each checked against the GitHub API), and shows no link for the private ones. The hero loses the "Evidence" badge (the result is a quiet rule-led quote with its source), the title glow, and the "Run it live" key that duplicated the demo below it. The demo head is no longer a saturated blue bar, and "Copy a link to these settings" is "Copy link". A project without a demo shows its figure in a 16:5 frame. e2e `stageCheckProject` replaces the code-panel checks: no code section, and when wide the demo spans the head below the text.
### V38 De-slop · status: done 2026-11-09
A design review found the site reading as AI-generated; the owner asked to de-slop it. no heading glow, scanline, split glow, LED glow, blurred `.glow` canvases (and the JS that painted them), 48px graticule, cursor spotlight, dot-grid paper, scroll-progress bar, glass sheen, rim light or magnetic keys. Tilt, depth, the reel, dock and panel motion stay. One voice: the sans for prose, nav, keys, labels, metrics, sources and the work index; mono only for code, paths and live readouts; Doto removed (fonts 26,908 → 24,532 B, measured). LED dots only on project pages; the numbers page marks only "no demo", loses its tally, card lift and the paragraph under "Results". Group pills became underlined links, HUD chips plain text beside the picture, ⌘K plain dim text. Hero: shorter role line, the tracer before the live count, name capped at 4.5rem. Light mode: the stage, reel panels, dock, numbers head and 404 sit on `--band` tokens that follow the theme, with the dark screens framed on them; TestTokenContrast checks the band pairs; axe holds the head's `sink` animation at its start, since a partly faded pinned head hides the band from it. A stray `}` in site.css had switched off the recording crossfade; it fades in again. The numbers sheet lost a doubled top padding the tally had hidden.

### V39 Demo copy · status: done 2026-11-09
Owner: "make some things look less like ai did it. de-slop". The words pass after V38. Every `demo_try` line now names one concrete thing to do in that demo and what it shows, in a different shape for each; none starts "Watch" or "Press X and watch Y". Receipts lose the stock ", in your browser." tail (23 had it) and "ms of calls"; each reads as a sentence about its own demo, keeps only numbers from the binary or `performance.now()`, and pluralises every count from its value ("1 calls", "1 deliverables" and the like could appear before). Status lines in btrv, edgecache, grepall, stash, strata and netcode's canvas label pluralise the same way, and raytracer's status drops its own "in your browser". The demo contract's Receipt rule no longer mandates the tail. e2e demoChecks, TestDemoFrame and the edgecache and strata tours match the new receipts. All 19 clips re-recorded. mcpbridge's wide clip came out at 311,779 to 336,630 B over nine recordings at CRF 36 (main's own UI too: 329,447 B, measured) against the 307,200 B budget, so `cmd/reel` now keeps stepping CRF past 36, up to 42, only while a clip is still over the budget; clips that fit stop where they did before (mcpbridge: 289,342 B).

### V40 Live home panels · status: done 2026-11-09
Owner picked it from the feature list ("a pinned panel swaps its clip for the live demo"). A live panel's "Run it live" is now a button that runs the project's binary inside the panel (`web/assets/panel.js`); without JS it is still the link to the project's `#demo`. Nothing downloads until it is pressed. The clip keeps playing while the binary loads, with the progress bar on a plate at the foot of the screen; once ready the demo covers the screen's column (the whole panel below 64rem, where the 16:10 screen measured 357 px wide at 390 is too small to use) on the panel's surface, with a bar reading "Live demo", the gzip size and "ready in N ms" (measured in the visitor's browser), "Full page" and, below 64rem, Stop. The key and the dock's key read "Stop"; every label of both keys is sized to the widest, so nothing moves. One panel runs at a time: starting another, opening the code peek, the next panel sliding over it or scrolling it off screen stops it, terminates its worker, empties the mount (canvases give back their pixels) and unlinks its `ui.css`, and the clip comes back. The stop test reads the panel's position, not the layer's, since the slide-in and sink transforms move the layer but not what covers it. demo.js's start became the exported `run()` with `release`, `sheet`, `took`, `calm` and `lean`, shared by the project frame, the panels and the wall. While loading, the layer waits 200vw off screen: quorum's UI draws before its first state if its visibility observer fires early (it threw in the panel), and every demo pauses off screen, so a demo starts its loop only once shown. The demo controls' rules moved from project.css into `web/assets/demo.css` (3,210 B), which project pages link and panels and the wall load on first press: home's CSS is now site.css 27,800 + home.css 25,971 + demo.css 3,210 + the largest `ui.css` (recall, 7,873) = 64,854 B of 72 KiB, counted by the check from `data-live-css`, `data-live-cap` and `data-run` (all measured). e2e `TestLivePanel`: desktop checks no wasm or worker before a press, then quorum running with no clip, Stop on key and dock, focus in the mount, zero layout shift and quorum's first demo check; the peek, keel's panel and a jump to the index each leave 0 workers (a Worker wrapper counts them). Phone runs axe on the live panel and checks 390 px fits.

### V41 Live wall · status: done 2026-11-09
Owner picked it from the feature list ("several demos live as tiles"). `/live/` (`templates/live.html`, `web/assets/wall.js`, `web/assets/live.css`) shows every live project as a tile: its desktop poster at 16:10, name (the project link), tagline, a Run key and a status line ("still · ~N KB", "live · ready in N ms"). A tile at least half on screen for 300 ms starts its real binary, up to the cap, in page order; a tile that leaves the screen stops, which terminates its worker and frees its canvases and `ui.css`. Stop holds a tile until it leaves. With reduced motion, Save-Data, 2g/3g or fewer than 4 cores nothing starts on its own and Run starts a tile, stopping the one least in view at the cap. The head says which applies (both notes share one cell). Linked from the home count line ("Run them side by side"), the footer and the palette; in the sitemap. CSS: site.css 27,800 + live.css 4,856 + demo.css 3,210 + the 4 largest `ui.css` (30,100) = 65,966 B of 72 KiB (measured).
Cap: 4 at once on a laptop, 2 (half) under 48rem or with a coarse pointer (`site.WallCap`). Measured 2026-11-09 on an M3 Pro (12 cores) in headless Chrome at 1440 × 1800 with the wall's cap set to N, 6 s of rAF intervals once tiles were live (scratch tool, not committed). Unthrottled, 0 to 6 tiles all held 60.0 fps with p95 16.8 ms; the renderer's RSS went from ~686 MB with none to ~916 MB with 4 and ~999 MB with 6, and the browser used 0.35 cores with none, 0.68 with 4 and 1.63 with the raytracer among 5. With the main thread throttled 4× (Chrome's CPU throttling, a slower-laptop proxy), 4 tiles held 60.0 fps with no frame over 25 ms in two runs, 5 dropped to 58.2 fps with 3.1–3.2% of frames over 25 ms, 6 to 52.0–54.2 fps with 10.7–15.0%, and 8 to 42.1 fps with 41.9% (all measured). So 4 is the most that stays smooth. Phone proxy (390 px, 4× and 6× throttling): 1 tile held 60.0 fps; 2 held 60.0 at 4× and 59.8 at 6× with 0.3% of frames over 25 ms (measured); the phone cap stays 2. e2e `TestLiveWall`: desktop at 8 cores starts the tiles in view, never more than the cap, one worker per live tile, zero layout shift; Stop holds a tile; scrolling to the end stops the first tiles and leaves workers equal to active tiles. Phone shows a cap of 2 with tiles running and passes axe and 390 px. Two cores start nothing until Run. TestSite visits `/live/` at 2 cores, so its tiles stay posters there.

### V36 Autopilot tours and shareable runs · status: done 2026-11-09
Owner picked both from the feature list. Every live demo (18) has a "Show me" button. It plays a scripted tour through the demo's real controls: a cursor moves to each control and presses it, and a numbered caption quotes the numbers the binary actually produced, read off the page when shown, never written into the script. Any press or key from the visitor stops it. Each demo's steps live in `web/demos/<slug>/tour.js`, and `web/assets/tour.js` runs them (3.3 KB gzipped, measured). "Copy a link to these settings" writes `#run=<binary sha>.<control values>`. Opening that link starts the demo and restores each control in order, then re-sets any control a later one rewrote (a preset filling a field) until all hold. A link from another build is refused with a note. stash, livejob and recall have tours but no link: their state is files or a session, not controls. e2e `TestTours` plays every tour at 8×, then opens its link and checks each control value comes back. On phones the tour bar is one compact row.

### V35 Code peek · status: done 2026-11-09
Owner picked it from the feature list. Each home panel with code gains a Code button beside "Run it live": pressed, the panel's screen flips over to the project's first code excerpt (title, file and line range, why it matters, highlighted numbered lines) with a link to all of its excerpts on the project page. Pressed again, or Escape inside it, flips back and returns focus to the button. The build writes `/code/<slug>.json` per project (19 files, 501 B to 1.8 KB gzipped measured), fetched only on the first press; `peek.js` is 1.1 KB gzipped measured. Under 48rem the face sits in the page flow instead of over the screen. The flip runs only under `prefers-reduced-motion: no-preference`. e2e `TestPeek` opens the first panel's code at phone width, checks its line numbers against its range and its link, runs axe with it open, and closes it with Escape.

### V34 Terminal upgrades · status: done 2026-11-09
Owner picked it from the feature list. The terminal had completion, history and help already; it gains pipes, `code` and `grep`. A command line splits at each `|` outside quotes and JSON. The first command writes to a buffer, then `grep [-v]`, `head [n]`, `tail [n]` and `wc` filter its lines, and errors always reach the screen. `code <project> [n]` lists a project's excerpts or prints one with line numbers. `grep <text>` searches every write-up, result and code line on the site (`/find.json`, V33) and prints `project  file:line  text`. `cat` now shows the project's measured result and its source. e2e `TestShell` checks `ls | grep live | wc` against search.json's live count, `code keel 1 | tail 1` and a `grep` hit in jobrun's code.

### V33 Search everything · status: done 2026-11-09
Owner picked it from the feature list. The command palette now searches every page's text as well as the projects: a query of three letters or more fetches `/find.json` (written by the build: each write-up passage, measured result, demo prompt and code excerpt with its lines, 31.5 KB gzipped measured) and lists up to 8 hits under "In the write-ups and code" with the passage or code line around the match. A code hit opens `/projects/<slug>/#code-<excerpt>-L<line>`: code.js selects the excerpt's tab and marks the line. A text hit opens `#find=<opening words>`: project.js finds that passage and outlines it. Neither depends on browser text fragments. e2e `TestFind` takes a word from the first code excerpt and words from the first write-up out of find.json and checks each lands marked.

### V32 Numbers page · status: done 2026-11-09
Owner picked it from the feature list. `/numbers/` gathers every project's measured result by group, each with its source as the project page quotes it, numbers marked in the accent (not digits inside a name: p99, BM25, 3DBenchy). Below, the binaries: every live demo's WebAssembly size after gzip -9 and before, from `demos.lock.json`, as bars coloured by toolchain (Go, Rust, C++; palette validated light and dark, direct labels as the secondary encoding). Reached from the footer on every page and the command palette. e2e runs it in every viewport and scheme. The same PR fixed the CI flakes that its new tabs exposed. The first livejob, mcpbridge and btrv checks now play at a speed the visitor can pick (4×, 2×, 10×), rather than wait over 20 s at 1× on a loaded runner. The edgecache check steps until the clock reads 300 s, since an async Reset could wipe early steps. Full local e2e went from 65–68 s to 47 s (measured).

### V31 Call timeline and X-ray · status: done 2026-11-09
Owner picked both from the feature list. The worker now measures every call: time inside the binary, JSON bytes in and out, and the binary's linear memory after it. demo.js passes these on `demo:call`, plus a new `demo:fail` and `demo:stop`. Under each live demo, a timeline draws one bar per call (log time, coloured by method, red when it failed). Point at a bar, or focus it and use the arrow keys (a slider for assistive tech), to read its params, result (elided), JSON sizes and the code panel excerpts it ran. X-ray (the X key, or the button on the timeline) opens a panel of live numbers: toolchain, sizes and sha256 from the lock, the pinned commit, worker state, memory, calls and busy time in the last second, and the page's decoded bytes by kind from Resource Timing. It also outlines the regions on a fixed layer that moves nothing. e2e `timelineCheck`, `xrayCheck` and `xrayClose`, plus axe on the X-ray panel in both schemes. The CSS budget went to 72 KiB (PLAN.md).

### V30 The code, lit by the demo · status: done 2026-11-09
Owner approved excerpts for every project ("Excerpts for all") and asked for "more layers and more features". Each project page gets a dark code panel: one to three excerpts of the real source at the demo's pinned commit, highlighted at build time by chroma into token classes (no inline styles, so the CSP holds), with tabs, line numbers and a cascade on first view. Each excerpt names the demo calls that run it (`calls`, narrowed by params, e.g. `render sampling=nee`), held to every successful call of that kind. demo.js emits `demo:call` on each resolved call, and the panel counts runs per excerpt, flashes the one that ran and names it in a live trace; a link under the demo counts calls and jumps to the code. e2e `codeCheck` walks the tabs and line numbers; `traceCheck` asserts each demo's checks light some excerpt.

### V29 Scroll depth · status: done 2026-11-09
As a panel slides in on any device, its glow rises from far behind and its name slides in ahead of the text; all settle flat when it pins. Timed on the panel's own view timeline. The home `depth` check scrolls it halfway in, then to where it pins.
### V28 Depth layers · status: done 2026-11-09
Owner: "enhance our features and overall layers, i like the hover and the card moves". Under a mouse with motion allowed, a tilted screen now moves its layers by depth. The glow behind drifts with the pointer, the picture slides against the tilt inside its frame (within the hover zoom, so no edge shows) and the Open chip floats in front. feel.js sets `--dx/--dy` on the screen's parent. In the index, the other cards step back to half opacity while one is under the pointer. e2e `feelCheck` asserts the shift and the dimming (checked by mutation). Dropped: a JS panel sink, since V20's scroll-driven `sink` already does it.

### V27 Lit panel edges · status: done 2026-11-09
Under a mouse, the edge of the panel the pointer is over lights where the pointer is: the evidence box, the demo frame, the project info box and index previews. feel.js sets `--hx/--hy` and `data-rim`. A masked 1.5 px ring fades in, and the panel keeps its own border. Touch gets none of it.

### V26 Theme switch · status: done 2026-11-09
A sun/moon key in the header (also `t`, and the palette) switches light and dark. The new theme opens as a circle from the key, using a view transition; it switches instantly with reduced motion or no view transitions. A choice that differs from the system's is kept in localStorage and applied by vt.js before first paint, and the theme-color metas follow. Choosing the system's theme clears the stored choice. Canvas demos redraw on a `themechange` event as well as on the system's change. The dark tokens are stated twice (system and chosen), and TestTokenContrast fails if the copies differ. The CSS budget went to 56 KiB (PLAN.md). Long titles (AnchorFlow) no longer break mid-word, and the header fits at 320 px. TestTheme covers the switch, a reload and switching back.

### V25 Terminal · status: done 2026-11-09
Owner picked "Terminal over all 16" for "cool looking and feeling features". The `>_` header key, the ` key or the palette opens `shell.js`, a dialog terminal over every live demo's real binary. `ls`, `cat` and `cd` cover the projects. `try <slug>` types and runs the calls in `site.ShellTries` (internal/site/shell.go, in search.json). In a project, a bare word calls that method, and `call <slug> <method> {json}` works anywhere. `trace <scene> <passes>` renders with the C++ raytracer into the terminal. Every call ends on a receipt: bytes of JSON and time measured in the tab. `stats`, `copy` and `history` are there too, plus Tab completion, ↑/↓ history and Ctrl+C. At most 3 binaries stay up. TestShell runs kvlite's tries, a trace and a typo with axe; `TestShellTries` checks every live demo has tries and only live ones do. All 15 sets of tries were run in Chrome before merge.

### F7 Feel cost CI 10 s · status: done 2026-11-09
After V24 the slowest e2e shard went from about 20 s to 31-42 s and the deploy took 66 s. Every reel and index preview carried a 3D transform and a blended glare layer whether or not a pointer was near, and 15 lazy index posters ran a background-position shimmer that repainted every frame (tests never scroll them into view). Now the feel styles apply only while `data-feel` is set, and the shimmer is a translated pseudo-element, which the compositor animates. Local e2e went from 49 s to 39 s (measured).

### V24 Pointer feel · status: done 2026-11-09
Owner: "ui enhancements in general. cool looking and feeling features". `feel.js` (every page; mouse only, nothing on touch) lights the graticule under the pointer on the dark stage, project heads and reel panels. With motion allowed it also tilts reel and index previews toward the pointer under a glare, and leans the primary keys toward it. Index cards fade their posters in over a shimmer and play their clip while a mouse is over them (not with reduced motion or Save-Data). The dock's number and name roll in from the direction of travel. e2e `feelCheck` drives a real mouse onto a card.

### V23 Reel dock and index · status: done 2026-11-09
Owner asked for a way around the home reel "where you can click and do other stuff too". The new dock (`.dock`, work.js) shows while a panel is current. It has one tick per project by area with a hover preview, a jump that skips the clips in between, up/down steps, "Run it live" (or "Open") for the current project, and "All N". The reel now ends in `#all`: a paper sheet that slides over the last panel, with every project as a card and Area and Language filters (`langs` in build.go). Filtering glides the cards with a same-document view transition where the browser supports transition types. vt.js flies a card into the project page. e2e `indexCheck` covers "All", the filters and a tick jump.

### V22 Desktop-size preview clips · status: done 2026-11-09
Owner: "the preview clips still look SO BAD. i need those fixed. when you click them though, it's looking good". The clips were recorded from a 480 px phone page, so a 705 px desktop panel scaled them up about 1.6x. cmd/reel now records each demo twice, from a 752 px page at 2x (`<slug>.mp4`, 1408 × 880) and from a 480 px page at 3x (`<slug>-n.mp4`), with the desktop crop framed per demo on its visualization (`WideFocus`/`WidePad`). Home and project screens choose by `site.ReelWide` through `<picture>`, and the scripts play the matching clip. e2e checks the crop for the viewport. Sizes are in PLAN.md.

### V21 Clip and panel polish · status: done 2026-11-09
Every home and project clip re-recorded (`cmd/reel`): 3x and 30 fps instead of 2x and 24 fps, site header and pinned chrome hidden (4 clips had it over their top), scroll-linked animations stopped and entrances finished before the cast (5 opened on a grey frame), crop scale taken from each frame's metadata (the crop ran 17 px past the demo), CRF stepped up only past 90% of the budget. strata frames the whole part; the raytracer is held at pass 3 so the clip shows the noise clearing; its "One more sample" key and btrv's progress bar keep their space instead of shifting the demo. Home: the last panel sank (opacity 0.25) with nothing over it, because a `none` timeline applied the finished sink; names wrapped ("raytrac/er"); the "NN / 15" chip covered clip content.

## Owner only

### U1 Make more repos public · status: user
Never change visibility. When the owner names a repo, update its page (`repo:` URL, drop "private source") in the commit they approve.

### U2 Custom domain · status: user

### U3 Showcase platform for other developers · status: user
Parked: no proven paid demand (docs/research.md). Only on the owner's say-so.

### U4 Unarchive quorum · status: user
crowbett/quorum was archived on 2026-10-20, so pushes are refused. Q0 and D5 need its two local commits (3c5e606, 3f92d9f) pushed, and pins accept only pushed commits. The owner decides whether to unarchive (`gh repo unarchive crowbett/quorum`; visibility stays private) or drop the quorum demo.
