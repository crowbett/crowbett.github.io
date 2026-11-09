// AnchorFlow demo: a packing floor. Orders arrive on simulated floor time and
// AnchorFlow's real fit engine (internal/packfit, compiled to WebAssembly)
// picks each one's package from its reference catalog; the items drop into
// it where the engine placed them. Taking packaging off the shelf re-judges
// the whole shift so far.
const SEED = 1;
const ARRIVE_S = 75; // mean floor seconds between orders
const SPEEDS = [30, 60, 120, 240];
const BELT_S = 240;
const WARM = 3;
const WARM_REDUCED = 12;
const SHIFT = 150;
const DROP_MS = 240;
const FLY_MS = 260;
const SLIDE_MS = 220;
const NEEDS_BOX = "this basket needs a box";

// Item shapes are the ones the engine's own tests pin for each class.
const ITEMS = [
  ["Dropper bottle", "LIQUID", 1.5, 1.5, 4.5],
  ["Supplement bottle", "CAPS", 2.75, 2.75, 4.75],
  ["Small pill bottle", "CAPS", 2, 2, 3.5],
  ["Powder tub", "TUB", 3.5, 3.5, 4.5],
  ["Gummy jar", "GUMMY", 2.5, 2.5, 4.5],
  ["Coffee bag", "BAG", 8.75, 4.5, 2.25],
  ["Folded T-shirt", "TS", 7.75, 6.75, 0.25],
  ["Cap", "HAT", 8, 6.5, 4.5],
  ["Challenge coin", "COIN", 1.75, 1.75, 0.1],
  ["Silver coin", "SILVER", 1.75, 1.75, 0.1],
  ["Decal", "DECAL", 4, 3, 0.1],
  ["Keychain", "KEYCHAIN", 1.5, 1.5, 0.75],
  ["Shaker bottle", "SHAKER", 3.75, 3.75, 8.75],
  ["Rolled poster", "POSTER", 24, 2, 2],
  ["Boxed item", "", 10, 8, 3.5],
].map(([name, cls, l, w, h]) => ({ name, class: cls, l, w, h }));
const MIXES = [
  ["mixed", "mixed", [3, 4, 2, 2, 2, 2, 5, 2, 2, 1, 3, 2, 2, 1, 1]],
  ["merch", "merch", [0, 0, 0, 0, 0, 0, 8, 4, 3, 1, 4, 3, 1, 2, 0]],
  ["supps", "supplements", [3, 6, 4, 3, 3, 2, 0, 0, 0, 0, 0, 0, 2, 0, 2]],
];
const YOURS = [[7, 1], [6, 2]];
const KIND = { box: "box", poly_mailer: "poly mailer", poly_bubble_mailer: "bubble mailer", bubble_bag: "bubble bag", tube: "tube" };
const isMailer = (k) => k === "poly_mailer" || k === "poly_bubble_mailer";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const money = (n) => `$${n.toFixed(2)}`;
const pct = (n) => `${Math.round(n * 100)} %`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const clock = (s) => {
  const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};
const lineText = (l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name);

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

  const t0 = performance.now();
  const cat = await demo.call("catalog", {});
  let callMs = performance.now() - t0;
  let calls = 1;
  let judged = 0;
  const traits = new Map(cat.classes.map((c) => [c.class, c]));
  const kindOf = (u) => (traits.get(u.class)?.forcesBox ? "rule" : traits.get(u.class)?.soft ? "soft" : "rigid");

  // Controls.
  const play = button("Pause");
  const step = button("Next order", "secondary");
  const reset = button("Reset", "secondary");
  const mix = select("mix", MIXES.map(([v, t]) => [v, t]), "mixed");
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 60);
  const acts = el("div", "af-acts");
  acts.append(play, step, reset, field("orders", mix), field("speed", speed));

  const yourItem = select("item", ITEMS.map((it, i) => [i, `${it.name} (${it.class || "plain"})`]), 0);
  const addItem = button("Add", "secondary");
  const yourLines = el("ul", "af-chips");
  yourLines.setAttribute("aria-label", "Your order");
  const drop = button("Drop on the line");
  const you = el("div", "af-you");
  const chipsWrap = el("div", "af-yours");
  chipsWrap.append(el("span", "demo-label", "your order"), yourLines);
  you.append(chipsWrap, field("item", yourItem, "af-item"), addItem, drop);
  const form = el("form", "af-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(acts, you);

  const canvas = el("canvas", "af-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend af-legend");
  for (const [k, t] of [["rule", "box-only item (warehouse rule)"], ["soft", "soft goods"], ["rigid", "rigid item"], ["you", "your order"]]) {
    const s = el("span", "af-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const now = el("p", "af-now");
  const youLine = el("p", "af-youline");
  youLine.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack af-cells");
  const cell = {};
  for (const [k, t] of [["t", "floor time"], ["orders", "orders"], ["boxes", "boxes"], ["mailers", "mailers"], ["rule", "box by rule"],
    ["none", "no fit"], ["cost", "cost"], ["per", "per order"], ["fill", "fill"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "af-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const split = el("div", "af-split");
  split.setAttribute("aria-hidden", "true");
  const seg = {};
  for (const k of ["mailer", "box", "rule"]) { seg[k] = el("span", `af-seg af-seg-${k}`); split.append(seg[k]); }
  const splitKey = el("p", "demo-legend af-splitkey");
  const top = el("ol", "af-top");
  top.setAttribute("aria-label", "Packages most picked");
  const tallyBox = el("section", "af-tally");
  const kinds = el("div"), most = el("div");
  kinds.append(el("h3", "af-h", "boxes vs mailers"), split, splitKey);
  most.append(el("h3", "af-h", "most picked"), top);
  tallyBox.append(kinds, most);

  const shelfHead = el("div", "af-shelfhead");
  const shelfTitle = el("h3", "af-h");
  const takeTop = button("Take top pick off", "secondary");
  const restock = button("Restock", "secondary");
  shelfHead.append(shelfTitle, takeTop, restock);
  const chip = new Map();
  const groups = el("div", "af-shelf");
  for (const [name, test] of [["mailers", (p) => isMailer(p.kind)], ["boxes", (p) => p.kind === "box"], ["inner packaging", (p) => !isMailer(p.kind) && p.kind !== "box"]]) {
    const list = cat.packages.filter(test);
    if (!list.length) continue;
    const g = el("div", "af-group");
    const ul = el("ul", "af-pkgs");
    ul.setAttribute("aria-label", name);
    for (const p of list) {
      const li = el("li");
      const b = button("", "af-pkg");
      b.setAttribute("aria-pressed", "true");
      const n = el("span", "af-pn");
      b.append(el("span", null, p.name), n);
      b.title = `${KIND[p.kind] || p.kind}, ${p.l} × ${p.w}${p.kind === "box" ? ` × ${p.h}` : ""} in, ${money(p.unitCost)}`;
      b.addEventListener("click", () => toggle(p.name));
      chip.set(p.name, { b, n });
      li.append(b);
      ul.append(li);
    }
    g.append(el("span", "demo-label", name), ul);
    groups.append(g);
  }
  const shelfBox = el("section", "af-shelfbox");
  shelfBox.append(shelfHead, groups);
  const panels = el("div", "af-panels");
  panels.append(tallyBox, shelfBox);
  const status = el("p", "af-status");
  status.setAttribute("aria-live", "polite");
  const receipt = el("p", "demo-out af-out");
  root.replaceChildren(form, canvas, legend, now, youLine, cells, panels, status, receipt);

  // State.
  let gen = 0;
  let rand = rng(SEED);
  let floor = 0;
  let nextAt = 0;
  let nextId = 1;
  let belt = [];
  let orders = [];
  let station = null;
  let flights = [];
  let slideAt = 0;
  const off = new Set();
  let yours = YOURS.map(([i, qty]) => ({ ...ITEMS[i], qty }));
  let yourN = 0;
  let playing = !reduce.matches;
  let visible = true;
  let busy = 0;
  let replaying = 0;
  let chain = Promise.resolve();
  let raf = 0;
  let last = 0;
  let lastDom = 0;
  let colors = null;
  let G = null;

  const exec = (params) => {
    busy++;
    const run = chain.then(async () => {
      const a = performance.now();
      try {
        return await demo.call("plan", params);
      } finally {
        callMs += performance.now() - a;
        calls++;
      }
    }).finally(() => { busy--; });
    chain = run.catch(() => {});
    return run;
  };
  const planOf = (rec) => exec({ lines: rec.lines.map(({ name, class: c, l, w, h, qty }) => ({ name, class: c, l, w, h, qty })), exclude: [...off] });

  function pickW(w) {
    const sum = w.reduce((a, b) => a + b, 0);
    let x = rand() * sum;
    for (let i = 0; i < w.length; i++) if ((x -= w[i]) < 0) return i;
    return w.length - 1;
  }
  function genOrder() {
    const w = MIXES.find(([v]) => v === mix.value)[2];
    const n = pickW([45, 35, 20]) + 1;
    const lines = [];
    let units = 0;
    for (let k = 0; k < n; k++) {
      const i = pickW(w), q = pickW([60, 28, 12]) + 1;
      if (units + q > cat.maxUnits) break;
      units += q;
      const had = lines.find((l) => l.name === ITEMS[i].name);
      if (had) had.qty += q;
      else lines.push({ ...ITEMS[i], qty: q });
    }
    nextAt += -Math.log(1 - rand()) * ARRIVE_S;
    return { id: nextId++, label: `#${String(nextId - 1).padStart(3, "0")}`, lines, arrival: nextAt, you: false };
  }
  function fillBelt() {
    while (orders.length + belt.filter((o) => !o.you).length < SHIFT && nextAt < floor + BELT_S + 60) {
      belt.push(genOrder());
      belt.sort((a, b) => a.arrival - b.arrival);
    }
  }

  // summarize keeps what the tally needs from one engine answer.
  function summarize(r) {
    judged += r.packages.length;
    const pick = r.packages.find((p) => p.suggested) || null;
    const ruleItems = [...new Set(r.units.filter((u) => traits.get(u.class)?.forcesBox).map((u) => u.name))];
    const barred = {};
    for (const p of r.packages) if (p.excluded) barred[p.excluded] = (barred[p.excluded] || 0) + 1;
    let fill = 0, placed = 0, room = 0;
    if (pick) {
      room = pick.usableL * pick.usableW * pick.usableH;
      for (const q of pick.placements) placed += q.dx * q.dy * q.dz;
      fill = room ? placed / room : 0;
    }
    return {
      name: pick ? pick.name : "", kind: pick ? pick.kind : "", cost: pick ? pick.marginalCost : 0, fill, placed, room,
      ruleItems, barred, units: r.units.length, seated: pick ? pick.placements.length : 0, packed: pick ? pick.packed : false,
    };
  }

  async function packNext(animate) {
    const rec = belt.shift();
    if (!rec) return;
    const g = gen;
    const r = await planOf(rec);
    if (g !== gen) return;
    rec.res = summarize(r);
    rec.changed = false;
    orders.push(rec);
    const t = performance.now();
    station = { rec, r, t0: animate ? t : 0 };
    if (animate) {
      flights.push({ t0: t, rec });
      slideAt = t;
    }
    if (rec.you) sayYou(rec);
    updateDom(true);
  }

  function sayYou(rec) {
    const s = rec.res;
    youLine.replaceChildren();
    const head = `Your order ${rec.label} (${rec.lines.map(lineText).join(", ")}) `;
    if (!s.name) {
      youLine.append(head, el("strong", null, "has no answer"), ": nothing on the shelf fits, so the engine stays silent and a person decides.");
      return;
    }
    youLine.append(head, rec.changed ? "now goes in " : "went in ", el("strong", null, s.name), `, ${KIND[s.kind] || s.kind}, ${money(s.cost)} all in, ${pct(s.fill)} full.`);
    if (s.ruleItems.length) youLine.append(" ", el("span", "af-rule", `Warehouse rule first: ${s.ruleItems.join(", ")} ships only in a box.`));
  }

  function tally() {
    const t = { boxes: 0, mailers: 0, rule: 0, none: 0, cost: 0, placed: 0, room: 0, picks: new Map() };
    for (const o of orders) {
      const s = o.res;
      if (!s.name) { t.none++; continue; }
      if (s.kind === "box") { t.boxes++; if (s.ruleItems.length) t.rule++; } else t.mailers++;
      t.cost += s.cost;
      t.placed += s.placed;
      t.room += s.room;
      t.picks.set(s.name, (t.picks.get(s.name) || 0) + 1);
    }
    return t;
  }

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"),
      text3: v("--text-3"), accent: v("--accent"), live: v("--live"), signal: v("--signal"), danger: v("--danger"), mono: v("--mono") || "monospace",
    };
  }

  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const narrow = W < 520;
    const padL = 12, padR = 12, padT = 8;
    const beltTop = padT + 14, beltH = 38;
    const sTop = beltTop + beltH + 28;
    const VH = narrow ? 124 : 186;
    const vTop = sTop + (narrow ? 54 : 40);
    const laneTop = vTop + VH + 30;
    const plotW = W - padL - padR;
    const cards = Math.max(1, Math.floor((plotW + 6) / ((narrow ? 76 : 90) + 6)));
    const cardW = (plotW + 6) / cards - 6, cardH = 62;
    const H = laneTop + cardH + 10;
    G = { W, H, padL, padR, padT, beltTop, beltH, sTop, VH, vTop, laneTop, cards, cardW, cardH, plotW, x0: padL + 60, narrow };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const bx = (t) => G.x0 + ((t - floor) / BELT_S) * (G.W - G.padR - G.x0);
  const unitColor = (k) => (k === "rule" ? colors.signal : k === "soft" ? colors.live : colors.text2);
  const fit = (ctx, s, w) => {
    if (ctx.measureText(s).width <= w) return s;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > w) s = s.slice(0, -1);
    return `${s}…`;
  };

  function draw(ts) {
    if (!G || !colors) return;
    const c = colors;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    const font = (px, w = 400) => `${w} ${px}px ${c.mono}`;
    drawBelt(ctx, font);
    drawStation(ctx, ts, font);
    drawLane(ctx, ts, font);
  }

  function ticket(ctx, o, x, y, font) {
    const c = colors;
    const units = o.lines.flatMap((l) => Array(l.qty).fill(kindOf(l)));
    const w = 44, h = 30;
    ctx.fillStyle = c.surface;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = o.you ? 2 : 1;
    ctx.strokeStyle = o.you ? c.accent : c.strong;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = o.you ? c.accent : c.text2;
    ctx.font = font(9, o.you ? 600 : 400);
    ctx.textAlign = "left";
    ctx.fillText(o.you ? "you" : o.label, x + 4, y + 11);
    units.forEach((k, i) => {
      ctx.fillStyle = unitColor(k);
      ctx.fillRect(x + 4 + (i % 5) * 7, y + 15 + Math.floor(i / 5) * 6, 5, 4);
    });
  }

  function drawBelt(ctx, font) {
    const c = colors, y = G.beltTop, h = G.beltH, x1 = G.W - G.padR;
    ctx.fillStyle = c.text3;
    ctx.font = font(10);
    ctx.textAlign = "left";
    ctx.fillText("incoming orders, arriving on floor time", G.padL, G.padT + 6);
    ctx.fillStyle = c.surface;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(G.x0, y, x1 - G.x0, h);
    ctx.globalAlpha = 1;
    // Rollers move with the floor clock.
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = Math.ceil(floor / 15) * 15; t <= floor + BELT_S; t += 15) {
      const x = Math.round(bx(t)) + 0.5;
      ctx.moveTo(x, y); ctx.lineTo(x, y + h);
    }
    ctx.stroke();
    ctx.strokeStyle = c.strong;
    ctx.beginPath();
    ctx.moveTo(G.x0, y + h + 0.5); ctx.lineTo(x1, y + h + 0.5);
    ctx.stroke();
    ctx.fillStyle = c.text3;
    ctx.textAlign = "center";
    const every = G.narrow ? 120 : 60;
    for (let t = Math.ceil(floor / every) * every; t <= floor + BELT_S; t += every) {
      const x = bx(t);
      if (x < G.x0 + 22 || x > x1 - 22) continue;
      ctx.fillText(clock(t).slice(0, -3), x, y + h + 13);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = c.text;
    ctx.font = font(10, 600);
    ctx.fillText("pack", G.padL, y + 16);
    ctx.fillStyle = c.text3;
    ctx.font = font(10);
    ctx.fillText(clock(floor), G.padL, y + 30);
    ctx.fillText("floor time →", x1 - 72, y + h + 25);
    ctx.save();
    ctx.beginPath(); ctx.rect(G.x0, y - 2, x1 - G.x0, h + 4); ctx.clip();
    for (let i = belt.length - 1; i >= 0; i--) {
      const o = belt[i];
      const x = Math.max(G.x0, bx(o.arrival));
      if (x > x1) continue;
      ticket(ctx, o, x, y + 4, font);
    }
    ctx.restore();
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(G.x0, y - 3); ctx.lineTo(G.x0, y + h + 3); ctx.stroke();
  }

  function why(s) {
    if (!s.name) return ["danger", "nothing on the shelf fits: the engine stays silent and a person decides"];
    if (s.ruleItems.length) {
      const n = s.barred[NEEDS_BOX] || 0;
      return ["rule", `rule first: ${s.ruleItems.join(", ")} ships only in a box${n ? `, ${n} mailers barred` : ""}`];
    }
    if (s.kind === "box") return ["plain", "no usable mailer fits, so the cheapest box that does"];
    return ["plain", "the cheapest usable mailer the basket fits"];
  }

  function drawStation(ctx, ts, font) {
    const c = colors, x = G.padL, w = G.plotW;
    if (!station) return;
    const { rec, r } = station;
    const s = rec.res;
    const pick = r.packages.find((p) => p.suggested);
    ctx.textAlign = "left";
    let y = G.sTop + 12;
    ctx.font = font(11);
    ctx.fillStyle = rec.you ? c.accent : c.text3;
    const tag = rec.you ? `you ${rec.label}` : rec.label;
    ctx.fillText(tag, x, y);
    let cx = x + ctx.measureText(tag).width + 8;
    ctx.font = font(14, 700);
    ctx.fillStyle = rec.you ? c.accent : c.text;
    const name = s.name || "no answer";
    ctx.fillText(name, cx, y + 1);
    cx += ctx.measureText(name).width + 10;
    if (s.name) {
      ctx.font = font(11);
      ctx.fillStyle = c.text2;
      const d = `${KIND[s.kind] || s.kind} · ${money(s.cost)} · ${pct(s.fill)} full`;
      if (G.narrow) { y += 16; cx = x; }
      ctx.fillText(fit(ctx, d, x + w - cx), cx, y);
    }
    const [k, t] = why(s);
    ctx.font = font(10, k === "plain" ? 400 : 600);
    ctx.fillStyle = k === "rule" ? c.signal : k === "danger" ? c.danger : c.text3;
    ctx.fillText(fit(ctx, t, w), x, y + 17);
    if (!pick) return;

    const gap = 16, slot = (w - gap) / 2, capH = 16, room = G.VH - capH;
    const L = pick.usableL, Wd = pick.usableW, Hh = pick.usableH;
    const k2 = Math.min(slot / L, room / Wd, room / Hh);
    const mail = isMailer(pick.kind);
    const n = Math.max(1, pick.placements.length);
    const span = Math.min(700, 42000 / Number(speed.value));
    const units = r.units;
    for (const [i, axis] of [[0, "y"], [1, "z"]]) {
      const bw = L * k2, bh = (axis === "y" ? Wd : Hh) * k2;
      const ox = x + i * (slot + gap) + (slot - bw) / 2;
      const oy = G.vTop + room - bh;
      ctx.fillStyle = c.surface;
      ctx.strokeStyle = mail ? c.live : s.ruleItems.length ? c.signal : c.text2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (mail && ctx.roundRect) ctx.roundRect(ox, oy, bw, bh, Math.min(6, bh / 2)); else ctx.rect(ox, oy, bw, bh);
      ctx.fill();
      ctx.stroke();
      if (axis === "y" && pick.structure) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = c.text3;
        ctx.lineWidth = 1;
        for (const [px, py, pw, ph] of pick.structure.cells) ctx.strokeRect(ox + px * k2, oy + py * k2, pw * k2, ph * k2);
        ctx.setLineDash([]);
      }
      const order = [...pick.placements].sort((p, q) => (axis === "y" ? p.z - q.z : q.y - p.y));
      ctx.save();
      ctx.beginPath(); ctx.rect(ox - 1, G.vTop - 30, bw + 2, room + 30); ctx.clip();
      for (const p of order) {
        const u = (ts - (station.t0 + (p.seq / n) * span)) / DROP_MS;
        if (station.t0 && u <= 0) continue;
        const e = station.t0 ? ease(u) : 1;
        const col = unitColor(kindOf(units[p.index]));
        let px = ox + p.x * k2, py, pw = p.dx * k2, ph;
        if (axis === "y") {
          py = oy + p.y * k2; ph = p.dy * k2;
          const g = 1 + 0.25 * (1 - e);
          px -= (pw * (g - 1)) / 2; py -= (ph * (g - 1)) / 2; pw *= g; ph *= g;
        } else {
          ph = p.dz * k2;
          const end = oy + bh - (p.z + p.dz) * k2;
          py = end - (1 - e) * (end - (G.vTop - ph - 4));
        }
        const a = station.t0 ? Math.min(1, u * 3) : 1;
        ctx.globalAlpha = 0.42 * a;
        ctx.fillStyle = col;
        ctx.fillRect(px, py, pw, ph);
        ctx.globalAlpha = a;
        ctx.strokeStyle = rec.you ? c.accent : col;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(px + 0.5, py + 0.5, Math.max(0, pw - 1), Math.max(0, ph - 1));
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.font = font(10);
      ctx.fillStyle = c.text3;
      ctx.textAlign = "center";
      const d = (v) => Number(v.toFixed(2));
      ctx.fillText(`${axis === "y" ? (G.narrow ? "top" : "top-down") : "front"} · ${d(L)} × ${d(axis === "y" ? Wd : Hh)}${G.narrow ? "" : " in"}`, x + i * (slot + gap) + slot / 2, G.vTop + room + 13);
      ctx.textAlign = "left";
    }
  }

  function glyph(ctx, s, x, y, you) {
    const c = colors;
    ctx.lineWidth = 1.5;
    if (!s.name) {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = c.danger;
      ctx.strokeRect(x + 0.5, y + 2.5, 22, 15);
      ctx.setLineDash([]);
      return;
    }
    const col = you ? c.accent : isMailer(s.kind) ? c.live : s.ruleItems.length ? c.signal : c.text2;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    if (isMailer(s.kind)) {
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x, y + 6, 26, 12);
      ctx.globalAlpha = 1;
      ctx.strokeRect(x + 0.5, y + 6.5, 25, 11);
      ctx.beginPath(); ctx.moveTo(x + 1, y + 7); ctx.lineTo(x + 13, y + 13); ctx.lineTo(x + 25, y + 7); ctx.stroke();
    } else {
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x + 2, y + 2, 20, 16);
      ctx.globalAlpha = 1;
      ctx.strokeRect(x + 2.5, y + 2.5, 19, 15);
      ctx.beginPath(); ctx.moveTo(x + 12, y + 3); ctx.lineTo(x + 12, y + 18); ctx.stroke();
    }
  }

  function card(ctx, o, x, y, font) {
    const c = colors, w = G.cardW, h = G.cardH, s = o.res;
    ctx.fillStyle = o.changed ? c.bg : c.surface;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = o.you ? 2 : 1;
    ctx.strokeStyle = o.you ? c.accent : o.changed ? c.text2 : c.line;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.font = font(9, o.you ? 600 : 400);
    ctx.textAlign = "left";
    ctx.fillStyle = o.you ? c.accent : c.text3;
    ctx.fillText(o.you ? `you ${o.label}` : o.label, x + 5, y + 11);
    if (o.changed) {
      ctx.textAlign = "right";
      ctx.fillStyle = c.text2;
      ctx.fillText("new", x + w - 5, y + 11);
      ctx.textAlign = "left";
    }
    glyph(ctx, s, x + 5, y + 15, o.you);
    ctx.fillStyle = c.text2;
    ctx.fillText(s.name ? money(s.cost) : "no fit", x + 36, y + 30);
    ctx.font = font(9, 600);
    ctx.fillStyle = c.text;
    ctx.fillText(fit(ctx, s.name || "a person decides", w - 10), x + 5, y + 52);
  }

  function drawLane(ctx, ts, font) {
    const c = colors, y = G.laneTop;
    ctx.font = font(10);
    ctx.fillStyle = c.text3;
    ctx.textAlign = "left";
    ctx.fillText("shipped, newest first →", G.padL, y - 8);
    const step = G.cardW + 6;
    const fitN = G.cards;
    const list = orders.slice(-fitN - 1).reverse();
    const slide = slideAt ? 1 - ease((ts - slideAt) / SLIDE_MS) : 0;
    const more = orders.length - fitN;
    if (more > 0) {
      ctx.textAlign = "right";
      ctx.fillText(`+${fmt(more)} earlier`, G.W - G.padR, y - 8);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(G.padL, y - 1, G.plotW, G.cardH + 2); ctx.clip();
    const flying = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const f = flights.find((q) => q.rec === list[i]);
      if (f) flying.push(f);
      else card(ctx, list[i], G.padL + i * step - slide * step, y, font);
    }
    ctx.restore();
    // A parcel leaves the station and lands at the head of the lane.
    for (const f of flying) {
      const t = ease((ts - f.t0) / FLY_MS);
      ctx.globalAlpha = Math.min(1, 0.25 + t);
      card(ctx, f.rec, G.padL, y - (1 - t) * (y - G.vTop - G.VH / 3), font);
      ctx.globalAlpha = 1;
    }
    if (!orders.length) {
      ctx.fillStyle = c.text3;
      ctx.fillText("nothing shipped yet", G.padL, y + 20);
    }
  }

  function updateDom(force) {
    const t = performance.now();
    if (!force && t - lastDom < 200) return;
    lastDom = t;
    cell.t.textContent = clock(floor);
    const T = tally();
    const n = orders.length;
    cell.orders.textContent = fmt(n);
    cell.boxes.textContent = fmt(T.boxes);
    cell.mailers.textContent = fmt(T.mailers);
    cell.rule.textContent = fmt(T.rule);
    cell.none.textContent = fmt(T.none);
    cell.cost.textContent = money(T.cost);
    cell.per.textContent = n - T.none ? money(T.cost / (n - T.none)) : "–";
    cell.fill.textContent = T.room ? pct(T.placed / T.room) : "–";
    const packed = T.boxes + T.mailers || 1;
    seg.mailer.style.width = `${(T.mailers / packed) * 100}%`;
    seg.box.style.width = `${((T.boxes - T.rule) / packed) * 100}%`;
    seg.rule.style.width = `${(T.rule / packed) * 100}%`;
    splitKey.replaceChildren();
    for (const [k, v, label] of [["mailer", T.mailers, "mailers"], ["box", T.boxes - T.rule, "other boxes"], ["rule", T.rule, "boxes by rule"]]) {
      const s = el("span", "af-key", `${label} ${fmt(v)}`);
      s.dataset.kind = k;
      splitKey.append(s);
    }
    const ranked = [...T.picks].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const max = ranked.length ? ranked[0][1] : 1;
    top.replaceChildren(...ranked.slice(0, 5).map(([name, k]) => {
      const li = el("li");
      const p = cat.packages.find((q) => q.name === name);
      li.classList.toggle("af-gone", off.has(name));
      const bar = el("span", `af-bar${isMailer(p?.kind) ? " af-bar-mailer" : ""}`);
      bar.style.width = `${(k / max) * 100}%`;
      const track = el("span", "af-track");
      track.append(bar);
      li.append(el("span", "af-tn", name), track, el("span", "af-tc", fmt(k)));
      return li;
    }));
    if (!ranked.length) top.append(el("li", "af-dim", "no packages picked yet"));
    for (const [name, { b, n: cnt }] of chip) {
      const k = T.picks.get(name) || 0;
      cnt.textContent = k ? ` ${fmt(k)}` : "";
      b.setAttribute("aria-pressed", String(!off.has(name)));
    }
    shelfTitle.textContent = `shelf · ${cat.packages.length - off.size} of ${cat.packages.length} on it`;
    takeTop.disabled = !ranked.some(([name]) => !off.has(name)) || !!replaying;
    restock.disabled = !off.size || !!replaying;
    receipt.textContent = `${fmt(n)} orders packed by AnchorFlow's fit engine: ${fmt(calls)} calls judged ${fmt(judged)} packages in ${fmt(Math.round(callMs))} ms, in your browser.`;
    if (station) {
      const s = station.rec.res;
      now.replaceChildren();
      now.append(el("span", "af-dim", `at the station, ${station.rec.you ? "your order " : ""}${station.rec.label}: `), station.rec.lines.map(lineText).join(", "));
      if (s.name && !s.packed) now.append(el("span", "af-dim", ` · the drawing seats ${s.seated} of ${s.units} units; the fit rules accept it, the packer that draws it placed fewer`));
      const reasons = Object.entries(s.barred).map(([why, k]) => `${k} ${why}`).join("; ");
      if (reasons) now.append(el("span", "af-dim", ` · barred by rule: ${reasons}`));
    }
    canvas.setAttribute("aria-label", `Packing floor at ${clock(floor)} of floor time: ${fmt(n)} orders packed, ${fmt(T.boxes)} in boxes and ${fmt(T.mailers)} in mailers, ` +
      `${station ? `latest ${station.rec.label} in ${station.rec.res.name || "nothing"}` : "none yet"}.`);
    step.disabled = n >= SHIFT && !belt.some((o) => o.you);
    drop.disabled = !yours.length || n >= SHIFT;
  }

  function renderYours() {
    yourLines.replaceChildren();
    for (const l of yours) {
      const li = el("li");
      const b = button(`${lineText(l)} ✕`, "secondary af-chip");
      b.setAttribute("aria-label", `Remove one ${l.name}`);
      b.addEventListener("click", () => {
        l.qty--;
        yours = yours.filter((x) => x.qty > 0);
        renderYours();
      });
      li.append(b);
      yourLines.append(li);
    }
    if (!yours.length) yourLines.append(el("li", "af-dim", "empty, add an item"));
    const units = yours.reduce((a, l) => a + l.qty, 0);
    addItem.disabled = units >= cat.maxUnits;
    drop.disabled = !units || orders.length >= SHIFT;
  }

  const fail = (err) => { status.textContent = err.message; };

  async function rejudge(note) {
    const g = gen, my = ++replaying;
    await chain;
    if (g !== gen || my !== replaying) return;
    const before = tally().cost;
    let changed = 0;
    const list = [...orders];
    updateDom(true);
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const r = await planOf(rec);
      if (g !== gen || my !== replaying) return;
      const prev = rec.res.name;
      rec.res = summarize(r);
      rec.changed = prev !== rec.res.name;
      if (rec.changed) changed++;
      if (station && station.rec === rec) station = { rec, r, t0: reduce.matches ? 0 : performance.now() };
      if (i % 8 === 7) status.textContent = `Re-judging the shift: ${fmt(i + 1)} of ${fmt(list.length)} orders…`;
    }
    replaying = 0;
    const mine = list.filter((o) => o.you).pop();
    if (mine && mine.changed) sayYou(mine);
    const after = tally().cost;
    status.textContent = `${note}. The engine re-judged all ${fmt(list.length)} orders packed so far: ${fmt(changed)} ${changed === 1 ? "pick" : "picks"} changed, cost ${money(before)} → ${money(after)}.`;
    updateDom(true);
    draw(performance.now());
    kick();
  }

  function toggle(name) {
    if (off.has(name)) off.delete(name); else off.add(name);
    rejudge(off.has(name) ? `${name} is off the shelf` : `${name} is back on the shelf`).catch(fail);
  }

  async function restart() {
    gen++;
    const g = gen;
    replaying = 0;
    rand = rng(SEED);
    floor = 0; nextAt = 0; nextId = 1; yourN = 0;
    belt = []; orders = []; station = null; flights = []; slideAt = 0;
    youLine.textContent = "";
    fillBelt();
    const warm = reduce.matches ? WARM_REDUCED : WARM;
    for (let i = 0; i < warm; i++) {
      floor = belt[0].arrival;
      await packNext(false);
      if (g !== gen) return;
      fillBelt();
    }
    status.textContent = `${MIXES.find(([v]) => v === mix.value)[1]}: orders arrive at random, about one every ${ARRIVE_S} s of floor time (seed ${SEED}), up to ${SHIFT} a shift.`;
    updateDom(true);
    draw(performance.now());
  }

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && !replaying) {
      if (orders.length >= SHIFT && !belt.some((o) => o.you)) {
        setPlaying(false);
        status.textContent = `Shift full: ${fmt(SHIFT)} orders packed. Reset for a new shift.`;
      } else {
        floor += (dt / 1000) * Number(speed.value);
        const nx = belt[0];
        if (nx && nx.arrival <= floor) {
          floor = nx.arrival;
          if (!busy) packNext(!reduce.matches).catch(fail);
        }
        fillBelt();
      }
    }
    flights = flights.filter((f) => ts - f.t0 < FLY_MS);
    draw(ts);
    updateDom(false);
    const span = Math.min(700, 42000 / Number(speed.value)) + DROP_MS;
    const moving = flights.length || (slideAt && ts - slideAt < SLIDE_MS) || (station && station.t0 && ts - station.t0 < span);
    if ((playing || moving) && visible && !document.hidden) raf = requestAnimationFrame(frame);
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
  step.addEventListener("click", async () => {
    setPlaying(false);
    await chain;
    if (replaying || !belt.length) return;
    floor = Math.max(floor, belt[0].arrival);
    await packNext(!reduce.matches);
    fillBelt();
    draw(performance.now());
    kick();
  });
  reset.addEventListener("click", () => restart().then(kick).catch(fail));
  mix.addEventListener("change", () => restart().then(kick).catch(fail));
  speed.addEventListener("change", kick);
  addItem.addEventListener("click", () => {
    const it = ITEMS[Number(yourItem.value)];
    const had = yours.find((l) => l.name === it.name);
    if (had) had.qty++; else yours.push({ ...it, qty: 1 });
    renderYours();
  });
  drop.addEventListener("click", async () => {
    if (!yours.length) return;
    yourN++;
    const rec = { id: `you${yourN}`, label: `#Y${yourN}`, lines: yours.map((l) => ({ ...l })), arrival: floor + (playing ? 20 : 0), you: true };
    youLine.textContent = `Your order ${rec.label} is on the line.`;
    if (playing) {
      belt.push(rec);
      belt.sort((a, b) => a.arrival - b.arrival);
    } else {
      await chain;
      belt.unshift(rec);
      if (!replaying) await packNext(!reduce.matches);
    }
    draw(performance.now());
    kick();
  });
  takeTop.addEventListener("click", () => {
    const ranked = [...tally().picks].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).filter(([name]) => !off.has(name));
    if (ranked.length) toggle(ranked[0][0]);
  });
  restock.addEventListener("click", () => {
    off.clear();
    rejudge("Every package is back on the shelf").catch(fail);
  });

  new ResizeObserver(() => { if (!root.isConnected) return; layout(); readColors(); draw(performance.now()); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const recolor = () => { readColors(); draw(performance.now()); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
  window.addEventListener("themechange", recolor);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  renderYours();
  await cssReady;
  readColors();
  layout();
  await restart();
  setPlaying(playing);
}
