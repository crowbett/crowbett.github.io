// strata demo: strata's real Rust slicing engine, compiled to WebAssembly.
// Load a built-in calibration model or the visitor's own STL, OBJ or 3MF,
// slice it with default settings, and scrub its layers' toolpaths on a canvas.
const KINDS = {
  Skirt: "Skirt",
  OuterWall: "Outer wall",
  InnerWall: "Inner wall",
  TopSurface: "Top surface",
  SolidInfill: "Solid infill",
  SparseInfill: "Sparse infill",
  GapFill: "Gap fill",
  Bridge: "Bridge",
  Support: "Support",
  SupportInterface: "Support interface",
  Ironing: "Ironing",
};
const FILE = "file";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const mm = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function field(label, input) {
  const wrap = el("label", "st-field");
  wrap.append(el("span", "st-label", label), input);
  return wrap;
}

function base64(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function mount(root, demo) {
  const css = el("link");
  css.rel = "stylesheet";
  css.href = new URL("./ui.css", import.meta.url).href;
  const cssReady = new Promise((r) => { css.onload = r; css.onerror = r; });
  document.head.append(css);

  const info = await demo.call("models", {});

  const form = el("form", "st-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const model = el("select");
  model.name = "model";
  for (const m of info.models) {
    const o = el("option", null, m.name);
    o.value = m.id;
    model.append(o);
  }
  const height = el("select");
  height.name = "layerHeight";
  for (const h of info.layerHeights) {
    const o = el("option", null, `${h} mm`);
    o.value = String(h);
    o.selected = h === 0.2;
    height.append(o);
  }
  const file = el("input");
  Object.assign(file, { type: "file", name: "file", accept: ".stl,.obj,.3mf", hidden: true });
  const pick = el("button", "secondary", "Open your own model");
  pick.type = "button";
  pick.addEventListener("click", () => file.click());
  form.append(field("Model", model), field("Layer height", height), pick, file);

  const summary = el("p", "st-summary");
  summary.setAttribute("aria-live", "polite");

  const scrub = el("input");
  Object.assign(scrub, { type: "range", name: "layer", min: 0, max: 0, step: 1, value: 0 });
  scrub.id = "st-layer";
  const where = el("output", "st-where");
  where.htmlFor = scrub.id;
  const scrubLabel = el("label", "st-label", "Layer");
  scrubLabel.htmlFor = scrub.id;
  const scrubHead = el("div", "st-scrub-h");
  scrubHead.append(scrubLabel, where);
  const scrubRow = el("div", "st-scrub");
  scrubRow.append(scrubHead, scrub);

  const canvas = el("canvas", "st-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "st-legend");
  const note = el("p", "st-note");
  root.replaceChildren(form, summary, scrubRow, canvas, legend, note);

  // One loop issues every engine call, in order, and records each answer as
  // the engine's state; controls only change what is wanted and start it.
  let engine = { key: null, value: null, label: null, meta: null, slice: null, sliceFail: null };
  let desired = null;
  let shown = null;
  let want = 0;
  let slices = 0;
  let files = 0;
  let busy = null;
  let mounted = false;

  const colors = () => {
    const s = getComputedStyle(root);
    const c = {};
    for (const k of Object.keys(KINDS)) c[k] = s.getPropertyValue(`--st-${k}`).trim();
    c.open = s.getPropertyValue("--danger").trim();
    return c;
  };

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const sl = engine.slice;
    if (!sl || !shown) return;
    const [x0, y0, x1, y1] = sl.bounds;
    const pad = 12 * dpr;
    const scale = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1), (h - 2 * pad) / Math.max(y1 - y0, 1));
    const ox = (w - (x1 - x0) * scale) / 2 - x0 * scale;
    const oy = (h + (y1 - y0) * scale) / 2 + y0 * scale;
    const c = colors();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const trace = (pts, closed) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const x = ox + pts[i] * scale;
        const y = oy - pts[i + 1] * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (closed) ctx.closePath();
      ctx.stroke();
    };
    ctx.lineWidth = Math.max(dpr, sl.lineWidth * scale * 0.85);
    for (const p of shown.paths) {
      ctx.strokeStyle = c[p.kind] || c.Skirt;
      trace(p.points, p.closed);
    }
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeStyle = c.open;
    for (const pts of shown.open) trace(pts, false);
    ctx.setLineDash([]);
  }

  function describe() {
    const n = engine.slice.layers;
    const counts = new Map();
    for (const p of shown.paths) counts.set(p.kind, (counts.get(p.kind) || 0) + 1);
    where.textContent = `${shown.index + 1} of ${fmt(n)} · z ${mm(shown.z)} mm`;
    scrub.setAttribute("aria-valuetext", `Layer ${shown.index + 1} of ${n}, z ${mm(shown.z)} mm`);
    canvas.setAttribute("aria-label", `Toolpaths of layer ${shown.index + 1} of ${n} at z ${mm(shown.z)} mm: ${shown.paths.length} paths`);
    legend.replaceChildren(...Object.keys(KINDS).filter((k) => counts.has(k)).map((k) => {
      const s = el("span", "st-key", `${KINDS[k]} ${counts.get(k)}`);
      s.dataset.kind = k;
      s.style.setProperty("--st-c", `var(--st-${k})`);
      return s;
    }));
    if (shown.open.length) {
      const s = el("span", "st-key", `Open contour ${shown.open.length}`);
      s.dataset.kind = "open";
      s.style.setProperty("--st-c", "var(--danger)");
      legend.append(s);
    }
  }

  function clearView(text) {
    shown = null;
    legend.replaceChildren();
    where.textContent = "";
    canvas.setAttribute("aria-label", text);
    draw();
  }

  async function reconcile() {
    for (;;) {
      if (desired.key !== engine.key) {
        const d = desired;
        summary.textContent = `Loading ${d.label}…`;
        try {
          const meta = await demo.call("load", d.params);
          engine = { key: d.key, value: d.value, label: d.label, meta, slice: null, sliceFail: null };
        } catch (err) {
          if (!engine.key) throw err;
          // A failed load leaves the engine as it was.
          if (desired === d) {
            desired = { key: engine.key, value: engine.value, label: engine.label };
            restoreSelect();
          }
          summary.textContent = err.message;
        }
        continue;
      }
      const h = Number(height.value);
      if ((!engine.slice || engine.slice.height !== h) && engine.sliceFail !== h) {
        summary.textContent = `Slicing ${engine.label}…`;
        let s, ms;
        try {
          const t0 = performance.now();
          s = await demo.call("slice", { layerHeight: h });
          ms = performance.now() - t0;
        } catch (err) {
          if (!mounted) throw err;
          engine.slice = null;
          engine.sliceFail = h;
          clearView("Nothing sliced");
          summary.textContent = err.message;
          note.textContent = "";
          continue;
        }
        const last = Number(scrub.max);
        const frac = last > 0 ? Number(scrub.value) / last : 0.4;
        engine.slice = { ...s, height: h, id: ++slices };
        engine.sliceFail = null;
        scrub.max = String(Math.max(0, s.layers - 1));
        want = Math.round(frac * Math.max(0, s.layers - 1));
        scrub.value = String(want);
        const m = engine.meta;
        const [sx, sy, sz] = m.size;
        summary.textContent =
          `${m.name}: ${fmt(m.triangles)} triangles, ${mm(sx)} × ${mm(sy)} × ${mm(sz)} mm. ` +
          `Sliced into ${fmt(s.layers)} layers of ${fmt(s.paths)} toolpaths, ${mm(s.extrusionM)} m in all, ` +
          `in ${fmt(Math.round(ms))} ms in your browser.`;
        note.textContent = [
          m.repair.flipped + m.repair.holesFilled
            ? `Import repair flipped ${fmt(m.repair.flipped)} triangles and filled ${fmt(m.repair.holesFilled)} holes.`
            : "",
          s.openChains ? `${fmt(s.openChains)} open contours: the mesh has holes repair could not close, and they get no toolpaths.` : "",
          s.layers ? "" : "The model is too thin to give a layer at this height.",
        ].filter(Boolean).join(" ");
        if (!s.layers) clearView("No layers");
        continue;
      }
      const sl = engine.slice;
      if (sl && sl.layers && (!shown || shown.slice !== sl.id || shown.index !== want)) {
        const r = await demo.call("layer", { index: want });
        shown = { ...r, slice: sl.id };
        describe();
        draw();
        continue;
      }
      return;
    }
  }

  const kick = () => {
    if (!busy) busy = reconcile().finally(() => { busy = null; });
    return busy;
  };
  const go = () => kick().catch((err) => { summary.textContent = err.message; });

  function fileOption(label) {
    let opt = model.querySelector(`option[value="${FILE}"]`);
    if (!opt) {
      opt = el("option");
      opt.value = FILE;
      model.append(opt);
    }
    opt.textContent = label;
  }

  function restoreSelect() {
    if (engine.value === FILE) fileOption(engine.label);
    else model.querySelector(`option[value="${FILE}"]`)?.remove();
    model.value = engine.value;
  }

  const builtIn = () => {
    model.querySelector(`option[value="${FILE}"]`)?.remove();
    return { key: model.value, value: model.value, label: model.selectedOptions[0].textContent, params: { model: model.value } };
  };
  model.addEventListener("change", () => {
    desired = builtIn();
    go();
  });
  height.addEventListener("change", go);
  scrub.addEventListener("input", () => {
    want = Number(scrub.value);
    go();
  });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    if (f.size > info.maxFileBytes) {
      summary.textContent = `${f.name} is over ${info.maxFileBytes / 1048576} MiB.`;
      return;
    }
    const params = { file: base64(await f.arrayBuffer()), name: f.name };
    desired = { key: `${FILE}:${++files}`, value: FILE, label: f.name, params };
    fileOption(f.name);
    model.value = FILE;
    go();
  });

  new ResizeObserver(() => draw()).observe(canvas);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);

  await cssReady;
  desired = builtIn();
  await kick();
  mounted = true;
  if (!shown) throw new Error(summary.textContent);
}
