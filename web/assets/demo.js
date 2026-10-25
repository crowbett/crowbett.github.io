// Starts a project's live demo on request. A Web Worker runs the project's
// real code (Go or Rust compiled to WebAssembly) and answers JSON RPC calls; the
// project's ui.js renders the controls. Contract: docs/demo-contract.md.

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
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  };
  worker.onerror = (e) => { e.preventDefault(); fail(new Error(e.message || "demo worker crashed")); };
  worker.onmessage = (e) => {
    const { id, result, error, loaded } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (loaded !== undefined) { if (onProgress) onProgress(loaded); return; }
    pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error)); else p.resolve(result);
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
    call: (method, params = {}) => send({ type: "call", method, params }, callTimeoutMs),
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

async function start(section) {
  const button = section.querySelector("[data-demo-start]");
  const status = section.querySelector("[data-demo-status]");
  const mountEl = section.querySelector("[data-demo-mount]");
  button.disabled = true;
  button.textContent = "Loading…";
  mountEl.replaceChildren();
  delete section.dataset.demoError;
  delete section.dataset.demoLoaded;
  status.textContent = "Downloading the demo…";
  const progress = progressRow(section);
  section.querySelector(".demo-bar").after(progress.row);
  const connecting = connect(section.dataset.demo, { onProgress: progress.update });
  try {
    const [ui, demo] = await Promise.all([import(section.dataset.ui), connecting]);
    await ui.mount(mountEl, demo);
    keyboardScroll(mountEl);
    status.textContent = "";
    progress.row.remove();
    section.dataset.demoReady = "";
    const first = mountEl.querySelector("button, input, select, textarea, a[href], [tabindex]");
    if (first) first.focus();
    else { mountEl.tabIndex = -1; mountEl.focus(); }
  } catch (err) {
    console.error(err);
    progress.row.remove();
    status.replaceChildren(el("strong", null, "The demo failed to start."), " ", err.message);
    section.dataset.demoError = "";
    connecting.then((d) => d.close(), () => {});
    button.textContent = "Try again";
    button.disabled = false;
    button.focus();
  }
}

for (const section of document.querySelectorAll("[data-demo]")) {
  section.querySelector("[data-demo-start]").addEventListener("click", () => start(section));
}
