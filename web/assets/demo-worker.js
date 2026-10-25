// Runs one demo binary. Messages in: {id, type: "load", slug} then
// {id, type: "call", method, params}. Messages out: {id, result} or {id, error}.
// The binary sets globalThis.__demo(method, paramsJSON) -> resultJSON and then
// calls globalThis.__demoReady(). See docs/demo-contract.md.

importScripts("/wasm/wasm_exec.js");

const READY_TIMEOUT_MS = 20000;

async function load(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("bad demo name");
  let reportReady;
  const ready = new Promise((resolve) => { reportReady = resolve; });
  globalThis.__demoReady = () => reportReady();
  const resp = await fetch(`/wasm/${slug}.wasm`);
  if (!resp.ok) throw new Error(`fetch ${slug}.wasm: HTTP ${resp.status}`);
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(await resp.arrayBuffer(), go.importObject);
  go.run(instance).then(() => { globalThis.__demoExited = true; });
  // The clock starts after the download, so a slow link is not a failure.
  await Promise.race([ready, new Promise((_, reject) =>
    setTimeout(() => reject(new Error("demo binary did not report ready")), READY_TIMEOUT_MS))]);
}

function call(method, params) {
  if (globalThis.__demoExited) throw new Error("the demo stopped; reload the page to run it again");
  const raw = globalThis.__demo(method, JSON.stringify(params));
  if (typeof raw !== "string") {
    globalThis.__demoExited = true;
    throw new Error("the demo crashed; reload the page to run it again");
  }
  const out = JSON.parse(raw);
  if (out && typeof out === "object" && "error" in out) throw new Error(out.error);
  return out;
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    const result = type === "load" ? await load(e.data.slug) : call(e.data.method, e.data.params);
    self.postMessage({ id, result: result ?? null });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
