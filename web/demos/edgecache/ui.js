// edgecache demo: a live edge. Clients fire GETs on simulated time; each one
// is played through edgecache's real cache engine (internal/cache over a
// memstore) against a scripted origin, and only what the engine answers moves:
// X-Cache, Age, the body version and every request it sent the origin.
const T_END = 300;
const MAX_REQUESTS = 40;
const LEG_MS = 260;
const FADE_MS = 250;
const SPEEDS = [5, 10, 20, 40];
const BUCKET = 10;

// Traffic: when clients ask, and with which Accept-Language. Inputs, not results.
const BURSTS = [0, 2, 3, 5, 8, 11, 40, 42, 45, 49, 75, 95, 97, 100, 103, 150, 151, 153, 156, 160, 164, 260, 262, 263, 266, 270, 275, 281, 290, 296];
const STEADY = Array.from({ length: 30 }, (_, i) => (i ? i * 10 + ((i * 7) % 5) : 0));
const LANGS = ["en", "fr", "en", "de", "en", "fr"];
const TRAFFIC = [
  ["bursts", "bursts", BURSTS.map((at) => ({ at, headers: {} }))],
  ["steady", "steady", STEADY.map((at) => ({ at, headers: {} }))],
  ["langs", "three languages", STEADY.map((at, i) => ({ at, headers: { "Accept-Language": LANGS[i % LANGS.length] } }))],
];

// Origin policies: the headers the scripted origin sends with every response.
const POLICIES = [
  ["swr", "stale-while-revalidate", { cacheControl: "max-age=30, stale-while-revalidate=60", etag: '"v1"' },
    "Fresh for 30 s. For 60 s after that a request gets the stored copy at once while the engine revalidates it in the background; later than that it revalidates in line."],
  ["etag", "max-age, ETag", { cacheControl: "max-age=30", etag: '"v1"' },
    "Fresh for 30 s, then revalidated with If-None-Match: the origin's 304 makes the stored copy fresh again without resending the body."],
  ["novalidator", "max-age, no validator", { cacheControl: "max-age=30" },
    "Fresh for 30 s. With no ETag or Last-Modified a stale copy cannot be revalidated, so the origin sends the whole body again and the version climbs."],
  ["no-cache", "no-cache, ETag", { cacheControl: "no-cache", etag: '"v1"' },
    "Stored, but every request is revalidated with the origin before it is served."],
  ["s-maxage", "s-maxage", { cacheControl: "max-age=10, s-maxage=120", etag: '"v1"' },
    "A shared cache follows s-maxage, so the copy stays fresh for 120 s, not 10."],
  ["vary", "Vary: Accept-Language", { cacheControl: "max-age=60", etag: '"v1"', vary: "Accept-Language" },
    "One stored copy per Accept-Language, each with its own age and version. Pair it with the three-languages traffic."],
  ["heuristic", "Last-Modified only", { lastModifiedAgo: 600 },
    "No explicit lifetime: the engine derives a heuristic one from Last-Modified, set 600 s before t = 0, and revalidates with If-Modified-Since."],
  ["no-store", "no-store", { cacheControl: "no-store", etag: '"v1"' },
    "Nothing is stored, so every request goes to the origin."],
];

// What the visitor can send: the bridge's request headers, set as a client would.
const YOURS = [
  ["get", "plain GET", {}],
  ["reload", "reload (no-cache)", { "Cache-Control": "no-cache" }],
  ["max0", "max-age=0", { "Cache-Control": "max-age=0" }],
  ["no-store", "no-store", { "Cache-Control": "no-store" }],
  ["oic", "only-if-cached", { "Cache-Control": "only-if-cached" }],
  ["fr", "Accept-Language: fr", { "Accept-Language": "fr" }],
];

const OUTCOMES = ["HIT", "STALE", "REVALIDATED", "MISS", "BYPASS"];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function field(label, input, cls) {
  const wrap = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function select(name, options, value) {
  const s = el("select");
  s.name = name;
  for (const [v, t] of options) {
    const o = el("option", null, t);
    o.value = String(v);
    o.selected = v === value;
    s.append(o);
  }
  return s;
}

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

function textInput(name, placeholder) {
  const i = el("input");
  Object.assign(i, { type: "text", name, placeholder, spellcheck: false, autocomplete: "off" });
  return i;
}

const describe = (h) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join(", ");
const lane = (h) => h["Accept-Language"] || "";
const pct = (a, b) => (b ? `${(Math.round((a / b) * 1000) / 10).toLocaleString("en-US", { minimumFractionDigits: 1 })} %` : "–");

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

// The freshness marks drawn on the age chart are the visitor's own header
// values, quoted back, not something the engine reported.
function directives(cc) {
  const d = {};
  for (const part of cc.toLowerCase().split(",")) {
    const m = /^\s*([a-z-]+)\s*=\s*"?(\d+)"?\s*$/.exec(part);
    if (m) d[m[1]] = Number(m[2]);
  }
  const fresh = d["s-maxage"] ?? d["max-age"];
  const name = d["s-maxage"] !== undefined ? "s-maxage" : "max-age";
  return fresh === undefined ? null : { fresh, name, swr: d["stale-while-revalidate"] };
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
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Controls.
  const traffic = select("traffic", TRAFFIC.map(([v, t]) => [v, t]), "bursts");
  const policy = select("policy", [...POLICIES.map(([v, t]) => [v, t]), ["custom", "custom"]], "swr");
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 10);
  const cc = textInput("cacheControl", "none");
  const etag = textInput("etag", "none");
  const vary = textInput("vary", "none");
  const knobs = el("div", "ec-knobs");
  knobs.append(field("traffic", traffic), field("origin policy", policy), field("speed", speed));
  const heads = el("div", "ec-heads");
  const extra = el("p", "ec-extra");
  heads.append(field("origin Cache-Control", cc, "ec-cc"), field("ETag", etag, "ec-etag"), field("Vary", vary, "ec-vary"), extra);
  const play = button("Pause");
  const step = button("Step 10 s", "secondary");
  const reset = button("Reset", "secondary");
  const kind = select("yours", YOURS.map(([v, t]) => [v, t]), "reload");
  const send = button("Send my request");
  const acts = el("div", "ec-acts");
  const yours = el("div", "ec-mine");
  yours.append(field("your request", kind, "ec-kind"), send);
  acts.append(play, step, reset, yours);
  const form = el("form", "ec-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(knobs, heads, acts);

  const canvas = el("canvas", "ec-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend ec-legend");
  for (const [k, t] of [["HIT", "HIT"], ["STALE", "STALE"], ["REVALIDATED", "REVALIDATED"], ["MISS", "MISS"], ["BYPASS", "BYPASS"], ["you", "you"], ["cli", "client requests / 10 s"], ["o200", "origin 200"], ["o304", "origin 304"]]) {
    const s = el("span", "ec-key", t);
    s.dataset.k = k;
    legend.append(s);
  }
  const youLine = el("p", "ec-you");
  youLine.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack ec-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["requests", "requests"], ["ratio", "hit ratio"], ["origin", "origin requests"], ["saved", "origin requests saved"],
    ["r304", "304s"], ["p50", "age p50"], ["p95", "age p95"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "ec-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const sends = el("p", "ec-sends");
  const status = el("p", "ec-status");
  status.setAttribute("aria-live", "polite");
  const logBox = el("div", "ec-scroll");
  logBox.setAttribute("aria-label", "Response log");
  const log = el("table", "ec-table");
  const head = el("tr");
  for (const h of ["t", "X-Cache", "Age", "body", "to the origin"]) head.append(el("th", null, h));
  const thead = el("thead");
  thead.append(head);
  const tbody = el("tbody");
  log.append(thead, tbody);
  logBox.append(log);
  const receipt = el("p", "demo-out ec-out");
  root.replaceChildren(form, canvas, legend, youLine, cells, sends, status, logBox, receipt);

  // State.
  let origin = null;
  let schedule = [];
  let next = 0;
  let reqs = [];
  let steps = [];
  let land = [];
  let flights = [];
  let flashes = [];
  let simT = 0;
  let gen = 0;
  let calls = 0;
  let replayed = 0;
  let callMs = 0;
  let busy = false;
  let playing = !reduce.matches;
  let visible = true;
  let raf = 0;
  let last = 0;
  let hover = null;
  let colors = null;
  let G = null;
  let lastDom = 0;
  let chain = Promise.resolve();

  const exec = (list, org) => {
    const g = gen;
    const run = chain.then(async () => {
      const t0 = performance.now();
      try {
        return await demo.call("timeline", { origin: org, requests: list.map(({ at, headers }) => ({ at, headers })) });
      } finally {
        if (g === gen) { callMs += performance.now() - t0; calls++; replayed += list.length; }
      }
    });
    chain = run.catch(() => {});
    return run.then((r) => ({ r, g }));
  };

  function readOrigin() {
    const p = POLICIES.find((x) => x[0] === policy.value);
    const extra = p ? p[2] : origin || {};
    return {
      cacheControl: cc.value.trim(),
      etag: etag.value.trim(),
      vary: vary.value.trim(),
      age: extra.age || "",
      expiresIn: extra.expiresIn ?? null,
      lastModifiedAgo: extra.lastModifiedAgo ?? null,
    };
  }

  function loadPolicy() {
    const p = POLICIES.find((x) => x[0] === policy.value);
    if (!p) return;
    cc.value = p[2].cacheControl || "";
    etag.value = p[2].etag || "";
    vary.value = p[2].vary || "";
  }

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = {
      bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"),
      text3: v("--text-3"), accent: v("--accent"), live: v("--live"), signal: v("--signal"), danger: v("--danger"), mono: v("--mono") || "monospace",
    };
  }
  const tint = (o) => ({ HIT: colors.live, STALE: colors.live, REVALIDATED: colors.text, MISS: colors.signal, BYPASS: colors.signal }[o] || colors.danger);
  const hollow = (o) => o === "STALE" || o === "BYPASS";

  // Lanes: one age row per Accept-Language the run has sent.
  function lanes() {
    const set = [];
    for (const r of [...schedule, ...reqs]) if (!set.includes(lane(r.headers))) set.push(lane(r.headers));
    return set.length ? set : [""];
  }

  function layout() {
    const W = Math.max(300, canvas.clientWidth);
    const n = lanes().length;
    const padL = W < 480 ? 34 : 46, padR = 12;
    const flowH = 116;
    const reqY = flowH + 40;
    const laneTop = reqY + 18;
    const laneH = n === 1 ? 120 : W < 480 ? 58 : 66;
    const laneGap = 12;
    const origTop = laneTop + n * laneH + (n - 1) * laneGap + 20;
    const origH = 56;
    const axisY = origTop + origH;
    const H = axisY + 24;
    G = { W, H, padL, padR, flowH, reqY, laneTop, laneH, laneGap, origTop, origH, axisY, n, plotW: W - padL - padR };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const tx = (t) => G.padL + (t / T_END) * G.plotW;
  const nodes = () => {
    const narrow = G.W < 480;
    const bw = narrow ? 70 : Math.min(140, G.W * 0.24), ew = narrow ? 84 : bw, bh = 50, y = 14;
    const c = { x: 8, y, w: bw, h: bh }, o = { x: G.W - 8 - bw, y, w: bw, h: bh }, e = { x: (G.W - ew) / 2, y, w: ew, h: bh };
    return { c, e, o, up: y + 14, down: y + bh - 14 };
  };

  // Flights: one request's trip, leg by leg, from the engine's answer.
  function animate(i, now) {
    const s = steps[i], r = reqs[i], N = nodes();
    const you = !!r.you;
    const col = tint(s.xCache);
    const fly = (a, b, y, t0, c, label, ring) => flights.push({ a, b, y, t0, c, label, ring, you });
    const cl = N.c.x + N.c.w, el1 = N.e.x, er = N.e.x + N.e.w, or = N.o.x;
    fly(cl, el1, N.up, now, you ? colors.accent : colors.text2, you ? "you" : "", you);
    flashes.push({ t0: now + LEG_MS, c: col, node: "e" });
    const up = s.upstream || [];
    let back = now + LEG_MS;
    if (up.length) {
      const bg = s.xCache === "STALE";
      const t1 = now + LEG_MS;
      fly(er, or, N.up, t1, colors.text2, up[0].startsWith("conditional") ? "conditional" : "GET");
      const code = up[0].slice(-3);
      fly(or, er, N.down, t1 + LEG_MS, code === "304" ? colors.text2 : colors.signal, code);
      flashes.push({ t0: t1 + LEG_MS, c: code === "304" ? colors.text2 : colors.signal, node: "o" });
      if (!bg) back = t1 + 2 * LEG_MS;
    }
    fly(el1, cl, N.down, back, col, s.xCache || String(s.status), false);
    land[i] = back + LEG_MS;
  }

  // Applies a timeline answer: steps from `from` on are new and fly.
  function apply(r, from, now, anim) {
    steps = r.steps;
    for (let i = 0; i < steps.length; i++) {
      if (i < from) continue;
      if (anim) animate(i, now);
      else land[i] = 0;
    }
    const mine = reqs.map((q, i) => (q.you ? i : -1)).filter((i) => i >= from);
    if (mine.length) {
      const i = mine[mine.length - 1], g = gen;
      setTimeout(() => { if (g === gen && steps[i]) setYou(i); }, Math.max(0, land[i] - performance.now()));
    }
    renderLog();
    updateDom(true);
  }

  function setYou(i) {
    const s = steps[i], r = reqs[i];
    const up = s.upstream && s.upstream.length ? s.upstream.join(", ") : "nothing";
    const age = s.age === "" ? "no Age" : `Age ${s.age}`;
    youLine.textContent = `Your GET${Object.keys(r.headers).length ? ` (${describe(r.headers)})` : ""} at ${fmt(r.at)} s: ${s.xCache || s.status}${s.reason ? ` (${s.reason})` : ""}, status ${s.status}, ${age}, body "${s.body.trim()}". The origin saw ${up}.`;
  }

  let logKey = "";
  function renderLog() {
    const now = performance.now();
    const shown = steps.map((_, i) => i).filter((i) => land[i] <= now);
    const key = `${steps.length}:${shown.length}:${calls}`;
    if (key === logKey) return;
    logKey = key;
    const rows = [];
    for (let k = shown.length - 1; k >= 0 && rows.length < 6; k--) {
      const i = shown[k], s = steps[i], r = reqs[i];
      const tr = el("tr");
      if (r.you) tr.className = "ec-yours";
      const badge = el("span", "ec-badge", s.xCache || String(s.status));
      badge.dataset.k = s.xCache || "NONE";
      const out = el("td");
      out.append(badge);
      if (s.reason) out.append(el("span", "ec-reason", s.reason));
      const t = el("td", "ec-num", `${fmt(s.at)} s`);
      if (r.you) t.append(el("span", "ec-reason", "you"));
      else if (lane(r.headers)) t.append(el("span", "ec-reason", lane(r.headers)));
      tr.append(t, out, el("td", "ec-num", s.age === "" ? "–" : s.age), el("td", "ec-body", s.body.trim()),
        el("td", "ec-origin", s.upstream && s.upstream.length ? s.upstream.join(", ") : "none"));
      rows.push(tr);
    }
    tbody.replaceChildren(...rows);
  }

  // Counts over the answers already back at the clients.
  function stats(now = performance.now()) {
    let hits = 0, orig = 0, r304 = 0, n = 0;
    const ages = [];
    for (const [i, s] of steps.entries()) {
      if (!(land[i] <= now)) continue;
      n++;
      if (s.xCache === "HIT" || s.xCache === "STALE") hits++;
      for (const u of s.upstream || []) { orig++; if (u.endsWith("304")) r304++; }
      if (s.age !== "") ages.push(Number(s.age));
    }
    return { n, hits, orig, r304, ages };
  }

  function updateDom(force) {
    const now = performance.now();
    if (!force && now - lastDom < 150) return;
    lastDom = now;
    renderLog();
    const st = stats();
    cell.t.textContent = `${fmt(Math.floor(simT))} s`;
    cell.requests.textContent = fmt(st.n);
    cell.ratio.textContent = pct(st.hits, st.n);
    cell.origin.textContent = fmt(st.orig);
    cell.saved.textContent = st.n ? fmt(st.n - st.orig) : "–";
    cell.r304.textContent = fmt(st.r304);
    const p50 = quantile(st.ages, 0.5), p95 = quantile(st.ages, 0.95);
    cell.p50.textContent = p50 === null ? "–" : `${fmt(p50)} s`;
    cell.p95.textContent = p95 === null ? "–" : `${fmt(p95)} s`;
    const left = MAX_REQUESTS - schedule.length - reqs.filter((r) => r.you).length;
    send.disabled = left <= 0;
    sends.textContent = left > 0 ? `${left} of your requests left this run; the engine takes ${MAX_REQUESTS} per run.` : `That is ${MAX_REQUESTS} requests, the most one run takes. Reset to start again.`;
    if (calls) receipt.textContent = `${fmt(st.n)} requests through edgecache's engine, ${fmt(st.orig)} reached the origin; ${fmt(calls)} calls replayed ${fmt(replayed)} requests on a fresh engine in ${fmt(Math.round(callMs))} ms, in your browser.`;
    canvas.setAttribute("aria-label", `Edge at ${fmt(Math.floor(simT))} s of simulated time: ${fmt(st.n)} requests, ${fmt(st.hits)} served from cache, ${fmt(st.orig)} sent to the origin (${fmt(st.r304)} answered 304).`);
  }

  // Fires every scheduled request that is due, in one call with the whole run so far.
  async function pump(anim) {
    if (busy || !origin) return;
    const from = reqs.length, nx = next;
    if (!takeDue()) return;
    busy = true;
    const g0 = gen;
    try {
      const { r, g } = await exec(reqs, origin);
      if (g !== gen) return;
      apply(r, from, performance.now(), anim);
    } catch (err) {
      if (g0 === gen) { reqs.length = from; next = nx; }
      throw err;
    } finally {
      if (g0 === gen) busy = false;
    }
    if (g0 === gen && next < schedule.length && schedule[next].at <= simT) await pump(anim);
  }
  function takeDue() {
    let n = 0;
    while (next < schedule.length && schedule[next].at <= simT) { reqs.push(schedule[next++]); n++; }
    return n;
  }
  const idle = async () => { while (busy) await new Promise((r) => setTimeout(r, 20)); };

  async function sendMine() {
    const y = YOURS.find((x) => x[0] === kind.value);
    const g0 = gen;
    await idle();
    if (send.disabled || g0 !== gen) return;
    busy = true;
    const from = reqs.length, nx = next;
    takeDue();
    reqs.push({ at: Math.min(T_END, Math.floor(simT)), headers: { ...y[2] }, you: true });
    if (lanes().length !== G.n) layout();
    try {
      const { r, g } = await exec(reqs, origin);
      if (g !== gen) return;
      apply(r, from, performance.now(), !reduce.matches);
    } catch (err) {
      if (g0 === gen) { reqs.length = from; next = nx; }
      throw err;
    } finally {
      if (g0 === gen) busy = false;
    }
    draw(performance.now());
    kick();
  }

  // New origin headers: the same requests so far, replayed under them.
  async function replay() {
    const org = readOrigin();
    const g0 = gen;
    if (!reqs.length) { origin = org; status.textContent = note(); return; }
    await idle();
    if (g0 !== gen) return;
    busy = true;
    try {
      const { r, g } = await exec(reqs, org);
      if (g !== gen) return;
      origin = org;
      const now = performance.now();
      for (let i = 0; i < reqs.length; i++) if (land[i] <= now) land[i] = reduce.matches ? 0 : now - 1;
      apply(r, reqs.length, now, false);
      status.textContent = `Replayed ${fmt(reqs.length)} requests under the new origin headers. ${note()}`;
    } finally {
      if (g0 === gen) busy = false;
    }
    draw(performance.now());
    kick();
  }

  function note() {
    const p = POLICIES.find((x) => x[0] === policy.value);
    const o = origin || {};
    extra.textContent = o.lastModifiedAgo != null ? `The origin also sends Last-Modified, ${fmt(o.lastModifiedAgo)} s before t = 0.` : "";
    return p ? p[3] : "Your own origin headers, replayed over the same requests.";
  }

  async function restart() {
    gen++;
    origin = readOrigin();
    schedule = TRAFFIC.find((x) => x[0] === traffic.value)[2];
    next = 0; reqs = []; steps = []; land = []; flights = []; flashes = [];
    simT = 0; calls = 0; replayed = 0; callMs = 0; busy = false; chain = Promise.resolve();
    youLine.textContent = "";
    logKey = "";
    status.textContent = note();
    layout();
    if (reduce.matches && !playing) simT = T_END;
    await pump(!reduce.matches);
    renderLog();
    updateDom(true);
    draw(performance.now());
  }

  // Drawing.
  function draw(now) {
    if (!G || !colors) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors;
    const font = (px, w = 400) => `${w} ${px}px ${c.mono}`;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    drawFlow(ctx, now, font);
    drawTimeline(ctx, now, font);
  }

  function box(ctx, b, title, sub, subColor, font, flash) {
    const c = colors;
    ctx.fillStyle = c.surface;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.strong;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    if (flash) {
      ctx.globalAlpha = flash.a;
      ctx.lineWidth = 2;
      ctx.strokeStyle = flash.c;
      ctx.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = c.text;
    ctx.font = font(11, 600);
    ctx.fillText(title, b.x + b.w / 2, b.y + 20);
    ctx.fillStyle = subColor || c.text3;
    ctx.font = font(subColor ? 11 : G.W < 480 ? 9 : 10, subColor ? 600 : 400);
    ctx.fillText(sub, b.x + b.w / 2, b.y + 38);
  }

  function drawFlow(ctx, now, font) {
    const c = colors, N = nodes();
    const st = stats();
    flashes = flashes.filter((f) => now - f.t0 < 400 || f.t0 > now);
    const flashOf = (node) => {
      const f = flashes.filter((x) => x.node === node && x.t0 <= now).pop();
      return f ? { c: f.c, a: 1 - clamp01((now - f.t0) / 400) } : null;
    };
    // Wires: requests travel right on the upper one, answers left on the lower.
    ctx.strokeStyle = c.strong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const y of [N.up, N.down]) {
      ctx.moveTo(N.c.x + N.c.w, y + 0.5); ctx.lineTo(N.e.x, y + 0.5);
      ctx.moveTo(N.e.x + N.e.w, y + 0.5); ctx.lineTo(N.o.x, y + 0.5);
    }
    ctx.stroke();
    const shown = steps.filter((_, i) => land[i] <= now);
    const lastShown = shown[shown.length - 1];
    box(ctx, N.c, "clients", `${fmt(shown.length)} sent`, null, font, null);
    box(ctx, N.e, "edgecache", lastShown ? lastShown.xCache || String(lastShown.status) : "empty", lastShown ? tint(lastShown.xCache) : null, font, flashOf("e"));
    box(ctx, N.o, "origin", `${fmt(st.orig - st.r304)}×200 ${fmt(st.r304)}×304`, null, font, flashOf("o"));
    // Arrowheads: requests go right on the upper wire, answers come back left on the lower.
    ctx.fillStyle = c.text3;
    for (const [x, y, d] of [[N.e.x, N.up, 1], [N.o.x, N.up, 1], [N.c.x + N.c.w, N.down, -1], [N.e.x + N.e.w, N.down, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x - 6 * d, y - 3.5); ctx.lineTo(x - 6 * d, y + 4.5); ctx.closePath(); ctx.fill();
    }
    // The newest answer, as the engine labelled it.
    if (lastShown) {
      ctx.textAlign = "center";
      ctx.fillStyle = c.text2;
      const lbl = `${lastShown.age === "" ? "no Age" : `Age ${lastShown.age}`} · ${lastShown.body.trim()}`;
      ctx.fillText(lbl.length > 30 ? lbl.slice(0, 29) + "…" : lbl, N.e.x + N.e.w / 2, N.e.y + N.e.h + 16);
      if (lastShown.reason) {
        ctx.fillStyle = c.text3;
        ctx.fillText(lastShown.reason, N.e.x + N.e.w / 2, N.e.y + N.e.h + 30);
      }
    }
    flights = flights.filter((f) => now - f.t0 < LEG_MS);
    for (const f of flights) {
      if (f.t0 > now) continue;
      const t = ease((now - f.t0) / LEG_MS);
      const x = f.a + (f.b - f.a) * t;
      ctx.beginPath();
      ctx.arc(x, f.y, f.you ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = f.c;
      ctx.fill();
      if (f.ring) {
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, f.y, 9, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Labels, newest first, kept inside their wire's gap and never over one another.
    const taken = [];
    ctx.font = font(10, 600);
    ctx.textAlign = "center";
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      if (!f.label || f.t0 > now) continue;
      const w = ctx.measureText(f.label).width, lo = Math.min(f.a, f.b) + 2, hi = Math.max(f.a, f.b) - 2;
      if (hi - lo < w) continue;
      const x = Math.min(hi - w / 2, Math.max(lo + w / 2, f.a + (f.b - f.a) * ease((now - f.t0) / LEG_MS)));
      const y = f.y < N.e.y + N.e.h / 2 ? f.y - 9 : f.y + 17;
      if (taken.some((r) => r.y === y && x - w / 2 < r.x1 + 4 && x + w / 2 > r.x0 - 4)) continue;
      taken.push({ y, x0: x - w / 2, x1: x + w / 2 });
      ctx.fillStyle = f.you && f.ring ? c.accent : f.c;
      ctx.fillText(f.label, x, y);
    }
  }

  function mark(ctx, x, y, o, you, a, size = 4) {
    const c = colors;
    ctx.globalAlpha = a;
    const col = tint(o);
    if (hollow(o)) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - size + 0.75, y - size + 0.75, size * 2 - 1.5, size * 2 - 1.5);
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    }
    if (you) {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, size + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawTimeline(ctx, now, font) {
    const c = colors;
    const L = lanes();
    const fresh = directives(origin ? origin.cacheControl : "");
    const vis = steps.map((s, i) => ({ s, r: reqs[i], i, a: land[i] === undefined ? 0 : clamp01((now - land[i]) / FADE_MS) })).filter((v) => v.a > 0);
    let top = 0;
    for (const v of vis) if (v.s.age !== "") top = Math.max(top, Number(v.s.age));
    if (fresh) top = Math.max(top, fresh.fresh + (fresh.swr || 0));
    const step = top <= 60 ? 15 : top <= 120 ? 30 : top <= 300 ? 60 : top <= 900 ? 300 : 3600;
    const yMax = Math.max(60, Math.ceil((top * 1.1) / step) * step);

    // Grid: one line a minute of simulated time.
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = 0; t <= T_END; t += 60) { const x = Math.round(tx(t)) + 0.5; ctx.moveTo(x, G.reqY - 36); ctx.lineTo(x, G.axisY); }
    ctx.stroke();
    ctx.font = font(10);
    ctx.textAlign = "left";
    ctx.fillStyle = c.text3;
    ctx.fillText("req", 4, G.reqY);

    // Requests: one mark per answer, coloured by X-Cache, stacked where they crowd.
    const lvl = [];
    for (const v of vis) {
      const x = tx(v.s.at);
      let k = lvl.findIndex((lx) => x - lx >= 8);
      if (k < 0) k = lvl.length < 5 ? lvl.length : 4;
      lvl[k] = x;
      mark(ctx, x, G.reqY - k * 8, v.s.xCache, v.r.you, v.a, 3);
    }

    // Age rows: the Age the engine sent; a line joins two answers only when the
    // second is exactly the first plus the time between them (the same stored copy aging).
    L.forEach((ln, k) => {
      const y0 = G.laneTop + k * (G.laneH + G.laneGap), y1 = y0 + G.laneH;
      const ay = (a) => y1 - (Math.min(a, yMax) / yMax) * G.laneH;
      ctx.strokeStyle = c.strong;
      ctx.beginPath(); ctx.moveTo(G.padL, y1 + 0.5); ctx.lineTo(G.W - G.padR, y1 + 0.5); ctx.stroke();
      ctx.fillStyle = c.text3;
      ctx.textAlign = "left";
      ctx.font = font(10);
      ctx.fillText(L.length > 1 ? ln || "none" : "age", 4, y0 + G.laneH / 2 + 4);
      ctx.textAlign = "right";
      ctx.fillText(`${fmt(yMax)}s`, G.padL - 4, y0 + 8);
      ctx.fillText("0", G.padL - 4, y1);
      if (fresh) {
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = c.text3;
        const yf = Math.round(ay(fresh.fresh)) + 0.5;
        ctx.beginPath(); ctx.moveTo(G.padL, yf); ctx.lineTo(G.W - G.padR, yf); ctx.stroke();
        ctx.fillStyle = c.text3;
        ctx.textAlign = "right";
        if (k === 0 || G.laneH > 70) ctx.fillText(`${fresh.name}=${fresh.fresh}`, G.W - G.padR - 2, yf - 4);
        if (fresh.swr) {
          const ys = Math.round(ay(fresh.fresh + fresh.swr)) + 0.5;
          ctx.strokeStyle = c.line;
          ctx.beginPath(); ctx.moveTo(G.padL, ys); ctx.lineTo(G.W - G.padR, ys); ctx.stroke();
          if (k === 0 || G.laneH > 70) ctx.fillText(`+ stale-while-revalidate=${fresh.swr}`, G.W - G.padR - 2, ys - 4);
        }
        ctx.setLineDash([]);
      }
      const pts = [];
      for (const v of vis) {
        if (lane(v.r.headers) !== ln) continue;
        if (v.s.age !== "") pts.push({ t: v.s.at, age: Number(v.s.age), v });
        if ((v.s.upstream || []).length && v.s.xCache === "STALE") pts.push({ t: v.s.at, age: 0, refresh: true, v });
      }
      ctx.lineWidth = 1.25;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        if (q.age - p.age !== q.t - p.t || q.t === p.t) continue;
        ctx.globalAlpha = Math.min(p.v.a, q.v.a) * 0.7;
        ctx.strokeStyle = c.text2;
        ctx.beginPath(); ctx.moveTo(tx(p.t), ay(p.age)); ctx.lineTo(tx(q.t), ay(q.age)); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const p of pts) {
        if (p.refresh) {
          ctx.globalAlpha = p.v.a;
          ctx.strokeStyle = c.text2;
          ctx.beginPath(); ctx.moveTo(tx(p.t), y1 - 7); ctx.lineTo(tx(p.t), y1); ctx.stroke();
          ctx.globalAlpha = 1;
        } else mark(ctx, tx(p.t), ay(p.age), p.v.s.xCache, p.v.r.you, p.v.a, 3);
      }
    });

    // Origin load: client requests per 10 s (outline) against what reached the origin.
    const nb = T_END / BUCKET + 1;
    const cli = new Array(nb).fill(0), g200 = new Array(nb).fill(0), g304 = new Array(nb).fill(0);
    for (const v of vis) {
      const b = Math.floor(v.s.at / BUCKET);
      cli[b]++;
      for (const u of v.s.upstream || []) (u.endsWith("304") ? g304 : g200)[b]++;
    }
    const peak = Math.max(1, ...cli, ...g200.map((x, i) => x + g304[i]));
    const y1 = G.origTop + G.origH;
    const bw = Math.max(2, (G.plotW / (T_END / BUCKET)) - 2);
    const bh = (n) => (n / peak) * (G.origH - 12);
    ctx.fillStyle = c.text3;
    ctx.textAlign = "left";
    ctx.fillText("origin", 4, G.origTop + 10);
    ctx.textAlign = "right";
    ctx.fillText(`${peak}`, G.padL - 4, G.origTop + 22);
    for (let b = 0; b < nb; b++) {
      if (!cli[b] && !g200[b] && !g304[b]) continue;
      const x = Math.round(tx(b * BUCKET)) + 1;
      const w = Math.min(bw, G.W - G.padR - x);
      if (w <= 0) continue;
      ctx.strokeStyle = c.strong;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y1 - bh(cli[b]) + 0.5, w - 1, bh(cli[b]));
      ctx.fillStyle = c.signal;
      ctx.fillRect(x, y1 - bh(g200[b]), w, bh(g200[b]));
      ctx.fillStyle = c.text2;
      ctx.fillRect(x, y1 - bh(g200[b]) - bh(g304[b]), w, bh(g304[b]));
    }
    ctx.strokeStyle = c.text3;
    ctx.beginPath(); ctx.moveTo(G.padL, y1 + 0.5); ctx.lineTo(G.W - G.padR, y1 + 0.5); ctx.stroke();
    ctx.fillStyle = c.text3;
    ctx.textAlign = "center";
    for (let t = 0; t <= T_END; t += 60) ctx.fillText(`${t}s`, Math.min(G.W - G.padR - 12, Math.max(G.padL + 8, tx(t))), G.axisY + 15);

    // Playhead.
    const px = Math.round(tx(Math.min(simT, T_END))) + 0.5;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, G.reqY - 38); ctx.lineTo(px, G.axisY); ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.font = font(10, 600);
    ctx.textAlign = px > G.W - 70 ? "right" : "left";
    ctx.fillText(`${fmt(Math.floor(simT))} s`, px + (px > G.W - 70 ? -5 : 5), G.reqY - 30);

    if (hover) drawHover(ctx, vis, font);
  }

  function drawHover(ctx, vis, font) {
    const c = colors;
    let best = null;
    for (const v of vis) {
      const d = Math.abs(tx(v.s.at) - hover.x);
      if (d < 10 && (!best || d < best.d || (d === best.d && v.i > best.v.i))) best = { v, d };
    }
    if (!best) return;
    const { s, r } = best.v;
    const x = tx(s.at);
    ctx.strokeStyle = c.accent;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, G.reqY - 36); ctx.lineTo(Math.round(x) + 0.5, G.axisY); ctx.stroke();
    ctx.setLineDash([]);
    const lines = [`${fmt(s.at)} s${r.you ? " · you" : ""}${lane(r.headers) ? ` · ${lane(r.headers)}` : ""}`,
      `${s.xCache || s.status}${s.reason ? ` (${s.reason})` : ""} · ${s.age === "" ? "no Age" : `Age ${s.age}`}`,
      `${s.body.trim()} · origin: ${s.upstream && s.upstream.length ? s.upstream.join(", ") : "none"}`];
    ctx.font = font(10);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
    const bx = Math.max(4, Math.min(G.W - w - 4, x + 8 + w > G.W ? x - w - 8 : x + 8));
    const by = G.reqY + 10;
    ctx.fillStyle = c.surface;
    ctx.fillRect(bx, by, w, 46);
    ctx.strokeStyle = c.strong;
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, 45);
    ctx.textAlign = "left";
    lines.forEach((l, i) => { ctx.fillStyle = i ? c.text2 : c.text; ctx.fillText(l, bx + 6, by + 14 + i * 13); });
  }

  const fail = (err) => {
    status.textContent = err.message;
    setPlaying(false);
  };

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing) {
      simT = Math.min(T_END, simT + (dt / 1000) * Number(speed.value));
      pump(!reduce.matches).catch(fail);
      if (simT >= T_END && next >= schedule.length && !busy) {
        setPlaying(false);
        play.textContent = "Replay";
      }
    }
    draw(ts);
    updateDom(false);
    const moving = flights.length || flashes.length || land.some((t) => ts - t < FADE_MS);
    if ((playing || moving) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else { last = 0; updateDom(true); }
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) kick();
  }

  // Inputs.
  play.addEventListener("click", () => {
    if (!playing && simT >= T_END && next >= schedule.length) { playing = true; restart().then(() => setPlaying(true)).catch(fail); }
    else setPlaying(!playing);
  });
  step.addEventListener("click", () => {
    setPlaying(false);
    simT = Math.min(T_END, Math.floor(simT / 10) * 10 + 10);
    pump(!reduce.matches).then(() => { draw(performance.now()); updateDom(true); kick(); }).catch(fail);
  });
  reset.addEventListener("click", () => restart().then(kick).catch(fail));
  traffic.addEventListener("change", () => restart().then(kick).catch(fail));
  speed.addEventListener("change", kick);
  send.addEventListener("click", () => sendMine().catch(fail));
  policy.addEventListener("change", () => { loadPolicy(); replay().catch(fail); });
  for (const i of [cc, etag, vary]) {
    i.addEventListener("change", () => { policy.value = "custom"; replay().catch(fail); });
  }

  const local = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  canvas.addEventListener("pointermove", (e) => {
    const h = local(e);
    hover = G && h.y >= G.reqY - 40 && h.y <= G.axisY && h.x >= G.padL - 4 ? h : null;
    if (!raf) draw(performance.now());
  });
  canvas.addEventListener("pointerleave", () => { hover = null; if (!raf) draw(performance.now()); });

  new ResizeObserver(() => { if (!root.isConnected) return; layout(); readColors(); draw(performance.now()); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const recolor = () => { if (!root.isConnected) return; readColors(); draw(performance.now()); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
  window.addEventListener("themechange", recolor);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  loadPolicy();
  await cssReady;
  readColors();
  layout();
  await restart();
  setPlaying(playing);
}
