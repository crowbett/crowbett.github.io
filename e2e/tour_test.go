//go:build e2e

package e2e

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
)

// TestTours plays every demo's tour sped up, end to end on the real binary,
// then copies a settings link and opens it in the same tab: the demo comes
// back with the same control values.
func TestTours(t *testing.T) {
	tours, err := filepath.Glob(filepath.Join(root, "web/demos/*/tour.js"))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range tours {
		slug := filepath.Base(filepath.Dir(f))
		t.Run(slug, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := newTab(t, 120*time.Second)
			defer cancel()
			if err := chromedp.Do(ctx, chromedp.EmulateViewport(1280, 900), chromedp.Navigate(srv.URL+"/projects/"+slug+"/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
				t.Fatal(err)
			}
			played := `(async () => {
				document.documentElement.dataset.tourSpeed = "8";
				const s = document.querySelector("[data-demo]");
				if (!("demoReady" in s.dataset)) s.querySelector("[data-demo-start]").click();
				await until(() => !s.querySelector("[data-acts]").hidden);
				s.querySelector("[data-tour-go]").click();
				await until(() => "toured" in s.dataset || /^0 \//.test(s.querySelector("[data-tour-cap]").textContent), 100000);
				return "toured" in s.dataset || s.querySelector("[data-tour-cap]").textContent;
			})()`
			if res, err := chromedp.Run(ctx, chromedp.Evaluate[any](untilJS(played), chromedp.EvalAwaitPromise)); err != nil || res != true {
				t.Fatalf("tour did not finish: %v %v", res, err)
			}
			link, err := chromedp.Run(ctx, chromedp.Evaluate[string](`(() => { const b = document.querySelector("[data-share]"); if (!b) return ""; b.click(); return location.href; })()`))
			if err != nil {
				t.Fatal(err)
			}
			if link == "" {
				return
			}
			if !strings.Contains(link, "#run=") {
				t.Fatalf("share link %q has no settings", link)
			}
			values := `[...document.querySelectorAll("[data-demo-mount] .demo-field")].map((f) => f.querySelector("select, input:not([type=file]), textarea")).filter(Boolean).map((c) => c.type === "checkbox" ? String(c.checked) : c.value).join("|")`
			want, err := chromedp.Run(ctx, chromedp.Evaluate[string](values))
			if err != nil {
				t.Fatal(err)
			}
			if err := chromedp.Do(ctx, chromedp.Navigate("about:blank"), chromedp.Navigate(link)); err != nil {
				t.Fatal(err)
			}
			opened := `(async () => { await until(() => "shared" in document.querySelector("[data-demo]").dataset, 60000); return ` + values + `; })()`
			got, err := chromedp.Run(ctx, chromedp.Evaluate[string](untilJS(opened), chromedp.EvalAwaitPromise))
			if err != nil {
				t.Fatalf("opening the settings link: %v", err)
			}
			if got != want {
				t.Errorf("settings link opened with %q, want %q", got, want)
			}
		})
	}
}
