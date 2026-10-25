# Loop prompt

Paste everything below the line into Claude Code, started in `~/dev/crowbett.github.io`.

---

You are building out my personal site, crowbett.github.io: a static Go site where every project page runs that project's real code, compiled to WebAssembly, in the visitor's browser. The repo is scaffolded and the pipeline works end to end. Your job is to work through the task graph until nothing is ready, shipping each task to production as you go.

**Read first, every time you start or resume:** `CLAUDE.md` (rules, non-negotiable), `PLAN.md` (architecture, decisions, budgets), `docs/tasks.md` (the task graph), `docs/demo-contract.md` (how a demo is built). Then `git log --oneline -15` and `git status` to see where things stand. If a task is marked `doing`, finish or reset it before picking another.

**The loop.** Repeat until no task is ready:

1. **Pick.** Take the ready task with the lowest `order` in `docs/tasks.md` (status `todo`, every dep `done`), skipping the Design track: a second session owns it. Never start a `user` task. Mark it `doing`.
2. **Understand.** Read the real code the task touches, in the project repo under `~/dev/<repo>`, before designing anything. Check the project's own `CLAUDE.md` and gate. If the task's assumptions are wrong (an API differs, a package will not build for wasm, the binary blows the budget), stop building and fix the plan: rewrite or split the task in `docs/tasks.md`, or mark it `blocked (evidence)`, then go back to step 1.
3. **Build in the project repo first** (for demo tasks). Put the bridge in `cmd/webdemo` exactly as `docs/demo-contract.md` says: logic in an untagged `handler.go` with tests, a thin `js && wasm` `main.go`, the project's real packages and no reimplemented logic. Run that repo's full gate, commit with a short imperative subject, and push to its existing remote. Never change any repo's visibility and never touch its CI secrets.
4. **Build here.** Add the lock entry, `go run ./cmd/wasm pin <slug> <sha>`, `make wasm`, write `web/demos/<slug>/ui.js`, set `demo: live`, rewrite the page copy to say what the demo actually shows, add `demoChecks` in `e2e/e2e_test.go`.
5. **Verify like a reviewer.** Run `make gate && make e2e`. Then open the screenshots in `e2e/out/` for every page you changed, at both widths, and look at them. Is the demo visibly working, readable, not overflowing, not broken in dark mode? Does every sentence on the page stay true? Is every number quoted from a measured source and cited? Fix what you see and run it again. For a non-trivial change, have the code-reviewer agent review the diff and act on real findings.
6. **Ship.** Commit here (short imperative subject), `git pull --rebase` (the design session pushes too; re-run the gate if anything came in), push `main`, and watch the Pages workflow with `gh run watch`. When it is green, check the live page: `curl` the page and binary for 200, and run the e2e against production if the change touched the demo pipeline. If the deploy fails, fixing it is the next task.
7. **Record.** Mark the task `done` in `docs/tasks.md` with the date and commit SHAs (both repos). Update the status line in `PLAN.md` if it changed. Add follow-ups you found as new `todo` tasks, each with deps and a done-when line. Commit that with the next change or on its own.

**Rules that override speed:**
- Gate chained with `&&`. Never commit on red, never skip e2e, never weaken a check or raise a budget to get green. A budget change is a decision written into PLAN.md with the measured reason.
- No invented numbers. Every metric on the site is quoted from a measured result in the project repo and cites its source. If you measure something new, record how in the project repo first.
- Identity: first name "Corbett" and the email only, nothing else personal.
- quorum, keel and strata stay private: ship their compiled binaries only. Never make a repo public, never copy their source into this repo.
- Demo binaries come only from pushed, pinned commits (`cmd/wasm pin` refuses unpushed ones; do not override it except for a throwaway local test).
- No third-party scripts, fonts, trackers or cookies. Keep the CSP strict.
- Machine: one heavy build at a time (cargo, xcodebuild, big Go builds); no audio; headless browser only, never a visible window or the real mouse.
- Ask me only before something irreversible or outside this repo and the project repos' normal commit-and-push flow. Otherwise decide, record why in the task, and keep going. Do not stop to summarise between tasks.

**When nothing is ready**, end with a short report: the tasks done this session with their commit SHAs and live URLs, anything `blocked` with its evidence, and the `user` tasks waiting on me.
