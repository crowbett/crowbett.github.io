//go:build e2e

package e2e

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
)

// levelsJS opens levels in a page: each open checks that the rows below add
// up to the row above, byte for byte, and descend walks from an origin down
// to a function and checks its instructions, decoded from the binary, run
// from its signature to its body's end.
const levelsJS = `
	const n = (row) => Number(row.querySelector(".lv-b").textContent.replace(/,/g, ""));
	const rows = (det) => [...det.children].filter((c) => c.tagName !== "SUMMARY")
		.map((c) => c.matches(".lv-r") ? c : c.querySelector(":scope > summary, :scope > .lv-r")).filter(Boolean);
	const adds = (det) => {
		const parts = rows(det).filter((r) => r.querySelector(".lv-b"));
		return parts.length > 0 && parts.reduce((s, r) => s + n(r), 0) === n(det.querySelector(":scope > summary"));
	};
	const open = async (det) => {
		if (!det.open) det.querySelector(":scope > summary").click();
		await until(() => det.open && rows(det).some((r) => r.querySelector(".lv-b")));
		if (!adds(det)) throw new Error("levels under " + det.querySelector(".lv-n").textContent + " do not add up");
	};
	const origin = (det, name) => [...det.children].find((c) => c.tagName === "DETAILS" && c.querySelector(".lv-n").textContent === name);
	const descend = async (at) => {
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
		await until(() => panel() && Number(panel().dataset.lines) > 0, 30000);
		panel().querySelector(".lv-more")?.click();
		const text = panel().querySelector("pre").textContent.trim();
		if (fn.getAttribute("aria-expanded") !== "true") throw new Error("the function button is not marked expanded");
		if (!text.startsWith("func ") || !/\bend$/.test(text)) throw new Error("the instructions do not run from func to end: " + text.slice(0, 80) + " … " + text.slice(-80));
		if (document.scrollingElement.scrollWidth > innerWidth) throw new Error("the page scrolls sideways: " + document.scrollingElement.scrollWidth + " > " + innerWidth);
		const own = document.querySelector("[data-levels]").getAnimations({ subtree: true }).filter((a) => a.timeline === document.timeline);
		await Promise.all(own.map((a) => a.finished.catch(() => {})));
		return true;
	};`

// numbersLevels opens every binary's levels on the numbers page down to one
// of kvlite's own functions.
const numbersLevels = `(async () => {` + levelsJS + `
	const lv = document.querySelector("[data-levels]");
	const all = lv.querySelector(":scope > details");
	if (!all.open) throw new Error("the top level starts closed");
	if (!adds(all)) throw new Error("the languages do not add up to every binary");
	for (const lang of all.querySelectorAll(":scope > details")) await open(lang);
	const bin = lv.querySelector("details[data-tree=kvlite]");
	bin.scrollIntoView({ block: "center", behavior: "instant" });
	await open(bin);
	if (!("loaded" in bin.dataset)) throw new Error("kvlite's tree did not load");
	return descend(origin(bin, "Own code"));
})()`

// projectLevels opens kvlite's project page levels: its origins are on the
// page before any download, and one opens down to a function.
const projectLevels = `(async () => {` + levelsJS + `
	const bin = document.querySelector("#bytes details[data-tree=kvlite]");
	if (!bin.open || !adds(bin)) throw new Error("kvlite's origins are not on the page, or do not add up to its binary");
	if (performance.getEntriesByType("resource").some((r) => r.name.includes("/bytes/"))) throw new Error("the tree downloaded before a level opened");
	bin.scrollIntoView({ block: "center", behavior: "instant" });
	return descend(origin(bin, "Own code"));
})()`

func TestLevels(t *testing.T) {
	t.Parallel()
	for _, pg := range []struct{ path, check, shot string }{{"/numbers/", numbersLevels, "levels"}, {"/projects/kvlite/", projectLevels, "levels-kvlite"}} {
		for _, w := range []int64{1280, 390} {
			ctx, cancel := newTab(t, 60*time.Second)
			defer cancel()
			if err := chromedp.Do(ctx, chromedp.EmulateViewport(w, 900, touch(w)...), chromedp.Navigate(srv.URL+pg.path), chromedp.WaitReady(chromedp.CSS("[data-levels]"))); err != nil {
				t.Fatal(err)
			}
			if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(pg.check), chromedp.EvalAwaitPromise)); err != nil || !ok {
				t.Fatalf("%s at %d px: the levels did not open down to kvlite's instructions: %v", pg.path, w, err)
			}
			axeOn(t, ctx, "[data-levels]")
			if keepShots {
				screenshot(t, ctx, w, filepath.Join(shots, pg.shot+"-"+map[int64]string{1280: "desktop", 390: "phone"}[w]))
			}
		}
	}
}
