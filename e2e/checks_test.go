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

// depthCheck scrolls a panel halfway in, where its name leads the text, then
// to where it pins, where the name settles flat (the scroll-depth layer in
// home.css).
const depthCheck = `(async () => {
	const it = document.querySelector("#p-stash"), m = (s) => new DOMMatrix(getComputedStyle(it.querySelector(s)).transform);
	scrollTo(0, 0);
	const top = it.getBoundingClientRect().top + scrollY;
	scrollTo(0, top - innerHeight * 0.5);
	if (!await until(() => m("h4").e > 1)) return false;
	scrollTo(0, top);
	return until(() => m("h4").isIdentity);
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
	"recall": {
		`until(() => document.querySelector(".rc-cells [data-k=docs] .rc-v").textContent === "42" && document.querySelector(".rc-cells [data-k=sources] .rc-v").textContent === "4 of 5" &&
			document.querySelectorAll(".rc-index .rc-doc").length === 42 && document.querySelectorAll(".rc-index .rc-doc.is-red").length === 3 &&
			document.querySelectorAll(".rc-row.is-sel").length > 0 && document.querySelectorAll(".rc-line").length > 0 &&
			/^42 documents from 4 sources indexed in [\d.]+ ms, \d+ quer(y|ies) ranked in [\d.]+ ms, by recall's engine in your browser\.$/.test(document.querySelector(".rc-out").textContent))`,
		`(async () => {
			const play = document.querySelector(".rc-acts button");
			if (play.textContent === "Pause") play.click();
			document.querySelector("input[name=q]").value = "graceful shutdown";
			document.querySelector(".rc-find button").click();
			const first = () => document.querySelector(".rc-row.is-sel[aria-label^='Result 1:']")?.getAttribute("aria-label") || "";
			const foot = () => document.querySelector(".rc-parts tfoot td:last-child")?.textContent || "";
			return until(() => first() === "Result 1: Graceful shutdown checklist, notes, fused score 0.0328, bm25 rank #1, vector rank #1" &&
				document.querySelector(".rc-why h3").textContent === "Graceful shutdown checklist" && foot() === "16.949" &&
				[...document.querySelectorAll(".rc-parts tbody td:nth-child(2)")].some((td) => td.textContent === "grace") &&
				document.querySelector(".rc-status").textContent === "8 results: 7 found by both lanes, 0 by bm25 alone, 1 by the vector lane alone.");
		})()`,
		`(async () => {
			const play = document.querySelector(".rc-acts button");
			if (play.textContent === "Pause") play.click();
			for (const b of document.querySelectorAll(".rc-chip")) if ((b.textContent === "git") !== (b.getAttribute("aria-pressed") === "true")) b.click();
			document.querySelector("input[name=q]").value = "backoff jitter";
			document.querySelector(".rc-find button").click();
			const fused = () => [...document.querySelectorAll(".rc-row[aria-label^='Result']")];
			let ok = await until(() => document.querySelector(".rc-cells [data-k=cands] .rc-v").textContent === "1 · 13" && fused().length === 8 &&
				fused().every((g) => g.getAttribute("aria-label").includes(", git, ")) && document.querySelectorAll(".rc-doc.is-off").length === 29 &&
				document.querySelector(".rc-plan").textContent.startsWith("query backoff jitter src:git → terms"));
			for (const b of document.querySelectorAll(".rc-chip")) if (b.getAttribute("aria-pressed") !== "true") b.click();
			document.querySelector("input[name=q]").value = "postgres password";
			document.querySelector(".rc-find button").click();
			ok = ok && await until(() => document.querySelector(".rc-status").textContent.includes("pool.go, ferry.toml, ") && document.querySelector(".rc-why h3").textContent === "pool.go" &&
				document.querySelector(".rc-snip .rc-red")?.textContent.startsWith("[REDACTED:") && document.querySelectorAll(".rc-doc.is-off").length === 0);
			document.querySelector("input[name=q]").value = "stop workers mid-flight without dropping jobs";
			document.querySelector(".rc-find button").click();
			return ok && await until(() => document.querySelector(".rc-plan").textContent.endsWith("no document has every term, so any term counts (OR).") &&
				document.querySelector(".rc-cells [data-k=cands] .rc-v").textContent === "32 · 42");
		})()`,
		`(async () => {
			const play = document.querySelector(".rc-acts button");
			if (play.textContent === "Pause") play.click();
			const mode = document.querySelector("select[name=mode]");
			mode.value = "bm25"; mode.dispatchEvent(new Event("change"));
			document.querySelector("input[name=q]").value = "duplicate jobs lease";
			document.querySelector(".rc-find button").click();
			let ok = await until(() => document.querySelector(".rc-cells [data-k=cands] .rc-v").textContent === "3 · off" && document.querySelectorAll(".rc-row[aria-label^='vector']").length === 0 &&
				document.querySelector(".rc-status").textContent === "3 results from bm25 alone; the vector lane is off.");
			mode.value = "hybrid"; mode.dispatchEvent(new Event("change"));
			document.querySelector(".rc-mine button").click();
			return ok && await until(() => document.querySelector(".rc-cells [data-k=docs] .rc-v").textContent === "43" && document.querySelectorAll(".rc-doc.is-you").length === 1 &&
				document.querySelector(".rc-row.is-you[aria-label^='Result 2: yours-1']") !== null && document.querySelector(".rc-why h3").textContent === "yours-1" &&
				document.querySelector(".rc-status").textContent.startsWith("your note is /work/notes/yours-1.md, document 43; it is in the ranking above."));
		})()`,
	},
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
	"livejob": {
		// 4×, as the visitor can pick: at 1× a loaded CI runner takes over 20 s to the first prompt.
		`(async () => {
			const speed = document.querySelector("select[name=speed]");
			if (speed.value !== "4") { speed.value = "4"; speed.dispatchEvent(new Event("change")); }
			return until(() => [...document.querySelectorAll(".lj-card[data-state=waiting] .lj-tap")].map((b) => b.textContent).join("/") === "Yes/Always/No" &&
			/proof32 B, checked.*swapped keyrefused.*session keywrapped in 60 B, opened/.test(document.querySelector(".lj-pair").textContent) &&
			/^\d[\d,]* frames sealed and opened, \d+ prompts? read off the screen/.test(document.querySelector(".lj-out").textContent));
		})()`,
		`(async () => {
			const v = (k) => document.querySelector(".lj-cells [data-k=" + k + "] .lj-v").textContent;
			const tap = (t) => [...document.querySelectorAll(".lj-card[data-state=waiting] .lj-tap")].find((b) => b.textContent === t);
			const auto = document.querySelector("input[name=auto]");
			if (auto.checked) auto.click();
			const speed = document.querySelector("select[name=speed]");
			speed.value = "4"; speed.dispatchEvent(new Event("change"));
			[...document.querySelectorAll(".lj-acts button")].find((b) => b.textContent === "Reset").click();
			await until(() => v("d2m") === "0" && v("answered") === "0" && tap("Yes"));
			const play = document.querySelector(".lj-acts button");
			if (play.textContent === "Pause") play.click();
			tap("Yes").click();
			await until(() => document.querySelector(".lj-mac .lj-term").textContent.includes("✓ Edited internal/queue/drain.go") && v("answered") === "1" && v("d2m") === "1" && / ms$/.test(v("rtt")));
			document.querySelector(".lj-attacks [data-k=inject]").click();
			return await until(() => v("blocked") === "1" && [...document.querySelectorAll(".lj-ev[data-kind=bad] .lj-ev-note")].some((n) => n.textContent.includes("failed authentication")));
		})()`,
	},
	"quorum": {
		`until(() => /^node \d$/.test(document.querySelector(".qr-cells [data-k=leader] .qr-v").textContent) && document.querySelectorAll(".qr-logs .qr-c[data-tc]").length >= 10 &&
			/^5-node cluster at tick \d+: node \d leads term \d+/.test(document.querySelector(".qr-ring").getAttribute("aria-label")) && document.querySelectorAll(".qr-node").length === 5)`,
		`(async () => {
			const btn = (t) => [...document.querySelectorAll(".qr-acts button, .qr-put button")].find((b) => b.textContent === t);
			const v = (k) => document.querySelector(".qr-cells [data-k=" + k + "] .qr-v").textContent;
			const status = () => document.querySelector(".qr-status").textContent;
			const step = async () => { const t = v("tick"); btn("Step").click(); await until(() => v("tick") !== t); };
			if (btn("Pause")) btn("Pause").click();
			btn("Reset").click();
			let ok = await until(() => status() === "Warmed up 40 ticks: node 3 leads term 1. Crash it, or click any node." && v("tick") === "40" && v("commit") === "3");
			btn("Put").click();
			ok = ok && await until(() => status() === "x=1 went to leader node 3, appended at index 4 in term 1. It commits once a majority has it.");
			while (ok && document.querySelector(".qr-writes li")?.dataset.st !== "committed") await step();
			ok = ok && v("tick") === "44" && status() === "x=1 committed at index 4, term 1: a majority holds it.";
			btn("Crash leader").click();
			ok = ok && await until(() => document.querySelector(".qr-node:nth-child(3)").dataset.role === "down");
			for (let i = 0; ok && i < 40 && v("leader") !== "node 2"; i++) await step();
			return ok && v("tick") === "66" && v("term") === "2" && v("leaders") === "2" && status().startsWith("Node 2 won term 2 with a majority of votes.") &&
				[...document.querySelectorAll(".qr-trace li")].some((li) => li.textContent === "t57 timeout 2 after 11 ticks: pre-vote for t2");
		})()`,
	},
	"lobby": {
		`until(() => (Number(document.querySelector(".lb-cells [data-k=rooms] .lb-v").textContent) > 0 && /^Matchmaking floor at [\d.]+ s of simulated time: \d+ waiting, \d+ rooms started/.test(document.querySelector(".lb-canvas").getAttribute("aria-label"))))`,
		`until(() => ((() => { const c = document.querySelector(".lb-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
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
	"adfactory": {
		`until(() => /^planned 9 deliverables in [\d.]+ ms: 9 anchors from 60 detector samples, 427 crop windows, 65 caption lines, 7 loudness plans\. [\d,]+ plan calls? so far, [\d,]+ ms in total, all in your browser\.$/.test(document.querySelector("p.demo-out").textContent)
			&& [...document.querySelectorAll(".adf-tile")].map((t) => t.dataset.key + ":" + t.dataset.state).join() === "reels:ready,tiktok:ready,shorts:advisory,feed_4x5:ready,feed_4x5_still:ready,youtube:ready,broadcast_1080i:ready,feed_1x1:ready,feed_1x1_still:ready"
			&& document.querySelector(".adf-cells [data-k=ready] .adf-v").textContent === "8")`,
		`until(() => ((() => { const c = document.querySelector(".adf-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const tile = (k) => document.querySelector(".adf-tile[data-key=" + k + "]");
			const pick = (sel, v) => { const s = document.querySelector("select[name=" + sel + "]"); s.value = v; s.dispatchEvent(new Event("change")); };
			pick("source", "1280x720");
			let ok = await until(() => tile("reels").dataset.state === "advisory");
			tile("reels").click();
			ok = ok && await until(() => document.querySelector(".adf-reasons").textContent.includes("callout"));
			pick("cut", "10");
			ok = ok && await until(() => tile("broadcast_1080i").dataset.state === "refused" && document.querySelector(".adf-cells [data-k=refused] .adf-v").textContent === "1");
			tile("broadcast_1080i").click();
			ok = ok && await until(() => document.querySelector(".adf-reasons").textContent.includes("below broadcast_1080i floor"));
			[...document.querySelectorAll(".adf-transport button")].find((b) => b.textContent === "Reset").click();
			return ok && await until(() => tile("broadcast_1080i").dataset.state === "ready" && tile("shorts").dataset.state === "advisory");
		})()`,
	},
	"mcpbridge": {
		// 2×, as the visitor can pick: at 1× a loaded CI runner can take over 20 s to the fourth message.
		`(async () => {
			const speed = document.querySelector("select[name=speed]");
			if (speed.value !== "2") { speed.value = "2"; speed.dispatchEvent(new Event("change")); }
			return until(() => [...document.querySelectorAll(".mb-c-r .mb-k")].some((k) => k.textContent === '"io.modelcontextprotocol/protocolVersion"') &&
			Number(document.querySelector(".mb-cells [data-k=messages] .mb-v").textContent) >= 4 && Number(document.querySelector(".mb-cells [data-k=made] .mb-v").textContent) >= 1 &&
			document.querySelector(".mb-status").textContent.startsWith("session 1 · legacy client, modern server · engine xlate.New"));
		})()`,
		`until(() => ((() => { const c = document.querySelector(".mb-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const q = (s) => document.querySelector(s);
			const v = (k) => q(".mb-cells [data-k=" + k + "] .mb-v").textContent;
			const st = () => q(".mb-status").textContent;
			const set = (n, val) => { const e = q("select[name=" + n + "]"); e.value = val; e.dispatchEvent(new Event("change")); };
			const click = (t) => [...document.querySelectorAll(".mb-controls button")].find((b) => b.textContent === t).click();
			if (q(".mb-acts button").textContent === "Pause") click("Pause");
			set("speed", "8");
			set("scenario", "stateless");
			let ok = await until(() => v("sessions") === "1" && v("messages") === "0");
			for (let i = 0; i < 150 && !st().includes("finished"); i++) { click("Step"); await new Promise((r) => setTimeout(r, 60)); }
			ok = ok && await until(() => st() === "session 1 · modern client, legacy server · engine xlate.NewReverse · finished: 4 client frames, session open" &&
				["messages", "translated", "passed", "made", "dropped", "refused"].map(v).join() === "17,4,0,4,0,1");
			set("request", "call");
			click("Send mine");
			ok = ok && await until(() => q(".mb-you p").textContent === "Your tools/call reached the server rewritten, 213 B to 100 B (−params._meta); a result came back rewritten, 118 B to 252 B." &&
				q(".mb-ihead").textContent === "frame 23 · bridge to server · tools/call" && [...document.querySelectorAll(".mb-c-l.mb-del .mb-k")].some((k) => k.textContent === '"_meta"'));
			set("scenario", "tour");
			set("server", "legacy");
			click("Play");
			return ok && await until(() => st().startsWith("session 1 · legacy client, legacy server · engine passthrough"));
		})()`,
	},
	"ratelimitd": {
		`until(() => (/^Traffic floor at [\d.]+ s of run \d+: [\d,]+ requests offered; gcra allowed [\d,]+, denied [\d,]+; token bucket allowed [\d,]+, denied [\d,]+; sliding window allowed/.test(document.querySelector(".rl-canvas").getAttribute("aria-label")) && document.querySelector(".rl-cells [data-k=emit] .rl-v").textContent === "100 ms"))`,
		`until(() => ((() => { const c = document.querySelector(".rl-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".rl-acts button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".rl-cells [data-k=" + k + "] .rl-v").textContent;
			const steps = async (n) => { for (let i = 0; i < n; i++) { const t = v("t"); click("Step 1 s"); await until(() => v("t") !== t); } };
			if (document.querySelector(".rl-acts button").textContent === "Pause") click("Pause");
			click("Reset");
			let ok = await until(() => v("t") === "0.0 s" && v("offered") === "0" && v("run").endsWith("seed 1"));
			await steps(5);
			ok = ok && v("offered") === "36" && v("gcra") === "36 · 100 %" && v("sliding_window") === "33 · 92 %";
			click("Launch the attack");
			ok = ok && await until(() => document.querySelector(".rl-status").textContent.match(/^Re-ran run \d+ as 15.000 s of attack traffic, so it hits at 5.0 s/));
			await steps(3);
			return ok && await until(() => v("offered") === "349" && v("gcra") === "75 · 21 %" && v("token_bucket") === "75 · 21 %" && v("sliding_window") === "60 · 17 %" &&
				document.querySelector(".rl-you-tick").textContent === " Yours so far: gcra 274 denied · token bucket 274 denied · sliding window 286 denied.");
		})()`,
		`(async () => {
			const r = document.querySelector("input[name=rate]");
			r.value = "4"; r.dispatchEvent(new Event("input"));
			return await until(() => /^Re-ran run \d+: attack traffic .*limit 50 \/s, burst 10/.test(document.querySelector(".rl-status").textContent) && document.querySelector(".rl-cells [data-k=emit] .rl-v").textContent === "20 ms");
		})()`,
	},
	// The floor runs on seed 1. Paused, Reset picks the first cart and packs
	// its first tote; then a coffee cart falls through to the fit engine on any
	// package, the same basket again is answered by shape history once it has
	// shipped 3 times, and the bin parser refuses an even bin in aisle A-01.
	"anchorflow": {
		`until(() => Number(document.querySelector(".af-cells [data-k=shipped] .af-v").textContent) >= 1 && /^\d+ calls into AnchorFlow's code: \d+ carts? routed, \d+ orders? packed and labelled, a shape model of \d+ keys?, in [\d,]+ ms, in your browser\.$/.test(document.querySelector(".af-out").textContent))`,
		`until(() => ((() => { const colours = (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set; }; const l = colours(document.querySelector(".af-label")); return colours(document.querySelector(".af-map")).size > 20 && l.has(0) && l.has(0xffffff); })()))`,
		`(async () => {
			const status = () => document.querySelector(".af-status").textContent;
			const btn = (t) => [...document.querySelectorAll(".af-controls button")].find((b) => b.textContent === t);
			const set = (name, v) => { const s = document.querySelector("[name=" + name + "]"); s.value = v; s.dispatchEvent(new Event("change")); };
			const next = async () => { const k = status() + document.querySelector(".af-out").textContent; btn("Next step").click(); return until(() => status() + document.querySelector(".af-out").textContent !== k); };
			const upTo = async (want, n) => { for (let i = 0; i < n && status() !== want; i++) await next(); return status() === want; };
			if (btn("Pause")) btn("Pause").click();
			set("orders", "");
			btn("Reset").click();
			let ok = await until(() => status() === "LNT-1001 went in 10 x 13 (Small) (the fit engine: computed fit, 2 units).");
			set("orders", "DRF");
			ok = ok && await upTo("DRF-1001 went in 9 x 7 x 5 (the fit engine, any package: computed fit, 3 units).", 8);
			set("orders", "repeat");
			ok = ok && await upTo("DRF-1007 went in 8 x 8 x 6 (shape history: same basket: 3 of the last 3 shipped this way).", 12);
			ok = ok && document.querySelector(".af-ladder li[data-on]").textContent.startsWith("shape · same basket");
			set("sku", "LNT-PIN-COMPASS");
			document.querySelector("[name=bin]").value = "A-01-012-C";
			btn("Move").click();
			return ok && await until(() => status() === "warehouse.ParseBin refused A-01-012-C: aisle A-01 has odd-numbered positions only (got 12).");
		})()`,
	},
	"btrv": {
		// 10×, as the visitor can pick: at 1× a loaded CI runner can take over 20 s to map every page.
		`(async () => {
			document.querySelector("select[name=speed]").value = "10";
			return until(() => [...document.querySelectorAll(".bt-key:not([hidden])")].map((k) => k.dataset.kind + ":" + k.querySelector(".bt-count").textContent).filter((t) => /^(fcr|pat|data|free|unreferenced):/.test(t)).join() === "fcr:2,pat:2,data:250,free:5,unreferenced:4");
		})()`,
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
		`until(() => (Number(document.querySelector(".jr-cells [data-k=fires] .jr-v").textContent) >= 20 && /^Scheduler timeline at \d\d:\d\d:\d\d UTC: \d+ fires, \d+ runs, \d+ retries/.test(document.querySelector(".jr-canvas").getAttribute("aria-label"))))`,
		`until(() => ((() => { const c = document.querySelector(".jr-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".jr-acts button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".jr-cells [data-k=" + k + "] .jr-v").textContent;
			if ([...document.querySelectorAll(".jr-acts button")].some((b) => b.textContent === "Pause")) click("Pause");
			click("Reset");
			let ok = await until(() => v("t") === "08:59:30 UTC" && v("fires") === "20" && v("runs") === "48" && v("retries") === "27" && v("ok") === "17" && v("maxwait") === "49 s" &&
				document.querySelector(".jr-runs li").textContent === "Mon 2026-11-09 09:00UTCin 30 s");
			click("Enqueue flaky job");
			ok = ok && await until(() => document.querySelector(".jr-you").textContent.startsWith("Your flaky job #36 is queued at priority 1"));
			for (let i = 0; i < 4; i++) { click("Step 1 min"); await new Promise((r) => setTimeout(r, 150)); }
			return ok && await until(() => document.querySelector(".jr-you").textContent === "Your flaky job #36 succeeded on attempt 4 after 3 retries and 1 m 57 s of backoff.");
		})()`,
		`(async () => {
			const e = document.querySelector("input[name=expr]");
			e.value = "61 * * * *"; e.dispatchEvent(new Event("input"));
			let ok = await until(() => document.querySelector(".jr-status").textContent === "yours: cronx: invalid expression: minute: 61 out of range 0-59");
			const x = document.querySelector("select[name=example]");
			x.value = "0 0 29 2 *"; x.dispatchEvent(new Event("change"));
			return ok && await until(() => document.querySelector(".jr-runs li .jr-mono")?.textContent === "Tue 2028-02-29 00:00" && document.querySelector(".jr-status").textContent === "yours: cronx reads it as 0 0 29 2 *, in UTC.");
		})()`,
	},
	"kvlite": {
		`until(() => ((() => { const m = /drawn (\d+) live records? \(([\d,]+ B)\)/.exec(document.querySelector(".kv-canvas").getAttribute("aria-label")); return !!m && Number(m[1]) > 0 && m[2] === document.querySelector(".kv-cells [data-k=live] .kv-v").textContent; })()))`,
		`until(() => ((() => { const c = document.querySelector(".kv-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".kv-controls button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".kv-cells [data-k=" + k + "] .kv-v").textContent;
			const status = () => document.querySelector(".kv-status").textContent;
			const label = () => document.querySelector(".kv-canvas").getAttribute("aria-label");
			if (document.querySelector(".kv-acts button").textContent === "Pause") click("Pause");
			click("Reset");
			let ok = await until(() => status().startsWith("Warmed up with 30 seeded writes") && v("keys") === "9" && v("disk") === "550 B" && v("live") === "248 B" &&
				v("compactions") === "2" && label().includes("drawn 9 live records (248 B) and 3 dead records (76 B)"));
			document.querySelector("input[name=key]").value = "my:key";
			document.querySelector("input[name=value]").value = "hello";
			click("Put");
			ok = ok && await until(() => document.querySelector(".kv-you").textContent === "my:key = hello: its newest record is 28 B at byte 92 of 00000006.log (the active segment).");
			const cut = document.querySelector("select[name=cut]");
			cut.value = "mid";
			click("Pull the plug");
			ok = ok && await until(() => status() === "Plug pulled: 15 B cut off the end of 00000006.log at byte 135. kvlite reopened from its own files and truncated the torn record at byte 120 (its own log line is below); 13 records survive on disk. 1 write lost; rolled back: stock:sku-7 v1 → gone." &&
				v("lost") === "1 record" && v("recovered") === "13 records" && document.querySelector(".kv-log").textContent.includes("truncated torn tail of active segment seg=6 off=120 dropped=15"));
			click("Get");
			ok = ok && await until(() => status() === "Get my:key = hello, the value of its newest record at byte 92 of 00000006.log.");
			click("Compact");
			return ok && await until(() => status().startsWith("kvlite rewrote 10 live records into ") && v("compactions") === "1");
		})()`,
	},
	"edgecache": {
		`until(() => { const v = (k) => document.querySelector(".ec-cells [data-k=" + k + "] .ec-v").textContent; return Number(v("requests")) > 0 && ["MISS", "HIT", "STALE", "REVALIDATED"].includes(document.querySelector(".ec-table .ec-badge").textContent) && /^Edge at \d+ s of simulated time: \d+ requests, \d+ served from cache, \d+ sent to the origin/.test(document.querySelector(".ec-canvas").getAttribute("aria-label")); })`,
		`until(() => ((() => { const c = document.querySelector(".ec-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`until(() => ((() => { const b = document.querySelector(".ec-scroll"); return b.getAttribute("aria-label") === "Response log" && (b.tabIndex < 0 || b.getAttribute("role") === "region"); })()))`,
		`(async () => {
			const click = (t) => [...document.querySelectorAll(".ec-acts button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".ec-cells [data-k=" + k + "] .ec-v").textContent;
			const col = (sel) => [...document.querySelectorAll(sel)].map((c) => c.textContent).join();
			const play = document.querySelector(".ec-acts button");
			if (play.textContent === "Pause") click("Pause");
			click("Reset");
			await until(() => v("requests") === "1");
			// Reset lands asynchronously and may wipe early steps, so step until the clock says 300 s.
			for (let n = 0; v("t") !== "300 s" && n < 90; n++) { const was = v("t"); click("Step 10 s"); await until(() => v("t") !== was); }
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
		`until(() => (/^25 layers, 1,033 toolpaths and 10\.79 m of extrusion sliced by strata's engine in [\d.,]+ ms; 25 layers fetched in [\d.,]+ ms, in your browser\.$/.test(document.querySelector(".st-out").textContent) && document.querySelector(".st-summary").textContent === "XY test piece: 272 triangles, 20 × 20 × 5 mm." && document.querySelector(".st-canvas").getAttribute("aria-label").startsWith("XY test piece sliced into 25 layers; toolpaths drawn up to layer ")))`,
		`until(() => ((() => { const c = document.querySelector(".st-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const text = (sel) => document.querySelector(sel).textContent;
			const v = (k) => text(".st-cells [data-k=" + k + "] .st-v");
			const click = (t) => [...document.querySelectorAll(".st-acts button")].find((b) => b.textContent === t).click();
			const set = (sel, val, ev) => { const e = document.querySelector(sel); e.value = val; e.dispatchEvent(new Event(ev)); };
			let ok = await until(() => /^[\d.]+ m$/.test(v("drawn")));
			if (text(".st-acts button") === "Pause") click("Pause");
			set("input[name=layer]", "10", "input");
			ok = ok && await until(() => text(".st-where") === "11 of 25 · z 2.2 mm" && v("layer") === "11 / 25" && v("z") === "2.2 mm" &&
				[...document.querySelectorAll(".st-key")].map((k) => k.dataset.kind).join() === "OuterWall,InnerWall,SparseInfill,nozzle");
			set("input[name=layer]", "24", "input");
			ok = ok && await until(() => v("drawn") === "10.79 m" && text(".st-acts button") === "Replay");
			set("input[name=layer]", "0", "input");
			ok = ok && await until(() => text(".st-where") === "1 of 25 · z 0.2 mm" && !!document.querySelector(".st-key[data-kind=Skirt]"));
			click("Next layer");
			ok = ok && await until(() => text(".st-where") === "2 of 25 · z 0.4 mm");
			click("Restart");
			ok = ok && await until(() => text(".st-acts button") === "Pause");
			click("Pause");
			return ok;
		})()`,
		`(async () => {
			const text = (sel) => document.querySelector(sel).textContent;
			const set = (sel, v, ev) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event(ev)); };
			if (text(".st-acts button") === "Pause") [...document.querySelectorAll(".st-acts button")][0].click();
			set("input[name=layer]", "10", "input");
			let ok = await until(() => text(".st-where") === "11 of 25 · z 2.2 mm");
			set("select[name=layerHeight]", "0.12", "change");
			ok = ok && await until(() => text(".st-summary") === "XY test piece: 272 triangles, 20 × 20 × 5 mm. At 0.12 mm: 41 layers (25 at 0.2 mm), 1,329 toolpaths (1,033), 15.35 m (10.79 m)." &&
				text(".st-where") === "18 of 41 · z 2.24 mm" && /^41 layers, 1,329 toolpaths and 15\.35 m of extrusion .* 41 layers fetched in/.test(text(".st-out")));
			let stl = "solid t\n";
			const v = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
			for (const f of [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]) stl += "facet normal 0 0 0\nouter loop\n" + f.map((i) => "vertex " + v[i].join(" ") + "\n").join("") + "endloop\nendfacet\n";
			const file = document.querySelector("input[name=file]");
			const pickFile = (body, name) => { const t = new DataTransfer(); t.items.add(new File([body], name)); file.files = t.files; file.dispatchEvent(new Event("change")); };
			const model = () => document.querySelector("select[name=model]").selectedOptions[0].textContent;
			const layers = (n) => new RegExp("^" + n + " layers, ").test(text(".st-out"));
			pickFile(stl + "endsolid t\n", "tetra.stl");
			ok = ok && await until(() => text(".st-summary") === "tetra.stl: 4 triangles, 10 × 10 × 10 mm." && layers(83) && model() === "tetra.stl");
			set("select[name=layerHeight]", "0.2", "change");
			ok = ok && await until(() => layers(50) && text(".st-summary").includes(" At 0.2 mm: 50 layers (83 at 0.12 mm), ") && / of 50 · /.test(text(".st-where")));
			pickFile("AAAA", "bad.stl");
			ok = ok && await until(() => text(".st-summary").startsWith("bad.stl: ") && model() === "tetra.stl" && layers(50));
			set("select[name=model]", "xy", "change");
			return ok && await until(() => text(".st-summary") === "XY test piece: 272 triangles, 20 × 20 × 5 mm." && layers(25) && !document.querySelector("option[value=file]"));
		})()`,
	},
	"grepall": {
		`until(() => [...document.querySelectorAll(".ga-cells .ga-v")].slice(0, 3).map((v) => v.textContent).join("|") === "283|1.84 MiB|143,027" && /^283 files indexed into 34 shards/.test(document.querySelector(".ga-out").textContent) && document.querySelector(".ga-canvas").getAttribute("aria-label").startsWith("Index board for "))`,
		`until(() => ((() => { const c = document.querySelector(".ga-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const label = () => document.querySelector(".ga-canvas").getAttribute("aria-label");
			const reset = [...document.querySelectorAll(".ga-acts button")].find((b) => b.textContent === "Reset");
			reset.click();
			return await until(() => label().startsWith("Index board for Kel: posting lists kel 14;") && document.querySelector(".ga-presets button[aria-pressed=true] code").textContent === "Kelvin") &&
				await until(() => label() === "Index board for Kelvin: posting lists elv 12, kel 14, lvi 8, vin 42; 3 of 283 files are candidates, 1 matched." && document.querySelector(".ga-canvas").dataset.early === "2");
		})()`,
		`(async () => {
			const play = document.querySelector(".ga-acts button");
			if (play.textContent === "Pause") play.click();
			const v = (k) => document.querySelector(".ga-cells [data-k=" + k + "] .ga-v").textContent;
			const label = () => document.querySelector(".ga-canvas").getAttribute("aria-label");
			const preset = (q) => [...document.querySelectorAll(".ga-presets button")].find((b) => b.querySelector("code").textContent === q).click();
			preset("func\\s+New\\w+\\(");
			let ok = await until(() => v("cand") === "158 · 1.62 MiB" && v("hit") === "23 files · 34 lines" && v("tri") === "13" && document.querySelector(".ga-canvas").dataset.early === "16" &&
				label().startsWith("Index board for func\\s+New\\w+\\(: posting lists fun 262, new 162, unc 265, nc\\t 0, nc\\n 19,") &&
				document.querySelector(".ga-status").textContent.includes("16 candidates lacking a list got through") && document.querySelectorAll(".ga-list mark").length > 0);
			preset(":=.*<-");
			ok = ok && await until(() => label() === "Index board for :=.*<-: no posting list narrows it; 283 of 283 files are candidates, 1 matched." && v("read") === "1.84 MiB · 100%");
			preset("TODO|FIXME");
			ok = ok && await until(() => label() === "Index board for TODO|FIXME: posting lists fix 78, ixm 1, xme 0, odo 26, tod 30; 25 of 283 files are candidates, 25 matched.");
			const q = document.querySelector("input[name=q]");
			q.value = "func(";
			q.dispatchEvent(new Event("input"));
			ok = ok && await until(() => document.querySelector(".ga-status").textContent.includes("missing closing )"));
			preset("Kelvin");
			return ok && await until(() => document.querySelector(".ga-list").textContent.includes("Kelvin") && !document.querySelector(".ga-err"));
		})()`,
	},
	"stash": {
		`until(() => (/^Snapshot \d+ of \d files: \d+ of \d+ chunks new \([\d,]+ B\), the rest reused\. Repository: \d+ unique chunks in \d+ packs/.test(document.querySelector(".sh-canvas").getAttribute("aria-label")) && (() => { const c = document.querySelector(".sh-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const q = (s) => document.querySelector(s);
			const btn = (t) => [...document.querySelectorAll(".sh-controls button")].find((b) => b.textContent === t);
			const cells = () => [...document.querySelectorAll(".sh-cells .sh-v")].map((d) => d.textContent).slice(0, 7).join("|");
			if (btn("Pause")) btn("Pause").click();
			btn("Reset").click();
			let ok = await until(() => cells() === "3|5|33,357 B|13,383 B|2.49×|46|7" && q(".sh-day").textContent === "Snapshot 3, day 3: notes/harbour-log.md: a day appended at the end; 9 lines appended to logs/web-1.log; 2 stock counts changed.");
			btn("Next snapshot").click();
			return ok && await until(() => cells() === "4|6|48,965 B|15,026 B|3.26×|52|6" && q(".sh-day").textContent.startsWith("Snapshot 4, day 4: notes/harbour-log.md copied to archive/harbour-log-2026-10.md;"));
		})()`,
		`(async () => {
			const q = (s) => document.querySelector(s);
			const btn = (t) => [...document.querySelectorAll(".demo-mount button")].find((b) => b.textContent === t);
			if (btn("Pause")) btn("Pause").click();
			btn("Reset").click();
			let ok = await until(() => q(".sh-cells .sh-v").textContent === "3" && q("select[name=into]").value === "notes/harbour-log.md");
			btn("Insert and back up").click();
			ok = ok && await until(() => q(".sh-yours").textContent === "Your 28 B went into notes/harbour-log.md at byte 1,804. stash cut the file into 12 chunks: 2 new (bytes 1,748 to 2,251), 10 reused. Snapshot 4 stored 582 B for 11,739 B of files." && q("select[name=snapshot]").value === "4");
			btn("Flip one bit").click();
			ok = ok && await until(() => q(".sh-fline").textContent === "Flipped one bit of byte 1,356 in pack 4, inside chunk e2886734: integrity error: blob e2886734: authentication failed (MAC mismatch). The pack's BLAKE3 name no longer matches its bytes." &&
				q(".sh-res").textContent === "Snapshot 4 refused at notes/harbour-log.md, chunk 6 in pack 4: integrity error: blob e2886734: authentication failed (MAC mismatch).");
			btn("Flip it back").click();
			return ok && await until(() => /^Snapshot 4 restored: 5 files, 11,739 B from 40 chunks in 11 packs\. Every chunk's tag verified and every file's BLAKE3 hash matches its backup, in [\d,]+ ms\.$/.test(q(".sh-res").textContent));
		})()`,
	},
	"keel": {
		`until(() => (/^(Seed|Your seed) \d+ at [\d.]+ s of 3\d\.\d\d s simulated: .+; \d+ of \d+ fault events so far\. \d+ seeds checked, \d+ linearizable\.$/.test(document.querySelector(".kl-canvas").getAttribute("aria-label")) && (() => { const c = document.querySelector(".kl-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 64) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
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
		`until(() => (document.querySelector(".rt-info").textContent === "Cornell box: 300 × 300 px, 8 top-level objects, 1 sampled light, SAH BVH of 9 nodes (depth 5), up to 50 bounces, seed 1."))`,
		`until(() => ((() => { const lit = (sel) => { const c = document.querySelector(sel); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && d[i] + d[i + 1] + d[i + 2] > 0) n++; return c.width === 300 && c.height === 300 ? n / (c.width * c.height) : 0; }; const m = lit(".rt-canvas-l"), n = lit(".rt-canvas:not(.rt-canvas-l)"); return m > 0.02 && n > 0.6 && n > 2 * m; })()))`,
		`until(() => ((() => { const v = [...document.querySelectorAll(".rt-cells .rt-v")].map((n) => n.textContent); return Number(v[0]) >= 2 && Number(v[1]) >= 2 && Number(v[2]) > Number(v[3]) && /^\d+\.\d\d×$/.test(v[4]) && /^\d+\.\d \/ \d+\.\d$/.test(v[5]) && /^[\d,]+k$/.test(v[6]) && /^\d+\.\d s$/.test(v[7]); })()))`,
		`until(() => ((() => { const c = document.querySelector(".rt-chart"); if (!/^Estimated RMSE falling with samples per pixel: material only 0\.\d+, NEE \+ MIS 0\.\d+ at [\d,]+ spp\.$/.test(c.getAttribute("aria-label"))) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 16) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return set.size > 20; })()))`,
		`(async () => {
			const play = document.querySelector(".rt-play");
			if (play.textContent === "Pause") play.click();
			await until(() => play.textContent === "Resume" && /^Paused at \d+ spp: est\. RMSE /.test(document.querySelector(".rt-status").textContent));
			const strip = document.querySelector(".rt-rows");
			strip.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
			const ok = strip.getAttribute("aria-valuenow") === "0" && /^rows 0 to 35 of 300, \d+ spp$/.test(strip.getAttribute("aria-valuetext"));
			document.querySelector(".rt-you-btn").click();
			const you = () => /^you \+32 spp on rows 0–35, now (\d+) spp there and (\d+) elsewhere\. NEE \+ MIS est\. RMSE over the whole image: 0\.\d+ → 0\.\d+\.$/.exec(document.querySelector(".rt-you").textContent);
			await until(() => you());
			const [, there, rest] = you().map(Number);
			return ok && there >= rest + 32 && play.textContent === "Resume" && !document.querySelector(".rt-focus").classList.contains("is-on");
		})()`,
		`(async () => {
			const time = [...document.querySelectorAll(".rt-seg button")].find((b) => b.textContent === "per second");
			time.click();
			let ok = time.getAttribute("aria-pressed") === "true" && document.querySelector(".rt-plot-title").textContent === "est. RMSE against each half's render time, log-log";
			const grip = document.querySelector(".rt-grip");
			const left = document.querySelector(".rt-canvas-l");
			grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
			ok = ok && grip.getAttribute("aria-valuenow") === "48" && left.style.clipPath === "inset(0px 52% 0px 0px)";
			grip.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
			ok = ok && grip.getAttribute("aria-valuenow") === "100";
			for (const key of ["Home", "PageUp", "PageUp", "PageUp", "PageUp", "PageUp"]) grip.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
			ok = ok && grip.getAttribute("aria-valuenow") === "50";
			const s = document.querySelector("select[name=scene]");
			s.value = "cover"; s.dispatchEvent(new Event("change"));
			const info = () => document.querySelector(".rt-info").textContent;
			ok = ok && await until(() => info().startsWith("Book 1 cover (sky-lit): 300 × 168 px, 484 top-level objects, 0 sampled lights, SAH BVH of 581 nodes (depth 12)") && document.querySelector(".rt").dataset.split === "off");
			s.value = "cornell"; s.dispatchEvent(new Event("change"));
			return ok && await until(() => info().startsWith("Cornell box: ") && document.querySelector(".rt").dataset.split === "on" && /^Cornell box: (sampling, )?[1-9]/.test(document.querySelector(".rt-status").textContent));
		})()`,
	},
	"netcode": {
		`until(() => (document.querySelector(".nc-lamp").dataset.state === "ok" && /^State hashes match: client [0-5], tick [\d,]+$/.test(document.querySelector(".nc-lamp-text").textContent) && /^([0-9a-f]{16}) = \1$/.test(document.querySelector(".nc-lamp-hash").textContent)))`,
		`until(() => ((() => { const v = (k) => document.querySelector(".nc-cells [data-k=" + k + "] .nc-v").textContent; return v("desyncs") === "0" && Number(v("checks").replace(/,/g, "")) > 0 && /^\d+\.\d ms$/.test(v("rtt")) && /^[\d,]+ of [\d,]+$/.test(v("lost")); })()))`,
		`until(() => ((() => { const c = document.querySelector(".nc-canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; const set = new Set(); let n = 0; for (let i = 0; i < d.length; i += 16) { if (d[i + 3]) n++; set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); } return n > 20000 && set.size > 20; })()))`,
		`(async () => {
			const v = (k) => document.querySelector(".nc-cells [data-k=" + k + "] .nc-v").textContent;
			const lamp = () => document.querySelector(".nc-lamp").textContent;
			const play = document.querySelector(".nc-play");
			if (play.textContent === "Pause") play.click();
			document.querySelector(".nc-reset").click();
			if (!await until(() => v("tick") === "180" && v("rollbacks") === "5" && v("resim") === "70" && v("checks") === "423" && v("late") === "87" &&
				lamp() === "State hashes match: client 5, tick 168c611453593013c92 = c611453593013c92" &&
				document.querySelector(".nc-echo").textContent === "Player 0's input for tick 145: on your screen at once, run by the server 133 ms later, on bot 1's screen 233 ms later (simulated time).")) return false;
			document.querySelector(".nc-step").click();
			return await until(() => v("tick") === "181" && v("checks") === "427" && lamp().endsWith("23c29a45c12306f5 = 23c29a45c12306f5"));
		})()`,
		`(async () => {
			const c = document.querySelector(".nc-canvas");
			const tick = () => document.querySelector(".nc-cells [data-k=tick] .nc-v").textContent;
			const echo = () => document.querySelector(".nc-echo").textContent;
			const key = (type, code) => c.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
			if (document.querySelector(".nc-play").textContent === "Pause") document.querySelector(".nc-play").click();
			key("keydown", "KeyD");
			for (let i = 0; i < 120 && !echo().startsWith("Your input"); i++) { const t = tick(); document.querySelector(".nc-step").click(); for (let k = 0; k < 400 && tick() === t; k++) await new Promise((r) => setTimeout(r, 5)); }
			key("keyup", "KeyD");
			return document.querySelector(".nc-hint").textContent.startsWith("You are steering player 0") &&
				/^Your input for tick [\d,]+: on your screen at once, run by the server [\d,]+ ms later, on bot 1's screen [\d,]+ ms later \(simulated time\)\.$/.test(echo());
		})()`,
		`(async () => {
			const s = document.querySelector("select[name=network]");
			const tick = () => document.querySelector(".nc-cells [data-k=tick] .nc-v").textContent;
			const rtt = () => parseFloat(document.querySelector(".nc-cells [data-k=rtt] .nc-v").textContent);
			s.value = "mobile"; s.dispatchEvent(new Event("change"));
			if (!await until(() => document.querySelector(".nc-status").textContent === "Link set to mobile: 180 ms latency, 60 ms jitter, 4 % loss, each way." &&
				document.querySelector("input[name=latency_ms]").value === "180")) return false;
			for (let i = 0; i < 400 && rtt() <= 300; i++) { const t = tick(); document.querySelector(".nc-step").click(); for (let k = 0; k < 400 && tick() === t; k++) await new Promise((r) => setTimeout(r, 5)); }
			return rtt() > 300;
		})()`,
	},
}

// feelCheck moves a real mouse onto an index card (the tab must have a fine
// pointer): its preview tilts and starts its clip, and leaving
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
		const c = s.closest(".card"), o = [...document.querySelectorAll(".card:not([hidden])")].find((x) => x !== c);
		return "feel" in s.dataset && parseFloat(s.style.getPropertyValue("--ry")) > 0
			&& parseFloat(c.style.getPropertyValue("--dx")) > 0 && getComputedStyle(s.querySelector("img")).translate !== "none"
			&& parseFloat(getComputedStyle(o).opacity) < 0.8
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
		t.Errorf("hovered card did not tilt, shift its picture, dim the other cards and play its clip")
		return
	}
	move(1, 1)
	out := `(async () => {
		const s = document.querySelector(".card:not([hidden]) .card-shot:has(img)");
		return until(() => !("feel" in s.dataset) && !s.closest(".card").style.getPropertyValue("--dx") && !s.querySelector("video"));
	})()`
	if ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](untilJS(out), chromedp.EvalAwaitPromise)); err != nil || !ok {
		t.Errorf("card did not settle after the mouse left (err %v)", err)
	}
}

// stageCheckProject: a project page has no code section, and when wide its
// figure (the demo) runs the full width of the head, below the title, claim
// and result, so nothing sits beside a tall demo.
const stageCheckProject = `(() => {
	if (document.querySelector("#code, .code-ex, [data-code-link]")) return false;
	const f = document.querySelector(".ph-fig");
	if (!f || innerWidth < 1024) return true;
	const r = f.getBoundingClientRect(), head = document.querySelector(".ph-in").getBoundingClientRect(), text = document.querySelector(".ph-text").getBoundingClientRect();
	return r.width >= head.width - 2 && r.top >= text.bottom - 1;
})()`

// timelineCheck: the demo's calls are on the timeline, and the keys step to
// the oldest call and show it.
const timelineCheck = `until(() => {
	if (!location.pathname.startsWith("/projects/")) return true;
	const tl = document.querySelector("[data-timeline]");
	if (!tl || tl.hidden) return false;
	const c = tl.querySelector("canvas");
	if (!(Number(c.getAttribute("aria-valuemax")) > 0)) return false;
	const key = (k) => c.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
	key("Home");
	const ok = c.getAttribute("aria-valuenow") === "1" && /^#\d+ \S/.test(tl.querySelector(".tl-dh b").textContent) &&
		tl.querySelector(".tl-d dd code") !== null && /^call \d+: /.test(c.getAttribute("aria-valuetext"));
	key("Escape");
	return ok && /^[\d,]+ calls? · median (<)?[\d.]+ m?s in the binary · \d+\/s/.test(tl.querySelector("[data-tl-sum]").textContent);
})`

// xrayCheck: X opens the X-ray panel with the lock's numbers and live ones,
// and outlines what runs on the page.
const xrayCheck = `(async () => {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
	const d = document.querySelector("[data-demo]");
	return until(() => {
		const x = document.querySelector(".xr");
		if (!x || x.hidden || !document.documentElement.hasAttribute("data-xray")) return false;
		const t = x.textContent;
		return /pageHTML [\d.]+ KB/.test(t) && document.querySelectorAll(".xr-box").length > 0 &&
			(!d || (t.includes(Number(d.dataset.bytes).toLocaleString("en-US") + " B") && t.includes("workerrunning") && /memory[\d.]+ MB of linear memory/.test(t)));
	});
})()`

// xrayClose: Escape closes it and takes the outlines away.
const xrayClose = `(() => {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	return until(() => document.querySelector(".xr").hidden && !document.documentElement.hasAttribute("data-xray") && document.querySelectorAll(".xr-box").length === 0);
})()`
