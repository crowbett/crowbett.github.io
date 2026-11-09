// The call timeline under a live demo: one bar per call to the binary, as tall
// as the time the worker measured inside it (log scale), coloured by method,
// red when it failed. Point at or step to a bar to read the call: its params,
// result and JSON sizes.
const root = document.querySelector("[data-timeline]");
const KEEP = 400; // calls kept
const RESULTS = 40; // newest calls whose result is kept for reading
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
export const ms = (v) => (v < 0.01 ? "<0.01 ms" : v < 10 ? `${v.toFixed(2)} ms` : v < 1000 ? `${v.toFixed(0)} ms` : `${(v / 1000).toFixed(2)} s`);
export const bytes = (n) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`);

// brief is a value as short JSON: long arrays, strings and deep objects elided.
function brief(v, depth = 0) {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v) ?? "null";
    return s.length > 42 ? `${s.slice(0, 40)}…"` : s;
  }
  if (depth > 2) return Array.isArray(v) ? `[… ${v.length}]` : "{…}";
  if (Array.isArray(v)) {
    const head = v.slice(0, 4).map((x) => brief(x, depth + 1));
    return `[${head.join(", ")}${v.length > 4 ? `, … ${(v.length - 4).toLocaleString("en-US")} more` : ""}]`;
  }
  const ks = Object.keys(v);
  const body = ks.slice(0, 8).map((k) => `${k}: ${brief(v[k], depth + 1)}`);
  return `{${body.join(", ")}${ks.length > 8 ? `, … ${ks.length - 8} more` : ""}}`;
}
const cap = (s) => (s.length > 360 ? `${s.slice(0, 359)}…` : s);

if (root) {
  const slug = root.dataset.timeline;
  const canvas = root.querySelector("canvas");
  const sum = root.querySelector("[data-tl-sum]");
  const detail = root.querySelector("[data-tl-detail]");
  const ctx = canvas.getContext("2d");
  const calls = [];
  const methods = new Map();
  let n = 0, sel = -1, pinned = false, raf = 0, shown = 0, stopped = "";

  const colors = () => {
    const cs = getComputedStyle(root);
    const v = (k) => cs.getPropertyValue(k).trim();
    return { set: [v("--accent"), v("--live"), v("--signal"), v("--block"), v("--text-2")], bad: v("--danger"), grid: v("--line"), ink: v("--text"), dim: v("--text-3") };
  };
  let C = colors();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { C = colors(); draw(); });
  addEventListener("themechange", () => { C = colors(); draw(); });

  const BAR = 5, GAP = 2, TOP = 6;
  // Height for a time: 0.01 ms at the floor, 1 s at the top.
  const h = (v, H) => Math.max(2, Math.min(1, (Math.log10(Math.max(v, 0.01)) + 2) / 5) * (H - TOP));
  const fit = () => Math.max(1, Math.floor((canvas.clientWidth - 48) / (BAR + GAP)));
  const visible = () => {
    const end = pinned && sel >= 0 ? Math.max(sel + 1, Math.min(calls.length, sel + 1 + Math.floor(fit() / 2))) : calls.length;
    return [Math.max(0, end - fit()), end];
  };

  function draw() {
    raf = 0;
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "bottom";
    for (const [v, label] of [[0.1, "0.1 ms"], [10, "10 ms"], [1000, "1 s"]]) {
      const y = Math.round(H - h(v, H)) + 0.5;
      ctx.textBaseline = v === 1000 ? "top" : "bottom";
      ctx.fillStyle = C.grid;
      ctx.fillRect(44, y, W - 44, 1);
      ctx.fillStyle = C.dim;
      ctx.fillText(label, 0, v === 1000 ? y - 0.5 : y - 1);
    }
    const [a, b] = visible();
    for (let i = a; i < b; i++) {
      const c = calls[i];
      const x = W - (b - i) * (BAR + GAP);
      const bh = c.error ? H - TOP : h(c.ms ?? c.rtt, H);
      ctx.globalAlpha = sel < 0 || i === sel ? 1 : 0.55;
      ctx.fillStyle = c.error ? C.bad : C.set[methods.get(c.method) % C.set.length];
      ctx.fillRect(x, H - bh, BAR, bh);
      if (i === sel) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.ink;
        ctx.fillRect(x - 1, 0, BAR + 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }
  const queue = () => { if (!raf) raf = requestAnimationFrame(draw); };
  new ResizeObserver(queue).observe(canvas);

  function show(i) {
    const c = calls[i];
    if (!c) return;
    const head = el("p", "tl-dh");
    head.append(el("b", null, `#${c.n} ${c.method}`), " ", el("span", null,
      `${c.ms !== undefined ? `${ms(c.ms)} in the binary · ` : ""}${ms(c.rtt)} round trip · ${(c.t / 1000).toFixed(1)} s after the page loaded`));
    const dl = el("dl");
    const row = (k, ...v) => { const d = el("div"); d.append(el("dt", null, k), el("dd")); d.lastChild.append(...v); dl.append(d); };
    row("params", el("code", null, cap(brief(c.params))));
    if (c.error) row("error", el("code", "tl-bad", c.error));
    else row("result", el("code", null, "result" in c ? cap(brief(c.result)) : "not kept: only the newest calls keep theirs"));
    if (c.inB !== undefined) row("JSON", `${bytes(c.inB)} in · ${bytes(c.outB)} out`);
    detail.replaceChildren(head, dl);
    canvas.setAttribute("aria-valuenow", String(i + 1));
    canvas.setAttribute("aria-valuetext", `call ${c.n}: ${c.method}${c.error ? ", failed" : ""}, ${ms(c.ms ?? c.rtt)}`);
    shown = performance.now();
  }
  const pick = (i, pin) => {
    sel = Math.max(0, Math.min(calls.length - 1, i));
    pinned = pin;
    show(sel);
    queue();
  };
  const follow = () => { pinned = false; sel = -1; if (calls.length) show(calls.length - 1); queue(); };

  function summary() {
    const recent = calls.slice(-100).map((c) => c.ms).filter((v) => v !== undefined).sort((x, y) => x - y);
    const med = recent.length ? recent[recent.length >> 1] : 0;
    const now = performance.now();
    const rate = calls.filter((c) => now - c.t < 1000).length;
    sum.textContent = `${n.toLocaleString("en-US")} call${n === 1 ? "" : "s"} · median ${ms(med)} in the binary · ${rate}/s${stopped ? ` · stopped: ${stopped}` : ""}`;
  }

  const add = (e, error) => {
    const d = e.detail;
    if (d.slug !== slug) return;
    n++;
    const c = { ...d, n, error };
    if (!methods.has(c.method)) methods.set(c.method, methods.size);
    calls.push(c);
    if (calls.length > KEEP) { calls.shift(); if (sel >= 0) sel--; }
    if (calls.length > RESULTS) delete calls[calls.length - 1 - RESULTS].result;
    canvas.setAttribute("aria-valuemax", String(calls.length));
    if (root.hidden) root.hidden = false;
    if (!pinned && performance.now() - shown > 250) show(calls.length - 1);
    summary();
    queue();
  };
  document.addEventListener("demo:call", (e) => add(e));
  document.addEventListener("demo:fail", (e) => add(e, e.detail.error));
  document.addEventListener("demo:stop", (e) => { if (e.detail.slug === slug) { stopped = e.detail.error; summary(); } });
  setInterval(() => { if (!root.hidden) { summary(); if (!pinned && calls.length) show(calls.length - 1); } }, 1000);

  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    const [a, b] = visible();
    const i = b - Math.ceil((r.right - e.clientX) / (BAR + GAP));
    return i >= a && i < b ? i : -1;
  };
  canvas.addEventListener("pointermove", (e) => { if (pinned) return; const i = at(e); if (i >= 0) { sel = i; show(i); queue(); } });
  canvas.addEventListener("pointerleave", () => { if (!pinned) follow(); });
  canvas.addEventListener("click", (e) => { const i = at(e); if (i < 0 || (pinned && i === sel)) follow(); else pick(i, true); });
  canvas.addEventListener("keydown", (e) => {
    const last = calls.length - 1;
    const cur = sel < 0 ? last : sel;
    const to = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: last, PageUp: cur - 10, PageDown: cur + 10 }[e.key];
    if (e.key === "Escape" && pinned) { e.preventDefault(); follow(); return; }
    if (to === undefined || last < 0) return;
    e.preventDefault();
    pick(to, true);
  });
}
