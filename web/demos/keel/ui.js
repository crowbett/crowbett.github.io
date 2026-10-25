// keel demo: keel's deterministic simulator, compiled to WebAssembly. One call
// runs a whole seed of the Raft register workload under nemesis faults and
// returns its trace digest, the fault schedule and the history check.
const SVG = "http://www.w3.org/2000/svg";
const SERVERS = [1, 2, 3, 4, 5];
const MAX_SEED = Number.MAX_SAFE_INTEGER;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const secs = (ns) => `${(ns / 1e9).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
const set = (nodes) => `{${nodes.join(",")}}`;

function describe(e) {
  switch (e.kind) {
    case "crash": return `node ${e.node} crashes`;
    case "restart": return `node ${e.node} restarts (incarnation ${e.inc})`;
    case "pause": return `node ${e.node} pauses`;
    case "resume": return `node ${e.node} resumes`;
    case "partition": return `partition ${set(e.sides[0])} | ${set(e.sides[1])}`;
    case "heal": return "network healed";
    case "skew": return e.skew_ns ? `node ${e.node} clock skewed ${e.skew_ns > 0 ? "+" : "−"}${fmt(Math.round(Math.abs(e.skew_ns) / 1e6))} ms` : `node ${e.node} clock skew reset`;
    default: return e.kind;
  }
}

// Turns the event list into spans: [lane, kind, from, to, label].
function spans(events, end) {
  const out = [];
  const open = new Map();
  const close = (key, t) => {
    const s = open.get(key);
    if (s) out.push([...s, t]);
    open.delete(key);
  };
  for (const e of events) {
    if (e.kind === "crash") open.set(`n${e.node}`, [e.node, "down", e.t_ns]);
    else if (e.kind === "pause") open.set(`n${e.node}`, [e.node, "paused", e.t_ns]);
    else if (e.kind === "restart" || e.kind === "resume") close(`n${e.node}`, e.t_ns);
    else if (e.kind === "partition" || e.kind === "heal") {
      close("net", e.t_ns);
      if (e.kind === "partition") open.set("net", [0, "cut", e.t_ns]);
    }
  }
  for (const k of [...open.keys()]) close(k, end);
  return out.map(([lane, kind, from, to]) => ({ lane, kind, from, to }));
}

const LANE = 22;

function timeline(r) {
  const end = Math.max(r.sim_ns, 1);
  const W = 1000;
  const lanes = [...SERVERS, 0];
  const H = LANE * lanes.length;
  const x = (t) => (t / end) * W;
  const y = (l) => (l === 0 ? SERVERS.length : l - 1) * LANE;
  const lastHeal = r.events.filter((e) => e.kind === "heal").at(-1);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label":
    `Fault schedule over ${secs(end)} of simulated time: ${r.events.length} fault events on 5 servers and the network` });
  const tip = (n, text) => { const t = svg("title", {}); t.textContent = text; n.append(t); return n; };
  const names = el("ul", "kl-lanes");
  names.setAttribute("aria-hidden", "true");
  for (const l of lanes) {
    g.append(svg("line", { class: "kl-track", x1: 0, x2: W, y1: y(l) + LANE / 2, y2: y(l) + LANE / 2, "vector-effect": "non-scaling-stroke" }));
    names.append(el("li", null, l === 0 ? "network" : `node ${l}`));
  }
  for (const s of spans(r.events, end)) {
    const what = s.kind === "down" ? "down" : s.kind === "paused" ? "paused" : "partitioned";
    g.append(tip(svg("rect", { class: `kl-bar kl-${s.kind}`, x: x(s.from), y: y(s.lane) + 4, width: Math.max(4, x(s.to) - x(s.from)), height: LANE - 8 }),
      `${s.lane ? `node ${s.lane}` : "network"} ${what} ${secs(s.from)} – ${secs(s.to)}`));
  }
  for (const e of r.events) {
    if ((e.kind === "skew" && e.skew_ns) || e.kind === "partition") {
      const lane = e.kind === "skew" ? e.node : 0;
      g.append(tip(svg("rect", { class: e.kind === "skew" ? "kl-skew" : "kl-tick", x: x(e.t_ns) - 2, y: y(lane) + 1, width: 4, height: LANE - 2 }),
        `${secs(e.t_ns)} ${describe(e)}`));
    }
  }
  if (lastHeal) {
    g.append(svg("line", { class: "kl-heal", x1: x(lastHeal.t_ns), x2: x(lastHeal.t_ns), y1: 0, y2: H, "vector-effect": "non-scaling-stroke" }));
  }
  const chart = el("div", "kl-chart");
  chart.append(names, g);
  const axis = el("p", "kl-axis");
  axis.append(el("span", null, "0 s"),
    el("span", null, lastHeal ? `faults healed at ${secs(lastHeal.t_ns)}` : ""),
    el("span", null, secs(end)));
  const legend = el("p", "kl-legend");
  for (const [k, t] of [["down", "crashed"], ["paused", "paused"], ["cut", "partitioned"], ["skew", "clock skew"]]) {
    const s = el("span", "kl-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const fig = el("figure", "kl-timeline");
  fig.append(legend, chart, axis);
  return fig;
}

// One line per event, except the heal's per-node clock skew resets, which share one.
function schedule(events) {
  const list = el("ol", "kl-events");
  list.setAttribute("aria-label", "Fault schedule");
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    let text = describe(e);
    if (e.kind === "skew" && !e.skew_ns) {
      const nodes = [e.node];
      while (events[i + 1]?.kind === "skew" && !events[i + 1].skew_ns && events[i + 1].t_ns === e.t_ns) nodes.push(events[++i].node);
      if (nodes.length > 1) text = `clock skew reset on nodes ${nodes.join(", ")}`;
    }
    const li = el("li");
    li.append(el("span", "kl-t", secs(e.t_ns)), el("span", null, text));
    list.append(li);
  }
  return list;
}

function totals(r) {
  const dl = el("dl", "kl-totals");
  const add = (k, v, cls) => {
    const d = el("div", cls);
    d.append(el("dt", null, k), el("dd", null, v));
    dl.append(d);
  };
  add("ok ops", fmt(r.ok));
  add("failed ops", fmt(r.fail));
  add("indeterminate", fmt(r.info));
  add("membership changes", fmt(r.conf_changes));
  add("history", r.linearizable ? "linearizable" : "not linearizable", r.linearizable ? "kl-pass" : "kl-fail");
  return dl;
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

  const form = el("form", "kl-controls");
  const seed = el("input");
  Object.assign(seed, { type: "number", name: "seed", min: 0, max: MAX_SEED, step: 1, value: 7, required: true });
  seed.inputMode = "numeric";
  const field = el("label", "demo-field kl-field");
  field.append(el("span", "demo-label", "Seed"), seed);
  const run = el("button", null, "Run");
  run.type = "submit";
  const again = el("button", "secondary", "Run again");
  again.type = "button";
  again.disabled = true;
  form.append(field, run, again);

  const status = el("p", "kl-status");
  status.setAttribute("aria-live", "polite");
  const replay = el("div", "kl-replay");
  replay.setAttribute("aria-live", "polite");
  const results = el("div", "kl-results");
  root.replaceChildren(form, status, replay, results);

  let first = null;
  let replays = 0;
  let busy = false;

  const digestRow = (label, r, ms, match) => {
    const row = el("div", "kl-row");
    row.append(el("span", "kl-which", label), el("code", "kl-digest", r.digest), el("span", "kl-ms", `${fmt(Math.round(ms))} ms`));
    if (match !== undefined) row.append(el("span", match ? "kl-match" : "kl-differ", match ? "identical, bit for bit" : "differs"));
    return row;
  };

  async function call(s) {
    const t0 = performance.now();
    const r = await demo.call("run", { seed: s });
    return [r, performance.now() - t0];
  }

  async function fresh(s) {
    status.textContent = `Running seed ${fmt(s)}…`;
    const [r, ms] = await call(s);
    first = { r, ms };
    replays = 0;
    status.textContent = `Seed ${fmt(r.seed)}: ${fmt(r.steps)} scheduler steps and ${fmt(r.trace_len)} traced events over ` +
      `${secs(r.sim_ns)} of simulated time, run in ${fmt(Math.round(ms))} ms in your browser.`;
    replay.replaceChildren(digestRow("Run", r, ms));
    results.replaceChildren(timeline(r), totals(r), schedule(r.events));
  }

  async function rerun() {
    const base = first;
    const [r, ms] = await call(base.r.seed);
    if (first !== base) return;
    replays++;
    replay.replaceChildren(digestRow("Run", base.r, base.ms),
      digestRow(replays === 1 ? "Run again" : `Run again ×${replays}`, r, ms, r.digest === base.r.digest));
  }

  // One run at a time; the first (from mount) rethrows so the frame shows its error.
  const guard = async (f, rethrow) => {
    if (busy) return;
    busy = true;
    run.disabled = again.disabled = true;
    try {
      await f();
    } catch (err) {
      if (rethrow) throw err;
      status.textContent = err.message;
    } finally {
      busy = false;
      run.disabled = false;
      again.disabled = !first;
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = Number(seed.value);
    if (!Number.isSafeInteger(s) || s < 0) {
      status.textContent = `Seed must be a whole number from 0 to ${fmt(MAX_SEED)}.`;
      return;
    }
    guard(() => fresh(s));
  });
  again.addEventListener("click", () => guard(rerun));

  await cssReady;
  await guard(async () => { await fresh(7); await rerun(); }, true);
}
