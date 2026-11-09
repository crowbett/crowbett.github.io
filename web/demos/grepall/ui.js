// grepall demo: grepall's real shard builder, regexp planner, posting lists and
// matcher, compiled to WebAssembly. The start indexes a slice of the Go standard
// library into one shard per package; every keystroke then runs three calls
// (plan, candidates, match), each timed here, and draws what each one returned.
const START = String.raw`func\s+New\w+\(`;
const PRESETS = [
  ["rare literal", "Kelvin", false],
  ["alternation", "TODO|FIXME", true],
  ["regexp", START, true],
  [".* defeats the index", ":=.*<-", true],
  ["no trigrams", "[a-z]{40}", true],
  ["repo: filter", "repo:regexp Simplify", false],
];
const ROW = 26;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const ms = (t) => `${t < 10 ? t.toFixed(1) : fmt(Math.round(t))} ms`;
const size = (b) => (b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(2)} MiB` : `${fmt(Math.round(b / 1024))} KiB`);
const showTri = (t) => t.replaceAll(" ", "␣");
const ease = (x) => 1 - Math.pow(1 - x, 3);

function hexRGB(s) {
  const h = s.trim().replace("#", "");
  const v = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const mix = (a, b, t) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
const rgb = (a) => `rgb(${a.join(",")})`;

// Crisp canvas sized to its CSS box; returns the 2D context in CSS pixels.
function fit(canvas, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  canvas.style.height = `${h}px`;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w];
}

// A vertically scrolling box that keyboard users can scroll too.
function scrollBox(label) {
  const box = el("div", "ga-scroll");
  box.tabIndex = 0;
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", label);
  return box;
}

// The simplified regexp/syntax tree, as nested lists.
function parseTree(node, more) {
  const ul = el("ul", "ga-ptree");
  const add = (n, parent) => {
    const li = el("li");
    const head = el("span", "ga-node");
    head.append(el("span", "ga-op", n.op));
    let text = "";
    if (n.op === "Literal") text = JSON.stringify(n.text);
    else if (n.op === "CharClass" || n.op === "Capture") text = n.text || "";
    else if (n.op === "Repeat") text = `{${n.min},${n.max < 0 ? "" : n.max}}`;
    if (text) head.append(el("code", "ga-lit", text));
    if (n.fold && (n.op === "Literal" || n.op === "CharClass")) head.append(el("span", "ga-fold", "fold case"));
    li.append(head);
    if (n.sub?.length) {
      const sub = el("ul");
      for (const s of n.sub) add(s, sub);
      li.append(sub);
    }
    parent.append(li);
  };
  add(node, ul);
  const box = scrollBox("Parse tree");
  box.append(ul);
  if (more) box.append(el("p", "ga-more", `+${plural(more, "node")} not shown`));
  return box;
}

// The trigram query as nested and/or groups of trigram chips.
function queryTree(q, total, more) {
  const box = scrollBox("Trigram query");
  if (q.op === "all" || q.op === "none") {
    const all = el("div", "ga-all");
    all.append(el("strong", null, q.op === "all" ? "every file" : "no file"),
      el("span", null, q.op === "all"
        ? "No trigram is required by every match, so the index cannot narrow the search: the matcher reads every file."
        : "No string can match, so no file is a candidate."));
    box.append(all);
    return box;
  }
  const group = (n) => {
    const g = el("div", "ga-g");
    g.dataset.op = n.op;
    g.append(el("span", "ga-gop", n.op === "and" ? "all of" : "any of"));
    const kids = el("div", "ga-kids");
    for (const t of n.tri || []) {
      const c = el("span", "ga-chip");
      c.title = `${t.t}: in ${plural(t.files, "file")} of ${fmt(total)}`;
      c.append(el("code", null, showTri(t.t)), el("span", "ga-fn", t.files < 0 ? "" : fmt(t.files)));
      const bar = el("i");
      if (t.files >= 0) bar.style.transform = `scaleX(${Math.max(t.files / total, 0.02)})`;
      c.append(bar);
      kids.append(c);
    }
    for (const s of n.sub || []) kids.append(group(s));
    g.append(kids);
    return g;
  };
  box.append(group(q));
  if (more) box.append(el("p", "ga-more", `+${plural(more, "trigram")} not shown`));
  return box;
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

  // Controls: the query first, so Tab from the mount reaches it.
  const form = el("form", "ga-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const q = el("input");
  Object.assign(q, { type: "text", name: "q", value: START, spellcheck: false, autocomplete: "off" });
  q.setAttribute("autocapitalize", "off");
  q.setAttribute("autocorrect", "off");
  const qField = el("label", "demo-field ga-qf");
  qField.append(el("span", "demo-label", "Query (grepall syntax: repo:, file:, case: filters work)"), q);
  const re = el("input");
  Object.assign(re, { type: "checkbox", name: "regex", checked: true });
  const reField = el("label", "demo-field ga-check");
  reField.append(el("span", "demo-label", "Regexp"), re);
  const cs = el("select");
  cs.name = "case";
  for (const [v, t] of [["auto", "smart"], ["yes", "sensitive"], ["no", "insensitive"]]) {
    const o = el("option", null, t);
    o.value = v;
    cs.append(o);
  }
  const csField = el("label", "demo-field");
  csField.append(el("span", "demo-label", "Case"), cs);
  form.append(qField, reField, csField);

  const presets = el("div", "ga-presets");
  presets.setAttribute("role", "group");
  presets.setAttribute("aria-label", "Example queries");
  for (const [label, text, regex] of PRESETS) {
    const b = el("button", "secondary");
    b.type = "button";
    b.append(el("span", "ga-pl", label), el("code", null, text));
    b.addEventListener("click", () => {
      q.value = text;
      re.checked = regex;
      cs.value = "auto";
      request();
    });
    presets.append(b);
  }

  const status = el("p", "ga-status");
  status.setAttribute("aria-live", "polite");

  // Stage 1 and 2: what the planner made of the query.
  const stages = el("div", "ga-stages");
  const panel = (n, title, sub) => {
    const f = el("section", "ga-panel");
    const h = el("h3", "ga-h");
    h.append(el("span", "ga-n", n), el("span", null, title), el("span", "ga-t", sub));
    const body = el("div", "ga-body");
    f.append(h, body);
    stages.append(f);
    return [body, h.lastChild];
  };
  const [treeBox] = panel("1", "parse", "regexp/syntax, simplified");
  const [planBox, planTime] = panel("2", "plan", "trigram query the index evaluates");

  // The funnel: files → candidates → matches, bars on a canvas.
  const funnel = el("div", "ga-funnel");
  const fcanvas = el("canvas", "ga-fc");
  fcanvas.setAttribute("aria-hidden", "true");
  const frows = ["files", "candidates", "matched"].map((name, i) => {
    const label = el("div", "ga-fl");
    label.append(el("span", "ga-fname", name), el("span", "ga-ft"));
    const count = el("div", "ga-fcount");
    count.dataset.stage = name;
    label.style.gridRow = count.style.gridRow = String(i + 1);
    funnel.append(label, count);
    return { label, count, time: label.lastChild };
  });
  funnel.append(fcanvas);

  // The file map: one square per indexed file, in corpus order.
  const mapWrap = el("div", "ga-mapw");
  const map = el("canvas", "ga-map");
  map.setAttribute("role", "img");
  const readout = el("p", "ga-readout", " ");
  const legend = el("p", "ga-legend");
  for (const [k, t] of [["off", "not a candidate"], ["cand", "candidate: has the trigrams"], ["hit", "verified match"]]) {
    const s = el("span", "ga-key", t);
    s.dataset.k = k;
    legend.append(s);
  }
  mapWrap.append(map, readout, legend);

  // Stage 3: the matches, virtualised.
  const resHead = el("h3", "ga-h ga-rh");
  resHead.append(el("span", "ga-n", "3"), el("span", null, "matches"), el("span", "ga-t"));
  const list = el("div", "ga-list");
  list.tabIndex = 0;
  list.setAttribute("role", "region");
  list.setAttribute("aria-label", "Matches");
  const spacer = el("div", "ga-spacer");
  list.append(spacer);
  const mobile = matchMedia("(max-width: 40rem)");

  const corpusNote = el("details", "ga-corpus");
  const indexNote = el("p", "ga-built");
  const receipt = el("p", "demo-out ga-out");
  root.replaceChildren(form, presets, status, stages, funnel, mapWrap, indexNote, resHead, list, corpusNote, receipt);
  await cssReady;
  // On a phone the matches come first; parse and plan follow them.
  const place = () => (mobile.matches ? corpusNote.before(mapWrap, indexNote, stages) : status.after(stages, funnel, mapWrap, indexNote, resHead, list));
  place();
  mobile.addEventListener("change", place);

  const colors = () => {
    const s = getComputedStyle(root);
    const c = {};
    for (const k of ["off", "cand", "hit", "idle", "tint", "base"]) c[k] = hexRGB(s.getPropertyValue(`--ga-${k}`) || "#888");
    return c;
  };
  let C = colors();

  // Corpus and index build: one call per shard.
  const info = await demo.call("corpus", {});
  const files = [];
  for (const p of info.packages) for (const f of p.files) files.push(`${p.name}/${f}`);
  const N = files.length;
  const sum = el("summary", null, `Corpus: ${plural(N, "file")} from ${plural(info.packages.length, "package")} of the Go standard library, BSD licence`);
  sum.tabIndex = 0;
  const about = el("p", null, info.about);
  const lic = el("pre", "ga-lic", info.license);
  corpusNote.append(sum, about, lic);

  // Per-file state: 0 not built, 1 indexed, 2 not a candidate, 3 candidate, 4 match.
  const state = new Uint8Array(N);
  const from = new Uint8Array(N);
  let animStart = 0;
  let raf = 0;
  const shade = (s) => [C.base, C.idle, C.off, C.cand, C.hit][s];
  let geo = { cols: 1, cell: 10 };
  let hover = -1;
  let sel = -1;
  function drawMap(now) {
    const w = map.clientWidth || 300;
    const cols = Math.max(16, Math.floor(w / (w < 500 ? 13 : 16)));
    const cell = w / cols;
    const rows = Math.ceil(N / cols);
    geo = { cols, cell, rows };
    const [g] = fit(map, Math.ceil(rows * cell));
    const t = reduced() ? 1 : (now - animStart) / 300;
    let more = false;
    for (let i = 0; i < N; i++) {
      const local = Math.min(Math.max((t * 300 - (i / N) * 180) / 120, 0), 1);
      if (local < 1) more = true;
      g.fillStyle = mix(shade(from[i]), shade(state[i]), ease(local));
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      const pad = Math.max(1, Math.round(cell * 0.14));
      g.fillRect(x + pad, y + pad, cell - 2 * pad, cell - 2 * pad);
      if (i === hover || i === sel) {
        g.strokeStyle = rgb(C.hit);
        g.lineWidth = 1.5;
        g.strokeRect(x + 0.75, y + 0.75, cell - 1.5, cell - 1.5);
      }
    }
    return more;
  }

  // Funnel bars, tweened from the last counts to the new ones.
  let fFrom = [N, N, N], fTo = [N, N, N], fStart = 0;
  function drawFunnel(now) {
    const rowH = frows[0].count.offsetHeight || 44;
    const gap = 6;
    const h = rowH * 3 + gap * 2;
    fcanvas.style.gridRow = "1 / span 3";
    const [g, w] = fit(fcanvas, h);
    const t = reduced() ? 1 : Math.min((now - fStart) / 300, 1);
    const vals = fFrom.map((a, i) => a + (fTo[i] - a) * ease(t));
    const bar = Math.min(18, rowH * 0.45);
    const fills = [C.idle, C.cand, C.hit];
    const span = (v) => Math.max((v / Math.max(N, 1)) * w, 2);
    for (let i = 0; i < 3; i++) {
      const y = i * (rowH + gap) + (rowH - bar) / 2;
      const bw = span(vals[i]);
      if (i < 2) {
        const nw = span(vals[i + 1]), ny = (i + 1) * (rowH + gap) + (rowH - bar) / 2;
        g.fillStyle = rgb(C.tint);
        g.beginPath();
        g.moveTo((w - bw) / 2, y + bar);
        g.lineTo((w + bw) / 2, y + bar);
        g.lineTo((w + nw) / 2, ny);
        g.lineTo((w - nw) / 2, ny);
        g.closePath();
        g.fill();
      }
      g.fillStyle = rgb(fills[i]);
      g.fillRect((w - bw) / 2, y, bw, bar);
    }
    return t < 1;
  }

  const frame = (now) => {
    raf = 0;
    const a = drawMap(now), b = drawFunnel(now);
    if (a || b) raf = requestAnimationFrame(frame);
  };
  const animate = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const setStates = (next) => {
    for (let i = 0; i < N; i++) {
      from[i] = state[i];
      state[i] = next(i);
    }
    animStart = performance.now();
    animate();
  };
  const setFunnel = (vals) => {
    const now = performance.now();
    const t = reduced() ? 1 : Math.min((now - fStart) / 300, 1);
    fFrom = fFrom.map((a, i) => a + (fTo[i] - a) * ease(t));
    fTo = vals;
    fStart = now;
    animate();
  };

  // Hover or tap a square: name the file; on a match, jump to its lines.
  let last = { cands: new Set(), hits: new Map() };
  const at = (e) => {
    const r = map.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / geo.cell), row = Math.floor((e.clientY - r.top) / geo.cell);
    const i = row * geo.cols + col;
    return col >= 0 && col < geo.cols && i >= 0 && i < N ? i : -1;
  };
  const describe = (i) => {
    if (i < 0) return " ";
    const f = last.hits.get(i);
    const what = f ? `match, ${plural(f.matches, "line")}` : last.cands.has(i) ? "candidate, no match" : state[i] >= 2 ? "not a candidate" : "indexed";
    return `${files[i]} · ${what}`;
  };
  map.addEventListener("pointermove", (e) => {
    const i = at(e);
    if (i !== hover) {
      hover = i;
      readout.textContent = describe(i === -1 ? sel : i);
      animate();
    }
  });
  map.addEventListener("pointerleave", () => {
    hover = -1;
    readout.textContent = describe(sel);
    animate();
  });
  map.addEventListener("pointerdown", (e) => {
    const i = at(e);
    sel = i;
    readout.textContent = describe(i);
    const row = rowOf.get(i);
    if (row !== undefined) list.scrollTop = row * ROW;
    renderRows();
    animate();
  });

  // Virtualised result rows: only the visible ones exist.
  let rows = [];
  let rowOf = new Map();
  const pool = [];
  function line(text, ranges) {
    let cut = 0;
    const lead = text.length - text.trimStart().length;
    const first = ranges.length ? ranges[0][0] : 0;
    cut = Math.min(lead, first);
    let prefix = "";
    if (first - cut > 40) {
      cut = first - 24;
      prefix = "…";
    }
    const frag = el("span", "ga-code");
    let pos = cut;
    if (prefix) frag.append(prefix);
    for (const [a, b] of ranges) {
      if (b <= pos) continue;
      const s = Math.max(a, pos);
      if (s > pos) frag.append(text.slice(pos, s));
      frag.append(el("mark", null, text.slice(s, b)));
      pos = b;
    }
    frag.append(text.slice(pos));
    return frag;
  }
  function renderRows() {
    const top = list.scrollTop;
    const h = list.clientHeight || 400;
    const lo = Math.max(0, Math.floor(top / ROW) - 6);
    const hi = Math.min(rows.length, Math.ceil((top + h) / ROW) + 6);
    let k = 0;
    for (let i = lo; i < hi; i++, k++) {
      let n = pool[k];
      if (!n) {
        n = el("div", "ga-row");
        pool.push(n);
        spacer.append(n);
      }
      const r = rows[i];
      n.hidden = false;
      n.style.transform = `translateY(${i * ROW}px)`;
      n.className = r.f ? `ga-row ga-file${r.f.id === sel ? " ga-sel" : ""}` : "ga-row";
      if (r.f) {
        n.replaceChildren(el("span", "ga-path", `${r.f.repo}/${r.f.path}`), el("span", "ga-cnt", plural(r.f.matches, "line")));
      } else {
        n.replaceChildren(el("span", "ga-ln", String(r.l.n)), line(r.l.text, r.l.ranges));
      }
    }
    for (; k < pool.length; k++) pool[k].hidden = true;
  }
  list.addEventListener("scroll", renderRows, { passive: true });

  function showMatches(m) {
    rows = [];
    rowOf = new Map();
    for (const f of m.files) {
      rowOf.set(f.id, rows.length);
      rows.push({ f });
      for (const l of f.lines) rows.push({ l });
    }
    const wide = rows.reduce((w, r) => Math.max(w, r.f ? `${r.f.repo}/${r.f.path}`.length + 12 : r.l.text.length + 5), 0);
    spacer.style.setProperty("height", `${rows.length * ROW}px`);
    spacer.style.setProperty("width", `calc(${wide}ch + 36px)`);
    list.style.height = `${Math.min(Math.max(rows.length, 1) * ROW, 16 * ROW)}px`;
    list.hidden = rows.length === 0;
    list.scrollTop = 0;
    renderRows();
  }

  function showError(err) {
    status.textContent = err.message;
    status.classList.add("ga-err");
    root.classList.add("ga-stale");
  }

  // One query at a time; typing faster than the pipeline keeps only the latest.
  let want = null;
  let running = false;
  const params = () => ({ q: q.value, regex: re.checked, case: cs.value });
  async function run(p) {
    const t0 = performance.now();
    let plan;
    try {
      plan = await demo.call("plan", p);
    } catch (err) {
      showError(err);
      return;
    }
    const t1 = performance.now();
    status.classList.remove("ga-err");
    treeBox.replaceChildren(plan.tree ? parseTree(plan.tree, plan.tree_more)
      : el("p", "ga-more", "No content pattern: only the filters select files."));
    planBox.replaceChildren(queryTree(plan.query, N, plan.query_more));
    planTime.textContent = `${plural(plan.trigrams, "trigram")} · ${ms(t1 - t0)}`;
    if (want) return;
    const f = await demo.call("candidates", p);
    const t2 = performance.now();
    const cands = new Set(f.ids);
    setStates((i) => (cands.has(i) ? 3 : 2));
    setFunnel([N, f.candidates, fTo[2]]);
    frows[1].count.textContent = fmt(f.candidates);
    frows[1].time.textContent = `index · ${ms(t2 - t1)}`;
    if (want) return;
    const m = await demo.call("match", p);
    const t3 = performance.now();
    const hits = new Map(m.files.map((x) => [x.id, x]));
    last = { cands, hits };
    setStates((i) => (hits.has(i) ? 4 : cands.has(i) ? 3 : 2));
    setFunnel([N, f.candidates, m.files_matched]);
    frows[2].count.textContent = `${m.truncated ? "≥" : ""}${fmt(m.files_matched)}`;
    frows[2].time.textContent = `verify · ${ms(t3 - t2)}`;
    root.classList.remove("ga-stale");
    resHead.lastChild.textContent = `${plural(m.lines_matched, "line")} in ${plural(m.files_matched, "file")}` +
      (m.truncated ? `, stopped at ${fmt(m.max_lines)} lines` : "");
    status.textContent = `${fmt(N)} files → ${plural(f.candidates, "candidate")} (${size(f.candidate_bytes)}) → ` +
      `${m.truncated ? "at least " : ""}${plural(m.files_matched, "matching file")}. ` +
      (f.full_scan ? "Full scan: the index could not rule any file out." : `The index ruled out ${fmt(N - f.candidates)} files without reading them.`);
    receipt.textContent = `Query planned, looked up in the index and verified over ${plural(f.candidates, "candidate file")} in ${ms(t3 - t0)}, in your browser.`;
    map.setAttribute("aria-label", `File map: ${fmt(N)} files, ${fmt(f.candidates)} candidates, ${fmt(m.files_matched)} matched`);
    readout.textContent = describe(sel);
    showMatches(m);
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (want) {
        const p = want;
        want = null;
        await run(p);
      }
    } catch (err) {
      showError(err);
    } finally {
      running = false;
    }
  }
  function request() {
    want = params();
    return pump();
  }
  q.addEventListener("input", request);
  re.addEventListener("change", request);
  cs.addEventListener("change", request);

  const redraw = () => {
    C = colors();
    animate();
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  new ResizeObserver(() => { animate(); renderRows(); }).observe(root);

  // Build the index, shard by shard, lighting each package's files as it lands.
  frows[0].time.textContent = "indexing…";
  frows[0].count.textContent = "0";
  let built = 0, srcBytes = 0, shardBytes = 0, trigrams = 0;
  const tb = performance.now();
  for (;;) {
    const b = await demo.call("build", {});
    for (let i = built; i < built + b.files; i++) state[i] = 1;
    built += b.files;
    srcBytes += b.bytes;
    shardBytes += b.shard_bytes;
    trigrams += b.trigrams;
    frows[0].count.textContent = fmt(built);
    status.textContent = `Indexing shard ${b.built} of ${b.total}: ${b.repo} (${plural(b.files, "file")})`;
    animate();
    if (b.ready) break;
  }
  const buildMs = performance.now() - tb;
  from.set(state);
  frows[0].time.textContent = `${plural(info.packages.length, "shard")}`;
  frows[1].count.textContent = frows[2].count.textContent = "–";
  indexNote.textContent = `Index built here in ${ms(buildMs)}: ${plural(N, "file")}, ${size(srcBytes)} of source → ` +
    `${size(shardBytes)} of shards holding ${fmt(trigrams)} trigram posting lists (per-shard counts, summed).`;
  await request();
}
