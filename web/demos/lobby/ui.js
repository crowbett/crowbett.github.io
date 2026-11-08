// lobby demo: lobby's real match.Queue and handoff.Static, compiled to
// WebAssembly. Players arrive on simulated time; each band is match.Window for
// that player's wait, Queue.Step forms the groups every 100 ms tick, and each
// room's handoff tokens are minted and verified by the binary.
const RATES = [0.5, 1, 2, 3, 5, 8, 12, 20];
const SIGMAS = [[200, "N(1000, 200)"], [600, "N(1000, 600)"]];
const DROPS = [[0, "none"], [0.2, "20 %"], [0.4, "40 %"]];
const SPEEDS = [1, 2, 5, 10];
const WARMUP_MS = 8000;
const FLY_MS = 300;
const SLIDE_MS = 200;
const MAX_CARDS = 12;
const Y_MAX_MS = 36000;
const WAIT_TICKS = [1000, 5000, 10000, 20000, 30000];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const secs = (ms, d = 1) => `${(ms / 1000).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} s`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

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
  const p = { mode: "duel", rate: 3, sigma: 600, drop: 0.2, refill: true, seed: 1 };
  const mode = select("mode", [["duel", "duel, 2 players"], ["squad", "squad, 4 players"]], p.mode);
  const rate = el("input");
  Object.assign(rate, { type: "range", name: "rate", min: 0, max: RATES.length - 1, step: 1, value: RATES.indexOf(p.rate) });
  const rateOut = el("output", "lb-out", `${p.rate} /s`);
  const rateField = field("Arrivals", rate, "lb-range");
  rateField.querySelector(".demo-label").append(" ", rateOut);
  const sigma = select("sigma", SIGMAS, p.sigma);
  const drop = select("drop", DROPS, p.drop);
  const refill = el("input");
  Object.assign(refill, { type: "checkbox", name: "refill", checked: p.refill });
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 2);
  const squadOnly = [field("Walk-outs", drop), field("Squad refill", refill, "lb-check")];
  const knobs = el("div", "lb-knobs");
  knobs.append(field("Mode", mode), rateField, field("Skill", sigma), ...squadOnly, field("Speed", speed));

  const play = button("Pause");
  const step = button("Step 1 s", "secondary");
  const reset = button("Reset", "secondary");
  const skill = el("input");
  Object.assign(skill, { type: "number", name: "skill", min: 0, max: 2000, step: 1, value: 1800, required: true });
  skill.inputMode = "numeric";
  const join = button("Queue me");
  const acts = el("div", "lb-acts");
  acts.append(play, step, reset, field("Your skill", skill, "lb-skill"), join);
  const form = el("form", "lb-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(knobs, acts);

  const canvas = el("canvas", "lb-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "lb-legend");
  for (const [k, t] of [["player", "waiting player"], ["band", "window, match.Window(wait)"], ["you", "you"], ["unit", "refill unit"]]) {
    const s = el("span", "lb-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const youLine = el("p", "lb-you");
  youLine.setAttribute("aria-live", "polite");
  const youTick = el("span", "lb-you-tick");
  const status = el("p", "lb-status");
  status.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells lb-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["queue", "queue"], ["rooms", "rooms"], ["p50", "wait p50"], ["p95", "wait p95"], ["spread", "spread p50"],
    ["expired", "expired"], ["walkouts", "walk-outs"], ["short", "short-handed"], ["refills", "refills"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "lb-v", "–");
    li.append(el("span", "lb-k", t), v);
    cell[k] = { li, v };
    cells.append(li);
  }
  root.replaceChildren(form, canvas, legend, youLine, cells, status);

  // State.
  let rule = null;
  let snap = null;
  let gen = 0;
  let cards = [];
  let flights = [];
  let pos = new Map();
  let born = new Map();
  let you = null;
  let playing = !reduce.matches;
  let visible = true;
  let pending = 0;
  let last = 0;
  let busy = 0;
  let chain = Promise.resolve();
  let raf = 0;
  let hover = null;
  let colors = null;
  let lastDom = 0;

  const exec = (method, params) => {
    busy++;
    const g = gen;
    const run = chain.then(() => demo.call(method, params)).finally(() => { busy--; });
    chain = run.catch(() => {});
    return run.then((r) => ({ r, g }));
  };

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"),
      text2: v("--text-2"), text3: v("--text-3"), accent: v("--accent"), tint: v("--accent-tint"), live: v("--live"),
      band: v("--lb-band"), cone: v("--lb-cone"), mono: v("--mono") || "monospace",
    };
  }

  // Geometry, in CSS pixels.
  let G = null;
  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const padL = 30, padR = 12, padT = 20;
    const floorH = Math.round(Math.min(300, Math.max(180, W * 0.36)));
    const axisY = padT + floorH;
    const laneTop = axisY + 34;
    const cardH = 74;
    const H = laneTop + cardH + 12;
    G = { W, H, padL, padR, padT, floorH, axisY, laneTop, cardH, plotW: W - padL - padR };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const sx = (s) => G.padL + ((s - rule.skill_min) / (rule.skill_max - rule.skill_min)) * G.plotW;
  // Wait runs up the floor on a square-root scale, so the first seconds, where most matches form, get room.
  const sy = (ms) => G.axisY - Math.sqrt(Math.min(Math.max(ms, 0), Y_MAX_MS) / Y_MAX_MS) * G.floorH;
  const unsx = (x) => Math.round(rule.skill_min + ((x - G.padL) / G.plotW) * (rule.skill_max - rule.skill_min));

  // The window's history for a waiting entry: the binary's match.Window samples (1 s apart) up to its wait, each
  // gap split in four by linear interpolation (the rule is linear in wait there), ending at its current window.
  function cone(e) {
    const pts = [];
    const cv = rule.curve;
    for (let i = 0; i < cv.length && cv[i][0] < e.wait_ms; i++) {
      pts.push(cv[i]);
      const nx = cv[i + 1];
      if (!nx) break;
      for (let k = 1; k < 4; k++) {
        const t = cv[i][0] + ((nx[0] - cv[i][0]) * k) / 4;
        if (t >= e.wait_ms) break;
        pts.push([t, cv[i][1] + ((nx[1] - cv[i][1]) * k) / 4]);
      }
    }
    pts.push([e.wait_ms, e.w]);
    return pts;
  }

  function cardW(size) { return Math.max(118, 12 + size * 34 + (size - 1) * 4); }
  function cardX(i) {
    let x = G.padL;
    for (let j = 0; j < i; j++) x += cardW(cards[j].size) + 8;
    return x;
  }
  function slotXY(card, i, cx) {
    return { x: cx + 6 + i * 38 + 17, y: G.laneTop + 22 + 10 };
  }

  // Applies one bridge answer: queue positions, new cards and flights.
  function apply(s, now, animate) {
    snap = s;
    const seen = new Set();
    for (const q of s.queue) {
      seen.add(q.id);
      if (!born.has(q.id)) born.set(q.id, animate ? now : 0);
      pos.set(q.id, { x: sx(q.skill), y: sy(q.wait_ms) });
    }
    for (const e of s.events) {
      if (e.kind === "match") onMatch(e, now, animate);
      else if (e.kind === "start") onStart(e, now);
      else if (e.kind === "expired") {
        if (e.id === "you") setYou({ state: "expired", skill: e.skill, wait: e.wait_ms });
      }
    }
    for (const id of [...pos.keys()]) if (!seen.has(id)) { pos.delete(id); born.delete(id); }
    const me = s.queue.find((q) => q.you);
    if (me && you?.state === "queued") { you.wait = me.wait_ms; you.w = me.w; }
  }

  function findCard(room) { return cards.findIndex((c) => c.room === room); }

  function onMatch(e, now, animate) {
    let i = e.refill ? findCard(e.room) : -1;
    let c;
    if (i >= 0) {
      c = cards[i];
    } else {
      c = { room: e.room, match: e.id, size: snap.size, seated: [], at: now, landed: now, slide: animate ? now : 0, from: 0 };
      cards.unshift(c);
      i = 0;
      if (cards.length > MAX_CARDS) cards.length = MAX_CARDS;
      for (let j = 1; j < cards.length; j++) { cards[j].slide = animate ? now : 0; cards[j].from = cardW(c.size) + 8; }
    }
    c.outcome = e.outcome;
    c.prev = c.seated.length;
    c.seated = e.seated || [];
    c.spread = e.spread;
    c.nonce = e.nonce || "";
    c.verified = e.verified || 0;
    c.refilled = c.refilled || e.refill;
    c.landed = animate ? now + FLY_MS : 0;
    const cx = cardX(i);
    let slot = c.prev;
    for (const pl of e.players) {
      const from = pos.get(pl.id) || { x: sx(pl.skill), y: sy(pl.wait_ms) };
      if (pl.unit) {
        if (animate) flights.push({ from, to: slotXY(c, 0, cx), t0: now, kind: "unit", seats: pl.seats });
        continue;
      }
      if (animate) {
        const to = pl.left ? { x: cx + cardW(c.size) / 2, y: G.H + 10 } : slotXY(c, slot, cx);
        flights.push({ from, to, t0: now, kind: pl.left ? "left" : pl.id === "you" ? "you" : "player", via: pl.left ? slotXY(c, slot, cx) : null });
      }
      if (!pl.left) slot++;
      if (pl.id === "you") {
        const mates = [...(e.seated || [])];
        mates.splice(mates.indexOf(pl.skill), 1);
        setYou({ state: "matched", skill: pl.skill, wait: pl.wait_ms, match: e.id, mates, spread: e.spread, outcome: e.outcome });
      }
    }
    pos.delete(e.players.find((x) => x.unit)?.id);
  }

  function onStart(e) {
    const i = findCard(e.room);
    if (i < 0) return;
    const c = cards[i];
    c.outcome = e.outcome === "timeout" ? "timeout" : "short";
    c.seated = e.seated || c.seated;
    c.spread = e.spread;
    c.nonce = e.nonce || "";
    c.verified = e.verified || 0;
  }

  function setYou(v) {
    you = v;
    if (v.state === "queued") youLine.textContent = `You are queued at skill ${fmt(v.skill)}. Your window starts at ±${rule.w0} and widens while you wait.`;
    else if (v.state === "matched") {
      const with_ = v.mates.length ? ` with ${v.mates.map(fmt).join(", ")}` : "";
      youLine.textContent = `Matched after ${secs(v.wait)} into ${v.match}${with_}; skill spread ${fmt(v.spread)}.`;
    } else if (v.state === "expired") youLine.textContent = `Expired after ${secs(v.wait, 0)}: nobody came within reach before MATCH_MAX_WAIT.`;
    youLine.append(youTick);
    youTick.textContent = "";
  }

  // Drawing.
  function draw(now) {
    if (!G || !rule) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    const font = (px, w = 400) => `${w} ${px}px ${c.mono}`;

    // Grid: skill every 250, wait every 10 s, and the line where the window stops widening.
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    for (let s = rule.skill_min; s <= rule.skill_max; s += 250) { const x = Math.round(sx(s)) + 0.5; ctx.moveTo(x, G.padT); ctx.lineTo(x, G.axisY); }
    for (const t of WAIT_TICKS) { const y = Math.round(sy(t)) + 0.5; ctx.moveTo(G.padL, y); ctx.lineTo(G.W - G.padR, y); }
    ctx.stroke();
    ctx.fillStyle = c.text3;
    ctx.font = font(10);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of [0, ...WAIT_TICKS]) ctx.fillText(`${t / 1000}s`, G.padL - 5, sy(t));
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("wait", 4, G.padT - 7);
    const yMax = Math.round(sy(rule.widen_over_ms)) + 0.5;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = c.strong;
    ctx.beginPath(); ctx.moveTo(G.padL, yMax); ctx.lineTo(G.W - G.padR, yMax); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "right";
    ctx.fillText(`window ±${rule.wmax} from ${secs(rule.widen_over_ms, 0)}`, G.W - G.padR - 2, yMax - 5);

    // Axis.
    ctx.strokeStyle = c.text3;
    ctx.beginPath(); ctx.moveTo(G.padL, G.axisY + 0.5); ctx.lineTo(G.W - G.padR, G.axisY + 0.5); ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = c.text3;
    const labelEvery = G.plotW < 420 ? 500 : 250;
    for (let s = rule.skill_min; s <= rule.skill_max; s += labelEvery) {
      ctx.fillText(fmt(s), Math.min(G.W - G.padR - 12, Math.max(G.padL + 8, sx(s))), G.axisY + 14);
    }
    ctx.textAlign = "left";
    ctx.fillText("skill", G.padL, G.axisY + 27);
    ctx.textAlign = "right";
    ctx.fillText(`rooms, newest first →`, G.W - G.padR, G.axisY + 27);

    // Cones and bands: the window's whole history up to now, from the binary's curve.
    const q = snap ? snap.queue : [];
    const order = [...q].sort((a, b) => (a.you ? 1 : 0) - (b.you ? 1 : 0) || b.wait_ms - a.wait_ms);
    ctx.save();
    ctx.beginPath(); ctx.rect(G.padL, 0, G.plotW, G.axisY + 1); ctx.clip();
    for (const e of order) {
      const pts = cone(e);
      const fade = born.get(e.id) ? Math.min(1, (now - born.get(e.id)) / 200) : 1;
      ctx.globalAlpha = (e.you ? 0.22 : 0.07) * fade;
      ctx.fillStyle = e.you ? c.accent : e.unit ? c.band : c.cone;
      ctx.beginPath();
      pts.forEach(([t, w], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(e.skill - w), sy(t)));
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(sx(e.skill + pts[i][1]), sy(pts[i][0]));
      ctx.closePath();
      ctx.fill();
      const y = sy(e.wait_ms);
      ctx.globalAlpha = (e.you ? 1 : 0.75) * fade;
      ctx.strokeStyle = e.you ? c.accent : c.band;
      ctx.lineWidth = e.you ? 2 : 1.25;
      const x0 = sx(e.skill - e.w), x1 = sx(e.skill + e.w);
      ctx.beginPath();
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.moveTo(x0, y - 3); ctx.lineTo(x0, y + 3);
      ctx.moveTo(x1, y - 3); ctx.lineTo(x1, y + 3);
      ctx.stroke();
    }
    ctx.restore();
    for (const e of order) {
      const fade = born.get(e.id) ? Math.min(1, (now - born.get(e.id)) / 200) : 1;
      ctx.globalAlpha = fade;
      dot(ctx, sx(e.skill), sy(e.wait_ms), e.you ? "you" : e.unit ? "unit" : "player", e.seats, font);
    }
    ctx.globalAlpha = 1;

    if (hover && !hover.touch) {
      ctx.strokeStyle = c.accent;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(hover.x) + 0.5, G.padT); ctx.lineTo(Math.round(hover.x) + 0.5, G.axisY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.accent;
      ctx.textAlign = hover.x > G.W - 90 ? "right" : "left";
      ctx.font = font(10, 600);
      ctx.fillText(`queue at ${fmt(unsx(hover.x))}`, hover.x + (hover.x > G.W - 90 ? -6 : 6), G.padT + 10);
    }

    // Room cards.
    let x = G.padL;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, G.laneTop - 2, G.W, G.cardH + 4); ctx.clip();
    for (let i = 0; i < cards.length && x < G.W; i++) {
      const k = cards[i];
      const off = k.slide ? (1 - ease((now - k.slide) / SLIDE_MS)) * -k.from : 0;
      drawCard(ctx, k, x + off, now, font);
      x += cardW(k.size) + 8;
    }
    ctx.restore();
    if (!cards.length) {
      ctx.fillStyle = c.text3;
      ctx.font = font(10);
      ctx.textAlign = "left";
      ctx.fillText("no rooms yet", G.padL, G.laneTop + 20);
    }

    // Flights from the floor into their room.
    flights = flights.filter((f) => now - f.t0 < FLY_MS);
    for (const f of flights) {
      const t = ease((now - f.t0) / FLY_MS);
      let px, py;
      if (f.via) {
        const a = Math.min(1, t * 1.6), b = Math.max(0, t * 1.6 - 0.6);
        px = f.from.x + (f.via.x - f.from.x) * a + (f.to.x - f.via.x) * b;
        py = f.from.y + (f.via.y - f.from.y) * a + (f.to.y - f.via.y) * b;
        ctx.globalAlpha = 1 - b;
      } else {
        px = f.from.x + (f.to.x - f.from.x) * t;
        py = f.from.y + (f.to.y - f.from.y) * t - Math.sin(t * Math.PI) * 18;
      }
      dot(ctx, px, py, f.kind === "left" ? "player" : f.kind, f.seats, font);
      ctx.globalAlpha = 1;
    }
  }

  function dot(ctx, x, y, kind, seats, font) {
    const c = colors;
    if (kind === "unit") {
      ctx.fillStyle = c.band;
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = c.text;
      ctx.font = font(9, 600);
      ctx.textAlign = "left";
      ctx.fillText(`×${seats}`, x + 7, y + 3);
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, kind === "you" ? 5 : 3.25, 0, Math.PI * 2);
    ctx.fillStyle = kind === "you" ? c.accent : c.text;
    ctx.fill();
    if (kind === "you") {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.accent;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = c.accent;
      ctx.font = font(10, 600);
      ctx.textAlign = "center";
      ctx.fillText("you", x, y - 13);
    }
  }

  const OUTCOME = { ready: "ready", short: "short-handed", timeout: "refill timed out", refilling: "refilling", empty: "everyone left" };
  function drawCard(ctx, k, x, now, font) {
    const c = colors;
    const w = cardW(k.size), y = G.laneTop, h = G.cardH;
    ctx.fillStyle = c.surface;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = k.outcome === "ready" ? c.strong : c.band;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = "left";
    ctx.font = font(10, 600);
    ctx.fillStyle = c.text;
    ctx.fillText(k.match, x + 6, y + 14);
    ctx.font = font(10);
    ctx.fillStyle = k.outcome === "ready" ? c.text2 : c.band;
    ctx.textAlign = "right";
    ctx.fillText(k.refilled && k.outcome === "ready" ? "refilled" : OUTCOME[k.outcome] || k.outcome, x + w - 6, y + 14);
    const landed = !k.landed || now >= k.landed;
    for (let i = 0; i < k.size; i++) {
      const sxp = x + 6 + i * 38, syp = y + 22;
      const filled = i < (landed ? k.seated.length : k.prev);
      if (filled) {
        ctx.fillStyle = c.bg;
        ctx.fillRect(sxp, syp, 34, 20);
        ctx.fillStyle = c.text;
        ctx.font = font(10);
        ctx.textAlign = "center";
        ctx.fillText(String(k.seated[i]), sxp + 17, syp + 14);
      } else {
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = c.band;
        ctx.strokeRect(sxp + 0.5, syp + 0.5, 33, 19);
        ctx.setLineDash([]);
      }
    }
    ctx.textAlign = "left";
    ctx.font = font(9);
    ctx.fillStyle = c.text3;
    if (k.nonce) {
      ctx.fillText(`spread ${fmt(k.spread)}`, x + 6, y + 54);
      ctx.fillText(`hmac ${k.nonce.slice(0, 8)} ${k.verified}/${k.seated.length}`, x + 6, y + 67);
    } else if (k.outcome === "refilling") {
      ctx.fillText("unit back in queue", x + 6, y + 54);
    } else if (k.outcome === "empty") {
      ctx.fillText("no handoff", x + 6, y + 54);
    }
  }

  function updateDom(force) {
    const now = performance.now();
    if (!force && now - lastDom < 200) return;
    lastDom = now;
    const s = snap;
    if (!s) return;
    const st = s.stats;
    const set = (k, v) => { cell[k].v.textContent = v; };
    set("t", secs(s.t_ms));
    set("queue", fmt(s.queue.length));
    set("rooms", fmt(st.rooms));
    set("p50", st.matched_tickets ? secs(st.wait_p50_ms, 2) : "–");
    set("p95", st.matched_tickets ? secs(st.wait_p95_ms, 2) : "–");
    set("spread", st.rooms ? fmt(st.spread_p50) : "–");
    set("expired", fmt(st.expired));
    set("walkouts", fmt(st.walkouts));
    set("short", fmt(st.short_handed));
    set("refills", fmt(st.refills));
    canvas.setAttribute("aria-label", `Matchmaking floor at ${secs(s.t_ms)} of simulated time: ${fmt(s.queue.length)} waiting, ` +
      `${fmt(st.rooms)} rooms started, wait p50 ${secs(st.wait_p50_ms, 2)}, p95 ${secs(st.wait_p95_ms, 2)}.`);
    if (you?.state === "queued") youTick.textContent = ` Waiting ${secs(you.wait)}, window ±${fmt(you.w)}.`;
  }

  function syncSquad() {
    const sq = mode.value === "squad";
    for (const f of squadOnly) f.hidden = !sq;
    for (const k of ["walkouts", "short", "refills"]) cell[k].li.hidden = !sq;
    legend.querySelector("[data-kind=unit]").hidden = !sq || !refill.checked;
  }

  function params() {
    return { mode: mode.value, rate: RATES[Number(rate.value)], sigma: Number(sigma.value), drop: Number(drop.value), refill: refill.checked, seed: p.seed };
  }

  let restarting = Promise.resolve();
  function restart() {
    restarting = doRestart();
    return restarting;
  }
  let warming = false;
  async function doRestart() {
    warming = true;
    try {
      await warm();
    } finally {
      warming = false;
    }
  }
  async function warm() {
    gen++;
    for (const k in cell) cell[k].v.textContent = "–";
    cards = []; flights = []; pos = new Map(); born = new Map(); you = null; pending = 0;
    youLine.textContent = "";
    join.disabled = false;
    syncSquad();
    const { r } = await exec("reset", params());
    rule = r.rule;
    apply(r, 0, false);
    const g = gen;
    for (let done = 0; done < WARMUP_MS; done += 2000) {
      const { r: a } = await exec("advance", { ms: 2000 });
      if (g !== gen) return;
      apply(a, 0, false);
    }
    status.textContent = `${mode.value} queue, ${RATES[Number(rate.value)]} arrivals/s, skills ${SIGMAS.find(([v]) => v === Number(sigma.value))[1]}: ${secs(WARMUP_MS, 0)} warmed up.`;
    updateDom(true);
    draw(performance.now());
  }

  async function advance(ms, animate) {
    const g = gen;
    const { r } = await exec("advance", { ms });
    if (g !== gen) return;
    apply(r, performance.now(), animate);
    updateDom(!animate);
  }

  const fail = (err) => { status.textContent = err.message; };

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing) {
      pending += dt * Number(speed.value);
      if (!busy && !warming && pending >= 1) {
        const ms = Math.min(5000, Math.round(pending));
        pending -= ms;
        advance(ms, !reduce.matches).catch(fail);
      }
    }
    draw(ts);
    updateDom(false);
    if ((playing || flights.length || cards.some((c) => c.slide && ts - c.slide < SLIDE_MS)) && visible && !document.hidden) raf = requestAnimationFrame(frame);
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
  mode.addEventListener("change", () => restart().catch(fail).then(kick));
  rate.addEventListener("input", () => {
    rateOut.textContent = `${RATES[Number(rate.value)]} /s`;
    exec("set", params()).then(({ r, g }) => { if (g === gen) apply(r, performance.now(), !reduce.matches); }).catch(fail);
  });
  for (const c of [sigma, drop, refill]) c.addEventListener("change", () => {
    syncSquad();
    exec("set", params()).then(({ r, g }) => { if (g === gen) { apply(r, performance.now(), !reduce.matches); updateDom(true); draw(performance.now()); kick(); } }).catch(fail);
  });
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    restarting.then(() => advance(1000, !reduce.matches)).then(() => { draw(performance.now()); kick(); }).catch(fail);
  });
  reset.addEventListener("click", () => restart().then(() => kick()).catch(fail));

  async function queueMe(v) {
    if (!Number.isInteger(v) || v < 0 || v > 2000) {
      status.textContent = "Skill must be a whole number from 0 to 2,000.";
      return;
    }
    if (you?.state === "queued") {
      status.textContent = "You are already in the queue.";
      return;
    }
    await restarting;
    const { r, g } = await exec("join", { skill: v });
    if (g !== gen) return;
    apply(r, performance.now(), !reduce.matches);
    setYou({ state: "queued", skill: v, wait: 0, w: rule.w0 });
    skill.value = String(v);
    updateDom(true);
    draw(performance.now());
    kick();
  }
  join.addEventListener("click", () => queueMe(Number(skill.value)).catch(fail));
  skill.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); queueMe(Number(skill.value)).catch(fail); } });

  const local = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top, touch: e.pointerType === "touch" };
  };
  canvas.addEventListener("pointermove", (e) => {
    const h = local(e);
    hover = G && h.y >= G.padT && h.y <= G.axisY + 20 && h.x >= G.padL && h.x <= G.W - G.padR ? h : null;
    canvas.classList.toggle("lb-aim", !!hover);
    if (!raf) draw(performance.now());
  });
  canvas.addEventListener("pointerleave", () => { hover = null; if (!raf) draw(performance.now()); });
  canvas.addEventListener("pointerdown", (e) => {
    const h = local(e);
    if (!G || h.y > G.axisY + 20 || h.x < G.padL - 6 || h.x > G.W - G.padR + 6) return;
    queueMe(Math.max(0, Math.min(2000, unsx(h.x)))).catch(fail);
  });

  new ResizeObserver(() => { if (!root.isConnected) return; layout(); readColors(); draw(performance.now()); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); draw(performance.now()); });
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  readColors();
  layout();
  await restart();
  setPlaying(playing);
}
