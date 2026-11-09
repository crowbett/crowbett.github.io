// adfactory demo: adfactory's real planning code, compiled to WebAssembly. The
// page draws a synthetic scene and hands the engine its detector boxes and word
// timings; the engine proposes anchors and plans every deliverable (crop
// windows, hook and caption layout, occlusion, upscale, loudness) with a verdict.
// Every rectangle, line break and verdict on screen came back from the binary.
const DUR = 15;
const CUT_AT = 7.5;
const STILL_AT = 3;
const FADE_MS = 250;
const ORDER = ["reels", "tiktok", "shorts", "feed_4x5", "feed_4x5_still", "youtube", "broadcast_1080i", "feed_1x1", "feed_1x1_still"];
const SOURCES = [["3840x2160", "3840 × 2160"], ["1920x1080", "1920 × 1080"], ["1280x720", "1280 × 720"]];
const CUTS = [[0, "full 15 s"], [10, "first 10 s"]];
// Assembled mixes measured on the project's own fixtures (docs/findings.md); LRA only where it was measured.
const MIXES = [[-20.4, -9.6], [-25.4, -11.3], [-17.6, -1.1], [-17.9, -1.2], [-18.86, -0.78, 11.4]];
const POS = [["tl", "top left"], ["tc", "top centre"], ["tr", "top right"], ["ml", "middle left"], ["cc", "centre"],
  ["mr", "middle right"], ["bl", "bottom left"], ["bc", "bottom centre"], ["br", "bottom right"]];
const SPEEDS = [0.5, 1, 2];
const NARRATION = ("One clip in, every platform out. Cropped for each feed, captioned, and normalised for loudness. " +
  "Then every file is checked before it ships.").split(" ");
const WORDS = NARRATION.map((text, i) => ({ text, start: +(0.5 + i * 0.55).toFixed(2), end: +(0.95 + i * 0.55).toFixed(2) }));
const STATE = { ready: "ready", advisory: "advisory", refused: "refused" };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const num = (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n, d = 2) => `${n >= 0 ? "+" : "−"}${num(Math.abs(n), d)}`;
const db = (n, d = 1) => `${n < 0 ? "−" : ""}${num(Math.abs(n), d)}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

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
    o.selected = String(v) === String(value);
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
  const source = select("source", SOURCES, "3840x2160");
  const cut = select("cut", CUTS, 0);
  const mix = select("mix", MIXES.map((m, i) => [i, `${db(m[0], 2)} LUFS, ${db(m[1], 2)} dBTP`]), 0);
  const track = el("input");
  Object.assign(track, { type: "checkbox", name: "track", checked: true });
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 1);
  const play = button("Pause");
  const step = button("Step ¼ s", "secondary");
  const reset = button("Reset", "secondary");
  const transport = el("div", "adf-transport");
  speed.setAttribute("aria-label", "speed");
  transport.append(play, step, reset, speed);

  const hook = el("input");
  Object.assign(hook, { type: "text", name: "hook", value: "One clip, every feed", maxLength: 120, autocomplete: "off", spellcheck: false });
  const hookPos = select("hook-position", POS, "tc");
  const capPos = select("caption-position", POS, "bc");
  const plats = el("div", "adf-plats");
  const group = (name, ...kids) => {
    const f = el("fieldset", "adf-grp");
    f.append(el("legend", null, name), ...kids);
    return f;
  };
  const form = el("form", "adf-controls");
  form.setAttribute("aria-labelledby", "adf-brief");
  form.addEventListener("submit", (e) => e.preventDefault());
  const briefHead = el("h3", "adf-h", "Change the brief");
  briefHead.id = "adf-brief";
  form.append(briefHead, group("footage", field("source", source), field("cut", cut)),
    group("sound and motion", field("measured mix", mix), field("follow motion", track, "adf-check")),
    group("on-screen copy", field("hook", hook, "adf-hook"), field("hook at", hookPos), field("captions at", capPos)),
    group("platforms", plats));

  const canvas = el("canvas", "adf-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend adf-legend");
  for (const [k, t] of [["you", "subject, drag it"], ["box", "detector box"], ["crop", "crop window, ffmpeg.CropPlanFor"], ["anchor", "anchor"], ["cue", "caption cue"]]) {
    const s = el("span", "adf-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const you = el("p", "adf-you");
  you.setAttribute("aria-live", "polite");
  const tiles = el("div", "adf-tiles");
  tiles.setAttribute("role", "group");
  tiles.setAttribute("aria-label", "Deliverables");
  const detail = el("div", "adf-detail");
  detail.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack adf-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["n", "deliverables"], ["ready", "ready"], ["advisory", "advisory"], ["refused", "refused"],
    ["anchors", "anchors"], ["windows", "crop windows"], ["lines", "caption lines"], ["loud", "mix → target"], ["linear", "linear gain"],
    ["replans", "re-plans"], ["ms", "plan time"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "adf-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const status = el("p", "adf-status");
  status.setAttribute("aria-live", "polite");
  const receipt = el("p", "demo-out adf-out");
  receipt.setAttribute("aria-live", "polite");
  root.replaceChildren(canvas, legend, transport, you, tiles, detail, form, cells, status, receipt);

  // State.
  const scene = { x0: 0.22, x1: 0.62, y: 0.38, px: 0.7, py: 0.3 };
  let info = null;
  let on = new Set(ORDER);
  let plan = null;
  let prev = null;
  let replanAt = 0;
  let selected = null;
  let t = reduce.matches ? STILL_AT : 0;
  let playing = !reduce.matches;
  let visible = true;
  let raf = 0;
  let last = 0;
  let replans = 0;
  let lastMs = 0;
  let totalMs = 0;
  let colors = null;
  let drag = null;
  let hoverSubject = false;
  let lastDom = 0;
  const tileEls = new Map();
  const off = document.createElement("canvas");
  Object.assign(off, { width: 960, height: 540 });

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), page: v("--bg"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"),
      text2: v("--text-2"), text3: v("--text-3"), accent: v("--accent"), tint: v("--accent-tint"), signal: v("--signal"),
      live: v("--live"), danger: v("--danger"), block: v("--block"), onBlock: v("--on-block"), mono: v("--mono") || "monospace",
      sans: v("--sans") || "sans-serif",
    };
  }

  const duration = () => Number(cut.value) || DUR;
  const shotA = (tt) => tt < CUT_AT;
  function subjectAt(tt) {
    if (shotA(tt)) {
      const x = scene.x0 + ((scene.x1 - scene.x0) * tt) / CUT_AT;
      return { kind: "a", x, face: [x - 0.035, scene.y, 0.07, 0.13], human: [x - 0.08, scene.y - 0.04, 0.16, Math.min(0.78, 0.98 - scene.y)] };
    }
    return { kind: "b", x: scene.px + 0.07, product: [scene.px, scene.py, 0.14, 0.26] };
  }
  const box = (kind, b, confidence) => ({ kind, x: +b[0].toFixed(4), y: +b[1].toFixed(4), w: +b[2].toFixed(4), h: +b[3].toFixed(4), confidence });
  function frames(rate) {
    const out = [];
    for (let i = 0; i < DUR * rate; i++) {
      const s = subjectAt(i / rate);
      out.push({ boxes: s.kind === "a" ? [box("face", s.face, 0.95), box("human", s.human, 0.9)] : [box("objectness", s.product, 0.8)] });
    }
    return out;
  }
  function params() {
    const [w, h] = source.value.split("x").map(Number);
    const m = MIXES[Number(mix.value)];
    const rate = track.checked ? info.trackSampleRate : info.sampleRate;
    return {
      source: { width: w, height: h, duration: DUR }, cut: Number(cut.value), track: track.checked, frames: frames(rate),
      targets: ORDER.filter((k) => on.has(k)), hook: { text: hook.value, position: hookPos.value, end: 4 },
      captions: { position: capPos.value, words: WORDS }, mix: { integrated: m[0], truePeak: m[1], lra: m[2] || 0 }, stillAt: STILL_AT,
    };
  }

  // One call in flight; the latest request wins.
  let busy = false;
  let again;
  let settle = null;
  function replan(why) {
    if (busy) { again = why ?? ""; return settle; }
    busy = true;
    settle = (async () => {
      let w = why ?? "";
      while (w !== undefined) {
        again = undefined;
        const t0 = performance.now();
        let r;
        try {
          r = await demo.call("plan", params());
        } catch (err) {
          status.textContent = err.message;
          w = again;
          continue;
        }
        lastMs = performance.now() - t0;
        totalMs += lastMs;
        apply(r, w);
        w = again;
      }
      busy = false;
    })();
    return settle;
  }

  function apply(r, why) {
    replans++;
    const was = plan ? new Map(plan.deliverables.map((d) => [d.key, d.state])) : new Map();
    prev = plan;
    plan = r;
    replanAt = performance.now();
    if (!plan.deliverables.some((d) => d.key === selected)) selected = null;
    if (!selected) selected = (plan.deliverables.find((d) => d.state !== "ready") || plan.deliverables[0])?.key || null;
    buildTiles(was);
    showDetail();
    const n = { ready: 0, advisory: 0, refused: 0 };
    for (const d of plan.deliverables) n[d.state]++;
    if (why) {
      const flips = plan.deliverables.filter((d) => was.has(d.key) && was.get(d.key) !== d.state).map((d) => `${d.key} ${STATE[d.state]}`);
      you.textContent = `${why}: re-planned in ${num(lastMs, 1)} ms. ${n.ready} ready, ${n.advisory} advisory, ${n.refused} refused` +
        (flips.length ? `; now ${flips.join(", ")}.` : "; no verdict changed.");
    }
    const tr = plan.track.map((k, i) => `shot ${i + 1} centre held ${Math.round(k.static * 100)}% static, ${Math.round(k.tracked * 100)}% tracked`);
    status.textContent = `${plan.segments.length} shots, solved against ${plan.reference} (keeps ${Math.round(plan.keepX * 100)}% of the width)` +
      (tr.length ? `: ${tr.join("; ")}.` : ": one anchor per shot.");
    updateDom(true);
    draw(performance.now());
  }

  // Tiles.
  function buildTiles(was) {
    const keys = plan.deliverables.map((d) => d.key);
    for (const [k, t] of tileEls) if (!keys.includes(k)) { t.btn.remove(); tileEls.delete(k); }
    for (const d of plan.deliverables) {
      let t = tileEls.get(d.key);
      if (!t) {
        const btn = button("", "adf-tile");
        const cv = el("canvas", "adf-tc");
        const name = el("span", "adf-tk", d.key);
        const chip = el("span", "adf-chip");
        const meta = el("span", "adf-tm");
        const row = el("span", "adf-tr");
        row.append(chip, meta);
        btn.append(cv, name, row);
        btn.addEventListener("click", () => { selected = d.key; for (const x of tileEls.values()) x.btn.setAttribute("aria-pressed", String(x.key === selected)); showDetail(); });
        t = { key: d.key, btn, cv, chip, meta };
        tileEls.set(d.key, t);
      }
      t.d = d;
      tiles.append(t.btn);
      t.btn.dataset.key = t.key;
      t.btn.dataset.state = d.state;
      t.btn.setAttribute("aria-pressed", String(d.key === selected));
      t.chip.textContent = STATE[d.state];
      t.meta.textContent = `${d.aspect}${d.still ? " still" : ""}`;
      t.btn.setAttribute("aria-label", `${d.label}, ${d.aspect}: ${STATE[d.state]}${d.reasons.length ? `, ${d.reasons[0]}` : ""}`);
      if (was.has(d.key) && was.get(d.key) !== d.state && !reduce.matches) {
        t.btn.classList.remove("adf-flash");
        void t.btn.offsetWidth;
        t.btn.classList.add("adf-flash");
      }
    }
    sizeTiles();
  }
  function sizeTiles() {
    const h = tiles.clientWidth < 520 ? 120 : 150;
    for (const t of tileEls.values()) {
      const w = Math.round((h * t.d.width) / t.d.height);
      t.cv.style.width = `${w}px`;
      t.cv.style.height = `${h}px`;
      t.btn.style.width = `${Math.max(w, 96) + 2}px`;
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (t.cv.width !== pw || t.cv.height !== ph) Object.assign(t.cv, { width: pw, height: ph });
      t.w = w; t.h = h;
    }
  }

  function showDetail() {
    const d = plan?.deliverables.find((x) => x.key === selected);
    if (!d) { detail.replaceChildren(); return; }
    const head = el("p", "adf-dh");
    head.append(el("strong", null, `${d.label} · ${d.width}×${d.height}`), el("span", `adf-chip adf-chip-${d.state}`, STATE[d.state]));
    const list = el("ul", "adf-reasons");
    if (!d.reasons.length) list.append(el("li", null, "nothing to report: laid out inside the safe zone, no refusal, no advisory."));
    for (const r of d.reasons) list.append(el("li", null, r));
    const facts = el("ul", "adf-facts");
    if (d.loudness) facts.append(el("li", null, `loudness: ${d.loudness.line}`));
    else if (d.still) facts.append(el("li", null, "loudness: none, a still has no audio stream"));
    facts.append(el("li", null, `reframe: ${d.scaleLine}`));
    if (d.fontSize) facts.append(el("li", null, `captions at ${d.fontSize} px, ${d.lines} lines, safe band ${fmt(d.safeBand)} px`));
    if (d.verified.length) facts.append(el("li", null, `spec verified: ${d.verified.join(", ")}`));
    detail.replaceChildren(head, list, facts);
  }

  // Geometry.
  let G = null;
  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const fw = W, fh = Math.round((W * 9) / 16);
    const tlY = fh + 10;
    const H = tlY + 74;
    G = { W, H, fw, fh, tlY };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    if (plan) sizeTiles();
  }
  const tx = (s) => 8 + (s / DUR) * (G.W - 16);

  function drawScene(ctx, w, h, tt, hero) {
    const c = colors;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    const R = (b) => [b[0] * w, b[1] * h, b[2] * w, b[3] * h];
    ctx.lineWidth = Math.max(1, w / 480);
    const s = subjectAt(tt);
    if (s.kind === "a") {
      ctx.fillStyle = c.surface;
      ctx.strokeStyle = c.strong;
      for (const b of [[0.06, 0.1, 0.17, 0.34], [0.78, 0.1, 0.12, 0.5]]) { ctx.fillRect(...R(b)); ctx.strokeRect(...R(b)); }
      ctx.beginPath(); ctx.moveTo(0.06 * w + 0.085 * w, 0.1 * h); ctx.lineTo(0.145 * w, 0.44 * h); ctx.stroke();
      ctx.strokeStyle = c.line;
      ctx.beginPath(); ctx.moveTo(0, 0.86 * h); ctx.lineTo(w, 0.86 * h); ctx.stroke();
      const [hx, hy, hw, hh] = R(s.human);
      const [fx, fy, fw2, fh2] = R(s.face);
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.roundRect(hx + hw * 0.12, fy + fh2 * 1.05, hw * 0.76, hy + hh - (fy + fh2 * 1.05), [hw * 0.3, hw * 0.3, 0, 0]);
      ctx.fill();
      ctx.beginPath(); ctx.ellipse(fx + fw2 / 2, fy + fh2 / 2, fw2 / 2, fh2 / 2, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = c.line;
      for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, i * 0.12 * h); ctx.lineTo(w, i * 0.12 * h); ctx.stroke(); }
      ctx.fillStyle = c.surface;
      ctx.strokeStyle = c.strong;
      const ty = (s.product[1] + s.product[3]) * h;
      ctx.fillRect(0.02 * w, ty, 0.96 * w, 0.05 * h); ctx.strokeRect(0.02 * w, ty, 0.96 * w, 0.05 * h);
      ctx.fillRect(0.06 * w, ty + 0.05 * h, 0.02 * w, h - ty); ctx.fillRect(0.92 * w, ty + 0.05 * h, 0.02 * w, h - ty);
      const [px, py, pw, ph] = R(s.product);
      ctx.fillStyle = c.accent;
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = c.tint;
      ctx.fillRect(px + pw * 0.12, py + ph * 0.35, pw * 0.76, ph * 0.22);
    }
    if (!hero) return;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = c.text2;
    ctx.fillStyle = c.text2;
    ctx.lineWidth = 1;
    ctx.font = `10px ${c.mono}`;
    ctx.textBaseline = "bottom";
    const boxes = s.kind === "a" ? [["face", s.face, 0.95], ["human", s.human, 0.9]] : [["objectness", s.product, 0.8]];
    for (const [k, b, conf] of boxes) {
      const [x, y, bw, bh] = R(b);
      ctx.strokeRect(x - 2.5, y - 2.5, bw + 5, bh + 5);
      ctx.fillText(`${k} ${conf}`, x - 2, k === "human" ? y + bh + 14 : y - 4);
    }
    ctx.setLineDash([]);
    ctx.textBaseline = "alphabetic";
  }

  const winAt = (d, tt) => d.windows.find((w) => w.from <= tt && tt < w.to) || d.windows[d.windows.length - 1];
  const active = (r, tt) => r.start <= tt && (r.end <= 0 || tt < r.end);

  function cropGroups(p) {
    const seen = new Map();
    for (const d of p.deliverables) {
      if (!d.windows.length || (d.keepX >= 1 && d.keepY >= 1) || seen.has(d.aspect)) continue;
      seen.set(d.aspect, d);
    }
    return [...seen.values()];
  }

  function drawCrops(ctx, p, tt, alpha, dashed) {
    const c = colors;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.signal;
    ctx.fillStyle = c.signal;
    ctx.font = `600 11px ${c.mono}`;
    if (dashed) ctx.setLineDash([3, 4]);
    const groups = cropGroups(p).map((d) => [d, winAt(d, tt)]);
    groups.forEach(([, w], i) => ctx.strokeRect(w.x * G.fw + 1 + i, w.y * G.fh + 1 + i, w.w * G.fw - 2 - 2 * i, w.h * G.fh - 2 - 2 * i));
    if (!dashed) groups.forEach(([d, w], i) => {
      const x = w.x * G.fw + 4 + i, y = w.y * G.fh + 4 + i + i * 17, tw = ctx.measureText(d.aspect).width + 8;
      ctx.fillStyle = c.signal; ctx.fillRect(x, y, tw, 16);
      ctx.fillStyle = c.bg; ctx.fillText(d.aspect, x + 4, y + 12);
    });
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    if (!G || !colors) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    ctx.save();
    ctx.scale(G.fw / G.W, G.fh / ((G.W * 9) / 16));
    drawScene(ctx, G.W, (G.W * 9) / 16, t, true);
    ctx.restore();
    if (plan) {
      const tight = cropGroups(plan)[0];
      if (tight) {
        const w = winAt(tight, t);
        ctx.fillStyle = c.page;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(0, 0, w.x * G.fw, G.fh);
        ctx.fillRect((w.x + w.w) * G.fw, 0, G.fw - (w.x + w.w) * G.fw, G.fh);
        ctx.globalAlpha = 1;
      }
      const fade = reduce.matches ? 1 : clamp((now - replanAt) / FADE_MS, 0, 1);
      if (prev && fade < 1) drawCrops(ctx, prev, t, 1 - fade, true);
      drawCrops(ctx, plan, t, reduce.matches ? 1 : 0.35 + 0.65 * fade, false);
    }
    if (drag || hoverSubject) {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1;
      const s = subjectAt(t);
      const b = s.kind === "a" ? s.human : s.product;
      ctx.strokeRect(b[0] * G.fw - 6.5, b[1] * G.fh - 6.5, b[2] * G.fw + 13, b[3] * G.fh + 13);
    }
    ctx.font = `10px ${c.mono}`;
    ctx.fillStyle = c.text2;
    ctx.textAlign = "right";
    if (G.fw >= 480) ctx.fillText(`source ${source.value.replace("x", "×")}, t ${num(t, 2)} s, shot ${shotA(t) ? 1 : 2}`, G.fw - 6, G.fh - 6);
    ctx.textAlign = "left";
    drawTimeline(ctx);
    for (const tl of tileEls.values()) drawTile(tl);
  }

  function drawTimeline(ctx) {
    const c = colors;
    const y0 = G.tlY;
    ctx.font = `10px ${c.mono}`;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 0; s <= DUR; s++) { const x = Math.round(tx(s)) + 0.5; ctx.moveTo(x, y0 + 56); ctx.lineTo(x, y0 + (s % 5 ? 60 : 63)); }
    ctx.moveTo(tx(0), y0 + 56.5); ctx.lineTo(tx(DUR), y0 + 56.5);
    ctx.stroke();
    ctx.fillStyle = c.text3;
    ctx.textAlign = "center";
    for (const s of [0, 5, 10, 15]) ctx.fillText(`${s} s`, clamp(tx(s), 14, G.W - 14), y0 + 73);
    ctx.textAlign = "left";
    if (plan) {
      const hookR = plan.deliverables.flatMap((d) => d.rects).find((r) => r.kind === "hook");
      ctx.font = `9px ${c.mono}`;
      if (hookR) {
        const x0 = tx(hookR.start), x1 = tx(hookR.end > 0 ? hookR.end : plan.duration);
        ctx.fillStyle = c.text;
        ctx.fillRect(x0, y0, x1 - x0, 12);
        ctx.fillStyle = c.bg;
        ctx.fillText("hook", x0 + 4, y0 + 9);
      }
      for (const q of plan.cues) {
        const x0 = tx(q.start), x1 = tx(q.end);
        ctx.fillStyle = c.block;
        ctx.fillRect(x0, y0 + 15, Math.max(2, x1 - x0 - 1), 12);
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, y0 + 15, x1 - x0 - 3, 12); ctx.clip();
        ctx.fillStyle = c.onBlock;
        ctx.fillText(q.text, x0 + 3, y0 + 24);
        ctx.restore();
      }
      plan.segments.forEach((g, i) => {
        const x0 = tx(g.start), x1 = tx(g.end);
        ctx.strokeStyle = c.strong;
        ctx.strokeRect(x0 + 0.5, y0 + 30.5, Math.max(2, x1 - x0 - 2), 12);
        ctx.fillStyle = c.text2;
        ctx.fillText(`shot ${i + 1} · ${g.from}`, x0 + 4, y0 + 39.5);
      });
      ctx.fillStyle = c.text;
      for (const a of plan.anchors) {
        const x = tx(a.at);
        ctx.beginPath(); ctx.moveTo(x, y0 + 45); ctx.lineTo(x - 3.5, y0 + 52); ctx.lineTo(x + 3.5, y0 + 52); ctx.closePath(); ctx.fill();
      }
      if (plan.duration < DUR) {
        const x = tx(plan.duration);
        ctx.fillStyle = c.page;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x, y0 - 2, tx(DUR) - x + 8, 60);
        ctx.globalAlpha = 1;
        ctx.fillStyle = c.text2;
        ctx.fillText(`cut at ${plan.duration} s`, x + 4, y0 + 50);
      }
    }
    const sx = tx(STILL_AT);
    ctx.fillStyle = c.text3;
    ctx.fillRect(sx - 0.5, y0 - 2, 1, 4);
    const px = Math.round(tx(t)) + 0.5;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, y0 - 4); ctx.lineTo(px, y0 + 58); ctx.stroke();
  }

  function drawTile(tl) {
    const d = tl.d;
    if (!d || !tl.w) return;
    const c = colors;
    const dpr = window.devicePixelRatio || 1;
    const ctx = tl.cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = tl.w, H = tl.h;
    const tt = d.still ? STILL_AT : t;
    if (d.windows.length) {
      const w = winAt(d, tt);
      ctx.drawImage(off, w.x * off.width, w.y * off.height, w.w * off.width, w.h * off.height, 0, 0, W, H);
    } else {
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, W, H);
    }
    const [st, sr, sb, sl] = d.safe;
    ctx.fillStyle = c.page;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 0, W, st * H);
    ctx.fillRect(0, H - sb * H, W, sb * H);
    ctx.fillRect(0, st * H, sl * W, H - (st + sb) * H);
    ctx.fillRect(W - sr * W, st * H, sr * W, H - (st + sb) * H);
    ctx.globalAlpha = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = c.text3;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sl * W) + 0.5, Math.round(st * H) + 0.5, Math.round(W - (sl + sr) * W) - 1, Math.round(H - (st + sb) * H) - 1);
    ctx.setLineDash([]);
    const k = W / d.width;
    for (const r of d.rects) {
      if (!active(r, tt)) continue;
      const x = r.x * k, y = r.y * k, w = r.w * k, h = r.h * k;
      ctx.fillStyle = r.kind === "hook" ? c.text : c.block;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      const n = Math.max(1, r.lines.length);
      let px = (h / n) * 0.6;
      ctx.font = `600 ${px}px ${c.sans}`;
      const widest = Math.max(...r.lines.map((l) => ctx.measureText(l).width), 1);
      if (widest > w * 0.94) { px *= (w * 0.94) / widest; ctx.font = `600 ${px}px ${c.sans}`; }
      ctx.fillStyle = r.kind === "hook" ? c.page : c.onBlock;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      r.lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + (h / n) * (i + 0.5)));
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    if (d.state === "refused") {
      ctx.fillStyle = c.page;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function updateDom(force) {
    const now = performance.now();
    if (!force && now - lastDom < 200) return;
    lastDom = now;
    cell.t.textContent = `${num(t, 1)} s`;
    if (!plan) return;
    const ds = plan.deliverables;
    const n = { ready: 0, advisory: 0, refused: 0 };
    for (const d of ds) n[d.state]++;
    const crops = ds.filter((d) => d.keepX < 1 || d.keepY < 1);
    const windows = crops.reduce((a, d) => a + d.windows.length, 0);
    const lines = ds.reduce((a, d) => a + d.lines, 0);
    const loud = ds.filter((d) => d.loudness);
    const m = MIXES[Number(mix.value)];
    const social = loud.find((d) => d.loudness.target === -14) || loud[0];
    cell.n.textContent = fmt(ds.length);
    cell.ready.textContent = fmt(n.ready);
    cell.advisory.textContent = fmt(n.advisory);
    cell.refused.textContent = fmt(n.refused);
    cell.anchors.textContent = fmt(plan.anchors.length);
    cell.windows.textContent = fmt(windows);
    cell.lines.textContent = fmt(lines);
    cell.loud.textContent = social ? `${db(m[0], 2)} → ${db(social.loudness.target)}` : "–";
    cell.linear.textContent = loud.length ? `${loud.filter((d) => d.loudness.linear).length} of ${loud.length}` : "–";
    cell.replans.textContent = fmt(replans);
    cell.ms.textContent = `${num(lastMs, 1)} ms`;
    receipt.textContent = `planned ${ds.length} deliverables in ${num(lastMs, 1)} ms: ${plan.anchors.length} anchors from ${plan.samples} detector samples, ` +
      `${fmt(windows)} crop windows, ${fmt(lines)} caption lines, ${loud.length} loudness ${loud.length === 1 ? "plan" : "plans"}. ${fmt(replans)} plan ${replans === 1 ? "call" : "calls"} so far, ${fmt(Math.round(totalMs))} ms in total, all in your browser.`;
    canvas.setAttribute("aria-label", `Source frame at ${num(t, 1)} s with the subject, its detector boxes and each crop window; ` +
      `timeline of hook, caption cues, shots and anchors. Arrow keys move the subject. ${n.ready} ready, ${n.advisory} advisory, ${n.refused} refused.`);
  }

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && !drag) {
      t += (dt / 1000) * Number(speed.value);
      if (t >= duration()) t = 0;
    }
    const octx = off.getContext("2d");
    drawScene(octx, off.width, off.height, t, false);
    draw(ts);
    updateDom(false);
    if ((playing || drag || ts - replanAt < FADE_MS) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    kick();
  }

  // Platforms.
  function buildPlats() {
    const byKey = new Map(info.targets.map((x) => [x.key, x]));
    for (const k of ORDER) {
      const s = byKey.get(k);
      if (!s) continue;
      const b = button(k, "adf-plat");
      b.setAttribute("aria-pressed", "true");
      b.title = `${s.label}, ${s.aspect}`;
      b.addEventListener("click", () => {
        if (on.has(k) && on.size === 1) { status.textContent = "Keep at least one platform on: the anchors are solved against the tightest crop you ship."; return; }
        if (on.has(k)) on.delete(k); else on.add(k);
        b.setAttribute("aria-pressed", String(on.has(k)));
        replan(`${on.has(k) ? "switched on" : "switched off"} ${k}`).then(kick);
      });
      plats.append(b);
    }
  }

  // Dragging the subject.
  const local = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: (e.clientX - b.left) / G.fw, y: (e.clientY - b.top) / G.fh, inFrame: e.clientY - b.top <= G.fh };
  };
  const pathY = (y) => clamp(y, 0.04, 0.6);
  function moveTo(p, grab) {
    if (shotA(t)) {
      const s = subjectAt(t);
      const dx = p.x - grab.dx - s.x;
      const span = scene.x1 - scene.x0;
      const nx0 = clamp(scene.x0 + dx, 0.06, 0.94 - Math.max(0, span));
      scene.x0 = nx0;
      scene.x1 = clamp(nx0 + span, 0.06, 0.94);
      scene.y = pathY(p.y - grab.dy);
    } else {
      scene.px = clamp(p.x - grab.dx, 0.02, 0.84);
      scene.py = clamp(p.y - grab.dy, 0.05, 0.5);
    }
  }
  function grabOf(p) {
    const s = subjectAt(t);
    if (s.kind === "a") return { dx: p.x - s.x, dy: p.y - scene.y };
    return { dx: p.x - scene.px, dy: p.y - scene.py };
  }
  function hits(p) {
    const s = subjectAt(t);
    const b = s.kind === "a" ? s.human : s.product;
    return p.x >= b[0] - 0.04 && p.x <= b[0] + b[2] + 0.04 && p.y >= b[1] - 0.06 && p.y <= b[1] + b[3] + 0.04;
  }
  const what = () => (shotA(t) ? "moved the presenter" : "moved the product");
  canvas.addEventListener("pointerdown", (e) => {
    if (!G || !plan) return;
    const p = local(e);
    if (!p.inFrame) {
      const r = canvas.getBoundingClientRect();
      t = clamp(((e.clientX - r.left - 8) / (G.W - 16)) * DUR, 0, duration() - 0.01);
      draw(performance.now());
      updateDom(true);
      return;
    }
    drag = { grab: hits(p) ? grabOf(p) : { dx: 0, dy: shotA(t) ? 0.065 : 0.15 } };
    canvas.setPointerCapture(e.pointerId);
    moveTo(p, drag.grab);
    replan(`You ${what()}`);
    kick();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!G) return;
    const p = local(e);
    if (drag) { moveTo(p, drag.grab); replan(`You ${what()}`); return; }
    const h = p.inFrame && hits(p);
    if (h !== hoverSubject) { hoverSubject = h; canvas.classList.toggle("adf-grab", h); if (!raf) draw(performance.now()); }
  });
  const endDrag = () => { if (drag) { drag = null; kick(); } };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { if (hoverSubject) { hoverSubject = false; canvas.classList.remove("adf-grab"); if (!raf) draw(performance.now()); } });
  canvas.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] }[e.key];
    if (!d || !plan) return;
    e.preventDefault();
    const s = subjectAt(t);
    const cur = s.kind === "a" ? { x: s.x, y: scene.y } : { x: scene.px, y: scene.py };
    moveTo({ x: cur.x + d[0], y: cur.y + d[1] }, { dx: 0, dy: 0 });
    replan(`You ${what()}`).then(() => { draw(performance.now()); kick(); });
  });

  // Inputs.
  const fail = (err) => { status.textContent = err.message; };
  let hookTimer = 0;
  hook.addEventListener("input", () => {
    clearTimeout(hookTimer);
    hookTimer = setTimeout(() => replan("You edited the hook").then(kick).catch(fail), 150);
  });
  hookPos.addEventListener("change", () => replan(`You put the hook at ${POS.find(([v]) => v === hookPos.value)[1]}`).then(kick).catch(fail));
  capPos.addEventListener("change", () => replan(`You put the captions at ${POS.find(([v]) => v === capPos.value)[1]}`).then(kick).catch(fail));
  source.addEventListener("change", () => replan(`Source set to ${source.value.replace("x", "×")}`).then(kick).catch(fail));
  cut.addEventListener("change", () => { if (t >= duration()) t = 0; replan(`Cut set to ${CUTS.find(([v]) => String(v) === cut.value)[1]}`).then(kick).catch(fail); });
  mix.addEventListener("change", () => replan(`Mix set to ${mix.selectedOptions[0].textContent}`).then(kick).catch(fail));
  track.addEventListener("change", () => replan(track.checked ? "Following motion within each shot" : "One anchor per shot").then(kick).catch(fail));
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    t = (t + 0.25) % duration();
    drawScene(off.getContext("2d"), off.width, off.height, t, false);
    draw(performance.now());
    updateDom(true);
  });
  reset.addEventListener("click", () => {
    Object.assign(scene, { x0: 0.22, x1: 0.62, y: 0.38, px: 0.7, py: 0.3 });
    hook.value = "One clip, every feed";
    hookPos.value = "tc"; capPos.value = "bc"; source.value = "3840x2160"; cut.value = "0"; mix.value = "0"; track.checked = true;
    on = new Set(ORDER);
    for (const b of plats.children) b.setAttribute("aria-pressed", "true");
    t = reduce.matches ? STILL_AT : 0;
    you.textContent = "";
    replan(null).then(() => setPlaying(!reduce.matches)).catch(fail);
  });

  new ResizeObserver(() => { if (!root.isConnected) return; layout(); readColors(); draw(performance.now()); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const recolor = () => { readColors(); drawScene(off.getContext("2d"), off.width, off.height, t, false); draw(performance.now()); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
  addEventListener("themechange", recolor);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  info = await demo.call("targets", {});
  buildPlats();
  readColors();
  layout();
  await replan(null);
  drawScene(off.getContext("2d"), off.width, off.height, t, false);
  draw(performance.now());
  setPlaying(playing);
}
