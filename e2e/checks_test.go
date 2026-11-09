//go:build e2e

package e2e

// finderCheck drives the home search and group chips: matches keep their
// fixed numbers, the URL carries the filter, "/" focuses the box and the
// no-match button resets everything.
const finderCheck = `(async () => {
	const q = document.querySelector(".finder input"), count = document.querySelector(".count");
	const shown = () => [...document.querySelectorAll(".row:not([hidden])")].map((r) => r.querySelector(".row-name").textContent + r.querySelector(".row-n").textContent).join();
	const groups = () => [...document.querySelectorAll(".group:not([hidden])")].map((g) => g.dataset.g).join();
	const type = (v) => { q.value = v; q.dispatchEvent(new Event("input")); };
	type("rust");
	let ok = await until(() => shown() === "keel01,stash03,codegraph10,strata13,netcode14" && groups() === "storage,tools,graphics" && count.textContent === "5 of 15 shown" && location.search === "?q=rust");
	document.querySelector('.filter [data-g="tools"]').click();
	ok = ok && await until(() => shown() === "codegraph10" && location.search === "?q=rust&g=tools");
	type("zzz");
	ok = ok && await until(() => !document.querySelector(".nomatch").hidden && groups() === "");
	document.querySelector(".nomatch button").click();
	ok = ok && await until(() => document.querySelectorAll(".row:not([hidden])").length === 15 && !/shown/.test(count.textContent) && location.search === "" && document.querySelector('.filter [data-g=""]').getAttribute("aria-pressed") === "true");
	q.blur();
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
	ok = ok && await until(() => document.activeElement === q);
	q.blur();
	return ok;
})()`

// demoChecks holds, per demo slug, JavaScript expressions that must all be
// true (or resolve true) once the demo reports ready. Every live demo adds
// at least one check that proves it rendered real output from its binary.
var demoChecks = map[string][]string{
	"smoke": {`document.querySelector(".demo-out").textContent.includes("answered: hello from the page")`},
	"codegraph": {
		`document.querySelector(".cg-summary").textContent === "main (src/main.rs:11): 0 callers; 11 callees, 6 resolved, 5 unresolved."`,
		`[...document.querySelectorAll("[aria-labelledby=cg-callees] .cg-edge")].map((li) => li.firstChild.textContent + ":" + li.querySelector(".cg-conf").textContent).filter((t) => /^(parse::parse_line|e\.is_fatal):/.test(t)).join() === "parse::parse_line:likely,e.is_fatal:unresolved"`,
		`document.querySelector(".cg-foot").textContent.includes("99 edges (imports excluded), 50 resolved to a definition: 44 exact, 6 likely, 0 name_only")`,
		`(async () => {
			const callers = () => [...document.querySelectorAll("[aria-labelledby=cg-callers] .cg-go")].map((b) => b.textContent).join();
			[...document.querySelectorAll(".cg-go")].find((b) => b.textContent === "parse::parse_line").click();
			let ok = await until(() => document.querySelector(".cg-summary").textContent.startsWith("parse::parse_line (src/parse.rs:19)") && callers() === "main");
			const s = document.querySelector("select[name=symbol]");
			s.value = "src/store.rs:32"; s.dispatchEvent(new Event("change"));
			ok = ok && await until(() => callers() === "store::Store::set,store::Store::delete" && document.querySelectorAll(".cg-def").length === 3);
			s.value = "src/main.rs:11"; s.dispatchEvent(new Event("change"));
			return ok && await until(() => document.querySelector(".cg-summary").textContent.startsWith("main "));
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
			let ok = await until(() => v("t") === "8.0 s" && v("rooms") === "12" && v("queue") === "5");
			const s = document.querySelector("input[name=skill]");
			s.value = "1500";
			click("Queue me");
			ok = ok && await until(() => document.querySelector(".lb-you").textContent.startsWith("You are queued at skill 1,500."));
			click("Step 1 s");
			return ok && await until(() => document.querySelector(".lb-you").textContent === "Matched after 0.1 s into m13 with 1,461; skill spread 39." && v("rooms") === "13");
		})()`,
		`(async () => {
			const v = (k) => document.querySelector(".lb-cells [data-k=" + k + "] .lb-v").textContent;
			const m = document.querySelector("select[name=mode]");
			m.value = "squad"; m.dispatchEvent(new Event("change"));
			return await until(() => v("t") === "8.0 s" && v("rooms") === "3" && v("refills") === "1" && v("walkouts") === "1" && v("short") === "0" &&
				!document.querySelector(".lb-cells [data-k=refills]").hidden && !document.querySelector("input[name=refill]").closest("label").hidden);
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
		`/^1,\d{3} requests through 3 algorithms/.test(document.querySelector(".rl-status").textContent)`,
	},
	"btrv": {
		`[...document.querySelectorAll(".bt-key")].map((k) => k.dataset.kind + ":" + k.querySelector(".bt-count").textContent).filter((t) => /^(fcr|pat|free|unreferenced):/.test(t)).join() === "fcr:2,pat:2,free:5,unreferenced:4"`,
		`(async () => {
			const fact = (k) => [...document.querySelectorAll(".bt-facts > div")].find((d) => d.querySelector("dt").textContent === k)?.querySelector("dd").textContent;
			const cells = () => [...(document.querySelector(".bt-rows tbody tr:not(.bt-spacer)")?.querySelectorAll("td") || [])].map((td) => td.textContent).slice(0, 3).join();
			let ok = await until(() => fact("rows read") === "2,919" && fact("column errors") === "0" && cells() === "1,1,Ann");
			const seg = (t) => [...document.querySelectorAll(".bt-seg button")].find((b) => b.textContent === t);
			seg("Inferred").click();
			ok = ok && await until(() => document.querySelector(".bt-pair .bt-sub").textContent === "inferred by btrv from the first 1,000 records" && fact("rows read") === "2,919" && !seg("Dictionary").disabled);
			seg("Dictionary").click();
			ok = ok && await until(() => document.querySelector(".bt-pair .bt-sub").textContent.startsWith("from the DDF dictionary") && fact("rows read") === "2,919" && !seg("Inferred").disabled);
			const map = document.querySelector(".bt-map");
			for (let i = 0; i <= 40; i++) map.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
			const dmg = document.querySelector(".bt-damage");
			ok = ok && !dmg.hidden && dmg.textContent === "Damage page 40";
			dmg.click();
			ok = ok && await until(() => document.querySelector(".bt-key-bad .bt-count")?.textContent === "1" && /^Stopped: /m.test(document.querySelector(".bt-lines").innerText) && !dmg.disabled);
			dmg.click();
			ok = ok && await until(() => fact("rows read") === "2,919" && !document.querySelector(".bt-key-bad") && !dmg.disabled);
			document.querySelector(".bt-export button").click();
			return ok && await until(() => document.querySelector(".bt-expstatus").textContent.startsWith("PERSON.csv: 2,919 rows written, 0 with column errors"));
		})()`,
	},
	"jobrun": {
		`document.querySelectorAll(".jr-run").length === 10 && document.querySelector(".jr-run .jr-mono").textContent === "Thu 2026-01-01 09:00"`,
		`[...document.querySelectorAll(".jr-table tbody tr")].length === 8 && document.querySelector(".jr-dead td").textContent === "8"`,
		`document.querySelectorAll(".jr-chart line.jr-dot").length === 7 * 20`,
		`(async () => {
			const s = document.querySelector("select[name=cronPreset]");
			s.value = "1"; s.dispatchEvent(new Event("change"));
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
			return ok;
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
		`[...document.querySelectorAll(".ec-table .ec-badge")].map(b => b.textContent).join() === "MISS,HIT,REVALIDATED,HIT"`,
		`[...document.querySelectorAll(".ec-table td.ec-origin")].map(c => c.textContent).join("|") === "GET → 200|none|conditional GET → 304|none"`,
		`document.querySelectorAll(".ec-timeline rect.ec-mark").length === 4`,
		`(() => { const b = document.querySelector(".ec-scroll"); return b.getAttribute("aria-label") === "Request log" && (b.tabIndex < 0 || b.getAttribute("role") === "region"); })()`,
		`(async () => {
			const s = document.querySelector("select[name=preset]");
			const col = (sel) => [...document.querySelectorAll(sel)].map((c) => c.textContent).join();
			const pick = (v) => { s.value = v; s.dispatchEvent(new Event("change")); };
			pick("no-store");
			const ok = await until(() => col(".ec-table .ec-badge") === "MISS,BYPASS,HIT" && col(".ec-table td.ec-body") === "version 1,version 2,version 1");
			pick("max-age");
			return ok && await until(() => col(".ec-table .ec-badge") === "MISS,HIT,REVALIDATED,HIT");
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
			let ok = await until(() => q(".sh-live").textContent === "Unsaved: 1 of 10 chunks (489 B) are new; a backup now stores only those.");
			btn("Back up").click();
			ok = ok && await until(() => document.querySelectorAll(".sh-row").length === 3 && q(".sh-sum").textContent === "10 chunks: 1 new, 9 reused · 3,379 B → 447 B stored");
			ok = ok && await until(() => !btn("Flip one bit").disabled && q(".sh-byte").textContent.startsWith("byte 181 of 447: ciphertext of chunk 54c8efa2"));
			btn("Flip one bit").click();
			ok = ok && await until(() => q(".sh-verify .sh-bad .sh-why")?.textContent === "integrity error: blob 54c8efa2: authentication failed (MAC mismatch)");
			q(".sh-row button").click();
			ok = ok && await until(() => q(".sh-restore").textContent === "Restore refused at chunk 7 (pack 3): integrity error: blob 54c8efa2: authentication failed (MAC mismatch)");
			btn("Flip it back").click();
			return ok && await until(() => !document.querySelector(".sh-verify .sh-bad") && /^Restored 3,379 B from 10 chunks; .* identical to what was backed up\.$/.test(q(".sh-restore").textContent));
		})()`,
	},
	"keel": {
		`[...document.querySelectorAll(".kl-digest")].map((d) => d.textContent).join() === "24f2fb94354d9d25,24f2fb94354d9d25" && document.querySelector(".kl-match") !== null`,
		`[...document.querySelectorAll(".kl-totals dd")].map((d) => d.textContent).join() === "535,0,6,14,linearizable"`,
		`document.querySelectorAll(".kl-events li").length === 13 && document.querySelectorAll(".kl-timeline rect.kl-bar").length > 0`,
		`/^Seed 7: 118,095 scheduler steps and 148,245 traced events over 35\.00 s of simulated time, run in [\d,]+ ms in your browser\.$/.test(document.querySelector(".kl-status").textContent)`,
		`(async () => {
			const digests = () => [...document.querySelectorAll(".kl-digest")].map((d) => d.textContent).join();
			document.querySelector("input[name=seed]").value = "8";
			document.querySelector(".kl-controls").requestSubmit();
			let ok = await until(() => digests() === "22e2ba986ec4d67e" && !document.querySelector(".kl-controls button.secondary").disabled);
			document.querySelector(".kl-controls button.secondary").click();
			ok = ok && await until(() => digests() === "22e2ba986ec4d67e,22e2ba986ec4d67e" && document.querySelector(".kl-match") !== null);
			return ok && document.querySelectorAll(".kl-events li").length === 15;
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
