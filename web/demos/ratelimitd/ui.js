// ratelimitd demo: a traffic floor over ratelimitd's real gcra, token bucket and
// sliding window Step functions, compiled to WebAssembly. Each run is one race
// call; the floor plays its per-slice allowed and denied counts on simulated time.
const PATTERNS = [["steady", "steady"], ["burst", "burst"], ["ramp", "ramp"], ["attack", "attack"]];
// The bridge's own description of each shape, relative to the limit L.
const SHAPES = {
  steady: "1.2× the limit throughout",
  burst: "0.5× the limit plus four bursts of 2× burst",
  ramp: "rising from 0 to 3× the limit",
  attack: "0.5× the limit, plus 10× more in the middle third",
};
// Traffic the visitor can trigger: before its first spike (attack: flood at
// d/3; burst: first burst at d/8) the pattern's requests do not depend on the
// duration d, so re-running with d = factor × now keeps every past request and
// verdict and moves the event to now.
const FIRE = { attack: 3, burst: 8 };
const RATES = [2, 5, 10, 20, 50];
const BURSTS = [1, 5, 10, 20, 50];
const SPEEDS = [1, 2, 5];
const RUN_MS = 60000;
const BUCKETS = 240;
const WARM_S = 8;
const STILL_S = 40;
const WIN_S = 30;
const APPROACH_S = 1.6;
const BOUNCE_MS = 300;
const NAMES = { gcra: "gcra", token_bucket: "token bucket", sliding_window: "sliding window" };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const secs = (s, d = 1) => `${s.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} s`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const hash = (i) => {
  let x = (i + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const pct = (a, n) => (n ? `${Math.round((100 * a) / n)} %` : "–");

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

function range(name, values, value, unit) {
  const i = el("input");
  Object.assign(i, { type: "range", name, min: 0, max: values.length - 1, step: 1, value: values.indexOf(value) });
  const out = el("output", "rl-val", `${value}${unit}`);
  return { i, out, get: () => values[Number(i.value)], sync: () => { out.textContent = `${values[Number(i.value)]}${unit}`; } };
}

// build turns one race answer into a run the floor can play: one dot per
// offered request, spread across its slice, with each lane's denials spaced
// evenly among the slice's requests (the binary reports counts per slice, not
// the order inside one), and prefix sums for the counters.
function build(r, p) {
  const bw = r.bucketUs / 1e6;
  const B = r.offered.length;
  const N = r.offered.reduce((a, b) => a + b, 0);
  const arr = new Float64Array(N);
  const jy = new Float32Array(N);
  const den = r.series.map(() => new Uint8Array(N));
  const cumO = new Int32Array(B + 1);
  const cumA = r.series.map(() => new Int32Array(B + 1));
  const cumD = r.series.map(() => new Int32Array(B + 1));
  let i = 0;
  for (let b = 0; b < B; b++) {
    const n = r.offered[b];
    cumO[b + 1] = cumO[b] + n;
    r.series.forEach((s, l) => {
      cumA[l][b + 1] = cumA[l][b] + s.allowed[b];
      cumD[l][b + 1] = cumD[l][b] + s.denied[b];
    });
    for (let j = 0; j < n; j++, i++) {
      const h = hash(i * 31 + p.seed * 7919);
      arr[i] = b * bw + ((j + 0.15 + 0.7 * h) / n) * bw;
      jy[i] = hash(i * 17 + p.seed) * 2 - 1;
      r.series.forEach((s, l) => {
        const d = s.denied[b];
        den[l][i] = Math.floor(((j + 1) * d) / n) - Math.floor((j * d) / n);
      });
    }
  }
  return { r, p, bw, B, N, arr, jy, den, cumO, cumA, cumD, dur: p.durationMs / 1000, algos: r.series.map((s) => s.algo) };
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
  const play = button("Pause");
  const step = button("Step 1 s", "secondary");
  const reset = button("Reset", "secondary");
  const fire = button("Launch the attack", "rl-fire");
  const acts = el("div", "rl-acts");
  acts.append(play, step, reset, fire);
  const pattern = select("pattern", PATTERNS, "attack");
  const rate = range("rate", RATES, 10, " /s");
  const burst = range("burst", BURSTS, 10, "");
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 2);
  const rateField = field("limit", rate.i, "rl-range");
  rateField.querySelector(".demo-label").append(" ", rate.out);
  const burstField = field("burst", burst.i, "rl-range");
  burstField.querySelector(".demo-label").append(" ", burst.out);
  const knobs = el("div", "rl-knobs");
  knobs.append(field("traffic", pattern), rateField, burstField, field("speed", speed));
  const form = el("form", "rl-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(acts, knobs);

  const canvas = el("canvas", "rl-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend rl-legend");
  for (const [k, t] of [["arriving", "arriving request"], ["you", "yours"], ["allowed", "allowed"], ["denied", "denied"], ["limit", "limit"]]) {
    const s = el("span", "rl-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const youLine = el("p", "rl-you");
  youLine.setAttribute("aria-live", "polite");
  const youTick = el("span", "rl-you-tick");
  const cells = el("ul", "cells stack rl-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["run", "run"], ["offered", "offered"], ["ops", "offered /s"],
    ["gcra", "gcra allowed"], ["token_bucket", "token bucket allowed"], ["sliding_window", "sliding window allowed"], ["emit", "emission interval"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "rl-v", "–");
    li.append(el("span", "rl-k", t), v);
    cell[k] = v;
    cells.append(li);
  }
  const status = el("p", "rl-status");
  status.setAttribute("aria-live", "polite");
  const receipt = el("p", "demo-out rl-out");
  root.replaceChildren(form, canvas, legend, youLine, cells, status, receipt);

  // State. now is global simulated seconds; runs are laid end to end on it.
  let runs = [];
  let next = null;
  let now = 0;
  let seed = 1;
  let runNo = 0;
  let gen = 0;
  let playing = !reduce.matches;
  let visible = true;
  let last = 0;
  let raf = 0;
  let colors = null;
  let lastDom = 0;
  let yMax = 0;
  let chain = Promise.resolve();
  let calls = 0;
  let decisions = 0;
  let callMs = 0;

  const race = (p) => {
    const run = chain.then(async () => {
      const t0 = performance.now();
      try {
        const r = await demo.call("race", p);
        calls++;
        decisions += r.offered.reduce((a, b) => a + b, 0) * r.series.length;
        return build(r, p);
      } finally {
        callMs += performance.now() - t0;
      }
    });
    chain = run.catch(() => {});
    return run;
  };
  const params = (s, durationMs = RUN_MS) => ({ pattern: pattern.value, seed: s, rate: rate.get(), periodMs: 1000, burst: burst.get(), durationMs, buckets: BUCKETS });
  const cur = () => {
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i].start <= now + 1e-9) return runs[i];
    return runs[0];
  };
  const local = (c) => Math.min(c.dur, now - c.start);
  const done = (c) => Math.max(0, Math.min(c.B, Math.floor((local(c) + 1e-9) / c.bw)));

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"),
      text2: v("--text-2"), text3: v("--text-3"), accent: v("--accent"), tint: v("--accent-tint"), live: v("--live"),
      danger: v("--danger"), mono: v("--mono") || "monospace",
    };
  }

  // Geometry, in CSS pixels. Wide: each lane is a floor beside its strip chart.
  // Narrow: the strip sits under its floor.
  let G = null;
  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const wide = W >= 640;
    const padL = 12, padR = 12, padT = 22, axisH = 30;
    const floorH = wide ? 104 : 84, stripH = wide ? 0 : 64;
    const laneH = floorH + stripH;
    const fw = wide ? Math.round(W * 0.5) : W - padR;
    const H = padT + 3 * laneH + axisH;
    G = { W, H, wide, padL, padR, padT, laneH, floorH, stripH, fw, gx: Math.round(padL + (fw - padL) * 0.56),
      sx0: wide ? fw + 20 : padL, sx1: W - padR - (wide ? 30 : 30) };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const laneY = (l) => G.padT + l * G.laneH;
  const stripBox = (l) => G.wide
    ? { y0: laneY(l) + 10, y1: laneY(l) + G.floorH - 10 }
    : { y0: laneY(l) + G.floorH + 2, y1: laneY(l) + G.laneH - 10 };
  const tx = (t) => G.sx0 + ((t - (now - WIN_S)) / WIN_S) * (G.sx1 - G.sx0);
  const ry = (v, b) => b.y1 - Math.sqrt(Math.max(0, v) / yMax) * (b.y1 - b.y0);

  // Yours: the slices the visitor's own flood or burst covers.
  function yours(c, b) {
    if (c.fire == null) return false;
    const t0 = b * c.bw, t1 = t0 + c.bw;
    const end = c.p.pattern === "attack" ? 2 * c.fire : c.fire + Math.min(0.1, c.dur / 20);
    return t1 > c.fire && t0 < end;
  }

  function nice(v) {
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [5, 2, 1]) if (m * e <= v) return m * e;
    return e;
  }

  function draw() {
    if (!G || !runs.length) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors;
    const font = (px, w = 400) => `${w} ${px}px ${c.mono}`;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    const run = cur();
    const lim = run.p.rate;
    const sp = Number(speed.value);
    const k = (G.gx - G.padL) / APPROACH_S;

    // Header.
    ctx.font = font(10);
    ctx.fillStyle = c.text3;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("arriving →", G.padL, G.padT - 8);
    ctx.textAlign = "center";
    ctx.fillText("gate", G.gx, G.padT - 8);
    ctx.textAlign = "right";
    ctx.fillText("allowed →", G.fw - 6, G.padT - 8);
    if (G.wide) {
      ctx.textAlign = "left";
      ctx.fillText(`per second, last ${WIN_S} s`, G.sx0, G.padT - 8);
    }

    // Scale for the strips: the busiest finished slice in view, eased.
    let peak = lim * 1.6;
    for (const r of runs) {
      if (r.start > now || r.start + r.dur < now - WIN_S) continue;
      const b0 = Math.max(0, Math.floor((now - WIN_S - r.start) / r.bw)), b1 = done(r);
      for (let b = b0; b < b1; b++) peak = Math.max(peak, r.r.offered[b] / r.bw);
    }
    yMax = yMax && !reduce.matches ? yMax + (peak * 1.08 - yMax) * 0.12 : peak * 1.08;

    for (let l = 0; l < 3; l++) {
      const y = laneY(l);
      const algo = run.algos[l];
      if (l) {
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(G.W, Math.round(y) + 0.5); ctx.stroke();
      }
      // Lane label and counters, from the finished slices.
      const nb = shown && shown.run === run ? shown.nb : done(run);
      const a =run.cumA[l][nb], d = run.cumD[l][nb];
      ctx.textAlign = "left";
      ctx.fillStyle = c.text;
      ctx.font = font(11, 600);
      ctx.fillText(NAMES[algo] || algo, G.padL, y + 17);
      ctx.font = font(10);
      ctx.fillStyle = c.text2;
      ctx.textAlign = "right";
      ctx.fillText(`${fmt(a)} allowed · ${fmt(d)} denied`, G.fw - 6, y + 17);

      // Floor: dots approach the gate, then pass or bounce.
      const fy0 = y + 28, fy1 = y + G.floorH - 10, fmid = (fy0 + fy1) / 2, spread = (fy1 - fy0) / 2 - 3;
      let flash = 0;
      for (const r of runs) {
        const passS = (G.fw - 8 - G.gx) / k;
        const from = now - Math.max(passS, (BOUNCE_MS / 1000) * sp) - r.start, to = now + APPROACH_S - r.start;
        if (to < 0 || from > r.dur) continue;
        let lo = 0, hi = r.N;
        while (lo < hi) { const m = (lo + hi) >> 1; if (r.arr[m] < from) lo = m + 1; else hi = m; }
        const yourB0 = r.fire != null ? r.fire : Infinity;
        const stop = Math.min(to, r.dur);
        for (let i = lo; i < r.N && r.arr[i] <= stop; i++) {
          const t = r.start + r.arr[i];
          const py = fmid + r.jy[i] * spread;
          const dt = now - t;
          const mine = r.fire != null && r.arr[i] >= yourB0 && yours(r, Math.floor(r.arr[i] / r.bw));
          if (dt < 0) {
            ctx.fillStyle = mine ? c.accent : c.text2;
            const x = G.gx - 3 + dt * k;
            if (mine) ctx.fillRect(x - 2.5, py - 2.5, 5, 5);
            else ctx.fillRect(x - 2, py - 2, 4, 4);
          } else if (r.den[l][i]) {
            const e = (dt / sp) * 1000 / BOUNCE_MS;
            if (e >= 1) continue;
            if (e < 0.5) flash = Math.max(flash, 1 - 2 * e);
            const q = ease(e);
            ctx.globalAlpha = 1 - q;
            ctx.fillStyle = c.danger;
            ctx.fillRect(G.gx - 6 - q * 26 - 2, py + q * r.jy[i] * 20 - 2, 4, 4);
            ctx.globalAlpha = 1;
          } else {
            const x = G.gx + 3 + dt * k;
            const end = G.fw - 8;
            if (x > end) continue;
            ctx.globalAlpha = Math.min(1, (end - x) / 24);
            ctx.fillStyle = c.live;
            ctx.fillRect(x - 2, py - 2, 4, 4);
            ctx.globalAlpha = 1;
          }
        }
      }
      ctx.fillStyle = flash ? c.danger : c.strong;
      ctx.globalAlpha = flash ? 0.4 + 0.6 * flash : 1;
      ctx.fillRect(G.gx - 1.5, fy0 - 4, 3, fy1 - fy0 + 8);
      ctx.globalAlpha = 1;

      drawStrip(ctx, l, lim, font);
    }

    // Time axis under the last strip.
    ctx.fillStyle = c.text3;
    ctx.font = font(10);
    ctx.textAlign = "center";
    const ax = G.padT + 3 * G.laneH + 12;
    for (const s of [WIN_S, 20, 10, 0]) {
      const x = G.sx0 + ((WIN_S - s) / WIN_S) * (G.sx1 - G.sx0);
      ctx.textAlign = s === WIN_S ? "left" : s === 0 ? "right" : "center";
      ctx.fillText(s ? `−${s} s` : "now", s === WIN_S ? G.sx0 : s === 0 ? G.sx1 : x, ax);
    }
    if (!G.wide) {
      ctx.textAlign = "left";
      ctx.fillText("strips: per second, sqrt scale", G.padL, ax + 14);
    } else {
      ctx.textAlign = "left";
      ctx.fillText("each dot is one request", G.padL, ax);
    }
  }

  function drawStrip(ctx, l, lim, font) {
    const c = colors;
    const b = stripBox(l);
    ctx.fillStyle = c.surface;
    ctx.fillRect(G.sx0, b.y0, G.sx1 - G.sx0, b.y1 - b.y0);
    ctx.save();
    ctx.beginPath(); ctx.rect(G.sx0, b.y0 - 12, G.sx1 - G.sx0, b.y1 - b.y0 + 12); ctx.clip();
    let mark = null;
    for (const r of runs) {
      if (r.start > now || r.start + r.dur < now - WIN_S) continue;
      if (r.start > now - WIN_S && r !== runs[0]) {
        const x = Math.round(tx(r.start)) + 0.5;
        ctx.strokeStyle = c.text3;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, b.y0); ctx.lineTo(x, b.y1); ctx.stroke();
        ctx.setLineDash([]);
        if (l === 0) {
          ctx.fillStyle = c.text3;
          ctx.font = font(9);
          ctx.textAlign = "left";
          ctx.fillText(`run ${r.no}`, x + 3, b.y0 - 3);
        }
      }
      const b0 = Math.max(0, Math.floor((now - WIN_S - r.start) / r.bw)), b1 = done(r);
      if (r.fire != null) {
        const end = r.p.pattern === "attack" ? 2 * r.fire : r.fire + Math.min(0.1, r.dur / 20);
        const x0 = tx(r.start + r.fire), x1 = Math.max(x0 + 2, tx(r.start + Math.min(end, Math.max(r.fire, local(r)))));
        if (local(r) >= r.fire) {
          ctx.fillStyle = c.tint;
          ctx.fillRect(x0, b.y0, x1 - x0, b.y1 - b.y0);
          if (l === 0) mark = x0;
        }
      }
      for (let i = b0; i < b1; i++) {
        const x0 = tx(r.start + i * r.bw), x1 = tx(r.start + (i + 1) * r.bw);
        const w = Math.max(1, x1 - x0 - (x1 - x0 > 3 ? 1 : 0));
        const al = r.r.series[l].allowed[i] / r.bw, dn = r.r.series[l].denied[i] / r.bw;
        const ya = Math.max(b.y0, ry(al, b)), yd = Math.max(b.y0, ry(al + dn, b));
        ctx.fillStyle = c.live;
        ctx.fillRect(x0, ya, w, b.y1 - ya);
        if (dn) {
          ctx.fillStyle = c.danger;
          ctx.fillRect(x0, yd, w, ya - yd);
        }
      }
    }
    if (mark != null) {
      ctx.fillStyle = c.accent;
      ctx.font = font(9, 600);
      ctx.textAlign = "left";
      ctx.fillText("you", Math.min(mark + 2, G.sx1 - 22), b.y0 - 3);
    }
    ctx.restore();
    const ly = Math.round(ry(lim, b)) + 0.5;
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(G.sx0, ly); ctx.lineTo(G.sx1, ly); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = font(9);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = c.text;
    ctx.fillText(`${fmt(lim)}`, G.sx1 + 4, ly);
    const top = nice(yMax);
    const tyy = ry(top, b);
    if (top > lim * 1.8 && ly - tyy > 18) {
      ctx.fillStyle = c.text3;
      ctx.fillText(`${fmt(top)}`, G.sx1 + 4, tyy);
      ctx.strokeStyle = c.line;
      ctx.beginPath(); ctx.moveTo(G.sx0, Math.round(tyy) + 0.5); ctx.lineTo(G.sx1, Math.round(tyy) + 0.5); ctx.stroke();
    }
    ctx.textBaseline = "alphabetic";
    if (!G.wide && l === 0) {
      ctx.fillStyle = c.text3;
      ctx.textAlign = "right";
      ctx.fillText("/s", G.W - 4, b.y0 + 6);
    }
  }

  // DOM: tiles, the you line, the canvas label and the receipt.
  function updateDom(force) {
    const t = performance.now();
    if (!force && t - lastDom < 200) return;
    lastDom = t;
    if (!runs.length) return;
    const run = cur();
    const nb = done(run);
    shown = { run, nb };
    const off = run.cumO[nb];
    cell.t.textContent = secs(local(run));
    cell.run.textContent = `${run.no} · seed ${run.p.seed}`;
    cell.offered.textContent = fmt(off);
    const kb = Math.min(nb, Math.max(1, Math.round(1 / run.bw)));
    cell.ops.textContent = nb ? `${fmt(Math.round((run.cumO[nb] - run.cumO[nb - kb]) / (kb * run.bw)))} /s` : "–";
    const parts = [];
    run.algos.forEach((a, l) => {
      const v = run.cumA[l][nb];
      if (cell[a]) cell[a].textContent = `${fmt(v)} · ${pct(v, off)}`;
      parts.push(`${NAMES[a] || a} allowed ${fmt(v)}, denied ${fmt(run.cumD[l][nb])}`);
    });
    cell.emit.textContent = `${fmt(run.r.emissionUs / 1000)} ms`;
    canvas.setAttribute("aria-label", `Traffic floor at ${secs(local(run))} of run ${run.no}: ${fmt(off)} requests offered; ${parts.join("; ")}.`);
    syncYou(run, nb);
    receipt.textContent = `ratelimitd's Step functions made ${plural(decisions, "decision")} across ${plural(calls, "race")}, in ${fmt(Math.round(callMs))} ms.`;
  }

  let youKey = "";
  let shown = null;
  function syncYou(run, nb) {
    const f = FIRE[run.p.pattern];
    const tl = local(run);
    let text, tick = "";
    if (!f) text = `${run.p.pattern} traffic has nothing to fire: switch to burst or attack.`;
    else if (run.fire != null) {
      const att = run.p.pattern === "attack";
      text = att
        ? `You launched the attack at ${secs(run.fire)}: a flood until ${secs(2 * run.fire)}, then calm until the run ends at ${secs(run.dur)}.`
        : `You fired a burst at ${secs(run.fire)}; burst traffic repeats it at ${[3, 5, 7].map((m) => secs(m * run.fire)).join(", ")}, and the run ends at ${secs(run.dur)}.`;
      if (tl >= run.fire) {
        let b0 = Math.floor(run.fire / run.bw + 1e-9), b1 = b0;
        while (b1 < nb && yours(run, b1)) b1++;
        if (b1 > b0) tick = ` Yours so far: ${run.algos.map((a, l) => `${NAMES[a] || a} ${fmt(run.cumD[l][b1] - run.cumD[l][b0])} denied`).join(" · ")}.`;
      }
    } else {
      const at = run.dur / f;
      const what = run.p.pattern === "attack" ? "The attack starts by itself" : "The first burst comes by itself";
      text = tl < at
        ? `${what} at ${secs(at)}. ${run.p.pattern === "attack" ? "Launch it sooner and it lasts as long as the calm before it." : "Fire one sooner and burst traffic repeats it at 3×, 5× and 7× your time."}`
        : `${what === "The attack starts by itself" ? "The attack started by itself" : "The first burst came by itself"} at ${secs(at)}. Fire your own in the next run.`;
    }
    if (text !== youKey) {
      youKey = text;
      youLine.textContent = text;
      youLine.append(youTick);
    }
    youTick.textContent = tick;
    fire.textContent = run.p.pattern === "attack" ? "Launch the attack" : "Fire a burst";
    fire.disabled = !canFire(run);
  }

  const fireMs = (c) => Math.ceil(local(c) * 1000 - 1e-6);
  function canFire(run) {
    const f = FIRE[run.p.pattern];
    if (!f || run.fire != null || run.pending) return false;
    const tm = fireMs(run);
    return tm * f >= 1000 && tm * f < run.p.durationMs;
  }

  function describe(run, verb) {
    status.textContent = `${verb} run ${run.no}: ${run.p.pattern} traffic (${SHAPES[run.p.pattern]}), limit ${fmt(run.p.rate)} /s, burst ${fmt(run.p.burst)}, seed ${run.p.seed}; ${secs(run.dur, 0)} in ${fmt(run.B)} slices of ${(run.bw * 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} ms.`;
  }

  // Runs.
  async function newRun(at, verb = "Started") {
    const g = ++gen;
    next = null;
    const r = await race(params(seed));
    if (g !== gen) return;
    r.start = at;
    r.no = ++runNo;
    r.fire = null;
    runs = runs.filter((x) => x.start + x.dur > at - WIN_S - APPROACH_S && x.start < at);
    for (const x of runs) x.dur = Math.min(x.dur, at - x.start);
    runs.push(r);
    describe(r, verb);
  }

  function prefetch() {
    const run = cur();
    if (run !== runs[runs.length - 1] || next || run.pending) return;
    if (now < run.start + run.dur - APPROACH_S - 2) return;
    const g = gen;
    const s = seed + 1;
    next = race(params(s)).then((r) => {
      if (g !== gen) return null;
      r.seed = s;
      return r;
    }).catch((err) => { next = null; fail(err); return null; });
  }

  async function roll() {
    const run = runs[runs.length - 1];
    if (now < run.start + run.dur || rolling) return;
    rolling = true;
    try {
      const g = gen;
      if (!next) prefetch();
      const r = await next;
      if (!r || g !== gen) return;
      next = null;
      seed = r.seed;
      r.start = run.start + run.dur;
      r.no = ++runNo;
      r.fire = null;
      runs = runs.filter((x) => x.start + x.dur > now - WIN_S - APPROACH_S);
      runs.push(r);
      describe(r, "Started");
    } finally {
      rolling = false;
    }
  }
  let rolling = false;

  // Re-run the current run under new knobs (same seed and clock), or with the
  // visitor's own fire time. Earlier runs keep what they answered.
  async function rerun(c, durationMs, fireAt) {
    const g = gen;
    c.pending = true;
    next = null;
    try {
      const r = await race({ ...params(c.p.seed, durationMs), pattern: c.p.pattern });
      if (g !== gen || !runs.includes(c)) return;
      Object.assign(r, { start: c.start, no: c.no, fire: fireAt === undefined ? c.fire : fireAt });
      runs[runs.indexOf(c)] = r;
      return r;
    } finally {
      c.pending = false;
    }
  }

  const fail = (err) => { status.textContent = err.message; };

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && runs.length) {
      const end = runs[runs.length - 1];
      now = Math.min(now + (dt / 1000) * Number(speed.value), end.start + end.dur + (next ? 0.25 : 0));
      prefetch();
      if (now >= end.start + end.dur) roll().catch(fail);
    }
    updateDom(false);
    draw();
    if (playing && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  const redraw = () => { updateDom(true); draw(); };

  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) kick();
  }

  async function restart(warm) {
    await newRun(now);
    const run = runs[runs.length - 1];
    if (warm || reduce.matches) now = run.start + Math.min(run.dur, reduce.matches ? STILL_S : WARM_S);
    yMax = 0;
    redraw();
  }

  // Inputs.
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", async () => {
    setPlaying(false);
    try {
      for (let s = 0; s < 1; s += 0.25) {
        const end = runs[runs.length - 1];
        if (now + 0.25 > end.start + end.dur) { prefetch(); await roll(); }
        now = Math.min(now + 0.25, runs[runs.length - 1].start + runs[runs.length - 1].dur);
      }
      redraw();
    } catch (err) { fail(err); }
  });
  reset.addEventListener("click", () => { seed = 1; restart(false).then(kick).catch(fail); });
  pattern.addEventListener("change", () => restart(false).then(kick).catch(fail));
  let knobT = 0;
  for (const k of [rate, burst]) k.i.addEventListener("input", () => {
    k.sync();
    clearTimeout(knobT);
    knobT = setTimeout(() => {
      const c = cur();
      rerun(c, c.p.durationMs).then((r) => { if (r) { describe(r, "Re-ran"); redraw(); kick(); } }).catch(fail);
    }, 120);
  });
  speed.addEventListener("change", redraw);
  fire.addEventListener("click", async () => {
    const c = cur();
    if (!canFire(c)) return;
    const f = FIRE[c.p.pattern];
    const tm = fireMs(c);
    fire.disabled = true;
    try {
      const r = await rerun(c, f * tm, tm / 1000);
      if (!r) return;
      status.textContent = `Re-ran run ${r.no} as ${secs(r.p.durationMs / 1000, 3)} of ${r.p.pattern} traffic, so it hits at ${secs(r.fire)}: the requests and verdicts before then are the same.`;
      if (reduce.matches) now = r.start + Math.min(r.dur, c.p.pattern === "attack" ? 2 * r.fire : r.fire + 1);
      redraw();
      kick();
    } catch (err) { fail(err); }
  });

  new ResizeObserver(() => { if (!root.isConnected) return; layout(); readColors(); draw(); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const retheme = () => { readColors(); draw(); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);
  window.addEventListener("themechange", retheme);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  readColors();
  layout();
  await restart(true);
  setPlaying(playing);
}
