# crowbett.github.io

Personal site at https://crowbett.github.io: project pages plus live demos that run each project's real code as WebAssembly in the browser. Architecture and decisions: `PLAN.md`. Work queue: `docs/tasks.md`. Demo rules: `docs/demo-contract.md`.

## Rules
- Gate before every commit: `make gate && make e2e`. Never pipe or `;` the gate.
- Every number on the site is quoted from a measured source in the project repo and cites it (`metric_source`). Never invent, round up or extrapolate a number.
- Published identity is first name "Corbett" and the email only. No surname, photo, resume, LinkedIn or location.
- Never change any repo's visibility. quorum, keel and strata stay private; the site ships their compiled binaries only and says "source available on request".
- Demo binaries are built locally with `make wasm` from commits pinned in `demos.lock.json` (`go run ./cmd/wasm pin <slug> <sha>`), never from a dirty tree. CI only verifies them.
- Budgets in `internal/site/check.go` are hard limits. Raising one is a recorded decision in `PLAN.md`.
- No third-party scripts, fonts, analytics or cookies. The CSP in `templates/layout.html` stays strict; no inline scripts or style attributes.
- A UI claim must stay true: if a page says something is live, measured or available, it is.
- Keep files under 1000 lines and comments minimal.
