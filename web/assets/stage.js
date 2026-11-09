// The home stage: the raytracer demo's real build traces the scene in this
// tab, material-only sampling left of the split and NEE + MIS right, so both
// halves always hold the same samples per pixel. It starts on its own only
// where motion is welcome, data is not being saved and the device has cores
// to spare, and only while on screen; elsewhere the recorded poster stands
// until Render is pressed. Picking another scene restarts the render on it;
// the new picture wipes in band by band over the last one.
import { connect } from "/assets/demo.js";

const fig = document.querySelector("[data-stage]");
const TARGET_MS = 24;
const METER_MS = 2000;

if (fig) {
  const { stage: slug, width, seed } = fig.dataset;
  let scene = fig.dataset.scene;
  let traced = "";
  const W = Number(width);
  const max = () => Number(fig.dataset.max);
  const view = fig.querySelector(".stage-view");
  const poster = view.querySelector("img");
  const [cr, cl] = [view.querySelector(".stage-r"), view.querySelector(".stage-l")];
  const [xr, xl] = [cr.getContext("2d"), cl.getContext("2d")];
  const glow = fig.querySelector(".glow");
  const gx = glow.getContext("2d", { willReadFrequently: false });
  const scan = view.querySelector(".stage-scan");
  const split = view.querySelector(".stage-split");
  const state = view.querySelector("[data-state]");
  const dial = (k) => fig.querySelector(`[data-k=${k}]`);
  const run = fig.querySelector("[data-run]");
  const status = fig.querySelector("[role=status]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const net = navigator.connection;
  const lean = net?.saveData || /(^|-)(2g|3g)$/.test(net?.effectiveType || "") || (navigator.hardwareConcurrency || 4) < 4;
  const fmt = (n) => n.toLocaleString("en-US");

  let demo = null;
  let info = null;
  let running = false;
  let loop = Promise.resolve();
  let y = 0;
  let rows = 8;
  let passes = 0;
  let meter = [];
  let errs = [NaN, NaN];
  let visible = false;
  let wanted = !reduced && !lean;
  let queued = false;

  const tint = (src) => { try { gx.drawImage(src, 0, 0, glow.width, glow.height); } catch {} };
  if (poster.complete) tint(poster); else poster.addEventListener("load", () => tint(poster), { once: true });

  const set = (k, v) => { const d = dial(k); d.textContent = v; d.classList.toggle("nil", v === "--"); };
  function readouts() {
    queued = false;
    set("spp", fmt(passes));
    const now = performance.now();
    meter = meter.filter(([t]) => now - t < METER_MS);
    if (meter.length > 1) {
      const n = meter.slice(1).reduce((s, [, k]) => s + k, 0);
      const secs = (meter.at(-1)[0] - meter[0][0]) / 1000;
      if (secs > 0) set("rate", `${fmt(Math.round(n / secs / 1000))}k`);
    }
    const r = errs[0] / errs[1];
    if (Number.isFinite(r)) set("ratio", `${r.toFixed(1)}×`);
    scan.style.setProperty("--y", String(y / info.height));
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(readouts); } };

  const rgba = (b64) => {
    const s = atob(b64);
    const out = new Uint8ClampedArray(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };

  async function band() {
    const n = Math.min(rows, info.height - y, Math.floor(info.max_pixels_per_call / info.width));
    const t0 = performance.now();
    const got = {};
    fig.dataset.live = "";
    for (const s of ["material", "nee"]) {
      const r = await demo.call("render", { sampling: s, y0: y, rows: n });
      (s === "material" ? xl : xr).putImageData(new ImageData(rgba(r.rgba), info.width, r.rows), 0, r.y0);
      got[s] = r;
    }
    const now = performance.now();
    const ms = now - t0;
    meter.push([now, n * info.width * 2]);
    rows = Math.max(1, Math.min(Math.round((rows + (n * TARGET_MS * 2) / Math.max(ms, 0.5)) / 2), Math.floor(info.max_pixels_per_call / info.width)));
    y += n;
    if (y >= info.height) {
      y = 0;
      passes = got.nee.spp;
      errs = [got.material.rmse_estimate, got.nee.rmse_estimate];
      tint(cr);
      state.textContent = `live, pass ${fmt(passes + 1)}`;
    }
    queue();
  }

  async function go() {
    if (!running) return;
    fig.dataset.running = "";
    run.textContent = "Pause";
    let failed = false;
    try {
      if (!demo) {
        status.textContent = "Loading the path tracer…";
        demo = await connect(slug);
        status.textContent = "";
      }
      if (traced !== scene) {
        info = await demo.call("load", { scene, width: W, seed: Number(seed) });
        traced = fig.dataset.scene = scene;
      }
      while (running && passes < max()) await band();
    } catch (err) {
      failed = true;
      status.textContent = err.message;
      demo?.close();
      demo = null;
      traced = "";
      passes = 0;
      y = 0;
    } finally {
      running = false;
      delete fig.dataset.running;
      if (failed) run.textContent = "Try again";
      else if (passes >= max()) { state.textContent = `rendered here, ${fmt(passes)} spp`; run.hidden = true; }
      else if (passes) { run.textContent = "Resume"; state.textContent = `paused, ${fmt(passes)} spp`; }
      else run.textContent = "Render it here";
    }
  }
  const start = () => { if (!running && passes < max()) { running = true; loop = loop.then(go); } };
  const stop = () => { running = false; return loop; };

  run.addEventListener("click", () => {
    if (running) { wanted = false; stop(); } else { wanted = true; start(); }
  });
  // Scenes: the pressed button is the one on screen or loading.
  const left = fig.querySelector(".stage-tag span")?.textContent;
  const right = fig.querySelector(".stage-tag span:last-child")?.textContent;
  const picks = [...fig.querySelectorAll("[data-scene-id]")];
  for (const b of picks) {
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-pressed") === "true") return;
      for (const o of picks) o.setAttribute("aria-pressed", String(o === b));
      wanted = true;
      await stop();
      scene = b.dataset.sceneId;
      passes = 0;
      y = 0;
      rows = 8;
      meter = [];
      errs = [NaN, NaN];
      set("spp", "0");
      set("rate", "--");
      set("ratio", "--");
      run.hidden = false;
      state.textContent = `tracing, ${b.textContent.toLowerCase()}`;
      poster.alt = `The ${b.dataset.name} traced in this tab by the path tracer: ${left} sampling on the left, ${right} on the right.`;
      start();
    });
  }
  const loaded = document.readyState === "complete" ? Promise.resolve() : new Promise((r) => addEventListener("load", r, { once: true }));
  // Running while the picture is on screen and the work sheet has not slid over it.
  let shown = false;
  let covered = false;
  const update = () => {
    visible = shown && !covered;
    if (!visible) stop();
    else loaded.then(() => { if (wanted && visible && !document.hidden) start(); });
  };
  new IntersectionObserver(([e]) => { shown = e.isIntersecting; update(); }, { threshold: 0.25 }).observe(view);
  const work = document.querySelector("#work");
  if (work) new IntersectionObserver(([e]) => { covered = e.isIntersecting; update(); }, { rootMargin: "0px 0px -60% 0px" }).observe(work);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (wanted && visible) start();
  });

  // The split: drag anywhere on the picture, or arrow keys on its grip.
  const grip = split.querySelector("b");
  grip.tabIndex = 0;
  grip.setAttribute("role", "slider");
  grip.setAttribute("aria-label", "Split between material-only and NEE + MIS sampling");
  split.removeAttribute("aria-hidden");
  let at = 0.5;
  const place = (f) => {
    at = Math.min(1, Math.max(0, f));
    const pct = Math.round(at * 1000) / 10;
    view.style.setProperty("--split", `${pct}%`);
    grip.setAttribute("aria-valuenow", String(Math.round(pct)));
  };
  place(at);
  let dragging = null;
  view.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    dragging = e.pointerId;
    view.setPointerCapture(e.pointerId);
    place((e.clientX - view.getBoundingClientRect().left) / view.clientWidth);
  });
  view.addEventListener("pointermove", (e) => {
    if (e.pointerId === dragging) place((e.clientX - view.getBoundingClientRect().left) / view.clientWidth);
  });
  for (const t of ["pointerup", "pointercancel"]) view.addEventListener(t, () => { dragging = null; });
  grip.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -0.05, ArrowDown: -0.05, ArrowRight: 0.05, ArrowUp: 0.05 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    place(at + d);
  });
}
