# Demo contract

A demo is three things: a bridge in the project repo, a UI in this repo, and a lock entry tying them to one commit.

## Bridge (project repo, `cmd/webdemo/`)
- `main.go` is `//go:build js && wasm` and only wires the bridge: set `globalThis.__demo = func(method, paramsJSON string) string`, call `globalThis.__demoReady()`, then `select {}`.
- A `stub.go` tagged `//go:build !(js && wasm)` holds a `main` that prints "runs only as js/wasm" and exits 2; without it the package has no `main` on native platforms and the project's `go build ./...` / `go vet ./...` fail.
- All logic lives in a file without build tags (e.g. `handler.go`: `func Handle(method string, params []byte) any`) with a normal `handler_test.go`, so the project's own gate runs it on every commit.
- It calls the project's real packages (internal ones are fine: `cmd/webdemo` is inside the module). Never reimplement project logic in the bridge; the point is that visitors run the shipped code.
- Results are JSON objects. Errors are `{"error": "..."}`; a successful result must not have a top-level `error` key.
- Deterministic: anything random takes a seed from params. No wall clock (pass simulated time in params), no network, no filesystem (browser Go has none; `os` file calls fail with ENOSYS).
- Bounded: one call does at most ~50 ms of work on a laptop. Long runs are many calls (`step`, `run {ticks: n}` with a cap). State between calls is fine and lives in Go.
- Small: import only what the demo needs. `fmt` and `encoding/json` are fine; `net/http`, gRPC, database drivers are not.

## UI (`web/demos/<slug>/ui.js`, this repo)
- `export async function mount(el, demo)`: render into `el`; resolve only after the first real output is on screen. `demo.call(method, params)` returns a Promise of the result object and rejects with an Error on `{"error"}`, a crash or a 30 s timeout.
- Vanilla ES modules and DOM only. Set text with `textContent`, never `innerHTML` with data from the binary. SVG via `createElementNS`, or `<canvas>`.
- CSP: no inline `<style>` or `style="..."` attributes. Use classes from `web/assets/site.css`, or a `web/demos/<slug>/ui.css` the module adds as a `<link>`. Setting `el.style.prop` from JS is allowed.
- Accessible: real `<button>`/`<input>` with labels, keyboard-usable, `aria-live` for results that change. Respect `prefers-reduced-motion` (no auto-play animation when it is set).
- Works at 390 px wide without horizontal page scroll (wide charts scroll inside their own box). Works in light and dark (`--` tokens in site.css).
- Budget: 60 KiB for `ui.js`.

## Lock and page
1. Commit and push the bridge in the project repo; its gate must be green.
2. Add `{"slug", "repo", "pkg": "./cmd/webdemo", "siblings"?}` to `demos.lock.json`, then `go run ./cmd/wasm pin <slug> <sha>` and `make wasm`.
3. Set `demo: live` in `content/projects/<slug>.md`; replace the "planned demo" sentence with what the demo shows.
4. Add the slug to `demoChecks` in `e2e/e2e_test.go` with at least one expression that proves real output from the binary rendered.
5. `make gate && make e2e`, then look at `e2e/out/projects-<slug>-*.jpg`.
