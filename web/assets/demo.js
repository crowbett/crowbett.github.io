// Starts a project's live demo on request. A Web Worker runs the project's
// real code (Go compiled to WebAssembly) and answers JSON RPC calls; the
// project's ui.js renders the controls. Contract: docs/demo-contract.md.

const CALL_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 180000; // includes the download on a slow link

// connect loads /wasm/<slug>.wasm in a worker and resolves to a client once
// the binary has registered its handler. A call that times out kills the
// worker: a stuck binary must not keep burning a core.
export function connect(slug, { callTimeoutMs = CALL_TIMEOUT_MS, loadTimeoutMs = LOAD_TIMEOUT_MS } = {}) {
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
    const { id, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
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

async function start(section) {
  const button = section.querySelector("[data-demo-start]");
  const status = section.querySelector("[data-demo-status]");
  const mountEl = section.querySelector("[data-demo-mount]");
  button.disabled = true;
  status.textContent = "Loading…";
  const connecting = connect(section.dataset.demo);
  try {
    const [ui, demo] = await Promise.all([import(section.dataset.ui), connecting]);
    await ui.mount(mountEl, demo);
    status.textContent = "";
    section.dataset.demoReady = "";
  } catch (err) {
    console.error(err);
    status.textContent = `The demo failed to start: ${err.message}`;
    section.dataset.demoError = "";
    connecting.then((d) => d.close(), () => {});
    button.disabled = false;
  }
}

for (const section of document.querySelectorAll("[data-demo]")) {
  section.querySelector("[data-demo-start]").addEventListener("click", () => start(section));
}
