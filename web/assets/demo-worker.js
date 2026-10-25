// Runs one demo binary. Messages in: {id, type: "load", slug} then
// {id, type: "call", method, params}. Messages out: {id, result} or {id, error},
// and during a load {id, loaded} with the bytes of the binary received so far.
// The binary sets globalThis.__demo(method, paramsJSON) -> resultJSON and then
// calls globalThis.__demoReady(). See docs/demo-contract.md.

// memfs.js first: wasm_exec.js keeps an existing globalThis.fs.
importScripts("/assets/memfs.js", "/wasm/wasm_exec.js");

const READY_TIMEOUT_MS = 20000;

// fetchBinary streams the download so the page can show real progress. Pages
// serves .wasm gzipped, so Content-Length is the compressed size: progress
// counts decompressed bytes, which the page compares with the raw size.
async function fetchBinary(url, onLoaded) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: HTTP ${resp.status}`);
  if (!resp.body) return resp.arrayBuffer();
  const chunks = [];
  let loaded = 0;
  for (const reader = resp.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onLoaded(loaded, false);
  }
  onLoaded(loaded, true);
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return buf.buffer;
}

async function load(slug, onLoaded) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("bad demo name");
  let reportReady;
  const ready = new Promise((resolve) => { reportReady = resolve; });
  globalThis.__demoReady = () => reportReady();
  const bin = await fetchBinary(`/wasm/${slug}.wasm`, onLoaded);
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(bin, go.importObject);
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
    let last = -Infinity;
    const onLoaded = (loaded, final) => {
      const now = performance.now();
      if (!final && now - last < 50) return;
      last = now;
      self.postMessage({ id, loaded });
    };
    const result = type === "load" ? await load(e.data.slug, onLoaded) : call(e.data.method, e.data.params);
    self.postMessage({ id, result: result ?? null });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
