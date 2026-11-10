//go:build e2e

package e2e

import (
	"testing"
	"time"

	"github.com/chromedp/cdproto/input"
	"github.com/chromedp/chromedp"
)

// railDesk: the rail lists every section, marks the page's own, and pointing
// at a section opens its projects, every one of them, with the current
// project marked.
const railDesk = `(async () => {
	const rail = document.getElementById("rail");
	const box = rail.getBoundingClientRect();
	if (getComputedStyle(rail).position !== "fixed" || box.left !== 0 || box.height < innerHeight - 1) throw new Error("the rail is not down the left edge");
	if (document.querySelector("main").getBoundingClientRect().left < box.right) throw new Error("the rail covers the page");
	const cur = rail.querySelector(".rail-i[aria-current]");
	if (!cur || cur.textContent !== "Storage") throw new Error("kvlite's section is not marked");
	const fly = cur.parentElement.querySelector(".rail-fly");
	await until(() => "ready" in fly.dataset && getComputedStyle(fly).visibility === "visible");
	const all = await (await fetch("/search.json")).json();
	const want = all.filter((p) => p.group === "Databases and storage").map((p) => p.slug).join(" ");
	const got = [...fly.querySelectorAll("a.rail-p")].map((a) => a.pathname.split("/")[2]).join(" ");
	if (got !== want) throw new Error("the flyout lists " + got + ", want " + want);
	if (fly.querySelector("a[aria-current=page]")?.pathname !== "/projects/kvlite/") throw new Error("kvlite is not marked in its section");
	return true;
})()`

// railPhone: under 64rem the header key opens the rail as a drawer with every
// section's projects; Escape closes it and gives focus back to the key.
const railPhone = `(async () => {
	const rail = document.getElementById("rail"), key = document.querySelector("[data-rail]");
	if (key.hidden || getComputedStyle(rail).display !== "none") throw new Error("the rail is not folded into the header key");
	key.click();
	await until(() => rail.hasAttribute("data-open") && rail.querySelectorAll(".rail-fly[data-ready]").length === rail.querySelectorAll(".rail-g").length);
	if (key.getAttribute("aria-expanded") !== "true" || !rail.contains(document.activeElement)) throw new Error("the drawer did not take focus");
	if (!document.querySelector("main").inert) throw new Error("the page behind the drawer is not inert");
	const n = rail.querySelectorAll("a.rail-p").length, all = (await (await fetch("/search.json")).json()).length;
	if (n !== all) throw new Error("the drawer lists " + n + " projects, want " + all);
	await Promise.all(rail.getAnimations().map((a) => a.finished.catch(() => {})));
	return true;
})()`

const railClosed = `(() => !document.getElementById("rail").hasAttribute("data-open") && document.activeElement === document.querySelector("[data-rail]") && !document.querySelector("main").inert)()`

func TestRail(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	if err := chromedp.Do(ctx, chromedp.EmulateViewport(1280, 820), chromedp.Navigate(srv.URL+"/projects/kvlite/"), chromedp.WaitReady(chromedp.CSS("#rail"))); err != nil {
		t.Fatal(err)
	}
	xy, err := chromedp.Run(ctx, chromedp.Evaluate[[]float64](`(() => { const r = document.querySelector(".rail-i[aria-current]").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`))
	if err != nil {
		t.Fatal(err)
	}
	if err := chromedp.Do(ctx, chromedp.MouseEvent(input.DispatchMouseEventTypeMouseMoved, xy[0], xy[1])); err != nil {
		t.Fatal(err)
	}
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(railDesk), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Fatalf("desktop rail: %v", err)
	}
	axeOn(t, ctx, "#rail")

	phone, cancel2 := newTab(t, 60*time.Second)
	defer cancel2()
	if err := chromedp.Do(phone, chromedp.EmulateViewport(390, 820, touch(390)...), chromedp.Navigate(srv.URL+"/projects/kvlite/"), chromedp.WaitReady(chromedp.CSS("#rail"))); err != nil {
		t.Fatal(err)
	}
	if ok, err := chromedp.Run(phone, chromedp.Evaluate[bool](untilJS(railPhone), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Fatalf("phone drawer: %v", err)
	}
	axeOn(t, phone, "#rail")
	if err := chromedp.Do(phone, chromedp.KeyEvent("\x1b")); err != nil {
		t.Fatal(err)
	}
	if ok, err := chromedp.Run(phone, chromedp.Evaluate[bool](railClosed)); err != nil || !ok {
		t.Fatalf("Escape did not close the drawer and return focus: %v", err)
	}
}
