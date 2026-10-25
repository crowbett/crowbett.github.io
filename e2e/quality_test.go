//go:build e2e

package e2e

import (
	"context"
	_ "embed"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/input"
	"github.com/chromedp/chromedp"
)

// axe-core 4.10.3 (MPL-2.0, testdata/axe/LICENSE), test-only: it is injected
// through DevTools and never shipped with the site.
//
//go:embed testdata/axe/axe.min.js
var axeSource string

// contrastPairs are the text/ground pairs from docs/design.md §Colour with
// their WCAG AA minimum: 4.5 for text, 3 for control boundaries.
var contrastPairs = []struct {
	fg, bg string
	min    float64
}{
	{"text", "bg", 4.5}, {"text", "surface", 4.5}, {"text", "sunken", 4.5},
	{"text-2", "bg", 4.5}, {"text-2", "surface", 4.5}, {"text-2", "sunken", 4.5},
	{"text-3", "bg", 4.5}, {"text-3", "surface", 4.5}, {"text-3", "sunken", 4.5},
	{"accent", "bg", 4.5}, {"accent", "surface", 4.5}, {"accent", "sunken", 4.5},
	{"live", "bg", 4.5}, {"live", "surface", 4.5}, {"live", "sunken", 4.5},
	{"danger", "bg", 4.5}, {"danger", "surface", 4.5}, {"danger", "sunken", 4.5},
	{"on-accent", "accent", 4.5}, {"accent", "accent-tint", 4.5},
	{"live", "live-tint", 4.5}, {"danger", "danger-tint", 4.5}, {"text", "danger-tint", 4.5},
	{"control-line", "bg", 3}, {"control-line", "surface", 3},
}

// TestTokenContrast re-measures every pair in both schemes from the tokens in
// site.css, so a token change that breaks AA fails even if no page shows it yet.
func TestTokenContrast(t *testing.T) {
	css, err := os.ReadFile("../web/assets/site.css")
	if err != nil {
		t.Fatal(err)
	}
	light, dark := themeTokens(t, string(css))
	for name, tokens := range map[string]map[string]string{"light": light, "dark": dark} {
		for _, p := range contrastPairs {
			fg, bg := tokens[p.fg], tokens[p.bg]
			if fg == "" || bg == "" {
				t.Errorf("%s: token --%s or --%s missing", name, p.fg, p.bg)
				continue
			}
			if r := contrast(fg, bg); r < p.min {
				t.Errorf("%s: --%s %s on --%s %s is %.2f:1, want %.1f", name, p.fg, fg, p.bg, bg, r, p.min)
			}
		}
	}
}

var tokenRE = regexp.MustCompile(`--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;`)

// themeTokens reads the first :root block (light) and the :root inside the
// prefers-color-scheme: dark query; dark inherits what it does not override.
func themeTokens(t *testing.T, css string) (light, dark map[string]string) {
	block := func(s string) string {
		i := strings.Index(s, ":root {")
		if i < 0 {
			t.Fatal("site.css: no :root block")
		}
		return s[i : i+strings.Index(s[i:], "}")]
	}
	read := func(b string, into map[string]string) {
		for _, m := range tokenRE.FindAllStringSubmatch(b, -1) {
			into[m[1]] = strings.ToLower(m[2])
		}
	}
	light, dark = map[string]string{}, map[string]string{}
	read(block(css), light)
	i := strings.Index(css, "@media (prefers-color-scheme: dark)")
	if i < 0 {
		t.Fatal("site.css: no dark scheme")
	}
	for k, v := range light {
		dark[k] = v
	}
	read(block(css[i:]), dark)
	return light, dark
}

func contrast(a, b string) float64 {
	la, lb := luminance(a), luminance(b)
	return (math.Max(la, lb) + 0.05) / (math.Min(la, lb) + 0.05)
}

func luminance(hex string) float64 {
	var c [3]float64
	for i := range c {
		v, _ := strconv.ParseUint(hex[1+2*i:3+2*i], 16, 8)
		s := float64(v) / 255
		if s <= 0.03928 {
			c[i] = s / 12.92
		} else {
			c[i] = math.Pow((s+0.055)/1.055, 2.4)
		}
	}
	return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]
}

// pageQuality runs on every page, viewport and scheme: axe-core finds no WCAG
// A/AA violations, every request stayed on the origin, and the CSP is the
// strict one.
func pageQuality(t *testing.T, ctx context.Context) {
	type finding struct {
		ID, Impact, Help string
		Nodes            []string
	}
	// Finish entrance animations first: mid-fade text fails contrast. Looping
	// ones cannot finish and are left running.
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }), true`)); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](axeSource+";true")); err != nil {
		t.Fatalf("inject axe: %v", err)
	}
	found, err := chromedp.Run(ctx, chromedp.Evaluate[[]finding](`axe.run(document, {
		runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
		resultTypes: ["violations"],
	}).then((r) => r.violations.map((v) => ({
		ID: v.id, Impact: v.impact || "", Help: v.help,
		Nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
	})))`, chromedp.EvalAwaitPromise))
	if err != nil {
		t.Fatalf("axe: %v", err)
	}
	for _, f := range found {
		t.Errorf("axe %s (%s): %s at %s", f.ID, f.Impact, f.Help, strings.Join(f.Nodes, ", "))
	}

	offOrigin, err := chromedp.Run(ctx, chromedp.Evaluate[[]string](`performance.getEntriesByType("resource").map((e) => e.name)
		.filter((u) => !u.startsWith("data:") && !u.startsWith("blob:") && new URL(u).origin !== location.origin)`))
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range offOrigin {
		t.Errorf("request left the origin: %s", u)
	}

	csp, err := chromedp.Run(ctx, chromedp.Evaluate[string](`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ""`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(csp, "default-src 'self'") || strings.ContainsAny(csp, "*") || strings.Contains(csp, "http") || strings.Contains(csp, "unsafe-inline") {
		t.Errorf("CSP is missing or loosened: %q", csp)
	}
}

// tabOrder presses Tab through the page: focus must visit every visible
// focusable element once, in document order, each with a visible ring.
func tabOrder(t *testing.T, ctx context.Context) {
	n, err := chromedp.Run(ctx, chromedp.Evaluate[int](`(() => {
		// Restart sequential focus at the top: a demo leaves focus in its mount.
		document.body.tabIndex = -1;
		document.body.focus();
		document.body.removeAttribute("tabindex");
		window.__tab = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
			.filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);
		return window.__tab.length;
	})()`))
	if err != nil {
		t.Fatal(err)
	}
	type stop struct {
		Index int
		Tag   string
		Ring  bool
	}
	var got []stop
	for range n {
		err := chromedp.Do(ctx, chromedp.Func(func(ctx context.Context, tg *chromedp.Target) error {
			for _, typ := range []input.DispatchKeyEventType{input.DispatchKeyEventTypeRawKeyDown, input.DispatchKeyEventTypeKeyUp} {
				if _, err := cdp.Call(ctx, tg, input.DispatchKeyEvent, input.DispatchKeyEventParams{
					Type: typ, Key: "Tab", Code: "Tab", WindowsVirtualKeyCode: 9, NativeVirtualKeyCode: 9,
				}); err != nil {
					return err
				}
			}
			return nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		s, err := chromedp.Run(ctx, chromedp.Evaluate[stop](`(() => {
			const el = document.activeElement, cs = getComputedStyle(el);
			return {
				Index: window.__tab.indexOf(el),
				Tag: el.outerHTML.slice(0, 60),
				Ring: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2,
			};
		})()`))
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, s)
	}
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(document.activeElement?.blur(), true)`)); err != nil {
		t.Fatal(err)
	}
	for i, s := range got {
		if s.Index != i {
			t.Errorf("tab stop %d reached %s (index %d), want element %d in document order", i+1, s.Tag, s.Index, i)
			return
		}
		if !s.Ring {
			t.Errorf("tab stop %d %s has no visible focus ring", i+1, s.Tag)
		}
	}
}

// TestSlowConnection loads pages from a server that answers like a slow
// mobile link (150 ms before the first byte, then 200 KB/s per response;
// Chrome's network emulation leaves the navigation itself unthrottled): the
// largest paint lands within 2.5 s and nothing shifts as fonts and styles arrive.
func TestSlowConnection(t *testing.T) {
	t.Parallel()
	slow := httptest.NewServer(slowLink(srv.Config.Handler))
	defer slow.Close()
	for _, page := range []string{"/", "/projects/quorum/"} {
		ctx, cancel := newTab(t, 60*time.Second)
		err := chromedp.Do(ctx,
			chromedp.EmulateViewport(390, 844),
			chromedp.Navigate(slow.URL+page),
			chromedp.WaitReady(chromedp.CSS("body")),
		)
		if err != nil {
			t.Fatal(err)
		}
		type vitals struct{ LCP, CLS, Nav float64 }
		v, err := chromedp.Run(ctx, chromedp.Evaluate[vitals](`new Promise((resolve) => {
			const out = { LCP: 0, CLS: 0, Nav: performance.getEntriesByType("navigation")[0].responseStart };
			new PerformanceObserver((l) => { for (const e of l.getEntries()) out.LCP = e.startTime; })
				.observe({ type: "largest-contentful-paint", buffered: true });
			new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.CLS += e.value; })
				.observe({ type: "layout-shift", buffered: true });
			setTimeout(() => resolve(out), 1000);
		})`, chromedp.EvalAwaitPromise))
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: LCP %.0f ms, CLS %.4f, first byte %.0f ms", page, v.LCP, v.CLS, v.Nav)
		if v.Nav < 150 {
			t.Errorf("%s: first byte at %.0f ms; the slow link is not in effect", page, v.Nav)
		}
		if v.LCP == 0 || v.LCP > 2500 {
			t.Errorf("%s: LCP %.0f ms on a slow link, budget 2500 ms", page, v.LCP)
		}
		if v.CLS != 0 {
			t.Errorf("%s: layout shift %.4f on a slow link, want 0", page, v.CLS)
		}
	}
}

func slowLink(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(150 * time.Millisecond)
		h.ServeHTTP(&slowWriter{ResponseWriter: w}, r)
	})
}

// slowWriter paces a response at 200 KB/s in 4 KB writes.
type slowWriter struct{ http.ResponseWriter }

func (s *slowWriter) Write(b []byte) (int, error) {
	n := 0
	for len(b) > 0 {
		c := min(len(b), 4<<10)
		w, err := s.ResponseWriter.Write(b[:c])
		n += w
		if err != nil {
			return n, err
		}
		if f, ok := s.ResponseWriter.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(time.Duration(c) * time.Second / (200 << 10))
		b = b[c:]
	}
	return n, nil
}
