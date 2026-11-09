// Runs one demo binary. Messages in: {id, type: "load", slug} then
// {id, type: "call", method, params}. Messages out: {id, result} or {id, error},
// and during a load {id, loaded} with the bytes of the binary received so far.
// A call's answer also carries meta: {ms, inB, outB, mem} (see call).
// A Go binary sets globalThis.__demo(method, paramsJSON) -> resultJSON and then
// calls globalThis.__demoReady(). A Rust or C++ binary imports nothing and
// exports memory, demo_alloc, demo_call and demo_free, which rustBridge wraps
// as the same __demo.
// See docs/demo-contract.md.

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
  const mod = await WebAssembly.compile(await fetchBinary(`/wasm/${slug}.wasm`, onLoaded));
  if (WebAssembly.Module.imports(mod).some((i) => i.module === "gojs")) {
    const go = new Go();
    const inst = await WebAssembly.instantiate(mod, go.importObject);
    memory = inst.exports.mem;
    go.run(inst).then(() => { globalThis.__demoExited = true; });
  } else {
    const x = (await WebAssembly.instantiate(mod, {})).exports;
    memory = x.memory;
    globalThis.__demo = rustBridge(x);
    reportReady();
  }
  // The clock starts after the download, so a slow link is not a failure.
  await Promise.race([ready, new Promise((_, reject) =>
    setTimeout(() => reject(new Error("demo binary did not report ready")), READY_TIMEOUT_MS))]);
}

let memory = null;
const enc = new TextEncoder();
const dec = new TextDecoder();

// rustBridge copies both strings into the instance, calls it, and reads back
// a 4-byte little-endian length and that many bytes of JSON. A trap (a Rust
// panic aborts) returns undefined, which call reports as a crash.
function rustBridge(x) {
  for (const name of ["memory", "demo_alloc", "demo_call", "demo_free"]) {
    if (!(name in x)) throw new Error(`demo binary does not export ${name}`);
  }
  const put = (s) => {
    const b = enc.encode(s);
    const p = x.demo_alloc(b.length) >>> 0;
    new Uint8Array(x.memory.buffer, p, b.length).set(b);
    return [p, b.length];
  };
  return (method, params) => {
    try {
      const [mp, ml] = put(method);
      const [pp, pl] = put(params);
      const r = x.demo_call(mp, ml, pp, pl) >>> 0;
      x.demo_free(mp, ml);
      x.demo_free(pp, pl);
      const n = new DataView(x.memory.buffer).getUint32(r, true);
      const out = dec.decode(new Uint8Array(x.memory.buffer, r + 4, n));
      x.demo_free(r, n + 4);
      return out;
    } catch (err) {
      console.error("demo binary trapped:", err);
      return undefined;
    }
  };
}

// call also measures the call: its time inside the binary, the JSON in and
// out, and the binary's linear memory after it, for the page's timeline.
function call(method, params, meta) {
  if (globalThis.__demoExited) throw new Error("the demo stopped; reload the page to run it again");
  const json = JSON.stringify(params);
  const t0 = performance.now();
  const raw = globalThis.__demo(method, json);
  meta.ms = performance.now() - t0;
  meta.inB = json.length;
  meta.outB = typeof raw === "string" ? raw.length : 0;
  meta.mem = memory?.buffer.byteLength ?? 0;
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
  const meta = {};
  try {
    let last = -Infinity;
    const onLoaded = (loaded, final) => {
      const now = performance.now();
      if (!final && now - last < 50) return;
      last = now;
      self.postMessage({ id, loaded });
    };
    const result = type === "load" ? await load(e.data.slug, onLoaded) : call(e.data.method, e.data.params, meta);
    self.postMessage({ id, result: result ?? null, meta });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err), meta });
  }
};
