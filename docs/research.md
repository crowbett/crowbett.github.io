# Research

Facts this design rests on, with where each came from. "Measured" means run here; "docs" means the vendor's documentation as read on the date.

## Hosting (docs, 2026-10-24)
- GitHub Actions is free for public repositories on standard GitHub-hosted runners (GitHub billing docs). The owner's Pro plan also has 3,000 private minutes/month.
- GitHub Pages limits: published site ≤ 1 GB, soft 100 GB/month bandwidth, soft 10 builds/hour (does not apply to custom Actions workflows), 10-minute deploy timeout.
- Pages serves no custom response headers, so CSP is a `<meta>` tag (no `frame-ancestors`, no COOP/COEP, so no `SharedArrayBuffer`).
- Unverified: whether Pages compresses `.wasm` responses. Task S2 measures it.

## Go WebAssembly (measured, Go 1.27.0, 2026-10-24)
- `smoke` (syscall/js + encoding/json + runtime), `-trimpath -ldflags=-s -w`: 4,389,028 bytes, 1,217,768 gzip -9.
- Packages that build for `GOOS=js GOARCH=wasm` as of the pinned HEADs: ratelimitd `internal/algo/{gcra,slidingwindow,tokenbucket}`, edgecache `internal/rfc9111` and its memory store, quorum `internal/sim` and `raft`, jobrun `internal/cronx` and `scheduler`, kvlite (builds, but needs a filesystem at run time: see task D4).
- `wasm_exec.js` ships in `$(go env GOROOT)/lib/wasm/` and must match the compiler that built the binary.

## Showcase platform demand (2026-10-24)
Full report: `~/Documents/map-reports/showcase-platform-research.md` (outside this repo). Verdict: weak, no proven paid demand for a developer-pays "repos in action" platform.
- Closest comp, VibeCoders ($29 lifetime dev portfolio): TrustMRR shows $29 all-time revenue, no subscriptions, founded Dec 2025 (fetched and re-checked 2026-10-24).
- Glitch ended app hosting 2025-07-08, citing hosting cost and abuse (BleepingComputer).
- Individual developer tiers elsewhere top out around $8-12/month (CodePen); money sits with teams, compute and docs tooling (Mintlify ~$21M ARR, a Sacra estimate).
- Adjacent angle if ever revisited: in-browser playgrounds embedded in OSS/SDK docs, sold per project. Unvalidated.
