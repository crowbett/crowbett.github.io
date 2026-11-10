// The home stage: the raytracer demo's real build traces the scene in this
// tab, material-only sampling left of the split and NEE + MIS right, so both
// halves always hold the same samples per pixel. One copy of the binary runs
// per spare core, each in its own worker and each owning every Nth stripe of
// rows for good; a row's samples are keyed by the seed, the row and its count
// (the bridge), so the picture is the one a single copy would trace. Dragging
// the picture orbits the camera: every copy re-aims, sweeps its stripes once
// at a fraction of their rows (stretched to fit) and then traces in full.
// Under a mouse the camera also leans toward the pointer until a drag takes it.
// It starts on its own only where motion is welcome, data is not being saved
// and the device has cores to spare, and only while on screen; elsewhere the
// recorded poster stands until Render is pressed. Picking another scene
// restarts the render on it.
import { connect } from "/assets/demo.js";

const fig = document.querySelector("[data-stage]");
const STRIPE = 8;
const METER_MS = 2000;
const SWEEP_MS = 33;
// Degrees either way: at the Cornell camera's distance this keeps the eye
// inside the box's opening, so no view looks at a wall from behind.
const YAW = 18;
const PITCH = 14;
// Under a mouse the camera leans this share of the way toward the pointer.
const LEAN = 0.45;

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
  const split = view.querySelector(".stage-split");
  const state = fig.querySelector("[data-state]");
  const hint = fig.querySelector("[data-orbit]");
  const tally = fig.querySelector("[data-cores]");
  const home = fig.querySelector("[data-reset]");
  const dial = (k) => fig.querySelector(`[data-k=${k}]`);
  const run = fig.querySelector("[data-run]");
  const status = fig.querySelector("[role=status]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const net = navigator.connection;
  const cores = navigator.hardwareConcurrency || 4;
  const lean = net?.saveData || /(^|-)(2g|3g)$/.test(net?.effectiveType || "") || cores < 4;
  const copies = Math.max(1, Math.min(8, cores - 1));
  const fmt = (n) => n.toLocaleString("en-US");
  // A sweep's rows land here and are stretched over their stripe.
  const scratch = Object.assign(document.createElement("canvas"), { width: W, height: STRIPE }).getContext("2d");

  let pool = [];
  let info = null;
  let running = false;
  let loop = Promise.resolve();
  let passes = 0;
  let meter = [];
  let visible = false;
  let wanted = !reduced && !lean;
  let queued = false;
  let cam = { yaw: 0, pitch: 0 };
  let aim = "0,0";
  let sweepRows = 2;
  let turned = false;

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
    // Each copy estimates the noise of its own rows; they combine by row share.
    const noise = (i) => {
      let sum = 0, rows = 0;
      for (const w of pool) if (Number.isFinite(w.errs[i])) { sum += w.errs[i] ** 2 * w.rows; rows += w.rows; }
      return Math.sqrt(sum / rows);
    };
    const r = noise(0) / noise(1);
    if (Number.isFinite(r)) set("ratio", `${r.toFixed(1)}×`);
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(readouts); } };
  const count = () => {
    const done = Math.min(...pool.map((w) => (w.aim === aim ? w.passes : 0)));
    if (done === passes) return;
    passes = done;
    state.textContent = `live, pass ${fmt(passes + 1)}`;
  };
  const finished = () => pool.length > 0 && traced === scene && pool.every((w) => w.aim === aim && !w.sweep.length && w.passes >= max());

  const rgba = (b64) => {
    const s = atob(b64);
    const out = new Uint8ClampedArray(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  const fresh = (w) => { w.next = 0; w.passes = 0; w.errs = [NaN, NaN]; };

  // One copy's loop: re-aim when the camera moved, sweep after an orbit, then
  // trace its stripes pass after pass, both strategies each time.
  async function work(w) {
    while (running && !(w.aim === aim && !w.sweep.length && w.passes >= max())) {
      if (w.aim !== aim || (w.settle && !w.sweep.length)) {
        const to = aim;
        await w.demo.call("camera", parse(to));
        fresh(w);
        // A sweep leaves its rows one sample ahead; aiming again clears them.
        if (w.settle && w.aim === to) w.settle = false;
        else { w.aim = to; w.sweep = [...w.stripes]; w.t0 = performance.now(); w.settle = true; }
        continue;
      }
      if (w.sweep.length) {
        const y0 = w.sweep.shift();
        const h = Math.min(STRIPE, info.height - y0);
        const n = Math.min(sweepRows, h);
        const r = await w.demo.call("render", { sampling: "nee", y0, rows: n });
        if (w.aim !== aim) continue;
        scratch.putImageData(new ImageData(rgba(r.rgba), info.width, n), 0, 0);
        for (const x of [xl, xr]) x.drawImage(scratch.canvas, 0, 0, info.width, n, 0, y0, info.width, h);
        meter.push([performance.now(), n * info.width]);
        if (!w.sweep.length && w === pool[0]) {
          const ms = performance.now() - w.t0;
          sweepRows = ms > SWEEP_MS * 1.3 ? Math.max(1, sweepRows / 2) : ms < SWEEP_MS / 2 ? Math.min(STRIPE, sweepRows * 2) : sweepRows;
        }
        queue();
        continue;
      }
      const y0 = w.stripes[w.next];
      const n = Math.min(STRIPE, info.height - y0);
      const got = {};
      for (const s of ["material", "nee"]) {
        const r = await w.demo.call("render", { sampling: s, y0, rows: n });
        if (w.aim !== aim) break;
        (s === "material" ? xl : xr).putImageData(new ImageData(rgba(r.rgba), info.width, r.rows), 0, r.y0);
        got[s] = r;
      }
      if (!got.nee) continue;
      fig.dataset.live = "";
      meter.push([performance.now(), n * info.width * 2]);
      if (++w.next >= w.stripes.length) {
        w.next = 0;
        w.passes++;
        w.errs = [got.material.rmse_estimate, got.nee.rmse_estimate];
        count();
      }
      queue();
    }
  }
  const parse = (k) => { const [yaw, pitch] = k.split(",").map(Number); return { yaw, pitch }; };

  async function go() {
    if (!running) return;
    fig.dataset.running = "";
    run.textContent = "Pause";
    let failed = false;
    try {
      if (!pool.length) {
        status.textContent = "Loading the path tracer…";
        // The first copy's download fills the HTTP cache for the rest.
        const first = await connect(slug);
        const rest = await Promise.all(Array.from({ length: copies - 1 }, () => connect(slug)));
        pool = [first, ...rest].map((demo) => ({ demo, stripes: [], rows: 0, sweep: [], settle: false, aim: "0,0", next: 0, passes: 0, errs: [NaN, NaN] }));
        status.textContent = "";
      }
      if (traced !== scene) {
        [info] = await Promise.all(pool.map((w) => w.demo.call("load", { scene, width: W, seed: Number(seed) })));
        for (const w of pool) { Object.assign(w, { stripes: [], rows: 0, sweep: [], settle: false, aim: "0,0" }); fresh(w); }
        for (let y = 0, i = 0; y < info.height; y += STRIPE, i++) {
          const w = pool[i % pool.length];
          w.stripes.push(y);
          w.rows += Math.min(STRIPE, info.height - y);
        }
        traced = fig.dataset.scene = scene;
        if (tally) {
          tally.textContent = `${pool.length} ${pool.length === 1 ? "core" : "cores"}`;
          tally.hidden = false;
        }
        if (hint && !turned) hint.hidden = false;
      }
      await Promise.all(pool.map(work));
    } catch (err) {
      failed = true;
      status.textContent = err.message;
      for (const w of pool) w.demo.close();
      pool = [];
      traced = "";
      passes = 0;
    } finally {
      running = false;
      delete fig.dataset.running;
      if (failed) run.textContent = "Try again";
      else if (finished()) { state.textContent = `rendered here, ${fmt(passes)} spp`; run.hidden = true; }
      else if (passes) { run.textContent = "Resume"; state.textContent = `paused, ${fmt(passes)} spp`; }
      else run.textContent = "Render it here";
    }
  }
  const start = () => { if (!running && !finished()) { running = true; loop = loop.then(go); } };
  const stop = () => { running = false; return loop; };

  run.addEventListener("click", () => {
    if (running) { wanted = false; stop(); } else { wanted = true; start(); }
  });
  const zero = () => {
    passes = 0;
    meter = [];
    set("spp", "0");
    set("rate", "--");
    set("ratio", "--");
    run.hidden = false;
  };
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
      held = false;
      goal = null;
      cam = { yaw: 0, pitch: 0 };
      aim = "0,0";
      if (home) home.hidden = true;
      zero();
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
  const work0 = document.querySelector("#work");
  if (work0) new IntersectionObserver(([e]) => { covered = e.isIntersecting; update(); }, { rootMargin: "0px 0px -60% 0px" }).observe(work0);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (wanted && visible) start();
  });

  // Orbit: the camera swings about the point the scene looks at. Asking for a
  // view is asking to render, so it starts a paused or finished stage.
  const orbit = (yaw, pitch, lean = false) => {
    const lim = (v, m) => Math.round(Math.min(m, Math.max(-m, v)) * 10) / 10 + 0;
    const to = { yaw: lim(yaw, YAW), pitch: lim(pitch, PITCH) };
    const k = `${to.yaw},${to.pitch}`;
    if (k === aim) return;
    cam = to;
    aim = k;
    zero();
    state.textContent = lean || k === "0,0" ? "live, pass 1" : `yaw ${to.yaw.toFixed(1)}°, pitch ${to.pitch.toFixed(1)}°`;
    if (!lean) {
      turned = true;
      if (hint) hint.hidden = true;
    }
    if (home) home.hidden = lean || k === "0,0";
    fig.dataset.yaw = to.yaw;
    fig.dataset.pitch = to.pitch;
    wanted = true;
    if (visible) start();
  };
  // A view the visitor dragged to is theirs until they reset it; before that,
  // under a mouse and with motion welcome, the camera leans toward the pointer
  // while the stage is rendering, easing there a frame at a time.
  let held = false;
  let goal = null;
  const release = () => { held = false; orbit(0, 0); };
  home?.addEventListener("click", release);
  view.addEventListener("dblclick", release);
  const stageEl = fig.closest(".stage");
  const ease = () => {
    if (!goal || held || !running) { goal = null; return; }
    const [y, p] = [cam.yaw + (goal[0] - cam.yaw) * 0.2, cam.pitch + (goal[1] - cam.pitch) * 0.2];
    if (Math.abs(goal[0] - cam.yaw) < 0.15 && Math.abs(goal[1] - cam.pitch) < 0.15) { goal = null; return; }
    orbit(y, p, true);
    requestAnimationFrame(ease);
  };
  const toward = (yaw, pitch) => {
    const idle = !goal;
    goal = [yaw, pitch];
    if (idle) requestAnimationFrame(ease);
  };
  if (stageEl && !reduced) {
    stageEl.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || held || drag || !running) return;
      const r = stageEl.getBoundingClientRect();
      toward(-((e.clientX - r.left) / r.width - 0.5) * 2 * YAW * LEAN, ((e.clientY - r.top) / r.height - 0.5) * 2 * PITCH * LEAN);
    });
    stageEl.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !held && running) toward(0, 0); });
  }

  // The split: drag its line, or arrow keys on its grip. Anywhere else on the
  // picture a drag orbits.
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
  let drag = null;
  let pending = null;
  view.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const r = view.getBoundingClientRect();
    const line = e.target === grip || Math.abs(e.clientX - r.left - at * r.width) <= 18;
    drag = { id: e.pointerId, line, x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    try { view.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer cannot be captured */ }
    if (line) place((e.clientX - r.left) / r.width);
    else view.dataset.grab = "";
  });
  view.addEventListener("pointermove", (e) => {
    if (e.pointerId !== drag?.id) return;
    const r = view.getBoundingClientRect();
    if (drag.line) { place((e.clientX - r.left) / r.width); return; }
    // The scene follows the hand: the camera goes the other way.
    const to = [drag.yaw - ((e.clientX - drag.x) / r.width) * 2 * YAW, drag.pitch + ((e.clientY - drag.y) / r.height) * 2 * PITCH];
    held = true;
    goal = null;
    if (!pending) requestAnimationFrame(() => { const p = pending; pending = null; orbit(...p); });
    pending = to;
  });
  for (const t of ["pointerup", "pointercancel"]) view.addEventListener(t, () => { drag = null; delete view.dataset.grab; });
  grip.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: -0.05, ArrowDown: -0.05, ArrowRight: 0.05, ArrowUp: 0.05 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    place(at + d);
  });
}
