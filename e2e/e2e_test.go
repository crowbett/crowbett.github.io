//go:build e2e

// Package e2e drives the built site in headless Chrome: every page loads with
// no console errors or CSP violations, fits a phone width without horizontal
// scroll, loads without layout shift, and every live demo starts and reports
// ready. Screenshots of each page, desktop and phone, light and dark, land in
// e2e/out/ for review.
//
//	go test -tags e2e ./e2e
package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/chromedp"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

// demoChecks holds, per demo slug, JavaScript expressions that must all be
// true (or resolve true) once the demo reports ready. Every live demo adds
// at least one check that proves it rendered real output from its binary.
var demoChecks = map[string][]string{
	"smoke": {`document.querySelector(".demo-out").textContent.includes("answered: hello from the page")`},
	"ratelimitd": {
		`[...document.querySelectorAll(".rl-chart")].map(c => c.dataset.algo).join() === "gcra,token_bucket,sliding_window"`,
		`[...document.querySelectorAll(".rl-chart")].every(c => c.querySelectorAll("rect.rl-allowed").length > 20 && c.querySelectorAll("rect.rl-denied").length > 0)`,
		`/^1,\d{3} requests through 3 algorithms/.test(document.querySelector(".rl-status").textContent)`,
	},
	"edgecache": {
		`[...document.querySelectorAll(".ec-table .ec-badge")].map(b => b.textContent).join() === "MISS,HIT,REVALIDATED,HIT"`,
		`[...document.querySelectorAll(".ec-table td.ec-origin")].map(c => c.textContent).join("|") === "GET → 200|none|conditional GET → 304|none"`,
		`document.querySelectorAll(".ec-timeline rect.ec-mark").length === 4`,
		`(async () => {
			const s = document.querySelector("select[name=preset]");
			const col = (sel) => [...document.querySelectorAll(sel)].map((c) => c.textContent).join();
			const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); return f(); };
			const pick = (v) => { s.value = v; s.dispatchEvent(new Event("change")); };
			pick("no-store");
			const ok = await until(() => col(".ec-table .ec-badge") === "MISS,BYPASS,HIT" && col(".ec-table td.ec-body") === "version 1,version 2,version 1");
			pick("max-age");
			return ok && await until(() => col(".ec-table .ec-badge") === "MISS,HIT,REVALIDATED,HIT");
		})()`,
	},
}

var viewports = []struct {
	name          string
	width, height int64
}{
	{"desktop", 1280, 900},
	{"phone", 390, 844},
}

// schemes are emulated explicitly: an unset scheme follows the host OS, so a
// dark machine would never shoot the light theme.
var schemes = []string{"light", "dark"}

func TestSite(t *testing.T) {
	t.Parallel()
	out := t.TempDir()
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	cfg := site.Config{Src: os.DirFS(root), Out: out, Owner: site.DefaultOwner, Now: time.Now()}
	if err := site.Build(cfg); err != nil {
		t.Fatal(err)
	}
	if err := site.Check(out); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.FileServer(http.Dir(out)))
	defer srv.Close()

	shots := filepath.Join(root, "e2e", "out")
	if err := os.RemoveAll(shots); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(shots, 0o755); err != nil {
		t.Fatal(err)
	}

	pages := []string{"/", "/404.html", "/demos/smoke/"}
	projects, err := site.LoadProjects(os.DirFS(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range projects {
		pages = append(pages, "/projects/"+p.Slug+"/")
	}

	alloc, cancel := chromedp.NewExecAllocator(context.Background(), allocOpts()...)
	defer cancel()
	browser, cancelB := chromedp.NewContext(alloc)
	defer cancelB()
	if err := chromedp.Do(browser); err != nil {
		t.Fatal(err)
	}

	// One browser, one tab per page, viewport and scheme, all in parallel.
	t.Run("pages", func(t *testing.T) {
		for _, page := range pages {
			for _, vp := range viewports {
				for _, scheme := range schemes {
					shot := name(page) + "-" + vp.name + "-" + scheme
					t.Run(name(page)+"/"+vp.name+"/"+scheme, func(t *testing.T) {
						t.Parallel()
						visit(t, browser, srv.URL+page, vp.width, vp.height, scheme, filepath.Join(shots, shot))
					})
				}
			}
		}
	})
}

// TestDemoFailures drives the smoke binary's hang and panic methods: a stuck
// call must time out and kill the worker, and a crash must surface a clear
// error instead of a JSON parse failure.
func TestDemoFailures(t *testing.T) {
	t.Parallel()
	ctx := smokePage(t)
	type result struct {
		Hang, After, Panic, AfterPanic string
		HangMs, AfterMs                float64
	}
	r, err := chromedp.Run(ctx, chromedp.Evaluate[result](`(async () => {
		const m = await import("/assets/demo.js");
		const msg = (p) => p.then(() => "resolved", (e) => e.message);
		const out = {};
		const d = await m.connect("smoke", { callTimeoutMs: 1500 });
		let t = performance.now();
		out.Hang = await msg(d.call("hang"));
		out.HangMs = performance.now() - t;
		t = performance.now();
		out.After = await msg(d.call("ping", { echo: "x" }));
		out.AfterMs = performance.now() - t;
		const p = await m.connect("smoke");
		out.Panic = await msg(p.call("panic"));
		out.AfterPanic = await msg(p.call("ping", { echo: "x" }));
		p.close();
		return out;
	})()`, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(r.Hang, "did not answer hang") || r.HangMs > 5000 {
		t.Errorf("hang: got %q after %.0f ms, want a timeout near 1.5 s", r.Hang, r.HangMs)
	}
	if !strings.Contains(r.After, "did not answer hang") || r.AfterMs > 100 {
		t.Errorf("call after a timeout: got %q after %.0f ms, want an immediate rejection", r.After, r.AfterMs)
	}
	if r.Panic == "resolved" || strings.Contains(r.Panic, "JSON") {
		t.Errorf("panic: got %q, want a clear crash error", r.Panic)
	}
	if r.AfterPanic == "resolved" {
		t.Error("a call after a panic succeeded")
	}
	t.Logf("%+v", r)
}

// TestDemoFrame drives the frame around a demo on the smoke page: progress
// reports real decompressed bytes up to the binary's raw size, a failed start
// shows the error and moves focus to the retry button, and a retry with a
// fresh worker ends ready with focus inside the demo.
func TestDemoFrame(t *testing.T) {
	t.Parallel()
	raw := lockBytes(t, "smoke")
	ctx := smokePage(t)
	type result struct {
		Error, Button, Focus, ErrorBg string
		Seen                          []int
		Loaded                        int
		ReadyFocus                    bool
		Out                           string
	}
	r, err := chromedp.Run(ctx, chromedp.Evaluate[result](`(async () => {
		const s = document.querySelector("[data-demo]");
		const button = s.querySelector("[data-demo-start]");
		const until = (f) => new Promise((resolve) => { const t = setInterval(() => { if (f()) { clearInterval(t); resolve(); } }, 20); });
		const out = {};
		s.dataset.demo = "missing";
		button.click();
		await until(() => "demoError" in s.dataset);
		const status = s.querySelector("[data-demo-status]");
		out.Error = status.textContent;
		out.Button = button.textContent;
		out.Focus = document.activeElement === button ? "button" : document.activeElement.outerHTML.slice(0, 80);
		out.ErrorBg = getComputedStyle(status).backgroundColor;
		out.Seen = [];
		new MutationObserver(() => out.Seen.push(Number(s.dataset.demoLoaded)))
			.observe(s, { attributes: true, attributeFilter: ["data-demo-loaded"] });
		s.dataset.demo = "smoke";
		button.click();
		await until(() => "demoReady" in s.dataset || "demoError" in s.dataset);
		out.Loaded = Number(s.dataset.demoLoaded);
		out.ReadyFocus = s.querySelector("[data-demo-mount]").contains(document.activeElement);
		out.Out = s.querySelector("[data-demo-mount]").textContent;
		return out;
	})()`, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(r.Error, "failed to start") || !strings.Contains(r.Error, "HTTP 404") {
		t.Errorf("forced failure: status %q, want the start failure and the HTTP 404", r.Error)
	}
	if r.Button != "Try again" || r.Focus != "button" {
		t.Errorf("after a failure: button %q, focus on %s; want focus on Try again", r.Button, r.Focus)
	}
	if r.ErrorBg == "" || r.ErrorBg == "rgba(0, 0, 0, 0)" {
		t.Errorf("error status is unstyled (background %q)", r.ErrorBg)
	}
	if !strings.Contains(r.Out, "answered: hello from the page") {
		t.Errorf("retry did not reach ready: mount %q", r.Out)
	}
	if r.Loaded != raw {
		t.Errorf("progress ended at %d bytes, want the raw binary size %d", r.Loaded, raw)
	}
	if len(r.Seen) < 2 || r.Seen[0] <= 0 || r.Seen[0] >= raw {
		t.Errorf("progress reported %v, want an intermediate count before %d", r.Seen, raw)
	}
	for i := 1; i < len(r.Seen); i++ {
		if r.Seen[i] < r.Seen[i-1] {
			t.Errorf("progress went backwards: %v", r.Seen)
		}
	}
	if !r.ReadyFocus {
		t.Error("focus is not inside the demo after it started")
	}
}

// TestReducedMotion loads pages whose diagrams play on load, and the smoke
// demo whose frame animates on ready: with motion allowed something animates,
// with prefers-reduced-motion nothing does.
func TestReducedMotion(t *testing.T) {
	t.Parallel()
	srv := serveSite(t)
	alloc, cancelA := chromedp.NewExecAllocator(context.Background(), allocOpts()...)
	defer cancelA()
	browser, cancelB := chromedp.NewContext(alloc)
	defer cancelB()
	for _, page := range []string{"/", "/projects/quorum/", "/demos/smoke/"} {
		for _, motion := range []string{"no-preference", "reduce"} {
			ctx, cancel := chromedp.NewContext(browser)
			ctx, cancelT := context.WithTimeout(ctx, 60*time.Second)
			err := chromedp.Do(ctx,
				chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
					_, err := cdp.Call(ctx, t, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{
						Features: []*emulation.MediaFeature{{Name: "prefers-reduced-motion", Value: motion}},
					})
					return err
				}),
				chromedp.Navigate(srv.URL+page),
				chromedp.WaitReady(chromedp.CSS("body")),
			)
			if err != nil {
				t.Fatal(err)
			}
			n, err := chromedp.Run(ctx, chromedp.Evaluate[int](`(async () => {
				const s = document.querySelector("[data-demo]");
				if (s) {
					s.querySelector("[data-demo-start]").click();
					await new Promise((r) => { const t = setInterval(() => { if ("demoReady" in s.dataset) { clearInterval(t); r(); } }, 10); });
				} else {
					document.querySelector(".feature, .facts")?.scrollIntoView({ block: "center" });
					await new Promise((r) => setTimeout(r, 400));
				}
				return document.getAnimations().length;
			})()`, chromedp.EvalAwaitPromise))
			cancelT()
			cancel()
			if err != nil {
				t.Fatal(err)
			}
			if motion == "reduce" && n != 0 {
				t.Errorf("%s: %d animations run with reduced motion", page, n)
			}
			if motion != "reduce" && n == 0 {
				t.Errorf("%s: nothing animates with motion allowed, so the reduced-motion check proves nothing", page)
			}
		}
	}
}

// serveSite builds the site and serves it until the test ends.
func serveSite(t *testing.T) *httptest.Server {
	t.Helper()
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	out := t.TempDir()
	if err := site.Build(site.Config{Src: os.DirFS(root), Out: out, Owner: site.DefaultOwner, Now: time.Now()}); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.FileServer(http.Dir(out)))
	t.Cleanup(srv.Close)
	return srv
}

// smokePage serves the site and opens the smoke demo page.
func smokePage(t *testing.T) context.Context {
	t.Helper()
	srv := serveSite(t)
	alloc, cancelA := chromedp.NewExecAllocator(context.Background(), allocOpts()...)
	t.Cleanup(cancelA)
	ctx, cancel := chromedp.NewContext(alloc)
	t.Cleanup(cancel)
	ctx, cancelT := context.WithTimeout(ctx, 90*time.Second)
	t.Cleanup(cancelT)
	if err := chromedp.Do(ctx, chromedp.Navigate(srv.URL+"/demos/smoke/")); err != nil {
		t.Fatal(err)
	}
	return ctx
}

func lockBytes(t *testing.T, slug string) int {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "demos.lock.json"))
	if err != nil {
		t.Fatal(err)
	}
	var lock struct {
		Demos []struct {
			Slug  string `json:"slug"`
			Bytes int    `json:"bytes"`
		} `json:"demos"`
	}
	if err := json.Unmarshal(b, &lock); err != nil {
		t.Fatal(err)
	}
	for _, d := range lock.Demos {
		if d.Slug == slug && d.Bytes > 0 {
			return d.Bytes
		}
	}
	t.Fatalf("demos.lock.json has no size for %s", slug)
	return 0
}

// allocOpts runs Chrome headless and muted. Ubuntu runners block Chrome's
// user-namespace sandbox, so CI (CI=true on GitHub Actions) runs without it;
// the pages under test are our own. CI also names google-chrome: chromedp
// would otherwise pick the runner's /usr/bin/chromium, which took 25 s to
// cold-start against 1.3 s for Chrome (measured on ubuntu-24.04, 2026-10-24).
func allocOpts() []chromedp.ExecAllocatorOption {
	opts := append(chromedp.DefaultExecAllocatorOptions[:], chromedp.Flag("mute-audio", true))
	if os.Getenv("CI") != "" {
		opts = append(opts, chromedp.ExecPath("google-chrome"), chromedp.NoSandbox, chromedp.CombinedOutput(os.Stderr))
	}
	return opts
}

// tabMu serializes opening tabs: Chrome opened 8 concurrent tabs in 4.6 s
// each against 0.2-0.7 s one at a time, and the whole run took 10-13 s with
// it against 20-31 s without (measured locally, 2026-10-24).
var tabMu sync.Mutex

func visit(t *testing.T, browser context.Context, url string, w, h int64, scheme, shot string) {
	ctx, cancel := chromedp.NewContext(browser)
	defer cancel()
	ctx, cancelT := context.WithTimeout(ctx, 90*time.Second)
	defer cancelT()
	tabMu.Lock()
	err := chromedp.Do(ctx)
	tabMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

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

	err = chromedp.Do(ctx,
		chromedp.EmulateViewport(w, h),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{
				Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: scheme}},
			})
			return err
		}),
		chromedp.Navigate(url),
		chromedp.WaitReady(chromedp.CSS("body")),
	)
	if err != nil {
		t.Fatal(err)
	}
	// Layout shift is measured before any demo starts: a demo grows its frame
	// when the visitor runs it, which is content they asked for.
	cls, err := chromedp.Run(ctx, chromedp.Evaluate[float64](`new Promise((resolve) => {
		let sum = 0;
		new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) sum += e.value; })
			.observe({ type: "layout-shift", buffered: true });
		setTimeout(() => resolve(sum), 50);
	})`, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatal(err)
	}
	if cls != 0 {
		t.Errorf("cumulative layout shift %.4f, want 0", cls)
	}
	hasDemo, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector("[data-demo]") !== null`))
	if err != nil {
		t.Fatal(err)
	}
	if hasDemo {
		err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS("[data-demo-start]")))
		if err == nil {
			_, err = chromedp.Run(ctx, chromedp.Poll[bool](`document.querySelector("[data-demo-ready],[data-demo-error]") !== null`,
				chromedp.WithPollingTimeout(60*time.Second)))
		}
		if err != nil {
			t.Fatalf("demo did not start: %v", err)
		}
		if errored, _ := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector("[data-demo-error]") !== null`)); errored {
			status, _ := chromedp.Run(ctx, chromedp.Text(chromedp.CSS("[data-demo-status]")))
			t.Fatalf("demo failed: %s", status)
		}
		slug, err := chromedp.Run(ctx, chromedp.Evaluate[string](`document.querySelector("[data-demo]").dataset.demo`))
		if err != nil {
			t.Fatal(err)
		}
		checks := demoChecks[slug]
		if len(checks) == 0 {
			t.Errorf("demo %q has no entry in demoChecks", slug)
		}
		for _, js := range checks {
			if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](js, chromedp.EvalAwaitPromise)); err != nil || !ok {
				t.Errorf("demo check failed: %s (err %v)", js, err)
			}
		}
	}
	// axe at phone width in both schemes (contrast follows the scheme, reflow
	// problems show at 390 px); the Tab walk at desktop. Splitting them keeps
	// CI under its 60 s budget.
	if w < 1000 {
		pageQuality(t, ctx)
	} else if scheme == "light" {
		tabOrder(t, ctx)
	}
	overflow, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth > document.documentElement.clientWidth`))
	if err != nil {
		t.Fatal(err)
	}
	if overflow {
		t.Errorf("page scrolls horizontally at %dpx", w)
	}
	img, err := chromedp.Run(ctx, chromedp.FullScreenshot(80))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(shot+".jpg", img, 0o644); err != nil {
		t.Fatal(err)
	}
	cancelT()
	<-done
	mu.Lock()
	defer mu.Unlock()
	for _, p := range problems {
		t.Error(p)
	}
}

var nonWord = regexp.MustCompile(`[^a-z0-9]+`)

func name(page string) string {
	n := strings.Trim(nonWord.ReplaceAllString(strings.ToLower(page), "-"), "-")
	if n == "" {
		return "home"
	}
	return n
}
