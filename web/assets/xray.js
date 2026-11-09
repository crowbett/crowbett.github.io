// X-ray: the X key (or the demo's X-ray button) outlines what is running on
// the page and opens a panel of live numbers, every one measured in this tab
// or read from the build's lock: the binary, its worker, its memory, its calls
// and the bytes the page loaded.
import { bytes, ms } from "/assets/timeline.js";

const demo = document.querySelector("[data-demo]");
const slug = demo?.dataset.demo;
const buttons = [...document.querySelectorAll("[data-xray]")];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const num = (v) => v.toLocaleString("en-US");

let panel = null, tick = 0, worker = "not started", mem = 0, total = 0, inB = 0, outB = 0;
const recent = []; // [t, ms in the binary] for the last second

if (slug) {
  document.addEventListener("demo:call", (e) => {
    const d = e.detail;
    if (d.slug !== slug) return;
    worker = "running";
    total++;
    mem = d.mem || mem;
    inB += d.inB || 0;
    outB += d.outB || 0;
    recent.push([d.t + d.rtt, d.ms || 0]);
  });
  document.addEventListener("demo:stop", (e) => { if (e.detail.slug === slug) worker = `stopped: ${e.detail.error}`; });
  demo.addEventListener("demoready", () => { if (worker === "not started") worker = "running"; });
}

// What the browser fetched for this page, by kind, decoded (Resource Timing).
function loaded() {
  const kinds = { HTML: 0, CSS: 0, JS: 0, fonts: 0, media: 0 };
  const nav = performance.getEntriesByType("navigation")[0];
  kinds.HTML = nav?.decodedBodySize || 0;
  let n = 1;
  for (const r of performance.getEntriesByType("resource")) {
    const p = new URL(r.name).pathname;
    const k = /\.css$/.test(p) ? "CSS" : /\.m?js$/.test(p) ? "JS" : /\.woff2$/.test(p) ? "fonts" : /\.(webp|png|mp4|svg)$/.test(p) ? "media" : null;
    if (!k || !r.decodedBodySize) continue;
    kinds[k] += r.decodedBodySize;
    n++;
  }
  return { kinds, n };
}

// Outlines and their tags live on one fixed layer over the page, placed on
// each frame from the element's box, so nothing in the page moves or clips.
const tags = [];
let layer = null, frame = 0;
function tag(sel, text) {
  const t = document.querySelector(sel);
  if (!t) return;
  const box = el("span", "xr-box");
  box.append(el("span", "xr-tag", text));
  layer.append(box);
  tags.push([t, box]);
}
function place() {
  for (const [t, box] of tags) {
    const r = t.getBoundingClientRect();
    box.hidden = !r.width || r.bottom < 0 || r.top > innerHeight;
    box.classList.toggle("in", r.top < 96);
    box.style.setProperty("translate", `${r.left}px ${r.top}px`);
    box.style.setProperty("width", `${r.width}px`);
    box.style.setProperty("height", `${r.height}px`);
  }
  frame = requestAnimationFrame(place);
}

function build() {
  panel = el("aside", "xr");
  panel.setAttribute("aria-label", "X-ray");
  const head = el("p", "xr-h");
  const close = el("button", "xr-x", "Close");
  close.type = "button";
  close.addEventListener("click", () => toggle(false));
  head.append(el("b", null, "X-ray"), el("span", null, "measured live in this tab"), close);
  const dl = el("dl");
  panel.append(head, dl);
  document.body.append(panel);
}

const row = (dl, k, v) => { const d = el("div"); d.append(el("dt", null, k), el("dd", null, v)); dl.append(d); };
function paint() {
  const dl = panel.querySelector("dl");
  dl.replaceChildren();
  if (slug) {
    const d = demo.dataset;
    row(dl, "binary", `${d.built} → WebAssembly · ${num(Number(d.bytes))} B, ${num(Number(d.gz))} B gzipped · sha256 ${d.sha}`);
    if (d.ref) row(dl, "source", `commit ${d.ref}`);
    row(dl, "worker", worker);
    row(dl, "memory", mem ? `${bytes(mem)} of linear memory` : "not measured yet");
    const now = performance.now();
    while (recent.length && now - recent[0][0] > 1000) recent.shift();
    const busy = recent.reduce((a, [, v]) => a + v, 0);
    row(dl, "calls", `${num(total)} in all · ${recent.length} in the last second`);
    row(dl, "busy", `${ms(busy)} inside the binary in the last second (${(busy / 10).toFixed(1)}\u00a0%)`);
    row(dl, "JSON", `${bytes(inB)} sent in · ${bytes(outB)} back`);
  }
  const { kinds, n } = loaded();
  row(dl, "page", `${Object.entries(kinds).filter(([, v]) => v).map(([k, v]) => `${k} ${bytes(v)}`).join(" · ")} · ${n} files, decoded`);
}

function toggle(on = !document.documentElement.hasAttribute("data-xray")) {
  document.documentElement.toggleAttribute("data-xray", on);
  for (const b of buttons) b.setAttribute("aria-pressed", String(on));
  if (on) {
    if (!panel) build();
    panel.hidden = false;
    layer ??= document.body.appendChild(el("div", "xr-layer"));
    layer.setAttribute("aria-hidden", "true");
    layer.hidden = false;
    const d = demo?.dataset;
    const ui = performance.getEntriesByType("resource").find((r) => r.name.endsWith(`/demos/${slug}/ui.js`));
    if (slug) tag(".demo-mount", `ui.js${ui?.decodedBodySize ? ` · ${bytes(ui.decodedBodySize)}` : ""} · main thread · draws the demo`);
    if (slug) tag(".demo-head", `Web Worker · ${d.built} → WebAssembly · ${bytes(Number(d.bytes))}, ${bytes(Number(d.gz))} gzipped`);
    tag("[data-timeline]:not([hidden])", "timeline.js · each call timed in the worker");
    tag(".project-info .body", "Markdown, rendered to HTML at build time");
    paint();
    place();
    tick = setInterval(paint, 500);
  } else {
    clearInterval(tick);
    if (panel) panel.hidden = true;
    cancelAnimationFrame(frame);
    if (layer) { layer.replaceChildren(); layer.hidden = true; }
    tags.length = 0;
  }
}

for (const b of buttons) b.addEventListener("click", () => toggle());
const typing = (t) => t instanceof Element && t.closest("input, textarea, select, [contenteditable], .demo-mount, dialog");
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
  if (e.key === "x") toggle();
  else if (e.key === "Escape" && document.documentElement.hasAttribute("data-xray")) toggle(false);
});
