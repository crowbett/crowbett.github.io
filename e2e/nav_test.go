//go:build e2e

package e2e

import (
	"context"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
)

// TestPalette opens the command palette with Ctrl+K, finds ratelimitd by a
// subsequence, opens it with Enter, then steps back a project with "[". axe
// runs at phone width with the palette open.
func TestPalette(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	key := func(k string, ctrl bool) string {
		return `document.dispatchEvent(new KeyboardEvent("keydown", { key: "` + k + `", ctrlKey: ` + map[bool]string{true: "true", false: "false"}[ctrl] + `, bubbles: true, cancelable: true }))`
	}
	steps := []struct{ name, js string }{
		{"opens", `(async () => { ` + key("k", true) + `; return until(() => document.querySelector(".pal[open]") && document.activeElement === document.querySelector(".pal input") && document.querySelector('.pal [aria-selected] b')?.textContent === "Run the live demo"); })()`},
		{"finds", `(async () => { const i = document.querySelector(".pal input"); i.value = "rlim"; i.dispatchEvent(new Event("input")); return until(() => document.querySelector(".pal [aria-selected] b")?.textContent === "ratelimitd" && i.getAttribute("aria-activedescendant") === document.querySelector(".pal [aria-selected]").id); })()`},
		{"opens the project", `(async () => { document.querySelector(".pal input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`},
	}
	// Two cores: the demo waits for the key, so the palette offers it.
	err := chromedp.Do(ctx, cores(2), chromedp.EmulateViewport(390, 844, chromedp.EmulateTouch), chromedp.Navigate(srv.URL+"/projects/keel/"), chromedp.WaitReady(chromedp.CSS("body")))
	if err != nil {
		t.Fatal(err)
	}
	for i, s := range steps {
		if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(s.js), chromedp.EvalAwaitPromise)); err != nil || !ok {
			t.Fatalf("palette %s: %v", s.name, err)
		}
		if i == 1 {
			pageQuality(t, ctx)
		}
	}
	if !arrive(ctx, "/projects/ratelimitd/") {
		t.Fatal("Enter did not open ratelimitd")
	}
	prev, err := chromedp.Run(ctx, chromedp.Evaluate[string](`document.querySelector(".pager [rel=prev]").pathname`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](key("[", false)+`, true`)); err != nil {
		t.Fatal(err)
	}
	if !arrive(ctx, prev) {
		t.Fatalf(`"[" did not open the previous project %s`, prev)
	}
}

// arrive waits up to 10 s for the tab to finish loading path; evaluations
// fail while a navigation swaps the document, so errors just retry.
func arrive(ctx context.Context, path string) bool {
	for end := time.Now().Add(10 * time.Second); time.Now().Before(end); time.Sleep(100 * time.Millisecond) {
		if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`location.pathname === "`+path+`" && document.readyState === "complete"`)); err == nil && ok {
			return true
		}
	}
	return false
}

// TestIndexKeys walks the home index with j and k and checks search.json
// lists every project in index order.
func TestIndexKeys(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	if err := chromedp.Do(ctx, chromedp.EmulateViewport(1280, 900), chromedp.Navigate(srv.URL+"/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		t.Fatal(err)
	}
	js := `(async () => {
		const press = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
		const at = () => document.activeElement.closest(".it")?.querySelector(".it-n").textContent.trim();
		press("j"); press("j"); press("j"); press("k");
		const index = await (await fetch("/search.json")).json();
		const rows = [...document.querySelectorAll(".it-name")].map((n) => n.textContent).join();
		return until(() => at() === "02" && index.map((p) => p.title).join() === rows && index[0].n === 1);
	})()`
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(js), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Fatalf("j/k or search.json: %v", err)
	}
}

// TestPointerFeel runs feelCheck on a desktop home tab of its own, so the
// long chain of home checks in TestSite does not grow.
func TestPointerFeel(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	if err := chromedp.Do(ctx, chromedp.EmulateViewport(1280, 900), chromedp.Navigate(srv.URL+"/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		t.Fatal(err)
	}
	feelCheck(t, ctx)
}
