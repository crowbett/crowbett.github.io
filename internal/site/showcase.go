package site

// Showcases drive each live demo for its home reel clip (cmd/reel).
var Showcases = map[string]Showcase{
	// The cursor walks down the page map to a data page and damages it: the
	// read stops at that red cell; undoing the damage lets the map fill again.
	"btrv": {
		Setup: `(async () => {
			const done = () => [...document.querySelectorAll(".bt-facts .bt-k")].some((k) => k.textContent === "rows read");
			for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const map = document.querySelector(".bt-map");
			const dmg = document.querySelector(".bt-damage");
			const key = (k) => map.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
			const idle = async () => { await w(100); for (let i = 0; i < 200 && dmg.disabled; i++) await w(50); };
			await w(600);
			for (let i = 0; i < 7; i++) { key("ArrowDown"); await w(160); }
			for (let i = 0; i < 40 && dmg.hidden; i++) { key("ArrowRight"); await w(120); }
			await w(500);
			dmg.click();
			await idle();
			await w(1600);
			dmg.click();
			await idle();
		})()`,
		Focus: ".bt-map", Pad: 8, WideFocus: ".bt-map", WidePad: 8, Seconds: 7,
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
	// Walk the call graph from run to a callee, its callee, and back to run.
	"codegraph": {
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const s = document.querySelector("select[name=symbol]");
			const pick = (v) => { s.value = v; s.dispatchEvent(new Event("change")); };
			await w(900); pick("src/log.rs:24");
			await w(1600); pick("src/log.rs:2");
			await w(1600); pick("src/main.rs:32");
		})()`,
		Focus: ".cg-summary", Pad: 8, Seconds: 6.5,
	},
	// Each preset plays its requests through the cache: a request no-store
	// bypasses it, stale-while-revalidate serves stale, Vary keeps one entry per
	// language, and max-age with an ETag revalidates.
	"edgecache": {
		Play: `(async () => {
			const s = document.querySelector("select[name=preset]");
			for (const v of ["no-store", "swr", "vary", "max-age"]) {
				await new Promise((r) => setTimeout(r, 1600));
				s.value = v; s.dispatchEvent(new Event("change"));
			}
		})()`,
		Focus: ".ec-legend", Pad: 8, WideFocus: ".ec-legend", WidePad: 172, Seconds: 8,
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
	// Fresh seeded draws, jitter off (every retry waits the full cap), more attempts.
	"jobrun": {
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const btn = [...document.querySelectorAll(".jr-panel button")].find((b) => b.textContent === "New draws");
			const jit = document.querySelector("input[name=jitter]");
			const att = document.querySelector("input[name=maxAttempts]");
			const set = (v) => { att.value = v; att.dispatchEvent(new Event("input")); };
			await w(700); btn.click();
			await w(900); btn.click();
			await w(1000); jit.click();
			await w(1300); jit.click();
			await w(1000); set("11");
			await w(1500); set("8");
		})()`,
		Focus: ".jr-legend", Pad: 8, WideFocus: ".jr-legend", WidePad: 150, Seconds: 8,
	},
	// Overwriting 20 keys turns half the log dead; compaction reclaims it into a
	// sealed segment, then a put and its tombstone land in the fresh one.
	"kvlite": {
		Setup: `(async () => {
			[...document.querySelectorAll(".kv-controls button")].find((b) => b.textContent === "Write 20 keys").click();
			const done = () => document.querySelector(".kv-status").textContent.startsWith("20 puts");
			for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const click = (t) => [...document.querySelectorAll(".kv-controls button")].find((b) => b.textContent === t).click();
			await w(700); click("Write 20 keys");
			await w(1500); click("Compact");
			await w(1700); click("Put");
			await w(1200); click("Delete");
		})()`,
		Focus: ".kv-stats", Pad: 8, WideFocus: ".kv-stats", WidePad: 10, Seconds: 7,
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
	// ratelimitd: the same traffic seed under each pattern, 2 s apiece, back to
	// bursts, where the sliding window lets more through than the token bucket.
	"ratelimitd": {
		Play: `(async () => {
			const s = document.querySelector("select[name=pattern]");
			for (const v of ["ramp", "attack", "burst"]) {
				await new Promise((r) => setTimeout(r, 2000));
				s.value = v; s.dispatchEvent(new Event("change"));
			}
		})()`,
		Focus: ".rl-chart[data-algo=token_bucket]", Pad: 8, Seconds: 8,
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
