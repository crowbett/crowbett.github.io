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
	// The presenter walks and every crop window follows; you drag the
	// presenter left and the anchors are proposed again, then the source
	// drops to 720p and the 9:16 deliverables turn advisory as upscales.
	"adfactory": {
		Setup: `(async () => {
			for (let i = 0; i < 200 && !document.querySelector(".adf-tile"); i++) await new Promise((r) => setTimeout(r, 50));
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const c = document.querySelector(".adf-canvas");
			await w(1800);
			for (let i = 0; i < 6; i++) { c.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); await w(140); }
			await w(1600);
			const s = document.querySelector("select[name=source]");
			s.value = "1280x720"; s.dispatchEvent(new Event("change"));
			await w(2400);
		})()`,
		Focus: ".adf-canvas", Pad: 4, WideFocus: ".adf-canvas", WidePad: 8, Seconds: 7,
	},
	// A fresh floor, paused after its first cart is picked and its first tote
	// packed; then it runs at 2×: the rest of the cart is packed and labelled
	// and the next cart walks the aisles.
	"anchorflow": {
		Setup: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const btn = (t) => [...document.querySelectorAll(".af-acts button")].find((b) => b.textContent === t);
			for (let i = 0; i < 200 && !document.querySelector(".af-ladder li"); i++) await w(50);
			if (btn("Pause")) btn("Pause").click();
			btn("Reset").click();
			for (let i = 0; i < 200 && !/^[A-Z]{3}-\d+ went in /.test(document.querySelector(".af-status").textContent); i++) await w(50);
			const sp = document.querySelector("select[name=speed]");
			sp.value = "2"; sp.dispatchEvent(new Event("change"));
		})()`,
		Play: `(async () => {
			document.querySelector(".af-acts button").click();
		})()`,
		Focus: ".af-map", Pad: 4, WideFocus: ".af-bench", WidePad: 8, Seconds: 8,
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
	// The index builds shard by shard, the tour types Kelvin and its posting
	// lists intersect; then you type your own query and the board re-runs.
	"grepall": {
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			await w(4600);
			const q = document.querySelector("input[name=q]");
			q.value = "";
			for (const ch of "Mutex") { q.value += ch; q.dispatchEvent(new Event("input")); await w(180); }
			await w(1600);
		})()`,
		Focus: ".ga-canvas", Pad: 4, WideFocus: ".ga-canvas", WidePad: 4, Seconds: 8,
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
	// The tour plays on its own: frames cross the lanes and change shape at the
	// bridge; you send your own tools/call and it crosses in the accent colour.
	"mcpbridge": {
		Setup: `(async () => {
			const v = () => Number(document.querySelector(".mb-cells [data-k=messages] .mb-v").textContent);
			const s = document.querySelector("select[name=speed]");
			s.value = "2"; s.dispatchEvent(new Event("change"));
			for (let i = 0; i < 200 && !(v() >= 1); i++) await new Promise((r) => setTimeout(r, 50));
		})()`,
		Play: `(async () => {
			await new Promise((r) => setTimeout(r, 2600));
			[...document.querySelectorAll(".mb-controls button")].find((b) => b.textContent === "Send mine").click();
		})()`,
		Focus: ".mb-canvas", Pad: 4, WideFocus: ".mb-canvas", WidePad: 8, Seconds: 7,
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
	// The agent works, its menu settles and lj puts the question on the Lock
	// Screen; you tap Yes and the answer crosses the relay sealed.
	"livejob": {
		Setup: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			for (let i = 0; i < 200 && !document.querySelector(".lj-mac .lj-row"); i++) await w(50);
			const sp = document.querySelector("select[name=speed]");
			sp.value = "2"; sp.dispatchEvent(new Event("change"));
			await w(1200);
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			for (let i = 0; i < 200 && !document.querySelector(".lj-card[data-state=waiting] .lj-tap"); i++) await w(50);
			await w(900);
			document.querySelector(".lj-card .lj-tap").click();
		})()`,
		Focus: ".lj-phone", Pad: 4, WideFocus: ".lj-stage", WidePad: 4, Seconds: 8,
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
	// netcode: you take over player 0 from the autopilot and dash around while
	// the link turns into a mobile one and the rollbacks rewind deeper.
	"netcode": {
		Play: `(async () => {
			const c = document.querySelector(".nc-canvas");
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const key = (type, code) => c.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
			const hold = async (code, ms) => { key("keydown", code); await wait(ms); key("keyup", code); };
			const run = async (code, ms) => { key("keydown", code); await wait(ms / 2); await hold("Space", 80); await wait(ms / 2 - 80); key("keyup", code); };
			const net = document.querySelector("select[name=network]");
			await wait(500);
			await run("KeyD", 1400);
			net.value = "mobile"; net.dispatchEvent(new Event("change"));
			await hold("KeyS", 700);
			await run("KeyA", 1600);
			await hold("KeyW", 900);
		})()`,
		Focus: ".nc-canvas", Pad: 8, WideFocus: ".nc-canvas", WidePad: 8, Seconds: 8,
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
	// raytracer: the Cornell box, held at its sixth pass, renders on; you tap
	// the noisy ceiling and those rows clear, then the split sweeps.
	"raytracer": {
		Setup: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const pass = () => Number(/pass (\d+)/.exec(document.querySelector(".rt-screen").textContent)?.[1] ?? 0);
			const play = document.querySelector(".rt-play");
			for (let i = 0; i < 2000 && pass() < 6; i++) await wait(5);
			if (play.textContent === "Pause") play.click();
			for (let i = 0; i < 400 && play.textContent !== "Resume"; i++) await wait(5);
			if (play.textContent !== "Resume") throw new Error("raytracer not held: " + play.textContent + " at pass " + pass());
		})()`,
		Play: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const g = document.querySelector(".rt-grip");
			const sweep = async (key, n) => { for (let i = 0; i < n; i++) { g.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await wait(40); } };
			await wait(300);
			document.querySelector(".rt-play").click();
			await wait(700);
			const v = document.querySelector(".rt-view");
			const r = v.getBoundingClientRect();
			v.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + r.width * 0.3, clientY: r.top + r.height * 0.2 }));
			await wait(1500);
			await sweep("ArrowRight", 12);
			await wait(400);
			await sweep("ArrowLeft", 24);
			await wait(400);
			await sweep("ArrowRight", 12);
		})()`,
		Focus: ".rt-screen", WideFocus: ".rt-screen", WidePad: 8, Seconds: 5.5,
	},
	// stash: snapshots run on their own; your line goes into the notes file, only the
	// chunks around it fly into the repository, then snapshot restore lights what it reads.
	"stash": {
		Play: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const btn = (t) => [...document.querySelectorAll(".demo-mount button")].find((b) => b.textContent === t);
			await wait(2400);
			btn("Insert and back up").click();
			await wait(2600);
			btn("Restore").click();
		})()`,
		Focus: ".sh-canvas", Pad: 4, WideFocus: ".sh-canvas", WidePad: 8, Seconds: 8,
	},
	// strata: the temperature tower is drawn layer by layer and its stack
	// rises; then the layer height drops to 0.12 mm and it is re-sliced.
	"strata": {
		Setup: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const set = (sel, v) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event("change")); };
			set("select[name=model]", "tower");
			set("select[name=speed]", "20");
			for (let i = 0; i < 400 && !/^200 layers, .* fetched in /.test(document.querySelector(".st-out").textContent); i++) await wait(25);
			[...document.querySelectorAll(".st-acts button")].find((b) => b.textContent === "Restart").click();
		})()`,
		Play: `(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			await wait(5200);
			const h = document.querySelector("select[name=layerHeight]");
			h.value = "0.12"; h.dispatchEvent(new Event("change"));
		})()`,
		Focus: ".st-canvas", Pad: -46, WideFocus: ".st-canvas", WidePad: 4, Seconds: 8,
	},
	// The tour's first query has ranked; you type "heartbeat lease" and the
	// two lanes re-rank and fuse word by word, then your note joins them.
	"recall": {
		Setup: `(async () => {
			document.querySelector(".rc-svg").scrollIntoView({ block: "center" });
			for (let i = 0; i < 400 && !document.querySelector(".rc-row.is-sel"); i++) await new Promise((r) => setTimeout(r, 50));
		})()`,
		Play: `(async () => {
			const w = (ms) => new Promise((r) => setTimeout(r, ms));
			const q = document.querySelector("input[name=q]");
			await w(1400);
			q.value = "";
			for (const ch of "heartbeat lease") { q.value += ch; q.dispatchEvent(new Event("input")); await w(110); }
			await w(2200);
			document.querySelector(".rc-mine button").click();
		})()`,
		Focus: ".rc-svg", Pad: 8, WideFocus: ".rc-svg", WidePad: 8, Seconds: 8,
	},
}
