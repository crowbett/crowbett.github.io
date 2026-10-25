//go:build e2e

// Package e2e drives the built site in headless Chrome: every page loads with
// no console errors or CSP violations, fits a phone width without horizontal
// scroll, and every live demo starts and reports ready. Screenshots of each
// page, desktop and phone, land in e2e/out/ for review.
//
//	go test -tags e2e ./e2e
package e2e

import (
	"context"
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

	"github.com/chromedp/chromedp"

	"github.com/crowbett/crowbett.github.io/internal/site"
)

// demoChecks holds, per demo slug, JavaScript expressions that must all be
// true once the demo reports ready. Every live demo adds at least one check
// that proves it rendered real output from its binary.
var demoChecks = map[string][]string{
	"smoke": {`document.querySelector(".demo-out").textContent.includes("answered: hello from the page")`},
}

var viewports = []struct {
	name          string
	width, height int64
}{
	{"desktop", 1280, 900},
	{"phone", 390, 844},
}

func TestSite(t *testing.T) {
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

	alloc, cancel := chromedp.NewExecAllocator(context.Background(), append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("mute-audio", true),
	)...)
	defer cancel()

	for _, page := range pages {
		for _, vp := range viewports {
			t.Run(name(page)+"/"+vp.name, func(t *testing.T) {
				visit(t, alloc, srv.URL+page, vp.width, vp.height, filepath.Join(shots, name(page)+"-"+vp.name))
			})
		}
	}
}

// TestDemoFailures drives the smoke binary's hang and panic methods: a stuck
// call must time out and kill the worker, and a crash must surface a clear
// error instead of a JSON parse failure.
func TestDemoFailures(t *testing.T) {
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	out := t.TempDir()
	if err := site.Build(site.Config{Src: os.DirFS(root), Out: out, Owner: site.DefaultOwner, Now: time.Now()}); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.FileServer(http.Dir(out)))
	defer srv.Close()

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancelT := context.WithTimeout(ctx, 90*time.Second)
	defer cancelT()
	if err := chromedp.Do(ctx, chromedp.Navigate(srv.URL+"/demos/smoke/")); err != nil {
		t.Fatal(err)
	}
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

func visit(t *testing.T, alloc context.Context, url string, w, h int64, shot string) {
	ctx, cancel := chromedp.NewContext(alloc)
	defer cancel()
	ctx, cancelT := context.WithTimeout(ctx, 90*time.Second)
	defer cancelT()

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
		chromedp.Navigate(url),
		chromedp.WaitReady(chromedp.CSS("body")),
	)
	if err != nil {
		t.Fatal(err)
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
			if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](js)); err != nil || !ok {
				t.Errorf("demo check failed: %s (err %v)", js, err)
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
