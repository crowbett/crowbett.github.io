// btrv demo: btrv's page reader, dictionary loader, inference and export loop,
// compiled to WebAssembly. Files are read in this tab and handed to the binary in
// chunks; nothing is uploaded anywhere.
const CHUNK = 768 << 10;
const MAX_BYTES = 32 << 20;
const ROW = 28;
const BLOCK = 100;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => Number(n).toLocaleString("en-US");
const mib = (b) => `${(b / 1048576).toFixed(1)} MiB`;
const hex = (n) => `0x${n.toString(16)}`;
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const LEGEND = ["fcr", "pat", "reserved", "data", "variable", "index", "free", "freed", "acs", "unreferenced", "other"];
const LABEL = { fcr: "FCR", pat: "PAT", acs: "ACS" };
const WHAT = {
  fcr: "file control record, the header (two copies)",
  pat: "page allocation table: logical to physical",
  reserved: "special page the reader skips",
  data: "fixed-length records; fill = live slots",
  variable: "variable-length parts of records",
  index: "B-tree node of a key",
  free: "listed in the PAT as free",
  freed: "retired page",
  acs: "alternate collating sequence",
  unreferenced: "no PAT entry lists it; skipped",
  other: "PAT type the reader does not know",
};
const label = (k) => LABEL[k] || k;

function b64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => reject(r.error || new Error("could not read the file"));
    r.readAsDataURL(blob);
  });
}

function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function cellsList(pairs) {
  const ul = el("ul", "cells stack bt-facts");
  for (const [k, v, cls] of pairs) {
    const li = el("li", cls);
    li.append(el("span", "bt-k", k), el("span", "bt-v", v));
    ul.append(li);
  }
  return ul;
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

  let work = 0;
  const rpc = async (method, params) => {
    const t0 = performance.now();
    try {
      return await demo.call(method, params);
    } finally {
      work += performance.now() - t0;
    }
  };

  // Controls
  const sampleBtn = button("Load the sample file", null, () => guard(() => load(null)));
  const pick = el("input", "vh");
  Object.assign(pick, { type: "file", multiple: true, name: "files" });
  const pickKey = el("label", "key bt-open");
  pickKey.append(el("span", null, "Open a file"), pick);
  const picked = el("span", "demo-note bt-picked", "no file chosen");
  const controls = el("div", "bt-controls");
  controls.append(sampleBtn, pickKey, picked);
  const privacy = el("p", "bt-note", "Drop files anywhere on this panel. They are read inside this tab by the WebAssembly build; nothing is uploaded.");
  const status = el("p", "bt-status");
  status.setAttribute("aria-live", "polite");
  const bar = el("progress", "demo-progress bt-progress");
  bar.max = 1;
  bar.value = 0;
  bar.classList.add("bt-idle");
  const tabs = el("div", "bt-tabs");
  tabs.setAttribute("aria-label", "Files");
  tabs.setAttribute("role", "group");

  // Page map
  const mapHead = el("div", "bt-head");
  mapHead.append(el("h3", "bt-h", "page map"), el("span", "bt-sub", "one cell per page, in file order"));
  const canvas = el("canvas", "bt-map");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  const mapWrap = el("div", "bt-mapwrap");
  mapWrap.append(canvas);
  const legend = el("ul", "demo-legend bt-legend");
  const readout = el("div", "bt-readout");
  const readText = el("p", "bt-read");
  readText.id = "bt-read";
  readText.setAttribute("aria-live", "polite");
  canvas.setAttribute("aria-describedby", "bt-read");
  const damageBtn = button("Damage page", "secondary bt-damage", () => guard(damage));
  damageBtn.hidden = true;
  readout.append(readText, damageBtn);
  const mapSec = el("section", "bt-sec bt-mapsec");
  mapSec.append(mapHead, mapWrap, readout, legend);

  // Schema and summary
  const schemaSec = el("section", "bt-sec");
  const sumSec = el("section", "bt-sec");
  const pair = el("div", "bt-pair");
  pair.append(schemaSec, sumSec);

  // Rows and export
  const rowsHead = el("div", "bt-head");
  const rowsTitle = el("h3", "bt-h", "rows");
  const rowsSub = el("span", "bt-sub", "");
  rowsHead.append(rowsTitle, rowsSub);
  const rowsBox = el("div", "bt-rows");
  rowsBox.setAttribute("aria-label", "Decoded rows");
  rowsBox.setAttribute("role", "region");
  rowsBox.tabIndex = 0;
  const table = el("table", "bt-table");
  const thead = el("thead");
  const tbody = el("tbody");
  table.append(thead, tbody);
  rowsBox.append(table);
  const exportRow = el("div", "bt-export");
  const csvBtn = button("Download CSV", null, () => guard(() => exportAs("csv")));
  const jsonBtn = button("Download JSON Lines", "secondary", () => guard(() => exportAs("jsonl")));
  const expStatus = el("p", "bt-status bt-expstatus");
  expStatus.setAttribute("aria-live", "polite");
  exportRow.append(csvBtn, jsonBtn, expStatus);
  const sqliteNote = el("p", "bt-note", "SQLite export is in the btrv command; its SQLite driver does not build for WebAssembly.");
  const rowsSec = el("section", "bt-sec");
  rowsSec.append(rowsHead, rowsBox, exportRow, sqliteNote);

  const wrap = el("div", "bt");
  const receipt = el("p", "demo-out bt-out");
  wrap.append(controls, privacy, status, bar, tabs, mapSec, pair, rowsSec, receipt);
  root.replaceChildren(wrap);

  // State
  let markFirst;
  const shown = new Promise((r) => { markFirst = r; });
  let gen = 0;
  let busy = false;
  let opened = null; // answer of open/sample
  let cur = null; // the selected file
  const damaged = new Map(); // file name -> Set of pages
  const setDisabled = (v) => { for (const c of wrap.querySelectorAll("button, input")) c.disabled = v; };

  const guard = async (f, rethrow) => {
    if (busy) return;
    busy = true;
    work = 0;
    setDisabled(true);
    try {
      await f();
    } catch (err) {
      if (rethrow) throw err;
      status.textContent = err.message;
      bar.classList.add("bt-idle");
    } finally {
      busy = false;
      setDisabled(false);
      if (cur && !cur.table) csvBtn.disabled = jsonBtn.disabled = true;
    }
  };

  // Loading files
  async function upload(list) {
    const total = list.reduce((a, f) => a + f.size, 0);
    if (total > MAX_BYTES) throw new Error(`These files hold ${mib(total)}; the demo takes up to 32 MiB at once (the btrv command has no such limit).`);
    await rpc("reset");
    let sent = 0;
    bar.classList.remove("bt-idle");
    for (const f of list) {
      await rpc("begin", { name: f.name, size: f.size });
      for (let off = 0; off < f.size; off += CHUNK) {
        await rpc("chunk", { b64: await b64(f.slice(off, off + CHUNK)) });
        sent += Math.min(CHUNK, f.size - off);
        bar.value = total ? sent / total : 1;
        status.textContent = `Handing ${f.name} to btrv: ${mib(sent)} of ${mib(total)}`;
      }
    }
    return rpc("open");
  }

  async function load(list) {
    damaged.clear();
    picked.textContent = list ? list.map((f) => f.name).join(", ") : "the sample file";
    opened = list ? await upload(list) : await rpc("sample");
    renderTabs();
    if (!opened.selected) {
      cur = null;
      status.textContent = "None of these files is a Btrieve file btrv can open.";
      bar.classList.add("bt-idle");
      return;
    }
    await select(opened.selected);
  }

  function renderTabs() {
    tabs.replaceChildren();
    const fs = opened.files;
    for (const f of fs) {
      if (f.error) {
        const p = el("p", "bt-bad-file", `${f.name}: ${f.error}`);
        tabs.append(p);
        continue;
      }
      const b = button(f.name, "secondary bt-tab", () => guard(() => select(f.name)));
      b.dataset.name = f.name;
      b.setAttribute("aria-pressed", "false");
      tabs.append(b);
    }
    if (opened.dictionaryError) tabs.append(el("p", "bt-bad-file", `Dictionary: ${opened.dictionaryError}`));
  }

  async function select(name, schema, keep) {
    const g = ++gen;
    const sel = await rpc("select", { name, schema });
    const n = sel.pages;
    const c = { name, sel, n, kinds: sel.kinds, kind: new Uint8Array(n), lp: new Float64Array(n), a: new Int32Array(n), b: new Int32Array(n),
      x: new Int32Array(n), problems: new Map(), read: 0, done: false, scan: null, table: !!sel.names, sel2: null, hover: -1, pick: -1 };
    cur = c;
    sampleBtn.classList.add("secondary");
    for (const b of tabs.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.name === name));
    for (let from = 0; from < n; from += 4096) {
      const p = await rpc("pages", { from, n: 4096 });
      if (g !== gen) return;
      p.cells.forEach((cell, i) => {
        const k = from + i;
        c.kind[k] = cell[0]; c.lp[k] = cell[1]; c.a[k] = cell[2]; c.b[k] = cell[3]; c.x[k] = cell[4];
      });
      for (const pr of p.problems || []) c.problems.set(pr.page, pr.text);
      if (n > 4096) status.textContent = `Mapping pages: ${fmt(Math.min(n, from + 4096))} of ${fmt(n)}`;
    }
    // Data pages in walk order (logical order from 6.x, physical before), with cumulative live slots.
    const data = [];
    const dk = c.kinds.indexOf("data");
    for (let i = 0; i < n; i++) if (c.kind[i] === dk) data.push(i);
    if (sel.file.format !== "5.x") data.sort((p, q) => c.lp[p] - c.lp[q]);
    c.order = data;
    c.cum = new Float64Array(n);
    let run = 0;
    for (const p of data) { c.cum[p] = run; run += c.a[p]; }
    layout();
    renderLegend();
    renderSchema();
    renderSummary();
    resetRows();
    const want = keep ?? (n > 40 && c.kind[40] === dk ? 40 : data.length ? data[0] : -1);
    c.pick = want;
    c.fresh = keep === undefined;
    showPage(want);
    draw();
    markFirst();
    if (!c.table) {
      status.textContent = describe(sel.file) + (sel.schemaError ? ` No schema: ${sel.schemaError}` : "");
      bar.classList.add("bt-idle");
      receipt.textContent = `${fmt(n)} pages mapped by btrv in ${Math.round(work)} ms, in your browser.`;
      return;
    }
    await scan(g);
  }

  function describe(f) {
    return `${f.name}: Btrieve ${f.format}, ${fmt(f.pageSize)}-byte pages, ${fmt(cur.n)} pages, ${fmt(f.records)} records of ${fmt(f.recordLength)} bytes in the header.`;
  }

  async function scan(g) {
    const c = cur;
    const total = Math.max(1, c.sel.file.records);
    const step = still() ? 4000 : Math.max(120, Math.ceil(total / 90));
    bar.classList.remove("bt-idle");
    for (;;) {
      const r = await rpc("scan", { n: step });
      if (g !== gen) return;
      c.read = r.read;
      c.bytes = r.bytes;
      c.full = r.full;
      c.note = r.note;
      bar.value = Math.min(1, r.read / total);
      status.textContent = `${describe(c.sel.file)} Read ${fmt(r.read)}.`;
      draw();
      if (r.done) { c.done = true; c.scan = r; break; }
      if (!still()) await frame();
    }
    bar.classList.add("bt-idle");
    renderSummary();
    initRows();
    receipt.textContent = `${fmt(c.n)} pages mapped and ${fmt(c.scan.report.rowsRead)} rows decoded by btrv in ${Math.round(work)} ms, in your browser.`;
  }

  async function damage() {
    const c = cur;
    const p = c.pick;
    await rpc("damage", { name: c.name, from: p });
    const set = damaged.get(c.name) || new Set();
    if (set.has(p)) set.delete(p); else set.add(p);
    damaged.set(c.name, set);
    await select(c.name, c.sel.source === "inferred" ? "infer" : "", p);
  }

  // Page map drawing
  const coarse = matchMedia("(pointer: coarse)");
  let geo = { size: 10, gap: 2, cols: 1, rows: 1, w: 0, h: 0 };
  function layout() {
    if (!cur) return;
    const w = Math.max(1, mapWrap.clientWidth);
    const maxH = Math.min(340, Math.max(180, innerHeight * 0.45));
    let size = Math.floor(Math.sqrt((w * maxH) / Math.max(1, cur.n))) - 1;
    size = Math.max(2, Math.min(22, size));
    if (coarse.matches && size < 24 && Math.ceil(cur.n / Math.floor((w + 2) / 26)) <= 42) size = 24;
    const gap = size >= 9 ? 2 : 1;
    const cols = Math.max(1, Math.floor((w + gap) / (size + gap)));
    const rows = Math.ceil(cur.n / cols);
    geo = { size, gap, cols, rows, w, h: rows * (size + gap) - gap };
    canvas.style.height = `${geo.h}px`;
    draw();
  }

  function colours() {
    const cs = getComputedStyle(wrap);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { fcr: v("--signal"), pat: v("--accent"), reserved: v("--line-strong"), data: v("--block"), tint: v("--accent-tint"), variable: v("--text"),
      index: v("--text-2"), free: v("--control-line"), ground: v("--sunken"), ink: v("--text"), bad: v("--danger"), other: v("--text-3") };
  }

  function draw() {
    const c = cur;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const W = Math.round(geo.w * dpr), H = Math.max(1, Math.round(geo.h * dpr));
    if (canvas.width !== W || canvas.height !== H) Object.assign(canvas, { width: W, height: H });
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = colours();
    ctx.clearRect(0, 0, geo.w, geo.h);
    const { size: s, gap } = geo;
    const K = c.kinds;
    const focus = legendFocus;
    for (let i = 0; i < c.n; i++) {
      const x = (i % geo.cols) * (s + gap), y = Math.floor(i / geo.cols) * (s + gap);
      const k = K[c.kind[i]];
      ctx.globalAlpha = focus && focus !== k ? 0.18 : 1;
      if (c.problems.has(i)) {
        ctx.fillStyle = col.bad;
        ctx.fillRect(x, y, s, s);
        if (s >= 6) { ctx.strokeStyle = col.ground; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 1.5, y + 1.5); ctx.lineTo(x + s - 1.5, y + s - 1.5); ctx.moveTo(x + s - 1.5, y + 1.5); ctx.lineTo(x + 1.5, y + s - 1.5); ctx.stroke(); }
        continue;
      }
      switch (k) {
        case "data": {
          const live = c.a[i], slots = Math.max(1, c.b[i]);
          const got = c.table ? Math.max(0, Math.min(live, c.read - c.cum[i])) : live;
          ctx.fillStyle = col.tint;
          ctx.fillRect(x, y, s, s);
          const fh = (s * got) / slots;
          ctx.fillStyle = col.data;
          ctx.fillRect(x, y + s - fh, s, fh);
          break;
        }
        case "fcr": case "pat": case "reserved":
          if (c.x[i] || k === "reserved") {
            ctx.fillStyle = col[k];
            ctx.fillRect(x, y, s, s);
            if (k === "pat" && s >= 6) { ctx.fillStyle = col.ground; ctx.fillRect(x, y + Math.floor(s / 2) - 1, s, 2); }
          }
          else { ctx.strokeStyle = col[k]; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1); }
          break;
        case "variable":
          ctx.fillStyle = col.variable;
          ctx.fillRect(x, y, s, s);
          break;
        case "index":
          ctx.fillStyle = col.index;
          ctx.fillRect(x, y, s, s);
          if (!c.x[i] && s >= 6) { const q = Math.max(1, Math.round(s / 4)); ctx.fillStyle = col.ground; ctx.fillRect(x + q, y + q, s - 2 * q, s - 2 * q); }
          else if (s >= 6) { ctx.fillStyle = col.ground; for (let d = 2; d < s; d += 4) ctx.fillRect(x + d, y, 1, s); }
          break;
        case "free": case "freed":
          ctx.fillStyle = col.ground;
          ctx.fillRect(x, y, s, s);
          ctx.strokeStyle = col.free;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let d = -s; d < s; d += 4) { ctx.moveTo(x + Math.max(0, d), y + Math.max(0, -d)); ctx.lineTo(x + Math.min(s, s + d), y + Math.min(s, s - d)); }
          ctx.stroke();
          ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
          break;
        case "unreferenced":
          ctx.strokeStyle = col.free;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
          ctx.setLineDash([]);
          break;
        default:
          ctx.fillStyle = col.other;
          ctx.fillRect(x, y, s, s);
          if (s >= 6) { ctx.fillStyle = col.ground; ctx.fillRect(x + Math.floor(s / 2) - 1, y + Math.floor(s / 2) - 1, 2, 2); }
      }
    }
    ctx.globalAlpha = 1;
    for (const [i, w] of [[c.pick, 2], [c.hover, 1.5]]) {
      if (i < 0) continue;
      const x = (i % geo.cols) * (s + gap), y = Math.floor(i / geo.cols) * (s + gap);
      ctx.strokeStyle = col.ink;
      ctx.lineWidth = w;
      ctx.strokeRect(x - w / 2 - 0.5, y - w / 2 - 0.5, s + w + 1, s + w + 1);
    }
    canvas.setAttribute("aria-label", `Page map of ${c.name}: ${fmt(c.n)} pages. ${counts().map(([k, v]) => `${fmt(v)} ${label(k)}`).join(", ")}.`);
  }

  function counts() {
    const m = new Map();
    for (let i = 0; i < cur.n; i++) { const k = cur.kinds[cur.kind[i]]; m.set(k, (m.get(k) || 0) + 1); }
    return LEGEND.filter((k) => m.has(k)).map((k) => [k, m.get(k)]);
  }

  let legendFocus = null;
  function renderLegend() {
    legend.replaceChildren();
    for (const [k, v] of counts()) {
      const li = el("li", "bt-key");
      li.dataset.kind = k;
      const sw = el("span", "bt-sw");
      sw.setAttribute("aria-hidden", "true");
      li.append(sw, el("span", "bt-kname", label(k)), el("span", "bt-count", fmt(v)), el("span", "bt-what", WHAT[k] || ""));
      li.addEventListener("pointerenter", () => { legendFocus = k; draw(); });
      li.addEventListener("pointerleave", () => { legendFocus = null; draw(); });
      legend.append(li);
    }
    if (cur.problems.size) {
      const li = el("li", "bt-key bt-key-bad");
      li.dataset.kind = "bad";
      const sw = el("span", "bt-sw");
      sw.setAttribute("aria-hidden", "true");
      li.append(sw, el("span", "bt-kname", "bad"), el("span", "bt-count", fmt(cur.problems.size)), el("span", "bt-what", "header disagrees with the PAT"));
      legend.append(li);
    }
  }

  function pageText(i) {
    const c = cur;
    const k = c.kinds[c.kind[i]];
    const ps = c.sel.file.pageSize;
    const parts = [`page ${fmt(i)}`, label(k), `offset ${hex(i * ps)}`];
    if (c.lp[i] >= 0) parts.push(`logical ${fmt(c.lp[i])}`);
    if (k === "data") parts.push(`${fmt(c.a[i])} of ${fmt(c.b[i])} slots live`);
    if (k === "variable") parts.push(`${fmt(c.a[i])} fragments`);
    if (k === "index") parts.push(`key ${c.b[i]}`, c.x[i] ? "leaf" : "interior node", ...(c.a[i] ? [`${fmt(c.a[i])} entries`] : []));
    if (k === "fcr" || k === "pat") parts.push(`copy ${c.b[i] + 1}`, `usage count ${fmt(c.a[i])}`, c.x[i] ? "active: the reader uses this copy" : "older copy");
    if (k === "free") parts.push("listed in the PAT as free, holding stale bytes");
    if (k === "unreferenced") parts.push("no PAT entry lists this page; the reader skips it");
    const pr = c.problems.get(i);
    return parts.join(" · ") + (pr ? `. Problem: ${pr}` : "");
  }

  function showPage(i) {
    readText.textContent = i < 0 ? "Select a page for its header; arrow keys move between pages." : pageText(i);
    const k = i >= 0 ? cur.kinds[cur.kind[i]] : "";
    const can = k === "data";
    const set = damaged.get(cur.name);
    damageBtn.hidden = !can;
    damageBtn.textContent = set && set.has(i) ? `Undo the damage to page ${fmt(i)}` : `Damage page ${fmt(i)}`;
  }

  const cellAt = (e) => {
    const r = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / (geo.size + geo.gap));
    const row = Math.floor((e.clientY - r.top) / (geo.size + geo.gap));
    const i = row * geo.cols + col;
    return col >= 0 && col < geo.cols && row >= 0 && i < (cur ? cur.n : 0) ? i : -1;
  };
  canvas.addEventListener("pointermove", (e) => {
    if (!cur || e.pointerType === "touch") return;
    const i = cellAt(e);
    if (i === cur.hover) return;
    cur.hover = i;
    showPage(i >= 0 ? i : cur.pick);
    draw();
  });
  canvas.addEventListener("pointerleave", () => { if (cur) { cur.hover = -1; showPage(cur.pick); draw(); } });
  canvas.addEventListener("pointerdown", (e) => {
    if (!cur) return;
    const i = cellAt(e);
    if (i < 0) return;
    cur.pick = i;
    cur.fresh = false;
    showPage(i);
    draw();
  });
  canvas.addEventListener("keydown", (e) => {
    if (!cur) return;
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: geo.cols, ArrowUp: -geo.cols, Home: -Infinity, End: Infinity }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const start = cur.fresh;
    cur.fresh = false;
    const from = start ? 0 : cur.pick;
    cur.pick = Math.max(0, Math.min(cur.n - 1, d === -Infinity ? 0 : d === Infinity ? cur.n - 1 : from + (start ? 0 : d)));
    showPage(cur.pick);
    draw();
  });

  // Schema
  function renderSchema() {
    const c = cur, sel = c.sel;
    schemaSec.replaceChildren();
    const head = el("div", "bt-head");
    head.append(el("h3", "bt-h", "schema"));
    const file = opened.files.find((f) => f.name === c.name);
    let src = "";
    if (sel.source === "dictionary") src = `from the DDF dictionary: table ${file.table}`;
    else if (sel.source === "inferred") src = `inferred by btrv from the first ${fmt(sel.inferredFrom)} records`;
    else src = "none";
    head.append(el("span", "bt-sub", src));
    schemaSec.append(head);
    if (file.table) {
      const seg = el("div", "bt-seg");
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", "Schema source");
      for (const [t, v] of [["Dictionary", ""], ["Inferred", "infer"]]) {
        const b = button(t, "secondary", () => guard(() => select(c.name, v)));
        b.setAttribute("aria-pressed", String((sel.source === "inferred") === (v === "infer")));
        seg.append(b);
      }
      schemaSec.append(seg);
    }
    if (!sel.columns) {
      schemaSec.append(el("p", "bt-note", sel.schemaError || "No schema."));
      return;
    }
    const recLen = sel.file.recordLength;
    const ruler = el("div", "bt-ruler");
    ruler.setAttribute("aria-hidden", "true");
    sel.columns.forEach((col, i) => {
      const seg = el("span", `bt-span bt-span-${i % 2}`);
      seg.style.left = `${(100 * col.offset) / recLen}%`;
      seg.style.width = `${(100 * col.size) / recLen}%`;
      seg.title = `${col.name}: ${col.type}, bytes ${col.offset}–${col.offset + col.size - 1}`;
      ruler.append(seg);
    });
    const scale = el("p", "bt-scale");
    scale.setAttribute("aria-hidden", "true");
    scale.append(el("span", null, "byte 0"), el("span", null, `${fmt(recLen)} bytes per record`));
    const box = el("div", "bt-cols");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Columns");
    box.tabIndex = 0;
    const t = el("table", "bt-table bt-coltable");
    const hr = el("tr");
    const inferred = sel.source === "inferred";
    for (const h of ["column", "type", "offset", "size", ...(inferred ? ["confidence"] : [])]) hr.append(el("th", null, h));
    const th = el("thead");
    th.append(hr);
    const tb = el("tbody");
    for (const col of sel.columns) {
      const tr = el("tr");
      const type = col.type + (col.dec ? ` (${col.dec})` : "") + (col.nullable ? " null" : "") + (col.key ? " · key" : "");
      tr.append(el("td", null, col.name), el("td", null, type), el("td", "bt-num", fmt(col.offset)), el("td", "bt-num", fmt(col.size)));
      if (inferred) {
        const td = el("td", "bt-num", `${Math.round(col.confidence * 100)}%`);
        td.title = col.evidence || "";
        tr.append(td);
      }
      tb.append(tr);
    }
    t.append(th, tb);
    box.append(t);
    schemaSec.append(ruler, scale, box);
    if (sel.indexes && sel.indexes.length) {
      schemaSec.append(el("p", "bt-note", `Index ${sel.indexes.map((x) => `${x.number} on ${x.column}`).join(", ")} (INDEX.DDF).`));
    }
  }

  // Decode summary
  function renderSummary() {
    const c = cur, f = c.sel.file;
    sumSec.replaceChildren();
    const head = el("div", "bt-head");
    head.append(el("h3", "bt-h", "decode summary"), el("span", "bt-sub", c.done ? "export.Copy's report, as btrv dump prints it" : c.table ? "reading…" : ""));
    sumSec.append(head);
    const r = c.scan && c.scan.report;
    const pairs = [
      ["format", `Btrieve ${f.format}`],
      ["page size", `${fmt(f.pageSize)} B`],
      ["pages", fmt(c.n)],
      ["records in header", fmt(f.records)],
      ["keys", fmt(f.keys)],
      ["bad pages", fmt(c.problems.size + (c.sel.mapProblems || []).length), c.problems.size ? "bt-alarm" : ""],
    ];
    if (r) {
      pairs.push(["rows read", fmt(r.rowsRead)], ["rows with column errors", fmt(r.rowsWithErrors), r.rowsWithErrors ? "bt-alarm" : ""],
        ["column errors", fmt(r.columnErrors), r.columnErrors ? "bt-alarm" : ""]);
      if (c.full) pairs.push(["variable-part bytes", fmt(c.bytes - r.rowsRead * f.recordLength)]);
    }
    sumSec.append(cellsList(pairs));
    const lines = [];
    if (f.owner) lines.push(["Owner name: " + f.owner, true]);
    for (const [p, t] of c.problems) lines.push([`Page ${fmt(p)}: ${t}`, true]);
    for (const t of c.sel.mapProblems || []) lines.push([t, true]);
    if (r) {
      if (r.stopped) lines.push([`Stopped: ${r.stopped}`, true]);
      for (const w of r.warnings || []) lines.push([`Warning: ${w}`, false]);
      for (const e of r.errors || []) lines.push([e, true]);
      if (!r.stopped && !r.rowsWithErrors && !c.problems.size) lines.push([`Every record the header counts was read and decoded: ${fmt(r.rowsRead)} of ${fmt(f.records)}.`, false]);
    }
    if (c.note) lines.push([c.note, false]);
    if (lines.length) {
      const ul = el("ul", "bt-lines");
      for (const [t, bad] of lines) ul.append(el("li", bad ? "bt-alarm" : null, t));
      sumSec.append(ul);
    }
  }

  // Rows
  let cache = new Map();
  let total = 0;
  function resetRows() {
    cache = new Map();
    total = 0;
    thead.replaceChildren();
    tbody.replaceChildren();
    rowsSub.textContent = cur.table ? "reading…" : "no schema to decode with";
    rowsBox.scrollTop = 0;
  }
  function initRows() {
    const c = cur;
    total = c.read;
    rowsSub.textContent = `${fmt(total)} decoded rows, scroll for more`;
    const tr = el("tr");
    tr.append(el("th", "bt-num", "#"));
    c.sel.columns.forEach((col, i) => {
      const th = el("th");
      th.append(el("span", "bt-cname", c.sel.names[i]), el("span", "bt-ctype", col.type));
      tr.append(th);
    });
    if (c.full) { const th = el("th"); th.append(el("span", "bt-cname", "variable part"), el("span", "bt-ctype", "RecordsFull")); tr.append(th); }
    thead.replaceChildren(tr);
    table.setAttribute("aria-rowcount", String(total + 1));
    paintRows();
  }
  function block(b) {
    if (!cache.has(b)) cache.set(b, rpc("rows", { from: b * BLOCK, n: BLOCK }));
    return cache.get(b);
  }
  let painting = 0;
  async function paintRows() {
    if (!cur || !total) return;
    const ticket = ++painting;
    const first = Math.max(0, Math.floor(rowsBox.scrollTop / ROW) - 4);
    const last = Math.min(total, first + Math.ceil((rowsBox.clientHeight || 320) / ROW) + 8);
    const blocks = [];
    for (let b = Math.floor(first / BLOCK); b <= Math.floor((last - 1) / BLOCK); b++) blocks.push(block(b));
    const got = await Promise.all(blocks);
    if (ticket !== painting) return;
    const width = cur.sel.columns.length + 1 + (cur.full ? 1 : 0);
    const spacer = (h) => { const tr = el("tr", "bt-spacer"); tr.setAttribute("aria-hidden", "true"); const td = el("td"); td.colSpan = width; tr.append(td); tr.style.height = `${h}px`; return tr; };
    const out = [spacer(first * ROW)];
    for (let i = first; i < last; i++) {
      const res = got[Math.floor(i / BLOCK) - Math.floor(first / BLOCK)];
      const k = i - res.from;
      const row = res.rows[k];
      if (!row) continue;
      const bad = new Set((res.bad || []).filter((x) => x[0] === i).map((x) => x[1]));
      const tr = el("tr");
      tr.setAttribute("aria-rowindex", String(i + 2));
      tr.append(el("td", "bt-num bt-rn", fmt(i + 1)));
      row.forEach((v, ci) => {
        if (bad.has(ci)) tr.append(el("td", "bt-alarm", "error"));
        else if (v === null) tr.append(el("td", "bt-null", "null"));
        else tr.append(el("td", /^-?[\d.]+$/.test(v) ? "bt-num" : null, v));
      });
      if (cur.full) {
        const t = (res.tails || [])[k];
        const td = el("td", "bt-tail", t ? `${fmt(t[0])} B · ${t[1]}` : "none");
        tr.append(td);
      }
      out.push(tr);
    }
    out.push(spacer((total - last) * ROW));
    tbody.replaceChildren(...out);
  }
  rowsBox.addEventListener("scroll", () => requestAnimationFrame(paintRows), { passive: true });

  // Export
  async function exportAs(format) {
    const c = cur;
    if (!c || !c.table) return;
    const parts = [];
    let bytes = 0;
    await rpc("export", { format, n: 0 });
    for (;;) {
      const r = await rpc("export", { format, n: 2000 });
      parts.push(r.chunk);
      bytes += r.chunk.length;
      expStatus.textContent = `Writing ${format === "csv" ? "CSV" : "JSON Lines"}: ${mib(bytes)}`;
      if (r.done) {
        const rep = r.report;
        const blob = new Blob(parts, { type: format === "csv" ? "text/csv" : "application/x-ndjson" });
        const a = el("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${c.name.replace(/\.[^.]*$/, "")}.${format}`;
        a.hidden = true;
        wrap.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        expStatus.textContent = `${a.download}: ${fmt(rep.rowsWritten)} rows written, ${fmt(rep.rowsWithErrors)} with column errors, ${fmt(blob.size)} bytes.` +
          (rep.stopped ? ` Stopped: ${rep.stopped}` : "");
        return;
      }
      if (!still()) await frame();
    }
  }

  // Drag and drop
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  wrap.addEventListener("dragover", (e) => { if (!isFiles(e)) return; e.preventDefault(); wrap.classList.add("bt-drop"); });
  wrap.addEventListener("dragleave", (e) => { if (e.target === wrap || !wrap.contains(e.relatedTarget)) wrap.classList.remove("bt-drop"); });
  wrap.addEventListener("drop", (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    wrap.classList.remove("bt-drop");
    const list = [...e.dataTransfer.files];
    if (list.length) guard(() => load(list));
  });
  pick.addEventListener("change", () => {
    const list = [...pick.files];
    if (list.length) guard(() => load(list));
  });

  new ResizeObserver(() => layout()).observe(mapWrap);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => draw());

  await cssReady;
  const first = guard(() => load(null), true);
  await Promise.race([first, shown]);
  first.catch((err) => { status.textContent = err.message; bar.classList.add("bt-idle"); });
}
