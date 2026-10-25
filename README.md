# crowbett.github.io

Source of https://crowbett.github.io: a Go static site generator, project pages, and live in-browser demos built from each project's real code compiled to WebAssembly.

```sh
make serve      # build and serve on http://127.0.0.1:8000
make gate       # gofmt, vet, unit tests, site build + checks, demo binary check
make e2e        # headless Chrome: every page, phone + desktop, demos start; screenshots in e2e/out/
make wasm       # rebuild demo binaries from the commits pinned in demos.lock.json
```

Needs Go 1.27 and, for `make e2e`, Chrome. Project repos are read from `$DEV_ROOT` (default `~/dev`).

Layout: `content/projects/*.md` (one page per project), `templates/`, `web/` (copied as-is: assets, demo UIs, binaries), `cmd/site` (build/serve), `cmd/wasm` (build/check/pin demos), `e2e/`.

Pushing to `main` runs the gate and deploys to GitHub Pages. See `PLAN.md` for the design and `docs/tasks.md` for what is next.
