package site

// Showcases drive each live demo for its home reel clip (cmd/reel).
var Showcases = map[string]Showcase{
	// The map fills page by page and the reader walks the data pages; then a
	// header byte of a data page is flipped and the read stops at that red page.
	"btrv": {
		Setup: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const play = document.querySelector(".bt-acts button");
			for (let i = 0; i < 400 && play.textContent !== "Replay"; i++) await w(50);
			const sp = document.querySelector("select[name=speed]");
			sp.value = "5"; sp.dispatchEvent(new Event("change"));
			const reset = [...document.querySelectorAll(".bt-acts button")].find((b) => b.textContent === "Reset");
			play.click();
			for (let i = 0; i < 100 && (play.disabled || play.textContent !== "Pause"); i++) await w(50);
			play.click();
			reset.click();
			for (let i = 0; i < 100 && reset.disabled; i++) await w(50);
			await w(300);
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const play = document.querySelector(".bt-acts button");
			const cor = document.querySelector(".bt-corrupt");
			await w(300);
			play.click();
			for (let i = 0; i < 200 && play.textContent !== "Replay"; i++) await w(50);
			await w(600);
			cor.click();
		})()`,
		Focus: ".bt-map", Pad: 8, WideFocus: ".bt-map", WidePad: 8, Seconds: 8,
	},
	// The floor packs orders on its own; you drop your cap order on the line,
	// then take the top pick off the shelf and the shift is re-judged.
	"anchorflow": {
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const click = (t) => [...document.querySelectorAll(".af-controls button, .af-shelfhead button")].find((b) => b.textContent === t).click();
			await w(2600); click("Drop on the line");
			await w(2600); click("Take top pick off");
		})()`,
		Focus: ".af-canvas", Pad: 4, WideFocus: ".af-canvas", WidePad: 8, Seconds: 8,
	},
	// The tour steps from run to a callee and ripples out from it; then a
	// search for "bump" ripples its callers out three hops, to main.
	"codegraph": {
		Setup: `(async () => {
			for (let i = 0; i < 200 && !document.querySelector(".cg-node.is-focus"); i++) await new Promise((r) => setTimeout(r, 50));
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			await w(3800);
			document.querySelector("input[name=symbol]").value = "bump";
			document.querySelector(".cg-find button").click();
			await w(2400);
		})()`,
		Focus: ".cg-svg", Pad: 8, WideFocus: ".cg-svg", WidePad: 8, Seconds: 7,
	},
	// The edge runs bursts under stale-while-revalidate; you reload through it,
	// then switch the origin to no-cache and the same traffic replays as 304s.
	"edgecache": {
		Setup: `(async () => {
			const s = document.querySelector("select[name=speed]");
			s.value = "20"; s.dispatchEvent(new Event("change"));
			await new Promise((r) => setTimeout(r, 1200));
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const send = [...document.querySelectorAll(".ec-acts button")].find((b) => b.textContent === "Send my request");
			const p = document.querySelector("select[name=policy]");
			await w(1500); send.click();
			await w(2600); p.value = "no-cache"; p.dispatchEvent(new Event("change"));
			await w(2000); send.click();
		})()`,
		Focus: ".ec-canvas", Pad: 4, WideFocus: ".ec-canvas", WidePad: 4, Seconds: 8,
	},
	// Each query narrows 283 files to candidates by trigram, then to matches.
	"grepall": {
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const preset = (q) => [...document.querySelectorAll(".ga-presets button")].find((b) => b.querySelector("code").textContent === q).click();
			await w(800); preset("Kelvin");
			await w(1600); preset(":=.*<-");
			await w(1600); preset("TODO|FIXME");
			await w(1600); preset("func\\s+New\\w+\\(");
		})()`,
		Focus: ".ga-status", Pad: 8, WideFocus: ".ga-funnel", WidePad: 8, Seconds: 8,
	},
	// The scheduler runs after an outage; a flaky job retries, then a second outage hits.
	"jobrun": {
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const click = (t) => [...document.querySelectorAll(".jr-acts button")].find((b) => b.textContent === t).click();
			await w(700); click("Enqueue flaky job");
			await w(3300); click("Outage");
		})()`,
		Focus: ".jr-canvas", Pad: 4, Seconds: 8,
	},
	// The workload writes and compacts; your key flies into the active segment,
	// then the plug is pulled mid-write and the torn record turns red. The
	// narrow clip starts a little into the canvas so the segments stay in frame.
	"kvlite": {
		Setup: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const r = document.querySelector("select[name=rate]");
			r.value = "10"; r.dispatchEvent(new Event("change"));
			await wait(1200);
		})()`,
		Play: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const click = (t) => [...document.querySelectorAll(".kv-controls button")].find((b) => b.textContent === t).click();
			await wait(900);
			click("Put");
			await wait(2300);
			click("Pull the plug");
		})()`,
		Focus: ".kv-canvas", Pad: -96, WideFocus: ".kv-canvas", WidePad: 4, Seconds: 7,
	},
	// Play sends each client frame through the bridge; packets cross the lanes
	// and the bridge's translations light up as the conversation builds.
	"mcpbridge": {
		Setup: `(async () => {
			const d = document.querySelector("select[name=direction]");
			d.value = "reverse"; d.dispatchEvent(new Event("change"));
			for (let i = 0; i < 100 && !/^4 client frames, 17 frames/.test(document.querySelector(".mb-status").textContent); i++) await new Promise((r) => setTimeout(r, 50));
		})()`,
		Play: `(async () => {
			await new Promise((r) => setTimeout(r, 600));
			[...document.querySelectorAll(".mb-bar button")].find((b) => b.textContent === "Play").click();
		})()`,
		Focus: ".mb-head", Pad: 8, Seconds: 7.5,
	},
	// keel: a new seed every 1.2 s; the digest, fault timeline and totals change.
	// keel: seed 2's whole fault schedule plays at 10×, from the first partition
	// to the verdict, then the sweep moves on to seed 3.
	"keel": {
		Setup: `(async () => {
			const click = (t) => [...document.querySelectorAll(".kl-controls button")].find((b) => b.textContent === t).click();
			const v = (k) => document.querySelector(".kl-cells [data-k=" + k + "] .kl-v").textContent;
			if (document.querySelector(".kl-acts button").textContent === "Pause") click("Pause");
			const speed = document.querySelector("select[name=speed]");
			speed.value = "10"; speed.dispatchEvent(new Event("change"));
			click("Reset");
			for (let i = 0; i < 400 && !(v("seeds") === "24" && v("t") === "0.00 s" && document.querySelector(".kl-match")); i++) await new Promise((r) => setTimeout(r, 25));
			await new Promise((r) => setTimeout(r, 400));
		})()`,
		Play: `(async () => {
			const click = (t) => [...document.querySelectorAll(".kl-controls button")].find((b) => b.textContent === t).click();
			await new Promise((r) => setTimeout(r, 200));
			click("Play");
		})()`,
		Focus: ".kl-canvas", Pad: 4, Seconds: 8,
	},
	// lobby: you queue twice; players fill rooms on their own meanwhile.
	"lobby": {
		Setup: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const set = (sel, v, ev) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event(ev)); };
			set("select[name=speed]", "5", "change");
			await wait(1500);
		})()`,
		Play: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const skill = document.querySelector("input[name=skill]");
			const join = [...document.querySelectorAll(".lb-acts button")].find((b) => b.textContent === "Queue me");
			await wait(700);
			skill.value = "150"; join.click();
			await wait(4000);
			skill.value = "1900"; join.click();
		})()`,
		Focus: ".lb-canvas", Pad: 4, Seconds: 8,
	},
	// netcode: you steer player 0 in a loop and dash while bots move.
	"netcode": {
		Play: `(async () => {
			const c = document.querySelector(".nc-canvas");
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const key = (type, code) => c.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
			const hold = async (code, ms) => { key("keydown", code); await wait(ms); key("keyup", code); };
			const run = async (code, ms) => { key("keydown", code); await wait(ms / 2); await hold("Space", 80); await wait(ms / 2 - 80); key("keyup", code); };
			await wait(500);
			await run("KeyD", 1600);
			await hold("KeyS", 600);
			await run("KeyA", 1600);
			await hold("KeyW", 600);
		})()`,
		Focus: ".nc-canvas", Pad: -140, Seconds: 7,
	},
	// ratelimitd: calm traffic flows through all three gates; you launch the
	// attack and the flood piles up red at each gate while the limit holds.
	"ratelimitd": {
		Play: `(async () => {
			await new Promise((r) => setTimeout(r, 2200));
			document.querySelector(".rl-fire").click();
		})()`,
		Focus: ".rl-canvas", Pad: 4, Seconds: 7,
	},
	// raytracer: the marble scene, held at its third pass, renders on, then the split sweeps.
	"raytracer": {
		Setup: `(async () => {
			const s = document.querySelector("select[name=scene]");
			s.value = "light"; s.dispatchEvent(new Event("change"));
			for (let i = 0; i < 400 && !document.querySelector(".rt-info").textContent.startsWith("Marble"); i++) await new Promise((r) => setTimeout(r, 10));
			// Held at its third pass, so the clip opens noisy and clears.
			s.dispatchEvent(new Event("change"));
			const pass = () => Number(/pass (\d+)/.exec(document.querySelector(".rt-screen").textContent)?.[1] ?? 0);
			for (let i = 0; i < 400 && pass() >= 3; i++) await new Promise((r) => setTimeout(r, 5));
			for (let i = 0; i < 400 && pass() < 3; i++) await new Promise((r) => setTimeout(r, 5));
			const play = document.querySelector(".rt-play");
			if (play.textContent === "Pause") play.click();
			for (let i = 0; i < 400 && play.textContent !== "Resume"; i++) await new Promise((r) => setTimeout(r, 5));
			if (play.textContent !== "Resume") throw new Error("raytracer not held: " + play.textContent + " at pass " + pass());
		})()`,
		Play: `(async () => {
			const g = document.querySelector(".rt-grip");
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const sweep = async (key, n) => { for (let i = 0; i < n; i++) { g.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await wait(40); } };
			await wait(300);
			document.querySelector(".rt-play").click();
			await wait(1000);
			document.querySelector(".rt-play").click();
			await wait(400);
			await sweep("ArrowRight", 20);
			await wait(500);
			await sweep("ArrowLeft", 40);
			await wait(500);
			await sweep("ArrowRight", 20);
		})()`,
		Focus: ".rt-screen", WideFocus: ".rt-screen", WidePad: 8, Seconds: 6.3,
	},
	// stash: edit, back up, repeat; new chunks show vermilion in the text and the strips.
	"stash": {
		Play: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const btn = (t) => [...document.querySelectorAll(".sh-panel button")].find((b) => b.textContent === t);
			for (const edit of ["Insert a paragraph", "Delete a line", "Insert a paragraph"]) {
				await wait(700);
				btn(edit).click();
				await wait(1000);
				btn("Back up").click();
			}
		})()`,
		Focus: ".sh-live", Pad: 8, Seconds: 8,
	},
	// strata: the layer slider climbs from layer 2 to the top: solid floor,
	// sparse infill (scrubbed quickly, it repeats), solid roof, top surface.
	"strata": {
		Setup: `(async () => {
			const l = document.querySelector("input[name=layer]");
			l.value = "1"; l.dispatchEvent(new Event("input"));
			for (let i = 0; i < 200 && !document.querySelector(".st-where").textContent.startsWith("2 of "); i++) await new Promise((r) => setTimeout(r, 25));
		})()`,
		Play: `(async () => {
			const l = document.querySelector("input[name=layer]");
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const to = (i) => { l.value = String(i); l.dispatchEvent(new Event("input")); };
			await wait(800);
			for (const i of [2, 3]) { to(i); await wait(700); }
			for (let i = 4; i <= 20; i++) { to(i); await wait(110); }
			for (let i = 21; i <= 24; i++) { await wait(700); to(i); }
		})()`,
		Focus: ".st-canvas", Pad: -45, WideFocus: ".st-scrub", WidePad: -16, Seconds: 8,
	},
}
