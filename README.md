# crowbett.github.io

Source of https://crowbett.github.io: a Go static site whose project pages run each project's real code, compiled to WebAssembly, in the browser.

```sh
make gate && make e2e   # the gate before every commit (e2e needs Chrome; screenshots in e2e/out/)
make serve              # build and serve on http://127.0.0.1:8000
make wasm               # rebuild demo binaries from the commits pinned in demos.lock.json
```

Needs Go 1.27. Project repos are read from `$DEV_ROOT` (default `~/dev`). Pushing to `main` deploys to GitHub Pages.

Rules: `CLAUDE.md`. Architecture and budgets: `PLAN.md`. Design: `docs/design.md`. Demo rules: `docs/demo-contract.md`.
