//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
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
// long chain of home checks in TestSite does not grow. Headless Chrome on a
// CI runner has no pointing device, so the tab answers feel.js's media query
// as a desktop with a mouse would.
func TestPointerFeel(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	mouse := chromedp.Func(func(ctx context.Context, tg *chromedp.Target) error {
		_, err := cdp.Call(ctx, tg, page.AddScriptToEvaluateOnNewDocument, page.AddScriptToEvaluateOnNewDocumentParams{Source: `{
			const real = matchMedia.bind(window), q = "(hover: hover) and (pointer: fine)";
			window.matchMedia = (m) => m === q ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(m);
		}`})
		return err
	})
	if err := chromedp.Do(ctx, mouse, chromedp.EmulateViewport(1280, 900), chromedp.Navigate(srv.URL+"/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		t.Fatal(err)
	}
	feelCheck(t, ctx)
}

// TestShell opens the terminal with the ` key and runs the real binaries
// through it: kvlite's tries end on a measured receipt, trace draws a
// rendered image, an unknown command is refused, and Escape closes it. axe
// runs with it open.
func TestShell(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	if err := chromedp.Do(ctx, chromedp.EmulateViewport(1280, 900), chromedp.Navigate(srv.URL+"/projects/stash/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		t.Fatal(err)
	}
	run := `const run = (c) => { const i = document.querySelector("#tty-i"); i.value = c; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); };
		const text = () => document.querySelector(".tty-out").textContent;
		const idle = () => !("busy" in document.querySelector(".tty").dataset);`
	steps := []struct{ name, js string }{
		{"opens", `(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "` + "`" + `", bubbles: true, cancelable: true }));
			return until(() => document.querySelector(".tty[open]") && document.activeElement?.id === "tty-i" && document.querySelector(".tty-out").textContent.includes("projects run here")); })()`},
		{"runs kvlite's tries", `(async () => { ` + run + ` run("try kvlite");
			return until(() => idle() && /kvlite\.state: \d+ B of JSON from the real binary in [\d.]+ m?s/.test(text()) && text().includes('"carol"') && document.querySelector(".tty-p").textContent.endsWith("~/kvlite$")); })()`},
		{"traces an image", `(async () => { ` + run + ` run("trace cornell 2");
			await until(() => idle() && /cornell: 2 passes, [\d,]+ samples/.test(text()));
			const c = document.querySelector(".tty-img"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
			let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
			return lit > c.width * c.height / 4; })()`},
		{"refuses a typo", `(async () => { ` + run + ` run("cd ..");
			await until(() => idle() && document.querySelector(".tty-p").textContent.endsWith("~$")); run("lss");
			return until(() => idle() && text().includes("lss: no such command")); })()`},
		{"pipes", `(async () => { ` + run + ` run("ls | grep live | wc");
			await until(() => idle() && /\n?\d+ lines, \d+ words, \d+ chars$/.test(document.querySelector(".tty-out > p:last-child").textContent));
			const live = (await (await fetch("/search.json")).json()).filter((p) => p.live).length;
			if (document.querySelector(".tty-out > p:last-child").textContent !== (live + 1) + " lines, " + document.querySelector(".tty-out > p:last-child").textContent.split(" lines, ")[1]) return false;
			run("code keel 1 | tail 1");
			return until(() => idle() && /^\s*\d+  /.test(document.querySelector(".tty-out > :last-child").textContent) && document.querySelector(".tty-out > :last-child").textContent.trim().split("\n").length === 1); })()`},
		{"greps the site", `(async () => { ` + run + ` run("grep lease");
			return until(() => idle() && /jobrun\s+jobs\.sql:\d+\s+--/.test(text())); })()`},
	}
	for _, s := range steps {
		if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(s.js), chromedp.EvalAwaitPromise)); err != nil || !ok {
			t.Fatalf("shell %s: %v", s.name, err)
		}
	}
	pageQuality(t, ctx)
	closed := `(async () => { document.querySelector("#tty-i").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		document.querySelector(".tty").close(); return until(() => !document.querySelector(".tty[open]")); })()`
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(closed), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Fatalf("shell did not close: %v", err)
	}
}

// TestTheme flips the header switch on a light page: the dark tokens apply,
// the choice survives a reload, and switching back to the system's theme
// clears it.
func TestTheme(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	light := chromedp.Func(func(ctx context.Context, tg *chromedp.Target) error {
		_, err := cdp.Call(ctx, tg, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{
			Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: "light"}},
		})
		return err
	})
	if err := chromedp.Do(ctx, light, chromedp.EmulateViewport(1280, 900), chromedp.Navigate(srv.URL+"/projects/kvlite/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		t.Fatal(err)
	}
	bg := `getComputedStyle(document.body).backgroundColor`
	steps := []struct{ name, js string }{
		{"goes dark", `(async () => { const light = ` + bg + `; document.querySelector("[data-mode]").click();
			return until(() => document.documentElement.dataset.theme === "dark" && localStorage.getItem("theme") === "dark" && ` + bg + ` !== light && document.querySelector("[data-mode]").ariaPressed === "true" && !("flip" in document.documentElement.dataset)); })()`},
		{"applies before paint after a reload", `(async () => until(() => document.readyState !== "loading" && document.documentElement.dataset.theme === "dark" && document.querySelector('meta[name="theme-color"]').content === "#0a0d13"))()`},
		{"goes back to the system's", `(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
			return until(() => !("theme" in document.documentElement.dataset) && localStorage.getItem("theme") === null && document.querySelector("[data-mode]").ariaPressed === "false"); })()`},
	}
	for _, s := range steps {
		if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(s.js), chromedp.EvalAwaitPromise)); err != nil || !ok {
			t.Fatalf("theme %s: %v", s.name, err)
		}
		if s.name == "goes dark" {
			if err := chromedp.Do(ctx, chromedp.Reload(), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// TestFind searches the write-ups from the palette: words from a write-up
// open its page with the passage marked.
func TestFind(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	if err := chromedp.Do(ctx, cores(2), chromedp.EmulateViewport(1280, 900), chromedp.Navigate(srv.URL+"/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		t.Fatal(err)
	}
	// search types q, waits for a hit of kind tag with a marked word, and opens it.
	search := func(q, tag string) {
		js := `(async () => {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
			await until(() => document.querySelector(".pal[open] input"));
			const i = document.querySelector(".pal input");
			i.value = ` + jsString(q) + `; i.dispatchEvent(new Event("input"));
			const pick = () => [...document.querySelectorAll(".pal [role=option]")].find((o) => o.querySelector(".pal-i")?.textContent === ` + jsString(tag) + ` && o.querySelector("mark"));
			if (!(await until(pick))) return false;
			const o = pick();
			o.click();
			return true;
		})()`
		if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(js), chromedp.EvalAwaitPromise)); err != nil || !ok {
			t.Fatalf("search %q found no %s hit: %v", q, tag, err)
		}
	}
	// Three words from the middle of the first write-up passage.
	pick, err := chromedp.Run(ctx, chromedp.Evaluate[string](`fetch("/find.json").then((r) => r.json()).then((d) => d.find((x) => x.k === "w").t.split(" ").slice(2, 5).join(" "))`, chromedp.EvalAwaitPromise))
	if err != nil || pick == "" {
		t.Fatalf("find.json: %q %v", pick, err)
	}
	search(pick, "text")
	ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(`until(() => /#find=/.test(location.hash) && document.querySelector(".found")?.textContent.replace(/\s+/g, " ").includes(`+jsString(pick)+`))`), chromedp.EvalAwaitPromise))
	if err != nil || !ok {
		t.Fatalf("text hit for %q did not mark its passage: %v", pick, err)
	}
}

// jsString quotes s as a JavaScript string literal.
func jsString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// TestPeek flips the first home panel to its code at phone width: the face
// shows the excerpt's numbered lines and, for a public repository, links to
// those lines on GitHub; axe
// runs with it open, and Escape flips it back with focus on the button.
func TestPeek(t *testing.T) {
	t.Parallel()
	ctx, cancel := newTab(t, 60*time.Second)
	defer cancel()
	if err := chromedp.Do(ctx, chromedp.EmulateViewport(390, 844, chromedp.EmulateTouch), chromedp.Navigate(srv.URL+"/"), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		t.Fatal(err)
	}
	open := `(async () => {
		const b = document.querySelector(".it-peek");
		b.click();
		const f = document.getElementById(b.getAttribute("aria-controls"));
		return until(() => b.getAttribute("aria-pressed") === "true" && !f.hidden && f.offsetHeight > 200 &&
			f.querySelectorAll(".pk-c .l").length >= 5 && f.querySelector(".pk-c .ln").textContent === String(Number(f.querySelector(".pk-h span").textContent.split(":").pop().split("–")[0])) &&
			(!f.querySelector(".pk-more") || (f.querySelector(".pk-more").hostname === "github.com" && f.querySelector(".pk-more").hash.startsWith("#L"))));
	})()`
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(open), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Fatalf("peek did not open: %v", err)
	}
	pageQuality(t, ctx)
	shut := `(async () => {
		const b = document.querySelector(".it-peek"), f = document.getElementById(b.getAttribute("aria-controls"));
		f.querySelector(".pk-c").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		return until(() => f.hidden && b.getAttribute("aria-pressed") === "false" && document.activeElement === b && !b.closest(".it").querySelector("[data-peek].it-view"));
	})()`
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(shut), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Fatalf("Escape did not close the peek: %v", err)
	}
}
