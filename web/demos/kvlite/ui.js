// kvlite demo: the real engine writing real segment, hint and MANIFEST files
// to an in-memory file system in this tab. A seeded workload writes keys; every
// record drawn is one kvlite's own segment reader decoded from those files.
const WORK = ["user:ana", "user:bo", "cart:ana", "cart:bo", "session:4f1c", "session:9a07",
  "page:/", "page:/about", "stock:sku-7", "stock:sku-12", "flag:beta", "job:42"];
const RATES = [2, 5, 10, 20];
const DELETES = [[0, "none"], [0.1, "10 %"], [0.25, "25 %"]];
const AUTO = [[0.5, "50 % dead"], [0.75, "75 % dead"], [0, "off"]];
const CUTS = [["mid", "mid-write"], ["128", "tear 128 B"], ["1024", "tear 1 KiB"], ["0", "clean"]];
const MIN_DEAD = 256; // the page never compacts a store with fewer dead bytes than this
const WARMUP = 30;
const MAX_MINE = 4;
const FLY_MS = 280;
const SLIDE_MS = 240;
const FADE_MS = 300;
const HOLD_MS = 2600;
const ROW_H = 22;
const BOX_H = 17;
const MAX_ROWS = 8;
const CHIP_H = 34;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const B = (n) => `${fmt(n)} B`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const segName = (id) => `${String(id).padStart(8, "0")}.log`;
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function textInput(name, value, max) {
  const i = el("input");
  Object.assign(i, { type: "text", name, value, maxLength: max, spellcheck: false, autocomplete: "off" });
  return i;
}

// mulberry32: the workload is seeded, so Reset replays the same writes.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Facts derived from one view: the newest record of every key across the
// segments (ascending id, then offset, the engine's recovery order), and which
// of those the snapshot confirms as live. Their sizes sum to Stats.LiveBytes.
function facts(v) {
  const newest = new Map();
  for (const s of [...v.segments].sort((a, b) => a.id - b.id)) for (const r of s.records) newest.set(r.key, { s, r });
  const kv = new Map(v.keys.map((k) => [k.key, k.value]));
  const live = new Set();
  for (const [k, { s, r }] of newest) if (r.kind === "put" && kv.get(k) === r.value) live.add(`${s.id}:${r.off}`);
  let records = 0;
  for (const s of v.segments) records += s.records.length + s.more;
  const disk = v.files.reduce((a, f) => a + f.size, 0);
  return { newest, kv, live, records, disk };
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

  // Controls.
  const rate = select("rate", RATES.map((r) => [r, `${r} /s`]), 5);
  const dels = select("deletes", DELETES, 0.1);
  const auto = select("autocompact", AUTO, 0.5);
  const cut = select("cut", CUTS, "mid");
  const knobs = el("div", "kv-knobs");
  knobs.append(field("writes", rate), field("deletes", dels), field("auto-compact", auto), field("pull the plug", cut, "kv-cut"));
  const play = button("Pause");
  const step = button("Step", "secondary");
  const reset = button("Reset", "secondary");
  const compact = button("Compact", "secondary");
  const plug = button("Pull the plug", "kv-plug");
  const acts = el("div", "kv-acts");
  acts.append(play, step, reset, compact, plug);
  const key = textInput("key", "my:key", 64);
  const value = textInput("value", "hello", 256);
  const put = button("Put");
  const get = button("Get", "secondary");
  const del = button("Delete", "secondary");
  const mine = el("div", "kv-mine");
  const ops = el("div", "kv-ops");
  ops.append(put, get, del);
  mine.append(field("your key", key, "kv-key"), field("value", value, "kv-value"), ops);
  const form = el("form", "kv-controls");
  form.addEventListener("submit", (e) => { e.preventDefault(); put.click(); });
  form.append(knobs, acts, mine);

  const canvas = el("canvas", "kv-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend kv-legend");
  for (const [k, t] of [["live", "live record"], ["dead", "dead (overwritten or deleted)"], ["tomb", "tombstone"], ["you", "yours"], ["lost", "lost in the crash"], ["hdr", "segment header"]]) {
    const s = el("span", "kv-key-sw", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const youLine = el("p", "kv-you");
  youLine.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack kv-cells");
  const cell = {};
  for (const [k, t] of [["keys", "keys"], ["disk", "on disk"], ["live", "live"], ["dead", "dead"], ["reclaimed", "reclaimed"],
    ["compactions", "compactions"], ["recovered", "recovered"], ["lost", "lost"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "kv-v", "–");
    li.append(el("span", "kv-k", t), v);
    cell[k] = v;
    cells.append(li);
  }
  const status = el("p", "kv-status");
  status.setAttribute("aria-live", "polite");
  const files = el("p", "kv-files");
  const log = el("pre", "kv-log");
  const receipt = el("p", "demo-out kv-out");
  root.replaceChildren(form, canvas, legend, youLine, cells, status, files, log, receipt);

  // State.
  let view = null;
  let F = null;
  let gen = 0;
  let chain = Promise.resolve();
  let busy = 0;
  let playing = !reduce.matches;
  let visible = true;
  let raf = 0;
  let last = 0;
  let pending = 0;
  let holdUntil = 0;
  let animUntil = 0;
  let closed = false;
  let plugging = false;
  let ticking = Promise.resolve();
  let inTick = false;
  let rand = rng(1);
  let vers = new Map();
  let mineIds = new Set();
  let mineKeys = [];
  let boxes = new Map();
  let lanes = [];
  let chips = new Map();
  let ghosts = [];
  let marks = [];
  let flash = new Map();
  let hover = null;
  let colors = null;
  let G = null;
  let minH = 0;
  let keepRows = null;
  let lastDom = 0;
  const tally = { writes: 0, compactions: 0, crashes: 0, ms: 0 };
  const crash = { recovered: null, lost: null };

  const exec = (method, params) => {
    busy++;
    const g = gen;
    const run = chain.then(async () => {
      if (g !== gen) throw new Error("stale");
      const t0 = performance.now();
      try {
        return await demo.call(method, params);
      } finally {
        tally.ms += performance.now() - t0;
      }
    }).finally(() => { busy--; });
    chain = run.catch(() => {});
    return run.then((r) => ({ r, g }));
  };

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"),
      text2: v("--text-2"), text3: v("--text-3"), accent: v("--accent"), live: v("--live"), signal: v("--signal"),
      danger: v("--danger"), mono: v("--mono") || "monospace",
    };
  }

  // Geometry, in CSS pixels. A segment is drawn as its bytes in rows, like a
  // hex dump: x and row come from each record's real offset in the file.
  function geometry() {
    const W = Math.max(280, canvas.clientWidth);
    const pad = 10;
    const cols = W >= 520 ? 4 : 3;
    const bpr = W >= 520 ? 256 : 128;
    const slots = WORK.length + extra().length;
    const chipRows = Math.ceil(slots / cols);
    const chipTop = 24;
    const diskTop = chipTop + chipRows * (CHIP_H + 6) + 22;
    G = { W, pad, cols, bpr, ppb: (W - 2 * pad) / bpr, chipW: (W - 2 * pad - (cols - 1) * 6) / cols, chipTop, diskTop };
  }

  const extra = () => mineKeys.filter((k) => !WORK.includes(k));

  function chipXY(i) {
    const c = i % G.cols, r = Math.floor(i / G.cols);
    return { x: G.pad + c * (G.chipW + 6), y: G.chipTop + r * (CHIP_H + 6) };
  }

  function pieces(off, size, start, y) {
    const out = [];
    let a = Math.max(off, start);
    const end = off + size;
    while (a < end) {
      const row = Math.floor((a - start) / G.bpr);
      const e = Math.min(end, start + (row + 1) * G.bpr);
      const x = G.pad + (a - start - row * G.bpr) * G.ppb;
      out.push({ x, y: y + row * ROW_H, w: Math.max(1, (e - a) * G.ppb - (e === end ? 1.5 : 0)) });
      a = e;
    }
    return out;
  }

  // Lays out one view: chips for the keydir, lanes and record boxes for disk.
  function build(v) {
    geometry();
    F = facts(v);
    chips = new Map();
    [...WORK, ...extra()].forEach((k, i) => chips.set(k, { ...chipXY(i), key: k }));
    const next = new Map();
    lanes = [];
    let y = G.diskTop + 6;
    const order = [...v.segments].sort((a, b) => Number(b.active) - Number(a.active) || b.id - a.id);
    for (const s of order) {
      const need = Math.max(1, Math.ceil(s.bytes / G.bpr));
      const held = keepRows && keepRows.id === s.id && performance.now() < keepRows.until ? keepRows.rows : 0;
      const rows = Math.max(held, Math.min(MAX_ROWS, need));
      const start = Math.max(0, need - rows) * G.bpr;
      const ty = y + 18;
      const hint = v.files.find((f) => f.name === `${String(s.id).padStart(8, "0")}.hint`);
      const hidden = s.more + s.records.filter((r) => r.off + r.size <= start).length;
      const lane = { s, y, ty, rows, start, hint, hidden, header: start === 0 ? pieces(0, 16, 0, ty) : [] };
      lanes.push(lane);
      for (const r of s.records) {
        if (r.off + r.size <= start) continue;
        const id = `${s.id}:${r.off}`;
        const p = pieces(r.off, r.size, start, ty);
        next.set(id, { id, r, s, lane, p, live: F.live.has(id), mine: mineIds.has(id), from: null });
      }
      lane.tail = s.active ? pieces(s.bytes, 1, start, ty)[0] : null;
      y = ty + rows * ROW_H + 12;
    }
    const H = y + 2;
    minH = Math.max(minH, H);
    canvas.style.height = `${minH}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(G.W * dpr), h = Math.round(minH * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    G.H = minH;
    return next;
  }

  // Where a box is drawn now: its target plus what is left of its tween.
  function offset(b, now) {
    if (!b.from) return { dx: 0, dy: 0, a: 1 };
    const t = (now - b.from.t0) / b.from.ms;
    if (t >= 1) { b.from = null; return { dx: 0, dy: 0, a: 1 }; }
    const k = ease(t);
    const dx = (b.from.x - b.p[0].x) * (1 - k);
    let dy = (b.from.y - b.p[0].y) * (1 - k);
    if (b.from.arc) dy -= Math.sin(Math.max(0, t) * Math.PI) * b.from.arc;
    return { dx, dy, a: t < 0 ? 0 : b.from.fade ? k : 1 };
  }
  const at = (b, now) => { const o = offset(b, now); return { x: b.p[0].x + o.dx, y: b.p[0].y + o.dy }; };

  // apply replaces the view and works out the motion that explains the change.
  function apply(v, how, now, animate) {
    const old = boxes;
    const oldLive = new Map();
    for (const b of old.values()) if (b.live) oldLive.set(b.r.key, b);
    view = v;
    const next = build(v);
    const added = [];
    let i = 0;
    for (const b of next.values()) {
      const o = old.get(b.id);
      if (how === "reset" || !animate) continue;
      if (o && o.r.key === b.r.key) {
        const p = at(o, now);
        if (Math.abs(p.x - b.p[0].x) > 0.5 || Math.abs(p.y - b.p[0].y) > 0.5) b.from = { x: p.x, y: p.y, t0: now, ms: SLIDE_MS };
        continue;
      }
      added.push(b);
      if (how === "compact") {
        const src = oldLive.get(b.r.key);
        if (src) {
          const p = at(src, now);
          b.from = { x: p.x, y: p.y, t0: now + Math.min(160, i++ * 12), ms: FLY_MS, arc: 10 };
        } else b.from = { x: b.p[0].x, y: b.p[0].y, t0: now, ms: FADE_MS, fade: true };
      } else if (how === "write" && b.s.active) {
        const c = chips.get(b.r.key);
        b.from = c ? { x: c.x + G.chipW / 2 - b.p[0].w / 2, y: c.y + CHIP_H - 6, t0: now, ms: FLY_MS, arc: 14 } : { x: b.p[0].x, y: b.p[0].y, t0: now, ms: FADE_MS, fade: true };
        flash.set(b.r.key, { t0: now, color: "signal" });
        b.fresh = now;
      } else b.from = { x: b.p[0].x, y: b.p[0].y, t0: now, ms: FADE_MS, fade: true };
    }
    if (how === "compact") {
      for (const b of added) {
        const src = oldLive.get(b.r.key);
        if (src && src.mine) { mineIds.add(b.id); b.mine = true; }
      }
    }
    if (animate && how !== "reset") {
      for (const o of old.values()) {
        if (next.has(o.id) && next.get(o.id).r.key === o.r.key) continue;
        if (how === "compact" && o.live && next.size && [...next.values()].some((b) => b.r.key === o.r.key && !old.has(b.id))) continue;
        const p = how === "crash" ? o.p[0] : at(o, now);
        const dx = p.x - o.p[0].x, dy = p.y - o.p[0].y;
        ghosts.push({ b: o, p: o.p.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })), t0: now, lost: how === "crash", until: now + (how === "crash" ? HOLD_MS : 0) });
      }
    }
    if (how === "crash") for (const o of old.values()) if (!next.has(o.id)) mineIds.delete(o.id);
    boxes = next;
    animUntil = Math.max(animUntil, now + (how === "crash" ? HOLD_MS + FADE_MS : FLY_MS + 200));
    updateDom(true);
  }

  // Drawing.
  function draw(now) {
    if (!G || !colors) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors;
    const font = (px, w = 400) => `${w} ${px}px ${c.mono}`;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    ctx.textBaseline = "alphabetic";
    ctx.font = font(10);
    ctx.fillStyle = c.text3;
    ctx.textAlign = "left";
    ctx.fillText("memory · keydir: key → newest record on disk", G.pad, 15);
    if (!view) return;
    ctx.fillText(`disk · /kvlite · ${B(F.disk)} in ${plural(view.files.length, "file", "files")}`, G.pad, G.diskTop - 4);
    ctx.strokeStyle = c.line;
    ctx.beginPath(); ctx.moveTo(G.pad, G.diskTop - 16.5); ctx.lineTo(G.W - G.pad, G.diskTop - 16.5); ctx.stroke();

    // Lanes: one per segment file.
    for (const L of lanes) {
      ctx.font = font(10, 600);
      ctx.fillStyle = c.text;
      ctx.textAlign = "left";
      const name = segName(L.s.id);
      ctx.fillText(name, G.pad, L.y + 11);
      const nw = ctx.measureText(name).width;
      ctx.font = font(10);
      const cutMark = L.s.active && marks.find((m) => m.text && now < m.until);
      ctx.fillStyle = cutMark ? c.danger : L.s.active ? c.signal : c.text3;
      if (cutMark) ctx.font = font(10, 600);
      let meta = cutMark ? cutMark.text : L.s.active ? `active · ${B(L.s.bytes)}` : `sealed · ${B(L.s.bytes)}${L.hint ? ` · hint ${B(L.hint.size)}` : ""}`;
      if (cutMark && ctx.measureText(meta).width > G.W - 2 * G.pad - nw - 8) meta = cutMark.short;
      ctx.fillText(meta, G.pad + nw + 8, L.y + 11);
      if (L.hidden && !(marks.length && L.s.active)) {
        ctx.textAlign = "right";
        ctx.fillStyle = c.text3;
        ctx.fillText(`+${plural(L.hidden, "older record", "older records")} above`, G.W - G.pad, L.y + 11);
      }
      for (let r = 0; r < L.rows; r++) {
        ctx.fillStyle = c.surface;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(G.pad, L.ty + r * ROW_H, G.W - 2 * G.pad, BOX_H);
      }
      ctx.globalAlpha = 1;
      for (const q of L.header) {
        ctx.fillStyle = c.strong;
        ctx.fillRect(q.x, q.y, q.w, BOX_H);
        if (q.w > 22) {
          ctx.fillStyle = c.text2;
          ctx.font = font(9);
          ctx.textAlign = "center";
          ctx.fillText("hdr", q.x + q.w / 2, q.y + 12);
        }
      }
      if (L.tail && L.s.active) {
        const blink = playing && !reduce.matches ? 0.45 + 0.55 * Math.abs(Math.sin(now / 400)) : 1;
        ctx.globalAlpha = blink;
        ctx.fillStyle = c.signal;
        ctx.fillRect(L.tail.x, L.tail.y - 2, 2, BOX_H + 4);
        ctx.globalAlpha = 1;
      }
    }

    // Ghosts: records that just left, faded (reclaimed) or held in red (lost).
    ghosts = ghosts.filter((g) => now < Math.max(g.until, g.t0) + FADE_MS);
    for (const g of ghosts) {
      const a = 1 - Math.max(0, (now - Math.max(g.until, g.t0)) / FADE_MS);
      ctx.globalAlpha = Math.max(0, a);
      if (g.lost) {
        for (const q of g.p) {
          ctx.fillStyle = c.danger;
          ctx.globalAlpha = Math.max(0, a) * 0.16;
          ctx.fillRect(q.x, q.y, q.w, BOX_H);
          ctx.globalAlpha = Math.max(0, a);
          ctx.setLineDash([3, 2]);
          ctx.strokeStyle = c.danger;
          ctx.strokeRect(q.x + 0.5, q.y + 0.5, q.w - 1, BOX_H - 1);
          ctx.setLineDash([]);
        }
        label(ctx, g.b, g.p, c.danger, font);
      } else {
        const sh = (1 - a) * 4;
        for (const q of g.p) {
          ctx.strokeStyle = c.strong;
          ctx.strokeRect(q.x + 0.5, q.y + 0.5 + sh, q.w - 1, BOX_H - 1 - 2 * sh);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Records.
    for (const b of boxes.values()) drawBox(ctx, b, now, font);

    // Marks: where the plug cut the file and where recovery ended it.
    marks = marks.filter((m) => now < m.until + FADE_MS);
    for (const m of marks) {
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, now - m.until) / FADE_MS);
      ctx.strokeStyle = m.color === "danger" ? c.danger : c.live;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(m.x, m.y - 4); ctx.lineTo(m.x, m.y + BOX_H + 4); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;

    // Pointer lines: the key you are looking at, your keys, and fresh writes.
    const pointers = new Map();
    for (const k of mineKeys) pointers.set(k, "accent");
    const yours = key.value;
    if (chips.has(yours)) pointers.set(yours, "accent");
    for (const [k, f] of flash) if (now - f.t0 < 500 && f.color === "signal") pointers.set(k, "signal");
    if (hover?.key) pointers.set(hover.key, "text");
    for (const [k, col] of pointers) {
      const ch = chips.get(k);
      const n = F.newest.get(k);
      if (!ch || !n) continue;
      const b = boxes.get(`${n.s.id}:${n.r.off}`);
      if (!b) continue;
      const p = at(b, now);
      const x0 = ch.x + G.chipW / 2, y0 = ch.y + CHIP_H, x1 = p.x + b.p[0].w / 2, y1 = p.y;
      ctx.strokeStyle = c[col];
      ctx.globalAlpha = col === "signal" ? Math.max(0, 1 - (now - flash.get(k).t0) / 500) * 0.8 : 0.8;
      ctx.lineWidth = col === "accent" ? 1.5 : 1;
      ctx.setLineDash(b.live ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // Chips: the keys the snapshot holds now.
    for (const ch of chips.values()) drawChip(ctx, ch, now, font);

    if (closed) {
      ctx.fillStyle = c.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, G.diskTop - 14, G.W, G.H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.danger;
      ctx.font = font(11, 600);
      ctx.textAlign = "left";
      ctx.fillText("kvlite refused to open the store. Reset starts an empty one.", G.pad, G.diskTop + 20);
    }

    const hb = hover?.box && boxes.get(hover.box.id);
    if (hb) tip(ctx, { ...hover, box: hb }, font);
  }

  function style(b) {
    const c = colors;
    if (b.mine) return { fill: c.accent, fa: b.live ? 0.32 : 0.08, stroke: c.accent, sa: b.live ? 1 : 0.55, text: b.live ? c.text : c.text3, dash: b.r.kind === "delete" };
    if (b.r.kind === "delete") return { fill: c.text3, fa: 0.05, stroke: c.text3, sa: 0.9, text: c.text3, dash: true };
    if (b.live) return { fill: c.live, fa: 0.3, stroke: c.live, sa: 1, text: c.text };
    return { fill: c.text3, fa: 0.08, stroke: c.strong, sa: 1, text: c.text3 };
  }

  function drawBox(ctx, b, now, font) {
    const o = offset(b, now);
    if (o.a <= 0) return;
    const s = style(b);
    const ps = b.p.map((q) => ({ ...q, x: q.x + o.dx, y: q.y + o.dy }));
    for (const q of ps) {
      ctx.globalAlpha = o.a * s.fa;
      ctx.fillStyle = s.fill;
      ctx.fillRect(q.x, q.y, q.w, BOX_H);
      ctx.globalAlpha = o.a * s.sa;
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = b.mine ? 1.5 : 1;
      if (s.dash) ctx.setLineDash([3, 2]);
      ctx.strokeRect(q.x + 0.5, q.y + 0.5, Math.max(0, q.w - 1), BOX_H - 1);
      ctx.setLineDash([]);
      if (b.r.kind === "delete") {
        ctx.beginPath(); ctx.moveTo(q.x + 2, q.y + BOX_H - 2); ctx.lineTo(q.x + q.w - 2, q.y + 2); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
    if (b.fresh && now - b.fresh < 700 && !reduce.matches) {
      ctx.globalAlpha = Math.max(0, 1 - (now - b.fresh) / 700);
      ctx.strokeStyle = colors.signal;
      ctx.lineWidth = 2;
      for (const q of ps) ctx.strokeRect(q.x - 1, q.y - 1, q.w + 2, BOX_H + 2);
      ctx.lineWidth = 1;
    }
    if (hover?.key === b.r.key || hover?.box?.id === b.id) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.text;
      for (const q of ps) ctx.strokeRect(q.x - 1.5, q.y - 1.5, q.w + 3, BOX_H + 3);
    }
    ctx.globalAlpha = o.a;
    label(ctx, b, ps, s.text, font);
    ctx.globalAlpha = 1;
  }

  function label(ctx, b, ps, color, font) {
    const q = ps.reduce((m, x) => (x.w > m.w ? x : m), ps[0]);
    ctx.font = font(9);
    const cw = ctx.measureText("m").width;
    const n = Math.floor((q.w - 6) / cw);
    if (n < 3) return;
    const t = b.r.key.length > n ? b.r.key.slice(0, n - 1) + "…" : b.r.key;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(t, q.x + 3, q.y + 12);
  }

  function fit(ctx, s, w) {
    if (ctx.measureText(s).width <= w) return s;
    while (s.length > 1 && ctx.measureText(s + "…").width > w) s = s.slice(0, -1);
    return s + "…";
  }

  function drawChip(ctx, ch, now, font) {
    const c = colors;
    const has = F.kv.has(ch.key);
    const val = F.kv.get(ch.key);
    const n = F.newest.get(ch.key);
    const isMine = mineKeys.includes(ch.key);
    const f = flash.get(ch.key);
    ctx.fillStyle = has ? c.surface : c.bg;
    ctx.fillRect(ch.x, ch.y, G.chipW, CHIP_H);
    ctx.strokeStyle = isMine ? c.accent : has ? c.strong : c.line;
    ctx.lineWidth = isMine ? 1.5 : 1;
    if (!has) ctx.setLineDash([3, 3]);
    ctx.strokeRect(ch.x + 0.5, ch.y + 0.5, G.chipW - 1, CHIP_H - 1);
    ctx.setLineDash([]);
    if (f) {
      const life = f.color === "danger" ? HOLD_MS : 600;
      const a = 1 - (now - f.t0) / life;
      if (a <= 0) flash.delete(ch.key);
      else if (!reduce.matches || f.color === "danger") {
        ctx.globalAlpha = f.color === "danger" ? 1 : a;
        ctx.strokeStyle = c[f.color];
        ctx.lineWidth = 2;
        ctx.strokeRect(ch.x, ch.y, G.chipW, CHIP_H);
        ctx.globalAlpha = 1;
      }
    }
    ctx.lineWidth = 1;
    const inner = G.chipW - 12;
    ctx.font = font(10, 600);
    ctx.textAlign = "right";
    ctx.fillStyle = has ? c.text2 : c.text3;
    const vt = has ? fit(ctx, val, inner * 0.4) : "";
    ctx.fillText(vt, ch.x + G.chipW - 6, ch.y + 14);
    const vw = ctx.measureText(vt).width;
    ctx.textAlign = "left";
    ctx.fillStyle = isMine ? c.accent : has ? c.text : c.text3;
    ctx.fillText(fit(ctx, ch.key, inner - vw - 6), ch.x + 6, ch.y + 14);
    ctx.font = font(9);
    let sub = "not in the store";
    let subColor = c.text3;
    if (f?.color === "danger" && f.text) { sub = f.text; subColor = c.danger; }
    else if (has && n && F.live.has(`${n.s.id}:${n.r.off}`)) {
      sub = `→ seg ${n.s.id} @ ${fmt(n.r.off)}`;
      if (ctx.measureText(sub).width > inner) sub = `→ ${n.s.id} @ ${fmt(n.r.off)}`;
    }
    else if (has) sub = "→ older record";
    else if (n && n.r.kind === "delete") sub = "deleted";
    ctx.fillStyle = subColor;
    ctx.fillText(fit(ctx, sub, inner), ch.x + 6, ch.y + 27);
  }

  function tip(ctx, h, font) {
    const b = h.box;
    const c = colors;
    const lines = [`${segName(b.s.id)} @ ${fmt(b.r.off)} · ${B(b.r.size)}`,
      `${b.r.kind} ${b.r.key}${b.r.kind === "put" ? ` = ${b.r.value}` : ""}`,
      b.live ? "live: the keydir points here" : b.r.kind === "delete" ? "tombstone: dead, dropped by compaction" : "dead: a newer record supersedes it"];
    ctx.font = font(10);
    const w = Math.min(G.W - 2 * G.pad, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16);
    const x = Math.min(G.W - G.pad - w, Math.max(G.pad, h.x + 12));
    const y = h.y + 16 + 48 > G.H ? h.y - 56 : h.y + 16;
    ctx.fillStyle = c.surface;
    ctx.fillRect(x, y, w, 48);
    ctx.strokeStyle = c.strong;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 47);
    ctx.textAlign = "left";
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 2 ? (b.live ? c.live : c.text3) : c.text;
      ctx.fillText(fit(ctx, l, w - 16), x + 8, y + 14 + i * 14);
    });
  }

  function updateDom(force) {
    const now = performance.now();
    if (!force && now - lastDom < 200) return;
    lastDom = now;
    const v = view;
    if (!v) return;
    const s = v.stats;
    const set = (k, t) => { cell[k].textContent = t; };
    set("keys", fmt(s.keys));
    set("disk", B(F.disk));
    set("live", B(s.liveBytes));
    set("dead", `${B(s.deadBytes)} · ${Math.round(100 * s.deadRatio)} %`);
    set("reclaimed", B(s.reclaimedBytes));
    set("compactions", fmt(s.compactions));
    set("recovered", crash.recovered === null ? "–" : plural(crash.recovered, "record", "records"));
    set("lost", crash.lost === null ? "–" : plural(crash.lost, "record", "records"));
    files.replaceChildren(el("span", "kv-files-k", "files"), ...v.files.map((f) => el("span", null, `${f.name} ${B(f.size)}`)));
    log.textContent = v.log.length ? v.log.slice(-2).join("\n") : "engine log: nothing logged yet";
    let lb = 0, ln = 0, db = 0, dn = 0;
    for (const b of boxes.values()) if (b.live) { lb += b.r.size; ln++; } else { db += b.r.size; dn++; }
    canvas.setAttribute("aria-label", `kvlite store: ${plural(s.keys, "key", "keys")} in ${plural(v.segments.length, "segment", "segments")}, ` +
      `${B(F.disk)} on disk; drawn ${plural(ln, "live record", "live records")} (${B(lb)}) and ${plural(dn, "dead record", "dead records")} (${B(db)}).`);
    receipt.textContent = `${plural(tally.writes, "write", "writes")}, ${plural(tally.compactions, "compaction", "compactions")} and ${plural(tally.crashes, "crash", "crashes")} through kvlite's engine; ` +
      `${plural(F.records, "record", "records")} decoded back by its segment reader, in ${fmt(Math.round(tally.ms))} ms of calls, in your browser.`;
    yourLine();
  }

  function yourLine() {
    const k = mineKeys[mineKeys.length - 1];
    if (!k || !F) { youLine.textContent = ""; return; }
    const n = F.newest.get(k);
    if (F.kv.has(k) && n) {
      const id = `${n.s.id}:${n.r.off}`;
      youLine.textContent = F.live.has(id)
        ? `${k} = ${F.kv.get(k)}: its newest record is ${B(n.r.size)} at byte ${fmt(n.r.off)} of ${segName(n.s.id)} (${n.s.active ? "the active segment" : "a sealed segment"}).`
        : `${k} = ${F.kv.get(k)}.`;
    } else if (n && n.r.kind === "delete") youLine.textContent = `${k} is deleted: its newest record is a tombstone at byte ${fmt(n.r.off)} of ${segName(n.s.id)}.`;
    else youLine.textContent = `${k} is not in the store.`;
  }

  const fail = (err) => {
    if (err.message === "stale") return;
    status.textContent = err.message;
  };

  // A failed call can leave the store closed (ErrCorrupt by design): show that, not a stale picture.
  async function recover(err) {
    fail(err);
    if (err.message === "stale") return;
    try {
      const { r } = await exec("state", {});
      apply(r, "none", performance.now(), false);
    } catch (e) {
      if (e.message === "stale") return;
      closed = true;
      setPlaying(false);
      draw(performance.now());
    }
  }

  // The workload: skewed keys (weight 1/√rank), versioned values, a share of deletes.
  function nextOp() {
    const wt = (i) => 1 / Math.sqrt(i + 1);
    let total = 0;
    for (let i = 0; i < WORK.length; i++) total += wt(i);
    let x = rand() * total, i = 0;
    while (i < WORK.length - 1 && (x -= wt(i)) > 0) i++;
    const k = WORK[i];
    const d = rand() < Number(dels.value);
    if (d && view && view.keys.some((e) => e.key === k)) return ["delete", { key: k }];
    const n = (vers.get(k) || 0) + 1;
    vers.set(k, n);
    return ["put", { key: k, value: `v${n}` }];
  }

  async function write(op, animate, yours) {
    const g = gen;
    const { r } = await exec(op[0], op[1]);
    if (g !== gen) return null;
    tally.writes++;
    const before = new Set(boxes.keys());
    mineKeys = mineKeys.filter((k) => k !== op[1].key);
    if (yours) mineKeys = [...mineKeys, op[1].key].slice(-MAX_MINE);
    apply(r, "write", performance.now(), animate);
    if (yours) for (const b of boxes.values()) if (!before.has(b.id) && b.s.active) {
      mineIds.add(b.id);
      b.mine = true;
      flash.set(b.r.key, { t0: performance.now(), color: "accent" });
    }
    return r;
  }

  async function maybeCompact(animate) {
    const th = Number(auto.value);
    const s = view?.stats;
    if (!th || !s || s.deadRatio < th || s.deadBytes < MIN_DEAD) return;
    if (animate) await sleep(FLY_MS);
    await doCompact(animate, `Dead bytes reached ${Math.round(100 * s.deadRatio)} % (${B(s.deadBytes)}), so the page called Compact. `);
  }

  async function doCompact(animate, why) {
    const g = gen;
    const before = view;
    const { r } = await exec("compact", {});
    if (g !== gen) return;
    tally.compactions++;
    const fb = facts(before);
    apply(r, "compact", performance.now(), animate);
    if (r.stats.compactions <= before.stats.compactions && fb.records === 0) {
      status.textContent = "Nothing to compact: the store holds no records.";
      return;
    }
    const sealed = r.segments.filter((s) => !s.active);
    const kept = sealed.reduce((a, s) => a + s.records.length + s.more, 0);
    status.textContent = `${why || ""}kvlite rewrote ${plural(kept, "live record", "live records")} into ${sealed.map((s) => segName(s.id)).join(", ") || "no segment"} with a hint file, ` +
      `dropped ${plural(Math.max(0, fb.records - F.records), "dead record", "dead records")}, swapped the MANIFEST and opened ${segName(r.stats.activeSegment)} for new writes.`;
    if (animate) holdUntil = performance.now() + 700;
  }

  async function tick(animate) {
    await write(nextOp(), animate, false);
    await maybeCompact(animate);
  }

  async function pullPlug() {
    const animate = !reduce.matches;
    const g = gen;
    await ticking;
    if (cut.value === "mid") {
      await write(nextOp(), animate, false);
      if (g !== gen) return;
      if (animate) await sleep(FLY_MS + 120);
    }
    const before = view;
    const act = before.segments.find((s) => s.active);
    const newestRec = act.records[act.records.length - 1];
    const tear = cut.value === "mid" ? (newestRec ? Math.ceil(newestRec.size / 2) : 0) : Number(cut.value);
    const { r } = await exec("crash", { tear });
    if (g !== gen) return;
    tally.crashes++;
    const now = performance.now();
    const lane = lanes.find((l) => l.s.active);
    const lostAll = act.records.length + act.more - (r.segments.find((s) => s.id === act.id)?.records.length ?? 0) - (r.segments.find((s) => s.id === act.id)?.more ?? 0);
    const cutAt = act.bytes - r.torn;
    const nact = r.segments.find((s) => s.active);
    const end = nact ? nact.bytes : cutAt;
    if (animate && lane && r.torn) {
      const pc = pieces(cutAt, 1, lane.start, lane.ty)[0];
      const pe = end < cutAt ? pieces(end, 1, lane.start, lane.ty)[0] : null;
      const text = `cut at byte ${fmt(cutAt)}${pe ? ` · recovered to ${fmt(end)}` : ""}`;
      const short = `cut ${fmt(cutAt)}${pe ? ` → ${fmt(end)}` : ""}`;
      if (pc) marks.push({ x: pc.x, y: pc.y, text, short, color: "danger", until: now + HOLD_MS });
      if (pe) marks.push({ x: pe.x, y: pe.y, color: "live", until: now + HOLD_MS });
    }
    const oldKv = new Map(before.keys.map((k) => [k.key, k.value]));
    const newKv = new Map(r.keys.map((k) => [k.key, k.value]));
    const changed = [];
    for (const [k, v0] of oldKv) {
      const v1 = newKv.get(k);
      if (v1 !== v0) changed.push(`${k} ${v0} → ${v1 === undefined ? "gone" : v1}`);
      if (v1 !== v0) flash.set(k, { t0: now, color: "danger", text: `was ${v0}` });
    }
    for (const [k, v1] of newKv) if (!oldKv.has(k)) {
      changed.push(`${k} back as ${v1}`);
      flash.set(k, { t0: now, color: "danger", text: "delete lost" });
    }
    if (animate && lane) keepRows = { id: act.id, rows: lane.rows, until: now + HOLD_MS + FADE_MS };
    apply(r, "crash", now, animate);
    crash.recovered = F.records;
    crash.lost = lostAll;
    holdUntil = now + (animate ? HOLD_MS : 0);
    const truncated = r.log.length && /truncated torn tail/.test(r.log[r.log.length - 1]) && end < cutAt;
    let s = r.torn ? `Plug pulled: ${B(r.torn)} cut off the end of ${segName(act.id)} at byte ${fmt(cutAt)}. kvlite reopened from its own files` : "Plug pulled with nothing torn: kvlite reopened from its own files";
    if (r.torn) s += truncated ? ` and truncated the torn record at byte ${fmt(end)} (its own log line is below)` : "; the cut fell on a record boundary";
    s += `; ${plural(F.records, "record survives", "records survive")} on disk. `;
    s += lostAll ? `${plural(lostAll, "write", "writes")} lost` : "Nothing lost";
    s += changed.length ? `; rolled back: ${changed.join(", ")}.` : ".";
    status.textContent = s;
  }

  let restarting = Promise.resolve();
  function restart() {
    restarting = (async () => {
      gen++;
      rand = rng(1);
      vers = new Map();
      mineIds = new Set();
      mineKeys = [];
      boxes = new Map();
      ghosts = []; marks = []; flash = new Map(); keepRows = null;
      closed = false;
      minH = 0;
      pending = 0;
      holdUntil = 0;
      Object.assign(tally, { writes: 0, compactions: 0, crashes: 0, ms: 0 });
      crash.recovered = crash.lost = null;
      const { r } = await exec("reset", {});
      apply(r, "reset", performance.now(), false);
      for (let i = 0; i < WARMUP; i++) await tick(false);
      status.textContent = `Warmed up with ${WARMUP} seeded writes over ${WORK.length} keys; the workload keeps writing.`;
      updateDom(true);
      draw(performance.now());
    })();
    return restarting;
  }

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && !closed && !plugging && ts >= holdUntil) {
      pending += dt;
      const iv = 1000 / Number(rate.value);
      if (!busy && !inTick && pending >= iv) {
        pending = Math.min(pending - iv, iv);
        inTick = true;
        ticking = tick(!reduce.matches).catch(recover).finally(() => { inTick = false; });
      }
    }
    draw(ts);
    updateDom(false);
    if ((playing || ts < animUntil || ghosts.length || marks.length) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) kick();
  }

  // Inputs.
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    restarting.then(() => tick(!reduce.matches)).then(kick).catch(recover);
  });
  reset.addEventListener("click", () => restart().then(() => { draw(performance.now()); kick(); }).catch(fail));
  compact.addEventListener("click", () => restarting.then(() => doCompact(!reduce.matches, "")).then(kick).catch(recover));
  plug.addEventListener("click", () => {
    if (plugging || closed) return;
    plugging = true;
    plug.disabled = true;
    restarting.then(pullPlug).catch(recover).finally(() => { plugging = false; plug.disabled = false; kick(); });
    kick();
  });
  const mineOp = () => ({ key: key.value, value: value.value });
  put.addEventListener("click", () => {
    const p = mineOp();
    restarting.then(async () => {
      await write(["put", { key: p.key, value: p.value }], !reduce.matches, true);
      const n = F.newest.get(p.key);
      status.textContent = `Put ${p.key}: kvlite appended ${n ? `a ${B(n.r.size)} record at byte ${fmt(n.r.off)} of ${segName(n.s.id)}` : "one record"} and pointed the keydir at it.`;
      await maybeCompact(!reduce.matches);
    }).then(kick).catch(recover);
  });
  del.addEventListener("click", () => {
    const p = mineOp();
    restarting.then(async () => {
      await write(["delete", { key: p.key }], !reduce.matches, true);
      status.textContent = `Delete ${p.key}: kvlite appended a tombstone; the key's older records are now dead bytes until compaction.`;
      await maybeCompact(!reduce.matches);
    }).then(kick).catch(recover);
  });
  get.addEventListener("click", () => {
    const p = mineOp();
    restarting.then(async () => {
      const g = gen;
      const { r } = await exec("get", { key: p.key });
      if (g !== gen) return;
      apply(r, "none", performance.now(), false);
      const n = F.newest.get(p.key);
      if (r.get.found) {
        flash.set(p.key, { t0: performance.now(), color: "accent" });
        status.textContent = `Get ${p.key} = ${r.get.value}${n ? `, the value of its newest record at byte ${fmt(n.r.off)} of ${segName(n.s.id)}` : ""}.`;
      } else status.textContent = `Get ${p.key}: not found${n && n.r.kind === "delete" ? " (its newest record is a tombstone)" : ""}.`;
      animUntil = performance.now() + 700;
    }).then(kick).catch(recover);
  });

  // Hover: a chip shows its pointer; a record shows what it holds. Tap a chip to use its key.
  const local = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  function hit(h) {
    for (const ch of chips.values()) if (h.x >= ch.x && h.x <= ch.x + G.chipW && h.y >= ch.y && h.y <= ch.y + CHIP_H) return { ...h, key: ch.key };
    for (const b of boxes.values()) for (const q of b.p) if (h.x >= q.x && h.x <= q.x + q.w && h.y >= q.y && h.y <= q.y + BOX_H) return { ...h, box: b };
    return null;
  }
  canvas.addEventListener("pointermove", (e) => {
    if (!G) return;
    hover = hit(local(e));
    canvas.classList.toggle("kv-aim", !!hover?.key);
    if (!raf) draw(performance.now());
  });
  canvas.addEventListener("pointerleave", () => { hover = null; if (!raf) draw(performance.now()); });
  canvas.addEventListener("click", (e) => {
    if (!G) return;
    const h = hit(local(e));
    if (h?.key) {
      key.value = h.key;
      if (F.kv.has(h.key)) value.value = F.kv.get(h.key);
      if (!raf) draw(performance.now());
    }
  });

  new ResizeObserver(() => {
    if (!root.isConnected || !view) return;
    const w = canvas.clientWidth;
    if (G && Math.abs(w - G.W) < 1) return;
    minH = 0;
    boxes = build(view);
    for (const b of boxes.values()) b.mine = mineIds.has(b.id);
    readColors();
    draw(performance.now());
  }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); draw(performance.now()); });
  addEventListener("themechange", () => { readColors(); draw(performance.now()); });
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  readColors();
  await restart();
  setPlaying(playing);
}
