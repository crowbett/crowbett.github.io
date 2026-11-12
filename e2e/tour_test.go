//go:build e2e

package e2e

import (
	"path/filepath"
	"sort"
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
	shard, shards := split(t)
	at := tourShard(tours, shards)
	for _, f := range tours {
		slug := filepath.Base(filepath.Dir(f))
		if at[slug] != shard {
			continue
		}
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
				t.Fatalf("tour did not finish: %v %v\nstate: %s", res, err, demoState(ctx))
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

// tourCost is each tour's seconds in one local run of all of them (2026-11-09);
// a new tour counts 10 until measured.
var tourCost = map[string]int{"mcpbridge": 30, "edgecache": 19, "strata": 18, "raytracer": 18, "codegraph": 15, "btrv": 14, "quorum": 14, "netcode": 13, "kvlite": 13, "grepall": 11, "keel": 11, "lobby": 10, "anchorflow": 10, "recall": 9, "jobrun": 8, "ratelimitd": 7, "livejob": 7, "stash": 6, "adfactory": 6}

// tourShard puts each tour on a runner, longest first onto the least loaded,
// so the slow ones never share one.
func tourShard(tours []string, shards int) map[string]int {
	type tc struct {
		slug string
		cost int
	}
	var all []tc
	for _, f := range tours {
		slug := filepath.Base(filepath.Dir(f))
		c, ok := tourCost[slug]
		if !ok {
			c = 10
		}
		all = append(all, tc{slug, c})
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].cost > all[j].cost })
	load := make([]int, shards)
	at := map[string]int{}
	for _, x := range all {
		min := 0
		for i := range load {
			if load[i] < load[min] {
				min = i
			}
		}
		at[x.slug] = min
		load[min] += x.cost
	}
	return at
}
