// edgecache demo: a list of requests played through edgecache's real cache
// engine against a scripted origin on a simulated clock.
const SVG = "http://www.w3.org/2000/svg";
const MAX_SECONDS = 604800;
const PRESETS = [
  ["max-age", "max-age with an ETag", { cacheControl: "max-age=60", etag: '"v1"' }, "0\n30\n61\n90",
    "Fresh for 60 s, then revalidated with If-None-Match; the 304 makes it fresh again."],
  ["no-validator", "max-age, no validator", { cacheControl: "max-age=60" }, "0\n30\n61",
    "Without an ETag or Last-Modified a stale entry cannot be revalidated, so it is fetched again."],
  ["s-maxage", "s-maxage", { cacheControl: "max-age=10, s-maxage=120", etag: '"v1"' }, "0\n60\n119\n121",
    "A shared cache uses s-maxage over max-age: fresh for 120 s, not 10."],
  ["swr", "stale-while-revalidate", { cacheControl: "max-age=30, stale-while-revalidate=60", etag: '"v1"' }, "0\n40\n45\n200",
    "Stale for up to 60 s past max-age: served at once while a background revalidation refreshes the entry. Past that window it revalidates in line."],
  ["no-cache", "no-cache", { cacheControl: "no-cache", etag: '"v1"' }, "0\n5\n10",
    "Stored, but every use is revalidated with the origin first."],
  ["vary", "Vary: Accept-Language", { cacheControl: "max-age=60", vary: "Accept-Language" }, "0 Accept-Language: en\n5 Accept-Language: fr\n10 Accept-Language: en\n15 Accept-Language: fr",
    "One cached variant per language: the first French request misses, later ones hit their own entry."],
  ["age", "Age from the origin", { cacheControl: "max-age=60", age: "50", etag: '"v1"' }, "0\n5\n11",
    "The origin says the response is already 50 s old, so it is fresh for only 10 s more."],
  ["expires", "Expires", { expiresIn: 60 }, "0\n30\n61",
    "No Cache-Control: Expires, 60 s after Date, sets the lifetime."],
  ["heuristic", "Heuristic (Last-Modified)", { lastModifiedAgo: 3600 }, "0\n359\n361",
    "No explicit lifetime: the engine uses 10% of the time from Last-Modified (1 h before t=0) to the response's Date, so 360 s for the first response, then revalidates with If-Modified-Since."],
  ["no-store", "Request no-store", { cacheControl: "max-age=60" }, "0\n5 Cache-Control: no-store\n10",
    "A request with Cache-Control: no-store goes to the origin and leaves the stored entry alone."],
];
const OUTCOMES = ["HIT", "MISS", "STALE", "REVALIDATED", "BYPASS"];
// The request headers the bridge accepts (cmd/webdemo requestHeaders).
const REQUEST_HEADERS = ["Accept-Encoding", "Accept-Language", "Cache-Control", "If-Modified-Since", "If-None-Match", "Pragma"];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function field(label, input, cls) {
  const wrap = el("label", "ec-field" + (cls ? " " + cls : ""));
  wrap.append(el("span", "ec-label", label), input);
  return wrap;
}

function textInput(name, placeholder) {
  const i = el("input");
  Object.assign(i, { type: "text", name, placeholder, spellcheck: false, autocomplete: "off" });
  return i;
}

function numberInput(name) {
  const i = el("input");
  Object.assign(i, { type: "number", name, min: 0, max: MAX_SECONDS, step: 1, inputMode: "numeric", placeholder: "none" });
  return i;
}

// parseRequests reads one request per line: seconds, then optional headers
// "Name: value" separated by "; " before the next name.
function parseRequests(text) {
  const out = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const n = i + 1;
    const m = /^(\d+)\s*s?(?:\s+(.*))?$/.exec(line);
    if (!m) throw new Error(`Request line ${n} must start with a time in seconds, e.g. "30" or "5 Accept-Language: fr".`);
    const at = Number(m[1]);
    if (at > MAX_SECONDS) throw new Error(`Request line ${n}: times go up to ${MAX_SECONDS} s (7 days).`);
    const headers = {};
    for (const part of (m[2] || "").split(/;\s*(?=[A-Za-z0-9-]+\s*:)/).map((p) => p.trim()).filter(Boolean)) {
      const h = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(part);
      if (!h) throw new Error(`Request line ${n}: write headers as "Name: value".`);
      const name = REQUEST_HEADERS.find((k) => k.toLowerCase() === h[1].toLowerCase());
      if (!name) throw new Error(`Request line ${n}: ${h[1]} is not supported; use ${REQUEST_HEADERS.join(", ")}.`);
      if (name in headers) throw new Error(`Request line ${n}: ${name} appears twice.`);
      headers[name] = h[2];
    }
    out.push({ at, headers });
  }
  if (out.length === 0) throw new Error("Add at least one request time.");
  if (out.length > 40) throw new Error("Up to 40 requests per run.");
  return out;
}

function timeline(steps) {
  const end = Math.max(1, ...steps.map((s) => s.at));
  const x = (t) => 12 + (976 * t) / end;
  const g = svg("svg", { viewBox: "0 0 1000 40", preserveAspectRatio: "none", role: "img",
    "aria-label": `Timeline of ${steps.length} requests from 0 to ${end} s` });
  g.append(svg("line", { class: "ec-track", x1: 12, x2: 988, y1: 20, y2: 20, "vector-effect": "non-scaling-stroke" }));
  for (const s of steps) {
    const r = svg("rect", { class: "ec-mark", "data-outcome": s.xCache || "NONE", x: x(s.at) - 4, width: 8, y: 8, height: 24, rx: 2 });
    const tip = svg("title", {});
    tip.textContent = `${s.at} s: ${s.xCache || s.status}`;
    r.append(tip);
    g.append(r);
  }
  const fig = el("figure", "ec-timeline");
  const axis = el("p", "ec-axis");
  axis.append(el("span", null, "0 s"), el("span", null, `${end.toLocaleString("en-US")} s`));
  fig.append(g, axis);
  return fig;
}

function table(steps) {
  const wrap = el("div", "ec-scroll");
  const t = el("table", "ec-table");
  const head = el("tr");
  for (const h of ["t (s)", "X-Cache", "Age", "Body", "Origin traffic"]) head.append(el("th", null, h));
  const thead = el("thead");
  thead.append(head);
  const tbody = el("tbody");
  for (const s of steps) {
    const tr = el("tr");
    const badge = el("span", "ec-badge", s.xCache || String(s.status));
    badge.dataset.outcome = s.xCache || "NONE";
    const out = el("td");
    out.append(badge);
    if (s.reason) out.append(el("span", "ec-reason", s.reason));
    if (s.status !== 200) out.append(el("span", "ec-reason", `status ${s.status}`));
    tr.append(
      el("td", "ec-num", String(s.at)),
      out,
      el("td", "ec-num", s.age === "" ? "–" : s.age),
      el("td", "ec-body", s.body),
      el("td", "ec-origin", s.upstream && s.upstream.length ? s.upstream.join(", ") : "none"),
    );
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}

export async function mount(root, demo) {
  const href = new URL("./ui.css", import.meta.url).href;
  let cssReady = Promise.resolve();
  if (![...document.querySelectorAll("link[rel=stylesheet]")].some((l) => l.href === href)) {
    const css = el("link");
    css.rel = "stylesheet";
    css.href = href;
    cssReady = new Promise((r) => { css.onload = r; css.onerror = r; });
    document.head.append(css);
  }

  const form = el("form", "ec-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const preset = el("select");
  preset.name = "preset";
  for (const [v, t] of PRESETS) {
    const o = el("option", null, t);
    o.value = v;
    preset.append(o);
  }
  const cc = textInput("cacheControl", "none");
  const etag = textInput("etag", "none");
  const vary = textInput("vary", "none");
  const age = textInput("age", "none");
  const expires = numberInput("expiresIn");
  const lastMod = numberInput("lastModifiedAgo");
  const reqs = el("textarea");
  Object.assign(reqs, { name: "requests", rows: 5, spellcheck: false });
  const origin = el("fieldset", "ec-origin-fields");
  origin.append(
    el("legend", "ec-label", "Origin response headers"),
    field("Cache-Control", cc, "ec-wide"),
    field("ETag", etag),
    field("Vary", vary),
    field("Age", age),
    field("Expires (s after Date)", expires),
    field("Last-Modified (s before t=0)", lastMod),
  );
  const about = el("p", "ec-about");
  about.id = "ec-about";
  preset.setAttribute("aria-describedby", about.id);
  form.append(field("Preset", preset, "ec-wide"), about, origin,
    field("Requests: one per line, seconds then headers split by ;", reqs, "ec-wide"));

  const legend = el("p", "ec-legend");
  for (const o of OUTCOMES) {
    const k = el("span", "ec-key", o);
    k.dataset.outcome = o;
    legend.append(k);
  }
  const results = el("div", "ec-results");
  const status = el("p", "demo-out ec-status");
  status.setAttribute("aria-live", "polite");
  root.replaceChildren(form, legend, results, status);

  function load(v) {
    const [, , o, r, text] = PRESETS.find((p) => p[0] === v);
    cc.value = o.cacheControl || "";
    etag.value = o.etag || "";
    vary.value = o.vary || "";
    age.value = o.age || "";
    expires.value = o.expiresIn ?? "";
    lastMod.value = o.lastModifiedAgo ?? "";
    reqs.value = r;
    about.textContent = text;
  }

  let seq = 0;
  async function run(first = false) {
    const mine = ++seq;
    let requests;
    try {
      const bad = [[expires, "Expires"], [lastMod, "Last-Modified"]].find(([i]) => !i.validity.valid);
      if (bad) throw new Error(`${bad[1]} must be empty or a whole number of seconds from 0 to ${MAX_SECONDS}.`);
      requests = parseRequests(reqs.value);
    } catch (err) {
      results.replaceChildren();
      status.textContent = err.message;
      return;
    }
    const params = {
      origin: {
        cacheControl: cc.value.trim(),
        etag: etag.value.trim(),
        vary: vary.value.trim(),
        age: age.value.trim(),
        expiresIn: expires.value === "" ? null : Number(expires.value),
        lastModifiedAgo: lastMod.value === "" ? null : Number(lastMod.value),
      },
      requests,
    };
    const t0 = performance.now();
    let r;
    try {
      r = await demo.call("timeline", params);
    } catch (err) {
      if (first) throw err;
      if (mine === seq) {
        results.replaceChildren();
        status.textContent = err.message;
      }
      return;
    }
    const ms = performance.now() - t0;
    if (mine !== seq) return;
    results.replaceChildren(timeline(r.steps), table(r.steps));
    const fetches = r.steps.reduce((n, s) => n + (s.upstream ? s.upstream.length : 0), 0);
    status.textContent = `${r.steps.length} request${r.steps.length === 1 ? "" : "s"} through edgecache's engine, ${fetches} reached the origin, in ${Math.round(ms)} ms, in your browser.`;
  }

  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  for (const i of [cc, etag, vary, age, expires, lastMod, reqs]) i.addEventListener("input", later);
  preset.addEventListener("change", () => { load(preset.value); run(); });

  load(preset.value);
  await cssReady;
  await run(true);
}
