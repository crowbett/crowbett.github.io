// netcode demo: netcode's real rollback client and authoritative server, compiled
// from Rust to WebAssembly. One match of 6 players runs on simulated 60 Hz ticks;
// every datagram goes through netcode's codec and lag simulator. You drive player 0.
const TICK_MS = 1000 / 60;
const MAX_TICKS = 8;
const PLAYERS = 6;
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, DASH = 16;
const KEYS = {
  ArrowUp: UP, KeyW: UP, ArrowDown: DOWN, KeyS: DOWN,
  ArrowLeft: LEFT, KeyA: LEFT, ArrowRight: RIGHT, KeyD: RIGHT, Space: DASH,
};
const LAG = [
  ["latency_ms", "Latency", 0, 300, 10, 100, "ms"],
  ["jitter_ms", "Jitter", 0, 100, 5, 20, "ms"],
  ["loss_pct", "Loss", 0, 20, 1, 2, "%"],
];
const DEAD = 14;
const FLASH = 18;
let generation = 0;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

function cells(label, keys) {
  const wrap = el("div", "nc-client");
  const head = el("p", "nc-client-head", label);
  const list = el("ul", "cells nc-cells");
  const out = {};
  for (const [k, name] of keys) {
    const li = el("li");
    const v = el("span", "nc-v", "–");
    li.append(el("span", "nc-k", name), v);
    list.append(li);
    out[k] = v;
  }
  wrap.append(head, list);
  return { wrap, head, out };
}

const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };

function colors(root) {
  const cs = getComputedStyle(root);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    sunken: v("--sunken"), line: v("--line"), strong: v("--line-strong"), text: v("--text"),
    text2: v("--text-2"), text3: v("--text-3"), accent: v("--accent"), live: v("--live"),
    danger: v("--danger"), surface: v("--surface"), flash: v("--nc-flash"), mono: v("--mono"),
  };
}

function layout(w) {
  const wide = w >= 600;
  const views = wide ? 2 : 1;
  const gap = wide ? 20 : 0;
  const size = Math.min(wide ? 440 : 520, Math.floor((w - gap * (views - 1)) / views));
  const x0 = Math.floor((w - size * views - gap * (views - 1)) / 2);
  const band = wide ? 112 : 88;
  const label = 22;
  return { w, wide, views, gap, size, x0, band, label, h: band + label + size };
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
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const bar = el("div", "nc-controls");
  const play = button(reduce ? "Play" : "Pause", "nc-play");
  const step = button("Step 1 s", "secondary nc-step");
  const swap = button("Show bot 1’s view", "secondary nc-swap");
  const actions = el("div", "nc-actions");
  actions.append(play, step, swap);
  const sliders = el("div", "nc-sliders");
  const lagIn = {};
  for (const [key, name, min, max, stepBy, value, unit] of LAG) {
    const input = el("input");
    Object.assign(input, { type: "range", name: key, min, max, step: stepBy, value });
    const span = el("span", "demo-label");
    const show = () => { span.textContent = `${name} ${input.value} ${unit}`; };
    show();
    input.addEventListener("input", show);
    const field = el("label", "demo-field nc-field");
    field.append(span, input);
    sliders.append(field);
    lagIn[key] = input;
  }
  bar.append(actions, sliders);

  const canvas = el("canvas", "nc-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Arena. Arrow keys or WASD move your player, Space dashes.");
  canvas.setAttribute("aria-describedby", "nc-legend");

  const lamp = el("p", "nc-lamp");
  const lampText = el("span", "nc-lamp-text", "Waiting for the first confirmed tick");
  const lampHash = el("code", "nc-lamp-hash");
  lamp.append(el("span", "nc-dot"), lampText, lampHash);

  const world = el("ul", "cells nc-world");
  const wv = {};
  for (const [k, name] of [["tick", "server tick"], ["time", "sim time"], ["checks", "hash checks"], ["desyncs", "desyncs"], ["late", "late inputs"]]) {
    const li = el("li");
    const v = el("span", "nc-v", "–");
    li.append(el("span", "nc-k", name), v);
    world.append(li);
    wv[k] = v;
  }

  const KEYSET = [
    ["rollbacks", "rollbacks"], ["resim", "frames resimulated"], ["depth", "max depth"],
    ["lead", "lead"], ["rtt", "rtt"], ["lost", "lost up/down"],
  ];
  const clients = [cells("Client 1 · you", KEYSET), cells("Client 2 · bot 1", KEYSET)];
  const readouts = el("div", "nc-readouts");
  readouts.append(...clients.map((c) => c.wrap));

  const legend = el("p", "nc-legend");
  legend.id = "nc-legend";
  for (const [k, t] of [["me", "predicted (you)"], ["ghost", "server state"], ["other", "interpolated"], ["roll", "rollback correction"], ["up", "input packet"], ["down", "snapshot packet"]]) {
    const s = el("span", "nc-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const hint = el("p", "nc-hint", "Click the arena and steer with WASD or the arrow keys, Space to dash. On a touch screen, drag on the arena to steer and tap to dash.");
  const status = el("p", "nc-status");
  status.setAttribute("aria-live", "polite");

  root.replaceChildren(bar, canvas, lamp, world, readouts, legend, hint, status);

  let col = colors(root);
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const recolor = () => { col = colors(root); paint(); };
  scheme.addEventListener("change", recolor);

  let chain = Promise.resolve();
  const call = (method, params) => {
    const p = chain.then(() => demo.call(method, params));
    chain = p.catch(() => {});
    return p;
  };

  let view = null;
  let watch = 0;
  let playing = false;
  let geo = layout(root.clientWidth || 360);
  let held = 0;
  let pulse = 0;
  let stick = null;
  let lastDesyncs = 0;

  const lagParams = () => Object.fromEntries(LAG.map(([k]) => [k, Number(lagIn[k].value)]));
  const buttons = () => {
    let b = held;
    if (stick && stick.dir) b |= stick.dir;
    b |= pulse;
    pulse = 0;
    return b;
  };

  function resize() {
    const w = Math.max(240, Math.floor(canvas.clientWidth || root.clientWidth || 360));
    geo = layout(w);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.height = `${geo.h}px`;
    canvas.width = Math.round(geo.w * dpr);
    canvas.height = Math.round(geo.h * dpr);
    swap.hidden = geo.wide;
    clients[0].wrap.hidden = !geo.wide && watch !== 0;
    clients[1].wrap.hidden = !geo.wide && watch !== 1;
    paint();
  }

  // Arena at position pos (0 left, 1 right) on the canvas; shown() pairs each visible client with its position.
  const arenaBox = (pos) => ({ x: geo.x0 + pos * (geo.size + geo.gap), y: geo.band + geo.label, s: geo.size });
  const shown = () => (geo.wide ? [[0, 0], [1, 1]] : [[watch, 0]]);

  function disc(ctx, x, y, r, fill, stroke, dash) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawArena(ctx, v, c, pos) {
    const box = arenaBox(pos);
    const isYou = c.id === 0;
    const k = box.s / v.arena;
    const X = (x) => box.x + x * k;
    const Y = (y) => box.y + y * k;
    const r = Math.max(3, v.radius * k);
    const lr = c.last_rollback;
    const fresh = lr && lr.ago < FLASH && !reduce;

    ctx.fillStyle = col.sunken;
    ctx.fillRect(box.x, box.y, box.s, box.s);
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 64; g < v.arena; g += 64) {
      ctx.moveTo(Math.round(X(g)) + 0.5, box.y);
      ctx.lineTo(Math.round(X(g)) + 0.5, box.y + box.s);
      ctx.moveTo(box.x, Math.round(Y(g)) + 0.5);
      ctx.lineTo(box.x + box.s, Math.round(Y(g)) + 0.5);
    }
    ctx.stroke();
    ctx.lineWidth = fresh ? 3 : 1;
    ctx.strokeStyle = fresh ? col.flash : col.strong;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.s - 1, box.s - 1);
    ctx.lineWidth = 1;

    ctx.font = `10px ${col.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [id, x, y] of c.others) {
      disc(ctx, X(x), Y(y), r, col.text3);
      ctx.fillStyle = col.sunken;
      ctx.fillText(String(id), X(x), Y(y) + 0.5);
    }
    ctx.lineWidth = 1.5;
    for (const [, x, y] of v.players) disc(ctx, X(x), Y(y), r, null, col.text, [3, 3]);
    ctx.lineWidth = 1;

    if (lr && (lr.ago < 90 || reduce && lr.ago < 60)) {
      ctx.globalAlpha = reduce ? 1 : Math.max(0.2, 1 - lr.ago / 90);
      ctx.strokeStyle = col.flash;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(lr.from[0]), Y(lr.from[1]));
      ctx.lineTo(X(lr.to[0]), Y(lr.to[1]));
      ctx.stroke();
      disc(ctx, X(lr.from[0]), Y(lr.from[1]), r, null, col.flash, [2, 2]);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }
    if (c.me) {
      const mx = X(c.me[0]), my = Y(c.me[1]);
      if (fresh) {
        ctx.globalAlpha = 1 - lr.ago / FLASH;
        disc(ctx, mx, my, r + 4 + lr.ago, null, col.flash);
        ctx.globalAlpha = 1;
      }
      disc(ctx, mx, my, r, col.accent);
      ctx.fillStyle = col.surface;
      ctx.fillText(String(c.id), mx, my + 0.5);
    }
    if (isYou && stick) {
      ctx.globalAlpha = 0.6;
      disc(ctx, stick.x0, stick.y0, 34, null, col.text2);
      disc(ctx, stick.x, stick.y, 12, col.text2);
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = col.text;
    ctx.font = `11px ${col.mono}`;
    const who = isYou ? "client 1 · you" : `client ${c.id + 1} · bot ${c.id}`;
    ctx.fillText(who, box.x, box.y - 7);
    ctx.textAlign = "right";
    ctx.fillStyle = col.text2;
    ctx.fillText(c.joined ? `predicting tick ${fmt(c.tick)}` : "joining", box.x + box.s, box.y - 7);
  }

  function drawWires(ctx, v) {
    const cx = geo.w / 2;
    const sw = 148, sh = 34, sy = 8;
    ctx.fillStyle = col.surface;
    ctx.strokeStyle = col.strong;
    ctx.fillRect(cx - sw / 2, sy, sw, sh);
    ctx.strokeRect(cx - sw / 2 + 0.5, sy + 0.5, sw - 1, sh - 1);
    ctx.fillStyle = col.text;
    ctx.font = `11px ${col.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`server · tick ${fmt(v.tick)}`, cx, sy + sh / 2 + 0.5);
    for (const [slot, pos] of shown()) {
      const c = v.clients[slot];
      if (!c) continue;
      const box = arenaBox(pos);
      const ax = geo.wide ? box.x + box.s / 2 : box.x + 28, ay = geo.band - 4;
      const bx = cx, by = sy + sh;
      const dx = ax - bx, dy = ay - by;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 4, ny = (dx / len) * 4;
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + nx, by + ny); ctx.lineTo(ax + nx, ay + ny);
      ctx.moveTo(bx - nx, by - ny); ctx.lineTo(ax - nx, ay - ny);
      ctx.stroke();
      for (const [kind, p] of c.up_flying) {
        const t = p / 1000;
        const x = ax + (bx - ax) * t + nx, y = ay + (by - ay) * t + ny;
        ctx.fillStyle = kind === "i" ? col.accent : col.text3;
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      for (const [kind, p] of c.down_flying) {
        const t = p / 1000;
        const x = bx + (ax - bx) * t - nx, y = by + (ay - by) * t - ny;
        disc(ctx, x, y, kind === "o" ? 1.5 : 2.5, kind === "o" ? col.text3 : col.text);
      }
    }
  }

  function paint() {
    const ctx = canvas.getContext("2d");
    const dpr = canvas.width / geo.w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geo.w, geo.h);
    if (!view) return;
    drawWires(ctx, view);
    for (const [slot, pos] of shown()) {
      const c = view.clients[slot];
      if (c) drawArena(ctx, view, c, pos);
    }
  }

  function readout() {
    const v = view;
    const last = v.check.last;
    const ok = v.check.desyncs === 0 && last && last.client === last.server;
    lamp.dataset.state = !last ? "wait" : ok ? "ok" : "bad";
    if (last) {
      put(lampText, ok ? `State hashes match: client ${last.seat + 1}, tick ${fmt(last.tick)}` : `Desync: client ${last.seat + 1}, tick ${fmt(last.tick)}`);
      put(lampHash, ok ? last.server : `${last.client} ≠ ${last.server}`);
    }
    put(wv.tick, fmt(v.tick));
    put(wv.time, `${(v.t_ms / 1000).toFixed(1)} s`);
    put(wv.checks, fmt(v.check.matches));
    put(wv.desyncs, fmt(v.check.desyncs));
    put(wv.late, fmt(v.check.inputs_late));
    v.clients.forEach((c, i) => {
      const o = clients[i]?.out;
      if (!o) return;
      put(o.rollbacks, fmt(c.rollbacks));
      put(o.resim, fmt(c.resimulated));
      put(o.depth, plural(c.max_depth, "tick", "ticks"));
      put(o.lead, plural(c.lead, "tick", "ticks"));
      put(o.rtt, `${c.rtt_ms.toFixed(1)} ms`);
      put(o.lost, `${fmt(c.up.lost)}/${fmt(c.down.lost)}`);
    });
    if (v.check.desyncs !== lastDesyncs) {
      lastDesyncs = v.check.desyncs;
      status.textContent = `Desync detected at tick ${fmt(last ? last.tick : v.tick)}.`;
    }
  }

  function show(v) {
    if (gen !== generation) return;
    view = v;
    readout();
    paint();
  }

  function summary() {
    const v = view;
    const you = v.clients[0];
    status.textContent = `Tick ${fmt(v.tick)}, ${(v.t_ms / 1000).toFixed(1)} s simulated: you rolled back ${plural(you.rollbacks, "time", "times")}, ` +
      `${plural(you.resimulated, "frame", "frames")} resimulated; ${fmt(v.check.matches)} hash checks, ${plural(v.check.desyncs, "desync", "desyncs")}.`;
  }

  let acc = 0, lastT = null, busy = false, raf = 0;
  function frame(t) {
    raf = 0;
    if (gen !== generation || !root.isConnected || !playing) { lastT = null; return; }
    if (lastT !== null) acc = Math.min(acc + (t - lastT), TICK_MS * MAX_TICKS);
    lastT = t;
    const n = Math.floor(acc / TICK_MS);
    if (n > 0 && !busy) {
      acc -= n * TICK_MS;
      busy = true;
      call("step", { ticks: n, buttons: buttons() }).then(show, fail).finally(() => { busy = false; });
    } else if (stick || (view && view.clients.some((c) => c.last_rollback && c.last_rollback.ago < FLASH))) {
      paint();
    }
    raf = requestAnimationFrame(frame);
  }
  function fail(e) {
    setPlaying(false);
    status.textContent = `The demo stopped: ${e.message}`;
  }
  function setPlaying(on) {
    playing = on;
    put(play, on ? "Pause" : "Play");
    if (on && !raf) { acc = 0; lastT = null; raf = requestAnimationFrame(frame); }
    if (!on && view) summary();
  }

  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", async () => {
    if (playing) setPlaying(false);
    step.disabled = true;
    try {
      show(await call("step", { ticks: 60, buttons: buttons() }));
      summary();
    } catch (e) {
      fail(e);
    } finally {
      step.disabled = false;
    }
  });
  swap.addEventListener("click", () => {
    watch = watch === 0 ? 1 : 0;
    put(swap, watch === 0 ? "Show bot 1’s view" : "Show your view");
    resize();
  });

  let lagTimer = 0;
  for (const input of Object.values(lagIn)) {
    input.addEventListener("input", () => {
      clearTimeout(lagTimer);
      lagTimer = setTimeout(async () => {
        const p = lagParams();
        try {
          show(await call("lag", p));
          status.textContent = `Link set to ${p.latency_ms} ms latency, ${p.jitter_ms} ms jitter, ${p.loss_pct} % loss each way.`;
        } catch (e) {
          fail(e);
        }
      }, 120);
    });
  }

  canvas.addEventListener("keydown", (e) => {
    const b = KEYS[e.code];
    if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    held |= b;
  });
  canvas.addEventListener("keyup", (e) => {
    const b = KEYS[e.code];
    if (b) held &= ~b;
  });
  canvas.addEventListener("blur", () => { held = 0; stick = null; });

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const [x, y] = local(e);
    stick = { id: e.pointerId, x0: x, y0: y, x, y, dir: 0, t: e.timeStamp, moved: false };
    canvas.setPointerCapture(e.pointerId);
    paint();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!stick || stick.id !== e.pointerId) return;
    const [x, y] = local(e);
    const dx = x - stick.x0, dy = y - stick.y0;
    const d = Math.hypot(dx, dy);
    stick.x = x; stick.y = y;
    if (d > DEAD) stick.moved = true;
    stick.dir = d <= DEAD ? 0 : (dx > d * 0.38 ? RIGHT : dx < -d * 0.38 ? LEFT : 0) | (dy > d * 0.38 ? DOWN : dy < -d * 0.38 ? UP : 0);
    if (!playing) paint();
  });
  const release = (e) => {
    if (!stick || stick.id !== e.pointerId) return;
    if (!stick.moved && e.timeStamp - stick.t < 250 && e.type === "pointerup") pulse = DASH;
    stick = null;
    paint();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  const ro = new ResizeObserver(() => {
    if (gen === generation && root.isConnected) resize();
    else { ro.disconnect(); scheme.removeEventListener("change", recolor); }
  });
  ro.observe(root);

  resize();
  show(await call("new", { seed: 1, players: PLAYERS, ...lagParams() }));
  show(await call("step", { ticks: 120 }));
  await cssReady;
  resize();
  summary();
  setPlaying(!reduce);
}
