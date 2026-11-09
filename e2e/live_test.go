//go:build e2e

package e2e

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// workersJS counts the demo workers alive in the page: started minus
// terminated. A worker the page drops without terminating stays counted.
const workersJS = `{
	const W = window.Worker;
	window.__workers = 0;
	window.Worker = class extends W {
		constructor(u, o) { super(u, o); this.__d = String(u).includes("demo-worker"); if (this.__d) window.__workers++; }
		terminate() { if (this.__d && !this.__t) { this.__t = true; window.__workers--; } super.terminate(); }
	};
}`

// liveTab opens url at w x h with n cores, the worker count and focus
// emulation (the reel walks by focus), and collects console errors.
func liveTab(t *testing.T, url string, w, h, n int64) (context.Context, func()) {
	t.Helper()
	ctx, cancel := newTab(t, 90*time.Second)
	var mu sync.Mutex
	var problems []string
	msgs := chromedp.Console(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for m, err := range msgs {
			if err != nil {
				return
			}
			if m.Type == chromedp.ConsoleError || m.Type == chromedp.ConsoleWarning || m.IsException() {
				mu.Lock()
				problems = append(problems, fmt.Sprintf("%s (%s)", m, m.URL))
				mu.Unlock()
			}
		}
	}()
	err := chromedp.Do(ctx,
		cores(n),
		chromedp.Func(func(ctx context.Context, tg *chromedp.Target) error {
			if _, err := cdp.Call(ctx, tg, emulation.SetFocusEmulationEnabled, emulation.SetFocusEmulationEnabledParams{Enabled: true}); err != nil {
				return err
			}
			_, err := cdp.Call(ctx, tg, page.AddScriptToEvaluateOnNewDocument, page.AddScriptToEvaluateOnNewDocumentParams{Source: workersJS})
			return err
		}),
		chromedp.EmulateViewport(w, h, touch(w)...),
		chromedp.Navigate(srv.URL+url),
		chromedp.WaitReady(chromedp.CSS("body")),
	)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	return ctx, func() {
		cancel()
		<-done
		mu.Lock()
		defer mu.Unlock()
		for _, p := range problems {
			t.Error(p)
		}
	}
}

// must runs a check through until and fails the test with what if it does not hold.
func must(t *testing.T, ctx context.Context, what, js string) {
	t.Helper()
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(js), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Fatalf("%s (err %v)", what, err)
	}
}

// noShift fails the test if anything moved on its own since the page loaded.
func noShift(t *testing.T, ctx context.Context, when string) {
	t.Helper()
	type shift struct {
		Sum   float64
		Moved []string
	}
	cls, err := chromedp.Run(ctx, chromedp.Evaluate[shift](clsJS, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatal(err)
	}
	if cls.Sum != 0 {
		t.Errorf("layout shift %.4f %s, want 0; moved: %s", cls.Sum, when, strings.Join(cls.Moved, "; "))
	}
}

// axeOn runs axe on the elements matching sel, where the page is, without
// scrolling (pageQuality scrolls to the top, which stops a live panel).
func axeOn(t *testing.T, ctx context.Context, sel string) {
	t.Helper()
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](axeSource+";true")); err != nil {
		t.Fatalf("inject axe: %v", err)
	}
	found, err := chromedp.Run(ctx, chromedp.Evaluate[[]string](`axe.run(`+jsString(sel)+`, {
		runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
		resultTypes: ["violations"],
	}).then((r) => r.violations.map((v) => v.id + ": " + v.help + " at " + v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")))`, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatalf("axe: %v", err)
	}
	for _, f := range found {
		t.Errorf("axe %s", f)
	}
}

// TestLivePanel runs a home panel's demo in place. Nothing downloads before
// the key is pressed; then the clip gives way to the running demo with no
// layout shift, the key and the dock read Stop, and focus is in the demo.
// One panel runs at a time: covering it with the next panel stops it, and
// so do the code peek and a jump to the index, each terminating its worker.
// The phone tab runs axe on the live panel and checks it fits 390 px.
func TestLivePanel(t *testing.T) {
	t.Parallel()
	for _, vp := range []struct {
		name string
		w, h int64
	}{{"desktop", 1280, 900}, {"phone", 390, 844}} {
		t.Run(vp.name, func(t *testing.T) {
			t.Parallel()
			// Two cores: the stage's own demo does not start, so the count is the panel's.
			ctx, done := liveTab(t, "/", vp.w, vp.h, 2)
			defer done()
			must(t, ctx, "home downloaded a demo before any key was pressed",
				`(async () => { await new Promise((r) => setTimeout(r, 300)); return window.__workers === 0 && !performance.getEntriesByType("resource").some((e) => /\.wasm/.test(e.name)); })()`)
			start := func(slug string) {
				t.Helper()
				must(t, ctx, slug+" did not run in its panel", `(async () => {
					const it = document.querySelector("#p-`+slug+`"), key = it.querySelector(".it-run");
					it.scrollIntoView({ behavior: "instant" });
					await until(() => "now" in it.dataset);
					key.click();
					return until(() => "running" in it.dataset && key.textContent === "Stop" && it.querySelector(".it-live[data-on] .demo-mount").children.length > 0
						&& !it.querySelector(".it-glass video") && document.activeElement === it.querySelector(".it-live .demo-mount")
						&& (innerWidth < 1000 || document.querySelector(".dock-go").textContent === "Stop") && window.__workers === 1);
				})()`)
			}
			start("quorum")
			noShift(t, ctx, "once the panel's demo started")
			must(t, ctx, "quorum's first demo check failed in the panel", demoChecks["quorum"][0])
			if vp.w < 1000 {
				axeOn(t, ctx, ".it-live")
				if over, _ := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth > document.documentElement.clientWidth`)); over {
					t.Errorf("home scrolls horizontally at %dpx with a panel live", vp.w)
				}
				return
			}
			// The code peek puts the clip back.
			must(t, ctx, "opening the code peek did not stop the live panel", `(() => {
				const it = document.querySelector("#p-quorum"), b = it.querySelector(".it-peek");
				b.click();
				return until(() => window.__workers === 0 && !it.querySelector(".it-live") && !("running" in it.dataset) && it.querySelector(".it-run").textContent === "Run it live");
			})()`)
			must(t, ctx, "the code peek did not close", `(() => { const b = document.querySelector("#p-quorum .it-peek"); b.click(); return until(() => b.getAttribute("aria-pressed") === "false"); })()`)
			start("quorum")
			// Starting another panel stops the first; the next panel covering it does too.
			start("keel")
			must(t, ctx, "quorum still ran once keel's panel covered it", `until(() => !document.querySelector("#p-quorum .it-live") && document.querySelector("#p-quorum .it-run").textContent === "Run it live")`)
			must(t, ctx, "a jump to the index left a demo running", `(() => {
				scrollTo({ top: document.querySelector("#all").getBoundingClientRect().top + scrollY, behavior: "instant" });
				return until(() => window.__workers === 0 && !document.querySelector(".it-live") && !document.querySelector("[data-running]"));
			})()`)
		})
	}
}

// TestLiveWall runs the live wall. On a laptop with cores to spare, the
// tiles in view start on their own, never more than the cap, each worker
// belongs to a live tile, and nothing moves as they swap in; Stop holds a
// tile, and tiles that scroll away terminate their workers. On a phone the
// cap is half and axe passes with tiles running. With 2 cores nothing
// starts until Run is pressed.
func TestLiveWall(t *testing.T) {
	t.Parallel()
	active := `document.querySelectorAll(".wt[data-state=loading], .wt[data-state=live]").length`
	t.Run("desktop", func(t *testing.T) {
		t.Parallel()
		ctx, done := liveTab(t, "/live/", 1280, 900, 8)
		defer done()
		must(t, ctx, "the wall did not start the tiles in view up to its cap", `(async () => {
			document.querySelector(".wall-grid").scrollIntoView({ behavior: "instant" });
			const cap = Number(document.querySelector(".wall-grid").dataset.liveCap);
			const ok = () => {
				const live = [...document.querySelectorAll(".wt[data-state=live]")];
				return live.length >= 2 && `+active+` === live.length && window.__workers === live.length && live.length <= cap
					&& live.every((x) => x.querySelector(".wt-live[data-on]") && x.querySelector(".wt-go").textContent === "Stop" && x.getBoundingClientRect().top < innerHeight)
					&& document.querySelector("[data-cap]").textContent === String(cap) && "auto" in document.querySelector("[data-wall-note]").dataset;
			};
			return until(ok);
		})()`)
		noShift(t, ctx, "once tiles started")
		must(t, ctx, "Stop did not hold the tile", `(async () => {
			const x = document.querySelector(".wt[data-state=live]"), n = window.__workers;
			x.querySelector(".wt-go").click();
			await new Promise((r) => setTimeout(r, 800));
			return x.dataset.state === "idle" && !x.querySelector(".wt-live") && window.__workers === n - 1 && x.querySelector(".wt-go").textContent === "Run";
		})()`)
		must(t, ctx, "tiles that left the screen kept their workers", `(() => {
			const first = [...document.querySelectorAll(".wt")].slice(0, 2);
			scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
			return until(() => first.every((x) => x.dataset.state === "idle") && document.querySelector(".wt:last-child").dataset.state === "live"
				&& window.__workers === `+active+` && window.__workers <= Number(document.querySelector(".wall-grid").dataset.liveCap));
		})()`)
	})
	t.Run("phone", func(t *testing.T) {
		t.Parallel()
		ctx, done := liveTab(t, "/live/", 390, 844, 8)
		defer done()
		must(t, ctx, "the phone wall did not run tiles at half the cap", `(() => {
			document.querySelector(".wt").scrollIntoView({ behavior: "instant" });
			const cap = Math.floor(Number(document.querySelector(".wall-grid").dataset.liveCap) / 2);
			return until(() => document.querySelector(".wt[data-state=live]") && document.querySelector("[data-cap]").textContent === String(cap)
				&& window.__workers === `+active+` && window.__workers <= cap);
		})()`)
		axeOn(t, ctx, ".wall")
		if over, _ := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth > document.documentElement.clientWidth`)); over {
			t.Error("the wall scrolls horizontally at 390px")
		}
	})
	t.Run("lean", func(t *testing.T) {
		t.Parallel()
		ctx, done := liveTab(t, "/live/", 1280, 900, 2)
		defer done()
		must(t, ctx, "a tile started on its own with 2 cores, or Run did not start one", `(async () => {
			document.querySelector(".wall-grid").scrollIntoView({ behavior: "instant" });
			await new Promise((r) => setTimeout(r, 800));
			if (window.__workers !== 0 || document.querySelector(".wt[data-state]") || "auto" in document.querySelector("[data-wall-note]").dataset) return false;
			const x = document.querySelector(".wt");
			x.querySelector(".wt-go").click();
			return until(() => x.dataset.state === "live" && window.__workers === 1 && document.activeElement === x.querySelector(".demo-mount"));
		})()`)
	})
}
