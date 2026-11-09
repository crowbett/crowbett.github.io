// The terminal: a shell over every live demo. Each command that names a
// project boots that project's real binary in a worker (demo.js connect) and
// calls it; what comes back is printed as it came, with its size and the time
// measured around the call. Loaded on first use by nav.js (the ` key, the
// header's >_ key or the palette). A modal <dialog>: Escape closes it.
import { connect } from "/assets/demo.js";

const data = fetch("/search.json").then((r) => r.json());
let findP = null; // /find.json, every page's text and code, on first need
const found = () => (findP ??= fetch("/find.json").then((r) => r.json()).catch((e) => { findP = null; throw e; }));
let sink = null; // a pipe's first command writes here, not to the screen
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const MAX_LIVE = 3;
let dlg, out, input, label, opener;
let projects = [], bySlug = new Map();
let cwd = null, last = null, busy = false, stop = false;
const hist = [];
let hi = 0;
const live = new Map();
const stats = { boots: 0, bytes: 0, calls: 0, ms: 0 };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => `${Math.max(1, Math.round(n / 1024)).toLocaleString("en-US")} KB`;
const size = (n) => (n < 1024 ? `${n} B` : kb(n));
const dur = (ms) => (ms < 10 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

// line appends one output line; a part is text or [class, text].
function line(...parts) {
  const p = el("p");
  for (const x of parts) p.append(Array.isArray(x) ? el("span", x[0], x[1]) : x);
  (sink ?? out).append(p);
  out.scrollTop = out.scrollHeight;
  return p;
}
const dim = (t) => line(["tty-dim", t]);
// fail always reaches the screen, so a filter in a pipe cannot hide it.
const fail = (t) => { const s = sink; sink = null; line(["tty-err", "✗ "], t); sink = s; };

// json prints a value as indented JSON, trimmed to stay readable: long
// strings and arrays are cut with a count of what was left out, and the whole
// stops at 48 lines. `copy` copies the full value.
function json(v) {
  const pre = el("pre", "tty-j");
  const lines = [];
  const prim = (x) => {
    if (typeof x === "string") return ["tty-s", JSON.stringify(x.length > 72 ? x.slice(0, 72) : x) + (x.length > 72 ? ` …+${x.length - 72} chars` : "")];
    if (typeof x === "number") return ["tty-n", String(x)];
    return ["tty-b", String(x)];
  };
  const flat = (x) => x === null || typeof x !== "object";
  const walk = (x, key, ind, comma) => {
    const head = [ind, ...(key == null ? [] : [["tty-k", JSON.stringify(key)], ": "])];
    const end = comma ? "," : "";
    if (flat(x)) { lines.push([...head, prim(x), end]); return; }
    const arr = Array.isArray(x);
    const items = arr ? x.map((v, i) => [null, v, i]) : Object.entries(x).map(([k, v], i) => [k, v, i]);
    const [open, close] = arr ? ["[", "]"] : ["{", "}"];
    if (!items.length) { lines.push([...head, open + close, end]); return; }
    if (arr && x.every(flat)) {
      const shown = x.slice(0, 12);
      const parts = shown.flatMap((v, i) => [prim(v), i < shown.length - 1 ? ", " : ""]);
      lines.push([...head, open, ...parts, x.length > 12 ? ["tty-dim", ` …+${x.length - 12}`] : "", close, end]);
      return;
    }
    if (ind.length >= 8) { lines.push([...head, ["tty-dim", `${open}…${items.length} ${arr ? "items" : "keys"}${close}`], end]); return; }
    lines.push([...head, open]);
    const keep = arr && items.length > 6 ? items.slice(0, 4) : items;
    keep.forEach(([k, v], i) => walk(v, k, ind + "  ", i < items.length - 1));
    if (keep.length < items.length) lines.push([ind + "  ", ["tty-dim", `… ${items.length - keep.length} more`]]);
    lines.push([ind + close + end]);
  };
  walk(v, null, "", false);
  for (const l of lines.slice(0, 48)) {
    for (const x of l) if (x) pre.append(Array.isArray(x) ? el("span", x[0], x[1]) : x);
    pre.append("\n");
  }
  if (lines.length > 48) pre.append(el("span", "tty-dim", `… ${lines.length - 48} more lines; copy copies it all\n`));
  (sink ?? out).append(pre);
  out.scrollTop = out.scrollHeight;
}

// boot starts a project's binary, or reuses a running one; at most three run
// at once, the longest unused stopped first.
async function boot(slug) {
  if (live.has(slug)) {
    const c = live.get(slug);
    live.delete(slug);
    live.set(slug, c);
    return c;
  }
  const p = bySlug.get(slug);
  if (!p) throw new Error(`no project named ${slug || "(none)"}; ls lists them`);
  if (!p.live) throw new Error(`${slug} has no live demo; open ${slug} reads its page`);
  const row = line(["tty-dim", `booting ${slug} `], ["tty-dim", ""]);
  let got = 0;
  const t0 = performance.now();
  const c = await connect(slug, { onProgress: (n) => { got = n; row.lastChild.textContent = kb(n); } });
  const ms = performance.now() - t0;
  stats.boots++;
  stats.bytes += got;
  row.replaceChildren(el("span", "tty-ok", "● "), `${slug} is up: ${got ? `${kb(got)} of WebAssembly, ` : ""}started in ${dur(ms)}`);
  live.set(slug, c);
  if (live.size > MAX_LIVE) {
    const [old, oc] = live.entries().next().value;
    oc.close();
    live.delete(old);
    dim(`stopped ${old} to free its memory`);
  }
  return c;
}

async function call(slug, method, raw) {
  let params = {};
  if (raw) {
    try { params = JSON.parse(raw); } catch (e) { throw new Error(`params must be a JSON object (${e.message})`); }
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("params must be a JSON object");
  }
  const c = await boot(slug);
  const t0 = performance.now();
  let r;
  try {
    r = await c.call(method, params);
  } catch (e) {
    if (/crash|stopped|closed/.test(e.message)) live.delete(slug);
    throw new Error(`${slug}.${method}: ${e.message}`);
  }
  const ms = performance.now() - t0;
  stats.calls++;
  stats.ms += ms;
  last = r;
  json(r);
  dim(`${slug}.${method}: ${size(JSON.stringify(r).length)} of JSON from the real binary in ${dur(ms)}, in this tab`);
  return r;
}

// trace path-traces a scene with the raytracer's real renderer, a band of
// rows per call, drawing each band as it arrives.
async function trace(scene = "cornell", n = "32") {
  const passes = Math.min(64, Math.max(1, Number.parseInt(n, 10) || 32));
  const c = await boot("raytracer");
  const info = await c.call("load", { scene, width: 96, seed: 1 });
  const cv = el("canvas", "tty-img");
  cv.width = info.width;
  cv.height = info.height;
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", `${scene}, path traced in this tab`);
  out.append(cv);
  const ctx = cv.getContext("2d");
  const status = line(["tty-dim", "tracing"]);
  const band = Math.max(1, Math.floor(info.max_pixels_per_call / info.width));
  const t0 = performance.now();
  let samples = 0, done = 0;
  for (; done < passes && !stop; done++) {
    for (let y = 0; y < info.height && !stop; y += band) {
      const r = await c.call("render", { sampling: "nee", y0: y, rows: Math.min(band, info.height - y) });
      const bin = atob(r.rgba);
      const px = new Uint8ClampedArray(bin.length);
      for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
      ctx.putImageData(new ImageData(px, info.width, r.rows), 0, r.y0);
      samples += r.rows * info.width;
      stats.calls++;
    }
    status.lastChild.textContent = `pass ${done + 1} of ${passes}`;
    out.scrollTop = out.scrollHeight;
  }
  const ms = performance.now() - t0;
  stats.ms += ms;
  status.lastChild.textContent = `${scene}: ${done} ${done === 1 ? "pass" : "passes"}, ${samples.toLocaleString("en-US")} samples in ${dur(ms)} (${Math.round(samples / (ms / 1000)).toLocaleString("en-US")} samples/s), traced by the C++ raytracer in this tab`;
  out.scrollTop = out.scrollHeight;
}

const word = (s) => s.trim().split(/\s+/)[0] || "";
const excerpts = async (slug) => (await found()).filter((d) => d.s === slug && d.k === "c");
// around is the part of a long passage around its first hit.
function around(text, w, n = 88) {
  let from = Math.max(0, text.toLowerCase().indexOf(w) - 24);
  if (from) from = text.indexOf(" ", from) + 1 || from;
  return (from ? "…" : "") + text.slice(from, from + n) + (from + n < text.length ? "…" : "");
}

// A pipe: the first command's output, as lines, through filters.
const FILTERS = {
  grep: (rows, a) => {
    const inv = /(^|\s)-v(?=\s|$)/.test(a);
    const w = a.replace(/(^|\s)-[vi](?=\s|$)/g, " ").trim().toLowerCase();
    if (!w) throw new Error("usage: … | grep [-v] <text>");
    return rows.filter((r) => r.text.toLowerCase().includes(w) !== inv);
  },
  head: (rows, a) => rows.slice(0, count(a)),
  tail: (rows, a) => rows.slice(-count(a)),
  wc: (rows) => [{ text: `${rows.length} lines, ${rows.reduce((n, r) => n + (r.text.match(/\S+/g)?.length ?? 0), 0)} words, ${rows.reduce((n, r) => n + r.text.length + 1, 0)} chars` }],
};
function count(a) {
  const n = Number.parseInt(a.replace(/^-n\s*/, "").replace(/^-/, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}
// stages splits a command line at each | outside quotes and JSON.
function stages(t) {
  const parts = [];
  let cur = "", q = null, depth = 0, esc = false;
  for (const ch of t) {
    if (q) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === q) q = null; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === "|" && depth <= 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  return [...parts, cur.trim()];
}
// rows reads what a command wrote as lines: a printed line keeps its colours,
// JSON comes back as plain text lines.
function rows(box) {
  const rs = [];
  for (const n of box.children) {
    if (n.tagName === "PRE") for (const t of n.textContent.replace(/\n$/, "").split("\n")) rs.push({ text: t, pre: true });
    else if (n.tagName === "P") rs.push({ text: n.textContent, node: n });
  }
  return rs;
}
function print(rs) {
  let pre = null;
  for (const r of rs) {
    if (r.pre) { if (!pre) { pre = el("pre", "tty-j"); out.append(pre); } pre.append(r.text + "\n"); continue; }
    pre = null;
    out.append(r.node ?? el("p", null, r.text));
  }
  out.scrollTop = out.scrollHeight;
}
const need = (slug) => slug || cwd || (() => { throw new Error("name a project, or cd into one first"); })();

const commands = {
  help: [() => {
    for (const [name, [, args, what]] of Object.entries(commands)) line(["tty-c", name.padEnd(8)], ["tty-dim", (args ? args + " " : "").padEnd(22)], what);
    dim("inside a project (cd <project>), type a method and optional JSON: state, or put {\"key\": \"a\", \"value\": \"b\"}");
    dim("pipes: ls | grep live | wc · grep lease | head 5 · code keel 1 | grep seed (grep [-v], head [n], tail [n], wc)");
  }, "", "this list"],
  ls: [() => {
    for (const p of projects) line(["tty-dim", String(p.n).padStart(2, "0") + "  "], ["tty-c", p.slug.padEnd(12)], p.lang.padEnd(13), [p.live ? "tty-ok" : "tty-dim", p.live ? "live" : "page"]);
    dim(`${projects.length} projects, ${projects.filter((p) => p.live).length} with a live binary`);
  }, "", "every project"],
  cat: [async (a) => {
    const p = bySlug.get(need(word(a)));
    if (!p) throw new Error(`no project named ${word(a)}; ls lists them`);
    line(["tty-c", p.title], ` · ${p.lang} · ${p.group}`);
    line(p.tagline);
    dim(p.tags.join(" · "));
    const m = (await found().catch(() => [])).find((d) => d.s === p.slug && d.k === "m");
    if (m) { line(["tty-n", m.t]); dim(`measured: ${m.y}`); }
    if (p.live) dim(`try ${p.slug} runs it here`);
  }, "<project>", "what a project is, and its measured result"],
  code: [async (a) => {
    const [s, n] = a.trim().split(/\s+/);
    const p = bySlug.get(need(s && !/^\d+$/.test(s) ? s : ""));
    if (!p) throw new Error(`no project named ${s}; ls lists them`);
    const xs = await excerpts(p.slug);
    if (!xs.length) throw new Error(`${p.slug} has no published code`);
    const i = Number(/^\d+$/.test(s ?? "") ? s : n || (xs.length === 1 ? 1 : 0)) - 1;
    if (i < 0) {
      xs.forEach((x, j) => line(["tty-dim", ` ${j + 1}  `], ["tty-c", x.t], ["tty-dim", `  ${x.p}:${x.f}–${x.f + x.l.length - 1}`]));
      dim(`code ${p.slug} <n> prints one; pipe it to grep to search it`);
      return;
    }
    const x = xs[i];
    if (!x) throw new Error(`${p.slug} has ${xs.length} excerpts`);
    line(["tty-c", x.t], ["tty-dim", `  ${x.p}:${x.f}–${x.f + x.l.length - 1}`]);
    dim(x.y);
    const pre = el("pre", "tty-j");
    x.l.forEach((l, j) => pre.append(el("span", "tty-dim", String(x.f + j).padStart(4) + "  "), l + "\n"));
    (sink ?? out).append(pre);
    out.scrollTop = out.scrollHeight;
  }, "[project] [n]", "print the real source an excerpt shows"],
  grep: [async (a) => {
    const w = a.trim().toLowerCase();
    if (!w) throw new Error("usage: grep <text>");
    const hits = [];
    for (const d of await found()) {
      if (d.k === "c") d.l.forEach((l, j) => { if (l.toLowerCase().includes(w)) hits.push([d.s, `${d.p.split("/").pop()}:${d.f + j}`, l.trim()]); });
      else if (`${d.t} ${d.y ?? ""}`.toLowerCase().includes(w)) hits.push([d.s, { m: "result", d: "demo", w: "write-up" }[d.k], around(d.t, w)]);
    }
    const shown = sink ? hits : hits.slice(0, 30);
    for (const [slug, where, text] of shown) line(["tty-c", slug.padEnd(11)], ["tty-dim", where.padEnd(18) + " "], text);
    if (shown.length < hits.length) dim(`… ${hits.length - shown.length} more; pipe to grep or head to narrow`);
    if (!hits.length) dim(`no write-up, result or code on the site says "${a.trim()}"`);
  }, "<text>", "search every write-up and code excerpt"],
  cd: [(a) => {
    const s = word(a);
    if (!s || s === "~" || s === ".." || s === "/") { cwd = null; prompt(); return; }
    const p = bySlug.get(s);
    if (!p) throw new Error(`no project named ${s}; ls lists them`);
    cwd = p.slug;
    prompt();
    if (p.live) dim(`methods to start with: ${[...new Set(p.try.map(word))].join(", ")}; try runs them`);
  }, "<project>", "work inside a project"],
  try: [async (a) => {
    const p = bySlug.get(need(word(a)));
    if (!p?.live) throw new Error(`${word(a) || cwd} has no live demo to try`);
    const was = cwd;
    cwd = p.slug;
    prompt();
    for (const t of p.try) {
      if (stop) break;
      await type(t);
      if (stop) break;
      echo(t);
      input.value = "";
      const [m, raw] = [word(t), t.slice(word(t).length).trim()];
      await call(p.slug, m, raw);
    }
    if (was !== p.slug) dim(`you are in ${p.slug} now; cd .. leaves`);
  }, "[project]", "type and run a project's example calls"],
  call: [(a) => {
    const [slug, method] = a.trim().split(/\s+/);
    if (!method) throw new Error("usage: call <project> <method> [json]");
    return call(slug, method, a.trim().slice(slug.length).trim().slice(method.length).trim());
  }, "<project> <method> [json]", "call any method on a binary"],
  trace: [(a) => trace(...a.trim().split(/\s+/).filter(Boolean)), "[scene] [passes]", "path-trace an image here (cornell, smoke, …)"],
  open: [(a) => {
    const p = bySlug.get(need(word(a)));
    if (!p) throw new Error(`no project named ${word(a)}; ls lists them`);
    location.assign(`/projects/${p.slug}/`);
  }, "<project>", "go to its page"],
  stats: [() => {
    line(`${stats.boots} ${stats.boots === 1 ? "binary" : "binaries"} booted (${kb(stats.bytes)} of WebAssembly), ${stats.calls} calls, ${dur(stats.ms)} inside them`);
    dim(live.size ? `running now: ${[...live.keys()].join(", ")}` : "nothing running");
  }, "", "what this session ran"],
  copy: [async () => {
    if (last == null) throw new Error("nothing to copy yet");
    await navigator.clipboard.writeText(JSON.stringify(last, null, 2));
    dim("copied the last result as JSON");
  }, "", "copy the last result"],
  history: [() => hist.forEach((h, i) => line(["tty-dim", String(i + 1).padStart(3) + "  "], h)), "", "what you typed"],
  clear: [() => out.replaceChildren(), "", "clear the screen (Ctrl+L)"],
  exit: [() => dlg.close(), "", "close (Esc)"],
};

function prompt() {
  label.replaceChildren(el("b", null, "visitor@crowbett"), el("span", null, `:~${cwd ? "/" + cwd : ""}$`));
}

function echo(text) {
  const p = line(["tty-ok", "visitor@crowbett"], ["tty-dim", `:~${cwd ? "/" + cwd : ""}$ `], text);
  p.className = "tty-e";
}

// type shows a command being typed into the prompt, in about half a second.
async function type(t) {
  if (calm.matches) { input.value = t; return; }
  const step = Math.max(1, Math.ceil(t.length / 28));
  for (let i = step; i < t.length + step && !stop; i += step) {
    input.value = t.slice(0, i);
    await sleep(16);
  }
  await sleep(140);
}

async function exec(text) {
  const t = text.trim();
  echo(t);
  if (!t) return;
  hist.push(t);
  hi = hist.length;
  const [first, ...pipe] = stages(t);
  const name = word(first), rest = first.slice(name.length).trim();
  busy = true;
  stop = false;
  dlg.dataset.busy = "";
  try {
    const bad = pipe.find((f) => !Object.hasOwn(FILTERS, word(f)));
    if (bad !== undefined) throw new Error(`${word(bad) || "an empty command"} can't read a pipe; grep, head, tail and wc can`);
    if (pipe.length) sink = el("div");
    if (Object.hasOwn(commands, name)) await commands[name][0](rest);
    else if (cwd && bySlug.get(cwd)?.live) await call(cwd, name, rest);
    else if (bySlug.has(name)) await commands.cd[0](name);
    else throw new Error(`${name}: no such command; help lists them`);
    if (pipe.length) {
      const box = sink;
      sink = null;
      print(pipe.reduce((rs, f) => FILTERS[word(f)](rs, f.slice(word(f).length).trim()), rows(box)));
    }
  } catch (e) {
    sink = null;
    fail(e.message);
  } finally {
    sink = null;
    busy = false;
    delete dlg.dataset.busy;
    input.value = "";
  }
}

// complete fills in a command, project or method from what is typed so far.
function complete() {
  const v = input.value;
  const parts = v.split(/\s+/);
  const cur = parts.at(-1);
  let pool;
  if (parts.length === 1) pool = [...Object.keys(commands), ...(cwd && bySlug.get(cwd)?.live ? bySlug.get(cwd).try.map(word) : []), ...projects.map((p) => p.slug)];
  else if (parts.length === 2 && parts[0] !== "trace") pool = projects.map((p) => p.slug);
  else if (parts.length === 3 && parts[0] === "call") pool = (bySlug.get(parts[1])?.try ?? []).map(word);
  else return;
  const hits = [...new Set(pool)].filter((x) => x.startsWith(cur));
  if (hits.length === 1) input.value = v.slice(0, v.length - cur.length) + hits[0] + " ";
  else if (hits.length > 1) {
    let pre = hits[0];
    for (const h of hits) while (!h.startsWith(pre)) pre = pre.slice(0, -1);
    if (pre.length > cur.length) input.value = v.slice(0, v.length - cur.length) + pre;
    else dim(hits.join("  "));
  }
}

function build() {
  dlg = el("dialog", "tty");
  dlg.setAttribute("aria-label", "Terminal");
  const bar = el("div", "tty-bar");
  const x = el("button", "tty-x", "esc");
  x.type = "button";
  x.setAttribute("aria-label", "Close the terminal");
  x.addEventListener("click", () => dlg.close());
  bar.append(el("span", null, "crowbett shell"), x);
  out = el("div", "tty-out");
  out.setAttribute("role", "log");
  out.tabIndex = 0;
  out.setAttribute("aria-label", "Output");
  const row = el("div", "tty-in");
  label = el("label", "tty-p");
  label.htmlFor = "tty-i";
  input = el("input");
  Object.assign(input, { id: "tty-i", type: "text", autocomplete: "off", spellcheck: false, enterKeyHint: "go" });
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  row.append(label, input);
  dlg.append(bar, out, row);
  document.body.append(dlg);
  prompt();

  input.addEventListener("keydown", (e) => {
    if (e.key === "c" && e.ctrlKey) {
      if (busy) { stop = true; dim("^C"); }
      else { echo(input.value + "^C"); input.value = ""; }
      e.preventDefault();
    } else if (e.key === "l" && e.ctrlKey) {
      out.replaceChildren();
      e.preventDefault();
    } else if (busy) {
      if (e.key !== "Escape") e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      exec(input.value);
    } else if (e.key === "Tab") {
      e.preventDefault();
      complete();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      hi = Math.max(0, Math.min(hist.length, hi + (e.key === "ArrowUp" ? -1 : 1)));
      input.value = hist[hi] ?? "";
    }
  });
  out.addEventListener("click", () => { if (!getSelection().toString()) input.focus(); });
  dlg.addEventListener("close", () => { stop = true; opener?.focus?.(); });
}

export async function open(from) {
  opener = from ?? document.activeElement;
  const first = !dlg;
  if (first) build();
  if (!dlg.open) dlg.showModal();
  input.focus();
  if (!first) return;
  try {
    projects = await data;
    bySlug = new Map(projects.map((p) => [p.slug, p]));
  } catch {
    fail("could not load the project list; reload to try again");
    return;
  }
  const n = projects.filter((p) => p.live).length;
  line(["tty-c", "crowbett shell"]);
  line(`${n} of these ${projects.length} projects run here as their real code, compiled to WebAssembly. Every command below calls into them.`);
  dim("help lists commands · try kvlite · trace cornell · Tab completes · Esc closes");
}
