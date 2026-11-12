//go:build e2e

package e2e

import (
	"context"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// TestIntro: home's intro plays once, on a first landing with motion welcome,
// ends on its own within 2 s or at once on a key, and never under reduced
// motion. Each case gets its own browser context, so its storage starts empty.
func TestIntro(t *testing.T) {
	t.Parallel()
	on := `"intro" in document.documentElement.dataset`
	// The intro lasts 1.5 s, which a loaded runner can outlast between two
	// calls from here, so the page records that it played and the trace ran.
	record := `new MutationObserver(() => {
			if (!("intro" in document.documentElement.dataset) || window.introSeen) return;
			window.introSeen = true;
			const t = setInterval(() => { if (document.getAnimations().some((a) => a.animationName === "in-trace")) { window.traceSeen = true; clearInterval(t); } }, 20);
			setTimeout(() => clearInterval(t), 3000);
		}).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-intro"] });`
	played := `window.introSeen === true && window.traceSeen === true`
	open := func(t *testing.T, motion string) context.Context {
		ctx, cancel := chromedp.NewContext(browser, chromedp.WithNewBrowserContext())
		t.Cleanup(cancel)
		ctx, cancelT := context.WithTimeout(ctx, 30*time.Second)
		t.Cleanup(cancelT)
		// Two cores: the stage stays a poster, as in every home tab that does
		// not check it, so its tracer workers leave CI's vCPUs to the checks.
		err := chromedp.Do(ctx,
			cores(2),
			chromedp.EmulateViewport(1440, 900),
			chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
				_, err := cdp.Call(ctx, t, page.AddScriptToEvaluateOnNewDocument, page.AddScriptToEvaluateOnNewDocumentParams{Source: record})
				return err
			}),
			chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
				_, err := cdp.Call(ctx, t, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{
					Features: []*emulation.MediaFeature{{Name: "prefers-reduced-motion", Value: motion}},
				})
				return err
			}),
			chromedp.Navigate(srv.URL+"/"),
			chromedp.WaitReady(chromedp.CSS("body")),
		)
		if err != nil {
			t.Fatal(err)
		}
		return ctx
	}
	is := func(t *testing.T, ctx context.Context, js string) bool {
		v, err := chromedp.Run(ctx, chromedp.Evaluate[bool](js, chromedp.EvalAwaitPromise))
		if err != nil {
			t.Fatal(err)
		}
		return v
	}

	t.Run("once", func(t *testing.T) {
		t.Parallel()
		ctx := open(t, "no-preference")
		if !is(t, ctx, played) {
			t.Fatal("no intro on a first landing")
		}
		if !is(t, ctx, `new Promise((r) => setTimeout(() => r(!(`+on+`)), 2000))`) {
			t.Error("intro still on after 2 s")
		}
		if err := chromedp.Do(ctx, chromedp.Reload(), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
			t.Fatal(err)
		}
		if is(t, ctx, on) {
			t.Error("intro played again on a second visit")
		}
	})
	t.Run("skip", func(t *testing.T) {
		t.Parallel()
		ctx := open(t, "no-preference")
		if !is(t, ctx, `window.introSeen === true`) {
			t.Fatal("no intro on a first landing")
		}
		if err := chromedp.Do(ctx, chromedp.KeyEvent(" ")); err != nil {
			t.Fatal(err)
		}
		if is(t, ctx, on) {
			t.Error("a key did not end the intro")
		}
	})
	t.Run("reduce", func(t *testing.T) {
		t.Parallel()
		if is(t, open(t, "reduce"), on) {
			t.Error("intro plays under reduced motion")
		}
	})
}
