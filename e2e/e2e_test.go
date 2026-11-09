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
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

// untilJS binds until(f) for a demo check: it resolves true once f() holds
// and otherwise throws naming f after 20 s. A strata re-slice on a busy CI
// runner outlasted the old 5 s, and a bare false hid which step it was. A
// throw counts as not yet (the element may not be mounted), and every check
// without side effects polls through until, so none races a slow mount.
func untilJS(check string) string {
	return "((until) => (" + check + `))(async (f) => {
		const ok = () => { try { return f(); } catch { return false; } };
		for (const end = Date.now() + 20000; !ok(); await new Promise((r) => setTimeout(r, 50)))
			if (Date.now() > end) { f(); throw new Error("timed out: " + f); }
		return true;
	})`
}

// layoutOnly viewports check page layout (overflow, CLS, a screenshot) and
// leave demos and axe to desktop and phone, which already cover them: running
// demos on a third width pushed CI past its 60 s budget. Demo behaviour does
// not depend on the scheme: light tabs run every check, dark tabs mount the
// demo and run its first check.
var viewports = []struct {
	name          string
	width, height int64
	layoutOnly    bool
}{
	{"desktop", 1280, 900, false},
	{"tablet", 820, 1180, true},
	{"phone", 390, 844, false},
}

// schemes are emulated explicitly: an unset scheme follows the host OS, so a
// dark machine would never shoot the light theme.
var schemes = []string{"light", "dark"}

// keepShots is false on CI, which keeps no screenshots: it skips taking them,
// and skips dark tabs at desktop and tablet, whose layout matches light and
// whose demo and axe checks run elsewhere (phone dark, desktop light).
var keepShots = os.Getenv("CI") == "" && os.Getenv("E2E_NOSHOTS") == ""

// The package builds the site once and starts one Chrome for every test:
// each extra Chrome cost a cold start on CI (F2 in docs/tasks.md).
var (
	root    string
	siteOut string
	srv     *httptest.Server
	browser context.Context
)

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) (code int) {
	var err error
	if root, err = filepath.Abs(".."); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if siteOut, err = os.MkdirTemp("", "e2e-site-"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer os.RemoveAll(siteOut)
	// Chrome starts while the site builds: a cold start took up to ~13 s on CI.
	start := time.Now()
	built := make(chan error, 1)
	var build time.Duration
	go func() {
		err := site.Build(site.Config{Src: os.DirFS(root), Out: siteOut, Owner: site.DefaultOwner, Now: time.Now()})
		build = time.Since(start)
		built <- err
	}()
	// Chrome's own output goes to stderr on CI and to a file locally, kept
	// for a failed run (F3 in docs/tasks.md).
	var chromeLog io.Writer = os.Stderr
	if os.Getenv("CI") == "" {
		f, err := os.Create(filepath.Join(os.TempDir(), "crowbett-e2e-chrome.log"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		defer f.Close()
		chromeLog = f
		defer func() {
			if code != 0 {
				fmt.Fprintln(os.Stderr, "Chrome output:", f.Name())
			}
		}()
	}
	alloc, cancelA := chromedp.NewExecAllocator(context.Background(), allocOpts(chromeLog)...)
	defer cancelA()
	b, cancelB := chromedp.NewContext(alloc)
	defer cancelB()
	if err := chromedp.Do(b); err != nil {
		fmt.Fprintln(os.Stderr, "start Chrome:", err)
		return 1
	}
	chrome := time.Since(start)
	if err := <-built; err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "e2e setup: Chrome up in %v, site built in %v\n", chrome.Round(time.Millisecond), build.Round(time.Millisecond))
	srv = httptest.NewServer(http.FileServer(http.Dir(siteOut)))
	defer srv.Close()
	browser = b
	return m.Run()
}

// TestSiteCheck runs the build checks on the site under test, beside the
// page visits rather than ahead of them (F5 in docs/tasks.md).
func TestSiteCheck(t *testing.T) {
	t.Parallel()
	if err := site.Check(siteOut); err != nil {
		t.Fatal(err)
	}
}

func TestSite(t *testing.T) {
	t.Parallel()
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
	// E2E_PAGE=/projects/<slug>/ runs one page, for iterating on one demo.
	if only := os.Getenv("E2E_PAGE"); only != "" {
		pages = slices.DeleteFunc(pages, func(p string) bool { return p != only })
	}

	// One tab per page, viewport and scheme, all in parallel. The slowest tabs
	// start first so they do not run on alone at the end: desktop and phone
	// light, which run every demo check, then the pages with the most checks
	// (home renders the stage and walks the index).
	type tab struct {
		page, scheme string
		vp           int
	}
	var tabs []tab
	for _, page := range pages {
		for vi, vp := range viewports {
			for _, scheme := range schemes {
				if keepShots || scheme == "light" || vp.name == "phone" {
					tabs = append(tabs, tab{page, scheme, vi})
				}
			}
		}
	}
	cost := func(x tab) int {
		n := len(demoChecks[strings.TrimSuffix(strings.TrimPrefix(x.page, "/projects/"), "/")])
		if x.page == "/" {
			n = 99
		}
		if !viewports[x.vp].layoutOnly && x.scheme == "light" {
			n += 1000
		}
		if viewports[x.vp].layoutOnly || x.scheme == "dark" && viewports[x.vp].name != "phone" {
			n -= 1000
		}
		return n
	}
	slices.SortStableFunc(tabs, func(a, b tab) int { return cost(b) - cost(a) })
	// CI splits the tabs across runners: E2E_SHARD=i/n keeps every nth tab.
	shard, shards := 0, 1
	if s := os.Getenv("E2E_SHARD"); s != "" {
		if _, err := fmt.Sscanf(s, "%d/%d", &shard, &shards); err != nil || shard < 0 || shard >= shards {
			t.Fatalf("E2E_SHARD=%q, want i/n with 0 <= i < n", s)
		}
	}
	// Twelve workers take tabs in that order; t.Parallel starts them in no
	// particular order.
	queue := make(chan tab, len(tabs))
	for i, x := range tabs {
		if i%shards == shard {
			queue <- x
		}
	}
	close(queue)
	t.Run("pages", func(t *testing.T) {
		var wg sync.WaitGroup
		for range 12 {
			wg.Go(func() {
				for x := range queue {
					vp := viewports[x.vp]
					shot := name(x.page) + "-" + vp.name + "-" + x.scheme
					t.Run(name(x.page)+"/"+vp.name+"/"+x.scheme, func(t *testing.T) {
						visit(t, srv.URL+x.page, vp.width, vp.height, vp.layoutOnly, x.scheme, filepath.Join(shots, shot))
					})
				}
			})
		}
		wg.Wait()
	})
}

// TestDemoFailures drives each smoke binary (Go and Rust) through the worker:
// a ping answers, a stuck call must time out and kill the worker, and a crash
// must surface a clear error instead of a JSON parse failure.
func TestDemoFailures(t *testing.T) {
	t.Parallel()
	for slug, lang := range map[string]string{"smoke": "go", "smoke-rs": "rust"} {
		t.Run(slug, func(t *testing.T) {
			t.Parallel()
			demoFailures(t, slug, lang)
		})
	}
}

func demoFailures(t *testing.T, slug, lang string) {
	ctx := smokePage(t)
	type result struct {
		Ping                           map[string]string
		Hang, After, Panic, AfterPanic string
		HangMs                         float64
	}
	r, err := chromedp.Run(ctx, chromedp.Evaluate[result](`(async (slug) => {
		const m = await import("/assets/demo.js");
		const msg = (p) => p.then(() => "resolved", (e) => e.message);
		const out = {};
		const d = await m.connect(slug, { callTimeoutMs: 1500 });
		out.Ping = await d.call("ping", { echo: "x" });
		let t = performance.now();
		out.Hang = await msg(d.call("hang"));
		out.HangMs = performance.now() - t;
		// A rejection that settles before any timer fires waited for nothing.
		out.After = await Promise.race([msg(d.call("ping", { echo: "x" })),
			new Promise((r) => setTimeout(() => r("still pending after a timer tick"), 0))]);
		const p = await m.connect(slug);
		out.Panic = await msg(p.call("panic"));
		out.AfterPanic = await msg(p.call("ping", { echo: "x" }));
		p.close();
		return out;
	})(`+strconv.Quote(slug)+`)`, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatal(err)
	}
	if r.Ping["echo"] != "x" || r.Ping[lang] == "" {
		t.Errorf("ping: got %v, want echo x and a %s version", r.Ping, lang)
	}
	if !strings.Contains(r.Hang, "did not answer hang") || r.HangMs > 5000 {
		t.Errorf("hang: got %q after %.0f ms, want a timeout near 1.5 s", r.Hang, r.HangMs)
	}
	if !strings.Contains(r.After, "did not answer hang") {
		t.Errorf("call after a timeout: got %q, want the timeout error before any timer fires", r.After)
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

// TestReducedMotion loads pages whose diagrams play on load (and home, whose
// stage renders on its own and whose monitor plays clips), and the smoke demo
// whose frame animates on ready: with motion allowed something animates, with
// prefers-reduced-motion nothing does, no clip loads and the stage waits.
func TestReducedMotion(t *testing.T) {
	t.Parallel()
	for _, page := range []string{"/", "/projects/quorum/", "/demos/smoke/"} {
		for _, motion := range []string{"no-preference", "reduce"} {
			t.Run(name(page)+"/"+motion, func(t *testing.T) {
				t.Parallel()
				ctx, cancel := newTab(t, 60*time.Second)
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
						document.querySelector("#p-quorum, .facts .dm")?.scrollIntoView({ block: "center" });
						await new Promise((r) => setTimeout(r, 400));
						document.querySelector("#p-netcode")?.scrollIntoView({ block: "center" });
						await new Promise((r) => setTimeout(r, 400));
					}
					const f = document.querySelector("[data-stage]");
					return document.getAnimations().length + document.querySelectorAll(".it video").length + (f && "live" in f.dataset ? 1 : 0);
				})()`, chromedp.EvalAwaitPromise))
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
			})
		}
	}
}

// smokePage opens the smoke demo page in a new tab.
func smokePage(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := newTab(t, 90*time.Second)
	t.Cleanup(cancel)
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
func allocOpts(chromeLog io.Writer) []chromedp.ExecAllocatorOption {
	// Software rendering: on macOS the GPU process hung for ~2 min under load
	// and stalled every tab until Chrome restarted it (F3 in docs/tasks.md).
	// E2E_GPU=1 keeps the GPU on locally, to check a GPU-only fault (F6).
	opts := append(chromedp.DefaultExecAllocatorOptions[:], chromedp.Flag("mute-audio", true), chromedp.CombinedOutput(chromeLog))
	if os.Getenv("E2E_GPU") == "" {
		opts = append(opts, chromedp.DisableGPU)
	}
	if os.Getenv("CI") != "" {
		opts = append(opts, chromedp.ExecPath("google-chrome"), chromedp.NoSandbox)
	}
	return opts
}

// tabMu serializes opening tabs: Chrome opened 8 concurrent tabs in 4.6 s
// each against 0.2-0.7 s one at a time, and the whole run took 10-13 s with
// it against 20-31 s without (measured locally, 2026-10-24).
var tabMu sync.Mutex

// newTab opens a tab in the shared Chrome that closes at cancel or after d.
func newTab(t *testing.T, d time.Duration) (context.Context, context.CancelFunc) {
	t.Helper()
	ctx, cancelTab := chromedp.NewContext(browser)
	ctx, cancelT := context.WithTimeout(ctx, d)
	cancel := func() { cancelT(); cancelTab() }
	queued := time.Now()
	tabMu.Lock()
	opening := time.Now()
	err := chromedp.Do(ctx)
	tabMu.Unlock()
	if open := time.Since(opening); open > 5*time.Second {
		t.Logf("opening a tab took %v after %v waiting for the lock", open.Round(time.Millisecond), opening.Sub(queued).Round(time.Millisecond))
	}
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	return ctx, cancel
}

// idle holds tabs that page visits reuse: opening a tab took 0.1-0.9 s on
// CI, one at a time behind tabMu, and gated the whole run (F5 in
// docs/tasks.md). Each visit still loads its page fresh.
var idle = make(chan idleTab, 64)

type idleTab struct {
	ctx   context.Context
	close context.CancelFunc
}

// visitTab hands out an idle tab, or opens one, with a deadline of d. Release
// with reuse true puts the tab back blank; false, or a failed blanking, closes it.
func visitTab(t *testing.T, d time.Duration) (ctx context.Context, release func(reuse bool)) {
	var tab idleTab
	select {
	case tab = <-idle:
	default:
		tab.ctx, tab.close = newTab(t, time.Hour)
	}
	ctx, cancel := context.WithTimeout(tab.ctx, d)
	return ctx, func(reuse bool) {
		cancel()
		if reuse {
			blank, cancelBlank := context.WithTimeout(tab.ctx, 10*time.Second)
			reuse = chromedp.Do(blank, chromedp.Navigate("about:blank")) == nil
			cancelBlank()
		}
		if !reuse {
			tab.close()
			return
		}
		select {
		case idle <- tab:
		default:
			tab.close()
		}
	}
}

// cores sets the navigator.hardwareConcurrency the tab reports.
func cores(n int64) chromedp.Action[chromedp.Void] {
	return chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
		_, err := cdp.Call(ctx, t, emulation.SetHardwareConcurrencyOverride, emulation.SetHardwareConcurrencyOverrideParams{HardwareConcurrency: n})
		return err
	})
}

// clsJS sums the page's layout shifts so far, leaving out shifts that
// followed input, and names what moved.
const clsJS = `new Promise((resolve) => {
		const out = { Sum: 0, Moved: [] };
		const box = (r) => [r.x, r.y, r.width, r.height].map(Math.round).join(",");
		new PerformanceObserver((l) => {
			for (const e of l.getEntries()) {
				if (e.hadRecentInput) continue;
				out.Sum += e.value;
				for (const s of e.sources) out.Moved.push((s.node?.outerHTML ?? (s.node ? "#text in " + s.node.parentElement?.outerHTML : "#gone")).slice(0, 120) + " " + box(s.previousRect) + " -> " + box(s.currentRect) + " at " + Math.round(e.startTime) + " ms");
			}
		}).observe({ type: "layout-shift", buffered: true });
		setTimeout(() => resolve(out), 50);
	})`

func visit(t *testing.T, url string, w, h int64, layoutOnly bool, scheme, shot string) {
	tab, release := visitTab(t, 90*time.Second)
	defer func() { release(!t.Failed()) }()
	ctx, cancel := context.WithCancel(tab)
	defer cancel()

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

	// A project head starts its demo on its own on 4+ cores. Desktop light
	// checks that path; every other tab reports 2 cores so its demo waits
	// for the key (phone) or never starts (layout tabs), keeping CI's CPU for
	// the checks.
	auto := w >= 1000 && !layoutOnly && scheme == "light"
	n := int64(2)
	if auto || !strings.Contains(url, "/projects/") {
		n = 8
	}
	// Home walks its reel by focus. A tab Chrome runs in the background gets
	// no focus events, so the home tabs act as the focused tab a visitor has.
	home := url == srv.URL+"/"
	err := chromedp.Do(ctx,
		cores(n),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetFocusEmulationEnabled, emulation.SetFocusEmulationEnabledParams{Enabled: home})
			return err
		}),
		chromedp.EmulateViewport(w, h, touch(w)...),
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
	// Layout shift is measured before any demo starts, and again on desktop
	// light once the head's demo has started on its own.
	type shift struct {
		Sum   float64
		Moved []string
	}
	cls, err := chromedp.Run(ctx, chromedp.Evaluate[shift](clsJS, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatal(err)
	}
	if cls.Sum != 0 {
		t.Errorf("cumulative layout shift %.4f, want 0; moved: %s", cls.Sum, strings.Join(cls.Moved, "; "))
	}
	hasDemo, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector("[data-demo]") !== null`))
	if err != nil {
		t.Fatal(err)
	}
	// Dark tabs start the demo only at phone width, where axe checks its
	// contrast; desktop dark shares the light layout. Tablet starts it only
	// for local screenshots, so a running demo is seen at iPad width.
	if hasDemo && (!layoutOnly || keepShots) && (scheme == "light" || w < 1000) {
		// Desktop light waits for the head's demo to start on its own, with no
		// shift and focus left alone. Phone checks the recording plays in the
		// frame, then uses the frame's own key.
		var err error
		head, _ := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector("[data-autostart]") !== null`))
		if auto && head {
			_, err = chromedp.Run(ctx, chromedp.Poll[bool](`document.querySelector("[data-demo-ready],[data-demo-error]") !== null`,
				chromedp.WithPollingTimeout(60*time.Second)))
			if err == nil {
				after, err2 := chromedp.Run(ctx, chromedp.Evaluate[shift](clsJS, chromedp.EvalAwaitPromise))
				if err2 != nil {
					t.Fatal(err2)
				}
				if after.Sum != 0 {
					t.Errorf("layout shift %.4f once the demo started on its own, want 0; moved: %s", after.Sum, strings.Join(after.Moved, "; "))
				}
				if f, _ := chromedp.Run(ctx, chromedp.Evaluate[string](`document.activeElement.tagName + (document.querySelector(".ph-screen") ? " screen kept" : "")`)); f != "BODY" {
					t.Errorf("after starting on its own: focus %q, want BODY and the recording removed", f)
				}
			}
		} else {
			if head && w < 1000 && !layoutOnly && scheme == "light" {
				if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(`(() => { const v = document.querySelector(".ph-screen video"); return until(() => v && !v.paused && "on" in v.dataset); })()`), chromedp.EvalAwaitPromise)); err != nil || !ok {
					t.Errorf("recording in the demo frame did not play (err %v)", err)
				}
			}
			err = chromedp.Do(ctx, chromedp.Click(chromedp.CSS("[data-demo-start]")))
			if err == nil {
				_, err = chromedp.Run(ctx, chromedp.Poll[bool](`document.querySelector("[data-demo-ready],[data-demo-error]") !== null`,
					chromedp.WithPollingTimeout(60*time.Second)))
			}
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
		if scheme == "dark" || layoutOnly {
			checks = checks[:min(1, len(checks))]
		}
		if len(checks) == 0 {
			t.Errorf("demo %q has no entry in demoChecks", slug)
		}
		for _, js := range checks {
			if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(js), chromedp.EvalAwaitPromise)); err != nil || !ok {
				t.Errorf("demo check failed: %s (err %v)", js, err)
			}
		}
	}
	// axe at phone width in both schemes (contrast follows the scheme, reflow
	// problems show at 390 px); the Tab walk at desktop. Splitting them keeps
	// CI under its 60 s budget.
	if w < 1000 && !layoutOnly {
		pageQuality(t, ctx)
	} else if scheme == "light" && !(layoutOnly && hasDemo) {
		// A tablet tab only starts its demo for screenshots and does not wait
		// for it to settle; desktop walks the same DOM order.
		tabOrder(t, ctx)
	}
	if isHome, _ := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector(".work") !== null`)); isHome && !layoutOnly && scheme == "light" {
		for _, c := range []struct{ name, js string }{{"stage", stageCheck}, {"scene", sceneCheck}, {"depth", depthCheck}, {"work", workCheck}, {"refused", refusedCheck}, {"index", indexCheck}} {
			if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(c.js), chromedp.EvalAwaitPromise)); err != nil || !ok {
				t.Errorf("home %s check failed (err %v)", c.name, err)
			}
		}
	}
	overflow, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth > document.documentElement.clientWidth`))
	if err != nil {
		t.Fatal(err)
	}
	if overflow {
		t.Errorf("page scrolls horizontally at %dpx", w)
	}
	if keepShots {
		screenshot(t, ctx, w, shot)
	}
	cancel()
	<-done
	mu.Lock()
	defer mu.Unlock()
	for _, p := range problems {
		t.Error(p)
	}
}

// touch emulates a touchscreen below desktop width, so pointer: coarse rules
// (44 px targets, 16 px inputs) are what the phone and tablet tabs check.
func touch(w int64) []chromedp.EmulateViewportOption {
	if w < 1000 {
		return []chromedp.EmulateViewportOption{chromedp.EmulateTouch}
	}
	return nil
}

// screenshot saves the whole page at width w to shot.jpg.
func screenshot(t *testing.T, ctx context.Context, w int64, shot string) {
	t.Helper()
	// Shots show diagrams at rest, not wherever a one-shot animation is, and
	// sticky elements where a visitor first sees them, not where the Tab walk left them.
	// The viewport grows to the whole page first, so every in-view animation
	// has started and can be finished: a beyond-viewport capture restarted the
	// replay's wipe, and the desktop home shot showed the chart blank.
	full, err := chromedp.Run(ctx, chromedp.Evaluate[int64](`scrollTo(0, 0), document.documentElement.scrollHeight`))
	if err != nil {
		t.Fatal(err)
	}
	if err := chromedp.Do(ctx, chromedp.EmulateViewport(w, full, touch(w)...)); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(async () => {
		const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		await frames();
		const all = document.getAnimations().filter((a) => a.timeline === document.timeline);
		const settle = (a) => Promise.race([a.ready.catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
		await Promise.all(all.map(settle));
		all.forEach((a) => { try { a.finish(); } catch {} });
		await frames();
		return true;
	})()`, chromedp.EvalAwaitPromise)); err != nil {
		t.Fatal(err)
	}
	var img []byte
	err = chromedp.Do(ctx, chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
		q := int64(80)
		r, err := cdp.Call(ctx, t, page.CaptureScreenshot, page.CaptureScreenshotParams{FromSurface: &[]bool{true}[0], Format: page.CaptureScreenshotFormatJpeg, Quality: &q})
		if err == nil {
			img = r.Data
		}
		return err
	}))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(shot+".jpg", img, 0o644); err != nil {
		t.Fatal(err)
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
