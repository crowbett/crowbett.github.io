//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/chromedp"
)

// TestHeroTrace re-runs, through the real WebAssembly demo, the call the home
// hero replays (data/hero-trace.json) and requires the same answer, so the
// replay is always what the shipped binary produces. HERO_TRACE=update
// rewrites the file from the live run.
func TestHeroTrace(t *testing.T) {
	t.Parallel()
	file := filepath.Join("..", "data", "hero-trace.json")
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Slug   string          `json:"slug"`
		Call   string          `json:"call"`
		Params json.RawMessage `json:"params"`
		Result any             `json:"result"`
	}
	if err := json.Unmarshal(b, &trace); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	js := fmt.Sprintf(`import("/assets/demo.js").then((m) => m.connect(%q)).then((d) => d.call(%q, %s))`, trace.Slug, trace.Call, trace.Params)
	if err := chromedp.Do(ctx, chromedp.Navigate(srv.URL+"/projects/"+trace.Slug+"/")); err != nil {
		t.Fatal(err)
	}
	got, err := chromedp.Run(ctx, chromedp.Evaluate[any](js, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("HERO_TRACE") == "update" {
		out, err := json.Marshal(map[string]any{"slug": trace.Slug, "call": trace.Call, "params": trace.Params, "result": got})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, append(out, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	if !reflect.DeepEqual(got, trace.Result) {
		t.Errorf("%s %s(%s) no longer answers what the home hero replays; if the change is intended, rerun with HERO_TRACE=update and check the hero", trace.Slug, trace.Call, trace.Params)
	}
}

// TestHeroRun clicks the hero's "Run it in your browser": the page must
// download the binary, re-run the recorded call and report a match.
func TestHeroRun(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	err := chromedp.Do(ctx, chromedp.Navigate(srv.URL+"/"), chromedp.Click(chromedp.CSS(".replay-run button")))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`"replayDone" in document.querySelector("[data-replay]").dataset`, chromedp.WithPollingTimeout(45*time.Second))); err != nil {
		t.Fatal(err)
	}
	status, err := chromedp.Run(ctx, chromedp.Text(chromedp.CSS(".replay-run [role=status]")))
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := chromedp.Run(ctx, chromedp.Evaluate[bool](`"replayMatch" in document.querySelector("[data-replay]").dataset`)); !ok {
		t.Errorf("hero re-run did not match the chart: %q", status)
	}
	t.Logf("hero re-run: %s", status)
}

// TestHeroTicker checks the readouts count up with the replay's wipe and land
// on the totals the page prints, and that with reduced motion they never
// leave them.
func TestHeroTicker(t *testing.T) {
	t.Parallel()
	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	html, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	var printed []string
	for _, m := range regexp.MustCompile(`<dd class="k-[ad]">([^<]+)</dd>`).FindAllSubmatch(html, -1) {
		printed = append(printed, string(m[1]))
	}
	if len(printed) != 2 {
		t.Fatalf("found %d readouts in the served home page, want 2", len(printed))
	}
	want := strings.Join(printed, " ")
	for _, motion := range []string{"no-preference", "reduce"} {
		ctx, cancel := newTab(t, 60*time.Second)
		err := chromedp.Do(ctx,
			chromedp.Func(func(ctx context.Context, tg *chromedp.Target) error {
				_, err := cdp.Call(ctx, tg, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{
					Features: []*emulation.MediaFeature{{Name: "prefers-reduced-motion", Value: motion}},
				})
				return err
			}),
			chromedp.Navigate(srv.URL+"/"),
			chromedp.WaitReady(chromedp.CSS("body")),
		)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		got, err := chromedp.Run(ctx, chromedp.Evaluate[[]string](`(async () => {
			const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			const read = () => [...document.querySelectorAll(".readouts .k-a, .readouts .k-d")].map((c) => c.textContent).join(" ");
			await frames();
			const wipe = [...document.querySelectorAll(".replay .rw")].flatMap((r) => r.getAnimations())[0];
			if (!wipe) return [read(), read()];
			const { delay, duration } = wipe.effect.getTiming();
			wipe.pause();
			wipe.currentTime = delay + duration / 2;
			await frames();
			const mid = read();
			wipe.finish();
			await frames();
			return [mid, read()];
		})()`, chromedp.EvalAwaitPromise))
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		mid, end := got[0], got[1]
		if end != want {
			t.Errorf("%s: readouts end on %q, the page prints %q", motion, end, want)
		}
		if motion == "reduce" && mid != want {
			t.Errorf("reduce: readouts moved to %q with reduced motion", mid)
		}
		if motion != "reduce" && mid == want {
			t.Errorf("no-preference: readouts already show %q halfway through the wipe", mid)
		}
	}
}
