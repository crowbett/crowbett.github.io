// strata demo: strata's real Rust slicing engine, compiled to WebAssembly.
// A model is sliced on arrival and its toolpaths are drawn layer by layer, in
// the order the engine generates them, onto a 3D stack, a plan of the layer in
// work and a profile of extrusion per layer. Change the layer height or the
// model (yours included) and the engine slices it again.
const KINDS = {
  Skirt: "skirt",
  OuterWall: "outer wall",
  InnerWall: "inner wall",
  SolidInfill: "solid infill",
  SparseInfill: "sparse infill",
  TopSurface: "top surface",
  GapFill: "gap fill",
  Bridge: "bridge",
  Support: "support",
  SupportInterface: "support interface",
  Ironing: "ironing",
};
const SPEEDS = [1, 2, 5, 20];
const RATE = 300; // mm of toolpath drawn per second at 1×
const FILE = "file";
const FADE_MS = 280;
const GROW_MS = 360;
const PHI = 0.55;
const THETA = -0.65;
const STRIP_H = 78;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const mm = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const m2 = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const msText = (ms) => (ms < 10 ? ms.toFixed(1) : fmt(Math.round(ms)));
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function field(label, input, cls) {
  const wrap = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

function base64(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

// A layer as the binary returned it, with each path's running length so the
// nozzle can stop part way along one.
function prep(r) {
  let len = 0;
  const by = {};
  const paths = r.paths.map((p) => {
    const q = p.points;
    const n = q.length / 2;
    const cum = new Float64Array(p.closed && n > 1 ? n + 1 : n);
    let L = 0;
    for (let k = 1; k < cum.length; k++) {
      const a = (k - 1) * 2, b = (k % n) * 2;
      L += Math.hypot(q[b] - q[a], q[b + 1] - q[a + 1]);
      cum[k] = L;
    }
    by[p.kind] = (by[p.kind] || 0) + L;
    const o = { kind: p.kind, closed: p.closed, q, cum, len: L, start: len };
    len += L;
    return o;
  });
  return { index: r.index, z: r.z, paths, open: r.open, len, by };
}

// Strokes a path up to `upto` mm along it and returns the tip, in model mm.
function stroke(ctx, p, upto) {
  const q = p.q, n = q.length / 2;
  ctx.beginPath();
  ctx.moveTo(q[0], q[1]);
  if (upto >= p.len) {
    for (let k = 2; k < q.length; k += 2) ctx.lineTo(q[k], q[k + 1]);
    if (p.closed) ctx.closePath();
    ctx.stroke();
    return null;
  }
  let tip = [q[0], q[1]];
  for (let k = 1; k < p.cum.length; k++) {
    const j = (k % n) * 2;
    if (p.cum[k] > upto) {
      const a = (k - 1) * 2, f = (upto - p.cum[k - 1]) / (p.cum[k] - p.cum[k - 1]);
      tip = [q[a] + (q[j] - q[a]) * f, q[a + 1] + (q[j + 1] - q[a + 1]) * f];
      ctx.lineTo(tip[0], tip[1]);
      break;
    }
    ctx.lineTo(q[j], q[j + 1]);
  }
  ctx.stroke();
  return tip;
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
  const info = await demo.call("models", {});

  // Controls.
  const model = el("select");
  model.name = "model";
  for (const m of info.models) {
    const o = el("option", null, m.name);
    o.value = m.id;
    model.append(o);
  }
  const height = el("select");
  height.name = "layerHeight";
  for (const h of info.layerHeights) {
    const o = el("option", null, `${h} mm`);
    o.value = String(h);
    o.selected = h === 0.2;
    height.append(o);
  }
  const speed = el("select");
  speed.name = "speed";
  for (const s of SPEEDS) {
    const o = el("option", null, `${s}×`);
    o.value = String(s);
    o.selected = s === 2;
    speed.append(o);
  }
  const knobs = el("div", "st-knobs");
  knobs.append(field("model", model), field("layer height", height), field("speed", speed));
  const play = button("Pause");
  const next = button("Next layer", "secondary");
  const restart = button("Restart", "secondary");
  const pick = button("Open your own model");
  const file = el("input");
  Object.assign(file, { type: "file", name: "file", accept: ".stl,.obj,.3mf", hidden: true });
  const acts = el("div", "st-acts");
  acts.append(play, next, restart, pick, file);
  const form = el("form", "st-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(knobs, acts);

  const canvas = el("canvas", "st-canvas");
  canvas.setAttribute("role", "img");
  const scrub = el("input");
  Object.assign(scrub, { type: "range", name: "layer", min: 0, max: 0, step: 1, value: 0 });
  scrub.id = "st-layer";
  const where = el("output", "st-where");
  where.htmlFor = scrub.id;
  const scrubLabel = el("label", "demo-label", "layer");
  scrubLabel.htmlFor = scrub.id;
  const scrubHead = el("div", "st-scrub-h");
  scrubHead.append(scrubLabel, where);
  const scrubRow = el("div", "st-scrub");
  scrubRow.append(scrubHead, scrub);
  const legend = el("p", "demo-legend st-legend");
  const summary = el("p", "st-summary");
  summary.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack st-cells");
  const cell = {};
  for (const [k, t] of [["layer", "layer"], ["z", "z"], ["layers", "layers"], ["paths", "toolpaths"], ["extrusion", "extrusion"],
    ["drawn", "drawn"], ["slice", "slice"], ["open", "open contours"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "st-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const receipt = el("p", "demo-out st-out");
  receipt.setAttribute("aria-live", "polite");
  root.replaceChildren(form, canvas, scrubRow, legend, summary, cells, receipt);

  // Engine state, as the binary last answered.
  let current = null; // { key, value, label, meta }
  let sl = null; // slice result + { h, ms }
  let was = null; // the slice a layer-height change replaced
  let layers = [];
  let fetched = 0;
  let fetchMs = 0;
  let total = 0;
  let failed = "";
  let gen = 0;
  let files = 0;
  let chain = Promise.resolve();
  const exec = (method, params) => {
    const run = chain.then(async () => {
      const t0 = performance.now();
      const r = await demo.call(method, params);
      return { r, ms: performance.now() - t0 };
    });
    chain = run.catch(() => {});
    return run;
  };

  // View state.
  let pos = { i: 0, d: 0 };
  let playing = !reduce.matches;
  let theta = THETA;
  let fade = null; // { t0, img }
  let grow = null; // { t0, k }
  let colors = null;
  let G = null;
  let bake = el("canvas");
  let baked = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let shownLayer = -1;
  let lastDom = 0;
  let toEnd = false;

  function readColors() {
    const probe = el("span");
    root.append(probe);
    const paint = (v) => {
      probe.style.color = v;
      return getComputedStyle(probe).color;
    };
    const c = { kind: {}, band: {}, dim: {} };
    for (const k of Object.keys(KINDS)) {
      c.kind[k] = paint(`var(--st-${k})`);
      c.band[k] = paint(`color-mix(in oklab, var(--st-${k}) 74%, var(--sunken))`);
      c.dim[k] = paint(`color-mix(in oklab, var(--st-${k}) 30%, var(--sunken))`);
    }
    for (const [k, v] of [["bg", "--sunken"], ["surface", "--surface"], ["line", "--line"], ["strong", "--line-strong"], ["text", "--text"],
      ["text2", "--text-2"], ["text3", "--text-3"], ["danger", "--danger"]]) c[k] = paint(`var(${v})`);
    c.prev = paint("color-mix(in oklab, var(--text-3) 16%, var(--sunken))");
    c.ghost = paint("color-mix(in oklab, var(--text-3) 38%, var(--sunken))");
    c.mono = getComputedStyle(root).getPropertyValue("--mono").trim() || "monospace";
    probe.remove();
    colors = c;
  }

  // Geometry, in CSS pixels: the 3D stack, the plan of the layer in work and
  // the extrusion profile under both.
  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const wide = W >= 520;
    let s3, pl, H;
    if (wide) {
      const top = Math.round(Math.min(430, Math.max(300, W * 0.56)));
      s3 = { x: 0, y: 0, w: Math.round(W * 0.65), h: top };
      pl = { x: s3.w, y: 0, w: W - s3.w, h: top };
      H = top + STRIP_H;
    } else {
      s3 = { x: 0, y: 0, w: W, h: Math.round(W * 0.8) };
      pl = { x: 0, y: s3.h, w: W, h: Math.round(W * 0.66) };
      H = s3.h + pl.h + STRIP_H;
    }
    const st = { x: 12, y: H - STRIP_H, w: W - 24, h: STRIP_H };
    G = { W, H, wide, s3, pl, st };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    if (bake.width !== w || bake.height !== h) Object.assign(bake, { width: w, height: h });
    baked = -1;
  }

  // Axonometric projection of the plate, fitted so turning it never rescales.
  function view() {
    const [x0, y0, x1, y1] = sl && sl.layers ? sl.bounds : [-10, -10, 10, 10];
    const pad = 2;
    const px0 = x0 - pad, py0 = y0 - pad, px1 = x1 + pad, py1 = y1 + pad;
    const cx = (px0 + px1) / 2, cy = (py0 + py1) / 2;
    const r = Math.hypot(px1 - px0, py1 - py0) / 2;
    const zMax = current ? Math.max(current.meta.size[2], 1) : 10;
    const R = G.s3;
    const left = 34, top = 28, padB = 22, padR = 10;
    const sp = Math.sin(PHI), cp = Math.cos(PHI);
    const s = Math.min((R.w - left - padR) / (2 * r), (R.h - top - padB) / (2 * r * sp + zMax * cp));
    const ox = R.x + left + (R.w - left - padR) / 2;
    const span = (2 * r * sp + zMax * cp) * s;
    const oy = R.y + top + (R.h - top - padB - span) / 2 + (r * sp + zMax * cp) * s;
    const ct = Math.cos(theta), st = Math.sin(theta);
    const P = (x, y, z) => {
      const dx = x - cx, dy = y - cy;
      return [ox + s * (dx * ct - dy * st), oy - s * ((dx * st + dy * ct) * sp + z * cp)];
    };
    const T = (z, dpr) => [s * ct * dpr, -s * sp * st * dpr, -s * st * dpr, -s * sp * ct * dpr,
      (ox - s * (ct * cx - st * cy)) * dpr, (oy + s * sp * (st * cx + ct * cy) - s * z * cp) * dpr];
    return { P, T, s, plate: [px0, py0, px1, py1], zMax };
  }

  function drawPlate(ctx, v, dpr) {
    const c = colors;
    const [x0, y0, x1, y1] = v.plate;
    ctx.setTransform(...v.T(0, dpr));
    ctx.fillStyle = c.surface;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.lineWidth = 1 / (v.s * Math.sin(PHI));
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    const step = x1 - x0 > 60 ? 10 : 5;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.strokeStyle = c.strong;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawLayer3(ctx, v, L, j, dpr, upto) {
    ctx.setTransform(...v.T(L.z, dpr));
    ctx.lineWidth = sl.lineWidth;
    const tone = j % 2 ? colors.band : colors.kind;
    let tip = null;
    for (const p of L.paths) {
      if (p.start >= upto) break;
      ctx.strokeStyle = tone[p.kind] || colors.text3;
      tip = stroke(ctx, p, upto - p.start) || tip;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return tip;
  }

  // Layers below the one in work are drawn once into `bake`.
  function bakeTo(v, n, dpr) {
    const b = bake.getContext("2d");
    if (baked < 0 || baked > n) {
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, bake.width, bake.height);
      b.lineCap = "round";
      b.lineJoin = "round";
      drawPlate(b, v, dpr);
      baked = 0;
    }
    while (baked < n && layers[baked]) {
      drawLayer3(b, v, layers[baked], baked, dpr, Infinity);
      baked++;
    }
  }

  function label(ctx, text, x, y, align, color) {
    ctx.fillStyle = color || colors.text3;
    ctx.textAlign = align || "left";
    ctx.fillText(text, x, y);
  }

  function nozzle(ctx, x, y) {
    const c = colors;
    ctx.fillStyle = c.text;
    ctx.beginPath();
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x - 6, y - 12);
    ctx.lineTo(x + 6, y - 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 3, y - 26, 6, 14);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(now) {
    if (!G || !colors) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.font = `11px ${colors.mono}`;
    ctx.textBaseline = "alphabetic";
    const v = view();
    const n = sl ? sl.layers : 0;
    const L = n ? layers[pos.i] : null;
    const d = L ? Math.min(pos.d, L.len) : 0;

    // 3D stack.
    let upTo = pos.i;
    if (grow) upTo = Math.min(grow.k, Math.floor(ease((now - grow.t0) / GROW_MS) * (grow.k + 1)));
    bakeTo(v, upTo, dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bake, 0, 0);
    ctx.restore();
    let tip3 = null;
    if (L && !grow) {
      const t = drawLayer3(ctx, v, L, pos.i, dpr, d);
      if (d > 0 && d < L.len) tip3 = t;
    }
    if (current) {
      // A z ruler at the plate corner furthest left on screen.
      const [x0, y0, x1, y1] = v.plate;
      const corner = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => v.P(x, y, 0)).sort((a, b) => a[0] - b[0])[0];
      const zTop = v.zMax;
      const cp = Math.cos(PHI) * v.s;
      const stepZ = [1, 2, 5, 10, 20, 50].find((s) => s * cp >= 26) || 100;
      const rx = corner[0] - 8;
      ctx.strokeStyle = colors.strong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx, corner[1]);
      ctx.lineTo(rx, corner[1] - zTop * cp);
      for (let z = 0; z <= zTop + 1e-9; z += stepZ) { ctx.moveTo(rx - 4, corner[1] - z * cp); ctx.lineTo(rx, corner[1] - z * cp); }
      ctx.stroke();
      for (let z = stepZ; z <= zTop + 1e-9; z += stepZ) label(ctx, `${z}`, rx - 6, corner[1] - z * cp + 4, "right");
      label(ctx, "z, mm", rx + 4, corner[1] - zTop * cp - 8, "left");
      if (L && !grow) {
        const zy = corner[1] - L.z * cp;
        ctx.fillStyle = colors.text;
        ctx.fillRect(rx - 3, zy - 1, 7, 2);
      }
    }
    const R3 = G.s3;
    if (current) label(ctx, sl ? `${current.label} · ${mm(sl.h)} mm` : current.label, R3.x + 12, R3.y + 18, "left", colors.text2);
    label(ctx, "drag to turn", R3.x + R3.w - 12, R3.y + R3.h - 8, "right");
    if (tip3) {
      const [hx, hy] = v.P(tip3[0], tip3[1], L.z);
      nozzle(ctx, hx, hy);
    }

    // Plan of the layer in work.
    const Pl = G.pl;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (G.wide) { ctx.moveTo(Pl.x + 0.5, Pl.y + 10); ctx.lineTo(Pl.x + 0.5, Pl.y + Pl.h - 6); }
    else { ctx.moveTo(12, Pl.y + 0.5); ctx.lineTo(G.W - 12, Pl.y + 0.5); }
    ctx.moveTo(12, G.st.y + 0.5);
    ctx.lineTo(G.W - 12, G.st.y + 0.5);
    ctx.stroke();
    if (L) {
      const [x0, y0, x1, y1] = sl.bounds;
      const top = 42, pad = 16, bottom = 26;
      const s = Math.min((Pl.w - 2 * pad) / Math.max(x1 - x0, 1), (Pl.h - top - bottom) / Math.max(y1 - y0, 1));
      const ox = Pl.x + Pl.w / 2 - ((x0 + x1) / 2) * s;
      const oy = Pl.y + top + (Pl.h - top - bottom) / 2 + ((y0 + y1) / 2) * s;
      ctx.setTransform(s * dpr, 0, 0, -s * dpr, ox * dpr, oy * dpr);
      const prev = pos.i > 0 ? layers[pos.i - 1] : null;
      if (prev) {
        ctx.lineWidth = sl.lineWidth;
        ctx.strokeStyle = colors.prev;
        for (const p of prev.paths) stroke(ctx, p, Infinity);
      }
      ctx.lineWidth = sl.lineWidth * 0.25;
      ctx.strokeStyle = colors.ghost;
      for (const p of L.paths) if (p.start + p.len > d) stroke(ctx, p, Infinity);
      ctx.lineWidth = sl.lineWidth;
      let tip = null, kind = null;
      for (const p of L.paths) {
        if (p.start >= d) break;
        ctx.strokeStyle = colors.kind[p.kind] || colors.text3;
        const t = stroke(ctx, p, d - p.start);
        if (t) { tip = t; kind = p.kind; }
      }
      if (L.open.length) {
        ctx.strokeStyle = colors.danger;
        ctx.setLineDash([1, 0.7]);
        for (const pts of L.open) stroke(ctx, { q: pts, closed: false, cum: [], len: 0 }, Infinity);
        ctx.setLineDash([]);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      label(ctx, `layer ${pos.i + 1} · z ${mm(L.z)} mm`, Pl.x + 16, Pl.y + 18, "left", colors.text2);
      if (kind && !grow) label(ctx, KINDS[kind] || kind, Pl.x + 16, Pl.y + 34, "left", colors.text);
      if (tip && !grow) {
        const hx = ox + tip[0] * s, hy = oy - tip[1] * s;
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = colors.text;
        ctx.beginPath();
        ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const bar = [1, 2, 5, 10, 20, 50].find((b) => b * s >= 40) || 100;
      const bx = Pl.x + 16, by = Pl.y + Pl.h - 12;
      ctx.strokeStyle = colors.text3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + bar * s, by); ctx.lineTo(bx + bar * s, by - 4);
      ctx.stroke();
      label(ctx, `${bar} mm`, bx + bar * s + 6, by + 3);
    } else {
      label(ctx, sl && !n ? "no layers at this height" : "slicing…", Pl.x + 16, Pl.y + 18);
    }

    // Extrusion per layer.
    const S = G.st;
    const barTop = S.y + 20, barH = S.h - 34;
    label(ctx, "extrusion per layer", S.x, S.y + 14);
    if (n) {
      let max = 0;
      for (let j = 0; j < fetched; j++) max = Math.max(max, layers[j].len);
      if (max > 0) label(ctx, `${fmt(Math.round(max))} mm`, S.x + S.w, S.y + 14, "right");
      const bw = S.w / n;
      const gap = bw > 4 ? 1 : 0;
      const order = Object.keys(KINDS);
      for (let j = 0; j < fetched; j++) {
        const Lj = layers[j];
        const done = j < upTo || (j === pos.i && !grow && d >= Lj.len);
        const tone = done ? colors.kind : colors.dim;
        let y = barTop + barH;
        for (const k of order) {
          const v2 = Lj.by[k];
          if (!v2) continue;
          const hgt = (v2 / max) * barH;
          ctx.fillStyle = tone[k];
          ctx.fillRect(S.x + j * bw, y - hgt, Math.max(bw - gap, 0.6), hgt);
          y -= hgt;
        }
      }
      const hx = S.x + (Math.min(grow ? upTo : pos.i, n - 1) + 0.5) * bw;
      ctx.fillStyle = colors.text;
      ctx.fillRect(Math.round(hx) - 0.5, barTop - 2, 1.5, barH + 4);
      label(ctx, "1", S.x, S.y + S.h - 2);
      label(ctx, fmt(n), S.x + S.w, S.y + S.h - 2, "right");
    }

    if (fade) {
      const f = (now - fade.t0) / FADE_MS;
      if (f >= 1) fade = null;
      else {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1 - ease(f);
        ctx.drawImage(fade.img, 0, 0);
        ctx.restore();
      }
    }
    if (grow && upTo >= grow.k && now - grow.t0 >= GROW_MS) grow = null;
  }

  function snapshot() {
    if (reduce.matches || !G) return null;
    const img = el("canvas");
    Object.assign(img, { width: canvas.width, height: canvas.height });
    img.getContext("2d").drawImage(canvas, 0, 0);
    return { t0: performance.now(), img };
  }

  const atEnd = () => sl && sl.layers && pos.i === sl.layers - 1 && layers[pos.i] && pos.d >= layers[pos.i].len;

  function updateDom(force) {
    const n = sl ? sl.layers : 0;
    const L = n ? layers[pos.i] : null;
    play.textContent = playing ? "Pause" : atEnd() ? "Replay" : "Play";
    play.setAttribute("aria-pressed", String(playing));
    next.disabled = !n || !!atEnd();
    if (!sl) {
      for (const k of ["layer", "z", "layers", "paths", "extrusion", "drawn", "slice", "open"]) cell[k].textContent = "–";
      where.textContent = "";
      return;
    }
    cell.layers.textContent = fmt(n);
    cell.paths.textContent = fmt(sl.paths);
    cell.extrusion.textContent = `${m2(sl.extrusionM)} m`;
    cell.slice.textContent = `${msText(sl.ms)} ms`;
    cell.open.textContent = fmt(sl.openChains);
    if (!L) {
      cell.layer.textContent = "–";
      cell.z.textContent = "–";
      cell.drawn.textContent = "–";
      return;
    }
    const d = Math.min(pos.d, L.len);
    if (fetched === n && total > 0) {
      let done = d;
      for (let j = 0; j < pos.i; j++) done += layers[j].len;
      cell.drawn.textContent = `${m2((sl.extrusionM * done) / total)} m`;
    }
    if (force || shownLayer !== pos.i) {
      shownLayer = pos.i;
      cell.layer.textContent = `${fmt(pos.i + 1)} / ${fmt(n)}`;
      cell.z.textContent = `${mm(L.z)} mm`;
      where.textContent = `${pos.i + 1} of ${fmt(n)} · z ${mm(L.z)} mm`;
      scrub.max = String(Math.max(0, n - 1));
      scrub.value = String(pos.i);
      scrub.setAttribute("aria-valuetext", `Layer ${pos.i + 1} of ${n}, z ${mm(L.z)} mm`);
      canvas.setAttribute("aria-label", `${current.label} sliced into ${n} layers; toolpaths drawn up to layer ${pos.i + 1} at z ${mm(L.z)} mm, ${L.paths.length} paths in that layer.`);
      const counts = new Map();
      for (const p of L.paths) counts.set(p.kind, (counts.get(p.kind) || 0) + 1);
      const keys = Object.keys(KINDS).filter((k) => counts.has(k)).map((k) => {
        const s = el("span", "st-key", `${KINDS[k]} ${counts.get(k)}`);
        s.dataset.kind = k;
        s.style.setProperty("--st-c", `var(--st-${k})`);
        return s;
      });
      if (L.open.length) {
        const s = el("span", "st-key", `open contour ${L.open.length}`);
        s.dataset.kind = "open";
        s.style.setProperty("--st-c", "var(--danger)");
        keys.push(s);
      }
      const nz = el("span", "st-key", "nozzle");
      nz.dataset.kind = "nozzle";
      nz.style.setProperty("--st-c", "var(--text)");
      legend.replaceChildren(...keys, nz);
    }
  }

  function tellModel() {
    const m = current.meta;
    const [sx, sy, sz] = m.size;
    const rp = m.repair;
    const notes = [];
    if (rp.flipped + rp.holesFilled) notes.push(`Import repair flipped ${plural(rp.flipped, "triangle")} and filled ${plural(rp.holesFilled, "hole")}.`);
    if (sl && sl.openChains) notes.push(`${plural(sl.openChains, "open contour")}: the mesh has holes repair could not close, and they get no toolpaths.`);
    if (sl && !sl.layers) notes.push("The model is too thin to give a layer at this height.");
    if (was && sl) notes.push(`At ${mm(sl.h)} mm: ${fmt(sl.layers)} layers (${fmt(was.layers)} at ${mm(was.h)} mm), ` +
      `${fmt(sl.paths)} toolpaths (${fmt(was.paths)}), ${m2(sl.extrusionM)} m (${m2(was.extrusionM)} m).`);
    summary.textContent = (failed ? `${failed} ` : "") + `${m.name}: ${fmt(m.triangles)} triangles, ${mm(sx)} × ${mm(sy)} × ${mm(sz)} mm.` +
      (notes.length ? ` ${notes.join(" ")}` : "");
  }

  function tellReceipt() {
    if (!sl) return;
    const head = `${plural(sl.layers, "layer")}, ${plural(sl.paths, "toolpath")} and ${m2(sl.extrusionM)} m of extrusion sliced by strata's engine in ${msText(sl.ms)} ms`;
    receipt.textContent = fetched < sl.layers ? `${head}; fetching layers…` : `${head}. Fetching the ${plural(fetched, "layer")} to draw took ${msText(fetchMs)} ms.`;
  }

  // One frame: move the nozzle along the layer's paths at RATE × speed.
  function advance(dt) {
    if (!sl || !playing || grow) return;
    let budget = (dt / 1000) * RATE * Number(speed.value);
    while (budget > 0) {
      const L = layers[pos.i];
      if (!L) return;
      if (pos.d > L.len) pos.d = L.len;
      const left = L.len - pos.d;
      if (budget < left) { pos.d += budget; return; }
      budget -= left;
      pos.d = L.len;
      if (pos.i >= sl.layers - 1) { setPlaying(false); return; }
      pos.i++;
      pos.d = 0;
    }
  }

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;
    advance(dt);
    draw(now);
    if (now - lastDom > 100 || shownLayer !== pos.i) { lastDom = now; updateDom(false); }
    if ((playing || fade || grow) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  const redraw = () => { draw(performance.now()); updateDom(true); kick(); };

  function setPlaying(v) {
    playing = v;
    last = 0;
    updateDom(true);
    kick();
  }

  // Engine calls: load, slice, then fetch every layer in order. A newer
  // request bumps `gen`, and older loops stop at their next answer.
  async function fetchLayers(g) {
    for (let i = 0; i < sl.layers; i++) {
      const { r, ms } = await exec("layer", { index: i });
      if (g !== gen) return;
      layers[i] = prep(r);
      total += layers[i].len;
      fetched = i + 1;
      fetchMs += ms;
      if (i === 0 || fetched === sl.layers) tellReceipt();
      if (toEnd && fetched === sl.layers) { toEnd = false; pos = { i: sl.layers - 1, d: Infinity }; }
      kick();
      if (!raf) redraw();
    }
  }

  async function sliceNow(g, keep) {
    const h = Number(height.value);
    const frac = keep && sl && sl.layers > 1 ? pos.i / (sl.layers - 1) : 0;
    let res;
    try {
      res = await exec("slice", { layerHeight: h });
    } catch (err) {
      if (g !== gen) return;
      sl = null;
      layers = [];
      fetched = 0;
      baked = -1;
      summary.textContent = err.message;
      receipt.textContent = "";
      redraw();
      return;
    }
    if (g !== gen) return;
    const old = snapshot();
    was = keep && sl && sl.layers && sl.h !== h ? sl : null;
    sl = { ...res.r, h, ms: res.ms };
    layers = new Array(sl.layers);
    fetched = 0;
    fetchMs = 0;
    total = 0;
    baked = -1;
    shownLayer = -1;
    toEnd = false;
    const k = Math.round(frac * Math.max(0, sl.layers - 1));
    if (keep) {
      pos = { i: k, d: Infinity };
      grow = reduce.matches ? null : { t0: performance.now(), k };
    } else if (reduce.matches) {
      pos = { i: 0, d: Infinity };
      toEnd = true;
      playing = false;
    } else {
      pos = { i: 0, d: 0 };
      grow = null;
      playing = true;
    }
    fade = old;
    tellModel();
    tellReceipt();
    updateDom(true);
    await fetchLayers(g);
  }

  async function load(want) {
    const g = ++gen;
    summary.textContent = `Loading ${want.label}…`;
    let res;
    try {
      res = await exec("load", want.params);
    } catch (err) {
      if (!current) throw err;
      // A failed load leaves the engine with the model it had.
      if (g === gen) {
        restoreSelect();
        failed = err.message;
        tellModel();
      }
      return;
    }
    current = { key: want.key, value: want.value, label: want.label, meta: res.r };
    if (g !== gen) return;
    summary.textContent = `Slicing ${want.label}…`;
    await sliceNow(g, false);
  }

  const fail = (err) => { summary.textContent = err.message; };

  function fileOption(text) {
    let opt = model.querySelector(`option[value="${FILE}"]`);
    if (!opt) {
      opt = el("option");
      opt.value = FILE;
      model.append(opt);
    }
    opt.textContent = text;
  }

  function restoreSelect() {
    if (current.value === FILE) fileOption(current.label);
    else model.querySelector(`option[value="${FILE}"]`)?.remove();
    model.value = current.value;
  }

  const builtIn = () => {
    model.querySelector(`option[value="${FILE}"]`)?.remove();
    return { key: model.value, value: model.value, label: model.selectedOptions[0].textContent, params: { model: model.value } };
  };

  async function openFile(f) {
    if (!f) return;
    failed = "";
    if (f.size > info.maxFileBytes) {
      summary.textContent = `${f.name} is over ${info.maxFileBytes / 1048576} MiB.`;
      return;
    }
    const params = { file: base64(await f.arrayBuffer()), name: f.name };
    fileOption(f.name);
    model.value = FILE;
    load({ key: `${FILE}:${++files}`, value: FILE, label: f.name, params }).catch(fail);
  }

  function seek(i) {
    if (!sl || !sl.layers) return;
    pos = { i: Math.max(0, Math.min(sl.layers - 1, i)), d: Infinity };
    grow = null;
    setPlaying(false);
    redraw();
  }

  model.addEventListener("change", () => {
    failed = "";
    load(builtIn()).catch(fail);
  });
  height.addEventListener("change", () => {
    failed = "";
    if (!current) return;
    const g = ++gen;
    summary.textContent = `Slicing ${current.label} at ${height.value} mm…`;
    sliceNow(g, true).catch(fail);
  });
  speed.addEventListener("change", () => { last = 0; });
  play.addEventListener("click", () => {
    if (playing) return setPlaying(false);
    if (atEnd()) {
      fade = snapshot();
      pos = { i: 0, d: 0 };
      baked = -1;
    }
    setPlaying(true);
  });
  next.addEventListener("click", () => {
    const L = layers[pos.i];
    seek(L && pos.d < L.len ? pos.i : pos.i + 1);
  });
  restart.addEventListener("click", () => {
    if (!sl || !sl.layers) return;
    fade = snapshot();
    grow = null;
    pos = { i: 0, d: reduce.matches ? Infinity : 0 };
    baked = -1;
    setPlaying(!reduce.matches);
    redraw();
  });
  pick.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files[0];
    file.value = "";
    openFile(f).catch(fail);
  });
  scrub.addEventListener("input", () => seek(Number(scrub.value)));

  // Drag across the stack to turn it; across the profile to pick a layer.
  let drag = null;
  const at = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const stripLayer = (x) => Math.floor(((x - G.st.x) / G.st.w) * sl.layers);
  canvas.addEventListener("pointerdown", (e) => {
    if (!G) return;
    const p = at(e);
    const S = G.st, R = G.s3;
    if (p.y >= S.y && sl && sl.layers) {
      drag = { kind: "strip" };
      seek(stripLayer(p.x));
    } else if (p.x >= R.x && p.x < R.x + R.w && p.y >= R.y && p.y < R.y + R.h) drag = { kind: "turn", x: p.x };
    else return;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = at(e);
    if (drag.kind === "strip") {
      const i = Math.max(0, Math.min(sl.layers - 1, stripLayer(p.x)));
      if (i !== pos.i) seek(i);
    } else {
      theta += (p.x - drag.x) * 0.01;
      drag.x = p.x;
      baked = -1;
      if (!raf) draw(performance.now());
    }
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  root.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    canvas.classList.add("st-drop");
  });
  root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) canvas.classList.remove("st-drop"); });
  root.addEventListener("drop", (e) => {
    canvas.classList.remove("st-drop");
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    openFile(f).catch(fail);
  });

  let width = 0;
  new ResizeObserver(() => {
    if (canvas.clientWidth === width) return;
    width = canvas.clientWidth;
    layout();
    redraw();
  }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const recolor = () => { readColors(); baked = -1; redraw(); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
  window.addEventListener("themechange", recolor);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  readColors();
  layout();
  width = canvas.clientWidth;
  const first = load(builtIn());
  // Ready once the first layer is on screen; the rest keep arriving.
  for (;;) {
    const r = await Promise.race([first.then(() => "done"), new Promise((res) => setTimeout(() => res("tick"), 20))]);
    if (fetched > 0 || r === "done") break;
  }
  if (!sl || !layers[0]) {
    await first;
    if (!sl) throw new Error(summary.textContent);
  }
  redraw();
  first.catch(fail);
}
