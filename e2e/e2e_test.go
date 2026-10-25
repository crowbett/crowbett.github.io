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

// demoChecks holds, per demo slug, JavaScript expressions that must all be
// true (or resolve true) once the demo reports ready. Every live demo adds
// at least one check that proves it rendered real output from its binary.
var demoChecks = map[string][]string{
	"smoke": {`document.querySelector(".demo-out").textContent.includes("answered: hello from the page")`},
	"codegraph": {
		`document.querySelector(".cg-summary").textContent === "main (src/main.rs:11): 0 callers; 11 callees, 6 resolved, 5 unresolved."`,
		`[...document.querySelectorAll("[aria-labelledby=cg-callees] .cg-edge")].map((li) => li.firstChild.textContent + ":" + li.querySelector(".cg-conf").textContent).filter((t) => /^(parse::parse_line|e\.is_fatal):/.test(t)).join() === "parse::parse_line:likely,e.is_fatal:unresolved"`,
		`document.querySelector(".cg-foot").textContent.includes("99 edges (imports excluded), 50 resolved to a definition: 44 exact, 6 likely, 0 name_only")`,
		`(async () => {
			const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); return f(); };
			const callers = () => [...document.querySelectorAll("[aria-labelledby=cg-callers] .cg-go")].map((b) => b.textContent).join();
			[...document.querySelectorAll(".cg-go")].find((b) => b.textContent === "parse::parse_line").click();
			let ok = await until(() => document.querySelector(".cg-summary").textContent.startsWith("parse::parse_line (src/parse.rs:19)") && callers() === "main");
			const s = document.querySelector("select[name=symbol]");
			s.value = "src/store.rs:32"; s.dispatchEvent(new Event("change"));
			ok = ok && await until(() => callers() === "store::Store::set,store::Store::delete" && document.querySelectorAll(".cg-def").length === 3);
			s.value = "src/main.rs:11"; s.dispatchEvent(new Event("change"));
			return ok && await until(() => document.querySelector(".cg-summary").textContent.startsWith("main "));
		})()`,
	},
	"ratelimitd": {
		`[...document.querySelectorAll(".rl-chart")].map(c => c.dataset.algo).join() === "gcra,token_bucket,sliding_window"`,
		`[...document.querySelectorAll(".rl-chart")].every(c => c.querySelectorAll("rect.rl-allowed").length > 20 && c.querySelectorAll("rect.rl-denied").length > 0)`,
		`/^1,\d{3} requests through 3 algorithms/.test(document.querySelector(".rl-status").textContent)`,
	},
	"jobrun": {
		`document.querySelectorAll(".jr-run").length === 10 && document.querySelector(".jr-run .jr-mono").textContent === "Thu 2026-01-01 09:00"`,
		`[...document.querySelectorAll(".jr-table tbody tr")].length === 8 && document.querySelector(".jr-dead td").textContent === "8"`,
		`document.querySelectorAll(".jr-chart line.jr-dot").length === 7 * 20`,
		`(async () => {
			const s = document.querySelector("select[name=cronPreset]");
			s.value = "1"; s.dispatchEvent(new Event("change"));
			const runs = () => [...document.querySelectorAll(".jr-run .jr-mono")].map((r) => r.textContent).slice(0, 2).join();
			for (let i = 0; i < 100 && runs() !== "Sat 2026-03-07 02:30,Mon 2026-03-09 02:30"; i++) await new Promise((r) => setTimeout(r, 50));
			const note = () => document.querySelector(".jr-note").textContent;
			let ok = runs() === "Sat 2026-03-07 02:30,Mon 2026-03-09 02:30" && note().includes("8 March");
			const z = document.querySelector("select[name=tz]");
			z.value = "UTC"; z.dispatchEvent(new Event("change"));
			for (let i = 0; i < 100 && runs() !== "Sat 2026-03-07 02:30,Sun 2026-03-08 02:30"; i++) await new Promise((r) => setTimeout(r, 50));
			ok = ok && runs() === "Sat 2026-03-07 02:30,Sun 2026-03-08 02:30" && note() === "";
			s.value = "0"; s.dispatchEvent(new Event("change"));
			for (let i = 0; i < 100 && runs() !== "Thu 2026-01-01 09:00,Thu 2026-01-01 09:15"; i++) await new Promise((r) => setTimeout(r, 50));
			return ok;
		})()`,
	},
	"kvlite": {
		`[...document.querySelectorAll(".kv-table tbody tr")].map((r) => r.cells[2].textContent + ":" + r.cells[3].textContent).join() === "put:user:1,put:user:2,put:user:1,delete:user:2"`,
		`(async () => {
			const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); return f(); };
			const click = (t) => [...document.querySelectorAll(".kv-controls button")].find((b) => b.textContent === t).click();
			const segs = () => [...document.querySelectorAll(".kv-seg")].map((s) => s.querySelector(".kv-seg-meta").textContent + "|" +
				[...s.querySelectorAll("tbody tr")].map((r) => r.cells[2].textContent + ":" + r.cells[3].textContent).join());
			const keys = () => [...document.querySelectorAll(".kv-keys li span:first-child")].map((s) => s.textContent).join();
			const log = () => document.querySelector(".kv-log").textContent;
			click("Compact");
			let ok = await until(() => /^sealed · \d+ B · hint file\|put:user:1;active · 16 B\|$/.test(segs().join(";")));
			const k = document.querySelector("input[name=key]");
			k.value = "late";
			click("Put");
			ok = ok && await until(() => keys() === "late,user:1");
			const tear = document.querySelector("select[name=tear]");
			tear.value = "5";
			click("Crash and reopen");
			const status = () => document.querySelector(".kv-status").textContent;
			ok = ok && await until(() => log().includes("truncated torn tail") && keys() === "user:1" && status().includes(", 5 bytes torn off"));
			click("Reset");
			click("Compact");
			return ok && await until(() => status().startsWith("Nothing to compact") && keys() === "");
		})()`,
	},
	"edgecache": {
		`[...document.querySelectorAll(".ec-table .ec-badge")].map(b => b.textContent).join() === "MISS,HIT,REVALIDATED,HIT"`,
		`[...document.querySelectorAll(".ec-table td.ec-origin")].map(c => c.textContent).join("|") === "GET → 200|none|conditional GET → 304|none"`,
		`document.querySelectorAll(".ec-timeline rect.ec-mark").length === 4`,
		`(() => { const b = document.querySelector(".ec-scroll"); return b.getAttribute("aria-label") === "Request log" && (b.tabIndex < 0 || b.getAttribute("role") === "region"); })()`,
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
	"strata": {
		`/^XY test piece: 272 triangles, 20 × 20 × 5 mm\. Sliced into 25 layers of 1,033 toolpaths, 10\.79 m in all, in \d[\d,]* ms in your browser\.$/.test(document.querySelector(".st-summary").textContent)`,
		`document.querySelector(".st-where").textContent === "11 of 25 · z 2.2 mm"`,
		`[...document.querySelectorAll(".st-key")].map((k) => k.dataset.kind).join() === "OuterWall,InnerWall,SparseInfill"`,
		`(() => { const c = document.querySelector(".st-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 2000; })()`,
		`(async () => {
			const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); return f(); };
			const text = (sel) => document.querySelector(sel).textContent;
			const set = (sel, v, ev) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event(ev)); };
			set("input[name=layer]", "0", "input");
			let ok = await until(() => text(".st-where") === "1 of 25 · z 0.2 mm" && !!document.querySelector(".st-key[data-kind=Skirt]"));
			set("select[name=layerHeight]", "0.12", "change");
			ok = ok && await until(() => text(".st-summary").includes("Sliced into 41 layers") && text(".st-where") === "1 of 41 · z 0.2 mm");
			let stl = "solid t\n";
			const v = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
			for (const f of [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]) stl += "facet normal 0 0 0\nouter loop\n" + f.map((i) => "vertex " + v[i].join(" ") + "\n").join("") + "endloop\nendfacet\n";
			const dt = new DataTransfer();
			dt.items.add(new File([stl + "endsolid t\n"], "tetra.stl"));
			const file = document.querySelector("input[name=file]");
			file.files = dt.files;
			file.dispatchEvent(new Event("change"));
			const tetra = (n) => text(".st-summary").startsWith("tetra.stl: 4 triangles, 10 × 10 × 10 mm. Sliced into " + n + " layers");
			ok = ok && await until(() => tetra(83) && document.querySelector("select[name=model]").selectedOptions[0].textContent === "tetra.stl");
			const pickFile = (body, name) => { const t = new DataTransfer(); t.items.add(new File([body], name)); file.files = t.files; file.dispatchEvent(new Event("change")); };
			const model = () => document.querySelector("select[name=model]").selectedOptions[0].textContent;
			set("select[name=layerHeight]", "0.2", "change");
			pickFile("AAAA", "bad.stl");
			ok = ok && await until(() => text(".st-summary").startsWith("bad.stl: ") && model() === "tetra.stl" && / of 50 · /.test(text(".st-where")));
			pickFile(stl + "endsolid t\n", "tetra.stl");
			set("select[name=layerHeight]", "0.12", "change");
			ok = ok && await until(() => tetra(83) && model() === "tetra.stl" && / of 83 · /.test(text(".st-where")));
			set("select[name=layerHeight]", "0.2", "change");
			ok = ok && await until(() => tetra(50));
			set("select[name=model]", "xy", "change");
			ok = ok && await until(() => text(".st-summary").startsWith("XY test piece: 272 triangles") && text(".st-summary").includes("Sliced into 25 layers") && !document.querySelector("option[value=file]"));
			set("input[name=layer]", "10", "input");
			return ok && await until(() => text(".st-where") === "11 of 25 · z 2.2 mm");
		})()`,
	},
	"keel": {
		`[...document.querySelectorAll(".kl-digest")].map((d) => d.textContent).join() === "24f2fb94354d9d25,24f2fb94354d9d25" && document.querySelector(".kl-match") !== null`,
		`[...document.querySelectorAll(".kl-totals dd")].map((d) => d.textContent).join() === "535,0,6,14,linearizable"`,
		`document.querySelectorAll(".kl-events li").length === 13 && document.querySelectorAll(".kl-timeline rect.kl-bar").length > 0`,
		`/^Seed 7: 118,095 scheduler steps and 148,245 traced events over 35\.00 s of simulated time, run in [\d,]+ ms in your browser\.$/.test(document.querySelector(".kl-status").textContent)`,
		`(async () => {
			const until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); return f(); };
			const digests = () => [...document.querySelectorAll(".kl-digest")].map((d) => d.textContent).join();
			document.querySelector("input[name=seed]").value = "8";
			document.querySelector(".kl-controls").requestSubmit();
			let ok = await until(() => digests() === "22e2ba986ec4d67e" && !document.querySelector(".kl-controls button.secondary").disabled);
			document.querySelector(".kl-controls button.secondary").click();
			ok = ok && await until(() => digests() === "22e2ba986ec4d67e,22e2ba986ec4d67e" && document.querySelector(".kl-match") !== null);
			return ok && document.querySelectorAll(".kl-events li").length === 15;
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

// The package builds the site once and starts one Chrome for every test:
// each extra Chrome cost a cold start on CI (F2 in docs/tasks.md).
var (
	root    string
	siteOut string
	srv     *httptest.Server
	browser context.Context
)

var epoch = time.Now()

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

	// One tab per page, viewport and scheme, all in parallel.
	t.Run("pages", func(t *testing.T) {
		for _, page := range pages {
			for _, vp := range viewports {
				for _, scheme := range schemes {
					shot := name(page) + "-" + vp.name + "-" + scheme
					t.Run(name(page)+"/"+vp.name+"/"+scheme, func(t *testing.T) {
						t.Parallel()
						visit(t, srv.URL+page, vp.width, vp.height, scheme, filepath.Join(shots, shot))
					})
				}
			}
		}
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

// TestReducedMotion loads pages whose diagrams play on load, and the smoke
// demo whose frame animates on ready: with motion allowed something animates,
// with prefers-reduced-motion nothing does.
func TestReducedMotion(t *testing.T) {
	t.Parallel()
	for _, page := range []string{"/", "/projects/quorum/", "/demos/smoke/"} {
		for _, motion := range []string{"no-preference", "reduce"} {
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
					document.querySelector(".feature, .facts")?.scrollIntoView({ block: "center" });
					await new Promise((r) => setTimeout(r, 400));
				}
				return document.getAnimations().length;
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
	opts := append(chromedp.DefaultExecAllocatorOptions[:], chromedp.Flag("mute-audio", true), chromedp.DisableGPU, chromedp.CombinedOutput(chromeLog))
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
	t.Logf("TABOPEN at=%.2f wait=%.2f open=%.2f", queued.Sub(epoch).Seconds(), opening.Sub(queued).Seconds(), time.Since(opening).Seconds())
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

func visit(t *testing.T, url string, w, h int64, scheme, shot string) {
	t0 := time.Now()
	last := t0
	var laps []string
	lap := func(s string) {
		laps = append(laps, fmt.Sprintf("%s=%.2f", s, time.Since(last).Seconds()))
		last = time.Now()
	}
	defer func() {
		t.Logf("PHASES %s %d %s start=%.2f %s", url[len(srv.URL):], w, scheme, t0.Sub(epoch).Seconds(), strings.Join(laps, " "))
	}()
	tab, release := visitTab(t, 90*time.Second)
	defer func() { release(!t.Failed()) }()
	ctx, cancel := context.WithCancel(tab)
	defer cancel()
	lap("tab")

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
	lap("nav")
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
	lap("cls")
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
	lap("demo")
	if w < 1000 {
		pageQuality(t, ctx)
		lap("axe")
	} else if scheme == "light" {
		tabOrder(t, ctx)
		lap("tabs")
	}
	overflow, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth > document.documentElement.clientWidth`))
	if err != nil {
		t.Fatal(err)
	}
	if overflow {
		t.Errorf("page scrolls horizontally at %dpx", w)
	}
	// Shots show diagrams at rest, not wherever a one-shot animation is, and
	// sticky elements where a visitor first sees them, not where the Tab walk left them.
	// The viewport grows to the whole page first, so every in-view animation
	// has started and can be finished: a beyond-viewport capture restarted the
	// replay's wipe, and the desktop home shot showed the chart blank.
	full, err := chromedp.Run(ctx, chromedp.Evaluate[int64](`scrollTo(0, 0), document.documentElement.scrollHeight`))
	if err != nil {
		t.Fatal(err)
	}
	if err := chromedp.Do(ctx, chromedp.EmulateViewport(w, full)); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(async () => {
		const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		await frames();
		const all = document.getAnimations();
		await Promise.all(all.map((a) => a.ready.catch(() => {})));
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
	lap("shot")
	cancel()
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
