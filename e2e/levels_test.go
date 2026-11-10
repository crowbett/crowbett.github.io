//go:build e2e

package e2e

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
)

// levelsCheck walks the numbers page's levels from every binary down to one
// of kvlite's own functions and its instructions. At each level it opens,
// the rows below add up to the row above, byte for byte; the function's
// instructions are decoded from kvlite.wasm and end where its body ends.
const levelsCheck = `(async () => {
	const n = (row) => Number(row.querySelector(".lv-b").textContent.replace(/,/g, ""));
	const rows = (det) => [...det.children].filter((c) => c.tagName !== "SUMMARY")
		.map((c) => c.matches(".lv-r") ? c : c.querySelector(":scope > summary, :scope > .lv-r")).filter(Boolean);
	const adds = (det) => {
		const parts = rows(det).filter((r) => r.querySelector(".lv-b"));
		return parts.length > 0 && parts.reduce((s, r) => s + n(r), 0) === n(det.querySelector(":scope > summary"));
	};
	const open = async (det) => {
		det.querySelector(":scope > summary").click();
		await until(() => det.open && rows(det).some((r) => r.querySelector(".lv-b")));
		if (!adds(det)) throw new Error("levels under " + det.querySelector(".lv-n").textContent + " do not add up");
	};
	const lv = document.querySelector("[data-levels]");
	const all = lv.querySelector(":scope > details");
	if (!all.open) throw new Error("the top level starts closed");
	if (!adds(all)) throw new Error("the languages do not add up to every binary");
	for (const lang of all.querySelectorAll(":scope > details")) await open(lang);
	const bin = lv.querySelector("details[data-tree=kvlite]");
	bin.scrollIntoView({ block: "center", behavior: "instant" });
	await open(bin);
	if (!("loaded" in bin.dataset)) throw new Error("kvlite's tree did not load");
	let at = [...bin.children].find((c) => c.tagName === "DETAILS" && c.querySelector(".lv-n").textContent === "Own code");
	await open(at);
	for (let i = 0; i < 12; i++) {
		const next = [...at.children].find((c) => c.tagName === "DETAILS");
		if (!next) break;
		await open(next);
		at = next;
	}
	const fn = at.querySelector(":scope > .lv-fnw > button.lv-fn");
	fn.click();
	const panel = () => at.querySelector(".lv-asm");
	if (!await until(() => panel() && Number(panel().dataset.lines) > 0, 30000)) return false;
	panel().querySelector(".lv-more")?.click();
	const text = panel().querySelector("pre").textContent.trim();
	if (fn.getAttribute("aria-expanded") !== "true") throw new Error("the function button is not marked expanded");
	if (!text.startsWith("func ") || !/\bend$/.test(text)) throw new Error("the instructions do not run from func to end: " + text.slice(0, 80) + " … " + text.slice(-80));
	if (document.scrollingElement.scrollWidth > innerWidth) throw new Error("the page scrolls sideways: " + document.scrollingElement.scrollWidth + " > " + innerWidth);
	await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
	return true;
})()`

func TestLevels(t *testing.T) {
	t.Parallel()
	for _, w := range []int64{1280, 390} {
		ctx, cancel := newTab(t, 60*time.Second)
		defer cancel()
		if err := chromedp.Do(ctx, chromedp.EmulateViewport(w, 900, touch(w)...), chromedp.Navigate(srv.URL+"/numbers/"), chromedp.WaitReady(chromedp.CSS("[data-levels]"))); err != nil {
			t.Fatal(err)
		}
		if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(levelsCheck), chromedp.EvalAwaitPromise)); err != nil || !ok {
			t.Fatalf("%d px: the levels did not open down to kvlite's instructions: %v", w, err)
		}
		axeOn(t, ctx, "[data-levels]")
		if keepShots {
			screenshot(t, ctx, w, filepath.Join(shots, "levels-"+map[int64]string{1280: "desktop", 390: "phone"}[w]))
		}
	}
}
