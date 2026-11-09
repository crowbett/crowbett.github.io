// quorum demo: quorum's deterministic simulator (sim.Stepper) driving its real
// raft cores one tick at a time, compiled to WebAssembly. Every node, message,
// timer and log slot drawn here is read from the binary after each tick; the
// visitor's crashes, partitions and writes are calls into the same Stepper.
const NODES = [3, 5, 7];
const LOSS = [[0, "none"], [0.05, "5 %"], [0.2, "20 %"]];
const WRITES = [[0, "off"], [0.1, "0.1 / tick"], [0.3, "0.3 / tick"]];
const SPEEDS = [2, 5, 10, 20];
const WARM = 40;
const KEEP_EVENTS = 80;
const NS = "http://www.w3.org/2000/svg";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const svg = (tag, attrs = {}, cls) => {
  const n = document.createElementNS(NS, tag);
  if (cls) n.setAttribute("class", cls);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

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

function button(text, cls, type = "button") {
  const b = el("button", cls, text);
  b.type = type;
  return b;
}

function textInput(name, value, max) {
  const i = el("input");
  Object.assign(i, { type: "text", name, value, maxLength: max, autocomplete: "off", spellcheck: false });
  i.setAttribute("autocapitalize", "off");
  return i;
}

const ROLE = { leader: "leader", candidate: "candidate", "pre-candidate": "pre-vote", follower: "follower" };
const kindOf = (f) => {
  if (f.type === "Heartbeat" || f.type === "HeartbeatResp") return "hb";
  if (f.type === "App") return f.n > 0 ? "app" : "probe";
  if (f.type === "AppResp") return "ack";
  if (f.type === "Vote" || f.type === "PreVote") return "vote";
  if (f.type === "VoteResp" || f.type === "PreVoteResp") return "ballot";
  return "other";
};
const isResp = (f) => /Resp$/.test(f.type);

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

  // Controls: actions first, so the first Tab after start reaches Pause.
  const play = button("Pause");
  const step = button("Step", "secondary");
  const reset = button("Reset", "secondary");
  const crashL = button("Crash leader");
  const cut = button("Cut off leader");
  const heal = button("Heal", "secondary");
  const acts = el("div", "qr-acts");
  acts.append(play, step, reset, crashL, cut, heal);

  const nodesSel = select("nodes", NODES.map((n) => [n, `${n} nodes`]), 5);
  const loss = select("loss", LOSS, 0);
  const writes = select("writes", WRITES, 0.1);
  const speed = select("speed", SPEEDS.map((s) => [s, `${s} ticks/s`]), 5);
  const key = textInput("key", "x", 16);
  const value = textInput("value", "1", 16);
  key.classList.add("qr-key");
  value.classList.add("qr-val");
  const put = button("Put", null, "submit");
  const knobs = el("div", "qr-knobs");
  knobs.append(field("cluster", nodesSel), field("message loss", loss), field("background writes", writes), field("speed", speed));
  const putForm = el("form", "qr-put");
  putForm.append(field("key", key), field("value", value), put);
  const controls = el("div", "qr-controls");
  controls.append(acts, knobs, putForm);

  // The ring.
  const ring = svg("svg", { viewBox: "0 0 460 400" }, "qr-ring");
  ring.setAttribute("role", "group");
  const gFence = svg("g", {}, "qr-fences");
  const gEdges = svg("g", {}, "qr-edges");
  const gMsgs = svg("g", {}, "qr-msgs");
  const gNodes = svg("g", {}, "qr-nodes");
  ring.append(gFence, gEdges, gMsgs, gNodes);

  const logs = el("div", "qr-logs");
  logs.setAttribute("role", "img");
  const writesHead = el("p", "qr-h", "your writes");
  const writesList = el("ol", "qr-writes");
  const writesEmpty = el("p", "qr-empty", "None yet: put a key while a node leads.");
  const traceHead = el("p", "qr-h", "trace, newest last");
  const trace = el("ol", "qr-trace");
  const traceBox = el("div", "qr-tracebox");
  traceBox.tabIndex = 0;
  traceBox.setAttribute("role", "region");
  traceBox.setAttribute("aria-label", "Simulator trace");
  traceBox.append(trace);
  const side = el("div", "qr-side");
  side.append(el("p", "qr-h", "logs: term of each entry, by index"), logs, writesHead, writesList, writesEmpty, traceHead, traceBox);
  const stage = el("div", "qr-stage");
  stage.append(ring, side);

  const legend = el("p", "demo-legend qr-legend");
  for (const [k, t] of [["leader", "leader"], ["candidate", "candidate"], ["timer", "election timer"], ["hb", "heartbeat"], ["app", "append entries"], ["vote", "vote"], ["rej", "rejected or dropped"], ["unc", "uncommitted entry"]]) {
    const s = el("span", "qr-lg", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const status = el("p", "qr-status");
  status.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack qr-cells");
  const cell = {};
  for (const [k, t] of [["tick", "tick"], ["term", "term"], ["leader", "leader"], ["commit", "commit index"], ["leaders", "leaders elected"], ["flight", "in flight"], ["delivered", "delivered"], ["dropped", "dropped"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "qr-v", "–");
    li.append(el("span", "qr-k", t), v);
    cell[k] = v;
    cells.append(li);
  }
  const receipt = el("p", "demo-out qr-out");
  receipt.setAttribute("aria-live", "polite");
  root.replaceChildren(controls, stage, legend, status, cells, receipt);

  // State.
  let st = null;
  let n = 5;
  let gen = 0;
  let busy = 0;
  let chain = Promise.resolve();
  let callMs = 0;
  let playing = !reduce.matches;
  let visible = true;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let tickAt = 0;
  let geo = [];
  let nodeEls = [];
  let edgeEls = new Map();
  let pool = [];
  const lastLog = new Map();
  const seenTerm = new Map();
  const flash = new Map();
  const written = new Map();
  let lastDom = 0;

  const exec = (method, params) => {
    busy++;
    const g = gen;
    const run = chain.then(async () => {
      const t0 = performance.now();
      try {
        return await demo.call(method, params);
      } finally {
        callMs += performance.now() - t0;
      }
    }).finally(() => { busy--; });
    chain = run.catch(() => {});
    return run.then((r) => ({ r, g }));
  };

  // Geometry.
  const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const nodeR = () => (n > 5 ? 23 : 28);
  // One SVG unit is one CSS pixel, so labels keep their size on a phone; a
  // narrow ring puts each label under its node instead of beside it.
  let CX = 230, CY = 200, R = 138, W = 0, narrow = false;
  function layout() {
    W = Math.max(280, Math.round(ring.getBoundingClientRect().width || 460));
    const r = nodeR();
    narrow = W < 480;
    R = Math.round(narrow ? Math.min(W / 2 - 36, 150) : Math.min(W / 2 - r - 92, 170));
    CX = W / 2;
    CY = R + r + (narrow ? 36 : 48);
    let low = 0;
    for (let i = 0; i < n; i++) low = Math.max(low, Math.sin(angle(i)));
    const H = Math.round(CY + R * low + r + 40);
    ring.setAttribute("viewBox", `0 0 ${W} ${H}`);
  }
  function build() {
    layout();
    gEdges.replaceChildren();
    gNodes.replaceChildren();
    gMsgs.replaceChildren();
    gFence.replaceChildren();
    pool = [];
    edgeEls = new Map();
    geo = Array.from({ length: n }, (_, i) => ({ x: CX + R * Math.cos(angle(i)), y: CY + R * Math.sin(angle(i)), a: angle(i) }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const e = svg("line", { x1: geo[i].x, y1: geo[i].y, x2: geo[j].x, y2: geo[j].y }, "qr-edge");
      edgeEls.set(`${i + 1}-${j + 1}`, e);
      gEdges.append(e);
    }
    const r = nodeR();
    nodeEls = geo.map((p, i) => {
      const g = svg("g", {}, "qr-node");
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      const timer = svg("circle", { cx: p.x, cy: p.y, r: r + 6, pathLength: 1, transform: `rotate(-90 ${p.x} ${p.y})` }, "qr-timer");
      const body = svg("circle", { cx: p.x, cy: p.y, r }, "qr-body");
      const id = svg("text", { x: p.x, y: p.y - 2 }, "qr-id");
      id.textContent = String(i + 1);
      const term = svg("text", { x: p.x, y: p.y + 13 }, "qr-term");
      const cos = Math.cos(p.a), sin = Math.sin(p.a);
      let lx = p.x + cos * (r + 16), ly = p.y + sin * (r + 16) + (sin < -0.5 ? -14 : sin > 0.5 ? 12 : 0);
      let anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
      if (narrow) { lx = p.x; anchor = "middle"; ly = sin < -0.9 ? p.y - r - 24 : p.y + r + 20; }
      const role = svg("text", { x: lx, y: ly, "text-anchor": anchor }, "qr-role");
      const sub = svg("text", { x: lx, y: ly + 13, "text-anchor": anchor }, "qr-sub");
      g.append(timer, body, id, term, role, sub);
      g.addEventListener("click", () => toggle(i + 1));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i + 1); } });
      gNodes.append(g);
      return { g, timer, body, term, role, sub };
    });
  }

  function leaderOf(s) {
    let l = null;
    for (const x of s?.nodes || []) if (x.up && x.role === "leader" && (!l || x.term > l.term)) l = x;
    return l;
  }

  // Partition fences: an annular sector around each run of ring-adjacent nodes
  // that is not on the biggest side.
  function drawFences() {
    gFence.replaceChildren();
    const sides = st.nodes.map((x) => x.side);
    const count = new Map();
    for (const s of sides) count.set(s, (count.get(s) || 0) + 1);
    if (count.size < 2) return;
    let main = 0, best = -1;
    for (const [s, c] of count) if (c > best || (c === best && s === 0)) { main = s; best = c; }
    const r = nodeR(), d = Math.asin((r + 10) / R), r0 = R - r - 12, r1 = R + r + 12;
    for (let a = 0; a < n; a++) {
      if (sides[a] === main || sides[(a - 1 + n) % n] === sides[a]) continue;
      let b = a;
      while (sides[(b + 1) % n] === sides[a]) b = (b + 1) % n;
      const span = ((b - a + n) % n) * (2 * Math.PI / n);
      const t0 = angle(a) - d, t1 = angle(a) + span + d;
      const big = t1 - t0 > Math.PI ? 1 : 0;
      const pt = (rad, t) => `${(CX + rad * Math.cos(t)).toFixed(1)} ${(CY + rad * Math.sin(t)).toFixed(1)}`;
      gFence.append(svg("path", { d: `M ${pt(r1, t0)} A ${r1} ${r1} 0 ${big} 1 ${pt(r1, t1)} L ${pt(r0, t1)} A ${r0} ${r0} 0 ${big} 0 ${pt(r0, t0)} Z` }, "qr-fence"));
    }
  }

  function drawNodes(frac) {
    const now = performance.now();
    for (const x of st.nodes) {
      const e = nodeEls[x.id - 1];
      if (!e) continue;
      const role = x.up ? x.role : "down";
      e.g.dataset.role = role;
      e.term.textContent = x.up ? `t${x.term}` : "";
      e.role.textContent = x.up ? ROLE[x.role] || x.role : "down";
      e.sub.textContent = x.up ? `commit ${fmt(x.commit)}` : "click to restart";
      let p = 0;
      if (x.up && x.role !== "leader" && x.timeout > 0) p = clamp((x.elapsed + frac) / x.timeout, 0, 1);
      e.timer.setAttribute("stroke-dasharray", `${p.toFixed(3)} 1`);
      e.timer.dataset.hot = p > 0.75 ? "1" : "";
      e.g.dataset.flash = flash.has(`n${x.id}`) && now - flash.get(`n${x.id}`) < 600 ? "1" : "";
      e.g.setAttribute("aria-label", x.up
        ? `Node ${x.id}, ${ROLE[x.role] || x.role}, term ${x.term}, commit index ${x.commit}. Press to crash it.`
        : `Node ${x.id}, down. Press to restart it.`);
    }
    for (const [k, line] of edgeEls) {
      const [a, b] = k.split("-").map(Number);
      const na = st.nodes[a - 1], nb = st.nodes[b - 1];
      line.dataset.cut = na && nb && na.side !== nb.side ? "1" : "";
    }
  }

  function drawMsgs(frac) {
    const fl = st.flights;
    const r = nodeR();
    let used = 0;
    const tau = st.step + frac;
    for (const f of fl) {
      const a = geo[f.from - 1], b = geo[f.to - 1];
      if (!a || !b) continue;
      const span = Math.max(1, f.at - f.sent);
      let p = clamp((tau - f.sent) / span, 0, 1);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const lane = f.from < f.to ? 4 : -4;
      const sx = a.x + ux * r - uy * lane, sy = a.y + uy * r + ux * lane;
      const ex = b.x - ux * r - uy * lane, ey = b.y - uy * r + ux * lane;
      const to = st.nodes[f.to - 1], from = st.nodes[f.from - 1];
      let fade = 1, dropped = false;
      if (to && from && to.side !== from.side) {
        dropped = p > 0.45;
        if (p > 0.5) fade = clamp(1 - (p - 0.5) * 3, 0, 1);
        p = Math.min(p, 0.5);
      } else if (to && !to.up && p > 0.6) {
        dropped = true;
        fade = clamp(1 - (p - 0.6) * 2.5, 0, 1);
      }
      if (fade <= 0) continue;
      let c = pool[used];
      if (!c) { c = svg("circle", {}, "qr-m"); pool.push(c); gMsgs.append(c); }
      used++;
      const k = kindOf(f);
      const big = k === "app" || k === "vote";
      c.setAttribute("cx", (sx + (ex - sx) * p).toFixed(1));
      c.setAttribute("cy", (sy + (ey - sy) * p).toFixed(1));
      c.setAttribute("r", big ? (k === "app" ? 3 + Math.min(3, f.n) : 4.5) : isResp(f) ? 2.4 : 3);
      c.dataset.k = k;
      c.dataset.rej = f.reject || dropped ? "1" : "";
      c.style.setProperty("opacity", String(fade));
      c.removeAttribute("display");
    }
    for (let i = used; i < pool.length; i++) pool[i].setAttribute("display", "none");
  }

  function draw(ts) {
    if (!st || !geo.length) return;
    const frac = reduce.matches ? 0 : clamp((ts - tickAt) / (1000 / Number(speed.value)), 0, 1);
    drawNodes(frac);
    drawMsgs(frac);
  }

  // Logs: one row per node, columns aligned by index, each slot showing its term.
  function cols() {
    const w = logs.clientWidth || 300;
    return clamp(Math.floor((w - 34) / 22), 8, 24);
  }
  function drawLogs() {
    const k = cols();
    logs.style.setProperty("--qr-cols", String(k));
    let hi = 0;
    for (const x of st.nodes) if (x.up) hi = Math.max(hi, x.last);
    const lo = Math.max(1, hi - k + 1);
    const now = performance.now();
    const head = el("div", "qr-row qr-idx");
    head.append(el("span", "qr-rl", "idx"));
    for (let i = lo; i < lo + k; i++) head.append(el("span", "qr-c", i <= hi ? String(i) : ""));
    const rows = [head];
    const parts = [];
    for (const x of st.nodes) {
      const row = el("div", "qr-row");
      row.dataset.up = x.up ? "1" : "";
      const lab = el("span", "qr-rl", String(x.id));
      lab.dataset.role = x.up ? x.role : "down";
      row.append(lab);
      const kept = lastLog.get(x.id);
      const ents = x.up ? x.log : kept?.log || [];
      const commit = x.up ? x.commit : kept?.commit || 0;
      const by = new Map(ents.map((e) => [e.i, e]));
      for (let i = lo; i < lo + k; i++) {
        const e = by.get(i);
        const c = el("span", "qr-c", e ? String(e.t) : "");
        if (e) {
          c.dataset.tc = String(e.t % 4);
          c.dataset.st = i <= commit ? "c" : "u";
          const w = written.get(e.d);
          if (w) c.dataset.w = w;
          if (now - (flash.get(`${x.id}:${i}`) || -1e9) < 1200) c.dataset.fix = "1";
          c.title = `node ${x.id}, index ${i}, term ${e.t}${e.d ? `: ${e.d}` : ", the leader's empty entry"}${i <= commit ? "" : ", not committed"}${x.up ? "" : " (down: as it was persisted)"}`;
        }
        row.append(c);
      }
      rows.push(row);
      parts.push(x.up ? `node ${x.id} last index ${x.last}, committed ${x.commit}` : `node ${x.id} down`);
    }
    logs.replaceChildren(...rows);
    logs.setAttribute("aria-label", `Replicated logs: ${parts.join("; ")}.`);
  }

  // Repairs: a slot whose term changed under the same index.
  function noteLogs(s, now) {
    let fixed = [];
    for (const x of s.nodes) {
      if (!x.up) continue;
      lastLog.set(x.id, { log: x.log, commit: x.commit });
      const seen = seenTerm.get(x.id) || new Map();
      for (const e of x.log) {
        const was = seen.get(e.i);
        if (was !== undefined && was !== e.t) {
          flash.set(`${x.id}:${e.i}`, now);
          fixed.push({ node: x.id, i: e.i, from: was, to: e.t });
        }
        seen.set(e.i, e.t);
      }
      for (const i of [...seen.keys()]) if (i > x.last) seen.delete(i);
      seenTerm.set(x.id, seen);
    }
    return fixed;
  }

  function addEvents(evs) {
    if (!evs.length) return;
    const atEnd = traceBox.scrollHeight - traceBox.scrollTop - traceBox.clientHeight < 24;
    for (const e of evs) {
      const li = el("li");
      li.dataset.kind = e.kind;
      li.append(el("span", "qr-at", `t${e.step}`), document.createTextNode(` ${e.text}`));
      trace.append(li);
    }
    while (trace.childElementCount > KEEP_EVENTS) trace.firstElementChild.remove();
    if (atEnd) traceBox.scrollTop = traceBox.scrollHeight;
  }

  // The status line explains the most telling thing that just happened.
  let prevWrites = new Map();
  function narrate(evs, fixed, s) {
    let msg = "";
    for (const e of evs) {
      let m;
      if ((m = /^timeout (\d+) after (\d+) ticks: pre-vote for t(\d+)/.exec(e.text))) msg = `Node ${m[1]}'s election timer ran out after ${m[2]} ticks with no heartbeat: it asks the others for pre-votes for term ${m[3]}.`;
      else if ((m = /^campaign (\d+) t(\d+): pre-vote won/.exec(e.text))) msg = `Node ${m[1]} won the pre-vote and campaigns for term ${m[2]}.`;
      else if ((m = /^leader (\d+) term (\d+)/.exec(e.text))) msg = `Node ${m[1]} won term ${m[2]} with a majority of votes. It appends an empty entry of its own term and brings every follower's log in line with its own.`;
      else if ((m = /^stepdown (\d+) t(\d+): no quorum heard for (\d+) ticks/.exec(e.text))) msg = `Node ${m[1]} heard from no majority for ${m[3]} ticks and stepped down: a leader cut off from the majority stops taking writes.`;
      else if ((m = /^stepdown (\d+): saw t(\d+)/.exec(e.text))) msg = `Node ${m[1]} saw term ${m[2]} and stepped down to follower.`;
      else if ((m = /^crash (\d+)/.exec(e.text))) msg = `Node ${m[1]} crashed, keeping what it persisted. Watch the arcs: each follower's election timer runs until a heartbeat resets it.`;
      else if ((m = /^start (\d+) term=(\d+).* last=(\d+)/.exec(e.text)) && s.tick > 0) msg = `Node ${m[1]} restarted from its log on disk: term ${m[2]}, last index ${m[3]}.`;
      else if ((m = /^isolate (\d+)/.exec(e.text))) msg = `Node ${m[1]} is cut off from the rest of the cluster.`;
      else if ((m = /^split \[([\d ]+)\]/.exec(e.text))) msg = `Nodes ${m[1].split(" ").join(" and ")} are cut off together. Messages across the fence are dropped.`;
      else if (e.kind === "heal") msg = "The network is whole again.";
    }
    for (const w of s.writes) {
      const was = prevWrites.get(w.data);
      if (was && was !== w.status) {
        if (w.status === "committed") msg = `${w.key}=${w.value} committed at index ${w.index}, term ${w.term}: a majority holds it.`;
        if (w.status === "lost") msg = `${w.key}=${w.value} is lost: index ${w.index} committed a different entry, so node ${w.node} can never commit it.`;
      }
    }
    prevWrites = new Map(s.writes.map((w) => [w.data, w.status]));
    if (fixed.length) {
      const by = new Map();
      for (const f of fixed) by.set(f.node, [...(by.get(f.node) || []), f]);
      msg = [...by].map(([id, fs]) => `Node ${id}'s log was repaired: ${fs.length === 1 ? `index ${fs[0].i} went` : `${fs.length} entries went`} from term ${fs[0].from} to term ${fs[0].to}.`).join(" ");
    }
    if (msg) status.textContent = msg;
  }

  function renderWrites() {
    writesList.replaceChildren();
    for (const w of [...st.writes].reverse().slice(0, 6)) {
      const li = el("li");
      li.dataset.st = w.status;
      li.append(el("span", "qr-wk", `${w.key}=${w.value}`), el("span", "qr-wm", `node ${w.node}, term ${w.term}, index ${w.index}`), el("span", "qr-ws", w.status));
      writesList.append(li);
      written.set(w.data, w.status[0]);
    }
    writesEmpty.hidden = st.writes.length > 0;
  }

  function updateDom(force) {
    if (!st) return;
    const now = performance.now();
    if (!force && now - lastDom < 150) return;
    lastDom = now;
    const l = leaderOf(st);
    let term = 0, commit = 0;
    for (const x of st.nodes) if (x.up) { term = Math.max(term, x.term); commit = Math.max(commit, x.commit); }
    cell.tick.textContent = fmt(st.tick);
    cell.term.textContent = fmt(term);
    cell.leader.textContent = l ? `node ${l.id}` : "none";
    cell.commit.textContent = fmt(l ? l.commit : commit);
    cell.leaders.textContent = fmt(st.stats.leaders);
    cell.flight.textContent = fmt(st.flights.length);
    cell.delivered.textContent = fmt(st.stats.delivered);
    cell.dropped.textContent = fmt(st.stats.dropped);
    receipt.textContent = `quorum's raft core has run ${plural(st.tick, "tick")} on ${n} nodes, delivering ${plural(st.stats.delivered, "message")} and committing ${plural(st.stats.committed, "entry", "entries")}; ${fmt(Math.round(callMs))} ms so far.`;
    crashL.disabled = !l;
    cut.disabled = !l;
    heal.disabled = !st.nodes.some((x) => x.side !== 0);
    ring.setAttribute("aria-label", `${n}-node cluster at tick ${st.tick}: ${l ? `node ${l.id} leads term ${l.term}` : "no leader"}, ${st.nodes.filter((x) => !x.up).length} down, ${st.flights.length} messages in flight.`);
    drawLogs();
  }

  // One answer from the binary.
  function apply(s, animate) {
    const now = performance.now();
    st = s;
    tickAt = now;
    const fixed = noteLogs(s, now);
    for (const e of s.events) {
      const m = /^(?:timeout|leader|crash|start) (\d+)/.exec(e.text);
      if (m) flash.set(`n${m[1]}`, now);
    }
    addEvents(s.events);
    renderWrites();
    narrate(s.events, fixed, s);
    drawFences();
    updateDom(!animate || !playing);
    draw(now);
  }

  function params() {
    return { seed: 1, nodes: Number(nodesSel.value), loss: Number(loss.value), writes: Number(writes.value) };
  }

  let restarting = Promise.resolve();
  function restart() { restarting = doRestart(); return restarting; }
  async function doRestart() {
    gen++;
    n = Number(nodesSel.value);
    callMs = 0;
    acc = 0;
    lastLog.clear(); seenTerm.clear(); flash.clear(); written.clear();
    prevWrites = new Map();
    trace.replaceChildren();
    for (const k in cell) cell[k].textContent = "–";
    build();
    const { r, g } = await exec("new", params());
    if (g !== gen) return;
    apply(r, false);
    const { r: w } = await exec("tick", { n: WARM });
    if (g !== gen) return;
    apply(w, false);
    const l = leaderOf(w);
    status.textContent = l
      ? `Warmed up ${fmt(w.tick)} ticks: node ${l.id} leads term ${l.term}. Crash it, or click any node.`
      : `Warmed up ${fmt(w.tick)} ticks: no leader yet.`;
  }

  const fail = (err) => { status.textContent = err.message; };

  async function act(method, p) {
    await restarting;
    const { r, g } = await exec(method, p);
    if (g === gen) apply(r, false);
    kick();
    return r;
  }

  function toggle(id) {
    const x = st?.nodes[id - 1];
    if (!x) return;
    act(x.up ? "crash" : "restart", { node: id }).catch(fail);
  }

  async function tick(k, animate) {
    const g = gen;
    const { r } = await exec("tick", { n: k });
    if (g !== gen) return;
    apply(r, animate);
  }

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && st) {
      acc += (dt * Number(speed.value)) / 1000;
      if (!busy && acc >= 1) {
        const k = Math.min(10, Math.floor(acc));
        acc -= k;
        tick(k, true).catch(fail);
      }
      acc = Math.min(acc, 10);
    }
    draw(ts);
    updateDom(false);
    const moving = ts - tickAt < 1000 / Number(speed.value) + 50;
    if ((playing || moving) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) kick();
  }

  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    restarting.then(() => tick(1, true)).then(kick).catch(fail);
  });
  reset.addEventListener("click", () => restart().then(kick).catch(fail));
  for (const c of [nodesSel, loss, writes]) c.addEventListener("change", () => restart().then(kick).catch(fail));
  crashL.addEventListener("click", () => {
    const l = leaderOf(st);
    if (l) act("crash", { node: l.id }).catch(fail);
  });
  cut.addEventListener("click", () => {
    const l = leaderOf(st);
    if (!l) return;
    const k = Math.floor((n - 1) / 2);
    const ids = Array.from({ length: k }, (_, i) => ((l.id - 1 + i) % n) + 1);
    act(ids.length === 1 ? "isolate" : "split", ids.length === 1 ? { node: ids[0] } : { nodes: ids }).catch(fail);
  });
  heal.addEventListener("click", () => act("heal", {}).catch(fail));
  putForm.addEventListener("submit", (e) => {
    e.preventDefault();
    act("put", { key: key.value.trim(), value: value.value.trim() }).then((r) => {
      if (!r.put) return;
      if (!r.put.ok) { status.textContent = `No node leads right now, so nobody took ${key.value.trim()}=${value.value.trim()}: a real client would retry.`; return; }
      const w = r.put.write;
      status.textContent = `${w.key}=${w.value} went to leader node ${w.node}, appended at index ${w.index} in term ${w.term}. It commits once a majority has it.`;
      if (/^\d+$/.test(value.value.trim())) value.value = String(Number(value.value.trim()) + 1);
    }).catch(fail);
  });
  speed.addEventListener("change", () => { acc = 0; kick(); });

  new ResizeObserver(() => { if (root.isConnected && st) drawLogs(); }).observe(logs);
  new ResizeObserver(() => {
    if (!root.isConnected || !st || Math.abs(Math.round(ring.getBoundingClientRect().width) - W) < 2) return;
    build();
    drawFences();
    draw(performance.now());
  }).observe(ring);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(ring);
  document.addEventListener("visibilitychange", kick);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  await restart();
  setPlaying(playing);
}
