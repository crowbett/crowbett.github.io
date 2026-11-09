// AnchorFlow demo: the demo org's shipping floor on AnchorFlow's own code,
// compiled to WebAssembly. Each cart is routed through the bins in walk order
// with scannable bin labels, each order is packed by the suggestion pyramid
// over a shape model learned from every shipment so far, and its 4x6 label and
// packing slip are drawn here from the ZPL the binary returns.
const SPEEDS = [1, 2, 4];
const CART = 4;
const STOP_MS = 700;
const PACK_MS = 2800;
const DROP_MS = 240;
const SEED = 1;
const MAX_POS = 168;
const STAGES = [["order", 0], ["pick", 0], ["pack", 0], ["label", 0], ["manifest", 1], ["writeback", 1]];
const KIND = { box: "box", poly_mailer: "poly mailer", poly_bubble_mailer: "bubble mailer", bubble_bag: "bubble bag", tube: "tube" };
const SOURCE = { fit: "the fit engine", shape: "shape history", fit_open: "the fit engine, any package", shape_kinds: "fallback", shape_band: "fallback", shape_org: "fallback" };
const isMailer = (k) => k === "poly_mailer" || k === "poly_bubble_mailer";
// Code 128 bar and space widths, symbols 0-105, then the stop symbol.
const C128 = "212222222122222221121223121322131222122213122312132212221213221312231212112232122132122231113222123122123221223211221132221231213212223112312131311222321122321221312212322112322211212123212321232121111323131123131321112313132113132311211313231113231311112133112331132131113123113321133121313121211331231131213113213311213131311123311321331121312113312311332111314111221411431111111224111422121124121421141122141221112214112412122114122411142112142211241211221114413111241112134111111242121142121241114212124112124211411212421112421211212141214121412121111143111341131141114113114311411113411311113141114131311141411131211412211214211232";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const pct = (n) => `${Math.round(n * 100)} %`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

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

// code128 encodes text as symbol values: subset B, switching to C for runs of
// four or more digits, then the check symbol.
function code128(s) {
  const run = (i) => { let j = i; while (j < s.length && s[j] >= "0" && s[j] <= "9") j++; return j - i; };
  const out = [];
  let set = run(0) >= 4 ? "C" : "B";
  out.push(set === "C" ? 105 : 104);
  for (let i = 0; i < s.length;) {
    const n = run(i);
    if (set === "B" && n >= 4) { out.push(99); set = "C"; }
    if (set === "C") {
      if (n >= 2) { out.push(Number(s.slice(i, i + 2))); i += 2; continue; }
      out.push(100); set = "B";
    }
    out.push(s.charCodeAt(i) - 32);
    i++;
  }
  out.push(out.reduce((a, v, i) => a + v * (i || 1), 0) % 103);
  return out;
}

// gfa decodes ^GFA data (Zebra ASCII compression) into rows of bits.
function gfa(data, bpr) {
  const rows = [];
  let row = "", count = 0;
  const hex = bpr * 2;
  const end = () => { rows.push(row); row = ""; };
  for (const ch of data) {
    const c = ch.charCodeAt(0);
    if (c >= 71 && c <= 89) count += c - 70;
    else if (c >= 103 && c <= 122) count += (c - 102) * 20;
    else if (/[0-9A-F]/.test(ch)) { row += ch.repeat(count || 1); count = 0; if (row.length >= hex) end(); }
    else if (ch === ",") { row = row.padEnd(hex, "0"); end(); }
    else if (ch === "!") { row = row.padEnd(hex, "F"); end(); }
    else if (ch === ":") { row = rows[rows.length - 1] || "0".repeat(hex); end(); }
  }
  return rows;
}

// zpl draws a ZPL label onto a canvas context in dots: the commands
// AnchorFlow's labels use (^FO ^GB ^FB ^A0 ^CF ^FR ^FD ^GFA ^BY ^BC).
function zpl(ctx, src, sans) {
  let x = 0, y = 0, fh = 30, block = null, rev = false, by = { m: 2, h: 10 }, bc = null;
  for (const raw of src.split("^").slice(1)) {
    const cmd = raw.slice(0, 2), arg = raw.slice(2);
    const a = arg.split(",");
    if (cmd === "FO") { x = Number(a[0]); y = Number(a[1]); }
    else if (cmd === "CF") fh = Number(a[1]) || fh;
    else if (cmd === "A0") fh = Number(a[1]) || fh;
    else if (cmd === "FB") block = { w: Number(a[0]), align: a[3] };
    else if (cmd === "FR") rev = true;
    else if (cmd === "BY") by = { m: Number(a[0]) || 2, h: Number(a[2]) || 10 };
    else if (cmd === "BC") bc = { h: Number(a[1]) || by.h, line: a[2] !== "N" };
    else if (cmd === "GB") {
      const w = Number(a[0]), h = Number(a[1]), t = Math.min(Number(a[2]) || 1, w, h);
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, w, t); ctx.fillRect(x, y + h - t, w, t); ctx.fillRect(x, y, t, h); ctx.fillRect(x + w - t, y, t, h);
    } else if (cmd === "GF") {
      const bpr = Number(a[3]);
      const rows = gfa(a.slice(4).join(","), bpr);
      ctx.fillStyle = "#000";
      rows.forEach((r, j) => {
        let from = -1;
        for (let i = 0; i <= r.length * 4; i++) {
          const on = i < r.length * 4 && parseInt(r[i >> 2], 16) & (8 >> (i & 3));
          if (on && from < 0) from = i;
          if (!on && from >= 0) { ctx.fillRect(x + from, y + j, i - from, 1); from = -1; }
        }
      });
    } else if (cmd === "FD") {
      const text = arg;
      if (bc) {
        let cx = x;
        ctx.fillStyle = "#000";
        for (const v of code128(text)) {
          const w = C128.slice(v * 6, v * 6 + 6);
          for (let i = 0; i < 6; i++) { if (i % 2 === 0) ctx.fillRect(cx, y, Number(w[i]) * by.m, bc.h); cx += Number(w[i]) * by.m; }
        }
        for (let i = 0; i < 7; i++) { const w = Number("2331112"[i]); if (i % 2 === 0) ctx.fillRect(cx, y, w * by.m, bc.h); cx += w * by.m; }
        if (bc.line) {
          ctx.font = `400 ${Math.round(by.m * 9)}px ${sans}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(text, (x + cx) / 2, y + bc.h + 4);
        }
      } else {
        ctx.font = `700 ${fh}px ${sans}`;
        ctx.textBaseline = "top";
        ctx.fillStyle = rev ? "#fff" : "#000";
        if (block && block.align === "C") { ctx.textAlign = "center"; ctx.fillText(text, x + block.w / 2, y, block.w); }
        else { ctx.textAlign = "left"; ctx.fillText(text, x, y); }
      }
    } else if (cmd === "FS") { block = null; rev = false; bc = null; }
  }
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

  let calls = 0, callMs = 0, chain = Promise.resolve(), busy = 0, gen = 0;
  const exec = (method, params) => {
    busy++;
    const run = chain.then(async () => {
      const t0 = performance.now();
      try {
        return await demo.call(method, params);
      } finally {
        callMs += performance.now() - t0;
        calls++;
      }
    }).finally(() => { busy--; });
    chain = run.catch(() => {});
    return run;
  };

  let info = await exec("reset", { seed: SEED });
  const storeName = (code) => info.stores.find((s) => s.Code === code)?.Name || code;

  // Controls.
  const play = button("Pause");
  const step = button("Next step", "secondary");
  const reset = button("Reset", "secondary");
  const mix = select("orders", [["", "all four stores"], ...info.stores.map((s) => [s.Code, s.Name]), ["repeat", "the same basket again"]], "");
  const use = select("packer", [["", "the suggestion"], ...info.packages.map((p) => [p.name, `${p.name} (${KIND[p.kind] || p.kind})`])], "");
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 1);
  const acts = el("div", "af-acts");
  acts.append(play, step, reset, field("orders", mix), field("packer takes", use, "af-pack"), field("speed", speed));
  const sku = select("sku", info.products.map((p) => [p.sku, `${p.sku} · ${p.name}`]), "LNT-PIN-COMPASS");
  const bin = el("input");
  Object.assign(bin, { type: "text", name: "bin", value: "A-01-012-C", spellcheck: false, autocomplete: "off" });
  const move = button("Move", "secondary");
  const slot = el("div", "af-slot");
  slot.append(field("re-slot a product", sku, "af-sku"), field("to bin", bin, "af-bin"), move);
  const form = el("form", "af-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(acts, slot);

  const stages = el("ol", "af-stages");
  stages.setAttribute("aria-label", "Order flow");
  const stage = {};
  for (const [k, server] of STAGES) {
    const li = el("li", null, server ? `${k} · server only` : k);
    if (server) li.dataset.server = "";
    stage[k] = li;
    stages.append(li);
  }
  const map = el("canvas", "af-map");
  map.setAttribute("role", "img");
  const legend = el("p", "demo-legend af-legend");
  for (const [k, t] of [["bin", "product bin"], ["cart", "in this cart"], ["picked", "picked"], ["picker", "picker"], ["zone", "hat zone"]]) {
    const s = el("span", "af-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const now = el("p", "af-now");

  const packH = el("h3", "af-h", "pack");
  const orderLine = el("p", "af-order");
  const lines = el("ul", "af-lines");
  lines.setAttribute("aria-label", "Order lines");
  const ladder = el("ol", "af-ladder");
  ladder.setAttribute("aria-label", "Suggestion pyramid for this order");
  const why = el("p", "af-why");
  why.setAttribute("aria-live", "polite");
  const box = el("canvas", "af-box");
  box.setAttribute("role", "img");
  const acc = el("p", "af-acc", "The shape-history tiers are ordered by measured accuracy, on 25,021 shipments with train and test disjoint in time: same basket " +
    "(sku+qty) 98.6% > same shape (class+qty) 89.1% > same kinds (class set) 67.0% (internal/packsuggest/shape_key.go, line 1). Only the first two answer live.");
  const pack = el("section");
  pack.append(packH, orderLine, lines, ladder, why);
  const boxFig = el("section");
  boxFig.append(el("h3", "af-h", "package · packfit.PlanFor"), box);
  const labelH = el("h3", "af-h", "label");
  const tabs = el("div", "af-tabs");
  const tabLabel = button("4x6 label"), tabSlip = button("packing slip", "secondary");
  for (const b of [tabLabel, tabSlip]) tabs.append(b);
  const label = el("canvas", "af-label");
  label.setAttribute("role", "img");
  const cap = el("p", "af-cap");
  const print = el("section");
  print.append(labelH, tabs, label, cap);
  const pair = el("div", "af-pair");
  pair.append(boxFig, print);
  const bench = el("div", "af-bench");
  bench.append(pack, pair, acc);

  const cells = el("ul", "cells stack af-cells");
  const cell = {};
  for (const [k, t] of [["shipped", "shipped"], ["carts", "carts"], ["stops", "stops walked"], ["fit", "by fit"], ["shape", "by shape history"],
    ["fit_open", "by fit, any package"], ["fallback", "by fallback"], ["keys", "model keys"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "af-v", "0");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const status = el("p", "af-status");
  status.setAttribute("aria-live", "polite");
  const receipt = el("p", "demo-out af-out");
  root.replaceChildren(form, stages, map, legend, now, bench, cells, status, receipt);

  // State.
  let products = new Map(info.products.map((p) => [p.sku, p]));
  let cart = null; // {n, orders, stops, at, leg, legT0, path, packed}
  let cur = null; // {order, r, t0}
  let carts = 0, stops = 0, last = null, sheet = "label";
  let playing = !reduce.matches, visible = true, raf = 0, prev = 0, wait = 0;
  let colors = null, M = null, B = null;

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"),
      text3: v("--text-3"), accent: v("--accent"), tint: v("--accent-tint"), live: v("--live"), signal: v("--signal"),
      mono: v("--mono") || "monospace", sans: v("--sans") || "sans-serif",
    };
  }
  const lineColor = (i) => [colors.accent, colors.live, colors.signal][i] || colors.text2;

  function size(c, H, min = 280) {
    const W = Math.max(min, c.clientWidth);
    c.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    return W;
  }
  function layout() {
    const narrow = map.clientWidth < 560;
    const rowH = narrow ? 30 : 34, top = 22, padL = narrow ? 48 : 52, padR = 10;
    const floorB = top + info.aisles.length * rowH;
    const toteY = floorB + 38;
    const H = toteY + 46;
    const W = size(map, H);
    M = { W, H, narrow, rowH, top, padL, padR, floorB, toteY, front: padL - 14, dock: { x: padL - 14, y: floorB + 10 } };
    const lh = Math.round((Math.max(120, label.clientWidth) * 1218) / 812);
    size(label, lh, 120);
    // Side by side with the label, the package drawing takes the label's height.
    const bw = Math.max(280, box.clientWidth);
    B = { W: bw, H: bw < 520 ? 150 : root.classList.contains("af-wide") ? Math.max(180, lh) : 180 };
    size(box, B.H);
    if (cart) cart.path = route(cart.stops);
  }
  const px = (pos) => M.padL + ((pos - 1) / (MAX_POS - 1)) * (M.W - M.padL - M.padR);
  const aisleIdx = (k) => info.aisles.findIndex((a) => a.key === k);
  const rackY = (i) => M.top + i * M.rowH + 6;
  const walkY = (i) => rackY(i) + 16;

  // route is the picker's walk: from the pack station up the front cross-aisle
  // into each aisle, along it to each stop in turn, and back.
  function route(list) {
    const legs = [];
    let p = { ...M.dock }, ai = -1;
    for (const s of list) {
      const i = aisleIdx(s.bin.aisle);
      const to = { x: px(s.bin.pos), y: walkY(i) };
      const pts = [p];
      if (i !== ai) { pts.push({ x: M.front, y: p.y }, { x: M.front, y: to.y }); }
      pts.push(to);
      legs.push(pts);
      p = to; ai = i;
    }
    legs.push([p, { x: M.front, y: p.y }, { ...M.dock }]);
    return legs;
  }
  // cut is the part of a leg walked by t (0 to 1), as points.
  const cut = (pts, t) => {
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
    let at = total * Math.min(1, Math.max(0, t));
    const out = [pts[0]];
    for (let i = 0; i < seg.length; i++) {
      if (at <= seg[i]) { const f = seg[i] ? at / seg[i] : 1; out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }); return out; }
      at -= seg[i];
      out.push(pts[i + 1]);
    }
    return out;
  };

  function drawMap(ts) {
    if (!M || !colors) return;
    const c = colors, ctx = map.getContext("2d"), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, M.W, M.H);
    const font = (p, w = 400) => `${w} ${p}px ${c.mono}`;
    ctx.font = font(10);
    ctx.fillStyle = c.text3;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(M.narrow ? "floor · bins 1–168" : "floor · aisles A-01 to A-05, bins 1–168 · walk order: aisle, then bin", 4, 13);
    const inCart = new Map(), done = new Set();
    if (cart) cart.stops.forEach((s, i) => { inCart.set(s.bin.raw, i); if (i < cart.at) done.add(s.bin.raw); });
    info.aisles.forEach((a, i) => {
      const y = rackY(i);
      ctx.fillStyle = c.text2;
      ctx.font = font(10, 600);
      ctx.fillText(a.key, 4, y + 9);
      for (const z of info.zones.filter((z) => z.aisle === a.key)) {
        ctx.fillStyle = c.tint;
        ctx.fillRect(px(z.min_pos), y - 2, px(z.max_pos) - px(z.min_pos), 14);
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(px(z.min_pos) + 0.5, y - 1.5, px(z.max_pos) - px(z.min_pos) - 1, 13);
      }
      ctx.fillStyle = c.line;
      ctx.fillRect(M.padL, y + 3, M.W - M.padL - M.padR, 4);
      if (a.odd_only && !M.narrow) { ctx.fillStyle = c.text3; ctx.font = font(9); ctx.textAlign = "right"; ctx.fillText("odd bins only", M.W - M.padR, y - 3); ctx.textAlign = "left"; }
    });
    for (const p of products.values()) {
      const i = aisleIdx(p.bin.aisle);
      if (i < 0) continue;
      const k = inCart.get(p.bin.raw);
      const on = k !== undefined;
      ctx.fillStyle = done.has(p.bin.raw) ? c.live : on ? c.accent : c.text3;
      const x = px(p.bin.pos), y = rackY(i);
      ctx.fillRect(x - (on ? 2.5 : 1.5), y + (on ? -1 : 1), on ? 5 : 3, on ? 12 : 8);
    }
    if (cart) {
      const legs = cart.path;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = c.strong;
      ctx.beginPath();
      for (const pts of legs) pts.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const t = cart.legT0 && ts ? (ts - cart.legT0) / (STOP_MS / Number(speed.value)) : 1;
      let w = M.dock;
      for (let k = 0; k < Math.min(cart.at + 1, legs.length); k++) {
        const pts = k < cart.at ? legs[k] : cut(legs[k], t);
        pts.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        w = pts[pts.length - 1];
      }
      ctx.stroke();
      ctx.fillStyle = c.signal;
      ctx.beginPath(); ctx.arc(w.x, w.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = font(10, 600);
      cart.stops.forEach((s, i) => {
        if (M.narrow && i !== cart.at - 1) return;
        const y = rackY(aisleIdx(s.bin.aisle));
        ctx.fillStyle = i < cart.at ? c.live : c.accent;
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), px(s.bin.pos), y - 4);
      });
    }
    ctx.fillStyle = c.text;
    ctx.font = font(10, 600);
    ctx.textAlign = "left";
    ctx.fillText("pack", M.dock.x + 10, M.dock.y + 4);
    ctx.fillStyle = c.surface;
    ctx.fillRect(M.dock.x - 6, M.dock.y - 4, 12, 8);
    // Totes on the cart.
    const n = CART, gap = 6, tw = (M.W - 8 - gap * (n - 1)) / n, ty = M.toteY;
    ctx.font = font(10);
    ctx.fillStyle = c.text3;
    ctx.fillText("cart · one tote per order", 4, ty - 6);
    for (let i = 0; i < n; i++) {
      const x = 4 + i * (tw + gap);
      const o = cart?.orders[i];
      ctx.fillStyle = c.surface;
      ctx.fillRect(x, ty, tw, 40);
      ctx.strokeStyle = o ? c.strong : c.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, ty + 0.5, tw - 1, 39);
      if (!o) continue;
      const need = o.lines.reduce((a, l) => a + l.qty, 0);
      const got = cart.got[o.tote] || 0;
      const shipped = cart.packed.has(o.id);
      ctx.fillStyle = shipped ? c.live : c.accent;
      ctx.globalAlpha = shipped ? 0.35 : 0.22;
      ctx.fillRect(x + 1, ty + 1, ((tw - 2) * got) / need, 38);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text;
      ctx.font = font(10, 600);
      ctx.fillText(`${M.narrow ? "" : `tote ${o.tote} · `}${o.number}`, x + 5, ty + 15);
      ctx.font = font(10);
      ctx.fillStyle = c.text2;
      ctx.fillText(shipped ? "packed" : `${got}/${need}${M.narrow ? "" : " picked"}`, x + 5, ty + 31);
    }
    map.setAttribute("aria-label", cart ? `Floor map: cart ${carts}, ${cart.orders.length} orders, stop ${Math.min(cart.at, cart.stops.length)} of ${cart.stops.length} in walk order.` : "Floor map: no cart out yet.");
  }

  function drawBox(ts) {
    if (!B || !colors) return;
    const c = colors, ctx = box.getContext("2d"), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, B.W, B.H);
    const font = (p, w = 400) => `${w} ${p}px ${c.mono}`;
    const plan = cur?.r.plan;
    ctx.font = font(10);
    ctx.fillStyle = c.text3;
    ctx.textAlign = "left";
    if (!plan) { ctx.fillText(cur ? "nothing to draw" : "no order packed yet", 8, 16); return; }
    const pad = 8, gap = 16, slotW = (B.W - pad * 2 - gap) / 2, room = B.H - 30;
    const L = plan.usableL, Wd = plan.usableW, Hh = plan.usableH;
    const k = Math.min(slotW / L, room / Wd, room / Hh);
    const mail = isMailer(plan.kind);
    const lineOf = cur.r.units.map((u) => cur.order.lines.findIndex((l) => l.sku === u.sku));
    const n = Math.max(1, plan.placements.length);
    const span = Math.min(900, 2000 / Number(speed.value));
    for (const [i, axis] of [[0, "y"], [1, "z"]]) {
      const bw = L * k, bh = (axis === "y" ? Wd : Hh) * k;
      const ox = pad + i * (slotW + gap) + (slotW - bw) / 2, oy = 8 + room - bh;
      ctx.fillStyle = c.surface;
      ctx.strokeStyle = mail ? c.live : c.text2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (mail && ctx.roundRect) ctx.roundRect(ox, oy, bw, bh, Math.min(6, bh / 2)); else ctx.rect(ox, oy, bw, bh);
      ctx.fill();
      ctx.stroke();
      if (axis === "y" && plan.structure) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = c.text3;
        ctx.lineWidth = 1;
        for (const [qx, qy, qw, qh] of plan.structure.cells) ctx.strokeRect(ox + qx * k, oy + qy * k, qw * k, qh * k);
        ctx.setLineDash([]);
      }
      const order = [...plan.placements].sort((p, q) => (axis === "y" ? p.z - q.z : q.y - p.y));
      ctx.save();
      ctx.beginPath(); ctx.rect(ox - 1, 0, bw + 2, oy + bh + 1); ctx.clip();
      for (const p of order) {
        const u = cur.t0 ? (ts - (cur.t0 + (p.seq / n) * span)) / DROP_MS : 1;
        if (u <= 0) continue;
        const e = ease(u), col = lineColor(lineOf[p.index]);
        const x = ox + p.x * k, w = p.dx * k;
        let y, h;
        if (axis === "y") { y = oy + p.y * k; h = p.dy * k; }
        else { h = p.dz * k; const end = oy + bh - (p.z + p.dz) * k; y = end - (1 - e) * (end + h); }
        ctx.globalAlpha = 0.4 * Math.min(1, u * 3);
        ctx.fillStyle = col;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = Math.min(1, u * 3);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.font = font(10);
      ctx.fillStyle = c.text3;
      ctx.textAlign = "center";
      const d = (v) => Number(v.toFixed(2));
      ctx.fillText(`${axis === "y" ? "top" : "front"} · ${d(L)} × ${d(axis === "y" ? Wd : Hh)} in`, pad + i * (slotW + gap) + slotW / 2, B.H - 8);
    }
    box.setAttribute("aria-label", `${plan.name}, ${KIND[plan.kind] || plan.kind}: ${plan.placements.length} of ${plural(cur.r.units.length, "unit", "units")} placed, seen from the top and the front.`);
  }

  function drawLabel() {
    const ctx = label.getContext("2d");
    const s = label.width / 812;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 812, 1218);
    if (!cur?.r.label) { label.setAttribute("aria-label", "No label printed yet."); return; }
    zpl(ctx, sheet === "label" ? cur.r.label : cur.r.slip, colors?.sans || "sans-serif");
    label.setAttribute("aria-label", sheet === "label"
      ? `4 by 6 shipping label for ${cur.order.number}: demo label, not postage, tracking ${cur.r.tracking}.`
      : `Packing slip for ${cur.order.number}: ${cur.order.lines.length} lines with their bins.`);
  }

  function draw(ts) { drawMap(ts); drawBox(ts); }

  function setStage(k) { for (const [n] of STAGES) stage[n].toggleAttribute("data-on", n === k); }

  function showOrder(o, r) {
    packH.textContent = `pack · ${o.number}`;
    orderLine.replaceChildren(el("strong", null, storeName(o.store)), ` · ${o.customer}, ${o.city} · tote ${o.tote}`);
    lines.replaceChildren(...o.lines.map((l, i) => {
      const li = el("li", null, `${l.qty} × ${l.name} (${l.class})`);
      li.dataset.i = String(i);
      return li;
    }));
    renderLadder(r);
    const s = r.suggestion;
    why.replaceChildren();
    if (s) {
      why.append("Suggested ", el("strong", null, s.name), ` by ${SOURCE[s.source] || s.source}: ${s.reason}.`);
      if (r.packed !== s.name) why.append(` The packer took ${r.packed} instead; that is what the model learns from.`);
    } else why.append("No suggestion: a person decides.");
    if (r.plan && !r.plan.packed) why.append(` The drawing seats ${r.plan.placements.length} of ${plural(r.units.length, "unit", "units")}.`);
    cap.textContent = sheet === "label" ? `^XA … ^XZ, ${fmt(r.label.length)} bytes of ZPL · tracking ${r.tracking}` : `^XA … ^XZ, ${fmt(r.slip.length)} bytes of ZPL · picks listed with their bins`;
  }

  // renderLadder lays the pyramid out in the order Suggest walks it, marking
  // the step that answered and why each one before it did not.
  function renderLadder(r) {
    const src = r.suggestion?.source || "", reason = r.suggestion?.reason || "";
    const tier = (g) => info.tiers.find((x) => x.tier === g.tier);
    const detail = (g) => `${g.key} · ${g.box ? `${g.box} ${g.agree}/${g.obs}` : "no history yet"}${g.boxNow ? ` → ${g.boxNow} ${g.agreeNow}/${g.obsNow}` : ""}`;
    const rows = [["rules", "none in the demo org", "", false]];
    let answered = src === "fit";
    rows.push(["fit engine", answered ? "answered" : "declined", "", answered]);
    for (const g of r.rungs.filter((g) => tier(g)?.live)) {
      const t = tier(g);
      let state, on = false;
      if (src === "shape" && reason.startsWith(`${t.name}:`)) { state = "answered"; on = answered = true; }
      else if (answered) state = "not asked";
      else if (!g.box || g.obs < info.minObs) state = `under ${info.minObs} shipped`;
      else if (g.agree / g.obs < info.minShare) state = `under ${pct(info.minShare)} agree`;
      else state = "no answer";
      rows.push([`shape · ${t.name}`, state, detail(g), on]);
    }
    rows.push(["fit, any package", src === "fit_open" ? "answered" : answered ? "not asked" : "declined", "", src === "fit_open"]);
    if (src === "fit_open") answered = true;
    const fb = r.rungs.find((g) => !tier(g)?.live && src.startsWith("shape_") && reason.startsWith(`${tier(g).name}:`));
    rows.push([fb ? `fallback · ${tier(fb).name}` : "fallback", fb ? "answered" : answered ? "not asked" : "no answer", fb ? detail(fb) : "", !!fb]);
    ladder.replaceChildren(...rows.map(([name, state, det, on]) => {
      const li = el("li");
      li.toggleAttribute("data-on", on);
      li.append(el("span", "af-ln", name), el("span", "af-ls", state), el("span", "af-lh", det));
      return li;
    }));
  }

  function updateDom() {
    const src = last?.sources || {};
    cell.shipped.textContent = fmt(last?.shipped || 0);
    cell.carts.textContent = fmt(carts);
    cell.stops.textContent = fmt(stops);
    cell.fit.textContent = fmt(src.fit || 0);
    cell.shape.textContent = fmt(src.shape || 0);
    cell.fit_open.textContent = fmt(src.fit_open || 0);
    cell.fallback.textContent = fmt((src.shape_kinds || 0) + (src.shape_band || 0) + (src.shape_org || 0));
    cell.keys.textContent = fmt(last?.modelKeys || 0);
    receipt.textContent = `${plural(carts, "cart", "carts")} routed and ${plural(last?.shipped || 0, "order", "orders")} packed and labelled by AnchorFlow's code, ` +
      `${plural(calls, "call", "calls")} in ${fmt(Math.round(callMs))} ms; the shape model holds ${plural(last?.modelKeys || 0, "key", "keys")}.`;
    step.disabled = !!busy;
  }

  const fail = (err) => { status.textContent = err.message; };

  async function nextCart() {
    const g = gen;
    const r = await exec("cart", { n: CART, mix: mix.value });
    if (g !== gen) return;
    carts++;
    const at = reduce.matches || !playing ? r.stops.length : 0;
    cart = { ...r, at: 0, got: {}, packed: new Set(), legT0: 0, path: route(r.stops) };
    for (let i = 0; i < at; i++) arrive();
    if (!at) cart.legT0 = performance.now();
    setStage("pick");
    const units = r.orders.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0);
    status.textContent = `Cart ${carts}: ${plural(r.orders.length, "order", "orders")} from ${[...new Set(r.orders.map((o) => storeName(o.store)))].join(", ")}, ` +
      `${plural(units, "unit", "units")} at ${plural(r.stops.length, "stop", "stops")} in walk order.`;
    updateDom();
  }

  function arrive() {
    const s = cart.stops[cart.at];
    for (const p of s.picks) cart.got[p.tote] = (cart.got[p.tote] || 0) + p.qty;
    stops++;
    cart.at++;
    const what = s.picks.map((p) => `${p.qty} × ${products.get(p.sku)?.name || p.sku} into tote ${p.tote}`).join(", ");
    now.replaceChildren(el("span", "af-dim", `stop ${cart.at} of ${cart.stops.length} · ${s.bin.raw}${s.bin.zone ? ` (${s.bin.zone})` : ""} · scanned ${s.scan} · `), what);
  }

  async function packNext() {
    const o = cart.orders.find((x) => !cart.packed.has(x.id));
    if (!o) return;
    const g = gen;
    setStage("pack");
    const r = await exec("pack", { id: o.id, use: use.value });
    if (g !== gen) return;
    cart.packed.add(o.id);
    last = r;
    cur = { order: o, r, t0: reduce.matches || !playing ? 0 : performance.now() };
    showOrder(o, r);
    drawLabel();
    setStage("label");
    now.replaceChildren(el("span", "af-dim", `${o.number} · tote ${o.tote} → `), `${r.packed}, labelled ${r.tracking}`);
    status.textContent = `${o.number} went in ${r.packed}${r.suggestion ? ` (${SOURCE[r.suggestion.source] || r.suggestion.source}: ${r.suggestion.reason})` : ""}.`;
    updateDom();
  }

  // advance runs the floor's next step: a cart out, its walk finished, or the next tote packed.
  async function advance(animated) {
    if (!cart || cart.packed.size === cart.orders.length) return nextCart();
    if (cart.at < cart.stops.length) {
      if (!animated) { while (cart.at < cart.stops.length) arrive(); cart.legT0 = 0; updateDom(); }
      return;
    }
    return packNext();
  }

  function frame(ts) {
    raf = 0;
    const dt = prev ? Math.min(100, ts - prev) : 16;
    prev = ts;
    if (playing && !busy) {
      const sp = Number(speed.value);
      if (cart && cart.at < cart.stops.length) {
        if (!cart.legT0) cart.legT0 = ts;
        if (ts - cart.legT0 >= STOP_MS / sp) { arrive(); cart.legT0 = ts; updateDom(); }
      } else if (cart && cart.at === cart.stops.length && cart.legT0 && ts - cart.legT0 < STOP_MS / sp) {
        // walking back to the pack station
      } else if ((wait -= dt * sp) <= 0) {
        // A pack holds the bench for PACK_MS; a new cart sets off at once.
        wait = cart && cart.packed.size < cart.orders.length ? PACK_MS : 0;
        if (cart) cart.legT0 = 0;
        advance(true).catch(fail);
      }
    }
    draw(ts);
    if ((playing || (cur?.t0 && ts - cur.t0 < 2200)) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else prev = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) { wait = 0; kick(); }
  }

  async function restart() {
    gen++;
    status.textContent = "";
    await chain;
    info = await exec("reset", { seed: SEED });
    products = new Map(info.products.map((p) => [p.sku, p]));
    cart = null; cur = null; last = null; carts = 0; stops = 0; wait = 0;
    packH.textContent = "pack";
    orderLine.textContent = "";
    lines.replaceChildren();
    ladder.replaceChildren();
    why.textContent = "";
    cap.textContent = "";
    now.textContent = "";
    setStage("order");
    await nextCart();
    status.textContent = `A fresh floor (seed ${SEED}), its shape model empty. ${status.textContent}`;
    if (!playing) await advance(false);
    updateDom();
    drawLabel();
    draw(performance.now());
  }

  async function slotIt() {
    const p = products.get(sku.value);
    const want = bin.value.trim().toUpperCase();
    try {
      const r = await exec("slot", { sku: sku.value, bin: want });
      products.set(r.sku, r);
      bin.value = r.bin.raw;
      status.textContent = `Moved ${r.name} from ${p.bin.raw} to ${r.bin.raw} (aisle ${r.bin.aisle}, bin ${r.bin.pos}, level ${r.bin.level}${r.bin.zone ? `, ${r.bin.zone}` : ""}). The next cart picks it there.`;
    } catch (err) {
      status.textContent = `warehouse.ParseBin refused ${want}: ${err.message.replace(/^bin "[^"]*": /, "")}.`;
    }
    updateDom();
    draw(performance.now());
  }

  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    if (cart && cart.at < cart.stops.length) { while (cart.at < cart.stops.length) arrive(); cart.legT0 = 0; updateDom(); draw(performance.now()); return; }
    advance(false).then(() => { draw(performance.now()); kick(); }).catch(fail);
  });
  reset.addEventListener("click", () => restart().then(kick).catch(fail));
  move.addEventListener("click", () => slotIt().catch(fail));
  bin.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); slotIt().catch(fail); } });
  sku.addEventListener("change", () => { bin.value = products.get(sku.value)?.bin.raw || ""; });
  speed.addEventListener("change", kick);
  for (const [b, k] of [[tabLabel, "label"], [tabSlip, "slip"]]) b.addEventListener("click", () => {
    sheet = k;
    tabLabel.className = k === "label" ? "" : "secondary";
    tabSlip.className = k === "slip" ? "" : "secondary";
    tabLabel.setAttribute("aria-pressed", String(k === "label"));
    tabSlip.setAttribute("aria-pressed", String(k === "slip"));
    labelH.textContent = k === "label" ? "label" : "packing slip";
    if (cur) showOrder(cur.order, cur.r);
    drawLabel();
  });
  tabLabel.setAttribute("aria-pressed", "true");
  tabSlip.setAttribute("aria-pressed", "false");

  const redraw = () => { if (!root.isConnected) return; root.classList.toggle("af-wide", root.clientWidth >= 500); layout(); readColors(); draw(performance.now()); drawLabel(); };
  new ResizeObserver(redraw).observe(map);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(map);
  document.addEventListener("visibilitychange", kick);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  addEventListener("themechange", redraw);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  root.classList.toggle("af-wide", root.clientWidth >= 500);
  readColors();
  layout();
  await restart();
  setPlaying(playing);
}
