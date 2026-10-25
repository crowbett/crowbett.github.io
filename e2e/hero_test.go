//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

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
