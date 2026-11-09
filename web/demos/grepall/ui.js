// grepall demo: grepall's real shard builder, regexp planner, posting lists and
// matcher, compiled to WebAssembly. On arrival it indexes a slice of the Go
// standard library, one shard per package, then a tour types queries one key at
// a time. Every keystroke plans the query, reads each trigram's posting list
// from the index, takes the candidates and verifies them, all in the binary.
const TOUR = [
  ["rare literal", "Kelvin", false, "each letter from the third on adds a trigram, and the posting lists intersect to fewer files."],
  ["alternation", "TODO|FIXME", true, "either branch may match, so the plan is an OR of two ANDs; a list with no files empties its branch."],
  ["regexp", String.raw`func\s+New\w+\(`, true, String.raw`\s is any of five bytes, so the planner ORs the trigrams that cross it.`],
  ["common idiom", "err != nil", false, "its trigrams are frequent, so many files are candidates, and nearly all of them really match."],
  [".* defeats the index", ":=.*<-", true, "no trigram is required by every match, so no file can be ruled out and the matcher reads them all."],
];
const EXTRA = [["no trigrams", "[a-z]{40}", true], ["repo: filter", "repo:regexp Simplify", false]];
const FINAL = 2;
const KEY_MS = 110;
const DWELL_MS = 2800;
const SHARD_MS = 40;
const FETCH_CAP = 48;
const MAX_ROWS = 28;
const ROW = 26;
const TWEEN = 75;

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
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const sleep = (t) => new Promise((r) => setTimeout(r, t));

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

// A trigram chip's text (trigram.T.Escape) back to its three bytes.
function unescape(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") { out.push(s.charCodeAt(i)); continue; }
    const c = s[++i];
    if (c === "x") { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push({ t: 9, n: 10, r: 13 }[c] ?? c.charCodeAt(0));
  }
  return out;
}
// A one-trigram regexp: its plan is that trigram alone, so its candidates are the trigram's posting list.
// Bytes past ASCII cannot travel as a JSON string, so those lists are not read.
function triQuery(t) {
  const b = unescape(t);
  if (b.length !== 3 || b.some((x) => x > 0x7f)) return null;
  return { q: b.map((x) => `\\x{${x.toString(16).padStart(2, "0")}}`).join(""), regex: true, case: "no" };
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
  if (more) box.append(el("p", "demo-note", `+${plural(more, "node")} not shown`));
  return box;
}

// The trigram query as nested and/or groups of trigram chips.
function queryTree(q, more) {
  const box = scrollBox("Trigram query");
  if (q.op === "all" || q.op === "none") {
    box.append(el("p", "ga-all", q.op === "all" ? "every file: no trigram is required by every match" : "no file: no string can match"));
    return box;
  }
  const group = (n) => {
    const g = el("div", "ga-g");
    g.dataset.op = n.op;
    g.append(el("span", "ga-gop", n.op === "and" ? "all of" : "any of"));
    const kids = el("div", "ga-kids");
    for (const t of n.tri || []) {
      const c = el("span", "ga-chip");
      c.append(el("code", null, showTri(t.t)), el("span", "ga-fn", t.files < 0 ? "" : fmt(t.files)));
      kids.append(c);
    }
    for (const s of n.sub || []) kids.append(group(s));
    g.append(kids);
    return g;
  };
  box.append(group(q));
  if (more) box.append(el("p", "demo-note", `+${plural(more, "trigram")} not shown`));
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
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Controls: the query first, so Tab from the mount reaches it.
  const form = el("form", "ga-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const q = el("input");
  Object.assign(q, { type: "text", name: "q", value: "", spellcheck: false, autocomplete: "off" });
  q.setAttribute("autocapitalize", "off");
  q.setAttribute("autocorrect", "off");
  const qField = el("label", "demo-field ga-qf");
  qField.append(el("span", "demo-label", "your query (repo:, file:, case: filters work)"), q);
  const re = el("input");
  Object.assign(re, { type: "checkbox", name: "regex", checked: true });
  const reField = el("label", "demo-field ga-check");
  reField.append(el("span", "demo-label", "regexp"), re);
  const cs = el("select");
  cs.name = "case";
  for (const [v, t] of [["auto", "smart"], ["yes", "sensitive"], ["no", "insensitive"]]) {
    const o = el("option", null, t);
    o.value = v;
    cs.append(o);
  }
  const csField = el("label", "demo-field");
  csField.append(el("span", "demo-label", "case"), cs);
  form.append(qField, reField, csField);

  const play = button("Pause");
  const next = button("Next", "secondary");
  const reset = button("Reset", "secondary");
  const acts = el("div", "ga-acts");
  acts.append(play, next, reset);

  const presets = el("div", "ga-presets");
  presets.setAttribute("role", "group");
  presets.setAttribute("aria-label", "Example queries");
  const presetBtns = [...TOUR, ...EXTRA].map(([label, text, regex], i) => {
    const b = button("", "secondary");
    b.append(el("span", "ga-pl", label), el("code", null, text));
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      setPlaying(false);
      tourGen++;
      mark(i);
      cap.textContent = i < TOUR.length ? `${label}: ${TOUR[i][3]}` : `${label}.`;
      setQuery(text, regex);
      request("you").catch(fail);
    });
    presets.append(b);
    return b;
  });
  const mark = (i) => presetBtns.forEach((b, j) => b.setAttribute("aria-pressed", String(i === j)));

  const cap = el("p", "ga-cap", " ");
  const canvas = el("canvas", "ga-canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Index board: building the index.");
  const legend = el("p", "demo-legend ga-legend");
  for (const [k, t] of [["shard", "trigrams per shard"], ["post", "posting list: files holding the trigram"], ["cand", "candidate"], ["early", "let through early"], ["hit", "verified match"]]) {
    const s = el("span", "ga-key", t);
    s.dataset.k = k;
    legend.append(s);
  }
  const readout = el("p", "ga-readout", " ");
  const status = el("p", "ga-status");
  status.setAttribute("aria-live", "polite");

  const cells = el("ul", "cells stack ga-cells");
  const cell = {};
  for (const [k, t] of [["files", "files"], ["bytes", "indexed"], ["lists", "posting lists"], ["tri", "query trigrams"],
    ["cand", "candidates"], ["hit", "matches"], ["read", "bytes read"], ["time", "query time"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "ga-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const set = (k, v) => { cell[k].textContent = v; };

  // The matches, virtualised.
  const resHead = el("h3", "ga-h");
  resHead.append(el("span", null, "matches"), el("span", "ga-t"));
  const list = el("div", "ga-list");
  list.tabIndex = 0;
  list.setAttribute("role", "region");
  list.setAttribute("aria-label", "Matches");
  const spacer = el("div", "ga-spacer");
  list.append(spacer);

  // Planner detail: what regexp/syntax and the planner made of the query.
  const detail = el("details", "ga-detail");
  const dsum = el("summary", null, "planner: parse tree and trigram query");
  const stages = el("div", "ga-stages");
  const treeBox = el("div", "ga-panel");
  const planBox = el("div", "ga-panel");
  stages.append(treeBox, planBox);
  detail.append(dsum, stages);

  const corpusNote = el("details", "ga-corpus");
  const receipt = el("p", "demo-out ga-out");
  receipt.setAttribute("aria-live", "polite");
  root.replaceChildren(form, acts, presets, cap, canvas, legend, readout, status, cells, resHead, list, detail, corpusNote, receipt);
  await cssReady;

  // Colours come from the tokens; read again on a scheme or theme change.
  let C = null;
  const readColors = () => {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    C = { bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"),
      text3: v("--text-3"), accent: v("--accent"), tint: v("--accent-tint"), signal: v("--signal"), danger: v("--danger"), mono: v("--mono") || "monospace" };
  };
  readColors();

  // The corpus: files in id order, packages as contiguous id ranges.
  const info = await demo.call("corpus", {});
  const files = [];
  const pkgs = info.packages.map((p) => {
    const k = { name: p.name, from: files.length, n: p.files.length, bytes: p.bytes, tri: 0, shard: 0, at: 0, built: false };
    for (const f of p.files) files.push(`${p.name}/${f}`);
    return k;
  });
  const N = files.length;
  const sum = el("summary", null, `corpus: ${plural(N, "file")} from ${plural(pkgs.length, "package")} of the Go standard library, BSD licence`);
  corpusNote.append(sum, el("p", null, info.about), el("pre", "ga-lic", info.license));

  // Board state. A row holds a per-file target (0/1) and the value drawn, which eases toward it.
  const mkRow = (key, kind, label, depth) => ({ key, kind, label, depth, want: new Float32Array(N), cur: new Float32Array(N), y: -1, alpha: 0, gone: false, count: "" });
  const funnel = { files: mkRow("files", "files", "files", 0), cand: mkRow("cand", "cand", "candidates", 0), hit: mkRow("hit", "hit", "matches", 0) };
  funnel.files.alpha = funnel.cand.alpha = funnel.hit.alpha = 1;
  let rows = [];
  let mode = "build";
  let rootOp = "and";
  let typed = "";
  let brackets = [];
  let lastTick = 0;
  let raf = 0;
  let hover = -1;
  let hoverPkg = null;
  let mine = false;
  let sel = -1;
  let G = null;

  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const narrow = W < 520;
    const L = narrow ? 74 : 104, R = narrow ? 36 : 52;
    const stripTop = 16, stripH = narrow ? 34 : 44;
    const qTop = stripTop + stripH + 30;
    const postTop = qTop + 40, postH = narrow ? 176 : 180;
    const funTop = postTop + postH + 26;
    const H = funTop + 3 * 24 + 6;
    G = { W, H, L, R, P: W - L - R, fw: (W - L - R) / N, stripTop, stripH, qTop, postTop, postH, funTop, narrow };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const fx = (i) => G.L + i * G.fw;

  // Posting-row layout: weights per row, packed into the fixed area.
  function place() {
    const live = rows.filter((r) => !r.gone);
    const wsum = live.reduce((a, r) => a + (r.kind === "op" ? 1.35 : 1), 0);
    const pitch = Math.min(26, G.postH / Math.max(wsum, 1));
    let y = G.postTop;
    for (const r of live) {
      r.h = Math.max(1.5, pitch * (r.kind === "op" ? 1.35 : 1) - Math.max(1.5, pitch * 0.3));
      r.ty = y;
      if (r.y < 0) r.y = y;
      y += pitch * (r.kind === "op" ? 1.35 : 1);
    }
    G.pitch = pitch;
  }

  function draw(now) {
    if (!G) return false;
    const dt = lastTick ? Math.min(100, now - lastTick) : 16;
    lastTick = now;
    const k = reduce.matches ? 1 : 1 - Math.exp(-dt / TWEEN);
    const dpr = window.devicePixelRatio || 1;
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, G.W, G.H);
    const font = (px, w = 400) => `${w} ${px}px ${C.mono}`;
    let moving = false;
    const label = (text, x, y, color, px = 10, w = 400, align = "left") => {
      g.font = font(px, w);
      g.fillStyle = color;
      g.textAlign = align;
      g.fillText(text, x, y);
    };

    // Hover column behind everything.
    if (hoverPkg) {
      g.fillStyle = C.tint;
      g.fillRect(fx(hoverPkg.from), G.stripTop, hoverPkg.n * G.fw, G.stripH + 14);
    }
    if (hover >= 0 || sel >= 0) {
      for (const [i, c] of [[sel, C.tint], [hover, C.tint]]) {
        if (i < 0) continue;
        g.fillStyle = c;
        g.fillRect(fx(i) - 1, G.stripTop, Math.max(G.fw, 1) + 2, G.H - G.stripTop - 4);
      }
    }

    // The index: one bar per shard over its files, as tall as its trigram count.
    const maxTri = Math.max(1, ...pkgs.map((p) => p.tri));
    const builtN = pkgs.filter((p) => p.built).length;
    label("index", 4, G.stripTop + 9, C.text3);
    label("shards", 4, G.stripTop + 21, C.text3);
    label(G.narrow ? fmt(builtN) : `${builtN}/${pkgs.length}`, G.W - 4, G.stripTop + G.stripH, C.text2, 10, 400, "right");
    const base = G.stripTop + G.stripH;
    g.fillStyle = C.line;
    g.fillRect(G.L, base, G.P, 1);
    for (const p of pkgs) {
      if (!p.built) continue;
      const t = reduce.matches || !p.at ? 1 : ease((now - p.at) / 260);
      if (t < 1) moving = true;
      const h = Math.max(2, (p.tri / maxTri) * (G.stripH - 4)) * t;
      const x0 = fx(p.from) + 0.5, w = Math.max(1, p.n * G.fw - 1);
      g.fillStyle = t < 1 ? C.signal : C.strong;
      g.fillRect(x0, base - h, w, h);
    }
    // Package names under the bars where they fit, never overlapping.
    g.font = font(9);
    let free = G.L;
    for (const p of pkgs) {
      const name = p.name.split("/").pop();
      const w = g.measureText(name).width;
      const cx = fx(p.from) + (p.n * G.fw) / 2;
      if (p.n * G.fw > w * 0.8 && cx - w / 2 >= free) {
        g.fillStyle = p.built ? C.text3 : C.line;
        g.textAlign = "center";
        g.fillText(name, Math.min(cx, G.W - G.R - w / 2), base + 12);
        free = cx + w / 2 + 6;
      }
    }

    // The query, with each required trigram bracketed where it occurs in the text.
    if (mine) label("your query", 4, G.qTop + 4, C.accent, 10, 600);
    else label("query", 4, G.qTop + 4, C.text3);
    g.font = font(G.narrow ? 12 : 14, 600);
    const cw = g.measureText("M").width;
    const maxChars = Math.floor(G.P / cw);
    const shown = typed.length > maxChars ? `${typed.slice(0, maxChars - 1)}…` : typed;
    g.fillStyle = mode === "error" ? C.danger : C.text;
    g.textAlign = "left";
    g.fillText(shown || (mode === "build" ? "building the index…" : ""), G.L, G.qTop + 4);
    if (mode !== "build" && typed && Math.floor(now / 530) % 2 === 0 && touring) {
      g.fillStyle = C.accent;
      g.fillRect(G.L + Math.min(typed.length, maxChars) * cw + 1, G.qTop - 9, 1.5, 16);
    }
    if (touring) moving = true;
    for (const b of brackets) {
      if (b.pos + 3 > maxChars) continue;
      const t = reduce.matches ? 1 : ease((now - b.at) / 240);
      if (t < 1) moving = true;
      const y = G.qTop + 9 + (b.lane * 5) + (1 - t) * 6;
      g.globalAlpha = t;
      g.strokeStyle = C.signal;
      g.lineWidth = 1.25;
      g.beginPath();
      const x0 = G.L + b.pos * cw + 1.5, x1 = G.L + (b.pos + 3) * cw - 1.5;
      g.moveTo(x0, y - 3); g.lineTo(x0, y); g.lineTo(x1, y); g.lineTo(x1, y - 3);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Posting lists: one row per trigram, groups closed by their and/or row.
    label("posting lists", 4, G.postTop - 8, C.text3);
    if (mode === "all" || mode === "none") {
      label(mode === "all" ? "no trigram required: every file is a candidate" : "no string can match: no file is a candidate",
        G.L, G.postTop + 14, C.signal, G.narrow ? 10 : 11, 600);
      if (mode === "all" && last) label(`so the matcher reads all ${fmt(N)} files, ${size(srcBytes)}`, G.L, G.postTop + 32, C.text3, 10);
    }
    // Where few files survive, a guide through every list shows them lining up.
    if (mode === "plan" && last && last.cands.size <= 60) {
      g.globalAlpha = 0.35;
      for (const i of last.cands) {
        g.fillStyle = last.hits.has(i) ? C.accent : C.signal;
        g.fillRect(fx(i) + G.fw / 2 - 0.5, G.postTop - 2, 1, G.funTop + 24 - G.postTop);
      }
      g.globalAlpha = 1;
    }
    for (const r of rows) {
      r.alpha += ((r.gone ? 0 : 1) - r.alpha) * k;
      if (r.ty !== undefined) r.y += (r.ty - r.y) * k;
      if (Math.abs((r.gone ? 0 : 1) - r.alpha) > 0.01 || Math.abs(r.ty - r.y) > 0.3) moving = true;
      if (drawRow(g, r, r.y, r.h, k, font, C.text2)) moving = true;
    }
    rows = rows.filter((r) => !r.gone || r.alpha > 0.02);
    if (extraRows) label(`+${fmt(extraRows)} more rows`, G.L, G.postTop + G.postH + 8, C.text3, 9);

    // The funnel: every file, the candidates the index let through, and what the matcher confirmed.
    g.fillStyle = C.line;
    g.fillRect(G.L, G.funTop - 9, G.P, 1);
    if (mode === "plan" && rows.some((r) => !r.gone)) {
      const early = Number(canvas.dataset.early || 0);
      const op = rootOp === "or" ? "any" : "all";
      label(G.narrow ? `${op} of these → candidates${early ? ` · ${fmt(early)} early` : ""}` : `${op} of the lists above → candidates${early ? `, ${fmt(early)} let through early` : ""}`, G.W - 4, G.funTop - 12, C.text3, 9, 400, "right");
    }
    const fun = [[funnel.files, C.text3], [funnel.cand, C.signal], [funnel.hit, C.accent]];
    fun.forEach(([r, color], i) => { if (drawRow(g, r, G.funTop + i * 24, 16, k, font, color, true)) moving = true; });
    return moving;
  }

  // One row: its label, a slot per file and the file's tick where the list holds it.
  function drawRow(g, r, y, h, k, font, color, big) {
    let moving = false;
    g.globalAlpha = r.alpha;
    g.fillStyle = C.line;
    g.fillRect(G.L, y, G.P, h);
    g.fillStyle = r.kind === "op" ? C.text : color;
    const w = Math.max(1, G.fw - (G.fw > 2.2 ? 0.6 : 0));
    for (let i = 0; i < N; i++) {
      const d = r.want[i] - r.cur[i];
      if (d) {
        r.cur[i] += d * k;
        if (Math.abs(r.want[i] - r.cur[i]) < 0.01) r.cur[i] = r.want[i];
        else moving = true;
      }
      if (r.cur[i] < 0.02) continue;
      g.globalAlpha = r.alpha * r.cur[i];
      g.fillRect(fx(i), y, w, h);
    }
    g.globalAlpha = r.alpha;
    if (big || G.pitch >= 8) {
      const px = big ? (G.narrow ? 9 : 10) : Math.min(10, Math.max(7.5, G.pitch * 0.72));
      const ty = y + h / 2 + px * 0.36;
      g.font = font(px, r.kind === "op" || big ? 600 : 400);
      g.fillStyle = big ? (r.kind === "files" ? C.text2 : color) : r.kind === "op" ? C.text : C.text2;
      g.textAlign = "left";
      const ind = 4 + r.depth * (G.narrow ? 5 : 8);
      let t = r.label;
      while (t.length > 2 && g.measureText(t).width > G.L - ind - 4) t = t.slice(0, -1);
      g.fillText(t === r.label ? t : `${t.slice(0, -1)}…`, ind, ty);
      g.textAlign = "right";
      g.font = font(big ? (G.narrow ? 11 : 12) : px, big ? 600 : 400);
      g.fillStyle = big ? color : C.text3;
      g.fillText(r.count, G.W - 4, ty + (big ? 1 : 0));
    }
    if (r.kind === "op" && r.first !== undefined) {
      g.strokeStyle = C.strong;
      g.lineWidth = 1;
      const x = G.L - 3.5;
      g.beginPath();
      g.moveTo(x - 3, r.first); g.lineTo(x, r.first); g.lineTo(x, y + h); g.lineTo(x - 3, y + h);
      g.stroke();
    }
    g.globalAlpha = 1;
    return moving;
  }

  let visible = true;
  const frame = (now) => {
    raf = 0;
    if (!root.isConnected) return;
    const more = draw(now);
    if (more && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else lastTick = 0;
  };
  const kick = () => { if (!raf && G) raf = requestAnimationFrame(frame); };

  // Posting lists the binary returned, by trigram; the index never changes once built.
  const post = new Map();
  let builtFiles = 0, srcBytes = 0, shardBytes = 0, trigrams = 0, buildMs = 0;
  let last = null;

  // The rows for a trigram query: each trigram's posting list, and each sub-group's and/or of its children.
  function planRows(plan) {
    const out = [];
    const known = (ids) => ids !== undefined;
    const walk = (n, depth, path) => {
      const sets = [];
      for (const t of n.tri || []) {
        const ids = post.get(t.t);
        out.push({ key: `${path}t${t.t}`, kind: "tri", label: showTri(t.t), depth, ids, count: fmt(t.files) });
        sets.push(ids);
      }
      (n.sub || []).forEach((s, i) => {
        const start = out.length;
        const ids = walk(s, depth + 1, `${path}${i}/`);
        out.push({ key: `${path}${i}/=`, kind: "op", label: s.op === "or" ? "any of" : "all of", depth: depth + 1, ids, first: start,
          count: ids ? fmt(ids.length) : "" });
        sets.push(ids);
      });
      if (!sets.every(known)) return undefined;
      return combine(n.op, sets);
    };
    const total = plan.query.op === "and" || plan.query.op === "or" ? walk(plan.query, 0, "") : undefined;
    return { out, total };
  }
  function combine(op, sets) {
    if (!sets.length) return [];
    const hit = new Uint16Array(N);
    for (const s of sets) for (const i of s) hit[i]++;
    const ids = [];
    for (let i = 0; i < N; i++) if (op === "and" ? hit[i] === sets.length : hit[i] > 0) ids.push(i);
    return ids;
  }

  let extraRows = 0;
  function setRows(spec) {
    extraRows = Math.max(0, spec.length - MAX_ROWS);
    const byKey = new Map(rows.filter((r) => !r.gone).map((r) => [r.key, r]));
    const next = [];
    spec.slice(0, MAX_ROWS).forEach((s) => {
      let r = byKey.get(s.key);
      if (r) byKey.delete(r.key);
      else r = mkRow(s.key, s.kind, s.label, s.depth);
      r.want.fill(0);
      for (const i of s.ids || []) r.want[i] = 1;
      r.count = s.count;
      r.firstIdx = s.first;
      next.push(r);
    });
    for (const r of byKey.values()) r.gone = true;
    rows = [...next, ...byKey.values()];
    relayout();
  }
  function relayout() {
    place();
    const live = rows.filter((r) => !r.gone);
    for (const r of live) r.first = r.firstIdx !== undefined ? live[r.firstIdx]?.ty : undefined;
  }

  function setBrackets(spec) {
    const folded = typed.replace(/[A-Z]/g, (c) => c.toLowerCase());
    const old = new Map(brackets.map((b) => [`${b.tri}@${b.pos}`, b]));
    const out = [];
    for (const s of spec) {
      if (s.kind !== "tri") continue;
      const t = String.fromCharCode(...unescape(s.label.replaceAll("␣", " ")));
      const pos = folded.indexOf(t);
      if (pos < 0 || t.length !== 3) continue;
      const key = `${t}@${pos}`;
      out.push(old.get(key) || { tri: t, pos, at: performance.now() });
    }
    out.sort((a, b) => a.pos - b.pos);
    out.forEach((b, i) => { b.lane = i % 3; });
    brackets = out;
  }

  // Readout for a file column or a shard.
  const describe = (i, inStrip) => {
    if (i < 0) return " ";
    if (inStrip) {
      const p = pkgs.find((x) => i >= x.from && i < x.from + x.n);
      return p.built ? `shard ${p.name}: ${plural(p.n, "file")}, ${size(p.bytes)} of source, ${fmt(p.tri)} trigrams, ${size(p.shard)} on disk` : `${p.name}: not indexed yet`;
    }
    if (!last) return files[i];
    const lists = rows.filter((r) => !r.gone && r.kind === "tri");
    const has = lists.filter((r) => r.want[i]).length;
    const f = last.hits.get(i);
    const what = f ? `verified match, ${plural(f.matches, "line")}` : last.early?.has(i) ? "let through early, rejected by the verifier"
      : last.cands.has(i) ? "candidate, but no line matches" : "ruled out by the index";
    return `${files[i]} · ${lists.length ? `in ${fmt(has)} of ${plural(lists.length, "posting list")} · ` : ""}${what}`;
  };
  const at = (e) => {
    const b = canvas.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    const i = Math.floor((x - G.L) / G.fw);
    return { i: i >= 0 && i < N && y > G.stripTop ? i : -1, strip: y < G.stripTop + G.stripH + 14 };
  };
  canvas.addEventListener("pointermove", (e) => {
    if (!G) return;
    const h = at(e);
    const pk = h.strip && h.i >= 0 ? pkgs.find((x) => h.i >= x.from && h.i < x.from + x.n) : null;
    if (h.i !== hover || pk !== hoverPkg) {
      hover = pk ? -1 : h.i;
      hoverPkg = pk;
      readout.textContent = describe(h.i >= 0 ? h.i : sel, h.strip);
      kick();
    }
  });
  canvas.addEventListener("pointerleave", () => { hover = -1; hoverPkg = null; readout.textContent = describe(sel); kick(); });
  canvas.addEventListener("pointerdown", (e) => {
    if (!G) return;
    const h = at(e);
    sel = h.i;
    readout.textContent = describe(sel, h.strip);
    const row = rowOf.get(sel);
    if (row !== undefined) list.scrollTop = row * ROW;
    renderRows();
    kick();
  });

  // Virtualised result rows: only the visible ones exist.
  let lines = [];
  let rowOf = new Map();
  const pool = [];
  function codeLine(text, ranges) {
    const lead = text.length - text.trimStart().length;
    const first = ranges.length ? ranges[0][0] : 0;
    let cut = Math.min(lead, first);
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
    const hi = Math.min(lines.length, Math.ceil((top + h) / ROW) + 6);
    let k = 0;
    for (let i = lo; i < hi; i++, k++) {
      let n = pool[k];
      if (!n) {
        n = el("div", "ga-row");
        pool.push(n);
        spacer.append(n);
      }
      const r = lines[i];
      n.hidden = false;
      n.style.transform = `translateY(${i * ROW}px)`;
      n.className = r.f ? `ga-row ga-file${r.f.id === sel ? " ga-sel" : ""}` : "ga-row";
      if (r.f) n.replaceChildren(el("span", "ga-path", `${r.f.repo}/${r.f.path}`), el("span", "ga-cnt", plural(r.f.matches, "line")));
      else n.replaceChildren(el("span", "ga-ln", String(r.l.n)), codeLine(r.l.text, r.l.ranges));
    }
    for (; k < pool.length; k++) pool[k].hidden = true;
  }
  list.addEventListener("scroll", renderRows, { passive: true });
  function showMatches(m) {
    lines = [];
    rowOf = new Map();
    for (const f of m.files) {
      rowOf.set(f.id, lines.length);
      lines.push({ f });
      for (const l of f.lines) lines.push({ l });
    }
    const wide = lines.reduce((w, r) => Math.max(w, r.f ? `${r.f.repo}/${r.f.path}`.length + 12 : r.l.text.length + 5), 0);
    spacer.style.setProperty("height", `${lines.length * ROW}px`);
    spacer.style.setProperty("width", `calc(${wide}ch + 36px)`);
    list.style.height = `${Math.min(Math.max(lines.length, 1) * ROW, 10 * ROW)}px`;
    list.hidden = lines.length === 0;
    list.scrollTop = 0;
    renderRows();
  }

  // One query through the binary: plan, the posting list of every trigram not read yet, candidates, match.
  let calls = 0;
  async function run(p, source) {
    const t0 = performance.now();
    let plan;
    try {
      plan = await demo.call("plan", p);
      calls++;
    } catch (err) {
      if (source === "tour") return;
      typed = p.q;
      mine = true;
      mode = "error";
      status.textContent = err.message;
      status.classList.add("ga-err");
      root.classList.add("ga-stale");
      kick();
      return;
    }
    const t1 = performance.now();
    const tris = [];
    const walk = (n) => { for (const t of n.tri || []) tris.push(t); for (const s of n.sub || []) walk(s); };
    walk(plan.query);
    let read = 0;
    for (const t of tris) {
      if (post.has(t.t)) continue;
      if (t.files === 0) { post.set(t.t, []); continue; }
      const tq = triQuery(t.t);
      if (!tq || read >= FETCH_CAP) continue;
      const r = await demo.call("candidates", tq);
      calls++;
      read++;
      post.set(t.t, r.ids);
      if (want) return;
    }
    const t2 = performance.now();
    if (want) return;
    const f = await demo.call("candidates", p);
    const t3 = performance.now();
    if (want) return;
    const m = await demo.call("match", p);
    const t4 = performance.now();
    calls += 2;
    mine = source === "you";
    render(p, plan, f, m, { plan: t1 - t0, lists: t2 - t1, index: t3 - t2, verify: t4 - t3, total: t4 - t0, read });
  }

  function render(p, plan, f, m, t) {
    status.classList.remove("ga-err");
    root.classList.remove("ga-stale");
    typed = p.q;
    mode = plan.query.op === "all" || plan.query.op === "none" ? plan.query.op : "plan";
    rootOp = plan.query.op;
    const { out, total } = planRows(plan);
    setRows(out);
    setBrackets(out);
    const cands = new Set(f.ids);
    const hits = new Map(m.files.map((x) => [x.id, x]));
    last = { cands, hits };
    // grepall reads a shard's rarest lists first and stops at 16 or fewer candidates (earlyStopCands), leaving the
    // rest to the verifier, so a candidate may lack a list. Those are the binary's candidates outside the lists' and/or.
    const full = total !== undefined && !plan.query_more ? new Set(total) : null;
    const early = full ? f.ids.filter((i) => !full.has(i)) : [];
    last.early = new Set(early);
    funnel.cand.want.fill(0);
    for (const i of f.ids) funnel.cand.want[i] = last.early.has(i) ? 0.4 : 1;
    funnel.hit.want.fill(0);
    for (const i of hits.keys()) funnel.hit.want[i] = 1;
    funnel.cand.count = fmt(f.candidates);
    funnel.hit.count = `${m.truncated ? "≥" : ""}${fmt(m.files_matched)}`;
    canvas.dataset.early = String(early.length);

    set("tri", fmt(plan.trigrams));
    set("cand", `${fmt(f.candidates)} · ${size(f.candidate_bytes)}`);
    set("hit", `${m.truncated ? "≥" : ""}${plural(m.files_matched, "file")} · ${plural(m.lines_matched, "line")}`);
    set("read", `${size(m.bytes_scanned)} · ${Math.round((m.bytes_scanned / srcBytes) * 100)}%`);
    set("time", ms(t.total));
    resHead.lastChild.textContent = `${plural(m.lines_matched, "line")} in ${plural(m.files_matched, "file")}` +
      (m.truncated ? `, stopped at ${fmt(m.max_lines)} lines` : "");
    const lists = out.filter((r) => r.kind === "tri");
    status.textContent = `${fmt(N)} files → ${plural(f.candidates, "candidate")} (index, ${ms(t.index)}) → ` +
      `${m.truncated ? "at least " : ""}${plural(m.files_matched, "matching file")} (verify, ${ms(t.verify)}). ` +
      (f.full_scan ? "Full scan: the index could not rule any file out." :
        `The index ruled out ${plural(N - f.candidates, "file")} without reading them` +
        (early.length ? `; ${plural(early.length, "candidate")} lacking a list got through because the index stops intersecting at 16 or fewer candidates in a shard; ${m.truncated ? "they are left to the verifier" : `the verifier rejected ${early.length === 1 ? "it" : "them"}`}.` : "."));
    receipt.textContent = `${fmt(N)} files indexed into ${plural(pkgs.length, "shard")} in ${ms(buildMs)}. This query took ${ms(t.total)}: planned, ` +
      `${t.read ? `${plural(t.read, "new posting list")} read, ` : ""}${plural(f.candidates, "candidate")} verified, ${size(m.bytes_scanned)} scanned.`;
    canvas.setAttribute("aria-label", `Index board for ${p.q}: ` +
      (lists.length ? `posting lists ${lists.slice(0, 12).map((r) => `${r.label} ${r.count}`).join(", ")}${lists.length > 12 ? ", …" : ""}; ` : "no posting list narrows it; ") +
      `${fmt(f.candidates)} of ${fmt(N)} files are candidates, ${fmt(m.files_matched)} matched.`);
    treeBox.replaceChildren(el("h3", "ga-h", "parse · regexp/syntax, simplified"), plan.tree ? parseTree(plan.tree, plan.tree_more)
      : el("p", "demo-note", "no content pattern: only the filters select files"));
    planBox.replaceChildren(el("h3", "ga-h", `plan · ${plural(plan.trigrams, "trigram")} · ${ms(t.plan)}`), queryTree(plan.query, plan.query_more));
    dsum.textContent = `planner: ${plan.literal ? "literal" : "regexp"} ${plan.fold_case ? "folding case" : "case-sensitive"}, ${plural(plan.trigrams, "trigram")}`;
    readout.textContent = describe(sel);
    showMatches(m);
    kick();
  }

  // One query at a time; typing faster than the pipeline keeps only the latest.
  let want = null;
  let running = null;
  let waiters = [];
  const params = () => ({ q: q.value, regex: re.checked, case: cs.value });
  function request(source) {
    want = { p: params(), source };
    const done = new Promise((r) => waiters.push(r));
    if (!running) {
      running = (async () => {
        try {
          while (want) {
            const { p, source: s } = want;
            want = null;
            await run(p, s);
          }
        } finally {
          running = null;
          const w = waiters;
          waiters = [];
          w.forEach((r) => r());
        }
      })();
    }
    return done.then(() => running);
  }
  const fail = (err) => {
    status.textContent = err.message;
    status.classList.add("ga-err");
  };
  const setQuery = (text, regex) => {
    q.value = text;
    re.checked = regex;
    cs.value = "auto";
  };
  q.addEventListener("input", () => { setPlaying(false); tourGen++; mark(-1); cap.textContent = "your query: the board re-runs on every keystroke."; request("you").catch(fail); });
  for (const c of [re, cs]) c.addEventListener("change", () => { setPlaying(false); tourGen++; request("you").catch(fail); });

  // The tour: type each query one key at a time, every prefix a real run.
  let playing = !reduce.matches;
  let touring = false;
  let tourGen = 0;
  let stop = 0;
  const whenVisible = async () => { while (!visible || document.hidden) await sleep(250); };
  async function tourStop(i, gen) {
    const [label, text, regex, why] = TOUR[i];
    mark(i);
    cap.textContent = `tour ${i + 1} of ${TOUR.length} · ${label}: ${why}`;
    re.checked = regex;
    cs.value = "auto";
    touring = true;
    kick();
    try {
      for (let n = 1; n <= text.length; n++) {
        await whenVisible();
        if (gen !== tourGen) return false;
        const t0 = performance.now();
        q.value = text.slice(0, n);
        await request(n === text.length ? "end" : "tour");
        if (gen !== tourGen) return false;
        await sleep(Math.max(0, KEY_MS - (performance.now() - t0)));
      }
    } finally {
      touring = false;
    }
    return gen === tourGen;
  }
  async function tour(gen) {
    while (gen === tourGen && playing) {
      if (!(await tourStop(stop, gen))) return;
      await sleep(DWELL_MS);
      await whenVisible();
      if (gen !== tourGen || !playing) return;
      stop = (stop + 1) % TOUR.length;
    }
  }
  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
  }
  play.addEventListener("click", () => {
    setPlaying(!playing);
    tourGen++;
    if (playing) {
      if (q.value === TOUR[stop][1]) stop = (stop + 1) % TOUR.length;
      tour(tourGen).catch(fail);
    }
  });
  next.addEventListener("click", () => {
    const wasPlaying = playing;
    tourGen++;
    const gen = tourGen;
    stop = (stop + 1) % TOUR.length;
    if (wasPlaying) { tour(gen).catch(fail); return; }
    tourStop(stop, gen).catch(fail);
  });
  reset.addEventListener("click", () => {
    tourGen++;
    stop = 0;
    setPlaying(!reduce.matches);
    if (playing) tour(tourGen).catch(fail);
    else { setQuery(TOUR[0][1], TOUR[0][2]); mark(0); cap.textContent = `tour 1 of ${TOUR.length} · ${TOUR[0][0]}: ${TOUR[0][3]}`; request("end").catch(fail); }
  });

  const redraw = () => { readColors(); kick(); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  addEventListener("themechange", redraw);
  new ResizeObserver(() => { if (!root.isConnected) return; layout(); relayout(); renderRows(); kick(); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  reduce.addEventListener("change", () => { if (reduce.matches) { setPlaying(false); tourGen++; } });
  setPlaying(playing);
  layout();

  // Build the index, shard by shard, each landing as a bar over its files.
  const controls = [q, re, cs, ...presetBtns, play, next, reset];
  for (const c of controls) c.disabled = true;
  cap.textContent = "building the index: one shard per package, each a bar as tall as its trigram count.";
  set("files", `0 / ${fmt(N)}`);
  const buildOne = async () => {
    const t0 = performance.now();
    const b = await demo.call("build", {});
    buildMs += performance.now() - t0;
    calls++;
    const p = pkgs[b.built - 1];
    Object.assign(p, { tri: b.trigrams, shard: b.shard_bytes, built: true, at: reduce.matches ? 0 : performance.now() });
    for (let i = p.from; i < p.from + p.n; i++) funnel.files.want[i] = 1;
    builtFiles += b.files;
    srcBytes += b.bytes;
    shardBytes += b.shard_bytes;
    trigrams += b.trigrams;
    funnel.files.count = fmt(builtFiles);
    set("files", b.ready ? fmt(N) : `${fmt(builtFiles)} / ${fmt(N)}`);
    set("bytes", size(srcBytes));
    set("lists", fmt(trigrams));
    status.textContent = `Indexing shard ${b.built} of ${b.total}: ${b.repo}, ${plural(b.files, "file")}, ${fmt(b.trigrams)} trigrams.`;
    kick();
    return b;
  };
  const finishBuild = async () => {
    for (;;) {
      const t0 = performance.now();
      const b = await buildOne();
      if (b.ready) break;
      if (!reduce.matches) await sleep(Math.max(0, SHARD_MS - (performance.now() - t0)));
    }
    receipt.textContent = `${fmt(N)} files indexed into ${plural(pkgs.length, "shard")} in ${ms(buildMs)}, from ${size(srcBytes)} of source to ${size(shardBytes)} of shards.`;
    mode = "plan";
    for (const c of controls) c.disabled = false;
    if (playing) return tour(tourGen);
    stop = FINAL;
    setQuery(TOUR[FINAL][1], TOUR[FINAL][2]);
    mark(FINAL);
    cap.textContent = `${TOUR[FINAL][0]}: ${TOUR[FINAL][3]}`;
    return request("end");
  };

  // Resolve once the first shard is on the board; the rest of the build and the tour run on from here.
  await buildOne();
  draw(performance.now());
  finishBuild().catch(fail);
}
