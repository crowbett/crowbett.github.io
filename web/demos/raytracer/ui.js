// raytracer demo: the real C++ path tracer, compiled to WebAssembly. Each call
// traces one more sample per pixel for a band of rows and returns that band of
// the running mean; the page renders the same rows with two sampling strategies,
// so both halves of the split always have equal samples per pixel. Every call
// also returns the image's noise estimate, which the chart plots as it falls.
// You can pour extra samples into any band of rows and watch it clear.
const SCENES = [
  ["cornell", "Cornell box"],
  ["smoke", "Cornell box, smoke volumes"],
  ["light", "Marble under two small lights"],
  ["final3", "Cornell box, glass sphere"],
  ["cover", "Book 1 cover (sky-lit)"],
  ["bouncing", "Motion blur (sky-lit)"],
];
const STRATEGY = {
  material: "material only",
  nee: "NEE + MIS",
  mixture: "light/material mixture",
};
const WIDTHS = [200, 300, 400];
const TARGET_MS = 24; // per call; the bridge caps a call at max_pixels_per_call
const MAX_SPP = 1024;
const REDUCED_SPP = 8; // with reduced motion: one finished state, no autoplay
const METER_MS = 2000;
const FOCUS_SPP = 32; // one focus adds this many samples to every pixel in its rows
const FOCUS_ROWS = 0.12; // of the image height
const MAX_QUEUE = 3;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const sig = (x) => (Number.isFinite(x) ? x.toPrecision(3) : "–");
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const msLabel = (ms) => (ms >= 1000 ? `${+(ms / 1000).toPrecision(3)} s` : `${+ms.toPrecision(3)} ms`);

function field(label, input) {
  const wrap = el("label", "demo-field rt-field");
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function select(name, options, value) {
  const s = el("select");
  s.name = name;
  for (const [v, t] of options) {
    const o = el("option", null, t);
    o.value = String(v);
    s.append(o);
  }
  s.value = String(value);
  return s;
}

function cell(key, side) {
  const li = el("li");
  if (side) li.dataset.side = side;
  const k = el("span", "rt-k", key);
  const v = el("span", "rt-v", "–");
  li.append(k, v);
  return [li, v, k];
}

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

function rgba(b64) {
  const s = atob(b64);
  const out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// 1, 2 and 5 times powers of ten inside [lo, hi].
function ticks125(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
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
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Controls: the run, your action, then the knobs.
  const form = el("form", "rt-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const acts = el("div", "rt-acts");
  const play = button(reduced ? "Render" : "Pause", "rt-play");
  const step = button("One more pass", "secondary rt-step");
  const restartBtn = button("Restart", "secondary rt-restart");
  const youBtn = button(`Focus +${FOCUS_SPP} spp`, "secondary rt-you-btn");
  acts.append(play, step, restartBtn, youBtn);
  const knobs = el("div", "rt-knobs");
  const scene = select("scene", SCENES, "cornell");
  const right = select("right", [["nee", "NEE + MIS"], ["mixture", "Mixture (book 3)"]], "nee");
  const width = select("width", WIDTHS.map((w) => [w, `${w} px wide`]), 300);
  knobs.append(field("scene", scene), field("right half", right), field("resolution", width));
  form.append(acts, knobs);

  // The screen: the split image, the samples-per-row bar beside it, the pass bar.
  const wrap = el("div", "rt");
  const screen = el("figure", "rt-screen");
  const tags = el("div", "rt-tags");
  const tagL = el("span", "rt-tag rt-tag-l");
  const tagR = el("span", "rt-tag rt-tag-r");
  const nameL = el("b", null, STRATEGY.material);
  const nameR = el("b");
  const errL = el("span", "rt-err");
  const errR = el("span", "rt-err");
  tagL.append(nameL, errL);
  tagR.append(nameR, errR);
  tags.append(tagL, tagR);

  const stage = el("div", "rt-stage");
  const view = el("div", "rt-view");
  const canvasR = el("canvas", "rt-canvas");
  const canvasL = el("canvas", "rt-canvas rt-canvas-l");
  canvasR.setAttribute("aria-hidden", "true");
  canvasL.setAttribute("aria-hidden", "true");
  const ctxR = canvasR.getContext("2d");
  const ctxL = canvasL.getContext("2d");
  const scan = el("div", "rt-scan");
  const focusBox = el("div", "rt-focus");
  const divider = el("div", "rt-split");
  const grip = el("div", "rt-grip");
  grip.tabIndex = 0;
  grip.setAttribute("role", "slider");
  grip.setAttribute("aria-label", "Split between material-only and light sampling");
  grip.setAttribute("aria-valuemin", "0");
  grip.setAttribute("aria-valuemax", "100");
  divider.append(grip);
  view.append(canvasR, canvasL, scan, focusBox, divider);
  const strip = el("div", "rt-rows");
  const stripCanvas = el("canvas");
  strip.append(stripCanvas);
  strip.tabIndex = 0;
  strip.setAttribute("role", "slider");
  strip.setAttribute("aria-label", "Rows to focus samples on");
  strip.setAttribute("aria-valuemin", "0");
  stage.append(view, strip);

  const foot = el("figcaption", "rt-foot");
  const passLabel = el("span", "rt-pass-n");
  const pass = el("span", "rt-pass");
  const passFill = el("i");
  pass.append(passFill);
  const hint = el("span", "rt-hint");
  foot.append(passLabel, pass, hint);
  screen.append(tags, stage, foot);

  const you = el("p", "rt-you");
  you.setAttribute("aria-live", "polite");

  const plotBox = el("div", "rt-plot");
  const plotHead = el("div", "rt-plot-head");
  const plotTitle = el("span", "rt-plot-title");
  const seg = el("div", "rt-seg");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Plot noise against");
  const bySpp = button("per spp", "secondary");
  const byTimeBtn = button("per second", "secondary");
  seg.append(bySpp, byTimeBtn);
  plotHead.append(plotTitle, seg);
  const chart = el("canvas", "rt-chart");
  chart.setAttribute("role", "img");
  plotBox.append(plotHead, chart);
  let byTime = false;
  const setAxis = (t) => {
    byTime = t;
    bySpp.setAttribute("aria-pressed", String(!t));
    byTimeBtn.setAttribute("aria-pressed", String(t));
    plotTitle.textContent = `est. RMSE against ${t ? "each half's render time" : "samples per pixel"}, log-log`;
    drawChart();
  };
  const legend = el("ul", "demo-legend rt-legend");
  const keyL = el("li", "rt-key", STRATEGY.material);
  keyL.dataset.kind = "l";
  keyL.dataset.side = "l";
  const keyR = el("li", "rt-key");
  keyR.dataset.kind = "r";
  const keyLaw = el("li", "rt-key", "1/√n from the first point");
  keyLaw.dataset.kind = "law";
  const keyYou = el("li", "rt-key", "you focused");
  keyYou.dataset.kind = "you";
  legend.append(keyL, keyR, keyLaw, keyYou);

  const cells = el("ul", "cells stack rt-cells");
  const [sppCell, spp, sppK] = cell("spp, each half");
  const [meanCell, meanSpp] = cell("mean spp");
  const [errCellL, errLv] = cell(`est. RMSE, ${STRATEGY.material}`, "l");
  const [errCellR, errRv, errRk] = cell("est. RMSE");
  const [ratioCell, ratio] = cell("noise, left ÷ right", "l");
  const [costCell, cost, costK] = cell("ms per pass");
  const [rateCell, rate] = cell("samples/s");
  const [timeCell, elapsed] = cell("render time");
  sppCell.dataset.k = "spp";
  ratioCell.dataset.k = "ratio";
  cells.append(sppCell, meanCell, errCellL, errCellR, ratioCell, costCell, rateCell, timeCell);

  const status = el("p", "rt-status");
  status.setAttribute("aria-live", "polite");
  const sceneInfo = el("p", "rt-info");
  const explain = el("dl", "rt-explain");
  const exL = el("div");
  exL.dataset.side = "l";
  exL.append(el("dt", null, STRATEGY.material),
    el("dd", null, "Each bounce follows the surface's own scattering. Light counts only when a path happens to hit a lamp."));
  const exR = el("div");
  const exRName = el("dt");
  const exRText = el("dd");
  exR.append(exRName, exRText);
  const exN = el("div");
  exN.append(el("dt", null, "est. RMSE"),
    el("dd", null, "Error against the converged image, estimated by the renderer from each pixel's own sample variance (linear RGB), not measured against a reference. Rare bright paths not yet sampled are missing from it."));
  explain.append(exL, exR, exN);
  const receipt = el("p", "demo-out rt-out");

  wrap.append(form, screen, you, plotBox, legend, cells, status, sceneInfo, explain, receipt);
  root.replaceChildren(wrap);

  let info = null; // the binary's load result
  let lit = true; // the scene has lights to sample, so the split compares something
  let gen = 0;
  let running = false; // the visitor wants it sampling
  let warming = false; // the first passes after a load render even off screen
  let looping = false;
  let stopAt = 0; // pause once this many passes are complete (0: run to MAX_SPP)
  let loop = Promise.resolve();
  let y = 0;
  let rows = 8;
  let passes = 0;
  let renderMs = 0;
  let calls = 0;
  let meter = [];
  let last = {};
  let used = {}; // per strategy: ms of its calls and its samples, as the binary counts them
  let pts = {}; // per strategy: { x: mean spp, t: ms, e: est. RMSE }
  let marks = []; // where you focused, in both chart coordinates
  let rowSpp = new Int32Array(0);
  let rowYou = new Int32Array(0);
  let queue = [];
  let aim = 0;
  let split = 0.5;
  let failure = null;
  let visible = true;
  let colors = null;
  let sceneLabel = "";

  const strategies = () => (lit ? ["material", right.value] : ["nee"]);
  const rightName = () => (lit ? STRATEGY[right.value] : STRATEGY.nee);
  const rightKey = () => strategies().at(-1);
  const away = () => document.hidden || !visible;
  const band = () => Math.max(4, Math.round((info.height * FOCUS_ROWS) / 2));
  const say = (msg) => { status.textContent = msg; };

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"), text3: v("--text-3"),
      accent: v("--accent"), signal: v("--signal"), mono: v("--mono") || "monospace",
    };
  }
  const seriesColor = (s) => (s === "material" ? colors.text3 : colors.signal);

  function fitCanvas(c, w, h) {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (c.width !== pw || c.height !== ph) Object.assign(c, { width: pw, height: ph });
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  // The samples-per-row bar: the regular passes in grey, your focus on top in accent.
  function drawRows() {
    if (!colors || !info) return;
    const w = strip.clientWidth, h = strip.clientHeight;
    if (!w || !h) return;
    const g = fitCanvas(stripCanvas, w, h);
    g.clearRect(0, 0, w, h);
    let max = 1;
    for (const v of rowSpp) max = Math.max(max, v);
    const span = w - 8;
    const H = info.height;
    for (let py = 0; py < h; py++) {
      const r = Math.min(H - 1, Math.floor((py * H) / h));
      const all = (rowSpp[r] / max) * span, mine = (rowYou[r] / max) * span;
      g.fillStyle = colors.text3;
      g.globalAlpha = 0.4;
      g.fillRect(8, py, all - mine, 1);
      g.globalAlpha = 1;
      if (mine > 0) {
        g.fillStyle = colors.accent;
        g.fillRect(8 + all - mine, py, mine, 1);
      }
    }
    const sy = Math.round((y / H) * h);
    g.fillStyle = colors.signal;
    g.fillRect(8, Math.min(h - 2, sy), span, 2);
    const ay = ((aim + 0.5) / H) * h;
    g.fillStyle = colors.accent;
    g.beginPath();
    g.moveTo(0, ay - 5);
    g.lineTo(6, ay);
    g.lineTo(0, ay + 5);
    g.fill();
    if (document.activeElement === strip) {
      const b = band();
      g.strokeStyle = colors.accent;
      g.setLineDash([3, 2]);
      g.strokeRect(8.5, ((aim - b) / H) * h + 0.5, span - 1, ((2 * b) / H) * h - 1);
      g.setLineDash([]);
    }
  }

  // The noise chart: est. RMSE against mean samples per pixel or render time, log-log.
  function drawChart() {
    if (!colors) return;
    const W = chart.clientWidth, H = chart.clientHeight;
    if (!W || !H) return;
    const g = fitCanvas(chart, W, H);
    const c = colors;
    const font = (px, wt = 400) => `${wt} ${px}px ${c.mono}`;
    g.fillStyle = c.bg;
    g.fillRect(0, 0, W, H);
    const X = (p) => (byTime ? p.t : p.x);
    const L = 50, R = 16, T = 12, B = 30;
    const ss = strategies().filter((s) => pts[s]?.length);
    const all = ss.flatMap((s) => pts[s]);
    if (!all.length) {
      g.font = font(11);
      g.fillStyle = c.text2;
      g.textAlign = "center";
      g.fillText("the noise estimate starts at 2 spp", W / 2, H / 2);
      return;
    }
    let x0 = Infinity, x1 = 0, e0 = Infinity, e1 = 0;
    for (const p of all) {
      x0 = Math.min(x0, X(p)); x1 = Math.max(x1, X(p));
      e0 = Math.min(e0, p.e); e1 = Math.max(e1, p.e);
    }
    if (byTime) { x0 /= 1.5; x1 *= 1.5; } else { x0 = 1; x1 = 2 ** Math.ceil(Math.log2(Math.max(8, x1 * 1.08))); }
    e0 /= 1.3; e1 *= 1.3;
    if (e1 / e0 < 5) { const m = Math.sqrt(e0 * e1); e0 = m / Math.sqrt(5); e1 = m * Math.sqrt(5); }
    const px = (v) => L + (Math.log(v / x0) / Math.log(x1 / x0)) * (W - L - R);
    const py = (e) => H - B - (Math.log(e / e0) / Math.log(e1 / e0)) * (H - T - B);

    // Grid and axes.
    g.font = font(10);
    g.lineWidth = 1;
    g.strokeStyle = c.line;
    g.fillStyle = c.text3;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const e of ticks125(e0, e1)) {
      const yy = Math.round(py(e)) + 0.5;
      g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke();
      g.fillText(String(+e.toPrecision(2)), L - 6, yy);
    }
    g.textAlign = "center";
    g.textBaseline = "top";
    const xt = byTime ? ticks125(x0, x1) : Array.from({ length: Math.log2(x1) + 1 }, (_, i) => 2 ** i);
    const every = Math.ceil(xt.length / Math.max(2, Math.floor((W - L - R) / 46)));
    xt.forEach((v, i) => {
      const xx = Math.round(px(v)) + 0.5;
      g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, H - B); g.stroke();
      if (i % every === 0) g.fillText(byTime ? msLabel(v) : String(v), xx, H - B + 6);
    });
    g.strokeStyle = c.strong;
    g.beginPath(); g.moveTo(L + 0.5, T); g.lineTo(L + 0.5, H - B + 0.5); g.lineTo(W - R, H - B + 0.5); g.stroke();

    g.save();
    g.beginPath();
    g.rect(L, T, W - L - R, H - T - B);
    g.clip();
    // Your focus bursts: where on each curve they began.
    for (const m of marks) {
      for (const s of ss) {
        const v = byTime ? m.t[s] : m.x;
        if (!(v > 0)) continue;
        const xx = Math.round(px(v)) + 0.5;
        g.strokeStyle = c.accent;
        g.globalAlpha = 0.5;
        g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, H - B); g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
    }
    for (const s of ss) {
      const p = pts[s];
      const col = seriesColor(s);
      // The 1/√n law through the first point: halving the noise takes four times the samples.
      g.strokeStyle = col;
      g.globalAlpha = 0.7;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(px(X(p[0])), py(p[0].e));
      g.lineTo(px(x1), py(p[0].e * Math.sqrt(X(p[0]) / x1)));
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.beginPath();
      p.forEach((q, i) => (i ? g.lineTo(px(X(q)), py(q.e)) : g.moveTo(px(X(q)), py(q.e))));
      g.stroke();
      g.lineWidth = 1;
    }
    g.restore();
    // Your marks on the axis, then each curve's end with its value.
    g.fillStyle = c.accent;
    for (const m of marks) for (const s of ss) {
      const v = byTime ? m.t[s] : m.x;
      if (!(v >= x0 && v <= x1)) continue;
      const xx = px(v);
      g.beginPath(); g.moveTo(xx - 4, H - B); g.lineTo(xx + 4, H - B); g.lineTo(xx, H - B - 6); g.fill();
    }
    const ends = ss.map((s) => ({ s, q: pts[s].at(-1) })).sort((a, b) => a.q.e - b.q.e);
    g.font = font(11, 600);
    g.textBaseline = "middle";
    ends.forEach(({ s, q }, i) => {
      const xx = px(X(q)), yy = py(q.e);
      g.fillStyle = seriesColor(s);
      g.beginPath(); g.arc(xx, yy, 3.5, 0, 2 * Math.PI); g.fill();
      const text = sig(q.e);
      const tw = g.measureText(text).width;
      const left = xx + 8 + tw > W - 4;
      const tx = left ? xx - 8 - tw : xx + 8;
      const ty = Math.min(H - B - 8, Math.max(T + 6, yy + (ends.length > 1 ? (i === 0 ? 9 : -9) : 0)));
      g.fillStyle = c.bg;
      g.globalAlpha = 0.85;
      g.fillRect(tx - 3, ty - 8, tw + 6, 16);
      g.globalAlpha = 1;
      g.textAlign = "left";
      g.fillStyle = c.text;
      g.fillText(text, tx, ty);
    });
  }

  function setSplit(f) {
    split = Math.min(1, Math.max(0, f));
    const pct = Math.round(split * 1000) / 10;
    canvasL.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    divider.style.left = `${pct}%`;
    grip.setAttribute("aria-valuenow", String(Math.round(pct)));
    grip.setAttribute("aria-valuetext", `${Math.round(pct)}% ${STRATEGY.material}, ${Math.round(100 - pct)}% ${rightName()}`);
  }

  function setAim(row) {
    if (!info) return;
    aim = Math.min(info.height - 1, Math.max(0, Math.round(row)));
    const b = band();
    const y0 = Math.max(0, Math.min(info.height - 2 * b, aim - b));
    strip.setAttribute("aria-valuenow", String(aim));
    strip.setAttribute("aria-valuetext", `rows ${y0} to ${y0 + 2 * b - 1} of ${info.height}, ${rowSpp[aim]} spp`);
    drawRows();
  }

  let readoutQueued = false;
  function readouts() {
    readoutQueued = false;
    if (!info) return;
    const ss = strategies();
    const [a, b] = ss.map((s) => last[s]?.rmse_estimate ?? NaN);
    spp.textContent = fmt(passes);
    const r = last[rightKey()];
    meanSpp.textContent = r ? (r.samples / (info.width * info.height)).toFixed(1) : "–";
    const now = performance.now();
    meter = meter.filter(([t]) => now - t < METER_MS);
    if (meter.length > 1) {
      const n = meter.slice(1).reduce((s, [, k]) => s + k, 0);
      const span = (meter.at(-1)[0] - meter[0][0]) / 1000;
      if (span > 0) rate.textContent = `${fmt(Math.round(n / span / 1000))}k`;
    }
    const per = (s) => (used[s]?.samples ? (used[s].ms * info.width * info.height) / used[s].samples : NaN);
    cost.textContent = ss.map((s) => (Number.isFinite(per(s)) ? per(s).toFixed(1) : "–")).join(" / ");
    elapsed.textContent = secs(renderMs);
    const total = ss.reduce((n, s) => n + (last[s]?.samples ?? 0), 0);
    receipt.textContent = `${fmt(total)} camera samples traced by the renderer in ${fmt(calls)} calls, ${secs(renderMs)}, in your browser.`;
    if (lit) {
      errLv.textContent = sig(a);
      errRv.textContent = sig(b);
      errL.textContent = `est. RMSE ${sig(a)}`;
      errR.textContent = `est. RMSE ${sig(b)}`;
      const q = a / b;
      ratio.textContent = Number.isFinite(q) ? `${q.toFixed(2)}×` : "–";
    } else {
      errRv.textContent = sig(a);
      errR.textContent = `est. RMSE ${sig(a)}`;
    }
    passLabel.textContent = passes >= MAX_SPP ? `${fmt(MAX_SPP)} spp` : `pass ${fmt(passes + 1)}`;
    passFill.style.transform = `scaleX(${Math.max(0.001, y / info.height)})`;
    scan.style.transform = `translateY(${(y / info.height) * 100}%)`;
    drawRows();
    drawChart();
  }
  const queueReadouts = () => {
    if (!readoutQueued) {
      readoutQueued = true;
      requestAnimationFrame(readouts);
    }
  };

  function describeChart() {
    const ss = strategies();
    const parts = ss.map((s) => `${s === "material" ? STRATEGY.material : rightName()} ${sig(last[s]?.rmse_estimate)}`);
    chart.setAttribute("aria-label", `Estimated RMSE falling with samples per pixel: ${parts.join(", ")} at ${fmt(passes)} spp.`);
  }

  function milestone() {
    describeChart();
    if (passes < 2) return;
    if (running && !stopAt) {
      say(`${sceneLabel}: sampling, ${fmt(passes)} spp in each half so far.`);
      return;
    }
    say(`${sceneLabel}: ${fmt(passes)} spp, ${compare()}.`);
  }
  function compare() {
    const [a, b] = strategies().map((s) => last[s]?.rmse_estimate ?? NaN);
    return lit ? `est. RMSE ${sig(a)} with ${STRATEGY.material}, ${sig(b)} with ${rightName()} (${(a / b).toFixed(2)}× the noise)` : `est. RMSE ${sig(a)}`;
  }

  function setPlay() {
    const done = passes >= MAX_SPP;
    play.textContent = running ? "Pause" : done ? "Done" : passes > 0 && !reduced ? "Resume" : "Render";
    play.disabled = done || !info;
    step.disabled = running || done || !info;
    youBtn.disabled = !info || queue.length >= MAX_QUEUE;
    status.setAttribute("aria-live", running ? "off" : "polite");
  }

  // One more sample for rows [y0, y0 + n), with every strategy in turn.
  async function trace(g, y0, n) {
    const t0 = performance.now();
    for (const s of strategies()) {
      const c0 = performance.now();
      const r = await demo.call("render", { sampling: s, y0, rows: n });
      const ms = performance.now() - c0;
      if (g !== gen) return false;
      calls++;
      (s === "material" ? ctxL : ctxR).putImageData(new ImageData(rgba(r.rgba), info.width, r.rows), 0, r.y0);
      last[s] = r;
      used[s].ms += ms;
      used[s].samples = r.samples;
      const e = r.rmse_estimate;
      if (Number.isFinite(e)) {
        const p = { x: r.samples / (info.width * info.height), t: used[s].ms, e };
        const list = pts[s];
        if (list.length > 1 && p.x < list.at(-1).x * 1.015 && p.x < list.at(-2).x * 1.03) list[list.length - 1] = p;
        else list.push(p);
      }
    }
    for (let i = y0; i < y0 + n; i++) rowSpp[i]++;
    passes = last[strategies()[0]].spp;
    const now = performance.now();
    renderMs += now - t0;
    meter.push([now, n * info.width * strategies().length]);
    return true;
  }

  async function scanStep(g) {
    const cap = Math.floor(info.max_pixels_per_call / info.width);
    const n = Math.min(rows, info.height - y, cap);
    const t0 = performance.now();
    if (!(await trace(g, y, n))) return false;
    const ideal = (n * TARGET_MS * strategies().length) / Math.max(performance.now() - t0, 0.5);
    rows = Math.max(1, Math.min(Math.round((rows + ideal) / 2), cap));
    y += n;
    if (y >= info.height) {
      y = 0;
      milestone();
      readouts();
    } else {
      queueReadouts();
    }
    return true;
  }

  async function focusStep(g) {
    const f = queue[0];
    const cap = Math.floor(info.max_pixels_per_call / info.width);
    const n = Math.min(cap, f.y1 - f.at);
    if (!(await trace(g, f.at, n))) return false;
    for (let i = f.at; i < f.at + n; i++) rowYou[i]++;
    f.at += n;
    if (f.at >= f.y1) {
      f.at = f.y0;
      f.left--;
    }
    if (f.left === 0) {
      queue.shift();
      const after = last[rightKey()].rmse_estimate;
      const mid = (f.y0 + f.y1) >> 1;
      you.replaceChildren(el("span", "rt-you-tick", "you "),
        `+${FOCUS_SPP} spp on rows ${f.y0}–${f.y1 - 1}, now ${fmt(rowSpp[mid])} spp there and ${fmt(passes)} elsewhere. ` +
        `${rightName()} est. RMSE over the whole image: ${sig(f.before)} → ${sig(after)}.`);
      if (queue.length) showFocus(queue[0]);
      else focusBox.classList.remove("is-on");
      setPlay();
    }
    queueReadouts();
    return true;
  }

  async function run(g) {
    try {
      while (g === gen && root.isConnected) {
        if (queue.length) {
          if (!(await focusStep(g))) return;
          continue;
        }
        if (!running || (away() && !warming)) break;
        if (!(await scanStep(g))) return;
        if (y === 0 && (passes >= MAX_SPP || (stopAt && passes >= stopAt))) {
          running = false;
          if (passes >= MAX_SPP) say(`${fmt(MAX_SPP)} spp reached; rendering stopped.`);
        }
      }
    } catch (err) {
      if (g !== gen) return;
      running = false;
      queue = [];
      focusBox.classList.remove("is-on");
      failure = err;
      say(err.message);
    } finally {
      if (g === gen) {
        looping = false;
        setPlay();
        readouts();
      }
    }
  }

  function kick() {
    if (looping || !info || !root.isConnected) return;
    looping = true;
    loop = run(gen);
  }

  const start = (until) => {
    if (running || passes >= MAX_SPP || !info) return;
    running = true;
    stopAt = until;
    setPlay();
    kick();
  };

  function showFocus(f) {
    focusBox.style.top = `${(f.y0 / info.height) * 100}%`;
    focusBox.style.height = `${((f.y1 - f.y0) / info.height) * 100}%`;
    focusBox.classList.add("is-on");
  }

  // Your input: FOCUS_SPP more samples for every pixel in a band of rows, both halves.
  function pour(row) {
    if (!info) return;
    if (queue.length >= MAX_QUEUE) {
      say("Three focus bursts are already queued; wait for one to finish.");
      return;
    }
    setAim(row);
    const b = band();
    const y0 = Math.max(0, Math.min(info.height - 2 * b, aim - b));
    const f = { y0, y1: y0 + 2 * b, at: y0, left: FOCUS_SPP, before: last[rightKey()]?.rmse_estimate ?? NaN };
    queue.push(f);
    const r = last[rightKey()];
    marks.push({ x: r ? r.samples / (info.width * info.height) : 1, t: Object.fromEntries(strategies().map((s) => [s, used[s].ms])) });
    if (queue.length === 1) showFocus(f);
    you.replaceChildren(el("span", "rt-you-tick", "you "), `pouring +${FOCUS_SPP} spp into rows ${f.y0}–${f.y1 - 1}…`);
    setPlay();
    kick();
  }

  async function restart(autoplay, rethrow) {
    const g = ++gen;
    running = false;
    queue = [];
    focusBox.classList.remove("is-on");
    play.disabled = step.disabled = youBtn.disabled = true;
    await loop;
    if (g !== gen) return;
    looping = false;
    const w = Number(width.value);
    try {
      info = await demo.call("load", { scene: scene.value, width: w, seed: 1 });
    } catch (err) {
      if (rethrow) throw err;
      say(err.message);
      return;
    }
    if (g !== gen) return;
    lit = info.lights > 0;
    wrap.dataset.split = lit ? "on" : "off";
    right.disabled = !lit;
    const blank = new ImageData(info.width, info.height);
    for (let i = 3; i < blank.data.length; i += 4) blank.data[i] = 255;
    for (const [c, g2] of [[canvasL, ctxL], [canvasR, ctxR]]) {
      c.width = info.width;
      c.height = info.height;
      g2.putImageData(blank, 0, 0);
    }
    view.style.setProperty("--rt-ar", `${info.width} / ${info.height}`);
    y = 0;
    passes = 0;
    renderMs = 0;
    calls = 0;
    meter = [];
    failure = null;
    last = {};
    used = { material: { ms: 0, samples: 0 }, nee: { ms: 0, samples: 0 }, mixture: { ms: 0, samples: 0 } };
    pts = { material: [], nee: [], mixture: [] };
    marks = [];
    rowSpp = new Int32Array(info.height);
    rowYou = new Int32Array(info.height);
    you.replaceChildren();
    strip.setAttribute("aria-valuemax", String(info.height - 1));
    setAim(info.height * 0.2);
    nameR.textContent = rightName();
    keyR.textContent = rightName();
    errRk.textContent = `est. RMSE, ${rightName()}`;
    costK.textContent = lit ? "ms per pass, left / right" : "ms per pass";
    sppK.textContent = lit ? "spp, each half" : "spp";
    exRName.textContent = rightName();
    exRText.textContent = !lit
      ? "This scene is lit by the sky, which is never light-sampled, so both strategies trace the same paths: one image, the renderer's default integrator, Russian roulette included."
      : right.value === "nee"
        ? "Each bounce also casts a shadow ray at a point on a light; MIS (power heuristic) weighs it against the bounce, and Russian roulette ends dim paths. The renderer's default."
        : "Half of all bounces aim at the lights, half follow the material, each weighted by the two densities combined (book 3).";
    hint.textContent = lit ? "tap: focus · drag: divider" : "tap: focus";
    const label = (sceneLabel = SCENES.find(([id]) => id === info.scene)[1]);
    sceneInfo.textContent = `${label}: ${info.width} × ${info.height} px, ${fmt(info.objects)} top-level objects, ` +
      `${fmt(info.lights)} sampled light${info.lights === 1 ? "" : "s"}, SAH BVH of ${fmt(info.bvh_nodes)} nodes (depth ${info.bvh_depth}), ` +
      `up to ${info.max_depth} bounces, seed 1.`;
    setSplit(split);
    // The first passes always render, so every choice shows real output and a noise estimate at once.
    running = true;
    warming = true;
    stopAt = reduced ? REDUCED_SPP : 2;
    setPlay();
    kick();
    await loop;
    warming = false;
    if (g !== gen) return;
    if (rethrow && failure) throw failure;
    readouts();
    describeChart();
    say(`${label}: ${fmt(passes)} spp in each half, in your browser.${reduced ? " Press Render to keep sampling." : ""}`);
    if (autoplay) start(0);
  }

  play.addEventListener("click", () => {
    if (running) {
      running = false;
      setPlay();
      loop.then(() => { if (!running) say(`Paused at ${fmt(passes)} spp: ${compare()}.`); });
    } else {
      start(0);
    }
  });
  step.addEventListener("click", () => start(passes + 1));
  restartBtn.addEventListener("click", () => restart(!reduced, false));
  youBtn.addEventListener("click", () => pour(aim));
  for (const s of [scene, right, width]) s.addEventListener("change", () => restart(!reduced, false));
  bySpp.addEventListener("click", () => setAxis(false));
  byTimeBtn.addEventListener("click", () => setAxis(true));
  setAxis(false);

  // On the image: drag near the divider to move it, tap anywhere else to focus there.
  const near = (e) => {
    if (!lit) return false;
    const r = view.getBoundingClientRect();
    return Math.abs(e.clientX - (r.left + split * r.width)) <= 22;
  };
  const rowAt = (e, box) => {
    const r = box.getBoundingClientRect();
    return ((e.clientY - r.top) / r.height) * (info ? info.height : 0);
  };
  let dragging = null;
  let dragged = false;
  view.addEventListener("pointerdown", (e) => {
    dragged = false;
    if (e.button > 0 || !near(e)) return;
    dragging = e.pointerId;
    dragged = true;
    view.setPointerCapture(e.pointerId);
    const r = view.getBoundingClientRect();
    setSplit((e.clientX - r.left) / r.width);
    grip.focus({ preventScroll: true });
  });
  view.addEventListener("pointermove", (e) => {
    if (e.pointerId === dragging) {
      const r = view.getBoundingClientRect();
      setSplit((e.clientX - r.left) / r.width);
    } else {
      view.classList.toggle("rt-near", near(e));
    }
  });
  const end = (e) => { if (e.pointerId === dragging) dragging = null; };
  view.addEventListener("pointerup", end);
  view.addEventListener("pointercancel", end);
  view.addEventListener("click", (e) => {
    if (dragged || !info) return;
    pour(rowAt(e, view));
  });
  strip.addEventListener("click", (e) => { if (info) pour(rowAt(e, strip)); });
  grip.addEventListener("keydown", (e) => {
    const steps = { ArrowLeft: -0.02, ArrowDown: -0.02, ArrowRight: 0.02, ArrowUp: 0.02, PageDown: -0.1, PageUp: 0.1 };
    if (e.key in steps) setSplit(split + steps[e.key]);
    else if (e.key === "Home") setSplit(0);
    else if (e.key === "End") setSplit(1);
    else return;
    e.preventDefault();
  });
  strip.addEventListener("keydown", (e) => {
    if (!info) return;
    const H = info.height;
    const steps = { ArrowUp: -0.04, ArrowLeft: -0.04, ArrowDown: 0.04, ArrowRight: 0.04, PageUp: -0.15, PageDown: 0.15 };
    if (e.key in steps) setAim(aim + steps[e.key] * H);
    else if (e.key === "Home") setAim(0);
    else if (e.key === "End") setAim(H - 1);
    else if (e.key === "Enter" || e.key === " ") pour(aim);
    else return;
    e.preventDefault();
  });
  strip.addEventListener("focus", drawRows);
  strip.addEventListener("blur", drawRows);

  // A hidden tab or a demo scrolled out of view stops sampling; it picks up again when back.
  const onVisibility = () => {
    if (!root.isConnected) {
      document.removeEventListener("visibilitychange", onVisibility);
      return;
    }
    kick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(view);
  const redraw = () => { if (root.isConnected) { readColors(); drawRows(); drawChart(); } };
  new ResizeObserver(redraw).observe(chart);
  new ResizeObserver(redraw).observe(strip);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  window.addEventListener("themechange", redraw);

  await cssReady;
  readColors();
  await restart(!reduced, true);
}
