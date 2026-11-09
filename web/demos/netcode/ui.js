// netcode demo: netcode's real authoritative server and rollback clients,
// compiled from Rust to WebAssembly. A six-player match runs on simulated
// 60 Hz ticks and every datagram goes through netcode's codec and lag
// simulator. Player 0 is you (an autopilot until you steer); the server and
// bot 1's client show your input arriving late, and each client's rollbacks
// are drawn on its tick line and on the timeline.
const TICK_MS = 1000 / 60;
const PLAYERS = 6;
const SEED = 1;
const WARM = 180;
const WINDOW = 600;
const BIN = 6;
const FX_MS = 280;
const TRAIL = 40;
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, DASH = 16;
const KEYS = {
  ArrowUp: UP, KeyW: UP, ArrowDown: DOWN, KeyS: DOWN,
  ArrowLeft: LEFT, KeyA: LEFT, ArrowRight: RIGHT, KeyD: RIGHT, Space: DASH,
};
const PRESETS = [
  ["lan", "LAN, 0 ms", 0, 0, 0],
  ["city", "same city, 10 ms", 10, 2, 0],
  ["country", "cross-country, 40 ms", 40, 8, 1],
  ["soak", "the soak's link, 100 ms", 100, 20, 2],
  ["wifi", "bad wi-fi, 60 ms", 60, 50, 8],
  ["mobile", "mobile, 180 ms", 180, 60, 4],
];
const SLIDERS = [["latency_ms", "latency", 0, 300, 5, "ms"], ["jitter_ms", "jitter", 0, 100, 5, "ms"], ["loss_pct", "loss", 0, 20, 1, "%"]];
const SPEEDS = [[0.25, "¼×"], [0.5, "½×"], [1, "1×"], [2, "2×"]];
const AUTO = [[RIGHT, 54], [DOWN, 36], [LEFT, 54], [UP, 36]];
const PAD = [[LEFT, "←", "left"], [UP, "↑", "up"], [DOWN, "↓", "down"], [RIGHT, "→", "right"], [DASH, "Dash", "dash"]];
let generation = 0;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };

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

// The autopilot's buttons for a predicted tick: a loop right, down, left, up, dashing on the long legs.
function auto(tick) {
  let p = tick % 180;
  for (const [b, n] of AUTO) {
    if (p < n) return b | (p < 2 && (b === RIGHT || b === LEFT) ? DASH : 0);
    p -= n;
  }
  return 0;
}

export async function mount(root, demo) {
  const gen = ++generation;
  const href = new URL("./ui.css", import.meta.url).href;
  let cssReady = Promise.resolve();
  if (![...document.querySelectorAll("link[rel=stylesheet]")].some((l) => l.href === href)) {
    const css = el("link");
    css.rel = "stylesheet";
    css.href = href;
    cssReady = new Promise((r) => { css.onload = r; css.onerror = r; });
    document.head.append(css);
  }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  // Controls.
  const play = button("Pause", "nc-play");
  const step = button("Step 1 tick", "secondary nc-step");
  const reset = button("Reset", "secondary nc-reset");
  const speed = select("speed", SPEEDS, 1);
  const acts = el("div", "nc-acts");
  acts.append(play, step, reset, field("speed", speed));
  const preset = select("network", [...PRESETS.map(([k, t]) => [k, t]), ["custom", "custom"]], "soak");
  const net = el("div", "nc-net");
  net.append(field("network", preset, "nc-preset"));
  const lagIn = {};
  const lagOut = {};
  for (const [key, name, min, max, by, unit] of SLIDERS) {
    const input = el("input");
    Object.assign(input, { type: "range", name: key, min, max, step: by });
    const f = field(name, input, "nc-range");
    const out = el("span", "nc-num");
    f.firstChild.append(" ", out);
    input.addEventListener("input", () => { out.textContent = `${input.value} ${unit}`; });
    net.append(f);
    lagIn[key] = input;
    lagOut[key] = () => { out.textContent = `${input.value} ${unit}`; };
  }
  const form = el("form", "nc-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(acts, net);

  const canvas = el("canvas", "nc-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Arena: your client, the server and bot 1's client. Arrow keys or WASD steer player 0, Space dashes.");

  const pad = el("div", "nc-pad");
  const keys = el("div", "nc-keys");
  const padBtn = new Map();
  for (const [bit, glyph, name] of PAD) {
    const b = button(glyph, "secondary");
    b.setAttribute("aria-label", name === "dash" ? "Dash" : `Steer ${name}`);
    b.dataset.bit = String(bit);
    keys.append(b);
    padBtn.set(bit, b);
  }
  const hint = el("p", "nc-hint");
  pad.append(keys, hint);
  form.append(pad);

  const legend = el("p", "demo-legend nc-legend");
  for (const [k, t] of [["you", "you, player 0"], ["other", "other players"], ["ghost", "server now"], ["roll", "rollback"], ["up", "input"], ["down", "snapshot"], ["lost", "lost"]]) {
    const s = el("span", "nc-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const echo = el("p", "nc-echo", "Waiting for player 0's first input to reach bot 1.");

  const cells = el("ul", "cells stack nc-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["tick", "server tick"], ["rtt", "rtt"], ["rollbacks", "rollbacks"], ["resim", "frames resimulated"],
    ["depth", "max rollback depth"], ["checks", "hash checks"], ["desyncs", "desyncs"], ["late", "late inputs"], ["lost", "packets lost"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "nc-v", "–");
    li.append(el("span", "nc-k", t), v);
    cell[k] = v;
    cells.append(li);
  }
  const lamp = el("p", "nc-lamp");
  lamp.dataset.state = "wait";
  const lampText = el("span", "nc-lamp-text", "Waiting for the first confirmed tick");
  const lampHash = el("code", "nc-lamp-hash");
  lamp.append(el("span", "nc-dot"), lampText, lampHash);
  const status = el("p", "nc-status");
  status.setAttribute("aria-live", "polite");
  const receipt = el("p", "demo-out nc-out");
  receipt.setAttribute("aria-live", "polite");
  root.replaceChildren(form, canvas, legend, echo, cells, lamp, status, receipt);

  // State.
  let run = 0;
  let view = null;
  let hist = [];
  let marks = [];
  let fx = [];
  let echoes = [];
  let trails = { you: [], server: [], bot: [] };
  let pilot = true;
  let held = 0;
  let pulse = 0;
  let lastB = -1;
  let playing = !reduce.matches;
  let visible = true;
  let busy = false;
  let acc = 0;
  let last = 0;
  let raf = 0;
  let lastDom = 0;
  let callMs = 0;
  let col = null;
  let G = null;
  let chain = Promise.resolve();

  const call = (method, params) => {
    const p = chain.then(async () => {
      const t0 = performance.now();
      try {
        return await demo.call(method, params);
      } finally {
        callMs += performance.now() - t0;
      }
    });
    chain = p.catch(() => {});
    return p;
  };

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    col = {
      sunken: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"),
      text2: v("--text-2"), text3: v("--text-3"), accent: v("--accent"), tint: v("--accent-tint"), signal: v("--signal"),
      live: v("--live"), danger: v("--danger"), mono: v("--mono") || "monospace",
    };
  }

  // Geometry in CSS pixels: the wire strip, your client big, the server and bot 1's client beside or below it, the timeline.
  function layout() {
    const W = Math.max(280, Math.floor(canvas.clientWidth || root.clientWidth || 360));
    const STRIP = 62, HEAD = 18, FOOT = 36, HF = HEAD + FOOT;
    const wide = W >= 520;
    const gap = wide ? 20 : 12;
    let s1, s2, x0, used, you, server, bot, bottom;
    if (wide) {
      s1 = Math.min(560, Math.floor((W - gap / 2 + HF / 2) / 1.5));
      s2 = Math.floor((s1 - HF - gap) / 2);
      used = s1 + gap + s2;
      x0 = Math.floor((W - used) / 2);
      you = { x: x0, y: STRIP + HEAD, s: s1 };
      server = { x: x0 + s1 + gap, y: STRIP + HEAD, s: s2 };
      bot = { x: x0 + s1 + gap, y: STRIP + HEAD + s2 + FOOT + gap + HEAD, s: s2 };
      bottom = STRIP + HEAD + s1 + FOOT;
    } else {
      s1 = W;
      s2 = Math.floor((W - gap) / 2);
      used = W;
      x0 = 0;
      you = { x: 0, y: STRIP + HEAD, s: W };
      const y2 = STRIP + HEAD + W + FOOT + gap + HEAD;
      server = { x: 0, y: y2, s: s2 };
      bot = { x: W - s2, y: y2, s: s2 };
      bottom = y2 + s2 + FOOT;
    }
    const tl = { x: x0, y: bottom + 16, w: used, h: 112 };
    const H = tl.y + tl.h;
    G = { W, H, x0, used, wide, you, server, bot, tl };
    canvas.style.height = `${H}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }

  // Applies one bridge answer: effects, trails, the timeline and the echoes of your inputs.
  function apply(v, animate) {
    const prev = view;
    view = v;
    const now = performance.now();
    const [c0, c1] = v.clients;
    const ds = [0, 0];
    v.clients.forEach((c, i) => {
      const p = prev && prev.clients[i];
      if (!p) return;
      const pane = i === 0 ? "you" : "bot";
      ds[i] = Math.max(0, c.resimulated - p.resimulated);
      if (c.rollbacks > p.rollbacks && animate && c.last_rollback) {
        const lr = c.last_rollback;
        fx.push({ kind: "roll", pane, t0: now, depth: lr.depth, head: c.tick, from: lr.from, to: lr.to });
      }
      if (animate) {
        for (let k = 0; k < Math.min(3, c.up.lost - p.up.lost); k++) fx.push({ kind: "lost", wire: i, dir: "up", k, t0: now });
        for (let k = 0; k < Math.min(3, c.down.lost - p.down.lost); k++) fx.push({ kind: "lost", wire: i, dir: "down", k, t0: now });
      }
    });
    if (!prev || v.tick !== prev.tick) {
      hist.push({ tick: v.tick, s0: ds[0], s1: ds[1] });
      while (hist.length && hist[0].tick < v.tick - WINDOW) hist.shift();
      while (marks.length > 1 && marks[1].tick < v.tick - WINDOW) marks.shift();
      const me = v.players.find((p) => p[0] === 0);
      const seen = c1 && c1.others.find((p) => p[0] === 0);
      trail("you", c0 && c0.me);
      trail("server", me && [me[1], me[2]]);
      trail("bot", seen && [seen[1], seen[2]]);
    }
    for (const e of echoes) {
      if (e.at == null && c0.tick >= e.T) { e.at = v.t_ms; if (animate) fx.push({ kind: "ring", pane: "you", t0: now }); }
      if (e.sv == null && v.tick >= e.T) { e.sv = v.t_ms; if (animate) fx.push({ kind: "ring", pane: "server", t0: now }); }
      if (e.bt == null && c1 && c1.render_tick >= e.T) {
        e.bt = v.t_ms;
        if (animate) fx.push({ kind: "ring", pane: "bot", t0: now });
        const at = e.at ?? e.bt;
        put(echo, `${e.pilot ? "Player 0's" : "Your"} input for tick ${fmt(e.T)}: on your screen at once, run by the server ${fmt(Math.max(0, (e.sv ?? e.bt) - at))} ms later, on bot 1's screen ${fmt(Math.max(0, e.bt - at))} ms later (simulated time).`);
      }
    }
    echoes = echoes.filter((e) => e.bt == null);
  }

  function trail(k, xy) {
    const t = trails[k];
    if (!xy) return;
    t.push(xy);
    if (t.length > TRAIL) t.shift();
  }

  // Drawing.
  const font = (px, w = 400) => `${w} ${px}px ${col.mono}`;

  function disc(ctx, x, y, r, fill, stroke, lw, dash) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.setLineDash(dash || []);
      ctx.lineWidth = lw || 1;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function fit(ctx, texts, max) {
    for (const t of texts) if (ctx.measureText(t).width <= max) return t;
    return texts[texts.length - 1];
  }

  function paint(now) {
    if (!G || !col) return;
    const ctx = canvas.getContext("2d");
    const dpr = canvas.width / G.W;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, G.W, G.H);
    if (!view) return;
    fx = fx.filter((f) => now - f.t0 < (f.kind === "lost" ? 600 : FX_MS));
    drawStrip(ctx, now);
    drawPane(ctx, "you", G.you, now);
    drawPane(ctx, "server", G.server, now);
    drawPane(ctx, "bot", G.bot, now);
    drawTimeline(ctx);
  }

  function drawStrip(ctx, now) {
    const v = view;
    const x0 = G.x0, W = G.used;
    const nw = Math.max(70, Math.min(120, Math.round(W * 0.2))), nh = 30, ny = 4;
    const nodes = [[x0, "you"], [x0 + (W - nw) / 2, "server"], [x0 + W - nw, "bot 1"]];
    ctx.lineWidth = 1;
    for (const [x, name] of nodes) {
      ctx.fillStyle = col.surface;
      ctx.fillRect(x, ny, nw, nh);
      ctx.strokeStyle = name === "you" ? col.accent : col.strong;
      ctx.lineWidth = name === "you" ? 1.5 : 1;
      ctx.strokeRect(x + 0.5, ny + 0.5, nw - 1, nh - 1);
      ctx.fillStyle = name === "you" ? col.accent : col.text;
      ctx.font = font(11, 600);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name, x + nw / 2, ny + nh / 2 + 0.5);
    }
    const sL = x0 + (W - nw) / 2, sR = sL + nw;
    const wires = [[x0 + nw, sL], [x0 + W - nw, sR]];
    const yUp = ny + 10, yDn = ny + nh - 10;
    wires.forEach(([cx, sx], i) => {
      const c = v.clients[i];
      if (!c) return;
      const at = (p, from, to) => from + (to - from) * Math.min(1, Math.max(0, p));
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yUp + 0.5); ctx.lineTo(sx, yUp + 0.5);
      ctx.moveTo(cx, yDn + 0.5); ctx.lineTo(sx, yDn + 0.5);
      ctx.stroke();
      arrow(ctx, sx, yUp + 0.5, Math.sign(sx - cx));
      arrow(ctx, cx, yDn + 0.5, Math.sign(cx - sx));
      for (const [kind, p] of c.up_flying) {
        const x = at(p / 1000, cx, sx);
        if (kind === "i") { ctx.fillStyle = i === 0 ? col.accent : col.text2; ctx.fillRect(x - 3, yUp - 3, 6, 6); }
        else disc(ctx, x, yUp + 0.5, 1.5, col.text3);
      }
      for (const [kind, p] of c.down_flying) {
        const x = at(p / 1000, sx, cx);
        if (kind === "s") disc(ctx, x, yDn + 0.5, 3, col.text);
        else if (kind === "d") disc(ctx, x, yDn + 0.5, 2.5, col.sunken, col.text, 1.25);
        else disc(ctx, x, yDn + 0.5, 1.5, col.text3);
      }
      for (const f of fx) {
        if (f.kind !== "lost" || f.wire !== i) continue;
        const t = (now - f.t0) / 600;
        const up = f.dir === "up";
        const x = up ? at(0.18 + f.k * 0.08, cx, sx) : at(0.18 + f.k * 0.08, sx, cx);
        const y = (up ? yUp : yDn) + 0.5 - ease(t) * 6;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = col.danger;
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(x - 3.5, y - 3.5); ctx.lineTo(x + 3.5, y + 3.5);
        ctx.moveTo(x + 3.5, y - 3.5); ctx.lineTo(x - 3.5, y + 3.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col.text3;
      ctx.font = font(10);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const label = fit(ctx, [`rtt ${c.rtt_ms.toFixed(1)} ms · ${fmt(c.up.lost + c.down.lost)} lost`, `rtt ${Math.round(c.rtt_ms)} ms`], Math.abs(sx - cx) - 4);
      ctx.fillText(label, (cx + sx) / 2, ny + nh + 16);
    });
  }

  function arrow(ctx, x, y, dir) {
    ctx.fillStyle = col.strong;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dir * 5, y - 3);
    ctx.lineTo(x - dir * 5, y + 3);
    ctx.closePath();
    ctx.fill();
  }

  function drawPane(ctx, kind, p, now) {
    const v = view;
    const c = kind === "you" ? v.clients[0] : kind === "bot" ? v.clients[1] : null;
    if (kind !== "server" && !c) return;
    const k = p.s / v.arena;
    const X = (x) => p.x + x * k, Y = (y) => p.y + y * k;
    const r = Math.max(3.5, v.radius * k);
    const small = p.s < 300;

    ctx.fillStyle = col.sunken;
    ctx.fillRect(p.x, p.y, p.s, p.s);
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = small ? 128 : 64; g < v.arena; g += small ? 128 : 64) {
      ctx.moveTo(Math.round(X(g)) + 0.5, p.y); ctx.lineTo(Math.round(X(g)) + 0.5, p.y + p.s);
      ctx.moveTo(p.x, Math.round(Y(g)) + 0.5); ctx.lineTo(p.x + p.s, Math.round(Y(g)) + 0.5);
    }
    ctx.stroke();
    const roll = fx.filter((f) => f.kind === "roll" && f.pane === kind).pop();
    ctx.strokeStyle = col.strong;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.s - 1, p.s - 1);
    if (roll) {
      ctx.globalAlpha = 1 - (now - roll.t0) / FX_MS;
      ctx.strokeStyle = col.signal;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, p.s - 2, p.s - 2);
      ctx.globalAlpha = 1;
    }

    // Header.
    ctx.font = font(small ? 10 : 11, 600);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = col.text;
    const right = kind === "server" ? `tick ${fmt(v.tick)}` : `${fmt(c.rollbacks)} rollback${c.rollbacks === 1 ? "" : "s"}`;
    ctx.font = font(small ? 10 : 11);
    const rw = ctx.measureText(right).width;
    ctx.font = font(small ? 10 : 11, 600);
    const name = kind === "you" ? ["client 0 · you", "you"] : kind === "bot" ? ["client 1 · bot 1", "bot 1"] : ["server", "server"];
    ctx.fillText(fit(ctx, name, p.s - rw - 8), p.x, p.y - 6);
    ctx.font = font(small ? 10 : 11);
    ctx.textAlign = "right";
    ctx.fillStyle = kind !== "server" && roll ? col.signal : col.text2;
    ctx.fillText(right, p.x + p.s, p.y - 6);

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.s, p.s);
    ctx.clip();
    // The server's world now, as dashed ghosts on a client.
    if (c) for (const [, x, y] of v.players) disc(ctx, X(x), Y(y), r, null, col.text2, 1, [2, 3]);
    // Your trail.
    const t = trails[kind];
    if (t.length > 1) {
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = Math.max(1.25, r * 0.35);
      ctx.lineCap = "round";
      for (let i = 1; i < t.length; i++) {
        ctx.globalAlpha = (i / t.length) * 0.45;
        ctx.beginPath();
        ctx.moveTo(X(t[i - 1][0]), Y(t[i - 1][1]));
        ctx.lineTo(X(t[i][0]), Y(t[i][1]));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
    }
    const label = (id, x, y, fill) => {
      if (r < 6) return;
      ctx.fillStyle = fill;
      ctx.font = font(Math.min(11, Math.round(r * 0.9)), 600);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(id), x, y + 0.5);
    };
    let you = null;
    if (kind === "server") {
      for (const [id, x, y] of v.players) {
        if (id === 0) { you = [X(x), Y(y)]; continue; }
        disc(ctx, X(x), Y(y), r, col.text);
        label(id, X(x), Y(y), col.sunken);
      }
    } else {
      for (const [id, x, y] of c.others) {
        if (id === 0) { you = [X(x), Y(y)]; continue; }
        disc(ctx, X(x), Y(y), r, col.text3);
        label(id, X(x), Y(y), col.sunken);
      }
      if (c.me && kind === "you") you = [X(c.me[0]), Y(c.me[1])];
      else if (c.me) {
        disc(ctx, X(c.me[0]), Y(c.me[1]), r, col.text);
        label(c.id, X(c.me[0]), Y(c.me[1]), col.sunken);
      }
    }
    // A rollback that moved your own player: the predicted ghost snaps to the corrected place.
    if (roll && roll.pane === kind && (Math.abs(roll.from[0] - roll.to[0]) + Math.abs(roll.from[1] - roll.to[1]) > 0.5)) {
      const q = ease((now - roll.t0) / FX_MS);
      const fx0 = X(roll.from[0]), fy0 = Y(roll.from[1]), tx = X(roll.to[0]), ty = Y(roll.to[1]);
      ctx.globalAlpha = 1 - q * 0.7;
      ctx.strokeStyle = col.signal;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(fx0, fy0); ctx.lineTo(tx, ty); ctx.stroke();
      disc(ctx, fx0 + (tx - fx0) * q, fy0 + (ty - fy0) * q, r, null, col.signal, 1.75, [3, 2]);
      ctx.globalAlpha = 1;
    }
    if (you) {
      disc(ctx, you[0], you[1], r, col.accent);
      label(0, you[0], you[1], col.surface);
      for (const f of fx) {
        if (f.kind !== "ring" || f.pane !== kind) continue;
        const q = (now - f.t0) / FX_MS;
        ctx.globalAlpha = 1 - q;
        disc(ctx, you[0], you[1], r + 3 + ease(q) * 14, null, col.accent, 2);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col.accent;
      ctx.font = font(10, 600);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const hw = ctx.measureText("you").width / 2 + 2;
      ctx.fillText("you", Math.min(p.x + p.s - hw, Math.max(p.x + hw, you[0])), you[1] < p.y + r + 16 ? you[1] + r + 12 : you[1] - r - 4);
    }
    ctx.restore();

    // Footer: the client's tick line, or the server's hash.
    const fy = p.y + p.s;
    ctx.textBaseline = "alphabetic";
    if (kind === "server") {
      ctx.font = font(10);
      ctx.textAlign = "left";
      ctx.fillStyle = col.text2;
      ctx.fillText(fit(ctx, [`state hash ${v.hash}`, v.hash], p.s), p.x, fy + 15);
      ctx.fillStyle = col.text3;
      ctx.fillText(fit(ctx, [`${fmt(v.check.matches)} hash checks, ${fmt(v.check.desyncs)} desyncs`, `${fmt(v.check.desyncs)} desyncs`], p.s), p.x, fy + 29);
      return;
    }
    tickLine(ctx, c, p, fy, roll, now);
  }

  // A client's time: shown (interpolated others) .. confirmed by the server .. predicted (its own player).
  // A rollback rewinds from the predicted tick by its depth and resimulates forward.
  function tickLine(ctx, c, p, fy, roll, now) {
    const v = view;
    const lo = Math.min(c.render_tick, c.confirmed), hi = Math.max(c.tick, v.tick);
    const span = Math.max(hi - lo, 12) + 4;
    const T = (t) => p.x + ((t - lo + 2) / span) * p.s;
    const y = fy + 12;
    ctx.strokeStyle = col.text3;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(T(c.render_tick), y); ctx.lineTo(T(c.confirmed), y); ctx.stroke();
    const own = c.id === 0 ? col.accent : col.text2;
    ctx.fillStyle = own;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(T(c.confirmed), y - 3, Math.max(1, T(c.tick) - T(c.confirmed)), 6);
    ctx.globalAlpha = 1;
    ctx.fillRect(T(c.tick) - 1, y - 5, 2.5, 10);
    disc(ctx, T(c.render_tick), y, 2.5, col.text3);
    ctx.strokeStyle = col.text;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(T(v.tick)) + 0.5, y - 6); ctx.lineTo(Math.round(T(v.tick)) + 0.5, y + 6); ctx.stroke();
    const lr = c.last_rollback;
    const hold = reduce.matches ? 240 : 40;
    // Rewind: an arc back from the predicted tick by the rollback's depth, then the resimulated ticks fill forward.
    const rewind = roll ? { head: roll.head, depth: roll.depth, q: (now - roll.t0) / FX_MS } : lr && lr.ago < hold ? { head: c.tick, depth: lr.depth, q: 1, fade: reduce.matches ? 1 : 1 - lr.ago / hold } : null;
    if (rewind) {
      const a = T(rewind.head), b = T(Math.max(lo - 2, rewind.head - rewind.depth));
      const back = ease(Math.min(1, rewind.q * 2));
      ctx.globalAlpha = rewind.fade ?? 1;
      ctx.strokeStyle = col.signal;
      ctx.fillStyle = col.signal;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const u = (i / 16) * back;
        const px = a + (b - a) * u, py = y - 4 - Math.sin(u * Math.PI) * 6;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
      if (rewind.q > 0.5) ctx.fillRect(b, y - 2, (a - b) * ease((rewind.q - 0.5) * 2), 4);
      ctx.globalAlpha = 1;
    }
    ctx.font = font(10);
    ctx.textBaseline = "alphabetic";
    const ly = fy + 30;
    const left = fit(ctx, [`shown ${fmt(c.render_tick)}`, fmt(c.render_tick)], p.s / 3);
    const rb = rewind ? `↺ ${fmt(rewind.depth)} · ` : "";
    const right = fit(ctx, [`${rb}predicted ${fmt(c.tick)} (+${fmt(c.tick - v.tick)})`, `${rb}predicted ${fmt(c.tick)}`, `${rb}${fmt(c.tick)}`], p.s - ctx.measureText(left).width - 10);
    ctx.fillStyle = col.text3;
    ctx.textAlign = "left";
    ctx.fillText(left, p.x, ly);
    ctx.textAlign = "right";
    ctx.fillStyle = rewind ? col.signal : col.text2;
    ctx.fillText(right, p.x + p.s, ly);
    const mid = `server ${fmt(v.tick)}`;
    const mw = ctx.measureText(mid).width, sx = T(v.tick);
    const l0 = p.x + ctx.measureText(left).width + 8, r0 = p.x + p.s - ctx.measureText(right).width - 8;
    if (sx - mw / 2 > l0 && sx + mw / 2 < r0) {
      ctx.textAlign = "center";
      ctx.fillStyle = col.text;
      ctx.fillText(mid, sx, ly);
    }
  }

  function drawTimeline(ctx) {
    const v = view;
    const { x, y, w, h } = G.tl;
    const top = y + 18, bot = y + h - 16, mid = (top + bot) / 2, half = (bot - top) / 2 - 2;
    ctx.fillStyle = col.sunken;
    ctx.fillRect(x, top, w, bot - top);
    ctx.font = font(10);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = col.text2;
    ctx.fillText(fit(ctx, ["frames resimulated per 100 ms, last 10 s", "resimulated per 100 ms"], w - 96), x, y + 10);
    const bins = new Map();
    for (const e of hist) {
      const k = Math.floor((e.tick - 1) / BIN);
      const b = bins.get(k) || [0, 0];
      b[0] += e.s0; b[1] += e.s1;
      bins.set(k, b);
    }
    let max = 12;
    for (const [a, b] of bins.values()) max = Math.max(max, a, b);
    max = Math.ceil(max / 6) * 6;
    ctx.textAlign = "right";
    ctx.fillStyle = col.text3;
    ctx.fillText(`scale ${max} ticks`, x + w, y + 10);
    const X = (t) => x + w - ((v.tick - t) / WINDOW) * w;
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 1; s < 10; s++) { const gx = Math.round(x + (w * s) / 10) + 0.5; ctx.moveTo(gx, top); ctx.lineTo(gx, bot); }
    ctx.moveTo(x, Math.round(mid) + 0.5); ctx.lineTo(x + w, Math.round(mid) + 0.5);
    ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(x, top, w, bot - top); ctx.clip();
    for (const m of marks) {
      const mx = Math.round(X(m.tick)) + 0.5;
      if (mx < x) continue;
      ctx.strokeStyle = col.text3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(mx, top); ctx.lineTo(mx, bot); ctx.stroke();
      ctx.setLineDash([]);
      tag(ctx, m.text, mx + 4, top + 12, col.text2);
    }
    const bw = Math.max(1, (w * BIN) / WINDOW - 1.5);
    for (const [k, [a, b]] of bins) {
      const ex = X(k * BIN) + 0.75;
      if (a) { ctx.fillStyle = col.accent; const bh = Math.max(1.5, (a / max) * half); ctx.fillRect(ex, mid - bh, bw, bh); }
      if (b) { ctx.fillStyle = col.text2; const bh = Math.max(1.5, (b / max) * half); ctx.fillRect(ex, mid + 1, bw, bh); }
    }
    ctx.restore();
    tag(ctx, "you", x + 4, mid - 6, col.accent);
    tag(ctx, "bot 1", x + 4, mid + 15, col.text2);
    ctx.fillStyle = col.text3;
    ctx.fillText("−10 s", x, bot + 13);
    ctx.textAlign = "right";
    ctx.fillText(`now, tick ${fmt(v.tick)}`, x + w, bot + 13);
  }

  // A label on a sunken backing, so bars behind it stay readable around it.
  function tag(ctx, text, x, y, color) {
    ctx.textAlign = "left";
    const w = ctx.measureText(text).width;
    ctx.fillStyle = col.sunken;
    ctx.fillRect(x - 3, y - 10, w + 6, 13);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // DOM readouts, at most five times a second.
  function updateDom(force) {
    const now = performance.now();
    if (!view || (!force && now - lastDom < 200)) return;
    lastDom = now;
    const v = view, c = v.clients[0];
    put(cell.t, `${(v.t_ms / 1000).toFixed(1)} s`);
    put(cell.tick, fmt(v.tick));
    put(cell.rtt, `${c.rtt_ms.toFixed(1)} ms`);
    put(cell.rollbacks, fmt(c.rollbacks));
    put(cell.resim, fmt(c.resimulated));
    put(cell.depth, `${fmt(c.max_depth)} tick${c.max_depth === 1 ? "" : "s"}`);
    put(cell.checks, fmt(v.check.matches));
    put(cell.desyncs, fmt(v.check.desyncs));
    put(cell.late, fmt(v.check.inputs_late));
    put(cell.lost, `${fmt(c.up.lost + c.down.lost)} of ${fmt(c.up.sent + c.down.sent)}`);
    const last = v.check.last;
    if (last) {
      const ok = v.check.desyncs === 0 && last.client === last.server;
      lamp.dataset.state = ok ? "ok" : "bad";
      put(lampText, `${ok ? "State hashes match" : "Desync"}: client ${last.seat}, tick ${fmt(last.tick)}`);
      put(lampHash, `${last.client} ${ok ? "=" : "≠"} ${last.server}`);
    }
    put(receipt, `${fmt(v.tick)} ticks of a ${PLAYERS}-player match through netcode's server, clients, codec and lag simulator, ${fmt(v.check.matches)} state hashes compared, in ${fmt(Math.round(callMs))} ms of calls, in your browser.`);
    canvas.setAttribute("aria-label", `Arena at tick ${fmt(v.tick)}: your client has rolled back ${fmt(c.rollbacks)} times, rtt ${c.rtt_ms.toFixed(1)} ms, ${fmt(v.check.desyncs)} desyncs. Arrow keys or WASD steer player 0, Space dashes.`);
  }

  function setHint() {
    put(hint, pilot
      ? "The autopilot is steering player 0. Take over with the arrow keys or WASD (Space dashes) or the buttons."
      : "You are steering player 0: arrow keys or WASD, Space dashes. Watch your input reach the server and bot 1 late.");
  }

  // Input.
  function buttons() {
    if (pilot) return view ? auto(view.clients[0].tick) : 0;
    const b = held | pulse;
    pulse = 0;
    return b;
  }

  function takeOver() {
    if (!pilot) return;
    pilot = false;
    lastB = -1;
    setHint();
  }

  async function advance(n, animate) {
    const g = run;
    const b = buttons();
    if (b !== lastB && view) {
      echoes.push({ T: view.clients[0].tick + 1, pilot });
      if (echoes.length > 6) echoes.shift();
      lastB = b;
    }
    const v = await call("step", { ticks: n, buttons: b });
    if (g !== run || gen !== generation) return;
    apply(v, animate);
  }

  const lagParams = () => Object.fromEntries(SLIDERS.map(([k]) => [k, Number(lagIn[k].value)]));
  const lagText = (p) => `${p.latency_ms} ms ± ${p.jitter_ms}, ${p.loss_pct} % loss`;
  function setSliders(key) {
    const pr = PRESETS.find(([k]) => k === key);
    if (!pr) return;
    SLIDERS.forEach(([k], i) => { lagIn[k].value = String(pr[2 + i]); lagOut[k](); });
  }

  async function restart() {
    const g = ++run;
    busy = true;
    try {
      view = null; hist = []; marks = []; fx = []; echoes = []; lastB = -1; acc = 0;
      trails = { you: [], server: [], bot: [] };
      const p = lagParams();
      const v0 = await call("new", { seed: SEED, players: PLAYERS, ...p });
      if (g !== run) return;
      apply(v0, false);
      marks.push({ tick: 0, text: lagText(p) });
      for (let done = 0; done < WARM && g === run; done++) await advance(1, false);
      if (g !== run) return;
      updateDom(true);
      paint(performance.now());
    } finally {
      if (g === run) busy = false;
    }
  }

  const fail = (err) => {
    setPlaying(false);
    status.textContent = `The demo stopped: ${err.message}`;
  };

  function frame(ts) {
    raf = 0;
    if (gen !== generation || !root.isConnected) return;
    const dt = last ? Math.min(100, ts - last) : 0;
    last = ts;
    if (playing) {
      acc = Math.min(acc + dt * Number(speed.value), TICK_MS * 8);
      const n = Math.floor(acc / TICK_MS);
      if (n > 0 && !busy) {
        acc -= n * TICK_MS;
        busy = true;
        const g = run;
        advance(n, !reduce.matches).catch(fail).finally(() => { if (g === run) busy = false; });
      }
    }
    paint(ts);
    updateDom(false);
    if ((playing || fx.length) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

  function setPlaying(on) {
    playing = on;
    put(play, on ? "Pause" : "Play");
    play.setAttribute("aria-pressed", String(on));
    echo.setAttribute("aria-live", on ? "off" : "polite");
    receipt.setAttribute("aria-live", on ? "off" : "polite");
    if (on) { acc = 0; kick(); }
  }

  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", async () => {
    setPlaying(false);
    while (busy) await new Promise((r) => setTimeout(r, 16));
    busy = true;
    const g = run;
    try {
      await advance(1, !reduce.matches);
      updateDom(true);
      kick();
      paint(performance.now());
    } catch (e) {
      fail(e);
    } finally {
      if (g === run) busy = false;
    }
  });
  reset.addEventListener("click", () => {
    pilot = true;
    setHint();
    put(echo, "Waiting for player 0's first input to reach bot 1.");
    status.textContent = "New match, seed 1.";
    restart().then(kick).catch(fail);
  });

  let lagTimer = 0;
  function sendLag(msg) {
    clearTimeout(lagTimer);
    lagTimer = setTimeout(async () => {
      const p = lagParams();
      const g = run;
      try {
        const v = await call("lag", p);
        if (g !== run) return;
        apply(v, false);
        marks.push({ tick: v.tick, text: lagText(p) });
        status.textContent = `${msg}: ${p.latency_ms} ms latency, ${p.jitter_ms} ms jitter, ${p.loss_pct} % loss, each way.`;
        updateDom(true);
        paint(performance.now());
      } catch (e) {
        fail(e);
      }
    }, 120);
  }
  preset.addEventListener("change", () => {
    setSliders(preset.value);
    sendLag(`Link set to ${preset.options[preset.selectedIndex].textContent.split(",")[0]}`);
  });
  for (const input of Object.values(lagIn)) {
    input.addEventListener("input", () => {
      const p = lagParams();
      const m = PRESETS.find((pr) => pr[2] === p.latency_ms && pr[3] === p.jitter_ms && pr[4] === p.loss_pct);
      preset.value = m ? m[0] : "custom";
      sendLag("Link set");
    });
  }

  const steerable = (t) => t === root || t === canvas || !!(t.closest && t.closest(".nc-keys"));
  root.addEventListener("keydown", (e) => {
    const b = KEYS[e.code];
    if (!b || e.altKey || e.ctrlKey || e.metaKey || !steerable(e.target)) return;
    if (b === DASH && e.target !== root && e.target !== canvas) return;
    e.preventDefault();
    takeOver();
    held |= b;
    if (b === DASH) pulse |= DASH;
    padBtn.get(b)?.toggleAttribute("data-on", true);
    kick();
  });
  root.addEventListener("keyup", (e) => {
    const b = KEYS[e.code];
    if (!b) return;
    held &= ~b;
    padBtn.get(b)?.toggleAttribute("data-on", false);
  });
  root.addEventListener("focusout", (e) => {
    if (root.contains(e.relatedTarget)) return;
    held = 0;
    for (const b of padBtn.values()) b.toggleAttribute("data-on", false);
  });
  for (const [bit, b] of padBtn) {
    const on = (e) => {
      e.preventDefault();
      takeOver();
      held |= bit;
      if (bit === DASH) pulse |= DASH;
      b.toggleAttribute("data-on", true);
      if (e.pointerId >= 0) b.setPointerCapture(e.pointerId);
      kick();
    };
    const off = () => { held &= ~bit; b.toggleAttribute("data-on", false); };
    b.addEventListener("pointerdown", on);
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      if (e.detail !== 0) return;
      on(e);
      setTimeout(off, 250);
    });
  }

  const redraw = () => { readColors(); paint(performance.now()); };
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", redraw);
  addEventListener("themechange", redraw);
  const ro = new ResizeObserver(() => {
    if (gen !== generation || !root.isConnected) {
      ro.disconnect();
      scheme.removeEventListener("change", redraw);
      removeEventListener("themechange", redraw);
      return;
    }
    layout();
    paint(performance.now());
  });
  ro.observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  setSliders("soak");
  setHint();
  await cssReady;
  readColors();
  layout();
  await restart();
  setPlaying(playing);
}
