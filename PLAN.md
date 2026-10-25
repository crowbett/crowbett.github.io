# Plan

Goal: a fast, robust personal site that shows visitors what each project does by running the project's real code in their browser, not a list of GitHub links.

Status (2026-10-24): live at https://crowbett.github.io. Scaffold done. 8 project pages, the demo pipeline proven end to end by the `smoke` demo, gate + headless e2e green. Project demos live: ratelimitd (D1), edgecache (D2), jobrun (D3). `docs/tasks.md` is the queue.

## Architecture
- **Generator.** `cmd/site` (Go, goldmark only) renders `content/projects/*.md` through `templates/` into `dist/`, copies `web/` as-is, writes `404.html`, `sitemap.xml`, `robots.txt`. `internal/site/check.go` then fails the build on broken internal links, missing page metadata or a blown budget.
- **Demos.** A project page with `demo: live` gets a "Run the live demo" button. On click, `web/assets/demo.js` starts a Web Worker (`demo-worker.js`) that loads `/wasm/<slug>.wasm` with Go's `wasm_exec.js`, and imports `/demos/<slug>/ui.js`, which renders controls and calls the binary over a JSON RPC. Nothing downloads until the visitor asks; the button states the size. Contract: `docs/demo-contract.md`.
- **Bridges live in the project repos** (`cmd/webdemo`), so each project's own gate tests them and the demo can never drift from the code it claims to show.
- **Binaries are built locally and committed.** `cmd/wasm build` exports each pinned commit with `git archive` (committed files only, plus pinned sibling repos for `go.mod` replaces) and builds it with `-trimpath -buildvcs=false -ldflags=-s -w`. `demos.lock.json` records commit, sha256, sizes and the Go version; `wasm_exec.js` is copied from that same toolchain. CI runs `wasm check` and never needs access to private repos.
- **Deploy.** `.github/workflows/pages.yml` (push to main): one job runs gate + e2e concurrently, then `upload-pages-artifact` + `deploy-pages`, under 60 s. `ci.yml` runs the same checks on pull requests. Actions SHAs are pinned.

## Decisions
- Public repo on GitHub Pages: free Actions minutes and hosting for public repos, no server to run. Custom domain is a later user decision.
- Go static generator instead of a JS framework: zero npm, one toolchain, the site is itself a small Go project.
- Workers, not the main thread: a demo that loops or panics cannot freeze the page; a call that times out terminates the worker.
- Strict CSP via meta tag (`script-src 'self' 'wasm-unsafe-eval'`): no inline scripts, no third-party anything. Pages cannot set response headers, so the meta tag is the only CSP available.
- Private projects (quorum, keel, strata) ship compiled binaries only. A Go binary keeps function and package names in its symbol table even with `-s -w`; that is accepted, the source is not published.
- Binaries are committed to git. Each rebuild adds ~1-2 MB gzipped to history; GitHub's soft limit is 1 GB for a Pages site and a repo. Revisit (e.g. release assets) if the repo passes ~300 MB.
- The multi-user showcase platform idea is parked: research (2026-10-24, `docs/research.md`) found no proven paid demand. The demo bundle (`web/demos/<slug>/` + binary + lock entry) is kept self-contained so it could become that platform's unit if demand appears.

## Budgets (enforced by `site check`)
| What | Limit |
|---|---|
| One HTML page | 60 KiB |
| All CSS | 40 KiB |
| One demo's `ui.js` | 60 KiB |
| One `.wasm`, gzip -9 | 2.25 MiB |
| All `.woff2` fonts | 32 KiB |
| One share image, `og/*.png` | 100 KiB |

Measured (lock entries, go1.27.3): the `smoke` binary (encoding/json + runtime) is 4,396,800 bytes, 1,220,218 gzipped. The first real bridge, ratelimitd (three algorithms, `encoding/json`, `math/rand/v2`), is 4,467,874 bytes, 1,246,216 gzipped. edgecache (engine + memstore + `net/http`) is 7,856,488 bytes, 2,181,042 gzipped. jobrun (cronx + job.Policy + embedded `time/tzdata`) is 5,290,873 bytes, 1,474,581 gzipped. Bridges that import `net/http` or more will be larger (projected), so keep them lean; TinyGo is an option only if a demo cannot fit.

WASM budget raised from 2 MiB to 2.25 MiB (decision, 2026-10-24, D2): edgecache's engine is an `http.Handler`, so its bridge cannot avoid `net/http`, which links crypto/tls init code (traced with `-ldflags=-dumpdep`). The bridge driving the real engine and memstore was 7,845,205 bytes, 2,176,744 gzipped (lock entry, go1.27.0), 79,592 over 2 MiB. Rejected: disabling inlining (`-gcflags=all=-l`) fit an earlier build at 2,063,987 gzipped (measured) but grew the raw module to 8,495,326 bytes, which the browser must compile; TinyGo lacks the `net/http` server types the engine uses; a bridge over bare `internal/rfc9111` would have to reimplement the engine's unexported orchestration. 2.25 MiB leaves ~178 KB over edgecache (go1.27.3) for later bridges; the next raise is another recorded decision.

Share image budget (added 2026-10-24, V7): 1200×630 cards rendered by `cmd/og`, 32,259–59,869 bytes each (measured), so 100 KiB holds them with room for denser drawings. The build also fails when a card's HTML no longer matches the hash recorded when its PNG was made (`web/og/.sums`): run `go run ./cmd/og` and commit `web/og`.

Fonts budget (added 2026-10-24, V2): one self-hosted mono, JetBrains Mono subset to 9,796 bytes (measured); 32 KiB leaves room for one more subset face before it needs a recorded decision. Rationale in `docs/design.md` §Type.

## Open
- Rust demos (strata, codegraph, keel) need a second build path in `cmd/wasm`; see `docs/tasks.md` R0.
