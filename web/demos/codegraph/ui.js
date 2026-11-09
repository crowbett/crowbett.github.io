// codegraph demo: codegraph's real indexer, resolver and SQLite graph, compiled to
// WebAssembly. A four-file Rust sample is indexed in the tab and drawn from the binary's
// callees answers; picking a symbol ripples out hop by hop, one call-tree query per node
// per hop, and a tour walks the graph along the edges the binary returned.
const START = "src/main.rs:32";
const NS = "http://www.w3.org/2000/svg";
const NODE_H = 22;
const SETTLE_MS = 900;
const HOP_MS = 260;
const MOVE_MS = 260;
const DWELL_MS = 2600;
const DEPTHS = [[1, "1"], [2, "2"], [3, "3"], [8, "all"]];
const WAYS = [["both", "both ways"], ["callers", "callers"], ["callees", "callees"]];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const sv = (tag, cls, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  if (cls) n.setAttribute("class", cls);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const ms = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
const r1 = (v) => Math.round(v * 10) / 10;

function field(label, input, cls) {
  const wrap = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}
function choice(name, options, value) {
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
// A small seeded generator, so the layout is the same on every load.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  // The sample, indexed by the binary on its first call, and the graph from one callees query per function.
  const t0 = performance.now();
  const info = await demo.call("sample", {});
  const indexMs = performance.now() - t0;
  const prefix = `${info.root}/`;
  const rel = (p) => (p && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  const specOf = (n) => `${rel(n.file)}:${n.line}`;
  const files = new Map(info.files.map((f) => [f.path, f]));
  const nodes = new Map();
  info.files.forEach((f, fi) => {
    for (const s of f.symbols) {
      nodes.set(s.spec, { ...s, fi, file: f.path, label: s.owner ? `${s.owner}::${s.name}` : s.name, qname: s.name, x: 0, y: 0, w: 0 });
    }
  });
  const list = [...nodes.values()];
  const t1 = performance.now();
  const answers = await Promise.all(list.map((n) => demo.call("callees", { symbol: n.spec })));
  const mapMs = performance.now() - t1;
  const edges = new Map();
  answers.forEach((a, i) => {
    const r = a.roots[0];
    const from = list[i].spec;
    list[i].qname = r.qname;
    list[i].sig = r.signature || "";
    for (const c of r.children || []) {
      if (!c.qname || !nodes.has(specOf(c))) continue;
      const to = specOf(c);
      edges.set(`${from}>${to}`, { from, to, conf: c.confidence || "", bend: 0.14 });
    }
  });

  // Rank: the longest call chain reaching each function, so calls flow one way.
  const preds = new Map(list.map((n) => [n.spec, []]));
  for (const e of edges.values()) if (e.from !== e.to) preds.get(e.to).push(e.from);
  const rank = new Map();
  const rankOf = (s, stack = new Set()) => {
    if (rank.has(s)) return rank.get(s);
    if (stack.has(s)) return 0;
    stack.add(s);
    const v = Math.max(0, ...preds.get(s).map((p) => rankOf(p, stack) + 1));
    stack.delete(s);
    rank.set(s, v);
    return v;
  };
  for (const n of list) n.rank = rankOf(n.spec);

  // Controls.
  const form = el("form", "cg-controls");
  form.addEventListener("submit", (e) => { e.preventDefault(); jump(); });
  const search = el("input");
  Object.assign(search, { type: "search", name: "symbol", placeholder: "e.g. bump or Store::set", autocomplete: "off", spellcheck: false });
  search.setAttribute("list", "cg-names");
  const names = el("datalist");
  names.id = "cg-names";
  for (const n of list) { const o = el("option"); o.value = n.qname; names.append(o); }
  const go = button("Go");
  go.type = "submit";
  const find = el("div", "cg-find");
  find.append(field("jump to a symbol", search, "cg-search"), go, names);
  const play = button("Pause");
  const next = button("Next", "secondary");
  const reset = button("Reset", "secondary");
  const ways = choice("ripple", WAYS, "both");
  const depth = choice("depth", DEPTHS, 8);
  const acts = el("div", "cg-acts");
  acts.append(play, next, reset, field("ripple", ways), field("hops", depth));
  form.append(find, acts);

  const svg = sv("svg", "cg-svg", { role: "group" });
  svg.setAttribute("aria-label", `Call graph of the sample: ${plural(list.length, "function", "functions")} in ${plural(info.files.length, "file", "files")}, arrows from caller to callee. Arrow keys move between functions, Enter walks from one.`);
  const gBox = sv("g"), gEdge = sv("g"), gVia = sv("g"), gFlow = sv("g"), gNode = sv("g");
  svg.append(gBox, gEdge, gVia, gFlow, gNode);

  const legend = el("p", "demo-legend cg-legend");
  for (const [k, t] of [["focus", "picked"], ["up", "caller"], ["down", "callee"], ["likely", "likely edge"], ["via", "via trait"], ["hop", "↑2 ↓1 hops away"]]) {
    const s = el("span", "cg-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const summary = el("p", "cg-summary");
  summary.setAttribute("aria-live", "polite");
  const sig = el("p", "cg-sig");
  const status = el("p", "cg-status");
  status.setAttribute("aria-live", "polite");

  const cells = el("ul", "cells stack cg-cells");
  const cell = {};
  for (const [k, t] of [["symbols", "symbols"], ["functions", "functions"], ["edges", "edges"], ["callers", "callers reached"],
    ["callees", "callees reached"], ["unresolved", "unresolved"], ["depth", "depth reached"], ["query", "query time"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "cg-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  cell.symbols.textContent = String(info.counts.symbols);
  cell.functions.textContent = String(list.length);
  cell.edges.textContent = String(info.counts.edges);

  const lists = {};
  const cols = el("div", "cg-cols");
  for (const [dir, title] of [["callers", "callers, one hop"], ["callees", "callees, one hop"]]) {
    const sec = el("section", "cg-col");
    const h = el("h3", "demo-label", title);
    h.id = `cg-${dir}`;
    const ul = el("ul", "cg-edges");
    ul.setAttribute("aria-labelledby", h.id);
    sec.append(h, ul);
    cols.append(sec);
    lists[dir] = ul;
  }
  const codeHead = el("p", "demo-label cg-code-head");
  const code = el("pre", "cg-code");
  code.tabIndex = 0;
  code.setAttribute("role", "region");
  const c = info.counts;
  const foot = el("p", "cg-foot",
    `Indexed in this tab: ${plural(info.files.length, "file", "files")}, ${c.symbols} symbols, ` +
      `${c.edges} edges (imports excluded), ${c.resolved} resolved to a definition: ` +
      `${c.exact} exact, ${c.likely} likely, ${c.name_only} name_only.`);
  const receipt = el("p", "demo-out cg-out");
  root.replaceChildren(form, svg, legend, summary, sig, status, cells, cols, codeHead, code, foot, receipt);

  await cssReady;
  const mono = getComputedStyle(root).getPropertyValue("--mono").trim() || "monospace";
  try { await document.fonts.load(`600 11px ${mono}`); } catch { /* measure with the fallback */ }
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `600 11px ${mono}`;

  // Nodes and boxes.
  const groups = info.files.map((f, i) => ({ path: f.path, nodes: list.filter((n) => n.fi === i), box: null }));
  for (const g of groups) {
    g.rect = sv("rect", "cg-box");
    g.title = sv("text", "cg-box-t");
    g.title.textContent = g.path;
    gBox.append(g.rect, g.title);
  }
  for (const n of list) {
    n.w = Math.ceil(meas.measureText(n.label).width) + 16;
    n.g = sv("g", "cg-node", { role: "button", tabindex: "-1", "aria-pressed": "false" });
    n.g.setAttribute("aria-label", `${n.qname}, ${n.file} line ${n.line}`);
    n.g.dataset.spec = n.spec;
    n.rect = sv("rect", null, { width: n.w, height: NODE_H });
    n.text = sv("text", "cg-name", { x: n.w / 2, y: NODE_H / 2 });
    n.text.textContent = n.label;
    n.hopT = sv("text", "cg-hop", { x: n.w, y: -4 });
    n.g.append(n.rect, n.text, n.hopT);
    gNode.append(n.g);
    n.g.addEventListener("click", () => { setPlaying(false); walk(n.spec, "node").catch(fail); });
    n.g.addEventListener("pointerenter", () => hot(n, true));
    n.g.addEventListener("pointerleave", () => hot(n, false));
  }
  list[0].g.tabIndex = 0;
  for (const e of edges.values()) {
    e.path = sv("path", `cg-e${e.conf === "likely" ? " cg-likely" : ""}`);
    e.head = sv("path", "cg-head");
    gEdge.append(e.path, e.head);
  }
  function hot(n, on) {
    for (const e of edges.values()) if (e.from === n.spec || e.to === n.spec) { e.path.classList.toggle("is-hot", on); e.head.classList.toggle("is-hot", on); }
  }

  // Layout: each file is a box; inside it a seeded force simulation pulls functions toward
  // their rank (callers before callees) and pushes labels apart. Frames are kept, so the
  // settle on arrival replays the simulation itself.
  let L = null;
  function layout(W) {
    const M = 8, PAD = 10, TOP = 22, GAP = 34, VGAP = 12;
    const strip = W < 480;
    const [first, ...rest] = groups;
    // Stacked under a strip, the files the first one calls most come first, so those edges stay short.
    if (strip) {
      const links = (g) => [...edges.values()].filter((e) => g.nodes.some((n) => n.spec === e.to) && first.nodes.some((n) => n.spec === e.from)).length;
      rest.sort((a, z) => links(z) - links(a));
    }
    const widest = Math.max(Math.ceil(meas.measureText(first.path).width * 0.92) + 8, ...first.nodes.map((n) => n.w));
    for (let scale = 1, attempt = 0; attempt < 8; attempt++, scale *= 1.18) {
      let y = M, rx = M;
      if (strip) {
        const h = TOP + PAD * 2 + NODE_H + 8;
        first.box = { x: M, y: M, w: W - 2 * M, h };
        y += h + 24;
      } else {
        rx = M + widest + 2 * PAD + GAP;
      }
      const rw = W - rx - M;
      for (const g of rest) {
        const area = g.nodes.reduce((a, n) => a + (n.w + 22) * (NODE_H + 24), 0) * 1.45 * scale;
        const h = Math.max(TOP + PAD * 2 + NODE_H * 2 + 20, Math.round(area / (rw - 2 * PAD)) + TOP + PAD * 2);
        g.box = { x: rx, y, w: rw, h };
        y += h + VGAP;
      }
      const H = y - VGAP + M;
      if (!strip) first.box = { x: M, y: M, w: widest + 2 * PAD, h: H - 2 * M };
      for (const g of groups) {
        const b = g.box;
        b.ix = b.x + PAD; b.iy = b.y + TOP; b.iw = b.w - 2 * PAD; b.ih = b.h - TOP - PAD;
        b.axis = b.iw >= b.ih ? "x" : "y";
      }
      const frames = simulate();
      if (crowded() && attempt < 7) continue;
      // Trim each box to what its functions use, closing the gaps (frames move with them).
      const move = new Map();
      let shift = 0;
      for (const g of rest) {
        const b = g.box, ys = g.nodes.map((n) => n.y);
        const top = Math.max(b.iy, Math.min(...ys) - NODE_H / 2 - 12), bottom = Math.max(...ys) + NODE_H / 2;
        const dy = shift + (top - b.iy), h = Math.round(TOP + (bottom - top) + PAD);
        for (const n of g.nodes) move.set(n, [dy, 1, 0]);
        shift += b.h - h;
        b.y -= dy - (top - b.iy); b.iy = b.y + TOP; b.h = h; b.ih = h - TOP - PAD;
      }
      const H2 = H - shift;
      if (!strip) {
        const b = first.box, k = (H2 - 2 * M - TOP - PAD - NODE_H) / Math.max(1, b.ih - NODE_H);
        for (const n of first.nodes) move.set(n, [0, k, b.iy + NODE_H / 2]);
        b.h = H2 - 2 * M; b.ih = b.h - TOP - PAD;
      }
      for (const f of frames) {
        list.forEach((n, j) => {
          const [dy, k, o] = move.get(n) || [0, 1, 0];
          f[2 * j + 1] = k === 1 ? f[2 * j + 1] - dy : o + (f[2 * j + 1] - o) * k;
        });
      }
      return { W, H: H2, frames };
    }
    return null;
  }
  function simulate() {
    const rand = rng(7);
    for (const g of groups) {
      const b = g.box;
      const ranks = [...new Set(g.nodes.map((n) => n.rank))].sort((a, z) => a - z);
      for (const n of g.nodes) {
        const k = ranks.indexOf(n.rank), f = ranks.length === 1 ? 0.5 : k / (ranks.length - 1);
        n.box = b;
        n.tx = b.axis === "x" ? b.ix + n.w / 2 + f * (b.iw - n.w) : b.ix + b.iw / 2;
        n.ty = b.axis === "y" ? b.iy + NODE_H / 2 + f * (b.ih - NODE_H) : b.iy + b.ih / 2;
        n.x = b.ix + b.iw / 2 + (rand() - 0.5) * b.iw * 0.5;
        n.y = b.iy + b.ih / 2 + (rand() - 0.5) * b.ih * 0.5;
      }
    }
    const frames = [];
    const N = 180;
    const es = [...edges.values()].map((e) => [nodes.get(e.from), nodes.get(e.to)]);
    for (let i = 0; i < N; i++) {
      const a = Math.pow(1 - i / N, 1.4);
      for (const n of list) {
        const b = n.box;
        n.fx = (b.axis === "x" ? (n.tx - n.x) * 0.12 : (b.ix + b.iw / 2 - n.x) * 0.02);
        n.fy = (b.axis === "y" ? (n.ty - n.y) * 0.12 : (b.iy + b.ih / 2 - n.y) * 0.02);
      }
      for (const [A, B] of es) {
        if (A === B) continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        if (A.box === B.box) {
          const d = Math.hypot(dx, dy) || 1, k = ((d - (A.w + B.w) / 2 - 24) / d) * 0.03;
          A.fx += dx * k; A.fy += dy * k; B.fx -= dx * k; B.fy -= dy * k;
        } else {
          if (A.box.axis === "x") A.fy += dy * 0.01;
          if (B.box.axis === "x") B.fy -= dy * 0.01;
          if (A.box.axis === "y") A.fx += dx * 0.004;
          if (B.box.axis === "y") B.fx -= dx * 0.004;
        }
      }
      for (const n of list) { n.x += n.fx * a; n.y += n.fy * a; }
      for (let pass = 0; pass < 3; pass++) {
        for (let p = 0; p < list.length; p++) {
          for (let q = p + 1; q < list.length; q++) {
            const A = list[p], B = list[q];
            if (A.box !== B.box) continue;
            const dx = B.x - A.x, dy = B.y - A.y;
            const ox = (A.w + B.w) / 2 + 16 - Math.abs(dx), oy = NODE_H + 20 - Math.abs(dy);
            if (ox <= 0 || oy <= 0) continue;
            if (ox < oy) { const s = (dx > 0 || (dx === 0 && p < q) ? 1 : -1) * ox / 2; A.x -= s; B.x += s; }
            else { const s = (dy > 0 || (dy === 0 && p < q) ? 1 : -1) * oy / 2; A.y -= s; B.y += s; }
          }
        }
        for (const n of list) {
          const b = n.box;
          n.x = Math.min(b.ix + b.iw - n.w / 2, Math.max(b.ix + n.w / 2, n.x));
          n.y = Math.min(b.iy + b.ih - NODE_H / 2, Math.max(b.iy + NODE_H / 2, n.y));
        }
      }
      const f = new Float32Array(list.length * 2);
      list.forEach((n, j) => { f[2 * j] = n.x; f[2 * j + 1] = n.y; });
      frames.push(f);
    }
    return frames;
  }
  function crowded() {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const A = list[p], B = list[q];
        if (A.box === B.box && Math.abs(B.x - A.x) < (A.w + B.w) / 2 + 8 && Math.abs(B.y - A.y) < NODE_H + 12) return true;
      }
    }
    return false;
  }
  function frameAt(f) {
    const F = L.frames, i = Math.min(F.length - 1, Math.floor(f)), j = Math.min(F.length - 1, i + 1), t = f - i;
    list.forEach((n, k) => {
      n.x = F[i][2 * k] + (F[j][2 * k] - F[i][2 * k]) * t;
      n.y = F[i][2 * k + 1] + (F[j][2 * k + 1] - F[i][2 * k + 1]) * t;
    });
    place();
  }

  // Geometry: a slightly bent curve between the two labels' borders, with an arrowhead.
  function geo(A, B, bend) {
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const edge = (n) => Math.min(n.w / 2 / Math.max(Math.abs(ux), 1e-6), NODE_H / 2 / Math.max(Math.abs(uy), 1e-6));
    const ta = edge(A) + 2, tb = edge(B) + 3;
    const sx = A.x + ux * ta, sy = A.y + uy * ta, ex = B.x - ux * tb, ey = B.y - uy * tb;
    const len = Math.max(1, d - ta - tb);
    const cx = (sx + ex) / 2 - uy * len * bend, cy = (sy + ey) / 2 + ux * len * bend;
    const vl = Math.hypot(ex - cx, ey - cy) || 1, vx = (ex - cx) / vl, vy = (ey - cy) / vl;
    return {
      d: `M${r1(sx)},${r1(sy)}Q${r1(cx)},${r1(cy)} ${r1(ex)},${r1(ey)}`,
      head: `M${r1(ex)},${r1(ey)}L${r1(ex - vx * 7 - vy * 3.5)},${r1(ey - vy * 7 + vx * 3.5)}L${r1(ex - vx * 7 + vy * 3.5)},${r1(ey - vy * 7 - vx * 3.5)}Z`,
    };
  }
  let vias = [];
  function place() {
    for (const g of groups) {
      const b = g.box;
      Object.entries({ x: b.x + 0.5, y: b.y + 0.5, width: b.w - 1, height: b.h - 1 }).forEach(([k, v]) => g.rect.setAttribute(k, v));
      g.title.setAttribute("x", b.x + 8);
      g.title.setAttribute("y", b.y + 14);
    }
    for (const n of list) n.g.setAttribute("transform", `translate(${r1(n.x - n.w / 2)},${r1(n.y - NODE_H / 2)})`);
    for (const e of [...edges.values(), ...vias]) {
      const p = geo(nodes.get(e.from), nodes.get(e.to), e.bend);
      e.path.setAttribute("d", p.d);
      e.head.setAttribute("d", p.head);
    }
  }
  function size() {
    const W = Math.max(280, Math.round(svg.clientWidth || root.clientWidth));
    if (L && L.W === W) return false;
    L = layout(W);
    svg.setAttribute("viewBox", `0 0 ${W} ${L.H}`);
    svg.style.height = `${L.H}px`;
    return true;
  }

  // Animation: one rAF loop runs every tween; with reduced motion each lands at once.
  const tweens = new Set();
  let raf = 0;
  function tween(dur, step) {
    if (reduce.matches || !root.isConnected) { step(1); return Promise.resolve(); }
    return new Promise((done) => {
      tweens.add({ t0: performance.now(), dur, step, done });
      if (!raf) raf = requestAnimationFrame(tick);
    });
  }
  function tick(now) {
    raf = 0;
    for (const t of tweens) {
      const k = Math.min(1, (now - t.t0) / t.dur);
      t.step(k);
      if (k >= 1) { tweens.delete(t); t.done(); }
    }
    if (tweens.size) raf = requestAnimationFrame(tick);
  }
  const settle = () => tween(SETTLE_MS, (t) => frameAt(ease(t) * (L.frames.length - 1)));

  // The ripple: hop 1 asks the binary about the query itself (it resolves names, qualified
  // names and file:line), then each hop asks once per newly reached function.
  let gen = 0;
  let focus = [];
  let last = null;
  const fail = (err) => { status.textContent = err.message; };

  let lit = new Set();
  function clearRipple() {
    lit = new Set();
    gFlow.replaceChildren();
    gVia.replaceChildren();
    vias = [];
    for (const e of edges.values()) { e.path.classList.remove("is-up", "is-down"); e.head.classList.remove("is-up", "is-down"); }
    for (const n of list) {
      n.g.classList.remove("is-focus", "is-up", "is-down");
      n.g.setAttribute("aria-pressed", "false");
      n.hop = {};
      n.hopT.textContent = "";
    }
  }
  function mark(n, d, hop) {
    if (n.hop[d]) return;
    n.hop[d] = hop;
    n.g.classList.add(d === "up" ? "is-up" : "is-down");
    n.hopT.textContent = [n.hop.up ? `↑${n.hop.up}` : "", n.hop.down ? `↓${n.hop.down}` : ""].filter(Boolean).join(" ");
  }
  // One edge lit in direction d (up: toward callers), its pulse running away from the focus.
  function light(from, to, d, via, my) {
    const key = `${from}>${to}`;
    let e = edges.get(key);
    if (!e) {
      e = vias.find((v) => v.key === key);
      if (!e) {
        e = { key, from, to, bend: -0.22, path: sv("path", "cg-e cg-via"), head: sv("path", "cg-head") };
        const p = geo(nodes.get(from), nodes.get(to), e.bend);
        e.path.setAttribute("d", p.d);
        e.head.setAttribute("d", p.head);
        gVia.append(e.path, e.head);
        vias.push(e);
      }
    }
    const cls = d === "up" ? "is-up" : "is-down";
    if (lit.has(`${key}|${d}`)) return Promise.resolve();
    lit.add(`${key}|${d}`);
    const far = nodes.get(d === "up" ? from : to);
    const finish = () => {
      if (my !== gen) return;
      e.path.classList.add(cls);
      e.head.classList.add(cls);
    };
    if (reduce.matches) { finish(); return Promise.resolve(far); }
    const flow = sv("path", `cg-flow ${cls}`, { d: e.path.getAttribute("d") });
    const dot = sv("circle", `cg-pulse ${cls}`, { r: 3.5 });
    gFlow.append(flow, dot);
    const len = flow.getTotalLength();
    flow.setAttribute("stroke-dasharray", `${len} ${len}`);
    const back = d === "up";
    return tween(HOP_MS, (t) => {
      const k = ease(t);
      flow.setAttribute("stroke-dashoffset", String(back ? -len * (1 - k) : len * (1 - k)));
      const p = flow.getPointAtLength(back ? len * (1 - k) : len * k);
      dot.setAttribute("cx", r1(p.x));
      dot.setAttribute("cy", r1(p.y));
    }).then(() => { flow.remove(); dot.remove(); finish(); });
  }

  async function ask(method, specs) {
    return Promise.all(specs.map((s) => demo.call(method, { symbol: s })));
  }

  async function walk(query, how) {
    const my = ++gen;
    let calls = 2;
    let t = performance.now();
    const [up, down] = await Promise.all([demo.call("callers", { symbol: query }), demo.call("callees", { symbol: query })]).catch((err) => {
      if (!last) throw err;
      if (my === gen) status.textContent = err.message;
      return [null, null];
    });
    let q = performance.now() - t;
    if (!up || my !== gen) return false;
    const picked = down.roots.map(specOf).filter((s) => nodes.has(s));
    if (!picked.length) {
      const r = down.roots[0];
      status.textContent = `${query} resolves to ${r.kind} ${r.qname} (${rel(r.file)}:${r.line}); the graph draws functions and methods.`;
      return false;
    }
    clearRipple();
    focus = picked;
    svg.classList.add("is-rippling");
    for (const s of focus) {
      const n = nodes.get(s);
      n.g.classList.add("is-focus");
      n.g.setAttribute("aria-pressed", "true");
    }
    rove(nodes.get(focus[0]), false);
    last = { query, up, down };
    if (how === "search") status.textContent = focus.length > 1 ? `${query} names ${plural(focus.length, "function", "functions")}; the ripple starts from each.` : `${query} resolves to ${nodes.get(focus[0]).qname}.`;
    else if (how === "line") status.textContent = `${query} is inside ${nodes.get(focus[0]).qname}.`;
    else if (how === "node") status.textContent = "";
    showOneHop(query, up, down);

    const way = ways.value, max = Number(depth.value);
    const seen = { up: new Set(focus), down: new Set(focus) };
    let ans = { up: way !== "callees" ? up.roots : null, down: way !== "callers" ? down.roots : null };
    let ext = 0, reached = 0;
    const tiles = () => {
      cell.callers.textContent = way !== "callees" ? String(seen.up.size - focus.length) : "–";
      cell.callees.textContent = way !== "callers" ? String(seen.down.size - focus.length) : "–";
      cell.unresolved.textContent = way !== "callers" ? String(ext) : "–";
      cell.depth.textContent = String(reached);
      cell.query.textContent = ms(q);
      receipt.textContent = `${plural(calls, "call-tree query", "call-tree queries")} walked from ${nodes.get(focus[0]).qname} in ${ms(q)}; ` +
        `drawing the graph took ${list.length} more in ${ms(mapMs)}, after indexing ${plural(info.files.length, "file", "files")} in ${ms(indexMs)}, in your browser.`;
    };
    for (let hop = 1; hop <= max; hop++) {
      const nexts = { up: [], down: [] };
      const flows = [];
      for (const d of ["up", "down"]) {
        if (!ans[d]) continue;
        for (const r of ans[d]) {
          const rs = specOf(r);
          for (const ch of r.children || []) {
            if (!ch.qname) { if (d === "down") ext++; continue; }
            const cs = specOf(ch);
            if (!nodes.has(cs) || !nodes.has(rs)) continue;
            const fresh = !seen[d].has(cs);
            if (fresh) { seen[d].add(cs); nexts[d].push(cs); reached = hop; }
            flows.push(light(d === "up" ? cs : rs, d === "up" ? rs : cs, d, ch.via, my).then(() => { if (fresh && my === gen) mark(nodes.get(cs), d, hop); }));
          }
        }
      }
      tiles();
      const more = hop < max && (nexts.up.length || nexts.down.length);
      t = performance.now();
      const fetch = more ? Promise.all([ask("callers", nexts.up), ask("callees", nexts.down)]).then((v) => { q += performance.now() - t; calls += nexts.up.length + nexts.down.length; return v; }) : null;
      const [, got] = await Promise.all([Promise.all(flows), fetch]);
      if (my !== gen) return false;
      if (!got) break;
      ans = { up: got[0].flatMap((a) => a.roots), down: got[1].flatMap((a) => a.roots) };
      if (!ans.up.length) ans.up = null;
      if (!ans.down.length) ans.down = null;
    }
    tiles();
    return true;
  }
  function showOneHop(query, up, down) {
    const merge = (a) => {
      const seen = new Set(), out = [];
      for (const r of a.roots) for (const ch of r.children || []) {
        const k = `${ch.qname || ch.external}|${ch.site}`;
        if (!seen.has(k)) { seen.add(k); out.push(ch); }
      }
      return out;
    };
    const ups = merge(up), downs = merge(down);
    fill("callers", ups);
    fill("callees", downs);
    const open = downs.filter((n) => !n.confidence).length;
    const tail = `${plural(ups.length, "caller", "callers")}; ${plural(downs.length, "callee", "callees")}, ${downs.length - open} resolved, ${open} unresolved.`;
    const roots = down.roots.filter((r) => nodes.has(specOf(r)));
    const r = roots[0];
    summary.textContent = roots.length > 1
      ? `${query} names ${roots.map((x) => `${x.qname} (${specOf(x)})`).join(" and ")}: ${tail}`
      : `${r.qname} (${specOf(r)}): ${tail}`;
    sig.textContent = roots.map((x) => x.signature).filter(Boolean).join("\n");
    const sym = nodes.get(specOf(r));
    const sites = { down: new Set(), up: new Set() };
    for (const [k, arr] of [["down", downs], ["up", ups]]) {
      for (const n of arr) {
        const s = rel(n.site);
        if (s && s.startsWith(`${sym.file}:`)) sites[k].add(Number(s.slice(sym.file.length + 1)));
      }
    }
    source(sym, sites);
  }

  const badge = (conf) => el("span", `cg-conf cg-${conf || "none"}`, conf || "unresolved");
  function fill(dir, kids) {
    const ul = lists[dir];
    if (!kids.length) {
      ul.replaceChildren(el("li", "cg-empty", dir === "callers" ? "No callers in the sample" : "No calls"));
      return;
    }
    ul.replaceChildren(...kids.map((n) => {
      const li = el("li", "cg-edge");
      const site = rel(n.site);
      const where = [];
      if (site) where.push(`${dir === "callers" ? "calls at" : "at"} ${site}`);
      if (n.sites > 1) where.push(`${n.sites} sites`);
      if (n.via) where.push(`via ${n.via}`);
      if (n.as_value) where.push("as value");
      let name;
      if (n.qname) {
        const spec = specOf(n);
        name = button(n.qname, "cg-go");
        name.addEventListener("click", () => { setPlaying(false); walk(spec, "node").catch(fail); });
      } else {
        name = el("code", "cg-ext", n.external);
      }
      li.append(name, badge(n.confidence), el("span", "cg-where", where.join(" · ")));
      return li;
    }));
  }

  function source(sym, sites) {
    const f = files.get(sym.file);
    codeHead.textContent = `${f.path} · tap a line to ask which function holds it`;
    code.setAttribute("aria-label", `Source of ${f.path}`);
    code.dataset.file = f.path;
    const lines = f.text.replace(/\n$/, "").split("\n");
    let first = null;
    code.replaceChildren(...lines.map((text, i) => {
      const n = i + 1;
      const row = el("span", "cg-line");
      row.dataset.n = String(n);
      if (n >= sym.line && n <= sym.end_line) row.classList.add("cg-def");
      if (sites.down.has(n)) row.classList.add("cg-site");
      if (sites.up.has(n)) row.classList.add("cg-from");
      if (n === sym.line) first = row;
      row.append(el("span", "cg-ln", String(n)), document.createTextNode(text || " "));
      return row;
    }));
    if (first) code.scrollTop = first.previousSibling ? first.previousSibling.offsetTop : 0;
  }
  code.addEventListener("click", (e) => {
    const row = e.target.closest(".cg-line");
    if (!row || window.getSelection()?.toString()) return;
    setPlaying(false);
    walk(`${code.dataset.file}:${row.dataset.n}`, "line").catch(fail);
  });

  function jump() {
    const v = search.value.trim();
    if (!v) { status.textContent = "Type a function name, Type::method or file:line."; return; }
    setPlaying(false);
    walk(v, "search").catch(fail);
  }

  // Keyboard: one tab stop in the graph; arrows move to the nearest function that way.
  function rove(n, move) {
    for (const m of list) m.g.tabIndex = m === n ? 0 : -1;
    if (move) n.g.focus({ preventScroll: true });
  }
  gNode.addEventListener("keydown", (e) => {
    const n = nodes.get(e.target.closest?.(".cg-node")?.dataset.spec);
    if (!n) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPlaying(false);
      walk(n.spec, "node").catch(fail);
      return;
    }
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    let best = null, score = Infinity;
    for (const m of list) {
      if (m === n) continue;
      const dx = m.x - n.x, dy = m.y - n.y, along = dx * dir[0] + dy * dir[1];
      if (along <= 0) continue;
      const s = along + 2 * Math.abs(dx * dir[1] + dy * dir[0]);
      if (s < score) { score = s; best = m; }
    }
    if (best) rove(best, true);
  });

  // The tour: from the focus to a function it calls or is called by (the binary's own
  // one-hop answer), unvisited first, then on to the next unvisited function.
  let playing = !reduce.matches;
  let timer = 0;
  let visible = true;
  let tourGen = 0;
  const visited = new Set();
  function setPlaying(v, wait = 400) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    clearTimeout(timer);
    tourGen++;
    if (v) timer = setTimeout(stop, wait);
  }
  function pick() {
    const from = focus[0];
    const hop = [];
    for (const [a, d] of [[last?.down, "callee"], [last?.up, "caller"]]) {
      for (const r of a?.roots || []) for (const ch of r.children || []) if (ch.qname && nodes.has(specOf(ch))) hop.push([specOf(ch), d, ch]);
    }
    let cand = hop.find(([s]) => !visited.has(s));
    if (cand) return cand;
    let s = list.find((n) => !visited.has(n.spec))?.spec;
    if (!s) { visited.clear(); visited.add(from); s = list.find((n) => n.spec !== from).spec; }
    return [s, "", null];
  }
  async function stop() {
    if (!root.isConnected) return;
    const mine = tourGen;
    if (!visible || document.hidden) { if (playing) timer = setTimeout(stop, 600); return; }
    const [s, kind, ch] = pick();
    visited.add(s);
    const from = nodes.get(focus[0]), to = nodes.get(s);
    status.textContent = kind ? `tour: ${from.qname} → ${to.qname}, a ${kind}${ch.confidence ? ` (${ch.confidence})` : ""}${ch.via ? ` via ${ch.via}` : ""}.` : `tour: on to ${to.qname}.`;
    if (kind) await travel(from, to);
    if (mine !== tourGen) return;
    await walk(s, "tour").catch(fail);
    if (mine === tourGen && playing) timer = setTimeout(stop, DWELL_MS);
  }
  function travel(A, B) {
    if (!A || !B) return Promise.resolve();
    const e = edges.get(`${A.spec}>${B.spec}`) || edges.get(`${B.spec}>${A.spec}`) || vias.find((v) => v.key === `${B.spec}>${A.spec}`);
    if (!e || reduce.matches) return Promise.resolve();
    const fwd = e.from === A.spec;
    const dot = sv("circle", "cg-trav", { r: 5 });
    gFlow.append(dot);
    const len = e.path.getTotalLength();
    return tween(MOVE_MS, (t) => {
      const p = e.path.getPointAtLength(fwd ? len * ease(t) : len * (1 - ease(t)));
      dot.setAttribute("cx", r1(p.x));
      dot.setAttribute("cy", r1(p.y));
    }).then(() => dot.remove());
  }

  play.addEventListener("click", () => setPlaying(!playing));
  next.addEventListener("click", () => {
    setPlaying(false);
    const mine = tourGen;
    const [s] = pick();
    visited.add(s);
    travel(nodes.get(focus[0]), nodes.get(s)).then(() => mine === tourGen && walk(s, "tour")).catch(fail);
  });
  reset.addEventListener("click", () => {
    setPlaying(false);
    visited.clear();
    visited.add(START);
    gen++;
    clearRipple();
    svg.classList.remove("is-rippling");
    status.textContent = "";
    const g0 = gen;
    settle().then(() => g0 === gen && walk(START, "tour")).then((ok) => { if (ok) setPlaying(!reduce.matches, DWELL_MS); }).catch(fail);
  });
  for (const s of [ways, depth]) s.addEventListener("change", () => { if (focus.length) walk(last.query, "node").catch(fail); });

  new ResizeObserver(() => {
    if (!root.isConnected || !L) return;
    if (size()) frameAt(L.frames.length - 1);
  }).observe(svg);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(svg);
  reduce.addEventListener("change", () => { if (reduce.matches) setPlaying(false); });

  size();
  visited.add(START);
  const start = nodes.has(START) ? START : list[0].spec;
  if (reduce.matches) {
    frameAt(L.frames.length - 1);
    await walk(start, "tour");
    setPlaying(false);
  } else {
    frameAt(0);
    setPlaying(true, 1e9);
    const g0 = gen, t0g = tourGen;
    settle().then(() => g0 === gen && walk(start, "tour")).then((ok) => { if (ok && t0g === tourGen) setPlaying(true, DWELL_MS); }).catch(fail);
  }
}
