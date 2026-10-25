# Demo contract

A demo is three things: a bridge in the project repo, a UI in this repo, and a lock entry tying them to one commit.

## Bridge (project repo, `cmd/webdemo/`)
- `main.go` is `//go:build js && wasm` and only wires the bridge: set `globalThis.__demo = func(method, paramsJSON string) string`, call `globalThis.__demoReady()`, then `select {}`.
- A `stub.go` tagged `//go:build !(js && wasm)` holds a `main` that prints "runs only as js/wasm" and exits 2; without it the package has no `main` on native platforms and the project's `go build ./...` / `go vet ./...` fail.
- All logic lives in a file without build tags (e.g. `handler.go`: `func Handle(method string, params []byte) any`) with a normal `handler_test.go`, so the project's own gate runs it on every commit.
- It calls the project's real packages (internal ones are fine: `cmd/webdemo` is inside the module). Never reimplement project logic in the bridge; the point is that visitors run the shipped code.
- Results are JSON objects. Errors are `{"error": "..."}`; a successful result must not have a top-level `error` key.
- Deterministic: anything random takes a seed from params. No wall clock: pass simulated time in params, or give the engine a simulated clock in the bridge (kvlite's `WithClock`). No network.
- Files: the worker loads `web/assets/memfs.js`, an in-memory Node-style `fs` that Go's js/wasm `os` package calls into, so an engine that writes files runs unchanged. It has `/` and `/tmp`, the working directory is `/`, and it lives as long as the worker (a reload starts empty). There are no file locks. Calls complete synchronously, and Go on wasm runs goroutines cooperatively on one thread, so code that spins waiting on another goroutine without blocking starves.
- Bounded: one call does at most ~50 ms of work on a laptop. Long runs are many calls (`step`, `run {ticks: n}` with a cap). State between calls is fine and lives in Go.
- Small: import only what the demo needs. `fmt` and `encoding/json` are fine; gRPC and database drivers are not. Avoid `net/http` (a probe of it plus `internal/rfc9111` gzipped to 1,819,664 bytes against 1,217,580 for the json-only smoke binary, measured) unless the project's own API is built on it, as edgecache's engine is; `regexp` added ~130 KB gzipped to edgecache's bridge (measured), so hand-check simple formats.

## UI (`web/demos/<slug>/ui.js`, this repo)
- `export async function mount(el, demo)`: render into `el`; resolve only after the first real output is on screen. `demo.call(method, params)` returns a Promise of the result object and rejects with an Error on `{"error"}`, a crash or a 30 s timeout.
- Vanilla ES modules and DOM only. Set text with `textContent`, never `innerHTML` with data from the binary. SVG via `createElementNS`, or `<canvas>`.
- CSP: no inline `<style>` or `style="..."` attributes. Use classes from `web/assets/site.css`, or a `web/demos/<slug>/ui.css` the module adds as a `<link>`. Setting `el.style.prop` from JS is allowed.
- Accessible: real `<button>`/`<input>` with labels, keyboard-usable, `aria-live` for results that change. Respect `prefers-reduced-motion` (no auto-play animation when it is set).
- Works at 390 px wide without horizontal page scroll (wide charts scroll inside their own box). Works in light and dark: use only these tokens from site.css, which follow the scheme: `--bg`, `--surface`, `--sunken` (wells, chart backgrounds), `--line`, `--line-strong`, `--control-line`, `--text`, `--text-2` (secondary text), `--text-3` (labels), `--accent`, `--accent-tint`, `--live`, `--danger`, `--mono`, `--sans`, `--r-1`. Other names in site.css may change without notice; a demo may define its own properties (e.g. `--rl-gcra`) in its ui.css. The build fails on any other name (`DemoTokens` in internal/site/check.go).
- Budget: 60 KiB for `ui.js`.

## Frame (site-owned: `templates/project.html`, `web/assets/demo.js`)
- The site renders the frame: title bar, start button, size, download progress, error state and retry. `ui.js` never builds its own loader or error box.
- `mount` runs only after the binary is ready. If it throws, the frame shows the message and a "Try again" button that clears the mount and starts a fresh worker, so `mount` must cope with being called again on an empty `el`.
- A box that scrolls sideways (wide table or chart) needs keyboard access: after `mount` the frame gives any overflowing `overflow-x: auto|scroll` element in the mount `tabindex="0"`, `role="region"` if it has no role, and `aria-label="Scrollable area"` if it has no label. Give the box your own `aria-label` naming what scrolls (e.g. "Request log"); e2e runs axe on every demo.
- After `mount` resolves, focus moves to the first `button, input, select, textarea, a[href], [tabindex]` in the mount, so put the main control first.
- Hooks for tests: the section carries `data-demo-ready` or `data-demo-error`, and `data-demo-loaded` with the decompressed bytes received; project pages also carry `data-bytes` (the raw size from the lock).

## Lock and page
1. Commit and push the bridge in the project repo; its gate must be green.
2. Add `{"slug", "repo", "pkg": "./cmd/webdemo", "siblings"?}` to `demos.lock.json`, then `go run ./cmd/wasm pin <slug> <sha>` and `make wasm`.
3. Set `demo: live` in `content/projects/<slug>.md`; replace the "planned demo" sentence with what the demo shows.
4. Add the slug to `demoChecks` in `e2e/e2e_test.go` with at least one expression that proves real output from the binary rendered.
5. `make gate && make e2e`, then look at `e2e/out/projects-<slug>-*.jpg`.

## Home replay (site-owned: `data/hero-trace.json`, `internal/site/hero.go`)
The home hero draws one recorded call to a live demo (today ratelimitd `race`, attack pattern, seed 1). e2e `TestHeroTrace` re-runs that call through the built binary and fails if the answer differs. If a demo change alters it on purpose, run `HERO_TRACE=update go test -tags e2e -run TestHeroTrace ./e2e`, look at `e2e/out/home-*.jpg`, and commit the new file. The build refuses a trace whose slug is not a live demo.
