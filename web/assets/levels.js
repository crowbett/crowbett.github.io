// The numbers page's levels: every byte of every binary, one level per open.
// The page holds the levels down to each binary; opening one fetches its tree
// (/bytes/<slug>.json, written by cmd/wasm tree) and each deeper level is
// drawn the first time it opens. A function opens onto its own instructions,
// decoded by disasm.js from the binary the demo runs.
const fmt = (n) => n.toLocaleString("en-US");
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const SVG = "http://www.w3.org/2000/svg";

function share(part, whole) {
  const f = whole ? part / whole : 0;
  return { text: f > 0 && f < 0.001 ? "<0.1%" : `${(100 * f).toFixed(1)}%`, pct: (100 * f).toFixed(2) };
}

function cells(row, name, note, bytes, funcs, s) {
  const n = el("span", "lv-n", name);
  if (note) n.append(" ", el("span", "lv-x", note));
  const sc = el("span", "lv-s", s.text);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 4");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const r = document.createElementNS(SVG, "rect");
  r.setAttribute("width", s.pct);
  r.setAttribute("height", "4");
  svg.append(r);
  sc.append(svg);
  row.append(n, el("span", "lv-b", fmt(bytes)), el("span", "lv-f", funcs ? fmt(funcs) : "–"), sc);
}

const depth = (d) => `d${Math.min(d, 9)}`;

// A tree's context: the binary's slug, sizes, separator and a name per function index.
function ctxOf(host, tree) {
  const sep = tree.kind === "go" ? "/" : "::";
  const names = new Map();
  const walk = (n, parent) => {
    if (n.i != null) names.set(n.i, parent ? `${parent}${tree.kind === "go" ? "." : "::"}${n.n}` : n.n);
    const own = n.n.startsWith("names withheld") ? "" : n.n.split(sep).pop();
    for (const k of n.k ?? []) walk(k, n.i == null && n.k ? own : parent);
  };
  walk(tree.tree, "");
  return { slug: tree.slug, bytes: tree.bytes, gz: Number(host.dataset.gz) || 0, names };
}

function rowsOf(node, d, ctx) {
  const out = [];
  for (const k of node.k ?? []) out.push(level(k, node.b, d, ctx));
  if (node.o) {
    const r = el("p", `lv-r lv-o ${depth(d)}`);
    cells(r, `${fmt(node.o.c)} more`, "smaller than the ones above", node.o.b, node.o.f, share(node.o.b, node.b));
    out.push(r);
  }
  return out;
}

function level(n, whole, d, ctx) {
  const s = share(n.b, whole);
  if (n.k || n.o) {
    const det = el("details", "lv-d");
    const sum = el("summary", `lv-r ${depth(d)}`);
    cells(sum, n.n, null, n.b, n.f, s);
    det.append(sum);
    det.addEventListener("toggle", () => {
      if (det.open && !det.dataset.drawn) {
        det.dataset.drawn = "";
        det.append(...rowsOf(n, d + 1, ctx));
      }
    });
    return det;
  }
  if (n.i == null) {
    const r = el("p", `lv-r lv-leaf ${depth(d)}`);
    cells(r, n.n, n.n === "Data" ? "strings, tables and type information the code reads" : null, n.b, n.f, s);
    return r;
  }
  const wrap = el("div", "lv-fnw");
  const b = el("button", `lv-r lv-fn ${depth(d)}`);
  b.type = "button";
  b.setAttribute("aria-expanded", "false");
  cells(b, n.n, n.f > 1 ? `${n.f} copies` : null, n.b, n.f, s);
  b.dataset.fn = String(n.i);
  wrap.append(b);
  b.addEventListener("click", () => instructions(wrap, b, n, d + 1, ctx));
  return wrap;
}

const binaries = new Map();
function binary(slug) {
  if (!binaries.has(slug)) {
    binaries.set(slug, fetch(`/wasm/${slug}.wasm`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    }));
  }
  return binaries.get(slug);
}

async function instructions(wrap, b, n, d, ctx) {
  const open = b.getAttribute("aria-expanded") === "true";
  b.setAttribute("aria-expanded", String(!open));
  let panel = wrap.querySelector(".lv-asm");
  if (open) {
    panel.hidden = true;
    return;
  }
  if (panel) {
    panel.hidden = false;
    return;
  }
  panel = el("div", `lv-asm ${depth(d)}`);
  const status = el("p", "lv-st", `Fetching ${ctx.slug}.wasm, ${fmt(ctx.bytes)} bytes${ctx.gz ? ` (${fmt(ctx.gz)} over the wire)` : ""}…`);
  status.setAttribute("role", "status");
  panel.append(status);
  wrap.append(panel);
  try {
    const [{ disassemble }, buf] = await Promise.all([import("/assets/disasm.js"), binary(ctx.slug)]);
    const t0 = performance.now();
    const fn = disassemble(buf, n.i, ctx.names);
    const ms = performance.now() - t0;
    status.textContent = `${fmt(fn.size)} bytes at 0x${fn.at.toString(16)} in ${ctx.slug}.wasm: ${fmt(fn.lines.length)} instructions, decoded here in ${ms < 1 ? "<1" : Math.round(ms)} ms.`;
    panel.dataset.lines = String(fn.lines.length);
    const pre = el("pre", "lv-pre");
    pre.tabIndex = 0;
    pre.setAttribute("role", "region");
    pre.setAttribute("aria-label", `Instructions of ${n.n}`);
    const head = el("code", "lv-sig", `func ${ctx.names.get(n.i) ?? n.n} ${fn.sig}${fn.locals ? `\n  ${fn.locals}` : ""}\n`);
    pre.append(head);
    const body = el("code");
    const draw = (upto) => {
      body.textContent = fn.lines.slice(0, upto).map(line).join("\n");
    };
    const first = 400;
    draw(first);
    pre.append(body);
    panel.append(pre);
    if (fn.lines.length > first) {
      const more = el("button", "lv-more", `Show all ${fmt(fn.lines.length)}`);
      more.type = "button";
      more.addEventListener("click", () => { draw(fn.lines.length); more.remove(); });
      panel.append(more);
    }
    if (fn.stopped) panel.append(el("p", "lv-st", fn.stopped));
  } catch (e) {
    status.textContent = `Could not decode this function: ${e.message}`;
  }
}

// Narrow screens drop each instruction's bytes and indent less, so the text fits.
const narrow = matchMedia("(width < 40rem)");
const line = (l) => narrow.matches
  ? `${l.at.toString(16).padStart(7, "0")}  ${" ".repeat(Math.min(l.depth, 8))}${l.text}`
  : `${l.at.toString(16).padStart(7, "0")}  ${l.hex.padEnd(20)}${"  ".repeat(Math.min(l.depth, 12))}${l.text}`;

const trees = new Map();
function treeOf(host) {
  const slug = host.dataset.tree;
  if (!trees.has(slug)) {
    trees.set(slug, fetch(`/bytes/${slug}.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).then((tree) => ({ tree, ctx: ctxOf(host, tree) })));
  }
  return trees.get(slug);
}

// lazy draws det's level the first time it opens, from host's tree.
function lazy(det, host, d, find) {
  det.addEventListener("toggle", async () => {
    if (!det.open || det.dataset.drawn != null) return;
    det.dataset.drawn = "";
    det.querySelector(":scope > .lv-st")?.remove();
    const status = el("p", `lv-st ${depth(d)}`, `Opening ${host.dataset.tree}…`);
    status.setAttribute("role", "status");
    det.append(status);
    try {
      const { tree, ctx } = await treeOf(host);
      status.remove();
      det.append(...rowsOf(find(tree.tree), d, ctx));
      det.dataset.loaded = "";
    } catch (e) {
      trees.delete(host.dataset.tree);
      status.textContent = `Could not open this level: ${e.message}`;
      delete det.dataset.drawn;
    }
  });
}

// A binary row opens onto its whole tree; a project page renders the
// binary's origins and each opens onto its own part.
for (const host of document.querySelectorAll("[data-levels] details[data-tree]")) {
  for (const note of host.querySelectorAll(".lv-note")) note.remove();
  const origins = host.querySelectorAll(":scope > details[data-origin]");
  if (origins.length === 0) lazy(host, host, 3, (t) => t);
  for (const o of origins) lazy(o, host, 2, (t) => t.k.find((k) => k.n === o.dataset.origin));
}
