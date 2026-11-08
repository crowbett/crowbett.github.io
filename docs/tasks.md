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

### F7 Does the Tab walk still need its timeline pause · order 37 · deps: none · status: todo
From F6: the home Tab walk's 15-25 s stalls (F5) and the GPU freeze were inferred to be the same fault, so the walk may be fast without F5's animation-timeline pause. Not measured on CI.
Done when: three `ci` runs with the pause removed are timed and the pause is kept or dropped on that evidence, recorded here.

## Open follow-ups (not loop work)

Left open in done tasks; each needs the owner, another repo, or is outside this repo's control.
- F5: Chrome warm-up on CI still depends on runner disk speed; deploy-pages takes 7-14 s and sometimes queues ~40 s in GitHub's `deployment_queued` (F2).
- D7 (codegraph repo): the bench accuracy A/B was not run on the six local-only corpus repos or zustand (`npm install` failed).
- D8 (keel repo): clippy on keel's main fails on `clippy::unused_async_trait_impl`, a lint unknown to clippy 1.96, 1.98.1 and 1.99; keel-web's PR ran with `-A unknown_lints`.
- V8 polish (demo track): the edgecache, jobrun and kvlite notes keep their own `max-width: 40rem` inside the wider frame.
- V11 review (owner call): Doto for the evidence lines too; Doto is a numerals face here and metrics are sentences.

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
Done when: a fresh-eyes reviewer rates home "would remember this site" (yes, not maybe) and the screenshots back it.

### V13 Tighten copy and tablet layout · order 112 · deps: V12 · status: doing (branch tighten-layout)
Project pages cut to bullets plus a short demo note, evidence moved into the page header, write-up and facts in one panel split 7fr/5fr from 48rem; the home index becomes 2-column cards from 40rem to 64rem.
44px touch targets and 16px demo fields on coarse pointers, safe-area gutters, and e2e gains an 820×1180 tablet viewport.
Done when: `make gate && make e2e` pass and every changed page's screenshots are reviewed at all three viewports in both themes.

## Owner only

### U1 Make more repos public · status: user
Never change visibility. When the owner names a repo, update its page (`repo:` URL, drop "private source") in the commit they approve.

### U2 Custom domain · status: user

### U3 Showcase platform for other developers · status: user
Parked: no proven paid demand (docs/research.md). Only on the owner's say-so.

### U4 Unarchive quorum · status: user
crowbett/quorum was archived on 2026-10-20, so pushes are refused. Q0 and D5 need its two local commits (3c5e606, 3f92d9f) pushed, and pins accept only pushed commits. The owner decides whether to unarchive (`gh repo unarchive crowbett/quorum`; visibility stays private) or drop the quorum demo.
