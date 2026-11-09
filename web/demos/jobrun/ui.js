// jobrun demo: jobrun's real cron engine (internal/cronx) and retry policy
// (job.Policy), compiled to WebAssembly, driving a scheduler on simulated time.
// Every fire time and every retry delay comes from the binary; the workers,
// handler run times and which attempts fail are the page's stand-ins.
const START = Date.UTC(2026, 10, 9, 8, 47);
const WARM_MS = 12.5 * 60e3;
const SCRIPT_OUTAGE_MS = 11 * 60e3;
const SEED = 1;
const BLOCK = 50;
const BURST = 16;
const OUTAGE_MS = 3 * 60e3;
const FLY_MS = 260;
const SPAN_ROWS = 10;
const ZONES = ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
const POLICIES = [
  [{ base: "30s", max: "10m", factor: 2 }, "30s, ×2, max 10m"],
  [{ base: "1s", max: "5m", factor: 2 }, "1s, ×2, max 5m (default)"],
  [{ base: "1m", max: "30m", factor: 3 }, "1m, ×3, max 30m"],
];
const EXAMPLES = [
  ["*/5 * * * *", "every 5 minutes"],
  ["7-59/10 * * * *", "at :07, :17, :27 …"],
  ["*/2 9-17 * * MON-FRI", "every 2 min, office hours"],
  ["0 9 1 * MON", "the 1st or any Monday"],
  ["0 0 29 2 *", "leap days only"],
];
const FAILS = [[1, "its 1st attempt"], [2, "2 attempts"], [3, "3 attempts"], [1e9, "every attempt"]];
const SPEEDS = [15, 30, 60, 120];
const BUILTIN = [
  { name: "report", expr: "*/15 9-17 * * MON-FRI", dur: 240e3, fail: 0 },
  { name: "sync", expr: "*/2 * * * *", dur: 40e3, fail: 1 },
  { name: "email", expr: "* * * * *", dur: 15e3, fail: 0 },
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

// fmtMs prints a span the way a person reads it: 850 ms, 4.2 s, 3 m 12 s, 2 d 4 h.
function fmtMs(ms) {
  if (ms < 999.5) return `${Math.round(ms)} ms`;
  if (ms < 9950) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 59500) return `${Math.round(ms / 1000)} s`;
  const t = Math.round(ms / 1000);
  if (t < 3600) return t % 60 ? `${Math.floor(t / 60)} m ${t % 60} s` : `${t / 60} m`;
  if (t < 86400) return `${Math.floor(t / 3600)} h ${Math.floor((t % 3600) / 60)} m`;
  return `${fmt(Math.floor(t / 86400))} d ${Math.floor((t % 86400) / 3600)} h`;
}

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
    o.selected = String(v) === String(value);
    s.append(o);
  }
  return s;
}

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
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
  const expr = el("input");
  Object.assign(expr, { type: "text", name: "expr", value: EXAMPLES[0][0], spellcheck: false, autocomplete: "off" });
  const example = select("example", EXAMPLES.map(([e, t]) => [e, t]), EXAMPLES[0][0]);
  const zone = select("tz", ZONES.map((z) => [z, z]), "UTC");
  const policy = select("policy", POLICIES.map((p, i) => [i, p[1]]), 0);
  const attempts = select("maxAttempts", [3, 5, 8].map((n) => [n, String(n)]), 5);
  const jitter = el("input");
  Object.assign(jitter, { type: "checkbox", name: "jitter", checked: true });
  const workers = select("workers", [2, 3, 4, 6].map((n) => [n, String(n)]), 4);
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 30);
  const knobs = el("div", "jr-knobs");
  knobs.append(field("your cron", expr, "jr-expr"), field("example", example), field("time zone", zone),
    field("backoff", policy), field("max attempts", attempts), field("full jitter", jitter, "jr-check"), field("workers", workers));
  const play = button("Pause");
  const step = button("Step 1 min", "secondary");
  const reset = button("Reset", "secondary");
  const fails = select("fails", FAILS, 3);
  const flaky = button("Enqueue flaky job");
  const outage = button("Outage", "secondary");
  const acts = el("div", "jr-acts");
  acts.append(flaky, field("flaky job fails", fails), outage);
  const clock = el("div", "jr-acts");
  clock.append(play, step, reset, field("speed", speed));
  const form = el("form", "jr-controls");
  const setup = el("form", "jr-controls jr-setup");
  for (const f of [form, setup]) f.addEventListener("submit", (e) => e.preventDefault());
  form.append(acts, clock);
  setup.append(knobs);

  const canvas = el("canvas", "jr-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend jr-legend");
  for (const [k, t] of [["fire", "fire, cronx"], ["ok", "attempt ok"], ["fail", "attempt failed"], ["wait", "backoff wait, job.Policy"], ["you", "yours"], ["outage", "outage"], ["now", "now"]]) {
    const s = el("span", "jr-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const hoverLine = el("p", "jr-hover", "Point at a fire, an attempt or a backoff wait to read it.");
  const youLine = el("p", "jr-you");
  youLine.setAttribute("aria-live", "polite");
  const nextBox = el("div", "jr-next");
  const nextHead = el("p", "jr-next-h");
  const nextList = el("ol", "jr-runs");
  nextBox.append(nextHead, nextList);
  const cells = el("ul", "cells stack jr-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["fires", "fires"], ["runs", "runs"], ["retries", "retries"], ["ok", "succeeded"], ["dead", "dead"],
    ["ready", "ready"], ["next", "next fire, yours"], ["maxwait", "max backoff"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "jr-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const status = el("p", "jr-status");
  status.setAttribute("aria-live", "polite");
  const receipt = el("p", "demo-out jr-out");
  root.replaceChildren(form, canvas, legend, hoverLine, youLine, cells, setup, nextBox, status, receipt);

  // State.
  let gen = 0;
  let now = START;
  let scheds = [];
  let jobs = [];
  let bars = [];
  let spans = [];
  let deaths = [];
  let flights = [];
  let lanes = [];
  let spanEnds = [];
  let ladders = new Map();
  let fetching = new Map();
  let outageAt = null;
  let nextId = 0;
  let mine = null;
  let st = null;
  let calls = 0, callMs = 0, firesGot = 0, drawsGot = 0;
  let playing = !reduce.matches;
  let visible = true;
  let stalled = false;
  let raf = 0, last = 0, lastDom = 0;
  let colors = null;
  let G = null;
  let hits = [];
  let hover = null;
  let fmtHM = null, fmtHMS = null, fmtZ = null;

  async function call(method, params) {
    const t0 = performance.now();
    calls++;
    try {
      return await demo.call(method, params);
    } finally {
      callMs += performance.now() - t0;
    }
  }

  function setZoneFormat() {
    const o = { timeZone: zone.value, hourCycle: "h23" };
    fmtHM = new Intl.DateTimeFormat("en-GB", { ...o, hour: "2-digit", minute: "2-digit" });
    fmtHMS = new Intl.DateTimeFormat("en-GB", { ...o, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtZ = new Intl.DateTimeFormat("en-US", { timeZone: zone.value, timeZoneName: "short" });
  }
  // The zone's abbreviation as cronx reported it on the next fire after t.
  function zoneName(t) {
    let best = null;
    for (const s of scheds) for (let k = s.next; k < s.fires.length; k++) if (s.fires[k].t >= t) { if (!best || s.fires[k].t < best.t) best = s.fires[k]; break; }
    return best && best.t - t < 3600e3 ? best.zone : fmtZ.formatToParts(t).find((p) => p.type === "timeZoneName")?.value || zone.value;
  }

  // The policy a job is enqueued with stays with it, as jobrun stores backoff per job.
  function curPolicy() {
    const [p] = POLICIES[Number(policy.value)];
    const pol = { ...p, jitter: jitter.checked };
    const max = Number(attempts.value);
    return { pol, max, key: `${pol.base}|${pol.max}|${pol.factor}|${pol.jitter}|${max}` };
  }

  // Each job owns one of the binary's seeded PCG streams: stream id % 50 of seed SEED + id / 50.
  const ladderKey = (pk, id) => `${pk.key}#${Math.floor(id / BLOCK)}`;
  function ladder(pk, id) {
    const k = ladderKey(pk, id);
    if (ladders.has(k)) return Promise.resolve(ladders.get(k));
    if (!fetching.has(k)) {
      const g = gen;
      fetching.set(k, call("backoff", { policy: pk.pol, maxAttempts: pk.max, seed: SEED + Math.floor(id / BLOCK), samples: BLOCK }).then((r) => {
        if (g === gen) { ladders.set(k, r); drawsGot += r.retries.length * BLOCK; }
        fetching.delete(k);
        return r;
      }, (err) => { fetching.delete(k); throw err; }));
    }
    return fetching.get(k);
  }

  function newSched(def, you) {
    return { ...def, you, fires: [], next: 0, from: now, exhausted: false, err: null, ver: 0, runs: 0, norm: def.expr };
  }

  // Fires the scheduler would materialise: each one is cronx's Next of the previous.
  function fillFires(s, until) {
    const run = (s.filling || Promise.resolve()).then(() => fillLoop(s, until));
    s.filling = run.catch(() => {});
    return run;
  }
  async function fillLoop(s, until) {
    while (!s.exhausted && !s.err && (lastFire(s) < until || futureCount(s) < 5)) {
      const v = s.ver, g = gen;
      const from = s.fires.length ? s.fires[s.fires.length - 1].t : s.from;
      const r = await call("cron", { expr: s.expr, tz: zone.value, start: iso(from), count: BLOCK });
      if (g !== gen || v !== s.ver) return;
      s.norm = r.normalized;
      for (const run of r.runs) s.fires.push({ t: Date.parse(run.utc), local: run.local, zone: run.zone });
      firesGot += r.runs.length;
      if (r.runs.length < BLOCK) s.exhausted = true;
    }
  }
  const lastFire = (s) => (s.fires.length ? s.fires[s.fires.length - 1].t : s.from);
  const futureCount = (s) => s.fires.length - s.next;
  const coverage = () => Math.min(...scheds.filter((s) => !s.exhausted && !s.err).map(lastFire), Infinity);

  let ensuring = null;
  function ensure() {
    if (!ensuring) {
      const g = gen;
      ensuring = (async () => {
        const until = now + G.span + 10 * 60e3;
        await Promise.all(scheds.map((s) => fillFires(s, until)));
        const pk = curPolicy();
        const need = [ladder(pk, nextId), ladder(pk, nextId + BURST)];
        for (const j of jobs) if (j.status !== "succeeded" && j.status !== "dead") need.push(ladder(j.pk, j.id));
        await Promise.all(need);
        if (g !== gen) return;
      })().finally(() => { ensuring = null; });
    }
    return ensuring;
  }

  function enqueue(kind, extra, src) {
    const pk = curPolicy();
    const j = { id: nextId++, kind, runAt: now, attempts: 0, pk, max: pk.max, status: "queued", waited: 0, prio: 0, ...extra };
    j.src = src || { t: now, y: G.queueY };
    jobs.push(j);
    return j;
  }

  // Discrete-event simulation to time T: attempt ends free workers, then fires
  // materialise jobs, then free workers claim ready jobs, oldest run_at first.
  // Returns false when it stopped early for fires or delays not fetched yet.
  function simTo(T, animate) {
    const lim = coverage();
    let ok = true;
    if (T > lim) { T = lim; ok = false; }
    for (;;) {
      let t = Infinity;
      for (const ln of lanes) if (ln.job && ln.end < t) t = ln.end;
      for (const s of scheds) { const f = s.fires[s.next]; if (f && !s.err && f.t < t) t = f.t; }
      if (lanes.some((l) => !l.job)) for (const j of jobs) if (j.status === "queued" && j.runAt > now && j.runAt < t) t = j.runAt;
      if (t > T) break;
      for (const ln of lanes) if (ln.job && ln.end === t && failsAt(ln) && ln.job.attempts < ln.job.max && !ladders.has(ladderKey(ln.job.pk, ln.job.id))) return false;
      now = t;
      lanes.forEach((ln, i) => { if (ln.job && ln.end === t) finish(ln, i, animate); });
      scheds.forEach((s, i) => {
        while (s.fires[s.next] && s.fires[s.next].t === t) {
          const f = s.fires[s.next++];
          s.runs++;
          st.fires++;
          const j = enqueue(s.name, { run: s.runs, dur: s.dur, fail: s.fail, you: s.you, fire: f }, { t, y: G.schedY(i) });
          j.runAt = t;
        }
      });
      claim(animate);
    }
    now = Math.max(now, T);
    claim(animate);
    return ok;
  }

  function failsAt(ln) {
    const j = ln.job;
    if (j.attempts <= j.fail) return true;
    return !!outageAt && ln.start < outageAt + OUTAGE_MS && ln.end > outageAt;
  }

  function finish(ln, i, animate) {
    const j = ln.job, bar = ln.bar;
    const failed = failsAt(ln);
    ln.job = null;
    bar.ok = !failed;
    bar.done = true;
    if (!failed) {
      j.status = "succeeded";
      st.ok++;
    } else if (j.attempts >= j.max) {
      j.status = "dead";
      st.dead++;
      deaths.push({ t: now, lane: i, job: j, t0: animate ? performance.now() : 0 });
    } else {
      const L = ladders.get(ladderKey(j.pk, j.id));
      const r = L.retries[j.attempts - 1];
      const delay = r.delaysMs[j.id % BLOCK];
      j.runAt = now + delay;
      j.status = "queued";
      st.retries++;
      st.maxWait = Math.max(st.maxWait, delay);
      j.waited += delay;
      const row = spanRow(now, j.runAt);
      const sp = { job: j, attempt: j.attempts, from: now, at: j.runAt, delay, cap: r.capMs, row, t0: animate ? performance.now() : 0 };
      spans.push(sp);
      j.span = sp;
      j.src = { t: j.runAt, y: G.spanY(row) };
    }
    if (j === mine) youUpdate(j, failed);
  }

  function spanRow(from, at) {
    let best = 0;
    for (let r = 0; r < SPAN_ROWS; r++) {
      if ((spanEnds[r] ?? -Infinity) < from) { best = r; break; }
      if (spanEnds[r] < spanEnds[best]) best = r;
    }
    spanEnds[best] = at + 15e3;
    return best;
  }

  // jobrun's claim query: ORDER BY priority DESC, run_at, id.
  const claimOrder = (a, b) => b.prio - a.prio || a.runAt - b.runAt || a.id - b.id;

  function claim(animate) {
    const free = lanes.filter((l) => !l.job);
    if (!free.length) return;
    const ready = jobs.filter((j) => j.status === "queued" && j.runAt <= now).sort(claimOrder);
    for (const ln of free) {
      const j = ready.shift();
      if (!j) break;
      const i = lanes.indexOf(ln);
      const src = now > j.runAt ? { t: now, y: G.queueY } : j.src;
      j.status = "leased";
      j.attempts++;
      st.runs++;
      ln.job = j;
      ln.start = now;
      ln.end = now + j.dur;
      ln.bar = { job: j, lane: i, start: now, end: ln.end, attempt: j.attempts, done: false, ok: false };
      bars.push(ln.bar);
      if (animate) flights.push({ from: src, to: { t: now, y: G.laneY(i) + G.laneH / 2 }, t0: performance.now(), you: j.you });
    }
  }

  function prune() {
    const cut = now - 2 * G.span;
    bars = bars.filter((b) => !b.done || b.end > cut);
    spans = spans.filter((s) => s.at > cut);
    deaths = deaths.filter((d) => d.t > cut);
    jobs = jobs.filter((j) => (j.status !== "succeeded" && j.status !== "dead") || j === mine);
    for (const s of scheds) {
      let k = 0;
      while (k < s.next && s.fires[k].t < cut) k++;
      if (k) { s.fires.splice(0, k); s.next -= k; }
    }
  }

  function youUpdate(j, failed) {
    const name = `Your flaky job #${j.id}`;
    if (j.status === "succeeded") {
      youLine.textContent = `${name} succeeded on attempt ${j.attempts} after ${j.attempts - 1} ${j.attempts === 2 ? "retry" : "retries"} and ${fmtMs(j.waited)} of backoff.`;
    } else if (j.status === "dead") {
      youLine.textContent = `${name} is dead after ${j.attempts} attempts: it stays in the dead-letter state until someone retries it.`;
    } else if (failed) {
      youLine.textContent = `${name}: attempt ${j.attempts} of ${j.max} failed; job.Policy drew a ${fmtMs(j.span.delay)} wait, under a ${fmtMs(j.span.cap)} cap.`;
    }
  }

  // Drawing.
  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = { bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"),
      text3: v("--text-3"), accent: v("--accent"), live: v("--live"), danger: v("--danger"), signal: v("--signal"), mono: v("--mono") || "monospace" };
  }

  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const k = lanes.length || Number(workers.value);
    const L = W < 520 ? 46 : 62, padR = 10;
    const span = (W < 480 ? 12 : W < 760 ? 20 : 30) * 60e3;
    const top = 30, schedH = 18, spanRowH = 7, laneH = 22;
    const spanTop = top + BUILTIN.length * schedH + schedH + 10;
    const queueY = spanTop + SPAN_ROWS * spanRowH + 14;
    const laneTop = queueY + 14;
    const H = laneTop + k * (laneH + 3) + 16;
    G = { W, H, L, padR, plotW: W - L - padR, span, top, schedH, spanTop, spanRowH, queueY, laneTop, laneH,
      schedY: (i) => top + i * schedH + schedH / 2, spanY: (r) => spanTop + r * spanRowH + 3, laneY: (i) => laneTop + i * (laneH + 3) };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const viewStart = () => now - G.span * 0.62;
  const X = (t) => G.L + ((t - viewStart()) / G.span) * G.plotW;

  function draw(ts) {
    if (!G || !colors) return;
    const c = colors;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    const font = (px, w = 400) => `${w} ${px}px ${c.mono}`;
    const x0 = G.L, x1 = G.W - G.padR, vs = viewStart(), ve = vs + G.span;
    hits = [];
    ctx.lineWidth = 1;

    // Outage window.
    if (outageAt && outageAt + OUTAGE_MS > vs && outageAt < ve) {
      const a = Math.max(x0, X(outageAt)), b = Math.min(x1, X(outageAt + OUTAGE_MS));
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = c.danger;
      ctx.fillRect(a, G.spanTop - 6, b - a, G.H - G.spanTop);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.danger;
      ctx.font = font(9, 600);
      ctx.textAlign = "left";
      if (b - a > 34) ctx.fillText("outage", a + 3, G.H - 4);
    }

    // Grid and time axis, in the chosen zone's wall clock.
    const tick = 5 * 60e3;
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    const ticks = [];
    for (let t = Math.ceil(vs / tick) * tick; t <= ve; t += tick) { const x = Math.round(X(t)) + 0.5; ticks.push([t, x]); ctx.moveTo(x, G.top - 4); ctx.lineTo(x, G.H); }
    ctx.stroke();
    const xn = X(now);
    ctx.font = font(10);
    ctx.textAlign = "center";
    ctx.fillStyle = c.text3;
    for (const [t, x] of ticks) if (Math.abs(x - xn) > 58 && x > x0 + 14 && x < x1 - 14) ctx.fillText(fmtHM.format(t), x, 14);
    ctx.textAlign = "left";
    ctx.fillText(zoneName(now), 4, 14);

    // Row labels and rules.
    ctx.fillStyle = c.text3;
    ctx.font = font(10);
    ctx.textBaseline = "middle";
    scheds.forEach((s, i) => {
      ctx.fillStyle = s.you ? c.accent : c.text2;
      ctx.font = font(10, s.you ? 600 : 400);
      ctx.fillText(s.name, 4, G.schedY(i));
    });
    ctx.fillStyle = c.text3;
    ctx.font = font(10);
    ctx.fillText("backoff", 4, G.spanTop + (SPAN_ROWS * G.spanRowH) / 2);
    ctx.fillText("ready", 4, G.queueY);
    lanes.forEach((_, i) => ctx.fillText(`w${i + 1}`, 4, G.laneY(i) + G.laneH / 2));
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    for (const y of [G.spanTop - 6, G.queueY - 7, G.laneTop - 2]) { ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); }
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, G.H);
    ctx.clip();

    // Fires from cronx: filled once materialised, hollow while still ahead.
    scheds.forEach((s, i) => {
      const y = G.schedY(i);
      let labelled = false;
      for (let k = 0; k < s.fires.length; k++) {
        const f = s.fires[k];
        if (f.t < vs - 60e3) continue;
        if (f.t > ve + 60e3) break;
        const x = X(f.t), past = k < s.next;
        if (x < x0 + 5 || x > x1 - 5) continue;
        ctx.beginPath();
        ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath();
        ctx.fillStyle = s.you ? c.accent : c.text2;
        ctx.strokeStyle = s.you ? c.accent : c.text2;
        if (past) { ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; } else { ctx.lineWidth = 1.25; ctx.stroke(); ctx.lineWidth = 1; }
        if (!past && !labelled && s.you && x <= x1) {
          labelled = true;
          ctx.font = font(9, 600);
          const label = fmtHM.format(f.t), flip = x + 8 + ctx.measureText(label).width > x1;
          ctx.textAlign = flip ? "right" : "left";
          ctx.fillStyle = c.accent;
          ctx.fillText(label, flip ? x - 8 : x + 8, y + 0.5);
        }
        hits.push({ x0: x - 6, x1: x + 6, y0: y - 8, y1: y + 8, text: () => `${s.name}: cronx fires at ${f.local} ${f.zone} (${s.norm})${past ? `, materialised as a job` : `, ${fmtMs(f.t - now)} from now`}.` });
      }
    });

    // Backoff waits from job.Policy: a line from the failed attempt's end to the retry's run_at.
    for (const sp of spans) {
      if (sp.at < vs || sp.from > ve) continue;
      const y = G.spanY(sp.row);
      const grow = sp.t0 ? ease((ts - sp.t0) / FLY_MS) : 1;
      const a = X(sp.from), b = X(sp.from + (sp.at - sp.from) * grow);
      const col = sp.job.you ? c.accent : c.text2;
      ctx.strokeStyle = col;
      ctx.lineWidth = sp.job.you ? 2 : 1.25;
      ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.stroke();
      ctx.fillStyle = c.danger;
      ctx.fillRect(a - 1, y - 2.5, 2, 5);
      ctx.beginPath();
      ctx.arc(b, y, 2.5, 0, Math.PI * 2);
      if (sp.at <= now) { ctx.fillStyle = col; ctx.fill(); } else { ctx.fillStyle = c.bg; ctx.fill(); ctx.stroke(); }
      ctx.lineWidth = 1;
      if (sp.job === mine && grow === 1) {
        ctx.font = font(9, 600);
        ctx.fillStyle = c.accent;
        ctx.textAlign = "left";
        ctx.fillText(`+${fmtMs(sp.delay)}`, b + 5, y + 0.5);
      }
      hits.push({ x0: a - 3, x1: Math.max(b, a + 6) + 3, y0: y - 3, y1: y + 3, text: () => `${jobName(sp.job)} failed attempt ${sp.attempt}; job.Policy drew a ${fmtMs(sp.delay)} wait under a ${fmtMs(sp.cap)} cap, so attempt ${sp.attempt + 1} runs at ${fmtHMS.format(sp.at)}.` });
    }

    // Jobs ready but waiting for a worker, lined up behind the playhead.
    const ready = jobs.filter((j) => j.status === "queued" && j.runAt <= now).sort(claimOrder);
    const room = Math.max(0, Math.floor((xn - x0 - 34) / 7));
    if (ready.length > room) {
      ctx.fillStyle = c.text2;
      ctx.font = font(9, 600);
      ctx.textAlign = "left";
      ctx.fillText(`+${fmt(ready.length - room)}`, x0 + 2, G.queueY + 0.5);
      ready.length = room;
    }
    ready.forEach((j, i) => {
      ctx.fillStyle = j.you ? c.accent : c.text;
      ctx.fillRect(xn - 9 - i * 7, G.queueY - 2.5, 5, 5);
    });

    // Attempts on the workers.
    for (const b of bars) {
      const end = b.done ? b.end : Math.min(b.end, now);
      if (end < vs || b.start > ve) continue;
      const a = X(b.start), z = Math.max(a + 2, X(end)), y = G.laneY(b.lane);
      const col = !b.done ? c.text : b.ok ? c.live : c.danger;
      ctx.globalAlpha = b.done ? 0.3 : 0.16;
      ctx.fillStyle = col;
      ctx.fillRect(a, y, z - a, G.laneH);
      ctx.globalAlpha = 1;
      ctx.fillRect(a, y, 2, G.laneH);
      if (b.job.you) { ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5; ctx.strokeRect(a + 0.75, y + 0.75, z - a - 1.5, G.laneH - 1.5); ctx.lineWidth = 1; }
      const label = `${b.job.kind}${b.attempt > 1 ? ` a${b.attempt}` : ""}`;
      ctx.font = font(9, b.job.you ? 600 : 400);
      if (z - a > ctx.measureText(label).width + 9) {
        ctx.fillStyle = b.job.you ? c.accent : c.text;
        ctx.textAlign = "left";
        ctx.fillText(label, a + 5, y + G.laneH / 2 + 0.5);
      }
      hits.push({ x0: a, x1: z, y0: y, y1: y + G.laneH, text: () => `${jobName(b.job)}, attempt ${b.attempt} of ${b.job.max} on worker ${b.lane + 1}, ${fmtHMS.format(b.start)} to ${fmtHMS.format(b.end)}: ` +
        (!b.done ? "running." : b.ok ? "succeeded." : b.attempt >= b.job.max ? "failed, and that was the last attempt, so the job is dead." : "failed, so it goes back to the queue with a backoff.") });
    }
    for (const d of deaths) {
      const x = X(d.t) + 7, y = G.laneY(d.lane) + G.laneH / 2;
      const s = d.t0 ? ease((ts - d.t0) / FLY_MS) : 1;
      ctx.strokeStyle = c.danger;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4 * s, y - 4 * s); ctx.lineTo(x + 4 * s, y + 4 * s);
      ctx.moveTo(x + 4 * s, y - 4 * s); ctx.lineTo(x - 4 * s, y + 4 * s);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.font = font(9, 600);
      ctx.fillStyle = c.danger;
      ctx.textAlign = "left";
      ctx.fillText("dead", x + 7, y + 0.5);
    }

    // Jobs dropping from their fire, or from their backoff wait, onto a worker.
    flights = flights.filter((f) => ts - f.t0 < FLY_MS);
    for (const f of flights) {
      const t = ease((ts - f.t0) / FLY_MS);
      const x = X(f.from.t) + (X(f.to.t) - X(f.from.t)) * t, y = f.from.y + (f.to.y - f.from.y) * t;
      ctx.fillStyle = f.you ? c.accent : c.text;
      ctx.beginPath(); ctx.arc(x, y, f.you ? 4 : 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Playhead.
    ctx.strokeStyle = c.signal;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(Math.round(xn) + 0.5, G.top - 6); ctx.lineTo(Math.round(xn) + 0.5, G.H); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = c.signal;
    ctx.font = font(10, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(fmtHMS.format(now), xn, 14);
    ctx.textBaseline = "middle";

    if (hover) {
      const h = [...hits].reverse().find((k) => hover.x >= k.x0 && hover.x <= k.x1 && hover.y >= k.y0 && hover.y <= k.y1);
      const text = h ? h.text() : "Point at a fire, an attempt or a backoff wait to read it.";
      if (hoverLine.textContent !== text) hoverLine.textContent = text;
    }
  }

  const jobName = (j) => (j.run ? `${j.kind} run ${j.run}` : `${j.kind} #${j.id}`);

  function updateDom(force) {
    const t = performance.now();
    if (!force && t - lastDom < 200) return;
    lastDom = t;
    const you = scheds.find((s) => s.you);
    const set = (k, v) => { if (cell[k].textContent !== v) cell[k].textContent = v; };
    set("t", `${fmtHMS.format(now)} ${zoneName(now)}`);
    set("fires", fmt(st.fires));
    set("runs", fmt(st.runs));
    set("retries", fmt(st.retries));
    set("ok", fmt(st.ok));
    set("dead", fmt(st.dead));
    set("ready", fmt(jobs.filter((j) => j.status === "queued" && j.runAt <= now).length));
    const nf = you && !you.err ? you.fires[you.next] : null;
    set("next", nf ? `in ${fmtMs(nf.t - now)}` : "–");
    set("maxwait", st.retries ? fmtMs(st.maxWait) : "–");
    const sim = now - START;
    receipt.textContent = `${fmtMs(sim)} of scheduling in ${fmt(Math.round(callMs))} ms: cronx returned ${plural(firesGot, "fire time")} and job.Policy ${plural(drawsGot, "backoff draw")}, over ${plural(calls, "call")} to jobrun's engine.`;
    canvas.setAttribute("aria-label", `Scheduler timeline at ${fmtHMS.format(now)} ${zoneName(now)}: ${fmt(st.fires)} fires, ${fmt(st.runs)} runs, ` +
      `${fmt(st.retries)} retries, ${fmt(st.ok)} succeeded, ${fmt(st.dead)} dead.`);
    nextRuns(you);
  }

  function nextRuns(you) {
    if (!you || you.err) { nextList.replaceChildren(); nextHead.textContent = ""; return; }
    nextHead.textContent = `yours, ${you.norm}: the next fires from cronx`;
    const up = you.fires.slice(you.next, you.next + 5);
    const end = you.exhausted && up.length < 5;
    const key = `${up.map((f) => f.t).join()}|${end}`;
    if (nextList.dataset.key !== key) {
      nextList.dataset.key = key;
      nextList.replaceChildren(...up.map((f) => {
        const li = el("li", "jr-run");
        li.append(el("span", "jr-mono", f.local), el("span", "jr-zone", f.zone), el("span", "jr-in"));
        return li;
      }));
      if (end) nextList.append(el("li", "jr-run jr-end", `${up.length ? "then none" : "no fire"} within 5 years (cronx.MaxLookahead), where jobrun disables the schedule`));
    }
    up.forEach((f, i) => { nextList.children[i].lastChild.textContent = `in ${fmtMs(f.t - now)}`; });
  }

  // Lifecycle.
  async function warm() {
    gen++;
    const g = gen;
    now = START;
    jobs = []; bars = []; spans = []; deaths = []; flights = []; spanEnds = [];
    ladders = new Map(); fetching = new Map(); ensuring = null;
    outageAt = null; nextId = 0; mine = null;
    calls = 0; callMs = 0; firesGot = 0; drawsGot = 0;
    st = { fires: 0, runs: 0, ok: 0, dead: 0, retries: 0, maxWait: 0 };
    lanes = Array.from({ length: Number(workers.value) }, () => ({ job: null }));
    layout();
    scheds = [...BUILTIN.map((d) => newSched(d, false)), newSched({ name: "yours", expr: expr.value.trim(), dur: 30e3, fail: 0 }, true)];
    youLine.textContent = "";
    status.textContent = "";
    hoverLine.textContent = "Point at a fire, an attempt or a backoff wait to read it.";
    await yoursCheck(scheds[scheds.length - 1], true);
    for (const T of [START + SCRIPT_OUTAGE_MS, START + WARM_MS]) {
      let guard = 0;
      while (now < T) {
        await ensure();
        if (g !== gen) return;
        if (++guard > 200) throw new Error("the scheduler made no progress");
        simTo(T, false);
      }
      if (T === START + SCRIPT_OUTAGE_MS) await doOutage(false);
      if (g !== gen) return;
    }
    status.textContent = `${scheds.map((s) => `${s.name} ${s.err ? "(invalid)" : s.norm}`).join(", ")}, in ${zone.value}. sync's handler fails its first attempt, and an outage hit at ${fmtHM.format(START + SCRIPT_OUTAGE_MS)}.`;
    updateDom(true);
    draw(performance.now());
  }

  // The visitor's expression goes through cronx first so a typo shows its own error.
  async function yoursCheck(s, first) {
    s.err = null;
    try {
      await fillFires(s, now + G.span + 10 * 60e3);
    } catch (err) {
      if (first && !(err.message || "").includes("cronx")) throw err;
      s.err = err.message;
      status.textContent = `yours: ${err.message}`;
    }
  }

  let restarting = Promise.resolve();
  const restart = () => (restarting = warm());
  const fail = (err) => { status.textContent = err.message; };

  async function retime(s, exprText) {
    s.ver++;
    s.fires = s.fires.slice(0, s.next);
    s.next = s.fires.length;
    s.from = now;
    s.exhausted = false;
    if (exprText !== undefined) s.expr = exprText;
    await yoursOrFill(s);
  }
  async function yoursOrFill(s) {
    if (s.you) await yoursCheck(s, false);
    else await fillFires(s, now + G.span + 10 * 60e3);
  }

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && !stalled && G) {
      const target = now + dt * Number(speed.value);
      const ok = simTo(target, !reduce.matches);
      if (!ensuring && (!ok || coverage() < now + G.span + 5 * 60e3 || !ladders.has(ladderKey(curPolicy(), nextId + BURST)))) {
        if (!ok) stalled = true;
        const g = gen;
        ensure().then(() => { if (g === gen) stalled = false; kick(); }, fail);
      }
      prune();
    }
    draw(ts);
    updateDom(false);
    const moving = flights.length || spans.some((s) => s.t0 && ts - s.t0 < FLY_MS) || deaths.some((d) => d.t0 && ts - d.t0 < FLY_MS);
    if ((playing || moving) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  const redraw = () => { updateDom(true); draw(performance.now()); kick(); };

  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) kick();
  }

  async function stepBy(ms) {
    await restarting;
    const g = gen;
    const T = now + ms;
    let guard = 0;
    while (now < T) {
      await ensure();
      if (g !== gen) return;
      if (++guard > 200) throw new Error("the scheduler made no progress");
      simTo(T, !reduce.matches);
    }
    prune();
    redraw();
  }

  // Inputs.
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => { setPlaying(false); stepBy(60e3).catch(fail); });
  reset.addEventListener("click", () => restart().then(redraw).catch(fail));
  workers.addEventListener("change", () => restart().then(redraw).catch(fail));
  zone.addEventListener("change", () => {
    setZoneFormat();
    restarting.then(() => Promise.all(scheds.map((s) => retime(s)))).then(() => {
      const r = scheds.find((s) => s.name === "report");
      const f = r.fires[r.next];
      status.textContent = `Every schedule now follows the ${zone.value} wall clock; report next fires ${f ? `${f.local} ${f.zone}` : "never within 5 years"}.`;
      redraw();
    }).catch(fail);
  });
  let typing;
  const setExpr = () => restarting.then(async () => {
    const s = scheds.find((x) => x.you);
    status.textContent = "";
    await retime(s, expr.value.trim());
    if (!s.err) status.textContent = `yours: cronx reads it as ${s.norm}, in ${zone.value}.`;
    redraw();
  }).catch(fail);
  expr.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(setExpr, 250); });
  example.addEventListener("change", () => { expr.value = example.value; clearTimeout(typing); setExpr(); });
  for (const k of [policy, attempts, jitter]) k.addEventListener("change", () => {
    const pk = curPolicy();
    ladder(pk, nextId).then((r) => {
      const caps = r.retries.map((x) => fmtMs(x.capMs)).join(", ");
      status.textContent = `New jobs get ${r.policy.base}, ×${r.policy.factor}, max ${r.policy.max}${r.policy.jitter ? " with full jitter" : ", no jitter"}: caps ${caps || "none"}, then dead at attempt ${pk.max}. Jobs already queued keep the policy they were enqueued with.`;
      redraw();
    }).catch(fail);
  });

  flaky.addEventListener("click", () => restarting.then(async () => {
    const g = gen;
    const j = enqueue("flaky", { dur: 20e3, fail: Number(fails.value), you: true, prio: 1 });
    mine = j;
    await ladder(j.pk, j.id);
    if (g !== gen) return;
    youLine.textContent = `Your flaky job #${j.id} is queued at priority 1, so workers claim it ahead of the backlog; it fails ${FAILS.find(([v]) => v === j.fail)[1]} and may make ${j.max}.`;
    claim(!reduce.matches);
    redraw();
  }).catch(fail));

  // An outage: every attempt that overlaps it fails, and a burst of jobs lands in it.
  async function doOutage(animate) {
    const g = gen;
    outageAt = now;
    const first = nextId;
    for (let i = 0; i < BURST; i++) enqueue("burst", { dur: 15e3, fail: 0 });
    await Promise.all([ladder(curPolicy(), first), ladder(curPolicy(), nextId)]);
    if (g !== gen) return;
    claim(animate);
  }
  outage.addEventListener("click", () => restarting.then(async () => {
    await doOutage(!reduce.matches);
    status.textContent = `Outage from ${fmtHMS.format(outageAt)} for ${fmtMs(OUTAGE_MS)}: every attempt that overlaps it fails, and ${BURST} burst jobs were enqueued into it. ${jitter.checked ? "Full jitter spreads their retries." : "Without jitter every retry waits exactly its cap."}`;
    redraw();
  }).catch(fail));

  const local = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  canvas.addEventListener("pointermove", (e) => { hover = local(e); if (!raf) draw(performance.now()); });
  canvas.addEventListener("pointerdown", (e) => { hover = local(e); if (!raf) draw(performance.now()); });
  canvas.addEventListener("pointerleave", () => { hover = null; });

  new ResizeObserver(() => { if (!root.isConnected || !st) return; layout(); readColors(); draw(performance.now()); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  const recolor = () => { if (!root.isConnected) return; readColors(); draw(performance.now()); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);
  window.addEventListener("themechange", recolor);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  setZoneFormat();
  await cssReady;
  readColors();
  await restart();
  setPlaying(playing);
}
