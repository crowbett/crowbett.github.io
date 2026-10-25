# Tasks

The work queue as a dependency graph. A task is **ready** when its status is `todo` and every task in `deps` is `done`. Pick the ready task with the lowest `order`. Statuses: `todo`, `doing`, `done`, `blocked (reason)`, `user` (only the owner can do it; never start one).

When you finish a task, set it `done` with the date and commit SHA(s). If a task turns out bigger than planned, split it here into new ids before continuing. New ideas go in at the bottom as `todo` with deps and a done-when line.

## Ship

### S1 First deploy · order 1 · deps: none · status: done 2026-10-24 (aa3fc49, cd7a0a3)
Create public repo `crowbett/crowbett.github.io`, push `main`, enable Pages with build type "GitHub Actions", watch the run.
Done when: https://crowbett.github.io/ returns 200, every project page and `/demos/smoke/` load, and the smoke demo answers in a real browser session (headless e2e pointed at the live URL or a manual curl + chromedp check).

### S2 Measure wasm delivery · order 2 · deps: S1 · status: done 2026-10-24 (Pages gzips .wasm; see docs/research.md)
`curl -sI -H 'Accept-Encoding: gzip' https://crowbett.github.io/wasm/smoke.wasm`: record `content-type`, `content-encoding`, transferred size in `docs/research.md`. If Pages does not compress `.wasm`, decide (record in PLAN.md) whether the size shown on the button should be the raw size.
Done when: the "Downloads ~N KB" text on every demo button matches what a visitor actually transfers.

## Fixes

### E0 edgecache README claim · order 5 · deps: none · status: todo
edgecache's README line 5 says "standard library only", but `go.mod` has OpenTelemetry and gRPC and `internal/http/handlers.go` imports `otelhttp`. Reword it truthfully (e.g. caching logic on the standard library, OpenTelemetry for tracing) in the edgecache repo, gate, push.
Done when: README and this site's edgecache page say the same true thing.

## Go demos (one bridge each, see docs/demo-contract.md)

### D1 ratelimitd: algorithm race · order 10 · deps: S1 · status: todo
Bridge in `~/dev/ratelimitd/cmd/webdemo` over the pure `Step` functions in `internal/algo/{gcra,tokenbucket,slidingwindow}` (GCRA: `gcra.Step(state, limit.Params, cost, nowUS)`). One call simulates a traffic pattern (steady, burst, ramp, attack; seeded) through all three algorithms with the same limit and returns per-bucket allowed/denied series. UI: pick pattern + limit + burst, SVG chart of the three side by side, totals per algorithm.
Done when: ratelimitd gate green with the bridge and its handler test; pinned and built here; project page live with demoChecks proving three series rendered; screenshots reviewed at both widths.

### D2 edgecache: freshness timeline · order 11 · deps: S1 · status: todo
Bridge over `internal/rfc9111` (the real freshness/validation logic). Visitor edits response headers (`Cache-Control`, `Age`, `Expires`, `ETag`, `Vary`) and request headers, then scrubs a clock; each request shows hit / stale / must-revalidate / miss with the RFC 9111 reason. Presets: max-age, s-maxage, stale-while-revalidate, no-cache, Vary.
Size risk: `rfc9111` takes `http.Header`, so the bridge imports `net/http`; measure the gzipped binary before building the UI and stop if it breaks the 2 MiB budget (options: TinyGo, or a budget decision in PLAN.md).
Done when: as D1, with a demoCheck that a preset produces the expected outcome sequence.

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

## Polish

### P1 Light-mode screenshots · order 40 · deps: S1 · status: todo
e2e also renders every page with `prefers-color-scheme: light` (emulation) and checks contrast of text tokens (WCAG AA) in both themes.
Done when: e2e covers both themes and passes.

### P2 Social card · order 41 · deps: S1 · status: todo
A static `og:image` per project (generated at build time as SVG→PNG is not available without deps; a hand-made PNG per project or one site-wide card is fine). Budget it.
Done when: `og:image` on every page, image under 100 KB, checked by `site check`.

## Owner only

### U1 Make more repos public · status: user
The owner said more repos should go public later. Never change visibility. When the owner names a repo, update its page (`repo:` URL, drop "private source") in the same commit they approve.

### U2 Custom domain · status: user
### U3 Showcase platform for other developers · status: user
Parked: no proven paid demand (docs/research.md). Only revisit on the owner's say-so.
