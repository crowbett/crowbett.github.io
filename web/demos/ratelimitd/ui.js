// ratelimitd demo: one seeded traffic pattern through ratelimitd's real GCRA,
// token bucket and sliding window Step functions, one chart per algorithm.
const SVG = "http://www.w3.org/2000/svg";
const DURATION_MS = 30000;
const BUCKETS = 60;
const NAMES = { gcra: "GCRA", token_bucket: "Token bucket", sliding_window: "Sliding window" };
const PATTERNS = [
  ["steady", "Steady, 1.2× the limit"],
  ["burst", "Half the limit, plus bursts of 2× burst"],
  ["ramp", "Ramp from 0 to 3× the limit"],
  ["attack", "Attack: 10× the limit mid-run"],
];

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
const fmt = (n) => n.toLocaleString("en-US");

function field(label, input) {
  const wrap = el("label", "demo-field rl-field");
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function numberInput(name, value, min, max) {
  const i = el("input");
  Object.assign(i, { type: "number", name, value, min, max, step: 1, inputMode: "numeric" });
  return i;
}

function chart(series, offered, yMax, limitPerBucket) {
  const fig = el("figure", "rl-chart");
  fig.dataset.algo = series.algo;
  const total = series.totalAllowed + series.totalDenied;
  const pct = total ? Math.round((100 * series.totalAllowed) / total) : 0;
  const cap = el("figcaption", "rl-cap");
  cap.append(
    el("strong", null, NAMES[series.algo] || series.algo),
    el("span", "rl-totals", `${fmt(series.totalAllowed)} allowed · ${fmt(series.totalDenied)} denied · ${pct}% allowed`),
  );
  const g = svg("svg", {
    viewBox: `0 0 ${offered.length} ${yMax}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": `${NAMES[series.algo]}: ${fmt(series.totalAllowed)} of ${fmt(total)} requests allowed`,
  });
  series.allowed.forEach((a, i) => {
    const d = series.denied[i];
    if (a) g.append(svg("rect", { class: "rl-allowed", x: i + 0.08, width: 0.84, y: yMax - a, height: a }));
    if (d) g.append(svg("rect", { class: "rl-denied", x: i + 0.08, width: 0.84, y: yMax - a - d, height: d }));
  });
  const ly = yMax - limitPerBucket;
  g.append(svg("line", { class: "rl-limit", x1: 0, x2: offered.length, y1: ly, y2: ly, "vector-effect": "non-scaling-stroke" }));
  fig.append(cap, g);
  return fig;
}

export async function mount(root, demo) {
  const css = el("link");
  css.rel = "stylesheet";
  css.href = new URL("./ui.css", import.meta.url).href;
  const cssReady = new Promise((r) => { css.onload = r; css.onerror = r; });
  document.head.append(css);

  const form = el("form", "rl-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const pattern = el("select");
  pattern.name = "pattern";
  for (const [v, t] of PATTERNS) {
    const o = el("option", null, t);
    o.value = v;
    pattern.append(o);
  }
  const rate = numberInput("rate", 50, 1, 1000);
  const burst = numberInput("burst", 20, 1, 2000);
  const seed = numberInput("seed", 1, 0, 999999);
  const reseed = el("button", "secondary", "New traffic");
  reseed.type = "button";
  form.append(
    field("Traffic", pattern),
    field("Limit (requests/s)", rate),
    field("Burst", burst),
    field("Seed", seed),
    reseed,
  );

  const charts = el("div", "rl-charts");
  const axis = el("p", "rl-axis");
  axis.append(el("span", null, "0 s"), el("span", null, `${DURATION_MS / 1000} s, in ${DURATION_MS / BUCKETS / 1000} s buckets`));
  const legend = el("p", "rl-legend");
  legend.append(
    el("span", "rl-key rl-key-allowed", "allowed"),
    el("span", "rl-key rl-key-denied", "denied"),
    el("span", "rl-key rl-key-limit", "limit per bucket"),
    el("span", "rl-note", "Sliding window has no burst: it estimates a moving 1 s window from the current and previous 1 s counts, so it can briefly let through more than the limit."),
  );
  const status = el("p", "demo-out rl-status");
  status.setAttribute("aria-live", "polite");
  root.replaceChildren(form, charts, axis, legend, status);

  let seq = 0;
  const inputs = [[rate, "Limit"], [burst, "Burst"], [seed, "Seed"]];
  async function run(first = false) {
    const mine = ++seq;
    const bad = inputs.find(([i]) => i.value === "" || !i.validity.valid);
    if (bad) {
      const [i, name] = bad;
      charts.replaceChildren();
      status.textContent = `${name} must be a whole number from ${i.min} to ${i.max}.`;
      return;
    }
    const params = {
      pattern: pattern.value,
      seed: Number(seed.value),
      rate: Number(rate.value),
      periodMs: 1000,
      burst: Number(burst.value),
      durationMs: DURATION_MS,
      buckets: BUCKETS,
    };
    const t0 = performance.now();
    let r;
    try {
      r = await demo.call("race", params);
    } catch (err) {
      if (first) throw err;
      if (mine === seq) {
        charts.replaceChildren();
        status.textContent = err.message;
      }
      return;
    }
    const ms = performance.now() - t0;
    if (mine !== seq) return;
    const limitPerBucket = r.bucketUs / r.emissionUs;
    const yMax = Math.max(1, limitPerBucket * 1.15, ...r.offered);
    charts.replaceChildren(...r.series.map((s) => chart(s, r.offered, yMax, limitPerBucket)));
    const offered = r.offered.reduce((a, b) => a + b, 0);
    status.textContent = `${fmt(offered)} requests through ${r.series.length} algorithms in ${Math.round(ms)} ms, in your browser.`;
  }

  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(run, 200); };
  for (const i of [rate, burst, seed]) i.addEventListener("input", later);
  pattern.addEventListener("change", run);
  reseed.addEventListener("click", () => {
    seed.value = String((Number(seed.value) + 1) % 1000000);
    run();
  });

  await cssReady;
  await run(true);
}
