// raytracer demo: the real C++ path tracer, compiled to WebAssembly. Each call
// traces one more sample per pixel for a band of rows and returns that band of
// the running mean; the page renders the same rows with two sampling strategies,
// so both halves of the split always have equal samples per pixel.
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
const METER_MS = 2000;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const sig = (x) => (Number.isFinite(x) ? x.toPrecision(3) : "–");

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

function cell(key) {
  const li = el("li");
  const v = el("span", "rt-v", "–");
  li.append(el("span", "rt-k", key), v);
  return [li, v];
}

function rgba(b64) {
  const s = atob(b64);
  const out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
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

  const form = el("form", "rt-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const play = el("button", "rt-play", reduced ? "Render" : "Pause");
  play.type = "button";
  const step = el("button", "secondary", "One more sample");
  step.type = "button";
  const scene = select("scene", SCENES, "cornell");
  const right = select("right", [["nee", "NEE + MIS"], ["mixture", "Mixture (book 3)"]], "nee");
  const width = select("width", WIDTHS.map((w) => [w, `${w} px wide`]), 300);
  form.append(play, step, field("Scene", scene), field("Right half", right), field("Resolution", width));

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

  const view = el("div", "rt-view");
  const canvasR = el("canvas", "rt-canvas");
  const canvasL = el("canvas", "rt-canvas rt-canvas-l");
  canvasR.setAttribute("aria-hidden", "true");
  canvasL.setAttribute("aria-hidden", "true");
  const ctxR = canvasR.getContext("2d");
  const ctxL = canvasL.getContext("2d");
  const scan = el("div", "rt-scan");
  const divider = el("div", "rt-split");
  const grip = el("div", "rt-grip");
  grip.tabIndex = 0;
  grip.setAttribute("role", "slider");
  grip.setAttribute("aria-label", "Split between material-only and light sampling");
  grip.setAttribute("aria-valuemin", "0");
  grip.setAttribute("aria-valuemax", "100");
  divider.append(grip);
  view.append(canvasR, canvasL, scan, divider);

  const foot = el("figcaption", "rt-foot");
  const passLabel = el("span", "rt-pass-n");
  const pass = el("span", "rt-pass");
  const passFill = el("i");
  pass.append(passFill);
  const hint = el("span", "rt-hint");
  foot.append(passLabel, pass, hint);
  screen.append(tags, view, foot);

  const side = el("div", "rt-side");
  const cells = el("ul", "cells rt-cells");
  const [sppCell, spp] = cell("spp, each half");
  const [rateCell, rate] = cell("samples/s, your browser");
  const [errCellL, errLv] = cell("est. RMSE, left");
  const [errCellR, errRv] = cell("est. RMSE, right");
  const [ratioCell, ratio] = cell("noise, left ÷ right");
  const [timeCell, elapsed] = cell("render time");
  cells.append(sppCell, rateCell, errCellL, errCellR, ratioCell, timeCell);
  const sceneInfo = el("p", "rt-info");
  const status = el("p", "rt-status");
  status.setAttribute("aria-live", "polite");
  const legend = el("dl", "rt-legend");
  const keyL = el("div", "rt-key rt-key-l");
  keyL.append(el("dt", null, STRATEGY.material),
    el("dd", null, "Each bounce follows the surface's own scattering distribution. Light counts only when a path happens to hit a lamp."));
  const keyR = el("div", "rt-key rt-key-r");
  const keyRName = el("dt");
  const keyRText = el("dd");
  keyR.append(keyRName, keyRText);
  const keyN = el("div", "rt-key rt-key-n");
  keyN.append(el("dt", null, "est. RMSE"),
    el("dd", null, "Error against the converged image, estimated from each pixel's own sample variance (linear RGB), not measured against a reference. Rare bright paths not yet sampled are missing from it."));
  legend.append(keyL, keyR, keyN);
  side.append(cells, status, sceneInfo, legend);

  const main = el("div", "rt-main");
  main.append(screen, side);
  wrap.append(form, main);
  root.replaceChildren(wrap);

  let info = null; // the binary's load result
  let lit = true; // the scene has lights to sample, so the split compares something
  let gen = 0;
  let running = false;
  let stopAt = 0; // pause once this many passes are complete (0: run to MAX_SPP)
  let loop = Promise.resolve();
  let y = 0;
  let rows = 8;
  let passes = 0;
  let renderMs = 0;
  let meter = [];
  let last = { material: null, nee: null, mixture: null };
  let split = 0.5;
  let readoutQueued = false;
  let failure = null;

  const strategies = () => (lit ? ["material", right.value] : ["nee"]);
  const rightName = () => (lit ? STRATEGY[right.value] : STRATEGY.nee);

  function setSplit(f) {
    split = Math.min(1, Math.max(0, f));
    const pct = Math.round(split * 1000) / 10;
    canvasL.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    divider.style.left = `${pct}%`;
    grip.setAttribute("aria-valuenow", String(Math.round(pct)));
    grip.setAttribute("aria-valuetext", `${Math.round(pct)}% ${STRATEGY.material}, ${Math.round(100 - pct)}% ${rightName()}`);
  }

  function readouts() {
    readoutQueued = false;
    const [a, b] = strategies().map((s) => last[s]);
    spp.textContent = fmt(passes);
    const now = performance.now();
    meter = meter.filter(([t]) => now - t < METER_MS);
    if (meter.length > 1) {
      const n = meter.slice(1).reduce((s, [, k]) => s + k, 0);
      const span = (meter.at(-1)[0] - meter[0][0]) / 1000;
      if (span > 0) rate.textContent = `${fmt(Math.round(n / span / 1000))}k`;
    }
    elapsed.textContent = `${(renderMs / 1000).toFixed(1)} s`;
    if (lit) {
      errLv.textContent = sig(a?.rmse_estimate);
      errRv.textContent = sig(b?.rmse_estimate);
      errL.textContent = `est. RMSE ${sig(a?.rmse_estimate)}`;
      errR.textContent = `est. RMSE ${sig(b?.rmse_estimate)}`;
      const r = a && b ? a.rmse_estimate / b.rmse_estimate : NaN;
      ratio.textContent = Number.isFinite(r) ? `${r.toFixed(2)}×` : "–";
    } else {
      errRv.textContent = sig(a?.rmse_estimate);
      errR.textContent = `est. RMSE ${sig(a?.rmse_estimate)}`;
    }
    passLabel.textContent = `pass ${fmt(passes + 1)}`;
    passFill.style.transform = `scaleX(${Math.max(0.001, y / info.height)})`;
    scan.style.top = `${(y / info.height) * 100}%`;
  }
  const queueReadouts = () => {
    if (!readoutQueued) {
      readoutQueued = true;
      requestAnimationFrame(readouts);
    }
  };

  function say(msg) {
    status.textContent = msg;
  }

  let sceneLabel = "";
  function milestone() {
    if (!lit || passes < 2) return;
    const [a, b] = strategies().map((s) => last[s].rmse_estimate);
    say(`${sceneLabel}: ${fmt(passes)} spp, est. RMSE ${sig(a)} with ${STRATEGY.material}, ${sig(b)} with ${rightName()} (${(a / b).toFixed(2)}× the noise).`);
  }

  function setPlay() {
    play.textContent = running ? "Pause" : passes >= MAX_SPP ? "Done" : passes > 0 && !reduced ? "Resume" : "Render";
    play.disabled = passes >= MAX_SPP;
    step.disabled = running || passes >= MAX_SPP;
    step.style.display = running ? "none" : "";
    status.setAttribute("aria-live", running ? "off" : "polite");
  }

  // One band of rows, every strategy in turn, so the halves never differ in spp.
  async function band(g) {
    const n = Math.min(rows, info.height - y, Math.floor(info.max_pixels_per_call / info.width));
    const t0 = performance.now();
    for (const s of strategies()) {
      const r = await demo.call("render", { sampling: s, y0: y, rows: n });
      if (g !== gen) return false;
      (s === "material" ? ctxL : ctxR).putImageData(new ImageData(rgba(r.rgba), info.width, r.rows), 0, r.y0);
      last[s] = r;
    }
    const now = performance.now();
    const ms = now - t0;
    renderMs += ms;
    meter.push([now, n * info.width * strategies().length]);
    const ideal = (n * TARGET_MS * strategies().length) / Math.max(ms, 0.5);
    rows = Math.max(1, Math.min(Math.round((rows + ideal) / 2), Math.floor(info.max_pixels_per_call / info.width)));
    y += n;
    if (y >= info.height) {
      y = 0;
      passes = last[strategies()[0]].spp;
      milestone();
      readouts();
    } else {
      queueReadouts();
    }
    return true;
  }

  async function run(g) {
    try {
      while (running && g === gen && root.isConnected) {
        if (!(await band(g))) return;
        if (y === 0 && (passes >= MAX_SPP || (stopAt && passes >= stopAt))) {
          running = false;
          if (passes >= MAX_SPP) say(`${fmt(MAX_SPP)} spp reached; rendering stopped.`);
        }
      }
    } catch (err) {
      if (g !== gen) return;
      running = false;
      failure = err;
      say(err.message);
    } finally {
      if (g === gen) setPlay();
    }
  }

  const start = (until) => {
    if (running || passes >= MAX_SPP) return;
    running = true;
    stopAt = until;
    setPlay();
    loop = run(gen);
  };

  async function restart(autoplay, rethrow) {
    const g = ++gen;
    running = false;
    play.disabled = step.disabled = true;
    await loop;
    if (g !== gen) return;
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
    for (const c of [canvasL, canvasR]) {
      c.width = info.width;
      c.height = info.height;
    }
    ctxL.clearRect(0, 0, info.width, info.height);
    ctxR.clearRect(0, 0, info.width, info.height);
    view.style.setProperty("--rt-ar", `${info.width} / ${info.height}`);
    y = 0;
    passes = 0;
    renderMs = 0;
    meter = [];
    last = { material: null, nee: null, mixture: null };
    nameR.textContent = rightName();
    keyRName.textContent = rightName();
    keyRText.textContent = !lit
      ? "This scene is lit by the sky, which is never light-sampled, so both strategies trace the same paths: one image, the renderer's default integrator, Russian roulette included."
      : right.value === "nee"
        ? "Each bounce also casts a shadow ray at a point on a light; MIS (power heuristic) weighs it against the bounce, and Russian roulette ends dim paths. The renderer's default."
        : "Half of all bounces aim at the lights, half follow the material, each weighted by the two densities combined (book 3).";
    hint.textContent = lit ? "drag to compare" : "no lights to sample";
    const label = (sceneLabel = SCENES.find(([id]) => id === info.scene)[1]);
    sceneInfo.textContent = `${label}: ${info.width} × ${info.height} px, ${fmt(info.objects)} top-level objects, ` +
      `${fmt(info.lights)} sampled light${info.lights === 1 ? "" : "s"}, SAH BVH of ${fmt(info.bvh_nodes)} nodes (depth ${info.bvh_depth}), ` +
      `up to ${info.max_depth} bounces, seed 1.`;
    setSplit(split);
    // Two passes always render, so every choice shows real output and a noise estimate at once.
    running = true;
    stopAt = 2;
    setPlay();
    loop = run(g);
    await loop;
    if (g !== gen) return;
    if (rethrow && failure) throw failure;
    readouts();
    say(`${label}: ${fmt(passes)} spp in each half, in your browser.${reduced ? " Press Render to keep sampling." : ""}`);
    if (autoplay) start(0);
  }

  play.addEventListener("click", () => {
    if (running) {
      running = false;
      play.disabled = true;
      loop.then(() => say(`Paused at ${fmt(passes)} spp.`));
    } else {
      start(0);
    }
  });
  step.addEventListener("click", () => start(passes + 1));
  for (const s of [scene, right, width]) s.addEventListener("change", () => restart(!reduced, false));

  const fromPointer = (e) => {
    const r = view.getBoundingClientRect();
    setSplit((e.clientX - r.left) / r.width);
  };
  let dragging = null;
  view.addEventListener("pointerdown", (e) => {
    if (!lit || e.button > 0) return;
    dragging = e.pointerId;
    view.setPointerCapture(e.pointerId);
    fromPointer(e);
    grip.focus({ preventScroll: true });
  });
  view.addEventListener("pointermove", (e) => { if (e.pointerId === dragging) fromPointer(e); });
  const end = (e) => { if (e.pointerId === dragging) dragging = null; };
  view.addEventListener("pointerup", end);
  view.addEventListener("pointercancel", end);
  grip.addEventListener("keydown", (e) => {
    const steps = { ArrowLeft: -0.02, ArrowDown: -0.02, ArrowRight: 0.02, ArrowUp: 0.02, PageDown: -0.1, PageUp: 0.1 };
    if (e.key in steps) setSplit(split + steps[e.key]);
    else if (e.key === "Home") setSplit(0);
    else if (e.key === "End") setSplit(1);
    else return;
    e.preventDefault();
  });

  // A hidden tab stops sampling and picks up again when it is back.
  let hiddenPause = false;
  const onVisibility = () => {
    if (!root.isConnected) {
      document.removeEventListener("visibilitychange", onVisibility);
      return;
    }
    if (document.hidden && running) {
      hiddenPause = true;
      running = false;
    } else if (!document.hidden && hiddenPause) {
      hiddenPause = false;
      loop.then(() => start(0));
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  await cssReady;
  await restart(!reduced, true);
}
