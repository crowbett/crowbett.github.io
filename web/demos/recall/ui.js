// recall demo: recall's real source parsers, redaction, Tantivy BM25 (with
// Tantivy's own score explanations), its builtin:hash vector lane and
// reciprocal rank fusion, compiled to WebAssembly over a synthetic corpus that
// ships with the bridge. Nothing here comes from a real machine.
const NS = "http://www.w3.org/2000/svg";
const ROWS = 8;
const SPEEDS = [1, 2, 4];
const TYPE_MS = 75;
const DWELL_MS = 5600;
const DROP_MS = 70;
const TWEEN_MS = 260;
const TOUR = [
  { q: "duplicate jobs lease" },
  { q: "graceful shutdown" },
  { q: "stop workers mid-flight without dropping jobs" },
  { q: "postgres password" },
  { q: "backoff jitter", src: ["git"] },
];
const NOTE = "a slow job must renew its lease or it runs twice: duplicate jobs again #leases";
const STOP = Symbol("stop");
const LANES = { b: "bm25", f: "fused", v: "vector" };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const sv = (tag, cls, attrs) => {
  const n = document.createElementNS(NS, tag);
  if (cls) n.setAttribute("class", cls);
  for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
  return n;
};
const num = (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const ms = (t) => `${t < 10 ? num(t, 1) : num(Math.round(t), 0)} ms`;
const plural = (n, a, b) => `${n.toLocaleString("en-US")} ${n === 1 ? a : b}`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const day = (d) => (typeof d === "number" ? new Date(d * 1000).toISOString() : String(d || "")).slice(0, 10);
const yours = (id) => id.startsWith("notes:/work/notes/yours-");
const trunc = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
const RED = /\[REDACTED:[^\]]*\]/g;

function field(label, input, cls) {
  const wrap = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function select(name, options, value) {
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

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

// Text with the binary's highlight ranges as <mark> and redaction markers called out.
function snippet(node, text, marks) {
  node.replaceChildren();
  const plain = (s) => {
    let at = 0;
    for (const m of s.matchAll(RED)) {
      if (m.index > at) node.append(s.slice(at, m.index));
      node.append(el("span", "rc-red", m[0]));
      at = m.index + m[0].length;
    }
    if (at < s.length) node.append(s.slice(at));
  };
  let at = 0;
  for (const [a, b] of marks || []) {
    if (a < at || b <= a) continue;
    plain(text.slice(at, a));
    node.append(el("mark", null, text.slice(a, b)));
    at = b;
  }
  plain(text.slice(at));
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
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  let indexMs = 0, queryMs = 0, lastMs = 0, queries = 0;
  const call = async (method, params) => {
    const t = performance.now();
    try {
      return await demo.call(method, params);
    } finally {
      const d = performance.now() - t;
      if (method === "ingest" || method === "note") indexMs += d;
      if (method === "search") { queryMs += d; lastMs = d; }
    }
  };
  const corpus = await call("corpus", {});
  const sources = corpus.sources.map((s) => s.source);

  // Controls.
  const qIn = el("input");
  Object.assign(qIn, { type: "search", name: "q", autocomplete: "off", spellcheck: false, placeholder: "search the corpus" });
  const go = button("Search");
  const find = el("div", "rc-find");
  find.append(field("query", qIn, "rc-q"), go);
  const chips = el("div", "rc-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Sources to search");
  const chip = new Map();
  for (const s of sources) {
    const b = button(s, "rc-chip");
    b.setAttribute("aria-pressed", "true");
    chip.set(s, b);
    chips.append(b);
  }
  const chipField = el("div", "demo-field");
  chipField.append(el("span", "demo-label", "sources"), chips);
  const mode = select("mode", [["hybrid", "hybrid: bm25 + vector"], ["bm25", "bm25 only"]], "hybrid");
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 1);
  const knobs = el("div", "rc-knobs");
  knobs.append(chipField, field("ranking", mode));
  const play = button("Pause");
  const step = button("Next query", "secondary");
  const reset = button("Reset", "secondary");
  const note = el("input");
  Object.assign(note, { type: "text", name: "note", value: NOTE, autocomplete: "off", maxLength: 400 });
  const add = button("Index my note");
  const acts = el("div", "rc-acts");
  acts.append(play, step, reset, field("tour speed", speed));
  const form = el("form", "rc-controls");
  form.append(find, knobs, acts);
  const mineRow = el("div", "rc-acts rc-mine");
  mineRow.append(field("your note", note, "rc-note"), add);

  // The index: one square per document, by source.
  const idx = el("div", "rc-index");
  idx.setAttribute("role", "img");
  const lanes = new Map();
  for (const s of sources) {
    const row = el("div", "rc-src");
    const n = el("span", "rc-sn", "0");
    const docs = el("div", "rc-docs");
    row.append(el("span", "rc-sname", s), n, docs);
    lanes.set(s, { n, docs, count: 0 });
    idx.append(row);
  }
  for (const a of corpus.absent) {
    const row = el("div", "rc-src rc-absent");
    row.append(el("span", "rc-sname", a.source), el("span", "rc-why-off", `not indexed: ${a.why}`));
    idx.append(row);
  }

  const plan = el("p", "rc-plan");
  const svg = sv("svg", "rc-svg", { role: "group" });
  const legend = el("p", "demo-legend rc-legend");
  for (const [k, t] of [["b", "bm25 lane"], ["v", `vector lane (${corpus.embedder.name})`], ["sel", "explained below"], ["you", "your note"], ["red", "secret redacted"]]) {
    const s = el("span", "rc-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const status = el("p", "rc-status");
  status.setAttribute("aria-live", "polite");

  const why = el("section", "rc-why");
  why.setAttribute("aria-live", "polite");
  const wTitle = el("h3");
  const wPath = el("p", "rc-path");
  const wSnip = el("p", "rc-snip");
  const wSum = el("p", "rc-sum");
  const wScroll = el("div", "rc-scroll");
  wScroll.setAttribute("aria-label", "BM25 score parts");
  const table = el("table", "rc-parts");
  wScroll.append(table);
  const wNote = el("p", "rc-path", `per term, Tantivy's BM25: boost × idf × (1 + k1) × tf, where idf = ln(1 + (N − n + 0.5) / (n + 0.5)), tf = freq / (freq + k1 · (1 − b + b · dl / avgdl)), k1 = 1.2, b = 0.75.`);
  why.append(wTitle, wPath, wSnip, wSum, wScroll, wNote);

  const cells = el("ul", "cells stack rc-cells");
  const cell = {};
  for (const [k, t] of [["docs", "documents"], ["terms", "terms title · body"], ["sources", "sources"], ["cands", "candidates bm25 · vec"], ["hits", "results"], ["query", "query"], ["index", "index"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "rc-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const receipt = el("p", "demo-out rc-out");
  root.replaceChildren(form, idx, plan, svg, legend, status, mineRow, why, cells, receipt);

  // State.
  let gen = 0, tourGen = 0, ti = 0, seq = 0;
  let playing = !reduce.matches, visible = true;
  let stats = null, res = null, sel = null, G = null, cw = 6, raf = 0, tween = 0;
  const squares = new Map();
  const rows = new Map();
  const lines = new Map();
  const tick = (t) => new Promise((r) => setTimeout(r, t));
  async function hold(t, g, tg) {
    for (let left = t; left > 0;) {
      await tick(40);
      if (g !== gen || (tg !== undefined && tg !== tourGen)) throw STOP;
      if (playing && visible && !document.hidden) left -= 40 * Number(speed.value);
    }
  }
  const fail = (e) => { if (e !== STOP) status.textContent = e.message; };

  function updateCells() {
    const ix = stats?.index;
    cell.docs.textContent = stats ? String(stats.docs) : "–";
    cell.terms.textContent = ix ? `${ix.title_terms} · ${ix.body_terms}` : "–";
    cell.sources.textContent = stats ? `${stats.loaded.length} of ${sources.length + corpus.absent.length}` : "–";
    cell.cands.textContent = res ? `${res.candidates.bm25} · ${res.mode === "hybrid" ? res.candidates.vector : "off"}` : "–";
    cell.hits.textContent = res ? String(res.hits.length) : "–";
    cell.query.textContent = queries ? ms(lastMs) : "–";
    cell.index.textContent = stats ? ms(indexMs) : "–";
    const red = [...squares.values()].filter((s) => s.classList.contains("is-red")).length;
    idx.setAttribute("aria-label", `Index: ${sources.map((s) => `${lanes.get(s).count} ${s}`).join(", ")} documents; ${plural(red, "document", "documents")} with a secret redacted; ${corpus.absent.map((a) => a.source).join(", ")} not indexed.`);
    if (stats) {
      receipt.textContent = `${plural(stats.docs, "document", "documents")} from ${plural(stats.loaded.length, "source", "sources")} indexed in ${ms(indexMs)}` +
        (queries ? `, ${plural(queries, "query", "queries")} ranked in ${ms(queryMs)}` : "") + ", by recall's engine in your browser.";
    }
  }

  function addDoc(card, animate) {
    const lane = lanes.get(card.source);
    const sq = el("span", "rc-doc");
    if (card.redacted) sq.classList.add("is-red");
    if (yours(card.id)) sq.classList.add("is-you");
    if (animate) sq.classList.add("is-new");
    lane.docs.append(sq);
    lane.count++;
    lane.n.textContent = String(lane.count);
    squares.set(card.id, sq);
  }

  async function ingestAll(g) {
    for (const s of sources) {
      const r = await call("ingest", { source: s });
      if (g !== gen) return;
      stats = r.stats;
      const animate = playing && !reduce.matches;
      for (const d of r.docs) {
        addDoc(d, animate);
        plan.textContent = `indexed ${s}: ${d.path}${d.redacted ? `, ${plural(d.redacted, "secret", "secrets")} redacted` : ""}`;
        updateCells();
        firstPaint();
        if (animate) await hold(DROP_MS, g);
      }
      updateCells();
    }
    plan.textContent = `${plural(stats.docs, "document", "documents")} indexed: ${stats.index.title_terms} title terms, ${stats.index.body_terms} body terms, ${stats.index.tokens.toLocaleString("en-US")} tokens.`;
  }

  // Search.
  function composed(text) {
    const on = sources.filter((s) => chip.get(s).getAttribute("aria-pressed") === "true");
    return on.length === sources.length ? text : `${text} src:${on.join(",")}`;
  }
  async function search() {
    const text = qIn.value.trim();
    if (!text || !stats) return;
    const my = ++seq;
    const g = gen;
    const q = composed(text);
    const r = await call("search", { q, limit: ROWS, top: ROWS, mode: mode.value });
    if (my !== seq || g !== gen) return;
    r.q = q;
    queries++;
    const keep = sel && (r.hits.some((h) => h.id === sel) || r.bm25.some((h) => h.id === sel) || r.vector.some((h) => h.id === sel)) && yours(sel);
    res = r;
    if (!keep) sel = (r.hits[0] || r.bm25[0] || r.vector[0])?.id ?? null;
    render();
  }

  function renderPlan() {
    plan.replaceChildren("query ", el("code", null, res.q), " → ");
    if (!res.terms.length) {
      plan.append(res.plan === "filters" ? "filters only, no text terms" : "no searchable terms");
      return;
    }
    plan.append("terms ");
    for (const t of res.terms) {
      const c = el("span", "rc-term", t.term);
      c.append(el("small", null, ` ${t.title_docs}·${t.body_docs}`));
      plan.append(c);
    }
    plan.append(` (docs with it in title·body), ${res.plan === "or" ? "no document has every term, so any term counts (OR)" : "every term required (AND)"}.`);
  }

  function summary() {
    const n = res.hits.length;
    if (!n) return `no results for ${res.q}.`;
    const both = res.hits.filter((h) => h.bm25_rank && h.vector_rank).length;
    const bo = res.hits.filter((h) => h.bm25_rank && !h.vector_rank).length;
    const vo = res.hits.filter((h) => !h.bm25_rank && h.vector_rank).length;
    let s = res.mode === "hybrid"
      ? `${plural(n, "result", "results")}: ${both} found by both lanes, ${bo} by bm25 alone, ${vo} by the vector lane alone.`
      : `${plural(n, "result", "results")} from bm25 alone; the vector lane is off.`;
    const red = res.hits.filter((h) => h.snippet.match(RED));
    if (red.length) s += ` ${red.map((h) => res.docs[h.id]?.path.split("/").pop() || h.id).join(", ")} ${red.length === 1 ? "shows" : "show"} a secret redacted before it was indexed.`;
    if (res.note) s += ` ${res.note}`;
    return s;
  }

  // Hero geometry, in CSS pixels.
  function layout() {
    const W = Math.max(300, svg.clientWidth || 300);
    const narrow = W < 560;
    const pad = narrow ? 4 : 14, gap = narrow ? 10 : 44;
    const inner = W - 2 * pad - 2 * gap;
    const side = Math.floor(inner * 0.3);
    const mid = inner - 2 * side;
    const top = 42, rowH = 37;
    G = { W, narrow, H: top + ROWS * rowH + 4, top, rowH, boxH: rowH - 6, x: { b: pad, f: pad + side + gap, v: pad + side + gap + mid + gap }, w: { b: side, f: mid, v: side } };
    svg.setAttribute("viewBox", `0 0 ${G.W} ${G.H}`);
    svg.style.height = `${G.H}px`;
  }
  function measure() {
    const t = sv("text", null, { x: -999, y: -999 });
    t.textContent = "0".repeat(20);
    const g = sv("g", "rc-row");
    g.append(t);
    svg.append(g);
    cw = (t.getComputedTextLength() || 120) / 20;
    g.remove();
  }
  const fit = (s, w, size = 10, pad = 12) => trunc(s, Math.max(4, Math.floor((w - pad) / (cw * size / 10))));

  let heads = null;
  function drawHeads() {
    if (heads) heads.remove();
    heads = sv("g");
    const sub = {
      b: `${res?.candidates.bm25 ?? 0} found · title ×2`,
      f: res ? (res.mode === "hybrid" ? `rrf, k = ${res.k}` : "bm25 order") : "",
      v: res?.mode === "bm25" ? "off in bm25 mode" : `${res?.candidates.vector ?? 0} found · ${corpus.embedder.dim}-d`,
    };
    for (const c of ["b", "f", "v"]) {
      const x = G.x[c];
      const h = sv("text", "rc-col-h", { x, y: 15 });
      h.textContent = LANES[c];
      const s = sv("text", "rc-col-s", { x, y: 29 });
      s.textContent = fit(sub[c], G.w[c], 9.5, 2);
      heads.append(h, s);
      const list = res ? (c === "b" ? res.bm25 : c === "v" ? res.vector : res.hits) : [];
      if (!list.length) {
        const e = sv("text", "rc-empty", { x, y: G.top + 16 });
        e.textContent = fit(!res ? "waiting for the index" : c === "v" && res.mode === "bm25" ? "vector lane off" : c === "b" ? "no document has the terms" : "nothing", G.w[c]);
        heads.append(e);
      }
    }
    svg.prepend(heads);
  }

  function lists() {
    if (!res) return { b: [], f: [], v: [] };
    return { b: res.bm25, f: res.hits, v: res.vector };
  }

  function rowFor(c, id) {
    const key = `${c}|${id}`;
    let r = rows.get(key);
    if (r && !r.dying) return r;
    if (r) r.g.remove();
    const g = sv("g", "rc-row", { role: "button", tabindex: "-1" });
    const box = sv("rect", "rc-box", { x: 0, y: 0, height: G.boxH, width: G.w[c] });
    const l1 = sv("text", null, { x: 6, y: 13 });
    const val = sv("text", "rc-val", { x: G.w[c] - 6, y: 13 });
    const l2 = sv("text", "rc-meta", { x: 6, y: 25 });
    const bb = sv("rect", "rc-bar-b", { x: 0, y: G.boxH - 3, height: 3, width: 0 });
    const bv = sv("rect", "rc-bar-v", { x: 0, y: G.boxH - 3, height: 3, width: 0 });
    g.append(box, l1, val, l2, bb, bv);
    g.addEventListener("click", () => choose(id, c));
    g.addEventListener("keydown", (e) => keys(e, c, id));
    svg.append(g);
    r = { g, box, l1, val, l2, bb, bv, c, id, y: null, y0: 0, y1: 0, o0: 0, o1: 1, o: 0 };
    rows.set(key, r);
    return r;
  }

  function fillRow(r, item, i, list) {
    const d = res.docs[r.id] || {};
    const w = G.w[r.c];
    const src = d.source || "";
    r.g.classList.toggle("is-you", yours(r.id));
    r.box.setAttribute("width", w);
    r.val.setAttribute("x", w - 6);
    let label;
    if (r.c === "f") {
      const b = item.bm25_rank ? `#${item.bm25_rank}` : "–";
      const v = item.vector_rank ? `#${item.vector_rank}` : "–";
      const score = res.mode === "hybrid" ? num(item.score, 4) : num(item.score, 2);
      r.val.textContent = score;
      r.val.setAttribute("y", 25);
      r.l1.textContent = fit(`${i + 1}. ${d.title || item.title}`, w, 10, 10);
      r.l1.setAttribute("class", "rc-title");
      const lanes2 = G.narrow ? `b${b} v${v}` : `bm25 ${b} · vec ${v}`;
      r.l2.textContent = fit(res.mode === "hybrid" ? `${G.narrow ? "" : `${src} · `}${lanes2}` : `${src} · bm25 ${b}`, w - score.length * cw - 6, 9.5);
      const full = res.mode === "hybrid" ? 2 / (res.k + 1) : list[0].score;
      const pb = res.mode === "hybrid" ? (item.rrf?.bm25 || 0) : item.score;
      const pv = res.mode === "hybrid" ? (item.rrf?.vector || 0) : 0;
      r.bb.setAttribute("width", Math.max(0, (pb / full) * w));
      r.bv.setAttribute("x", (pb / full) * w);
      r.bv.setAttribute("width", Math.max(0, (pv / full) * w));
      label = `Result ${i + 1}: ${d.title}, ${src}, ${res.mode === "hybrid" ? `fused score ${score}, bm25 rank ${b}, vector rank ${v}` : `bm25 score ${score}`}`;
    } else {
      const v = r.c === "b" ? num(item.score, 2) : num(item.cosine, 3);
      const max = r.c === "b" ? list[0].score : Math.max(list[0].cosine, 1e-9);
      const frac = Math.max(0, (r.c === "b" ? item.score : item.cosine) / max);
      r.val.textContent = v;
      r.l1.textContent = fit(G.narrow ? `#${item.rank}` : `#${item.rank} ${src}`, w - v.length * cw - 8);
      r.l1.removeAttribute("class");
      r.l2.textContent = fit(d.title || r.id, w, 9.5);
      const bar = r.c === "b" ? r.bb : r.bv;
      bar.setAttribute("x", 0);
      bar.setAttribute("width", frac * w);
      (r.c === "b" ? r.bv : r.bb).setAttribute("width", 0);
      label = `${LANES[r.c]} rank ${item.rank}: ${d.title}, ${src}, ${r.c === "b" ? "score" : "cosine"} ${v}`;
    }
    r.g.setAttribute("aria-label", label);
  }

  function render() {
    if (!G) layout();
    renderPlan();
    drawHeads();
    const L = lists();
    const now = performance.now();
    const live = new Set();
    for (const c of ["b", "f", "v"]) {
      L[c].forEach((item, i) => {
        const r = rowFor(c, item.id);
        live.add(`${c}|${item.id}`);
        fillRow(r, item, i, L[c]);
        const y = G.top + i * G.rowH;
        if (r.y === null) { r.y = y + 12; r.o = 0; }
        r.y0 = r.y; r.y1 = y; r.o0 = r.o; r.o1 = 1;
      });
    }
    for (const [k, r] of rows) {
      if (!live.has(k)) { r.dying = true; r.y0 = r.y; r.y1 = r.y; r.o0 = r.o; r.o1 = 0; }
    }
    const want = new Set();
    for (const h of L.f) {
      for (const c of ["b", "v"]) {
        if (!rows.has(`${c}|${h.id}`) || !live.has(`${c}|${h.id}`)) continue;
        const k = `${c}|${h.id}`;
        want.add(k);
        if (!lines.has(k)) {
          const p = sv("path", `rc-line rc-line-${c}`);
          svg.insertBefore(p, heads.nextSibling);
          lines.set(k, p);
        }
      }
    }
    for (const [k, p] of lines) if (!want.has(k)) { p.remove(); lines.delete(k); }
    tween = reduce.matches ? now - TWEEN_MS : now;
    markSelection();
    squaresFor();
    status.textContent = summary();
    svg.setAttribute("aria-label", `Ranking for ${res.q}: ${res.candidates.bm25} bm25 candidates${res.mode === "hybrid" ? ` and ${res.candidates.vector} vector candidates` : ""} fused into ${plural(res.hits.length, "result", "results")}. Arrow keys move between rows, Enter explains one.`);
    updateCells();
    explain().catch(fail);
    kick();
  }

  function frame(ts) {
    raf = 0;
    const p = ease((ts - tween) / TWEEN_MS);
    for (const [k, r] of rows) {
      r.y = r.y0 + (r.y1 - r.y0) * p;
      r.o = r.o0 + (r.o1 - r.o0) * p;
      r.g.setAttribute("transform", `translate(${G.x[r.c]} ${r.y.toFixed(1)})`);
      r.g.style.opacity = String(r.o);
      if (r.dying && p >= 1) { r.g.remove(); rows.delete(k); }
    }
    for (const [k, path] of lines) {
      const [c, id] = [k[0], k.slice(2)];
      const a = rows.get(k), f = rows.get(`f|${id}`);
      if (!a || !f) continue;
      const ya = a.y + G.boxH / 2, yf = f.y + G.boxH / 2;
      const xa = c === "b" ? G.x.b + G.w.b : G.x.v;
      const xf = c === "b" ? G.x.f : G.x.f + G.w.f;
      const mx = (xa + xf) / 2;
      path.setAttribute("d", `M${xa} ${ya.toFixed(1)}C${mx} ${ya.toFixed(1)} ${mx} ${yf.toFixed(1)} ${xf} ${yf.toFixed(1)}`);
      path.style.opacity = String(Math.min(a.o, f.o));
    }
    if (p < 1) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function markSelection() {
    let focusable = null;
    for (const r of rows.values()) {
      const on = r.id === sel && !r.dying;
      r.g.classList.toggle("is-sel", on);
      r.g.setAttribute("aria-pressed", String(on));
      r.g.setAttribute("tabindex", "-1");
      if (on && (!focusable || r.c === "f")) focusable = r;
    }
    focusable = focusable || [...rows.values()].find((r) => !r.dying);
    focusable?.g.setAttribute("tabindex", "0");
    for (const [k, p] of lines) p.classList.toggle("is-sel", k.slice(2) === sel);
    for (const [id, sq] of squares) sq.classList.toggle("is-hit", id === sel);
  }

  function squaresFor() {
    const b = new Set(res.bm25.map((x) => x.id));
    const v = new Set(res.vector.map((x) => x.id));
    const on = sources.filter((s) => chip.get(s).getAttribute("aria-pressed") === "true");
    for (const [id, sq] of squares) {
      sq.classList.toggle("is-b", b.has(id));
      sq.classList.toggle("is-v", v.has(id));
      sq.classList.toggle("is-off", !on.includes(id.split(":")[0]));
    }
  }

  function choose(id, c) {
    sel = id;
    markSelection();
    const r = rows.get(`${c}|${id}`) || rows.get(`f|${id}`);
    r?.g.focus({ preventScroll: true });
    explain().catch(fail);
  }

  function keys(e, c, id) {
    const L = lists();
    const order = ["b", "f", "v"];
    const at = L[c].findIndex((x) => x.id === id);
    let nc = c, ni = at;
    if (e.key === "ArrowDown") ni = Math.min(L[c].length - 1, at + 1);
    else if (e.key === "ArrowUp") ni = Math.max(0, at - 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const step = e.key === "ArrowLeft" ? -1 : 1;
      for (let k = order.indexOf(c) + step; k >= 0 && k < 3; k += step) {
        if (L[order[k]].length) { nc = order[k]; break; }
      }
      const same = L[nc].findIndex((x) => x.id === id);
      ni = same >= 0 ? same : Math.min(at, L[nc].length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(id, c);
      return;
    } else return;
    e.preventDefault();
    const item = L[nc][ni];
    if (item) choose(item.id, nc);
  }

  // Why this rank: the selected document's lanes, fusion and BM25 parts, all from the binary.
  let exSeq = 0;
  async function explain() {
    const my = ++exSeq;
    if (!res || !sel) { why.hidden = true; return; }
    why.hidden = false;
    const id = sel;
    const d = res.docs[id] || {};
    const hit = res.hits.find((h) => h.id === id);
    const b = res.bm25.find((x) => x.id === id);
    const v = res.vector.find((x) => x.id === id);
    wTitle.textContent = d.title || id;
    wPath.textContent = `${d.path} · ${d.source} · ${day(d.date)}${yours(id) ? " · your note" : ""}${d.redacted ? ` · ${plural(d.redacted, "secret", "secrets")} redacted` : ""}`;
    wSum.replaceChildren();
    const bRank = hit?.bm25_rank ?? b?.rank ?? null;
    const vRank = hit?.vector_rank ?? v?.rank ?? null;
    if (hit && res.mode === "hybrid") {
      const part = (cls, r, val) => (r ? el("span", cls, `1/(${res.k} + ${r}) = ${num(val, 4)}`) : el("span", cls, "0, not a candidate"));
      wSum.append(`result ${res.hits.indexOf(hit) + 1}, rrf: bm25 `, part("rc-b", hit.bm25_rank, hit.rrf.bm25), " + vector ", part("rc-v", hit.vector_rank, hit.rrf.vector), ` = ${num(hit.score, 4)}`);
    } else if (hit) {
      wSum.append(`result ${res.hits.indexOf(hit) + 1}, bm25 score ${num(hit.score, 2)}`);
    } else {
      wSum.append(`not in the top ${ROWS} results; bm25 rank ${bRank ? `#${bRank}` : "–"}${res.mode === "hybrid" ? `, vector rank ${vRank ? `#${vRank}` : "–"}` : ""}`);
    }
    if (v) wSum.append(el("br"), el("span", "rc-v", `vector #${v.rank} of ${res.candidates.vector}, cosine ${num(v.cosine, 3)}`));
    if (hit) snippet(wSnip, hit.snippet, hit.marks);
    else {
      wSnip.textContent = "";
      const full = await call("doc", { id });
      if (my !== exSeq) return;
      snippet(wSnip, trunc(full.body || "", 280), []);
    }
    const parts = res.parts[id];
    wScroll.hidden = wNote.hidden = !parts;
    if (!parts) return;
    table.replaceChildren();
    const head = el("thead");
    const hr = el("tr");
    for (const t of ["field", "term", "n / N", "freq", "dl / avgdl", "idf", "tf", "score"]) {
      const th = el("th", null, t);
      th.scope = "col";
      hr.append(th);
    }
    head.append(hr);
    const body = el("tbody");
    for (const p of parts) {
      const tr = el("tr");
      const cellsFor = p.kind === "term"
        ? [`${p.field} ×${num(p.boost, 0)}`, p.term, `${p.n} / ${p.N}`, num(p.freq, 0), `${num(p.dl, 0)} / ${num(p.avgdl, 1)}`, num(p.idf, 3), num(p.tf, 3), num(p.score, 3)]
        : [p.label, "", "", "", "", "", "", num(p.score, 3)];
      for (const t of cellsFor) tr.append(el("td", null, t));
      body.append(tr);
    }
    table.append(head, body);
    const score = b?.score ?? (res.mode === "bm25" ? hit?.score : undefined);
    if (score !== undefined) {
      const foot = el("tfoot");
      const tr = el("tr");
      const label = el("td", null, `bm25 score, rank #${bRank}`);
      label.colSpan = 7;
      tr.append(label, el("td", null, num(score, 3)));
      foot.append(tr);
      table.append(foot);
    }
  }

  // The tour types its queries, searching at each word, and holds on the ranking.
  function setChips(on) {
    for (const [s, b] of chip) b.setAttribute("aria-pressed", String(!on || on.includes(s)));
  }
  async function typeStep(t, g, tg, animate) {
    setChips(t.src);
    if (!animate) {
      qIn.value = t.q;
      await search();
      return;
    }
    qIn.value = "";
    for (const ch of t.q) {
      qIn.value += ch;
      if (ch === " ") await search();
      await hold(TYPE_MS, g, tg);
    }
    await search();
  }
  async function tour(g, tg) {
    try {
      for (;;) {
        await hold(400, g, tg);
        await typeStep(TOUR[ti++ % TOUR.length], g, tg, true);
        await hold(DWELL_MS, g, tg);
      }
    } catch (e) {
      fail(e);
    }
  }
  function restartTour() {
    tourGen++;
    tour(gen, tourGen);
  }
  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
  }
  function takeOver() {
    if (playing) setPlaying(false);
    restartTour();
  }

  let firstPaint = () => {};
  const painted = new Promise((r) => { firstPaint = r; });
  async function start() {
    gen++;
    const g = gen;
    indexMs = queryMs = lastMs = queries = 0;
    stats = res = sel = null;
    seq++;
    for (const r of rows.values()) r.g.remove();
    for (const p of lines.values()) p.remove();
    rows.clear(); lines.clear(); squares.clear();
    for (const lane of lanes.values()) { lane.docs.replaceChildren(); lane.count = 0; lane.n.textContent = "0"; }
    why.hidden = true;
    qIn.value = "";
    status.textContent = "";
    ti = 0;
    if (!G) layout();
    drawHeads();
    updateCells();
    await ingestAll(g);
    if (g !== gen) return;
    if (!playing) await typeStep(TOUR[ti++], g, tourGen, false);
    restartTour();
  }

  // Inputs.
  form.addEventListener("submit", (e) => { e.preventDefault(); takeOver(); search().catch(fail); });
  go.addEventListener("click", () => { takeOver(); search().catch(fail); });
  let typing = 0;
  qIn.addEventListener("input", () => {
    takeOver();
    clearTimeout(typing);
    typing = setTimeout(() => search().catch(fail), 140);
  });
  for (const [s, b] of chip) b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") === "true";
    if (on && [...chip.values()].filter((x) => x.getAttribute("aria-pressed") === "true").length === 1) {
      status.textContent = `${s} is the only source left; turn another on first.`;
      return;
    }
    b.setAttribute("aria-pressed", String(!on));
    takeOver();
    search().catch(fail);
  });
  mode.addEventListener("change", () => search().catch(fail));
  play.addEventListener("click", () => { setPlaying(!playing); if (playing) restartTour(); });
  step.addEventListener("click", () => {
    setPlaying(false);
    restartTour();
    typeStep(TOUR[ti++ % TOUR.length], gen, tourGen, false).catch(fail);
  });
  reset.addEventListener("click", async () => {
    try {
      gen++;
      await call("reset", {});
      await start();
    } catch (e) { fail(e); }
  });
  async function addNote() {
    takeOver();
    const g = gen;
    const r = await call("note", { text: note.value });
    if (g !== gen) return;
    stats = r.stats;
    for (const d of r.docs) addDoc(d, !reduce.matches);
    const mine = r.docs[0]?.id;
    if (!qIn.value.trim()) qIn.value = TOUR[0].q;
    if (mine) sel = mine;
    await search();
    const found = res && mine && [...res.hits, ...res.bm25, ...res.vector].some((x) => x.id === mine);
    status.textContent = `your note is ${r.docs[0]?.path}, document ${stats.docs}; ${found ? "it is in the ranking above" : `it is not in the top ${ROWS} for this query`}. ${summary()}`;
  }
  add.addEventListener("click", () => addNote().catch(fail));
  note.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addNote().catch(fail); } });

  new ResizeObserver(() => {
    if (!root.isConnected) return;
    const w = svg.clientWidth;
    if (G && Math.abs(w - G.W) < 1) return;
    layout();
    for (const r of rows.values()) { r.g.remove(); }
    for (const p of lines.values()) p.remove();
    rows.clear(); lines.clear();
    if (res) render(); else drawHeads();
  }).observe(svg);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(root);
  reduce.addEventListener("change", () => { if (reduce.matches) setPlaying(false); });

  await cssReady;
  measure();
  layout();
  setPlaying(playing);
  start().catch(fail);
  await painted;
}
