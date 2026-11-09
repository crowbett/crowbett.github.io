// keel demo: keel's deterministic simulator, compiled to WebAssembly. One call
// runs a whole seed of the Raft register workload (five servers, three clients)
// under the nemesis and returns its fault schedule, op counts, linearizability
// verdict and trace digest. The page replays each seed's schedule on its own
// simulated clock and sweeps seed after seed.
const NODES = [1, 2, 3, 4, 5];
const SPEEDS = [1, 2, 5, 10];
const SEED_MAX = 255;
const START_SEED = 2;
const MAX_SEED = Number.MAX_SAFE_INTEGER;
const PULSE_MS = 300;
const SLIDE_MS = 250;
const HOLD_MS = 1100;
const STRIP_MAX = 256;
const CHECK_N = 24;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const secs = (ns, d = 2) => `${(ns / 1e9).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} s`;
const set = (nodes) => `{${nodes.join(",")}}`;
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

function describe(e) {
  switch (e.kind) {
    case "crash": return `node ${e.node} crashes`;
    case "restart": return `node ${e.node} restarts (inc ${e.inc})`;
    case "pause": return `node ${e.node} pauses`;
    case "resume": return `node ${e.node} resumes`;
    case "partition": return `partition ${set(e.sides[0])} | ${set(e.sides[1])}`;
    case "heal": return "network healed";
    case "skew": return e.skew_ns ? `node ${e.node} clock ${e.skew_ns > 0 ? "+" : "−"}${fmt(Math.round(Math.abs(e.skew_ns) / 1e6))} ms` : `node ${e.node} clock skew reset`;
    default: return e.kind;
  }
}

// The log's lines: one per event, except clock-skew resets at one instant, which share one.
function logLines(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    let text = describe(e);
    if (e.kind === "skew" && !e.skew_ns) {
      const nodes = [e.node];
      while (events[i + 1]?.kind === "skew" && !events[i + 1].skew_ns && events[i + 1].t_ns === e.t_ns) nodes.push(events[++i].node);
      if (nodes.length > 1) text = `clock skew reset on ${nodes.length} nodes`;
    }
    out.push({ t: e.t_ns, kind: e.kind === "skew" && !e.skew_ns ? "reset" : e.kind, text });
  }
  return out;
}

// The cluster as the schedule leaves it at simulated time t.
function stateAt(events, t) {
  const n = {};
  for (const k of NODES) n[k] = { st: "up", inc: 0, skew: 0 };
  let part = null, passed = 0;
  for (const e of events) {
    if (e.t_ns > t) break;
    passed++;
    const s = e.node !== undefined ? (n[e.node] ||= { st: "up", inc: 0, skew: 0 }) : null;
    if (e.kind === "crash") s.st = "down";
    else if (e.kind === "pause") s.st = "paused";
    else if (e.kind === "restart") { s.st = "up"; s.inc = e.inc; }
    else if (e.kind === "resume") s.st = "up";
    else if (e.kind === "skew") s.skew = e.skew_ns;
    else if (e.kind === "partition") part = e.sides;
    else if (e.kind === "heal") part = null;
  }
  return { n, part, passed };
}

// Spans for the timeline lanes: {lane, kind, from, to}; lane 0 is the network.
function spans(events, end) {
  const out = [];
  const open = new Map();
  const close = (key, t) => {
    const s = open.get(key);
    if (s) out.push({ ...s, to: t });
    open.delete(key);
  };
  for (const e of events) {
    if (e.kind === "crash") open.set(e.node, { lane: e.node, kind: "down", from: e.t_ns });
    else if (e.kind === "pause") open.set(e.node, { lane: e.node, kind: "paused", from: e.t_ns });
    else if (e.kind === "restart" || e.kind === "resume") close(e.node, e.t_ns);
    else if (e.kind === "partition" || e.kind === "heal") {
      close(0, e.t_ns);
      if (e.kind === "partition") open.set(0, { lane: 0, kind: "cut", from: e.t_ns });
    }
  }
  for (const k of [...open.keys()]) close(k, end);
  return out;
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
  const seedIn = el("input");
  Object.assign(seedIn, { type: "range", name: "seed", min: 0, max: SEED_MAX, step: 1, value: START_SEED });
  const seedOut = el("output", "kl-out", String(START_SEED));
  const seedField = field("seed", seedIn, "kl-range");
  seedField.querySelector(".demo-label").append(" ", seedOut);
  const speed = el("select");
  speed.name = "speed";
  for (const s of SPEEDS) {
    const o = el("option", null, `${s}×`);
    o.value = String(s);
    o.selected = s === 5;
    speed.append(o);
  }
  const mine = el("input");
  Object.assign(mine, { type: "number", name: "mine", min: 0, max: MAX_SEED, step: 1, value: 1234, required: true });
  mine.inputMode = "numeric";
  const runMine = button("Run my seed");
  const knobs = el("div", "kl-knobs");
  knobs.append(seedField, field("speed", speed), field("your seed", mine, "kl-mine"), runMine);
  const play = button("Pause");
  const step = button("Next fault", "secondary");
  const replay = button("Replay", "secondary");
  const reset = button("Reset", "secondary");
  const more = button(`Check ${CHECK_N} more seeds`, "secondary");
  const acts = el("div", "kl-acts");
  acts.append(play, step, replay, reset, more);
  const form = el("form", "kl-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(acts, knobs);

  const canvas = el("canvas", "kl-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend kl-legend");
  for (const [k, t] of [["down", "crashed"], ["paused", "paused"], ["cut", "partitioned"], ["skew", "clock skew"], ["lin", "linearizable"], ["you", "your seed"]]) {
    const s = el("span", "kl-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const digests = el("div", "kl-replay");
  digests.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack kl-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["faults", "faults so far"], ["faulty", "faulty now"], ["part", "partition"], ["ok", "ok ops"], ["fail", "failed ops"],
    ["info", "indeterminate"], ["conf", "membership changes"], ["hist", "history"], ["seeds", "seeds checked"], ["lin", "linearizable"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "kl-v", "–");
    li.append(el("span", "kl-k", t), v);
    cell[k] = { li, v };
    cells.append(li);
  }
  const status = el("p", "kl-status");
  const receipt = el("p", "demo-out kl-receipt");
  root.replaceChildren(form, canvas, legend, digests, cells, status, receipt);

  // State.
  let cur = null;       // { r, lines, spans, heal, you, landed }
  let t = 0;            // playhead, simulated ns
  let ended = false, endedAt = 0;
  let playing = !reduce.matches;
  let visible = true;
  let raf = 0, last = 0, lastDom = 0;
  let strip = [];       // { seed, ok, lin, you, at }
  let sweep = START_SEED;
  let want = null, loading = false;
  let chain = Promise.resolve();
  const work = { runs: 0, steps: 0, trace: 0, sim: 0, ms: 0 };
  let pulses = [];
  let seen = 0;         // log lines already shown, for the slide-in
  let shownAt = [];
  const off = {};
  for (const k of NODES) off[k] = { x: 0, y: 0 };
  let colors = null, G = null, hits = [], scrub = false, stripHover = -1, moving = false;

  const exec = (seed) => {
    const run = chain.then(async () => {
      const t0 = performance.now();
      const r = await demo.call("run", { seed });
      const ms = performance.now() - t0;
      work.runs++; work.steps += r.steps; work.trace += r.trace_len; work.sim += r.sim_ns; work.ms += ms;
      return { r, ms };
    });
    chain = run.catch(() => {});
    return run;
  };

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"),
      text3: v("--text-3"), accent: v("--accent"), signal: v("--signal"), live: v("--live"), danger: v("--danger"), mono: v("--mono") || "monospace",
    };
  }
  const kindColor = (k) => ({ crash: colors.danger, down: colors.danger, pause: colors.text3, paused: colors.text3, partition: colors.signal,
    cut: colors.signal, skew: colors.text, reset: colors.text3, heal: colors.text2, restart: colors.text, resume: colors.text })[k] || colors.text2;

  // Geometry, in CSS pixels.
  function layout() {
    const W = Math.max(300, canvas.clientWidth);
    const wide = W >= 540;
    const R = wide ? 74 : 60, nr = wide ? 16 : 15;
    const ringTop = 10;
    const cx = wide ? R + nr + 82 : W / 2, cy = ringTop + R + nr + 22;
    const ringBot = cy + R + nr + 22;
    const logX = wide ? cx + R + nr + 58 : 14, logTop = wide ? ringTop + 14 : ringBot + 6;
    const logN = wide ? 8 : 5;
    const aBot = wide ? ringBot : logTop + 16 + logN * 17;
    const lx = 58, pr = 14, laneH = 18;
    const tlTop = aBot + 34, tlBot = tlTop + laneH * 6;
    const stTop = tlBot + 60, stH = 60;
    const H = stTop + stH + 22;
    G = { W, H, wide, R, nr, cx, cy, logX, logTop, logN, lx, pr, laneH, tlTop, tlBot, stTop, stH, plotW: W - lx - pr };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const tx = (ns) => G.lx + (ns / Math.max(1, cur.r.sim_ns)) * G.plotW;
  const laneY = (lane) => G.tlTop + (lane === 0 ? 5 : lane - 1) * G.laneH;
  const nodeXY = (k) => {
    const a = -Math.PI / 2 + ((k - 1) * 2 * Math.PI) / NODES.length;
    return { x: G.cx + Math.cos(a) * G.R + (off[k]?.x || 0), y: G.cy + Math.sin(a) * G.R + (off[k]?.y || 0), a };
  };

  // Partitioned nodes drift away from the other side, so the cut is visible in the ring itself.
  function targets(part) {
    const tg = {};
    for (const k of NODES) tg[k] = { x: 0, y: 0 };
    if (!part) return tg;
    const base = (k) => { const a = -Math.PI / 2 + ((k - 1) * 2 * Math.PI) / NODES.length; return [Math.cos(a) * G.R, Math.sin(a) * G.R]; };
    const mid = (ns) => ns.reduce((m, k) => [m[0] + base(k)[0] / ns.length, m[1] + base(k)[1] / ns.length], [0, 0]);
    const [a, b] = part.map(mid);
    let dx = a[0] - b[0], dy = a[1] - b[1];
    const d = Math.hypot(dx, dy) || 1;
    dx = (dx / d) * 13; dy = (dy / d) * 13;
    for (const k of part[0]) if (tg[k]) tg[k] = { x: dx, y: dy };
    for (const k of part[1]) if (tg[k]) tg[k] = { x: -dx, y: -dy };
    return tg;
  }

  function draw(now, dt) {
    if (!G || !cur || !colors) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors;
    const font = (px, w = 400) => `${w} ${px}px ${c.mono}`;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    const S = stateAt(cur.r.events, t);
    const tg = targets(S.part);
    const k = reduce.matches ? 1 : Math.min(1, (dt || 16) / 70);
    moving = false;
    for (const n of NODES) {
      off[n].x += (tg[n].x - off[n].x) * k; off[n].y += (tg[n].y - off[n].y) * k;
      if (Math.abs(tg[n].x - off[n].x) + Math.abs(tg[n].y - off[n].y) > 0.3) moving = true;
    }
    const side = (n) => (S.part ? (S.part[0].includes(n) ? 0 : 1) : 0);

    // Links: every pair talks unless the partition cuts it; a crashed node's links go quiet.
    ctx.lineWidth = 1;
    for (let i = 0; i < NODES.length; i++) for (let j = i + 1; j < NODES.length; j++) {
      const a = NODES[i], b = NODES[j], p = nodeXY(a), q = nodeXY(b);
      const dead = S.n[a].st !== "up" || S.n[b].st !== "up";
      if (S.part && side(a) !== side(b)) {
        ctx.strokeStyle = c.signal;
        ctx.globalAlpha = 0.85;
        ctx.setLineDash([3, 3]);
        const gx = (q.x - p.x) * 0.36, gy = (q.y - p.y) * 0.36;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + gx, p.y + gy);
        ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - gx, q.y - gy);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = c.strong;
        ctx.globalAlpha = dead ? 0.3 : 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Pulses: each fault ripples out from where it hit, for 300 ms.
    pulses = pulses.filter((p) => now - p.t0 < PULSE_MS);
    for (const p of pulses) {
      const f = ease((now - p.t0) / PULSE_MS);
      const at = p.node ? nodeXY(p.node) : { x: G.cx, y: G.cy };
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - f;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(at.x, at.y, (p.node ? G.nr : 10) + f * (p.node ? 18 : G.R), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Nodes.
    for (const n of NODES) {
      const p = nodeXY(n), s = S.n[n];
      ctx.beginPath(); ctx.arc(p.x, p.y, G.nr, 0, Math.PI * 2);
      ctx.fillStyle = s.st === "down" ? c.bg : c.surface;
      ctx.fill();
      ctx.lineWidth = s.st === "up" ? 1.5 : 2;
      ctx.strokeStyle = s.st === "down" ? c.danger : s.st === "paused" ? c.text3 : c.text;
      if (s.st === "paused") ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (s.st === "down") {
        ctx.strokeStyle = c.danger;
        ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6); ctx.stroke();
      } else {
        ctx.fillStyle = s.st === "paused" ? c.text3 : c.text;
        ctx.font = font(12, 600);
        ctx.fillText(String(n), p.x, p.y + 0.5);
      }
      // Labels sit outside the ring, along the node's spoke.
      const lines = [];
      if (s.st === "down") lines.push([`n${n} crashed`, c.danger]);
      else if (s.st === "paused") lines.push([`n${n} paused`, c.text2]);
      else lines.push([s.inc ? `n${n} · inc ${s.inc}` : `n${n}`, c.text3]);
      if (s.skew) lines.push([`${G.wide ? "clock " : ""}${s.skew > 0 ? "+" : "−"}${fmt(Math.round(Math.abs(s.skew) / 1e6))} ms`, c.text]);
      const ox = Math.cos(p.a), oy = Math.sin(p.a);
      let lx = p.x + ox * (G.nr + 8), ly = p.y + oy * (G.nr + 10), dy = oy;
      ctx.textAlign = Math.abs(ox) < 0.3 ? "center" : ox > 0 ? "left" : "right";
      ctx.textBaseline = "middle";
      ctx.font = font(10);
      const lw = Math.max(...lines.map(([txt]) => ctx.measureText(txt).width));
      // Too narrow for a label beside the node: it goes above it instead.
      if ((ctx.textAlign === "right" && lx - lw < 4) || (ctx.textAlign === "left" && lx + lw > G.W - 4)) {
        ctx.textAlign = "center";
        lx = Math.min(G.W - lw / 2 - 4, Math.max(lw / 2 + 4, p.x));
        ly = p.y - G.nr - 6;
        dy = -1;
      }
      const y0 = dy < -0.5 ? ly - (lines.length - 1) * 12 - 2 : dy > 0.5 ? ly + 4 : ly - ((lines.length - 1) * 12) / 2;
      lines.forEach(([txt, col], i) => { ctx.fillStyle = col; ctx.fillText(txt, lx, y0 + i * 12); });
    }

    // Centre: which seed, where the clock is, and the verdict once the run is over.
    ctx.fillStyle = c.bg;
    ctx.beginPath(); ctx.arc(G.cx, G.cy, G.wide ? 40 : 34, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = cur.you ? c.accent : c.text;
    ctx.font = font(11, 600);
    const sd = String(cur.r.seed);
    ctx.fillText(`${cur.you ? "you" : "seed"} ${sd.length > 7 ? `${sd.slice(0, 6)}…` : sd}`, G.cx, G.cy - 12);
    ctx.fillStyle = c.text2;
    ctx.font = font(11);
    ctx.fillText(secs(t), G.cx, G.cy + 3);
    if (ended) {
      const f = reduce.matches ? 1 : ease((now - endedAt) / SLIDE_MS);
      ctx.globalAlpha = f;
      ctx.fillStyle = cur.r.linearizable ? c.live : c.danger;
      ctx.font = font(10, 600);
      ctx.fillText(cur.r.linearizable ? "linearizable" : "not linearizable", G.cx, G.cy + 18 + (1 - f) * 6);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = c.text3;
      ctx.font = font(10);
      ctx.fillText(cur.heal && t >= cur.heal ? "healed" : "nemesis on", G.cx, G.cy + 18);
    }

    // The nemesis log: newest first, each line sliding in as the clock passes it.
    const shown = cur.lines.filter((l) => l.t <= t);
    if (shown.length > seen) for (let i = seen; i < shown.length; i++) shownAt[i] = reduce.matches ? 0 : now;
    seen = shown.length;
    ctx.textAlign = "left";
    ctx.font = font(10);
    ctx.fillStyle = c.text3;
    ctx.fillText(G.wide ? "nemesis log, newest first" : "nemesis log", G.logX, G.logTop);
    const rows = shown.slice(-G.logN).reverse();
    const slide = rows.length && shownAt[shown.length - 1] ? ease((now - shownAt[shown.length - 1]) / SLIDE_MS) : 1;
    rows.forEach((l, i) => {
      const y = G.logTop + 18 + (i - (1 - slide)) * 17;
      const fresh = i === 0 && slide < 1;
      ctx.globalAlpha = fresh ? slide : Math.max(0.35, 1 - i * 0.11);
      ctx.fillStyle = c.text3;
      ctx.textAlign = "right";
      ctx.fillText(secs(l.t), G.logX + 52, y);
      ctx.fillStyle = kindColor(l.kind);
      ctx.fillRect(G.logX + 60, y - 7, 7, 7);
      ctx.textAlign = "left";
      ctx.fillStyle = i === 0 ? c.text : c.text2;
      ctx.fillText(l.text, G.logX + 73, y);
    });
    ctx.globalAlpha = 1;
    if (!rows.length) { ctx.fillStyle = c.text3; ctx.fillText("no faults yet", G.logX, G.logTop + 18); }

    drawTimeline(ctx, font, S);
    drawStrip(ctx, font, now);
  }

  function drawTimeline(ctx, font, S) {
    const c = colors, end = cur.r.sim_ns, top = G.tlTop, bot = G.tlBot, ph = tx(t);
    ctx.textBaseline = "alphabetic";
    // Phase strip: the nemesis runs until its last heal, then the cluster has to recover.
    if (cur.heal) {
      const hx = tx(cur.heal);
      ctx.fillStyle = c.signal;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(G.lx, top - 16, hx - G.lx, 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text3;
      ctx.font = font(10);
      ctx.textAlign = "left";
      ctx.fillText("nemesis on", G.lx, top - 20);
      const hl = G.plotW < 400 ? `healed ${secs(cur.heal)}` : `healed ${secs(cur.heal)}, recovery`;
      ctx.fillText(hl, Math.min(hx + 6, G.W - G.pr - ctx.measureText(hl).width), top - 20);
      ctx.strokeStyle = c.text3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(hx) + 0.5, top - 16); ctx.lineTo(Math.round(hx) + 0.5, bot); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = font(10);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const lane of [...NODES, 0]) {
      const y = laneY(lane) + G.laneH / 2;
      const s = lane ? S.n[lane]?.st : S.part ? "cut" : "up";
      ctx.fillStyle = s === "down" ? c.danger : s === "cut" ? c.signal : c.text2;
      ctx.fillText(lane ? `node ${lane}` : "network", 4, y);
      ctx.strokeStyle = c.line;
      ctx.beginPath(); ctx.moveTo(G.lx, Math.round(y) + 0.5); ctx.lineTo(G.W - G.pr, Math.round(y) + 0.5); ctx.stroke();
    }
    // Past spans solid, the schedule still to come faint.
    const bars = (alpha) => {
      for (const s of cur.spans) {
        ctx.fillStyle = kindColor(s.kind);
        ctx.globalAlpha = alpha * (s.kind === "cut" ? 0.55 : 1);
        ctx.fillRect(tx(s.from), laneY(s.lane) + 4, Math.max(3, tx(s.to) - tx(s.from)), G.laneH - 8);
      }
      for (const e of cur.r.events) {
        if ((e.kind === "skew" && e.skew_ns) || e.kind === "partition") {
          ctx.fillStyle = e.kind === "skew" ? c.text : c.signal;
          ctx.globalAlpha = alpha;
          ctx.fillRect(tx(e.t_ns) - 1.5, laneY(e.kind === "skew" ? e.node : 0) + 1, 3, G.laneH - 2);
        }
      }
      ctx.globalAlpha = 1;
    };
    bars(0.38);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, top - 2, ph, bot - top + 4); ctx.clip();
    bars(1);
    ctx.restore();
    // Axis every 5 s.
    ctx.strokeStyle = c.text3;
    ctx.beginPath(); ctx.moveTo(G.lx, bot + 0.5); ctx.lineTo(G.W - G.pr, bot + 0.5); ctx.stroke();
    ctx.fillStyle = c.text3;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    const every = G.plotW < 360 ? 10e9 : 5e9;
    for (let s = 0; s <= end; s += every) ctx.fillText(`${s / 1e9}s`, Math.min(G.W - G.pr - 8, tx(s)), bot + 13);
    // Playhead.
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ph, top - 4); ctx.lineTo(ph, bot); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = c.text;
    ctx.beginPath(); ctx.moveTo(ph - 4, top - 9); ctx.lineTo(ph + 4, top - 9); ctx.lineTo(ph, top - 3); ctx.closePath(); ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = c.text3;
    ctx.fillText("simulated time, drag to scrub", G.W - G.pr, bot + 27);
  }

  function drawStrip(ctx, font, now) {
    const c = colors, top = G.stTop, h = G.stH, base = top + h;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = c.text3;
    ctx.font = font(10);
    ctx.fillText(G.wide ? "seeds checked, ok ops per seed · tap a bar to replay it" : "seeds checked, ok ops per seed", 4, top - 12);
    const gap = 3, avail = G.W - 4 - G.pr + gap;
    const bw = Math.max(6, Math.min(18, Math.floor(avail / Math.max(1, strip.length)) - gap));
    const fit = Math.max(1, Math.floor(avail / (bw + gap)));
    const ci = strip.findIndex((s) => s.seed === cur.r.seed);
    const from = strip.length > fit ? Math.max(0, Math.min(strip.length - fit, (ci < 0 ? strip.length : ci) - (fit >> 1))) : 0;
    const show = strip.slice(from, from + fit);
    const max = Math.max(1, ...show.map((s) => s.ok));
    ctx.strokeStyle = c.line;
    ctx.beginPath(); ctx.moveTo(4, base + 0.5); ctx.lineTo(G.W - G.pr, base + 0.5); ctx.stroke();
    hits = [];
    show.forEach((s, i) => {
      const x = 4 + i * (bw + gap);
      const g = s.at && !reduce.matches ? ease((now - s.at) / SLIDE_MS) : 1;
      const bh = Math.max(3, (s.ok / max) * (h - 6)) * g;
      ctx.fillStyle = s.you ? c.accent : c.text3;
      ctx.globalAlpha = s.you ? 0.9 : 0.5;
      ctx.fillRect(x, base - bh, bw, bh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.lin ? c.live : c.danger;
      ctx.fillRect(x, base - bh - 3, bw, 3);
      const now_ = s.seed === cur.r.seed;
      if (now_) {
        ctx.strokeStyle = c.text;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 2, base - bh - 5, bw + 4, bh + 7);
        ctx.lineWidth = 1;
      }
      if (i === stripHover || (now_ && stripHover < 0)) {
        ctx.fillStyle = s.you ? c.accent : c.text;
        ctx.textAlign = x > G.W - 140 ? "right" : x < 60 ? "left" : "center";
        ctx.fillText(`${s.you ? "your " : ""}seed ${s.seed}: ${fmt(s.ok)} ok`, ctx.textAlign === "right" ? x + bw : ctx.textAlign === "left" ? x : x + bw / 2, base + 15);
      }
      hits.push({ x0: x - gap / 2, x1: x + bw + gap / 2, s });
    });
    if (!show.length) { ctx.fillStyle = c.text3; ctx.fillText("checking seeds…", 4, base - 8); }
  }

  // Simulated time moves; faults the playhead passes ripple out of their node.
  function advanceTo(nt, now) {
    const prev = t;
    t = Math.max(0, Math.min(cur.r.sim_ns, nt));
    if (t < prev) { seen = 0; shownAt = []; }
    if (!reduce.matches && t > prev) {
      for (const e of cur.r.events) {
        if (e.t_ns <= prev || e.t_ns > t) continue;
        if (e.kind === "skew" && !e.skew_ns) continue;
        if (e.kind === "partition") for (const n of e.sides[1]) pulses.push({ node: n, color: colors.signal, t0: now });
        else if (e.kind === "heal") pulses.push({ node: 0, color: colors.text3, t0: now });
        else pulses.push({ node: e.node, color: kindColor(e.kind), t0: now });
      }
    }
    if (t >= cur.r.sim_ns && !ended) { ended = true; endedAt = now; land(now); }
    else if (t < cur.r.sim_ns) ended = false;
  }

  function land(now) {
    if (cur.landed) return;
    cur.landed = true;
    addBar(cur.r, cur.you, now);
    updateDom(true);
  }

  // The strip is a seed axis: one bar per seed checked, in seed order.
  function addBar(r, you, now) {
    const old = strip.find((s) => s.seed === r.seed);
    if (old) { old.you ||= you; old.at = now; return; }
    strip.push({ seed: r.seed, ok: r.ok, lin: r.linearizable, you, at: now });
    strip.sort((a, b) => a.seed - b.seed);
    if (strip.length > STRIP_MAX) strip.splice(strip.findIndex((s) => !s.you && s.seed !== cur?.r.seed), 1);
  }

  // Checks the next seeds nobody has run yet: each call is a whole run, and its bar lands as it returns.
  // A newer check (or Reset) supersedes one still running.
  let checkGen = 0;
  async function check(n) {
    const g = ++checkGen;
    more.disabled = true;
    try {
      let s = 0;
      for (let i = 0; i < n; i++) {
        while (strip.some((x) => x.seed === s)) s++;
        const { r } = await exec(s);
        if (g !== checkGen) return;
        addBar(r, false, performance.now());
        updateDom(true);
        kick();
      }
    } finally {
      if (g === checkGen) more.disabled = false;
    }
  }

  function digestRow(label, r, ms, match) {
    const row = el("div", "kl-row");
    row.append(el("span", "kl-which", label), el("code", "kl-digest", r.digest), el("span", "kl-ms", `${fmt(Math.round(ms))} ms`));
    if (match !== undefined) row.append(el("span", match ? "kl-match" : "kl-differ", match ? "identical, bit for bit" : "differs"));
    return row;
  }

  function setCur(a, b, w) {
    const r = a.r;
    const heal = r.events.filter((e) => e.kind === "heal").at(-1);
    cur = { r, ms: a.ms, you: !!w.you, lines: logLines(r.events), spans: spans(r.events, r.sim_ns), heal: heal ? heal.t_ns : 0, landed: false };
    ended = false;
    seen = 0; shownAt = []; pulses = [];
    if (!w.you) { sweep = r.seed; if (r.seed <= SEED_MAX) { seedIn.value = String(r.seed); seedOut.textContent = String(r.seed); } }
    const label = `${w.you ? "your seed" : "seed"} ${fmt(r.seed)}`;
    const rows = [digestRow(label, r, a.ms)];
    if (b) rows.push(digestRow(w.replay ? "replay" : "run again", b.r, b.ms, b.r.digest === r.digest));
    digests.replaceChildren(...rows);
    status.textContent = `${w.you ? "Your seed" : "Seed"} ${fmt(r.seed)}: the nemesis injected ${fmt(r.fault_events)} faults into five Raft servers; ` +
      `${fmt(r.steps)} scheduler steps, ${fmt(r.trace_len)} traced events.`;
    advanceTo(w.keep ? t : reduce.matches && !w.keep ? r.sim_ns : 0, performance.now());
    updateDom(true);
  }

  // Loads run one at a time; a newer request supersedes one still waiting.
  function request(w) {
    want = w;
    if (!loading) pump().catch(fail);
  }
  async function pump() {
    loading = true;
    try {
      while (want) {
        const w = want;
        want = null;
        const prev = cur;
        const a = await exec(w.seed);
        const b = w.twice ? await exec(w.seed) : null;
        if (want) continue;
        if (w.replay && prev) setCur({ r: prev.r, ms: prev.ms }, a, w);
        else setCur(a, b, w);
        kick();
      }
    } finally {
      loading = false;
    }
  }

  function updateDom(force) {
    const now = performance.now();
    if (!force && now - lastDom < 120) return;
    lastDom = now;
    if (!cur) return;
    const r = cur.r, S = stateAt(r.events, t);
    const put = (k, v) => { cell[k].v.textContent = v; };
    put("t", secs(t));
    put("faults", `${fmt(S.passed)} / ${fmt(r.fault_events)}`);
    const faulty = NODES.filter((n) => S.n[n].st !== "up");
    put("faulty", faulty.length ? faulty.map((n) => `n${n} ${S.n[n].st === "down" ? "crashed" : "paused"}`).join(", ") : "none");
    put("part", S.part ? `${set(S.part[0])} | ${set(S.part[1])}` : "none");
    put("ok", fmt(r.ok));
    put("fail", fmt(r.fail));
    put("info", fmt(r.info));
    put("conf", fmt(r.conf_changes));
    put("hist", r.linearizable ? "linearizable" : "not linearizable");
    cell.hist.li.classList.toggle("kl-pass", r.linearizable);
    cell.hist.li.classList.toggle("kl-fail", !r.linearizable);
    put("seeds", fmt(strip.length));
    const lin = strip.filter((s) => s.lin).length;
    put("lin", strip.length ? `${fmt(lin)} / ${fmt(strip.length)}` : "–");
    cell.lin.li.classList.toggle("kl-pass", strip.length > 0 && lin === strip.length);
    cell.lin.li.classList.toggle("kl-fail", lin < strip.length);
    receipt.textContent = `${fmt(work.runs)} ${work.runs === 1 ? "run" : "runs"} of keel's simulator: ${fmt(work.steps)} scheduler steps and ` +
      `${fmt(work.trace)} traced events over ${secs(work.sim, 1)} of simulated time, in ${fmt(Math.round(work.ms))} ms of calls, in your browser.`;
    canvas.setAttribute("aria-label", `${cur.you ? "Your seed" : "Seed"} ${r.seed} at ${secs(t)} of ${secs(r.sim_ns)} simulated: ` +
      `${faulty.length ? faulty.map((n) => `node ${n} ${S.n[n].st === "down" ? "crashed" : "paused"}`).join(", ") : "all five servers up"}, ` +
      `${S.part ? `partition ${set(S.part[0])} | ${set(S.part[1])}` : "network whole"}; ${S.passed} of ${r.fault_events} fault events so far. ` +
      `${strip.length} seeds checked, ${lin} linearizable.`);
  }

  const fail = (err) => { status.textContent = err.message; };

  function nextSeed() { return sweep >= SEED_MAX ? 0 : sweep + 1; }

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && cur && !scrub) {
      if (!ended) advanceTo(t + dt * 1e6 * Number(speed.value), ts);
      else if (ts - endedAt > HOLD_MS && !loading) request({ seed: nextSeed() });
    }
    draw(ts, dt);
    updateDom(false);
    const anim = pulses.length || (ended && ts - endedAt < SLIDE_MS) || strip.some((s) => s.at && ts - s.at < SLIDE_MS) ||
      shownAt.some((a) => a && ts - a < SLIDE_MS) || moving;
    if ((playing || anim || loading) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  const redraw = () => { draw(performance.now(), 1000); updateDom(true); kick(); };

  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v && ended) endedAt = performance.now() - HOLD_MS;
    kick();
  }

  // Inputs.
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    if (!cur) return;
    const nx = cur.r.events.find((e) => e.t_ns > t);
    advanceTo(nx ? nx.t_ns : cur.r.sim_ns, performance.now());
    redraw();
  });
  replay.addEventListener("click", () => { if (cur) request({ seed: cur.r.seed, you: cur.you, replay: true }); });
  reset.addEventListener("click", () => {
    strip = [];
    Object.assign(work, { runs: 0, steps: 0, trace: 0, sim: 0, ms: 0 });
    request({ seed: START_SEED, twice: true });
    check(CHECK_N).catch(fail);
  });
  more.addEventListener("click", () => check(CHECK_N).catch(fail));
  seedIn.addEventListener("input", () => {
    seedOut.textContent = seedIn.value;
    request({ seed: Number(seedIn.value), keep: true });
  });
  speed.addEventListener("change", kick);
  const runMy = () => {
    const s = Number(mine.value);
    if (!Number.isSafeInteger(s) || s < 0) {
      status.textContent = `Your seed must be a whole number from 0 to ${fmt(MAX_SEED)}.`;
      return;
    }
    request({ seed: s, you: true, twice: true });
  };
  runMine.addEventListener("click", runMy);
  mine.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runMy(); } });

  const local = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const onTimeline = (p) => G && cur && p.y >= G.tlTop - 22 && p.y <= G.tlBot + 16 && p.x >= G.lx - 6;
  const scrubTo = (p) => { advanceTo(((p.x - G.lx) / G.plotW) * cur.r.sim_ns, performance.now()); redraw(); };
  const stripHit = (p) => (G && p.y >= G.stTop - 4 && p.y <= G.stTop + G.stH + 18 ? hits.findIndex((h) => p.x >= h.x0 && p.x < h.x1) : -1);
  canvas.addEventListener("pointerdown", (e) => {
    const p = local(e);
    if (onTimeline(p)) {
      scrub = true;
      setPlaying(false);
      canvas.setPointerCapture(e.pointerId);
      scrubTo(p);
      return;
    }
    const i = stripHit(p);
    if (i >= 0) { const s = hits[i].s; request({ seed: s.seed, you: s.you }); }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (scrub) { scrubTo(p); return; }
    const i = stripHit(p);
    canvas.classList.toggle("kl-aim", onTimeline(p) || i >= 0);
    if (i !== stripHover) { stripHover = i; if (!raf) draw(performance.now(), 16); }
  });
  const endScrub = () => { scrub = false; };
  canvas.addEventListener("pointerup", endScrub);
  canvas.addEventListener("pointercancel", endScrub);
  canvas.addEventListener("pointerleave", () => { if (stripHover >= 0) { stripHover = -1; if (!raf) draw(performance.now(), 16); } });

  new ResizeObserver(() => { if (!root.isConnected) return; layout(); readColors(); draw(performance.now(), 1000); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const recolor = () => { readColors(); draw(performance.now(), 1000); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
  window.addEventListener("themechange", recolor);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  readColors();
  layout();
  setPlaying(playing);
  want = { seed: START_SEED, twice: true };
  await pump();
  draw(performance.now(), 1000);
  check(CHECK_N).catch(fail);
  kick();
}
