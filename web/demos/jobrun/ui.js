// jobrun demo: the real cron parser (cronx) and retry backoff (job.Policy).
const SVG = "http://www.w3.org/2000/svg";
const ZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
const CRON_PRESETS = [
  ["*/15 9-17 * * MON-FRI", "Europe/London", "2026-01-01T00:00:00Z", "Every 15 minutes in office hours"],
  ["30 2 * * *", "America/New_York", "2026-03-07T00:00:00Z", "02:30 daily across the March DST jump"],
  ["30 1 * * *", "America/New_York", "2026-10-31T00:00:00Z", "01:30 daily across the November fall-back"],
  ["0 9 1 * MON", "UTC", "2026-01-01T00:00:00Z", "The 1st of the month OR any Monday"],
  ["0 0 29 2 *", "UTC", "2026-01-01T00:00:00Z", "Leap days only"],
];
const CRON_NOTES = {
  "30 2 * * *": "On 8 March New York skips 02:00-03:00, so 02:30 does not exist that day and the run is skipped.",
  "30 1 * * *": "On 1 November 01:30 happens twice; jobrun fires on the first one only.",
  "0 9 1 * MON": "Vixie cron rule: when both day fields are restricted, a day matches if either does.",
};
const SAMPLES = 20;
const RUNS = 10;

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
  const wrap = el("label", "demo-field jr-field" + (cls ? " " + cls : ""));
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function input(name, value, attrs = {}) {
  const i = el("input");
  Object.assign(i, { name, value, spellcheck: false, autocomplete: "off", type: "text" }, attrs);
  return i;
}

function select(name, options) {
  const s = el("select");
  s.name = name;
  for (const [v, t] of options) {
    const o = el("option", null, t);
    o.value = v;
    s.append(o);
  }
  return s;
}

// fmtMs prints a delay the way a person reads it: 850 ms, 4.2 s, 3 m 12 s.
function fmtMs(ms) {
  if (ms < 999.5) return `${Math.round(ms)} ms`;
  if (ms < 9950) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 59500) return `${Math.round(ms / 1000)} s`;
  const t = Math.round(ms / 1000);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return s ? `${m} m ${s} s` : `${m} m`;
}

function debounced(fn) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, 250); };
}

function cronPanel(demo) {
  const box = el("section", "jr-panel");
  box.setAttribute("aria-labelledby", "jr-cron-h");
  const h = el("h3", "jr-h", "Cron schedule");
  h.id = "jr-cron-h";
  const expr = input("expr", CRON_PRESETS[0][0], { className: "jr-mono" });
  const zone = select("tz", ZONES.map((z) => [z, z]));
  const start = input("start", CRON_PRESETS[0][2], { className: "jr-mono" });
  const preset = select("cronPreset", CRON_PRESETS.map((p, i) => [String(i), p[3]]));
  const form = el("form", "jr-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(field("Cron expression", expr, "jr-wide"), field("Time zone", zone), field("After (UTC, RFC 3339)", start), field("Example", preset));
  const note = el("p", "jr-note");
  const list = el("ol", "jr-runs");
  const status = el("p", "demo-out jr-status");
  status.setAttribute("aria-live", "polite");
  box.append(h, form, note, list, status);

  const load = (i) => {
    const [e, z, s] = CRON_PRESETS[i];
    expr.value = e;
    zone.value = z;
    start.value = s;
  };
  load(0);

  let seq = 0;
  async function run(first = false) {
    const mine = ++seq;
    const sent = { expr: expr.value, tz: zone.value, start: start.value.trim(), count: RUNS };
    const t0 = performance.now();
    let r;
    try {
      r = await demo.call("cron", sent);
    } catch (err) {
      if (first) throw err;
      if (mine === seq) {
        list.replaceChildren();
        note.textContent = "";
        status.textContent = err.message;
      }
      return;
    }
    if (mine !== seq) return;
    const ms = performance.now() - t0;
    let prevZone = null;
    list.replaceChildren(...r.runs.map((run) => {
      const li = el("li", "jr-run");
      const when = el("span", "jr-mono", run.local);
      const z = el("span", "jr-zone", run.zone);
      if (prevZone !== null && run.zone !== prevZone) z.classList.add("jr-zone-change");
      prevZone = run.zone;
      li.append(when, z, el("span", "jr-utc", run.utc));
      return li;
    }));
    // A note is only true for its own preset: another zone or year moves the DST change.
    const p = CRON_PRESETS.find(([e, z, s]) => e === sent.expr && z === sent.tz && s === sent.start);
    note.textContent = (p && CRON_NOTES[p[0]]) || "";
    const took = `in ${Math.round(ms)} ms, in your browser.`;
    if (r.runs.length === 0) status.textContent = `${r.normalized} never matches in the next 5 years (cronx.MaxLookahead), so it has no runs.`;
    else if (r.runs.length < RUNS) status.textContent = `${r.normalized}: only ${r.runs.length} runs from cronx, then none within 5 years (cronx.MaxLookahead), where jobrun disables the schedule; ${took}`;
    else status.textContent = `${r.normalized}: next ${r.runs.length} runs from cronx, ${took}`;
  }
  const later = debounced(run);
  for (const i of [expr, start]) i.addEventListener("input", later);
  zone.addEventListener("change", () => run());
  preset.addEventListener("change", () => { load(Number(preset.value)); run(); });
  return { box, run };
}

function chart(r) {
  const n = r.retries.length;
  const yMax = Math.max(1, ...r.retries.map((x) => x.capMs));
  const W = 100 * Math.max(n, 1);
  const H = 160;
  const y = (v) => H - 8 - ((H - 16) * v) / yMax;
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img",
    "aria-label": n ? `Retry delays for attempts 1 to ${n}, up to ${fmtMs(yMax)}` : "No retries: attempt 1 is final" });
  if (n > 16) g.classList.add("jr-many");
  r.retries.forEach((rt, i) => {
    const cx = i * 100 + 50;
    g.append(svg("rect", { class: "jr-cap", x: cx - 30, width: 60, y: y(rt.capMs), height: H - 8 - y(rt.capMs) }));
    rt.delaysMs.forEach((d, j) => {
      const jitter = ((j * 37) % SAMPLES) / SAMPLES - 0.5;
      // A zero-length round-capped line stays a round dot however far the chart is stretched.
      const x = cx + jitter * 44;
      g.append(svg("line", { class: "jr-dot", x1: x, x2: x, y1: y(d), y2: y(d), "vector-effect": "non-scaling-stroke" }));
    });
  });
  return g;
}

function backoffPanel(demo) {
  const box = el("section", "jr-panel");
  box.setAttribute("aria-labelledby", "jr-bo-h");
  const h = el("h3", "jr-h", "Retry backoff");
  h.id = "jr-bo-h";
  const base = input("base", "1s", { className: "jr-mono" });
  const max = input("max", "5m", { className: "jr-mono" });
  const factor = input("factor", "2", { type: "number", min: 1, max: 10, step: "any", inputMode: "decimal" });
  const attempts = input("maxAttempts", "8", { type: "number", min: 1, max: 50, step: 1, inputMode: "numeric" });
  const jitter = el("input");
  Object.assign(jitter, { type: "checkbox", name: "jitter", checked: true });
  const seed = input("seed", "1", { type: "number", min: 0, max: 999999, step: 1, inputMode: "numeric" });
  const reseed = el("button", "secondary", "New draws");
  reseed.type = "button";
  const form = el("form", "jr-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const jit = el("label", "jr-check");
  jit.append(jitter, el("span", null, "Full jitter"));
  form.append(field("Base", base), field("Max", max), field("Factor", factor), field("Max attempts", attempts), field("Seed", seed), jit, reseed);
  const fig = el("figure", "jr-chart");
  fig.setAttribute("aria-label", "Retry delay chart");
  const axis = el("p", "jr-axis");
  const legend = el("p", "jr-legend");
  legend.append(el("span", "jr-key jr-key-cap", "cap: Base × Factor^(n−1), at most Max"), el("span", "jr-key jr-key-dot", `${SAMPLES} seeded draws per attempt`));
  const table = el("div", "jr-scroll");
  table.setAttribute("aria-label", "Retry delays by attempt");
  const status = el("p", "demo-out jr-status");
  status.setAttribute("aria-live", "polite");
  box.append(h, form, legend, fig, axis, table, status);

  let seq = 0;
  async function run(first = false) {
    const mine = ++seq;
    const bad = [[factor, "Factor"], [attempts, "Max attempts"], [seed, "Seed"]].find(([i]) => i.value === "" || !i.validity.valid);
    if (bad) {
      fig.replaceChildren();
      table.replaceChildren();
      axis.replaceChildren();
      status.textContent = `${bad[1]} must be from ${bad[0].min} to ${bad[0].max}.`;
      return;
    }
    const params = {
      policy: { base: base.value.trim(), max: max.value.trim(), factor: Number(factor.value), jitter: jitter.checked },
      maxAttempts: Number(attempts.value),
      seed: Number(seed.value),
      samples: SAMPLES,
    };
    const t0 = performance.now();
    let r;
    try {
      r = await demo.call("backoff", params);
    } catch (err) {
      if (first) throw err;
      if (mine === seq) {
        fig.replaceChildren();
        table.replaceChildren();
        axis.replaceChildren();
        status.textContent = err.message;
      }
      return;
    }
    if (mine !== seq) return;
    const ms = performance.now() - t0;
    fig.replaceChildren(chart(r));
    if (r.retries.length) axis.replaceChildren(el("span", null, "attempt 1"), el("span", null, `attempt ${r.retries.length}`));
    else axis.replaceChildren();
    const t = el("table", "jr-table");
    const head = el("tr");
    for (const c of ["Attempt fails", "Cap", "Shortest draw", "Longest draw"]) head.append(el("th", null, c));
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const rt of r.retries) {
      const tr = el("tr");
      tr.append(el("td", "jr-mono", String(rt.attempt)), el("td", "jr-mono", fmtMs(rt.capMs)),
        el("td", "jr-mono", fmtMs(Math.min(...rt.delaysMs))), el("td", "jr-mono", fmtMs(Math.max(...rt.delaysMs))));
      tbody.append(tr);
    }
    const last = el("tr", "jr-dead");
    last.append(el("td", "jr-mono", String(params.maxAttempts)), el("td", null, "dead: no retry, attempts reached max attempts"));
    last.lastChild.colSpan = 3;
    tbody.append(last);
    t.append(thead, tbody);
    table.replaceChildren(t);
    status.textContent = `Policy ${r.policy.base}, ×${r.policy.factor}, max ${r.policy.max}: ${r.retries.length} retries from job.Policy, in ${Math.round(ms)} ms, in your browser.`;
  }
  const later = debounced(run);
  for (const i of [base, max, factor, attempts, seed]) i.addEventListener("input", later);
  jitter.addEventListener("change", () => run());
  reseed.addEventListener("click", () => { seed.value = String((Number(seed.value) + 1) % 1000000); run(); });
  return { box, run };
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
  const cron = cronPanel(demo);
  const backoff = backoffPanel(demo);
  root.replaceChildren(cron.box, backoff.box);
  await cssReady;
  await cron.run(true);
  await backoff.run(true);
}
