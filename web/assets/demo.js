// Starts a project's live demo, on request or, in a project head, on its own
// once it is on screen (see autostart). A Web Worker runs the project's
// real code (Go or Rust compiled to WebAssembly) and answers JSON RPC calls; the
// project's ui.js renders the controls. Contract: docs/demo-contract.md.
// Home panels (panel.js) and the live wall (wall.js) start demos through run.

const CALL_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 180000; // includes the download on a slow link

// connect loads /wasm/<slug>.wasm in a worker and resolves to a client once
// the binary has registered its handler. onProgress gets the decompressed
// bytes received so far. A call that times out kills the worker: a stuck
// binary must not keep burning a core.
export function connect(slug, { callTimeoutMs = CALL_TIMEOUT_MS, loadTimeoutMs = LOAD_TIMEOUT_MS, onProgress } = {}) {
  const worker = new Worker("/assets/demo-worker.js");
  const pending = new Map();
  let next = 0;
  let dead = null;

  const fail = (err) => {
    if (dead) return;
    dead = err;
    worker.terminate();
    document.dispatchEvent(new CustomEvent("demo:stop", { detail: { slug, error: err.message } }));
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  };
  worker.onerror = (e) => { e.preventDefault(); fail(new Error(e.message || "demo worker crashed")); };
  worker.onmessage = (e) => {
    const { id, result, error, loaded, meta } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (loaded !== undefined) { if (onProgress) onProgress(loaded); return; }
    pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(Object.assign(new Error(error), { meta })); else p.resolve({ result, meta });
  };

  const send = (msg, timeoutMs) => new Promise((resolve, reject) => {
    if (dead) { reject(dead); return; }
    const id = ++next;
    const timer = setTimeout(() => {
      fail(new Error(`demo did not answer ${msg.method || msg.type} within ${timeoutMs / 1000}s and was stopped; reload the page to run it again`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, ...msg });
  });

  const client = {
    slug,
    // Each call is announced with what the worker measured: "demo:call" when
    // it answers, "demo:fail" when not.
    call: (method, params = {}) => {
      const t = performance.now();
      const tell = (type, meta, extra) => document.dispatchEvent(new CustomEvent(type, {
        detail: { slug, method, params, t, rtt: performance.now() - t, ...meta, ...extra },
      }));
      return send({ type: "call", method, params }, callTimeoutMs).then(
        ({ result, meta }) => { tell("demo:call", meta, { result }); return result; },
        (err) => { tell("demo:fail", err.meta, { error: err.message }); throw err; });
    },
    close: () => fail(new Error("demo closed")),
  };
  return send({ type: "load", slug }, loadTimeoutMs).then(() => client, (err) => { fail(err); throw err; });
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// progressRow shows download progress against the raw binary size from the
// page (data-bytes); without it the bar is indeterminate and counts KB.
function progressRow(section) {
  const total = Number(section.dataset.bytes) || 0;
  const row = el("div", "demo-load");
  const bar = el("progress", "demo-progress");
  bar.setAttribute("aria-label", "Download progress");
  if (total) bar.max = total;
  const pct = el("span", "demo-pct");
  pct.setAttribute("aria-hidden", "true");
  row.append(bar, pct);
  const update = (loaded) => {
    section.dataset.demoLoaded = loaded;
    if (total) {
      bar.value = Math.min(loaded, total);
      pct.textContent = loaded >= total ? "Starting…" : `${Math.floor((100 * loaded) / total)}%`;
    } else {
      pct.textContent = `${Math.round(loaded / 1024).toLocaleString("en-US")} KB`;
    }
  };
  // Labelled from the start, so the row never grows when the bytes arrive.
  pct.textContent = total ? "0%" : "0 KB";
  return { row, update };
}

// keyboardScroll makes every box in the mount that scrolls sideways reachable
// by Tab, so keyboard users can scroll it (Safari does not do this itself).
// It re-checks when the demo re-renders or the frame resizes.
function keyboardScroll(mountEl) {
  let queued = false;
  const check = () => {
    queued = false;
    for (const box of mountEl.querySelectorAll("*")) {
      const overflow = getComputedStyle(box).overflowX;
      const scrolls = (overflow === "auto" || overflow === "scroll") && box.scrollWidth > box.clientWidth;
      if (scrolls && box.tabIndex < 0) {
        box.tabIndex = 0;
        box.dataset.demoScroll = "";
        if (!box.getAttribute("role")) box.setAttribute("role", "region");
        if (!box.getAttribute("aria-label") && !box.getAttribute("aria-labelledby")) box.setAttribute("aria-label", "Scrollable area");
      } else if (!scrolls && "demoScroll" in box.dataset) {
        box.removeAttribute("tabindex");
        delete box.dataset.demoScroll;
      }
    }
  };
  const queue = () => { if (!queued) { queued = true; queueMicrotask(check); } };
  new MutationObserver(queue).observe(mountEl, { childList: true, subtree: true });
  new ResizeObserver(queue).observe(mountEl);
  check();
}

// run starts a binary into p.mount: the key reads "Loading…", progress shows
// where p.progressAt puts it, then the UI mounts and focus moves to it (not
// when the demo started on its own). p.onReady(ms) runs just before the
// section is marked ready. On failure the key becomes "Try again" and the
// status shows why. Aborting p.signal stops a start in progress quietly.
// Resolves to the demo client and the measured time, or null.
export async function run(section, p) {
  const { button, status, mount: mountEl, auto = false, signal } = p;
  const t0 = performance.now();
  button.disabled = true;
  button.textContent = "Loading…";
  mountEl.replaceChildren();
  delete section.dataset.demoError;
  delete section.dataset.demoLoaded;
  status.textContent = "Downloading the demo…";
  const progress = progressRow(section);
  p.progressAt(progress.row);
  const connecting = connect(p.slug, { onProgress: progress.update });
  const drop = () => connecting.then((d) => d.close(), () => {});
  signal?.addEventListener("abort", drop, { once: true });
  try {
    const [ui, demo] = await Promise.all([import(p.ui), connecting, p.css && sheet(p.css)]);
    if (signal?.aborted) throw signal.reason;
    await ui.mount(mountEl, demo);
    if (signal?.aborted) throw signal.reason;
    keyboardScroll(mountEl);
    status.textContent = "";
    progress.row.remove();
    const ms = performance.now() - t0;
    p.onReady?.(ms);
    section.dataset.demoReady = "";
    section.dispatchEvent(new Event("demoready", { bubbles: true }));
    // The mount, not its first control: focusing a text input raised a ring
    // that read as an error and can open a phone's keyboard (V8 round 7).
    // A demo that started on its own leaves focus where the visitor has it.
    mountEl.tabIndex = -1;
    if (!auto) mountEl.focus({ preventScroll: !!p.preventScroll });
    return { demo, ms };
  } catch (err) {
    progress.row.remove();
    drop();
    if (signal?.aborted) return null;
    console.error(err);
    status.replaceChildren(el("strong", null, "The demo failed to start."), " ", err.message);
    section.dataset.demoError = "";
    button.textContent = "Try again";
    button.disabled = false;
    if (!auto) button.focus();
    return null;
  }
}

// release takes a stopped demo off the page: its canvases give back their
// pixels (a UI's leftover listeners can keep a detached one alive), the mount
// empties and the demo's stylesheet goes until it runs again.
export function release(slug, mountEl) {
  for (const c of mountEl.querySelectorAll("canvas")) { c.width = 1; c.height = 1; }
  mountEl.replaceChildren();
  document.querySelector(`link[rel=stylesheet][href$="/demos/${slug}/ui.css"]`)?.remove();
}

// sheet links a stylesheet once and resolves when it has loaded (or failed).
const sheets = new Map();
export function sheet(href) {
  if (!sheets.has(href)) {
    const l = Object.assign(document.createElement("link"), { rel: "stylesheet", href });
    sheets.set(href, new Promise((r) => { l.onload = r; l.onerror = r; }));
    document.head.append(l);
  }
  return sheets.get(href);
}

// took formats a measured start time as the frame states it.
export const took = (ms) => `ready in ${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`}`;

// calm and lean are the home stage's rules for starting on its own: not with
// reduced motion, Save-Data, a 2g/3g link or fewer than 4 cores.
export const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export function lean() {
  const net = navigator.connection;
  return !!(net?.saveData || /(^|-)(2g|3g)$/.test(net?.effectiveType || "") || (navigator.hardwareConcurrency || 4) < 4);
}

function start(section, { auto = false } = {}) {
  const screen = section.querySelector(".ph-screen");
  return run(section, {
    slug: section.dataset.demo,
    ui: section.dataset.ui,
    button: section.querySelector("[data-demo-start]"),
    status: section.querySelector("[data-demo-status]"),
    mount: section.querySelector("[data-demo-mount]"),
    progressAt: (row) => section.querySelector(".demo-bar").after(row),
    auto,
    onReady: (ms) => {
      screen?.querySelector("video")?.pause();
      screen?.remove();
      stamp(section, ms);
    },
  });
}

// stamp puts the measured click-to-running time in the plate, left of the size
// so nothing already shown moves.
function stamp(section, ms) {
  const spec = section.querySelector(".demo-spec");
  if (!spec) return;
  spec.querySelector(".demo-took")?.remove();
  spec.prepend(el("span", "demo-took", `${took(ms)} · `));
}

// Full screen where the browser allows it on an element (not iPhone Safari):
// the demo frame fills the display and demos that track their width use it.
// The key's slot is laid out from the start, so showing it moves nothing.
function fullScreen(section) {
  const button = section.querySelector("[data-demo-full]");
  if (!button || !document.fullscreenEnabled) return;
  button.dataset.on = "";
  button.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else section.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    button.textContent = document.fullscreenElement === section ? "Exit full screen" : "Full screen";
  });
}

// autostart runs a project head's demo once the page has loaded and the frame
// is on screen, like the home stage: not with reduced motion, Save-Data, a
// 2g/3g link or fewer than 4 cores, where the recording and the key stay.
function autostart(section) {
  if (!("autostart" in section.dataset) || lean() || calm()) return;
  const button = section.querySelector("[data-demo-start]");
  const note = section.querySelector("[data-demo-note]");
  if (note) note.dataset.auto = "";
  const arm = () => {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (!button.disabled && !("demoReady" in section.dataset) && !("demoError" in section.dataset)) start(section, { auto: true });
    }, { threshold: 0.25 });
    io.observe(section);
  };
  if (document.readyState === "complete") arm();
  else addEventListener("load", arm, { once: true });
}

for (const section of document.querySelectorAll("[data-demo]")) {
  const button = section.querySelector("[data-demo-start]");
  button.addEventListener("click", () => start(section));
  autostart(section);
  fullScreen(section);
}
