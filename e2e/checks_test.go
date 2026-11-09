//go:build e2e

package e2e

import (
	"context"
	"testing"
	"time"

	"github.com/chromedp/cdproto/input"
	"github.com/chromedp/chromedp"
)

// workCheck walks the home reel by focus, as Tab and j/k do: the focused
// project's panel comes up over the others and covers the middle of the
// screen, it is current and plays its recorded clip, no other clip plays,
// and the panels buried under the one below it are hidden. The clip is the
// crop for the screen's width: the desktop one where its <source> matches.
const workCheck = `(async () => {
	const items = [...document.querySelectorAll(".it")];
	const playing = () => [...document.querySelectorAll(".it video")].filter((v) => !v.paused && v.isConnected);
	const at = async (slug) => {
		const it = document.querySelector("#p-" + slug);
		const k = items.indexOf(it);
		const clip = "/reel/" + slug + (matchMedia(it.querySelector("source").media).matches ? "" : "-n") + ".mp4";
		it.querySelector("h4 a").focus();
		return until(() => "now" in it.dataset && playing().length === 1 && playing()[0].src.endsWith(clip) && "on" in playing()[0].dataset
			&& it.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))
			&& items.every((x, i) => ("gone" in x.dataset) === (k > 0 && i < k - 1)));
	};
	return await at("netcode") && await at("keel");
})()`

// indexCheck uses the dock and the index at the end of the reel: "All"
// reaches the index and hides the dock, an area and a language narrow the
// cards and say how many are left, and a tick jumps to its panel pinned under
// the header, playing only its clip.
const indexCheck = `(async () => {
	const dock = document.querySelector(".dock"), n = document.querySelector("[data-all-n]");
	const shown = () => [...document.querySelectorAll(".card")].filter((c) => !c.hidden).length;
	const press = (f, v) => document.querySelector("[data-f=" + f + "][data-v='" + v + "']").click();
	dock.querySelector(".dock-all").click();
	if (!await until(() => !("on" in dock.dataset) && !document.querySelector(".it[data-now]"))) return false;
	const langs = [...document.querySelectorAll("[data-f=lang]")].map((b) => b.dataset.v).filter(Boolean);
	const go = [...document.querySelectorAll(".card")].filter((c) => c.dataset.lang.split(", ").includes(langs[0])).length;
	press("lang", langs[0]);
	if (!await until(() => shown() === go && n.textContent.startsWith(go + " of "))) return false;
	press("lang", "");
	if (!await until(() => shown() === document.querySelectorAll(".card").length)) return false;
	const tick = dock.querySelectorAll(".dock-ticks a")[2];
	tick.click();
	const it = document.querySelector("#p-" + tick.dataset.slug);
	return until(() => "now" in it.dataset && "on" in dock.dataset && "now" in tick.dataset
		&& Math.abs(it.getBoundingClientRect().top - document.querySelector(".top").offsetHeight) < 2
		&& document.querySelectorAll(".it video").length <= 2);
})()`

// refusedCheck plays the reel as iOS Low Power Mode does: every play() is
// refused, so the clip holds its poster, and the visitor's next tap starts it.
const refusedCheck = `(async () => {
	const P = HTMLMediaElement.prototype, real = P.play;
	const it = document.querySelector("#p-lobby");
	const playing = () => [...document.querySelectorAll(".it video")].some((v) => !v.paused && v.isConnected);
	let held = false;
	try {
		P.play = () => Promise.reject(new DOMException("refused", "NotAllowedError"));
		it.querySelector("h4 a").focus();
		held = await until(() => "now" in it.dataset && document.querySelector(".it video[src*='/reel/lobby']") && !playing());
	} finally {
		P.play = real;
	}
	document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	return held && await until(playing);
})()`

// stageCheck waits for the home stage to render in this tab: the real path
// tracer finishes passes, the readouts fill with measured values and the
// noise ratio shows the light-sampled half is the cleaner one. The stage is
// sticky, so it is seen from the top of the page, not scrolled into view.
const stageCheck = `(async () => {
	const f = document.querySelector("[data-stage]");
	scrollTo(0, 0);
	const v = (k) => f.querySelector("[data-k=" + k + "]").textContent;
	return until(() => "live" in f.dataset && Number(v("spp")) >= 2 && /^[\d,]+k$/.test(v("rate")) && parseFloat(v("ratio")) > 1
		&& /^live, pass \d+$/.test(f.querySelector("[data-state]").textContent));
})()`

// sceneCheck picks the glass sphere on the stage: the tracer loads that
// scene, restarts from pass one and its readouts fill again.
const sceneCheck = `(async () => {
	const f = document.querySelector("[data-stage]");
	const b = f.querySelector("[data-scene-id=final3]");
	b.click();
	const v = (k) => f.querySelector("[data-k=" + k + "]").textContent;
	return until(() => b.getAttribute("aria-pressed") === "true" && f.dataset.scene === "final3" && Number(v("spp")) >= 1
		&& /^live, pass \d+$/.test(f.querySelector("[data-state]").textContent) && f.querySelector(".stage-view img").alt.startsWith("The Cornell box, glass sphere traced"));
})()`

// demoChecks holds, per demo slug, JavaScript expressions that must all be
// true (or resolve true) once the demo reports ready. Every live demo adds
// at least one check that proves it rendered real output from its binary.
var demoChecks = map[string][]string{
	"smoke": {`document.querySelector(".demo-out").textContent.includes("answered: hello from the page")`},
	"codegraph": {
		`until(() => document.querySelectorAll(".cg-node").length === 17 && document.querySelectorAll(".cg-e:not(.cg-via)").length === 19 && document.querySelectorAll(".cg-likely.cg-e").length === 1 &&
			[...document.querySelectorAll(".cg-cells .cg-v")].slice(0, 3).map((v) => v.textContent).join() === "26,17,99" &&
			document.querySelectorAll(".cg-node.is-focus").length > 0 && document.querySelectorAll(".cg-e.is-up, .cg-e.is-down").length > 0 &&
			document.querySelector(".cg-foot").textContent.includes("99 edges (imports excluded), 50 resolved to a definition: 44 exact, 6 likely, 0 name_only"))`,
		`(async () => {
			const v = (k) => document.querySelector(".cg-cells [data-k=" + k + "] .cg-v").textContent;
			const sum = () => document.querySelector(".cg-summary").textContent;
			const hops = () => [...document.querySelectorAll(".cg-node.is-up")].map((g) => g.querySelector(".cg-name").textContent + g.querySelector(".cg-hop").textContent).sort().join();
			const play = document.querySelector(".cg-acts button");
			if (play.textContent === "Pause") play.click();
			document.querySelector(".cg-node[data-spec='src/store.rs:32']").dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return until(() => sum() === "store::Store::bump (src/store.rs:32): 2 callers; 0 callees, 0 resolved, 0 unresolved." &&
				hops() === "Store::delete↑1,Store::set↑1,main↑3,run↑2" && v("callers") === "4" && v("depth") === "3" && v("callees") === "0" &&
				/^\d+ call-tree queries walked from store::Store::bump in [\d.]+ ms; drawing the graph took 17 more in [\d.]+ ms, after indexing 4 files in [\d.]+ ms, in your browser\.$/.test(document.querySelector(".cg-out").textContent));
		})()`,
		`(async () => {
			const play = document.querySelector(".cg-acts button");
			if (play.textContent === "Pause") play.click();
			const search = (q) => { document.querySelector("input[name=symbol]").value = q; document.querySelector(".cg-find button").click(); };
			const sum = () => document.querySelector(".cg-summary").textContent;
			const st = () => document.querySelector(".cg-status").textContent;
			search("write");
			let ok = await until(() => sum().startsWith("write names log::Stdout::write (src/log.rs:11) and log::Sink::write (src/log.rs:2): 3 callers;") &&
				document.querySelectorAll(".cg-node.is-focus").length === 2 && document.querySelectorAll(".cg-via.is-up").length === 2 &&
				[...document.querySelectorAll("[aria-labelledby=cg-callers] .cg-where")].some((w) => w.textContent.includes("via log::Sink::write")));
			search("tokenize");
			ok = ok && await until(() => sum().startsWith("parse::tokenize (src/parse.rs:30)") && document.querySelector(".cg-code").dataset.file === "src/parse.rs");
			document.querySelector(".cg-line[data-n='36']").click();
			ok = ok && await until(() => sum().startsWith("parse::key (src/parse.rs:34): 1 caller; 4 callees, 1 resolved, 3 unresolved.") && st() === "src/parse.rs:36 is inside parse::key.");
			search("Store");
			ok = ok && await until(() => st() === "Store resolves to struct store::Store (src/store.rs:4); the graph draws functions and methods.");
			search("nope");
			return ok && await until(() => st() === "no symbol named ` + "`nope` (try `codegraph find nope`)" + `" && sum().startsWith("parse::key "));
		})()`,
		`(async () => {
			const play = document.querySelector(".cg-acts button");
			if (play.textContent === "Pause") play.click();
			const v = (k) => document.querySelector(".cg-cells [data-k=" + k + "] .cg-v").textContent;
			const set = (n, x) => { const s = document.querySelector("select[name=" + n + "]"); s.value = x; s.dispatchEvent(new Event("change")); };
			document.querySelector("input[name=symbol]").value = "main";
			document.querySelector(".cg-find button").click();
			let ok = await until(() => document.querySelector(".cg-summary").textContent.startsWith("main (src/main.rs:11)"));
			set("ripple", "callees"); set("depth", "1");
			ok = ok && await until(() => v("callers") === "–" && v("callees") === "6" && v("unresolved") === "5" && v("depth") === "1" && document.querySelectorAll(".cg-node.is-up").length === 0 &&
				document.querySelector(".cg-out").textContent.startsWith("2 call-tree queries walked from main in "));
			set("ripple", "both"); set("depth", "8");
			return ok && await until(() => v("callers") === "0" && v("callees") === "15" && v("depth") === "3");
		})()`,
	},
	"lobby": {
		`Number(document.querySelector(".lb-cells [data-k=rooms] .lb-v").textContent) > 0 && /^Matchmaking floor at [\d.]+ s of simulated time: \d+ waiting, \d+ rooms started/.test(document.querySelector(".lb-canvas").getAttribute("aria-label"))`,
		`(() => { const c = document.querySelector(".lb-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".lb-acts button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".lb-cells [data-k=" + k + "] .lb-v").textContent;
			if (document.querySelector(".lb-acts button").textContent === "Pause") click("Pause");
			click("Reset");
			return await until(() => v("t") === "8.0 s" && v("rooms") === "3" && v("refills") === "1" && v("walkouts") === "1" && v("short") === "0" &&
				!document.querySelector(".lb-cells [data-k=refills]").hidden && !document.querySelector("input[name=refill]").closest("label").hidden);
		})()`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".lb-acts button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".lb-cells [data-k=" + k + "] .lb-v").textContent;
			if (document.querySelector(".lb-acts button").textContent === "Pause") click("Pause");
			const m = document.querySelector("select[name=mode]");
			m.value = "duel"; m.dispatchEvent(new Event("change"));
			let ok = await until(() => v("t") === "8.0 s" && v("rooms") === "12" && v("queue") === "5" && document.querySelector(".lb-cells [data-k=refills]").hidden);
			const s = document.querySelector("input[name=skill]");
			s.value = "1500";
			click("Queue me");
			ok = ok && await until(() => document.querySelector(".lb-you").textContent.startsWith("You are queued at skill 1,500."));
			click("Step 1 s");
			return ok && await until(() => document.querySelector(".lb-you").textContent === "Matched after 0.1 s into m13 with 1,461; skill spread 39." && v("rooms") === "13");
		})()`,
	},
	"mcpbridge": {
		`document.querySelector('.mb-row[data-leg="b2s"] .mb-method').textContent === "server/discover"`,
		`document.querySelector(".mb-ihead").textContent === "16 · bridge to server · tools/list" && [...document.querySelectorAll(".mb-json .mb-add .mb-k")].some((k) => k.textContent === '"io.modelcontextprotocol/protocolVersion"')`,
		`document.querySelector(".mb-refused .mb-badge").textContent === "unsupported" && document.querySelector(".mb-status").textContent.startsWith("7 client frames, 26 frames on the wire: 4 translated, 4 made by the bridge, 1 refused")`,
		`(async () => {
			const st = () => document.querySelector(".mb-status").textContent;
			const settled = () => !document.querySelector(".mb-pending");
			const click = (t) => [...document.querySelectorAll(".mb-bar button")].find((b) => b.textContent.startsWith(t)).click();
			click("Step");
			let ok = await until(() => st().startsWith("1 client frame, 6 frames on the wire") && settled());
			click("Play");
			ok = ok && await until(() => document.querySelector(".mb-bar button").textContent === "Playing…");
			ok = ok && await until(() => /^[2-6] client frames/.test(st()));
			click("Step");
			return ok && await until(() => /^[3-7] client frames/.test(st()) && settled() && document.querySelector(".mb-bar button").textContent === "Play");
		})()`,
		`(async () => {
			const methods = (leg) => [...document.querySelectorAll('.mb-row[data-leg="' + leg + '"] .mb-method')].map((m) => m.textContent);
			const d = document.querySelector("select[name=direction]");
			d.value = "reverse"; d.dispatchEvent(new Event("change"));
			let ok = await until(() => methods("b2s").includes("initialize") && methods("b2c").includes("prompts/list error -32602"));
			document.querySelectorAll('.mb-row[data-leg="c2b"] .mb-pkt')[3].click();
			const ta = document.querySelector(".mb-ed textarea");
			ta.value = JSON.stringify({ jsonrpc: "2.0", id: 4, method: "prompts/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } });
			ta.dispatchEvent(new Event("input"));
			ok = ok && await until(() => methods("b2c").includes("prompts/list result") && methods("b2s").includes("prompts/list"));
			d.value = "forward"; d.dispatchEvent(new Event("change"));
			return ok && await until(() => methods("b2s")[0] === "server/discover" && document.querySelector(".mb-ihead").textContent.startsWith("16 "));
		})()`,
	},
	"ratelimitd": {
		`[...document.querySelectorAll(".rl-chart")].map(c => c.dataset.algo).join() === "gcra,token_bucket,sliding_window"`,
		`[...document.querySelectorAll(".rl-chart")].every(c => c.querySelectorAll("rect.rl-allowed").length > 20 && c.querySelectorAll("rect.rl-denied").length > 0)`,
		`/^923 requests through 3 algorithms/.test(document.querySelector(".rl-status").textContent)`,
	},
	// The floor runs on seed 1: after a reset the engine has packed three
	// orders; the fourth (a dropper bottle) goes in a box by rule, your cap
	// order too, and taking its box off the shelf re-judges the shift.
	"anchorflow": {
		`Number(document.querySelector(".af-cells [data-k=orders] .af-v").textContent) >= 3 && /^Packing floor at [\d:]+ of floor time: \d+ orders packed, \d+ in boxes and \d+ in mailers, latest #\d{3} in /.test(document.querySelector(".af-canvas").getAttribute("aria-label")) && /^\d+ orders packed by AnchorFlow's fit engine: \d+ calls judged [\d,]+ packages in [\d,]+ ms, in your browser\.$/.test(document.querySelector(".af-out").textContent)`,
		`(() => { const c = document.querySelector(".af-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".af-controls button, .af-shelfhead button")].find((b) => b.textContent === t).click();
			const label = () => document.querySelector(".af-canvas").getAttribute("aria-label");
			const you = () => document.querySelector(".af-youline").textContent;
			if (document.querySelector(".af-acts button").textContent === "Pause") click("Pause");
			click("Reset");
			let ok = await until(() => label() === "Packing floor at 0:01:27 of floor time: 3 orders packed, 2 in boxes and 1 in mailers, latest #003 in 7 1/4 x 12.");
			click("Next order");
			ok = ok && await until(() => label().endsWith("latest #004 in Multi Box.") && document.querySelector(".af-now").textContent.includes("7 this basket needs a box"));
			click("Drop on the line");
			ok = ok && await until(() => you() === "Your order #Y1 (Cap, Folded T-shirt ×2) went in 9 x 7 x 5, box, $0.62 all in, 83 % full. Warehouse rule first: Cap ships only in a box.");
			[...document.querySelectorAll(".af-pkg")].find((b) => b.firstChild.textContent === "9 x 7 x 5").click();
			ok = ok && await until(() => document.querySelector(".af-status").textContent.startsWith("9 x 7 x 5 is off the shelf. The engine re-judged all 5 orders packed so far: 1 pick changed, cost ") && you().startsWith("Your order #Y1 (Cap, Folded T-shirt ×2) now goes in "));
			click("Restock");
			return ok && await until(() => document.querySelector(".af-status").textContent.startsWith("Every package is back on the shelf. The engine re-judged all 5 orders packed so far: 1 pick changed"));
		})()`,
	},
	"btrv": {
		`until(() => [...document.querySelectorAll(".bt-key:not([hidden])")].map((k) => k.dataset.kind + ":" + k.querySelector(".bt-count").textContent).filter((t) => /^(fcr|pat|data|free|unreferenced):/.test(t)).join() === "fcr:2,pat:2,data:250,free:5,unreferenced:4")`,
		`(async () => {
			await until(() => document.querySelector(".bt-cells [data-k=records] .bt-v").textContent.endsWith("/ 2,919"));
			const c = document.querySelector(".bt-map"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set();
			for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
			return set.size > 6;
		})()`,
		`(async () => {
			const v = (k) => document.querySelector(".bt-cells [data-k=" + k + "] .bt-v").textContent;
			const play = document.querySelector(".bt-acts button");
			const cor = document.querySelector(".bt-corrupt");
			const status = () => document.querySelector(".bt-status").textContent;
			const feed = () => [...(document.querySelector(".bt-feed tbody tr")?.querySelectorAll("td") || [])].map((td) => td.textContent).slice(0, 3).join();
			const sp = document.querySelector("select[name=speed]");
			sp.value = "10"; sp.dispatchEvent(new Event("change"));
			let ok = await until(() => play.textContent === "Replay" && v("records") === "2,919 / 2,919" && feed() === "2,919,3000,Harriet" &&
				status() === "Every record the header counts was read and decoded: 2,919 of 2,919 rows, 0 column errors." && /^401 pages mapped and 2,919 rows decoded by btrv in \d+ ms of calls, in your browser\.$/.test(document.querySelector(".demo-out").textContent));
			ok = ok && await until(() => [...document.querySelectorAll(".bt-insp tbody tr")].map((tr) => tr.firstChild.textContent + "=" + tr.lastChild.textContent).includes("Birth=1950-01-25"));
			ok = ok && cor.textContent === "Corrupt page 164";
			cor.click();
			ok = ok && await until(() => play.textContent === "Replay" && !cor.disabled && v("bad") === "1" && cor.textContent === "Repair page 164" &&
				status().startsWith("The read stopped at physical page 164 (logical 160) after 1,168 of 2,919 rows rather than skip a page: source error after 1168 rows"));
			cor.click();
			ok = ok && await until(() => play.textContent === "Replay" && !cor.disabled && v("bad") === "0" && v("records") === "2,919 / 2,919");
			const map = document.querySelector(".bt-map");
			const key = (k) => map.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
			key("Home"); for (let i = 0; i < 6; i++) key("ArrowRight");
			ok = ok && cor.textContent === "Corrupt page 6";
			cor.click();
			ok = ok && await until(() => play.textContent === "Replay" && !cor.disabled && v("records") === "2,919 / 2,919" &&
				status() === "Page 6 is flagged: the PAT says index page 3 of key 0, the header says otherwise. The record walk did not need it: 2,919 of 2,919 rows, 0 column errors.");
			cor.click();
			ok = ok && await until(() => play.textContent === "Replay" && !cor.disabled && v("bad") === "0");
			const sc = document.querySelector("select[name=schema]");
			sc.value = "infer"; sc.dispatchEvent(new Event("change"));
			ok = ok && await until(() => play.textContent === "Replay" && v("records") === "2,919 / 2,919" && document.querySelector(".bt-feed thead th:nth-child(2)").textContent === "col01");
			document.querySelector(".bt-export button").click();
			return ok && await until(() => document.querySelector(".bt-expstatus").textContent.startsWith("PERSON.csv: 2,919 rows written, 0 with column errors"));
		})()`,
	},
	"jobrun": {
		`document.querySelectorAll(".jr-run").length === 10 && document.querySelector(".jr-run .jr-mono").textContent === "Sat 2026-03-07 02:30"`,
		`[...document.querySelectorAll(".jr-table tbody tr")].length === 8 && document.querySelector(".jr-dead td").textContent === "8"`,
		`document.querySelectorAll(".jr-chart line.jr-dot").length === 7 * 20`,
		`(async () => {
			const s = document.querySelector("select[name=cronPreset]");
			const runs = () => [...document.querySelectorAll(".jr-run .jr-mono")].map((r) => r.textContent).slice(0, 2).join();
			for (let i = 0; i < 100 && runs() !== "Sat 2026-03-07 02:30,Mon 2026-03-09 02:30"; i++) await new Promise((r) => setTimeout(r, 50));
			const note = () => document.querySelector(".jr-note").textContent;
			let ok = runs() === "Sat 2026-03-07 02:30,Mon 2026-03-09 02:30" && note().includes("8 March");
			const z = document.querySelector("select[name=tz]");
			z.value = "UTC"; z.dispatchEvent(new Event("change"));
			for (let i = 0; i < 100 && runs() !== "Sat 2026-03-07 02:30,Sun 2026-03-08 02:30"; i++) await new Promise((r) => setTimeout(r, 50));
			ok = ok && runs() === "Sat 2026-03-07 02:30,Sun 2026-03-08 02:30" && note() === "";
			s.value = "0"; s.dispatchEvent(new Event("change"));
			for (let i = 0; i < 100 && runs() !== "Thu 2026-01-01 09:00,Thu 2026-01-01 09:15"; i++) await new Promise((r) => setTimeout(r, 50));
			return ok && runs() === "Thu 2026-01-01 09:00,Thu 2026-01-01 09:15" && z.value === "Europe/London";
		})()`,
	},
	"kvlite": {
		`[...document.querySelectorAll(".kv-table tbody tr")].map((r) => r.cells[2].textContent + ":" + r.cells[3].textContent).join() === "put:user:1,put:user:2,put:user:1,delete:user:2"`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".kv-controls button")].find((b) => b.textContent === t).click();
			const segs = () => [...document.querySelectorAll(".kv-seg")].map((s) => s.querySelector(".kv-seg-meta").textContent + "|" +
				[...s.querySelectorAll("tbody tr")].map((r) => r.cells[2].textContent + ":" + r.cells[3].textContent).join());
			const keys = () => [...document.querySelectorAll(".kv-keys li span:first-child")].map((s) => s.textContent).join();
			const log = () => document.querySelector(".kv-log").textContent;
			click("Compact");
			let ok = await until(() => /^sealed · \d+ B · hint file\|put:user:1;active · 16 B\|$/.test(segs().join(";")));
			const k = document.querySelector("input[name=key]");
			k.value = "late";
			click("Put");
			ok = ok && await until(() => keys() === "late,user:1");
			const tear = document.querySelector("select[name=tear]");
			tear.value = "5";
			click("Crash and reopen");
			const status = () => document.querySelector(".kv-status").textContent;
			ok = ok && await until(() => log().includes("truncated torn tail") && keys() === "user:1" && status().includes(", 5 bytes torn off"));
			click("Reset");
			click("Compact");
			return ok && await until(() => status().startsWith("Nothing to compact") && keys() === "");
		})()`,
	},
	"edgecache": {
		`until(() => { const v = (k) => document.querySelector(".ec-cells [data-k=" + k + "] .ec-v").textContent; return Number(v("requests")) > 0 && ["MISS", "HIT", "STALE", "REVALIDATED"].includes(document.querySelector(".ec-table .ec-badge").textContent) && /^Edge at \d+ s of simulated time: \d+ requests, \d+ served from cache, \d+ sent to the origin/.test(document.querySelector(".ec-canvas").getAttribute("aria-label")); })`,
		`(() => { const c = document.querySelector(".ec-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()`,
		`(() => { const b = document.querySelector(".ec-scroll"); return b.getAttribute("aria-label") === "Response log" && (b.tabIndex < 0 || b.getAttribute("role") === "region"); })()`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".ec-acts button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".ec-cells [data-k=" + k + "] .ec-v").textContent;
			const col = (sel) => [...document.querySelectorAll(sel)].map((c) => c.textContent).join();
			const play = document.querySelector(".ec-acts button");
			if (play.textContent === "Pause") click("Pause");
			click("Reset");
			await until(() => v("requests") === "1");
			for (let i = 0; i < 30; i++) { click("Step 10 s"); await new Promise((r) => setTimeout(r, 30)); }
			let ok = await until(() => v("t") === "300 s" && v("requests") === "30" && v("ratio") === "93.3 %" && v("origin") === "6" && v("saved") === "24" && v("r304") === "5" && v("p50") === "8 s" && v("p95") === "40 s" &&
				col(".ec-table tbody tr td:nth-child(2) .ec-badge") === "HIT,STALE,HIT,HIT,HIT,HIT");
			const kind = document.querySelector("select[name=yours]");
			kind.value = "reload"; kind.dispatchEvent(new Event("change"));
			click("Send my request");
			ok = ok && await until(() => document.querySelector(".ec-you").textContent === 'Your GET (Cache-Control: no-cache) at 300 s: REVALIDATED, status 200, Age 0, body "version 1". The origin saw conditional GET → 304.' && v("requests") === "31" && v("r304") === "6");
			const pol = document.querySelector("select[name=policy]");
			pol.value = "no-store"; pol.dispatchEvent(new Event("change"));
			return ok && await until(() => v("ratio") === "0.0 %" && v("origin") === "31" && v("saved") === "0" && col(".ec-table tbody .ec-badge") === "BYPASS,BYPASS,BYPASS,BYPASS,BYPASS,BYPASS" &&
				document.querySelector(".ec-table tbody tr td:nth-child(4)").textContent === "version 31");
		})()`,
	},
	"strata": {
		`/^XY test piece: 272 triangles, 20 × 20 × 5 mm\. Sliced into 25 layers of 1,033 toolpaths, 10\.79 m in all, in \d[\d,]* ms in your browser\.$/.test(document.querySelector(".st-summary").textContent)`,
		`document.querySelector(".st-where").textContent === "11 of 25 · z 2.2 mm"`,
		`[...document.querySelectorAll(".st-key")].map((k) => k.dataset.kind).join() === "OuterWall,InnerWall,SparseInfill"`,
		`(() => { const c = document.querySelector(".st-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 2000; })()`,
		`(async () => {
			const text = (sel) => document.querySelector(sel).textContent;
			const set = (sel, v, ev) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event(ev)); };
			set("input[name=layer]", "0", "input");
			let ok = await until(() => text(".st-where") === "1 of 25 · z 0.2 mm" && !!document.querySelector(".st-key[data-kind=Skirt]"));
			set("select[name=layerHeight]", "0.12", "change");
			ok = ok && await until(() => text(".st-summary").includes("Sliced into 41 layers") && text(".st-where") === "1 of 41 · z 0.2 mm");
			let stl = "solid t\n";
			const v = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
			for (const f of [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]) stl += "facet normal 0 0 0\nouter loop\n" + f.map((i) => "vertex " + v[i].join(" ") + "\n").join("") + "endloop\nendfacet\n";
			const dt = new DataTransfer();
			dt.items.add(new File([stl + "endsolid t\n"], "tetra.stl"));
			const file = document.querySelector("input[name=file]");
			file.files = dt.files;
			file.dispatchEvent(new Event("change"));
			const tetra = (n) => text(".st-summary").startsWith("tetra.stl: 4 triangles, 10 × 10 × 10 mm. Sliced into " + n + " layers");
			ok = ok && await until(() => tetra(83) && document.querySelector("select[name=model]").selectedOptions[0].textContent === "tetra.stl");
			const pickFile = (body, name) => { const t = new DataTransfer(); t.items.add(new File([body], name)); file.files = t.files; file.dispatchEvent(new Event("change")); };
			const model = () => document.querySelector("select[name=model]").selectedOptions[0].textContent;
			set("select[name=layerHeight]", "0.2", "change");
			pickFile("AAAA", "bad.stl");
			ok = ok && await until(() => text(".st-summary").startsWith("bad.stl: ") && model() === "tetra.stl" && / of 50 · /.test(text(".st-where")));
			pickFile(stl + "endsolid t\n", "tetra.stl");
			set("select[name=layerHeight]", "0.12", "change");
			ok = ok && await until(() => tetra(83) && model() === "tetra.stl" && / of 83 · /.test(text(".st-where")));
			set("select[name=layerHeight]", "0.2", "change");
			ok = ok && await until(() => tetra(50));
			set("select[name=model]", "xy", "change");
			ok = ok && await until(() => text(".st-summary").startsWith("XY test piece: 272 triangles") && text(".st-summary").includes("Sliced into 25 layers") && !document.querySelector("option[value=file]"));
			set("input[name=layer]", "10", "input");
			return ok && await until(() => text(".st-where") === "11 of 25 · z 2.2 mm");
		})()`,
	},
	"grepall": {
		`[...document.querySelectorAll(".ga-fcount")].map((c) => c.textContent).join() === "283,158,23"`,
		`[...document.querySelectorAll(".ga-chip code")].map((c) => c.textContent).slice(0, 3).join() === "fun,new,unc" && document.querySelector(".ga-ptree .ga-op").textContent === "Concat"`,
		`document.querySelector(".ga-rh .ga-t").textContent === "34 lines in 23 files" && document.querySelectorAll(".ga-list mark").length > 0`,
		`/^Index built here in [\d.,]+ ms: 283 files, 1\.84 MiB of source/.test(document.querySelector(".ga-built").textContent)`,
		`(async () => {
			const counts = () => [...document.querySelectorAll(".ga-fcount")].map((c) => c.textContent).join();
			const preset = (q) => [...document.querySelectorAll(".ga-presets button")].find((b) => b.querySelector("code").textContent === q).click();
			preset("Kelvin");
			let ok = await until(() => counts() === "283,3,1" && document.querySelector(".ga-list").textContent.includes("Kelvin"));
			preset(":=.*<-");
			ok = ok && await until(() => counts() === "283,283,1" && document.querySelector(".ga-all") !== null);
			const q = document.querySelector("input[name=q]");
			q.value = "func(";
			q.dispatchEvent(new Event("input"));
			ok = ok && await until(() => document.querySelector(".ga-status").textContent.includes("missing closing )"));
			preset("func\\s+New\\w+\\(");
			return ok && await until(() => counts() === "283,158,23" && !document.querySelector(".ga-err"));
		})()`,
	},
	"stash": {
		`[...document.querySelectorAll(".sh-sum")].map((d) => d.textContent).join("|") === "11 chunks: 3 new, 8 reused · 3,513 B → 944 B stored|10 chunks: 10 new, 0 reused · 3,333 B → 3,179 B stored" && [...document.querySelectorAll(".sh-totals .sh-v")].map((d) => d.textContent).join() === "2,6,846 B,4,123 B,1.66×,13,2"`,
		`document.querySelector(".sh-live").textContent === "No unsaved changes: all 11 chunks of 3,513 B are already in the repository." && document.querySelectorAll(".sh-mirror .sh-c").length === 11 && document.querySelectorAll(".sh-verify .sh-ok").length === 5 && document.querySelector(".sh-kdf").textContent.startsWith("argon2id: 8 MiB, 1 pass, 1 lane, salt c792bc6ffb050e1b67714c1e4814c1e3")`,
		`(async () => {
			const q = (s) => document.querySelector(s);
			const btn = (t) => [...document.querySelectorAll(".sh-panel button")].find((b) => b.textContent === t);
			btn("Unlock").click();
			let ok = await until(() => /^Refused in [\d,]+ ms: with that passphrase/.test(q(".sh-result").textContent));
			q("input[name=try]").value = "correct horse battery staple";
			btn("Unlock").click();
			return ok && await until(() => /^Unlocked in [\d,]+ ms: master key 97f0bf7b, the key that sealed every pack below\.$/.test(q(".sh-result").textContent));
		})()`,
		`(async () => {
			const q = (s) => document.querySelector(s);
			const btn = (t) => [...document.querySelectorAll(".sh-panel button")].find((b) => b.textContent === t);
			btn("Delete a line").click();
			let ok = await until(() => q(".sh-live").textContent === "Unsaved: 1 of 10 chunks (488 B) are new; a backup now stores only those.");
			btn("Back up").click();
			ok = ok && await until(() => document.querySelectorAll(".sh-row").length === 3 && q(".sh-sum").textContent === "10 chunks: 1 new, 9 reused · 3,378 B → 446 B stored");
			ok = ok && await until(() => !btn("Flip one bit").disabled && q(".sh-byte").textContent.startsWith("byte 180 of 446: ciphertext of chunk fdf73e7e"));
			btn("Flip one bit").click();
			ok = ok && await until(() => q(".sh-verify .sh-bad .sh-why")?.textContent === "integrity error: blob fdf73e7e: authentication failed (MAC mismatch)");
			q(".sh-row button").click();
			ok = ok && await until(() => q(".sh-restore").textContent === "Restore refused at chunk 7 (pack 3): integrity error: blob fdf73e7e: authentication failed (MAC mismatch)");
			btn("Flip it back").click();
			return ok && await until(() => !document.querySelector(".sh-verify .sh-bad") && /^Restored 3,378 B from 10 chunks; .* identical to what was backed up\.$/.test(q(".sh-restore").textContent));
		})()`,
	},
	"keel": {
		`/^(Seed|Your seed) \d+ at [\d.]+ s of 3\d\.\d\d s simulated: .+; \d+ of \d+ fault events so far\. \d+ seeds checked, \d+ linearizable\.$/.test(document.querySelector(".kl-canvas").getAttribute("aria-label")) && (() => { const c = document.querySelector(".kl-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".kl-controls button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".kl-cells [data-k=" + k + "] .kl-v").textContent;
			const digests = () => [...document.querySelectorAll(".kl-digest")].map((d) => d.textContent).join();
			if (document.querySelector(".kl-acts button").textContent === "Pause") click("Pause");
			click("Reset");
			if (!await until(() => digests() === "888b42107bc083ca,888b42107bc083ca" && document.querySelector(".kl-match") !== null && v("seeds") === "24" && v("lin") === "24 / 24" &&
				v("t") === "0.00 s" && v("faults") === "0 / 25" && v("ok") === "477" && v("fail") === "0" && v("info") === "6" && v("conf") === "7" && v("hist") === "linearizable")) return false;
			click("Next fault");
			if (!await until(() => v("t") === "0.25 s" && v("faults") === "1 / 25" && v("part") === "{5} | {1,2,3,4}" && v("faulty") === "none")) return false;
			click("Next fault");
			return await until(() => v("t") === "1.86 s" && v("faulty") === "n5 crashed" && v("part") === "{5} | {1,2,3,4}" &&
				/^\d+ runs of keel's simulator: [\d,]+ scheduler steps and [\d,]+ traced events over [\d,.]+ s of simulated time, in [\d,]+ ms of calls, in your browser\.$/.test(document.querySelector(".kl-receipt").textContent));
		})()`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".kl-controls button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".kl-cells [data-k=" + k + "] .kl-v").textContent;
			const digests = () => [...document.querySelectorAll(".kl-digest")].map((d) => d.textContent).join();
			if (document.querySelector(".kl-acts button").textContent === "Pause") click("Pause");
			if (!await until(() => v("seeds") === "24")) return false;
			document.querySelector("input[name=mine]").value = "1234";
			click("Run my seed");
			if (!await until(() => digests() === "75ca914818e02f3d,75ca914818e02f3d" && document.querySelector(".kl-match") !== null &&
				v("ok") === "494" && v("info") === "3" && v("conf") === "14" && v("faults") === "0 / 13")) return false;
			click("Replay");
			if (!await until(() => digests() === "75ca914818e02f3d,75ca914818e02f3d" && document.querySelectorAll(".kl-which")[1].textContent === "replay")) return false;
			for (let i = 0; i < 20 && v("t") !== "35.00 s"; i++) click("Next fault");
			return await until(() => v("faults") === "13 / 13" && v("seeds") === "25" && v("lin") === "25 / 25");
		})()`,
		`(async () => {
			const digests = () => [...document.querySelectorAll(".kl-digest")].map((d) => d.textContent).join();
			const seed = document.querySelector("input[name=seed]");
			seed.value = "8";
			seed.dispatchEvent(new Event("input"));
			return await until(() => digests() === "22e2ba986ec4d67e" && document.querySelector(".kl-out").textContent === "8" &&
				document.querySelector(".kl-cells [data-k=ok] .kl-v").textContent === "526");
		})()`,
	},
	"raytracer": {
		`document.querySelector(".rt-info").textContent === "Cornell box: 300 × 300 px, 8 top-level objects, 1 sampled light, SAH BVH of 9 nodes (depth 5), up to 50 bounces, seed 1."`,
		`(() => { const lit = (sel) => { const c = document.querySelector(sel); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && d[i] + d[i + 1] + d[i + 2] > 0) n++; return c.width === 300 && c.height === 300 ? n / (c.width * c.height) : 0; }; const m = lit(".rt-canvas-l"), n = lit(".rt-canvas:not(.rt-canvas-l)"); return m > 0.02 && n > 0.6 && n > 2 * m; })()`,
		`(() => { const v = [...document.querySelectorAll(".rt-cells .rt-v")].map((n) => n.textContent); return Number(v[0]) >= 1 && Number(v[2]) > Number(v[3]) && /^\d+\.\d\d×$/.test(v[4]) && /^[\d,]+k$/.test(v[1]); })()`,
		`(async () => {
			const grip = document.querySelector(".rt-grip");
			const left = document.querySelector(".rt-canvas-l");
			grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
			let ok = grip.getAttribute("aria-valuenow") === "48" && left.style.clipPath === "inset(0px 52% 0px 0px)";
			grip.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
			ok = ok && grip.getAttribute("aria-valuenow") === "100";
			for (const key of ["Home", "PageUp", "PageUp", "PageUp", "PageUp", "PageUp"]) grip.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
			ok = ok && grip.getAttribute("aria-valuenow") === "50";
			const s = document.querySelector("select[name=scene]");
			s.value = "cover"; s.dispatchEvent(new Event("change"));
			const info = () => document.querySelector(".rt-info").textContent;
			ok = ok && await until(() => info().startsWith("Book 1 cover (sky-lit): 300 × 168 px, 484 top-level objects, 0 sampled lights, SAH BVH of 581 nodes (depth 12)") && document.querySelector(".rt").dataset.split === "off");
			s.value = "cornell"; s.dispatchEvent(new Event("change"));
			return ok && await until(() => info().startsWith("Cornell box: ") && document.querySelector(".rt").dataset.split === "on" && /^Cornell box: [1-9]/.test(document.querySelector(".rt-status").textContent));
		})()`,
	},
	"netcode": {
		`document.querySelector(".nc-lamp").dataset.state === "ok" && /^State hashes match: client [1-6], tick [\d,]+$/.test(document.querySelector(".nc-lamp-text").textContent) && /^[0-9a-f]{16}$/.test(document.querySelector(".nc-lamp-hash").textContent)`,
		`(() => { const v = [...document.querySelectorAll(".nc-world .nc-v")].map((n) => n.textContent); return v[3] === "0" && Number(v[2].replace(/,/g, "")) > 0; })()`,
		`[...document.querySelectorAll(".nc-cells")].every((c) => /^[\d,]+$/.test(c.querySelector(".nc-v").textContent))`,
		`(() => { const c = document.querySelector(".nc-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 20000; })()`,
		`(async () => {
			const play = document.querySelector(".nc-play");
			if (play.textContent === "Pause") play.click();
			const tick = () => Number(document.querySelector(".nc-world .nc-v").textContent.replace(/,/g, ""));
			await new Promise((r) => setTimeout(r, 100));
			const before = tick();
			document.querySelector(".nc-step").click();
			await until(() => tick() === before + 60);
			return /^Tick [\d,]+, [\d.]+ s simulated: you rolled back [\d,]+ times?, [\d,]+ frames? resimulated; [\d,]+ hash checks, 0 desyncs\.$/.test(document.querySelector(".nc-status").textContent);
		})()`,
	},
}

// feelCheck moves a real mouse onto an index card (the tab must have a fine
// pointer): its preview tilts under a glare and starts its clip, and leaving
// the card settles it and drops the clip. The page may still be settling a
// scroll, so the mouse is re-aimed until it lands on the card.
func feelCheck(t *testing.T, ctx context.Context) {
	t.Helper()
	type pt struct{ X, Y float64 }
	aim := `(() => {
		if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return { X: -1, Y: -1 };
		const s = document.querySelector(".card:not([hidden]) .card-shot:has(img)");
		s.scrollIntoView({ block: "center", behavior: "instant" });
		const r = s.getBoundingClientRect();
		return { X: r.left + r.width * 0.7, Y: r.top + r.height * 0.3 };
	})()`
	move := func(x, y float64) {
		if err := chromedp.Do(ctx, chromedp.MouseEvent(input.DispatchMouseEventTypeMouseMoved, x, y)); err != nil {
			t.Fatal(err)
		}
	}
	in := `(() => {
		const s = document.querySelector(".card:not([hidden]) .card-shot:has(img)");
		return "feel" in s.dataset && parseFloat(s.style.getPropertyValue("--ry")) > 0
			&& !!s.querySelector("video[src$='-n.mp4']") && !s.querySelector("video").paused;
	})()`
	ok := false
	for end := time.Now().Add(15 * time.Second); !ok && time.Now().Before(end); {
		at, err := chromedp.Run(ctx, chromedp.Evaluate[pt](aim))
		if err != nil {
			t.Fatal(err)
		}
		if at.X < 0 {
			t.Fatal("the tab has no fine pointer, so feel.js stays off")
		}
		move(at.X-20, at.Y)
		move(at.X, at.Y)
		for i := 0; i < 10 && !ok; i++ {
			time.Sleep(100 * time.Millisecond)
			if ok, err = chromedp.Run(ctx, chromedp.Evaluate[bool](in)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !ok {
		t.Errorf("hovered card did not tilt and play its clip")
		return
	}
	move(1, 1)
	out := `(async () => {
		const s = document.querySelector(".card:not([hidden]) .card-shot:has(img)");
		return until(() => !("feel" in s.dataset) && !s.querySelector("video"));
	})()`
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(out), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Errorf("card did not settle after the mouse left (err %v)", err)
	}
}
