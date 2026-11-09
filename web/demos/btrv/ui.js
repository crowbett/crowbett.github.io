// btrv demo: btrv's page reader, page map, dictionary loader, inference and export
// loop, compiled to WebAssembly. On a simulated clock the binary first describes the
// file page by page (Map.Describe), then walks its data pages in the reader's order
// (export.Copy over Records), and each decoded row comes back from the same binary.
// Files you open are read inside this tab and are never uploaded.
const CHUNK = 768 << 10;
const MAX_BYTES = 32 << 20;
const SPEEDS = [1, 2, 5, 10];
const MAP_MS = 1800; // simulated ms the page map takes at 1×
const READ_MS = 7000; // the most the read takes at 1×
const FEED = 8;
const FLUSH_MS = 300;
const FADE_MS = 260;
const FILL_MS = 220;
const TRAIL = 10;
const GUT = 34;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => Number(n).toLocaleString("en-US");
const mib = (b) => `${(b / 1048576).toFixed(1)} MiB`;
const hex = (n) => `0x${n.toString(16)}`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

const LEGEND = ["fcr", "pat", "reserved", "data", "variable", "index", "free", "freed", "acs", "unreferenced", "other"];
const LABEL = { fcr: "FCR", pat: "PAT", acs: "ACS" };
const WHAT = {
  fcr: "File control record: the file's header, kept in two copies.",
  pat: "Page allocation table: maps logical pages to physical ones.",
  reserved: "Special page the reader skips.",
  data: "Fixed-length records. The fill rises as the reader decodes them.",
  variable: "Variable-length parts of records.",
  index: "A B-tree node of one key. Reading the records does not need it.",
  free: "Listed in the PAT as free; holds stale bytes.",
  freed: "A retired page.",
  acs: "Alternate collating sequence.",
  unreferenced: "No PAT entry lists this page: an older shadow copy. The reader skips it.",
  other: "A PAT type the reader does not know.",
};
const DAMAGEABLE = new Set(["data", "variable", "index"]);
const label = (k) => LABEL[k] || k;

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}
function field(text, input, cls) {
  const w = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  w.append(el("span", "demo-label", text), input);
  return w;
}
function choose(name, options, value) {
  const s = el("select");
  s.name = name;
  for (const [v, t] of options) {
    const o = el("option", null, t);
    o.value = String(v);
    o.selected = v === value;
    s.append(o);
  }
  return s;
}
function b64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => reject(r.error || new Error("could not read the file"));
    r.readAsDataURL(blob);
  });
}

export async function mount(root, demo) {
  const href = new URL("./ui.css", import.meta.url).href;
  let cssReady = Promise.resolve();
  if (![...document.querySelectorAll("link[rel=stylesheet]")].some((l) => l.href === href)) {
    const css = el("link");
    css.rel = "stylesheet";
    css.href = href;
    cssReady = new Promise((r) => { css.onload = r; css.onerror = r; });
    document.head.append(css);
  }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = matchMedia("(pointer: coarse)");

  // Controls.
  const fileSel = choose("file", [], "");
  const schemaSel = choose("schema", [["", "DDF dictionary"], ["infer", "inferred by btrv"]], "");
  const schemaField = field("schema", schemaSel);
  const speed = choose("speed", SPEEDS.map((s) => [s, `${s}×`]), 1);
  const pick = el("input", "vh");
  Object.assign(pick, { type: "file", multiple: true, name: "files" });
  const openKey = el("label", "key bt-open");
  openKey.append(el("span", null, "Open files"), pick);
  const sampleBtn = button("Back to the sample", "secondary");
  sampleBtn.hidden = true;
  const knobs = el("div", "bt-knobs");
  knobs.append(field("file", fileSel), schemaField, field("speed", speed), openKey, sampleBtn);
  const play = button("Pause");
  const step = button("Step", "secondary");
  const reset = button("Reset", "secondary");
  const corrupt = button("Corrupt a page", "bt-corrupt");
  const acts = el("div", "bt-acts");
  acts.append(play, step, reset, corrupt);
  const form = el("form", "bt-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(knobs, acts);

  // Hero: the page map.
  const mapHead = el("div", "bt-head");
  const mapTitle = el("h3", "bt-h", "page map");
  const mapSub = el("span", "bt-sub", "");
  mapHead.append(mapTitle, mapSub);
  const canvas = el("canvas", "bt-map");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  const now = el("p", "bt-now");
  const legend = el("ul", "demo-legend bt-legend");
  const mapSec = el("section", "bt-sec");
  mapSec.append(mapHead, canvas, now, legend);

  // Decoded rows feed and the page inspector.
  const feedHead = el("div", "bt-head");
  feedHead.append(el("h3", "bt-h", "decoded rows"), el("span", "bt-sub", "newest first, as export.Copy reads them"));
  const feedBox = el("div", "bt-feedbox");
  feedBox.setAttribute("role", "region");
  feedBox.setAttribute("aria-label", "Decoded rows");
  const feedTable = el("table", "bt-table bt-feed");
  const feedHeadRow = el("thead");
  const feedBody = el("tbody");
  feedTable.append(feedHeadRow, feedBody);
  feedBox.append(feedTable);
  const feedSec = el("section", "bt-sec");
  feedSec.append(feedHead, feedBox);
  const insp = el("section", "bt-sec bt-insp");
  insp.setAttribute("aria-live", "polite");
  const pair = el("div", "bt-pair");
  pair.append(insp, feedSec);

  const cells = el("ul", "cells stack bt-cells");
  const cell = {};
  for (const [k, t] of [["format", "format"], ["pagesize", "page size"], ["pages", "pages"], ["records", "records"], ["keys", "keys"],
    ["free", "free pages"], ["bad", "bad pages"], ["time", "call time"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "bt-v", "–");
    li.append(el("span", "bt-k", t), v);
    cell[k] = { li, v };
    cells.append(li);
  }
  const status = el("p", "bt-status");
  status.setAttribute("aria-live", "polite");
  const csvBtn = button("Download CSV", "secondary");
  const jsonBtn = button("Download JSON Lines", "secondary");
  const expStatus = el("p", "bt-note bt-expstatus", "SQLite export is in the btrv command; its SQLite driver does not build for WebAssembly.");
  expStatus.setAttribute("aria-live", "polite");
  const exportRow = el("div", "bt-export");
  exportRow.append(csvBtn, jsonBtn, expStatus);
  const receipt = el("p", "demo-out bt-out");
  receipt.setAttribute("aria-live", "polite");
  const wrap = el("div", "bt");
  wrap.append(form, mapSec, status, cells, pair, exportRow, receipt);
  root.replaceChildren(wrap);

  // State.
  let opened = null; // the answer of sample or open
  let onSample = true;
  let w = null; // the current walk
  let gen = 0;
  let playing = !reduce.matches;
  let visible = true;
  let raf = 0;
  let last = 0;
  let pending = 0;
  let busy = false;
  let blocked = 0; // file loads, resets and exports hold the walk
  let animUntil = 0;
  let colors = null;
  let G = null;
  let hover = -1;
  let picked = -1;
  let legendFocus = null;
  let rec = 0; // the record shown in the inspector, by row number
  let field_ = -1; // the column highlighted in it
  const damaged = new Map(); // file name -> Set of physical pages
  const dmg = () => damaged.get(w?.name) || new Set();

  const rpc = async (method, params) => {
    const t0 = performance.now();
    const ww = w;
    try {
      return await demo.call(method, params);
    } finally {
      if (ww) ww.ms += performance.now() - t0;
    }
  };
  const fail = (err) => { status.textContent = err.message; };

  function readColors() {
    const s = getComputedStyle(wrap);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      ground: v("--sunken"), line: v("--line"), strong: v("--line-strong"), ctl: v("--control-line"), ink: v("--text"), ink2: v("--text-2"), ink3: v("--text-3"),
      accent: v("--accent"), tint: v("--accent-tint"), block: v("--block"), signal: v("--signal"), live: v("--live"), bad: v("--danger"), mono: v("--mono") || "monospace",
    };
  }

  // A walk: one file mapped and then read.
  async function begin(name, schema) {
    const g = ++gen;
    const sel = await rpc("select", { name, schema });
    if (g !== gen) return false;
    const n = sel.pages;
    w = {
      name, sel, n, kinds: sel.kinds, kind: new Uint8Array(n), lp: new Float64Array(n), a: new Int32Array(n), b: new Int32Array(n), x: new Int32Array(n), ty: new Int32Array(n),
      seen: new Float64Array(n).fill(-1), fill: new Float64Array(n).fill(-1), desc: 0, problems: new Map(), phase: "map", order: [], cum: new Float64Array(n), at: 0, read: 0,
      trail: [], feed: [], report: null, stopPage: -1, ms: 0, table: !!sel.names, step: Math.max(4, Math.ceil(n / 60)), file: sel.file,
    };
    pending = 0;
    queued = [];
    feedBody.replaceChildren();
    renderFeedHead();
    if (picked >= n) picked = -1;
    hover = -1;
    layout();
    mapSub.textContent = `${w.name}: ${fmt(n)} pages of ${fmt(sel.file.pageSize)} bytes, in file order`;
    syncSchema();
    renderTiles();
    renderLegend();
    renderInspector();
    caption();
    return true;
  }

  function apply(from, cells_, problems, t) {
    cells_.forEach((cl, i) => {
      const j = from + i;
      w.kind[j] = cl[0]; w.lp[j] = cl[1]; w.a[j] = cl[2]; w.b[j] = cl[3]; w.x[j] = cl[4]; w.ty[j] = cl[5];
      w.seen[j] = t;
    });
    for (const pr of problems || []) w.problems.set(pr.page, pr.text);
    w.desc = from + cells_.length;
  }

  function endMap() {
    const dk = w.kinds.indexOf("data");
    const order = [];
    for (let i = 0; i < w.n; i++) if (w.kind[i] === dk) order.push(i);
    // The reader walks data pages in physical order before 6.x and logical order after.
    if (w.file.format !== "5.x") order.sort((p, q) => w.lp[p] - w.lp[q]);
    let run = 0;
    for (const p of order) { w.cum[p] = run; run += w.a[p]; }
    w.order = order;
    w.phase = w.table ? "read" : "done";
    if (picked < 0 || picked >= w.n) picked = order.length ? order[Math.floor(order.length * 0.4)] : -1;
    renderLegend();
    renderInspector();
    if (!w.table) finish();
  }

  async function mapOp(k, t) {
    const ww = w, g = gen;
    const from = ww.desc;
    const p = await rpc("pages", { from, n: Math.min(4096, ww.n - from, ww.step * k) });
    if (g !== gen) return;
    apply(from, p.cells, p.problems, t ?? performance.now());
    animUntil = performance.now() + FADE_MS;
    if (ww.desc >= ww.n) endMap();
    renderTiles();
    renderLegendCounts();
  }

  // stopAt is the index in walk order of the page the reader was on when it stopped
  // before row r: the page holding row r, or a bad page before it whose header the map
  // could not count slots in.
  function stopAt(r) {
    for (let j = 0; j < w.order.length; j++) {
      const p = w.order[j];
      if (w.cum[p] + w.a[p] > r || (w.problems.has(p) && w.cum[p] >= r)) return j;
    }
    return w.order.length;
  }

  async function readOp(k, t) {
    const ww = w, g = gen;
    const before = ww.read;
    let end = ww.at, want = 0;
    // The bridge reads at most 4,000 records a step.
    while (end < ww.order.length && end - ww.at < k && (end === ww.at || want + ww.a[ww.order[end]] < 4000)) want += ww.a[ww.order[end++]];
    const last_ = end >= ww.order.length;
    let r = null;
    if (want > 0 || last_) r = await rpc("scan", { n: want + (last_ ? 1 : 0) });
    while (r && last_ && !r.done && g === gen) r = await rpc("scan", { n: 4000 });
    if (g !== gen) return;
    const tt = t ?? performance.now();
    if (r) { ww.read = r.read; ww.bytes = r.bytes; ww.full = r.full; ww.note = r.note; }
    const stopped = r && r.done && (r.report?.stopped || r.errorText);
    const to = stopped ? stopAt(ww.read) : end;
    for (let i = ww.at; i < to; i++) { ww.fill[ww.order[i]] = tt; ww.trail.push(ww.order[i]); }
    if (ww.trail.length > TRAIL) ww.trail.splice(0, ww.trail.length - TRAIL);
    ww.at = to;
    if (stopped && to < ww.order.length) { ww.stopPage = ww.order[to]; ww.fill[ww.stopPage] = tt; }
    animUntil = performance.now() + Math.max(FADE_MS, FILL_MS);
    if (ww.read > before) {
      const from = Math.max(before, ww.read - FEED);
      const rows = await rpc("rows", { from, n: ww.read - from });
      if (g !== gen) return;
      pushFeed(rows, t === undefined);
    }
    if (r && r.done) { ww.report = r.report; ww.errorText = r.errorText || ""; finish(); }
    renderTiles();
    if (picked >= 0 && ww.kinds[ww.kind[picked]] === "data" && ww.fill[picked] === tt) renderInspector();
  }

  function finish() {
    w.phase = "done";
    flush(false);
    setPlaying(playing);
    const f = w.file, r = w.report;
    const probs = [...w.problems];
    if (!w.table) {
      status.textContent = `${w.name}: no schema to decode it with${w.sel.schemaError ? `: ${w.sel.schemaError}` : ""}. The page map is complete.`;
    } else if (r && r.stopped) {
      const p = w.stopPage;
      const where = p >= 0 ? `at physical page ${fmt(p)}${w.lp[p] >= 0 ? ` (logical ${fmt(w.lp[p])})` : ""} ` : "";
      status.textContent = `The read stopped ${where}after ${fmt(r.rowsRead)} of ${fmt(f.records)} rows rather than skip a page: ${r.stopped}`;
    } else if (r) {
      const flagged = probs.length ? `${probs.map(([p, t]) => `Page ${fmt(p)} is flagged: ${t}.`).join(" ")} The record walk did not need it: ` : "Every record the header counts was read and decoded: ";
      status.textContent = `${flagged}${fmt(r.rowsRead)} of ${fmt(f.records)} rows, ${fmt(r.columnErrors)} column errors.${w.note ? ` ${w.note}.` : ""}`;
    }
    const rows = r ? ` and ${fmt(r.rowsRead)} rows decoded` : "";
    receipt.setAttribute("aria-live", "polite");
    receipt.textContent = `${fmt(w.n)} pages mapped${rows} by btrv in ${Math.round(w.ms)} ms of calls, in your browser.`;
    renderTiles();
    renderInspector();
    caption();
    syncButtons();
  }

  // One tick's work: k map chunks or k data pages, in one or two calls.
  function cost() {
    if (!w) return Infinity;
    if (w.phase === "map") return MAP_MS / Math.ceil(w.n / w.step);
    return Math.min(60, Math.max(6, READ_MS / Math.max(1, w.order.length)));
  }
  async function op(k) {
    if (busy || !w || w.phase === "done") return;
    busy = true;
    try {
      if (w.phase === "map") await mapOp(k);
      else await readOp(k);
      caption();
    } finally {
      busy = false;
    }
  }

  // Runs the rest of the walk at once: reduced motion, or a walk nobody is watching.
  async function runOut() {
    const g = gen;
    while (w.phase === "map" && g === gen) await mapOp(4096 / w.step, 0);
    while (w.phase === "read" && g === gen) await readOp(1e9, 0);
  }

  async function restart(name, schema) {
    blocked++;
    syncButtons();
    try {
      if (!(await begin(name ?? w.name, schema ?? schemaSel.value))) return;
      if (reduce.matches && !playing) await runOut();
      else { await op(1); kick(); }
    } finally {
      blocked--;
      syncButtons();
    }
  }

  // Loading files.
  async function upload(list) {
    const total = list.reduce((a, f) => a + f.size, 0);
    if (total > MAX_BYTES) throw new Error(`These files hold ${mib(total)}; the demo takes up to 32 MiB at once (the btrv command has no such limit).`);
    await demo.call("reset", {});
    let sent = 0;
    for (const f of list) {
      await demo.call("begin", { name: f.name, size: f.size });
      for (let off = 0; off < f.size; off += CHUNK) {
        await demo.call("chunk", { b64: await b64(f.slice(off, off + CHUNK)) });
        sent += Math.min(CHUNK, f.size - off);
        status.textContent = `Handing ${f.name} to btrv: ${mib(sent)} of ${mib(total)}.`;
      }
    }
    return demo.call("open", {});
  }
  async function load(list) {
    blocked++;
    syncButtons();
    gen++;
    try {
      damaged.clear();
      picked = -1;
      opened = list ? await upload(list) : await demo.call("sample", {});
      onSample = !list;
      sampleBtn.hidden = onSample;
      fileSel.replaceChildren();
      const bad = [];
      for (const f of opened.files) {
        if (f.error) { bad.push(`${f.name}: ${f.error}`); continue; }
        const o = el("option", null, f.ddf ? `${f.name} (dictionary)` : f.name);
        o.value = f.name;
        fileSel.append(o);
      }
      if (opened.dictionaryError) bad.push(`Dictionary: ${opened.dictionaryError}`);
      status.textContent = bad.join(" ");
      if (!opened.selected) throw new Error(`None of these files is a Btrieve file btrv can open. ${bad.join(" ")}`);
      fileSel.value = opened.selected;
      schemaSel.value = "";
    } finally {
      blocked--;
    }
    await restart(opened.selected, "");
  }

  function syncSchema() {
    const f = opened.files.find((x) => x.name === w.name);
    schemaField.hidden = !(f && f.table);
    schemaSel.value = w.sel.source === "inferred" && f && f.table ? "infer" : "";
  }

  // Geometry, in CSS pixels.
  function layout() {
    if (!w) return;
    const W = Math.max(240, canvas.clientWidth || 600);
    const avail = W - GUT - 8;
    const maxH = Math.min(360, Math.max(200, innerHeight * 0.42));
    let size = Math.floor(Math.sqrt((avail * maxH) / Math.max(1, w.n))) - 2;
    size = Math.max(2, Math.min(30, size));
    if (coarse.matches && size < 22 && Math.ceil(w.n / Math.floor((avail + 2) / 24)) <= 16) size = 22;
    const gap = size >= 9 ? 2 : 1;
    const cols = Math.max(1, Math.floor((avail + gap) / (size + gap)));
    const rows = Math.ceil(w.n / cols);
    const H = rows * (size + gap) - gap + 16;
    G = { W, H, size, gap, cols, rows, x0: GUT, y0: 8 };
    canvas.style.height = `${H}px`;
    const dpr = devicePixelRatio || 1;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) Object.assign(canvas, { width: cw, height: ch });
  }
  const at = (i) => ({ x: G.x0 + (i % G.cols) * (G.size + G.gap), y: G.y0 + Math.floor(i / G.cols) * (G.size + G.gap) });

  function draw(t) {
    if (!w || !G || !colors) return;
    const dpr = devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors, s = G.size, K = w.kinds, still = reduce.matches;
    ctx.fillStyle = c.ground;
    ctx.fillRect(0, 0, G.W, G.H);
    // Row labels: the physical page number each row starts at.
    ctx.font = `400 10px ${c.mono}`;
    ctx.fillStyle = c.ink3;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const every = Math.max(1, Math.ceil(14 / (s + G.gap)));
    for (let r = 0; r < G.rows; r += every) ctx.fillText(fmt(r * G.cols), G.x0 - 6, G.y0 + r * (s + G.gap) + s / 2);
    const thin = s < 6;
    for (let i = 0; i < w.n; i++) {
      const { x, y } = at(i);
      if (w.seen[i] < 0) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 1;
        if (thin) { ctx.fillStyle = c.line; ctx.fillRect(x, y, s, s); } else ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
        continue;
      }
      const k = K[w.kind[i]];
      const age = still || !w.seen[i] ? 1 : (t - w.seen[i]) / FADE_MS;
      ctx.globalAlpha = legendFocus && legendFocus !== k ? 0.18 : 1;
      if (w.problems.has(i)) {
        ctx.fillStyle = c.bad;
        ctx.fillRect(x, y, s, s);
        if (!thin) { ctx.strokeStyle = c.ground; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + s - 2, y + s - 2); ctx.moveTo(x + s - 2, y + 2); ctx.lineTo(x + 2, y + s - 2); ctx.stroke(); }
      } else cellShape(ctx, c, k, i, x, y, s, t, still);
      if (age < 1) { ctx.globalAlpha = (1 - ease(age)) * 0.85; ctx.fillStyle = c.signal; ctx.fillRect(x, y, s, s); }
    }
    ctx.globalAlpha = 1;
    // The reader's trail and cursor.
    const ctr = (i) => { const p = at(i); return [p.x + s / 2, p.y + s / 2]; };
    if (w.phase === "read") {
      // The reader's wake: the last pages it read, fading.
      ctx.fillStyle = c.signal;
      w.trail.forEach((p, j) => {
        const q = at(p);
        ctx.globalAlpha = ((j + 1) / w.trail.length) * 0.55;
        ctx.fillRect(q.x, q.y, s, s);
      });
      ctx.globalAlpha = 1;
    }
    const box = (i, col, lw) => {
      const p = at(i);
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.strokeRect(p.x - lw / 2 - 0.5, p.y - lw / 2 - 0.5, s + lw + 1, s + lw + 1);
    };
    if (w.phase === "map" && w.desc < w.n) {
      const p = at(w.desc);
      ctx.fillStyle = c.signal;
      ctx.fillRect(p.x - 1, p.y - 2, 2, s + 4);
    }
    if (w.stopPage >= 0) {
      const [sx, sy] = ctr(w.stopPage);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = c.bad;
      ctx.lineWidth = 1.5;
      for (const [p] of w.problems) if (p !== w.stopPage) { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(...ctr(p)); ctx.stroke(); }
      ctx.setLineDash([]);
      box(w.stopPage, c.bad, 3);
    } else if (w.phase === "read" && w.at > 0) box(w.order[w.at - 1], c.signal, 3);
    if (picked >= 0) box(picked, c.ink, 2);
    if (hover >= 0 && hover !== picked) box(hover, c.ink, 1.5);
  }

  function cellShape(ctx, c, k, i, x, y, s, t, still) {
    const box = (col) => { ctx.fillStyle = col; ctx.fillRect(x, y, s, s); };
    const edge = (col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(dash ? [2, 2] : []); ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1); ctx.setLineDash([]); };
    if (k === "data") {
      const live = w.a[i], slots = Math.max(1, w.b[i]);
      let got = !w.table ? live : w.phase === "map" ? 0 : Math.max(0, Math.min(live, w.read - w.cum[i]));
      if (w.fill[i] > 0 && !still) got *= ease((t - w.fill[i]) / FILL_MS);
      box(c.tint);
      const fh = (s * got) / slots;
      ctx.fillStyle = c.block;
      ctx.fillRect(x, y + s - fh, s, fh);
      if (w.table && w.phase !== "map" && got < live && s >= 6) edge(c.block);
    } else if (k === "fcr" || k === "pat") {
      const col = k === "fcr" ? c.live : c.accent;
      if (!w.x[i]) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, y + 1, s - 2, s - 2); return; }
      box(col);
      ctx.fillStyle = c.ground;
      if (s >= 6) { if (k === "pat") ctx.fillRect(x, y + Math.floor(s / 2) - 1, s, 2); else ctx.fillRect(x + s / 3, y + s / 3, s / 3, s / 3); }
    } else if (k === "index") {
      box(c.ink2);
      ctx.fillStyle = c.ground;
      const q = Math.max(1, Math.round(s / 4));
      if (s >= 6 && !w.x[i]) ctx.fillRect(x + q, y + q, s - 2 * q, s - 2 * q);
      else if (s >= 6) for (let d = 2; d < s; d += 4) ctx.fillRect(x + d, y, 1, s);
    } else if (k === "free" || k === "freed") {
      ctx.strokeStyle = c.ctl;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -s; d < s; d += 4) { ctx.moveTo(x + Math.max(0, d), y + Math.max(0, -d)); ctx.lineTo(x + Math.min(s, s + d), y + Math.min(s, s - d)); }
      ctx.stroke();
      edge(c.ctl);
    } else if (k === "unreferenced") edge(c.ctl, true);
    else box(k === "reserved" ? c.strong : k === "variable" ? c.ink : c.ink3);
  }

  function counts() {
    const m = new Map();
    for (let i = 0; i < w.desc; i++) { const k = w.kinds[w.kind[i]]; m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }

  // Legend: a swatch, a name and a count per kind the map has found so far.
  const legendItems = new Map();
  function renderLegend() {
    legend.replaceChildren();
    legendItems.clear();
    for (const k of [...LEGEND, "bad"]) {
      const li = el("li", "bt-key");
      li.dataset.kind = k;
      const sw = el("span", "bt-sw");
      sw.setAttribute("aria-hidden", "true");
      const n = el("span", "bt-count", "0");
      li.append(sw, el("span", "bt-kname", k === "bad" ? "bad" : label(k)), n);
      li.hidden = true;
      if (k !== "bad") {
        li.addEventListener("pointerenter", () => { legendFocus = k; draw(performance.now()); });
        li.addEventListener("pointerleave", () => { legendFocus = null; draw(performance.now()); });
      }
      legendItems.set(k, { li, n });
      legend.append(li);
    }
    renderLegendCounts();
  }
  function renderLegendCounts() {
    if (!w) return;
    const m = counts();
    m.set("bad", w.problems.size);
    for (const [k, { li, n }] of legendItems) {
      const v = m.get(k) || 0;
      li.hidden = !v;
      n.textContent = fmt(v);
    }
    const parts = LEGEND.filter((k) => m.get(k)).map((k) => `${fmt(m.get(k))} ${label(k)}`);
    canvas.setAttribute("aria-label", `Page map of ${w.name}: ${fmt(w.desc)} of ${fmt(w.n)} pages described${parts.length ? `: ${parts.join(", ")}` : ""}${w.problems.size ? `; ${fmt(w.problems.size)} bad` : ""}. Arrow keys pick a page.`);
  }

  function renderTiles() {
    if (!w) return;
    const f = w.file, m = counts();
    const set = (k, v, alarm) => { cell[k].v.textContent = v; cell[k].li.classList.toggle("bt-alarm", !!alarm); };
    set("format", `Btrieve ${f.format}`);
    set("pagesize", `${fmt(f.pageSize)} B`);
    set("pages", w.desc < w.n ? `${fmt(w.desc)} / ${fmt(w.n)}` : fmt(w.n));
    set("records", w.table ? `${fmt(w.read)} / ${fmt(f.records)}` : fmt(f.records), w.report && w.report.stopped);
    set("keys", fmt(f.keys));
    set("free", fmt((m.get("free") || 0) + (m.get("freed") || 0)));
    set("bad", fmt(w.problems.size), w.problems.size);
    set("time", `${Math.round(w.ms)} ms`);
  }

  // The line under the map: what the cursor is doing, or the page under the pointer.
  function pageLine(i) {
    const k = w.kinds[w.kind[i]];
    const parts = [`page ${fmt(i)}`, label(k)];
    if (w.lp[i] >= 0) parts.push(`logical ${fmt(w.lp[i])}`);
    if (k === "data") parts.push(`${fmt(w.a[i])} of ${fmt(w.b[i])} slots live`);
    if (k === "variable") parts.push(`${fmt(w.a[i])} fragments`);
    if (k === "index") parts.push(`key ${w.b[i]}`, w.x[i] ? "leaf" : "interior");
    if (k === "fcr" || k === "pat") parts.push(`copy ${w.b[i] + 1}`, w.x[i] ? "active" : "older copy");
    if (w.problems.has(i)) parts.push("bad");
    return parts.join(" · ");
  }
  function caption() {
    if (!w) return;
    if (hover >= 0 && w.seen[hover] >= 0) { now.textContent = pageLine(hover); return; }
    if (w.phase === "map") now.textContent = `Map.Describe: ${fmt(w.desc)} of ${fmt(w.n)} page headers read`;
    else if (w.phase === "read" && w.at > 0) {
      const p = w.order[w.at - 1];
      now.textContent = `reading logical page ${fmt(w.lp[p])} at physical page ${fmt(p)}: rows ${fmt(w.cum[p] + 1)}–${fmt(w.cum[p] + w.a[p])}`;
    } else if (w.phase === "read") now.textContent = `walking ${fmt(w.order.length)} data pages in logical order`;
    else if (w.stopPage >= 0) now.textContent = `stopped at page ${fmt(w.stopPage)} after ${fmt(w.read)} rows`;
    else now.textContent = w.table ? `walk done: ${fmt(w.read)} rows from ${fmt(w.order.length)} data pages` : `map done: ${fmt(w.n)} pages`;
  }

  // Decoded rows, newest first.
  function feedCols() { return w.sel.names ? Math.min(w.sel.names.length, 5) : 0; }
  function renderFeedHead() {
    const tr = el("tr");
    tr.append(el("th", "bt-num", "#"));
    for (let i = 0; i < feedCols(); i++) tr.append(el("th", null, w.sel.names[i]));
    if (w.full || (w.file.flags & 1)) tr.append(el("th", "bt-num", "variable"));
    feedHeadRow.replaceChildren(tr);
    feedSec.hidden = !w.table;
  }
  // Rows arrive with every step; the feed shows them at most every FLUSH_MS so it can be read.
  let queued = [];
  let flushed = 0;
  function pushFeed(res, animate) {
    queued.push(res);
    if (!animate) flush(false);
  }
  function flush(animate) {
    flushed = performance.now();
    const qs = queued;
    queued = [];
    for (const res of qs) addRows(res, animate);
    if (w && w.phase !== "done") receipt.setAttribute("aria-live", "off");
    if (w && w.phase !== "done") receipt.textContent = `${fmt(w.desc)} pages mapped and ${fmt(w.read)} rows decoded by btrv so far, in ${Math.round(w.ms)} ms of calls, in your browser.`;
  }
  function addRows(res, animate) {
    const out = [];
    res.rows.forEach((row, k) => {
      const i = res.from + k;
      const bad = new Set((res.bad || []).filter((b) => b[0] === i).map((b) => b[1]));
      const tr = el("tr", animate && !reduce.matches ? "bt-new" : null);
      tr.append(el("td", "bt-num bt-rn", fmt(i + 1)));
      tr.addEventListener("click", () => { const j = stopAt(i); if (j < w.order.length) choosePage(w.order[j], i); });
      for (let ci = 0; ci < feedCols(); ci++) {
        const v = row[ci];
        if (bad.has(ci)) tr.append(el("td", "bt-alarm", "error"));
        else if (v === null) tr.append(el("td", "bt-null", "null"));
        else tr.append(el("td", /^-?[\d.]+$/.test(v) ? "bt-num" : null, v));
      }
      if (feedHeadRow.querySelectorAll("th").length > feedCols() + 1) {
        const tl = (res.tails || [])[k];
        tr.append(el("td", "bt-num bt-tail", tl ? `${fmt(tl[0])} B` : "–"));
      }
      out.unshift(tr);
    });
    feedBody.prepend(...out.slice(0, FEED));
    while (feedBody.children.length > FEED) feedBody.lastChild.remove();
  }

  // The inspector: what the binary says the picked page is, and for a data page its
  // records, one of them taken apart byte range by byte range.
  let inspTicket = 0;
  async function renderInspector() {
    const ticket = ++inspTicket;
    if (!w) return;
    const p = picked;
    const head = el("div", "bt-head");
    const title = el("h3", "bt-h", p >= 0 ? `page ${fmt(p)}` : "page");
    head.append(title);
    if (p < 0 || w.seen[p] < 0) {
      head.append(el("span", "bt-sub", p < 0 ? "pick a page on the map" : "not described yet"));
      insp.replaceChildren(head);
      syncButtons();
      return;
    }
    const k = w.kinds[w.kind[p]];
    head.append(el("span", `bt-tag bt-tag-${k}`, label(k)));
    const ps = w.file.pageSize;
    const facts = [["offset", `${hex(p * ps)}–${hex(p * ps + ps - 1)}`]];
    if (w.lp[p] >= 0) facts.push(["logical", fmt(w.lp[p])]);
    if (w.ty[p]) facts.push(["PAT type", hex(w.ty[p])]);
    if (k === "data") facts.push(["live slots", `${fmt(w.a[p])} / ${fmt(w.b[p])}`]);
    if (k === "variable") facts.push(["fragments", fmt(w.a[p])]);
    if (k === "index") facts.push(["key", fmt(w.b[p])], ["node", w.x[p] ? "leaf" : "interior"], ...(w.a[p] ? [["entries", fmt(w.a[p])]] : []));
    if (k === "fcr" || k === "pat") facts.push(["copy", fmt(w.b[p] + 1)], ["usage", fmt(w.a[p])], ["in use", w.x[p] ? "yes" : "no"]);
    const dl = el("dl", "bt-kv");
    for (const [a, b] of facts) { const d = el("div"); d.append(el("dt", null, a), el("dd", null, b)); dl.append(d); }
    const parts = [head, dl, el("p", "bt-what", WHAT[k] || "")];
    if (w.problems.has(p)) parts.push(el("p", "bt-alarm", `Map.Describe: ${w.problems.get(p)}.`));
    if (dmg().has(p)) parts.push(el("p", "bt-note", `Byte ${hex(p * ps + 2)} of this tab's copy is flipped. Press Repair to flip it back.`));
    insp.replaceChildren(...parts);
    syncButtons();
    if (k !== "data" || !w.table) return;
    const first = w.cum[p], have = Math.min(w.a[p], Math.max(0, w.read - first));
    if (w.phase === "map") return;
    if (!have) {
      const j = w.order.indexOf(p);
      let note = `Not read yet. Its rows are ${fmt(first + 1)}–${fmt(first + w.a[p])} in the reader's order.`;
      if (!w.a[p]) note = "Its header counts no live slots.";
      if (w.stopPage === p) note = `The read stopped on this page after ${fmt(w.read)} rows.`;
      else if (w.stopPage >= 0 && w.at <= j) note = "The read stopped before this page.";
      insp.append(el("p", w.stopPage === p ? "bt-alarm" : "bt-note", note));
      return;
    }
    const res = await rpc("rows", { from: first, n: Math.min(have, 200) });
    if (ticket !== inspTicket) return;
    if (rec < first || rec >= first + res.rows.length) rec = first;
    const list = el("div", "bt-recs");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", `Rows on page ${fmt(p)}`);
    res.rows.forEach((row, j) => {
      const i = first + j;
      const b = button(`#${fmt(i + 1)}`, "secondary bt-rec");
      b.setAttribute("aria-pressed", String(i === rec));
      b.title = row.slice(0, 3).filter((v) => v !== null).join(" · ");
      b.addEventListener("click", () => { rec = i; field_ = -1; renderInspector().catch(fail); });
      list.append(b);
    });
    const sub = el("p", "bt-sub", `rows ${fmt(first + 1)}–${fmt(first + res.rows.length)}, in the reader's order`);
    insp.append(sub, list, anatomy(res, rec - first));
  }

  function anatomy(res, j) {
    const cols = w.sel.columns || [];
    const row = res.rows[j];
    const tail = (res.tails || [])[j];
    const bad = new Set((res.bad || []).filter((b) => b[0] === res.from + j).map((b) => b[1]));
    const recLen = w.file.recordLength;
    const total = recLen + (tail ? tail[0] : 0);
    const box = el("div", "bt-anat");
    const ruler = el("div", "bt-ruler");
    ruler.setAttribute("aria-hidden", "true");
    const segs = [];
    cols.forEach((col, ci) => {
      const sg = el("span", `bt-seg bt-seg-${ci % 2}`);
      sg.style.left = `${(100 * col.offset) / total}%`;
      sg.style.width = `${(100 * col.size) / total}%`;
      sg.addEventListener("click", () => mark(ci));
      segs.push(sg);
      ruler.append(sg);
    });
    if (tail) {
      const sg = el("span", "bt-seg bt-seg-var");
      sg.style.left = `${(100 * recLen) / total}%`;
      sg.style.width = `${(100 * tail[0]) / total}%`;
      sg.addEventListener("click", () => mark(cols.length));
      segs.push(sg);
      ruler.append(sg);
    }
    const scale = el("p", "bt-scale");
    scale.setAttribute("aria-hidden", "true");
    scale.append(el("span", null, "byte 0"), el("span", null, tail ? `${fmt(recLen)} fixed + ${fmt(tail[0])} variable` : `${fmt(recLen)} bytes`));
    const tbox = el("div", "bt-fields");
    tbox.setAttribute("role", "region");
    tbox.setAttribute("aria-label", `Row ${fmt(rec + 1)}, field by field`);
    const t = el("table", "bt-table");
    const hr = el("tr");
    const inferred = w.sel.source === "inferred";
    for (const h of ["column", "bytes", "type", "value", ...(inferred ? ["confidence"] : [])]) hr.append(el("th", null, h));
    const th = el("thead");
    th.append(hr);
    const tb = el("tbody");
    const trs = [];
    const add = (ci, name, bytes, type, value, cls, extra) => {
      const tr = el("tr");
      tr.append(el("td", null, name), el("td", "bt-num", bytes), el("td", "bt-type", type), el("td", cls, value));
      if (extra !== undefined) tr.append(el("td", "bt-num", extra));
      tr.addEventListener("pointerenter", () => mark(ci));
      tr.addEventListener("pointerleave", () => mark(-1));
      trs.push(tr);
      tb.append(tr);
    };
    cols.forEach((col, ci) => {
      const v = row[ci];
      const type = col.type + (col.dec ? `(${col.dec})` : "") + (col.key ? " key" : "");
      add(ci, w.sel.names[ci], col.size > 1 ? `${col.offset}–${col.offset + col.size - 1}` : `${col.offset}`, type, bad.has(ci) ? "error" : v === null ? "null" : v,
        bad.has(ci) ? "bt-alarm" : v === null ? "bt-null" : null, inferred ? `${Math.round(col.confidence * 100)}%` : undefined);
    });
    if (tail) add(cols.length, "variable part", `${recLen}–${recLen + tail[0] - 1}`, "RecordsFull", tail[1], "bt-tail", inferred ? "" : undefined);
    t.append(th, tb);
    tbox.append(t);
    function mark(ci) {
      field_ = ci;
      segs.forEach((sg, k) => sg.classList.toggle("bt-on", k === ci));
      trs.forEach((tr, k) => tr.classList.toggle("bt-on", k === ci));
    }
    box.append(ruler, scale, tbox);
    if (field_ >= 0) mark(field_);
    return box;
  }

  function syncButtons() {
    const hold = blocked > 0;
    for (const b of [play, step, reset, corrupt, csvBtn, jsonBtn, fileSel, schemaSel, pick, sampleBtn]) b.disabled = hold;
    openKey.classList.toggle("bt-off", hold);
    if (!w) return;
    const done = w.phase === "done";
    step.disabled = hold || done;
    play.textContent = done ? "Replay" : playing ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(playing && !done));
    const k = picked >= 0 && w.seen[picked] >= 0 ? w.kinds[w.kind[picked]] : "";
    const can = DAMAGEABLE.has(k);
    corrupt.disabled = hold || !can;
    corrupt.textContent = !can ? "Corrupt a page" : dmg().has(picked) ? `Repair page ${fmt(picked)}` : `Corrupt page ${fmt(picked)}`;
    csvBtn.disabled = jsonBtn.disabled = hold || !w.table;
  }

  // The loop.
  function frame(t) {
    raf = 0;
    const dt = last ? Math.min(100, t - last) : 16;
    last = t;
    if (playing && w && w.phase !== "done" && !blocked) {
      const c = cost();
      pending = Math.min(pending + dt * Number(speed.value), c * 64);
      if (!busy && pending >= c) {
        const k = Math.max(1, Math.floor(pending / c));
        pending -= k * c;
        op(k).then(() => kick()).catch(fail);
      }
    }
    if (t - flushed > FLUSH_MS) flush(true);
    draw(t);
    const moving = playing && w && w.phase !== "done";
    if ((moving || t < animUntil) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  function setPlaying(v) { playing = v; syncButtons(); if (v) kick(); }

  play.addEventListener("click", () => {
    if (w && w.phase === "done") { playing = true; restart().catch(fail); return; }
    setPlaying(!playing);
  });
  step.addEventListener("click", () => {
    setPlaying(false);
    op(1).then(() => { animUntil = performance.now() + FADE_MS; kick(); }).catch(fail);
  });
  reset.addEventListener("click", () => restart().catch(fail));
  corrupt.addEventListener("click", async () => {
    const p = picked, name = w.name;
    try {
      blocked++;
      syncButtons();
      await demo.call("damage", { name, from: p });
      const set = damaged.get(name) || new Set();
      if (set.has(p)) set.delete(p); else set.add(p);
      damaged.set(name, set);
    } catch (err) {
      fail(err);
      return;
    } finally {
      blocked--;
    }
    status.textContent = dmg().has(p) ? `Flipped the bits of byte ${hex(p * w.file.pageSize + 2)}, in page ${fmt(p)}'s header. btrv maps and reads the file again.` : `Page ${fmt(p)} is repaired. btrv maps and reads the file again.`;
    if (!reduce.matches) playing = true;
    restart().catch(fail);
  });
  fileSel.addEventListener("change", () => { picked = -1; restart(fileSel.value, "").catch(fail); });
  schemaSel.addEventListener("change", () => restart(w.name, schemaSel.value).catch(fail));
  sampleBtn.addEventListener("click", () => load(null).catch(fail));

  // Picking pages on the map.
  const cellAt = (e) => {
    if (!G) return -1;
    const r = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left - G.x0) / (G.size + G.gap));
    const row = Math.floor((e.clientY - r.top - G.y0) / (G.size + G.gap));
    const i = row * G.cols + col;
    return col >= 0 && col < G.cols && row >= 0 && i < w.n ? i : -1;
  };
  const choosePage = (i, r = -1) => { picked = i; rec = r; field_ = -1; renderInspector().catch(fail); draw(performance.now()); };
  canvas.addEventListener("pointermove", (e) => {
    if (!w || e.pointerType === "touch") return;
    const i = cellAt(e);
    if (i === hover) return;
    hover = i;
    caption();
    if (!raf) draw(performance.now());
  });
  canvas.addEventListener("pointerleave", () => { hover = -1; caption(); if (!raf) draw(performance.now()); });
  canvas.addEventListener("pointerdown", (e) => { const i = w ? cellAt(e) : -1; if (i >= 0) choosePage(i); });
  canvas.addEventListener("keydown", (e) => {
    if (!w || !G) return;
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: G.cols, ArrowUp: -G.cols }[e.key];
    let i;
    if (e.key === "Home") i = 0;
    else if (e.key === "End") i = w.n - 1;
    else if (d !== undefined) i = Math.max(0, Math.min(w.n - 1, (picked < 0 ? 0 : picked) + d));
    else return;
    e.preventDefault();
    choosePage(i);
  });

  // Export: the same export.Copy loop as btrv dump and export.
  async function exportAs(format) {
    if (!w || !w.table) return;
    blocked++;
    syncButtons();
    try {
      const parts = [];
      let bytes = 0;
      await demo.call("export", { format, n: 0 });
      for (;;) {
        const r = await demo.call("export", { format, n: 2000 });
        parts.push(r.chunk);
        bytes += r.chunk.length;
        expStatus.textContent = `Writing ${format === "csv" ? "CSV" : "JSON Lines"}: ${mib(bytes)}`;
        if (r.done) {
          const rep = r.report;
          const blob = new Blob(parts, { type: format === "csv" ? "text/csv" : "application/x-ndjson" });
          const a = el("a");
          Object.assign(a, { href: URL.createObjectURL(blob), download: `${w.name.replace(/\.[^.]*$/, "")}.${format}`, hidden: true });
          wrap.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 30000);
          expStatus.textContent = `${a.download}: ${fmt(rep.rowsWritten)} rows written, ${fmt(rep.rowsWithErrors)} with column errors, ${fmt(blob.size)} bytes.` +
            (rep.stopped ? ` Stopped: ${rep.stopped}` : "");
          return;
        }
        if (!reduce.matches) await new Promise((r) => requestAnimationFrame(r));
      }
    } finally {
      blocked--;
      syncButtons();
      kick();
    }
  }
  csvBtn.addEventListener("click", () => exportAs("csv").catch(fail));
  jsonBtn.addEventListener("click", () => exportAs("jsonl").catch(fail));

  // Your own files: picked or dropped anywhere on the panel.
  const take = (list) => { if (list.length) load(list).catch(fail); };
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  wrap.addEventListener("dragover", (e) => { if (!isFiles(e)) return; e.preventDefault(); wrap.classList.add("bt-drop"); });
  wrap.addEventListener("dragleave", (e) => { if (e.target === wrap || !wrap.contains(e.relatedTarget)) wrap.classList.remove("bt-drop"); });
  wrap.addEventListener("drop", (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    wrap.classList.remove("bt-drop");
    take([...e.dataTransfer.files]);
  });
  pick.addEventListener("change", () => { const list = [...pick.files]; pick.value = ""; take(list); });

  const recolor = () => { readColors(); draw(performance.now()); };
  new ResizeObserver(() => { if (!root.isConnected || !w) return; layout(); recolor(); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
  addEventListener("themechange", recolor);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  readColors();
  await load(null);
  draw(performance.now());
}
