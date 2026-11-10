# Plan

Goal: a fast, robust personal site that shows what each project does by running the project's real code in the browser, not a list of links.

## Architecture
- **Generator.** `cmd/site` (Go, goldmark only) renders `content/projects/*.md` through `templates/` into `dist/`, copies `web/` as-is, writes `404.html`, `sitemap.xml`, `robots.txt`. `internal/site/check.go` then fails the build on broken internal links, missing page metadata or a blown budget.
- **Demos.** A project page with `demo: live` gets a "Run the live demo" button. On click, `web/assets/demo.js` starts a Web Worker (`demo-worker.js`) that loads `/wasm/<slug>.wasm` with Go's `wasm_exec.js`, and imports `/demos/<slug>/ui.js`, which renders controls and calls the binary over a JSON RPC. The button states the size. Contract: `docs/demo-contract.md`.
- **What downloads unasked.** The home stage's raytracer (one copy per spare core, up to 8) starts after `load` while the stage is on screen; the home arena's netcode build once the arena is on screen; a project head's demo once a quarter of its frame is on screen. None of them start under reduced motion, Save-Data, a 2g/3g connection or fewer than 4 cores. Everything else downloads only when the visitor asks.
- **Bridges live in the project repos** (`cmd/webdemo`), so each project's own gate tests them and the demo can never drift from the code it claims to show.
- **Binaries are built locally and committed.** `cmd/wasm build` exports each pinned commit with `git archive` (committed files only, plus pinned sibling repos for `go.mod` replaces) and builds it with `-trimpath -buildvcs=false -ldflags=-s -w`. `demos.lock.json` records commit, sha256, sizes and the Go version; `wasm_exec.js` is copied from that same toolchain. CI runs `wasm check` and never needs access to private repos.
- **Deploy.** `.github/workflows/pages.yml` (push to main): `gate` (then `upload-pages-artifact`) and nine `e2e` runners run at once: three split the page tabs (`E2E_SHARD=i/3`), four split the demo tours, one runs the live panels and the wall, and one runs every other test, so the slow-link and motion checks never share a runner with demo tabs. `deploy` waits for all of them. `ci.yml` runs the same jobs on pull requests, and every 3 days on main so main's Go caches never age out (a cold run took 105 s, measured). Actions SHAs are pinned.

## Decisions
- Public repo on GitHub Pages: free Actions minutes and hosting, no server to run.
- Go static generator instead of a JS framework: zero npm, one toolchain.
- Workers, not the main thread: a demo that loops or panics cannot freeze the page; a call that times out terminates the worker.
- Strict CSP via meta tag (`script-src 'self' 'wasm-unsafe-eval'`): Pages cannot set response headers, so the meta tag is the only CSP available.
- No animation library: CSS `linear()` springs; libraries that inject `<style>` break the CSP.
- Private projects (quorum, keel, strata) ship compiled binaries only. A Go binary keeps function and package names in its symbol table even with `-s -w`; that is accepted. Each project page may publish curated excerpts of its real source: at most 70 lines per project, read by `go run ./cmd/code` at the demo's pinned commit into `code/<slug>.json`, never from a working tree. The build fails when an excerpt is stale, not at the lock's commit, carries markup other than token spans, or matches the identity and secret guard (`site.Unpublishable`).
- Binaries are committed to git (~1-2 MB gzipped per rebuild). Revisit (e.g. release assets) if the repo passes ~300 MB.
- The demo bundle (`web/demos/<slug>/` + binary + lock entry) stays self-contained.

## Budgets (enforced by `site check`)
| What | Limit |
|---|---|
| One HTML page | 60 KiB |
| CSS one page loads (the stylesheets it links + its demo's `ui.css`) | 84 KiB |
| One demo's `ui.js` | 60 KiB |
| One `.wasm`, gzip -9 | 2.25 MiB |
| All `.woff2` fonts | 32 KiB |
| One share image, `og/*.png` | 100 KiB |
| One reel clip or its poster, `reel/*.mp4` / `*.webp` | 300 KiB |

A raise is recorded here with the measurement that forced it and what was rejected; the next raise is another recorded decision.

**WASM 2.25 MiB** (2026-10-24): edgecache's engine is an `http.Handler`, so its bridge cannot avoid `net/http`, which links crypto/tls init code (traced with `-ldflags=-dumpdep`); it was 2,176,744 bytes gzipped (lock entry, go1.27.0), 79,592 over 2 MiB. Rejected: `-gcflags=all=-l` (fit at 2,063,987 gzipped but grew the raw module to 8,495,326 bytes, which the browser must compile); TinyGo (lacks the `net/http` server types); a bridge over bare `internal/rfc9111` (would reimplement the engine's unexported orchestration).

**CSS counts per page** (2026-10-25, 2026-11-09): the check sums the stylesheets each HTML page links, the `ui.css` beside its `data-ui` module, and, for a page that starts demos in place (`data-live-css`, `data-live-cap`, `data-run`), that stylesheet plus the cap largest `ui.css` among those slugs. Rejected: summing every stylesheet whether a page loads it or not, and leaving lazily loaded CSS uncounted.

**CSS 84 KiB** (raised 40 → 48 → 56 → 72 → 84 KiB, 2026-11-08 to 2026-11-09): each raise followed site-wide features whose rules belong in the shared sheets (the palette, theme switch, demo panels, the arena and motion). The theme switch states the dark tokens twice, under `prefers-color-scheme` and under `[data-theme=dark]`, because custom properties cannot share one rule across a media query and a selector and `light-dark()` would hand canvas demos an unresolved string. At the last raise home counted 76,770 bytes, home.css 8,124 gzipped (measured). Rejected: lazily linked stylesheets (the build counts them the same, and a first open would flash unstyled).

**Fonts 32 KiB**: `make fonts` (`scripts/fonts.sh`) builds three OFL subsets from google/fonts at a pinned commit, sha256-checked: 24,532 bytes (measured). Rationale in `docs/design.md` §Type.

**Share images 100 KiB**: 1200×630 cards rendered by `cmd/og`, 48,139–66,604 bytes each (measured 2026-10-26). The build fails when a card's HTML, site.css or a font no longer matches the hash recorded with its PNG (`web/og/.sums`, `site.ImageSum`): run `go run ./cmd/og` and commit `web/og`. Diagram masks work the same way: `go run ./cmd/dither` (needs Chrome and oxipng) writes `web/assets/dg/*.png` and `.sums`.

**Reel clips 300 KiB**: `go run ./cmd/reel [slug…]` (needs Chrome and ffmpeg) records a 16:10 H.264 clip of each live demo at 30 fps from a dist built with `Config.Recording`, in two crops: `<slug>.mp4` (752 px page at 2x, 1408 × 880) and `<slug>-n.mp4` (480 px page at 3x, 1324 × 828). A screen about 560 CSS px wide or wider (`site.ReelWide`) gets the desktop crop, a narrower one the phone crop. CRF starts at 26 and steps up by 2 only for a clip that would pass 90% of the budget. Measured 2026-11-09: desktop clips 44,407–259,379 bytes, phone clips 35,191–242,058, posters 7,656–72,268. The build fails when a live demo has no clip or its lock entry, `ui.js`, `ui.css` or showcase changed since recording (`web/reel/.sums`): re-record that slug and commit `web/reel`. The home stage poster `reel/stage.webp` (`go run ./cmd/stage`, tied to the lock entry and `site.HomeStage` by `web/reel/.stage`) is under the same limit.

**Live wall cap** (`site.WallCap`): 4 demos at once on a laptop, 2 under 48rem or with a coarse pointer. With the main thread throttled 4×, 4 tiles held 60.0 fps and 5 dropped to 58.2 (measured 2026-11-09, headless Chrome); on a 390 px phone proxy 2 held 59.8–60.0 fps.
