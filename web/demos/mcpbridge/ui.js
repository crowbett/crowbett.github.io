// mcpbridge demo: the real translation engines (xlate.New / xlate.NewReverse),
// compiled to WebAssembly, between a scripted client and the repo's own
// conformance fixture servers. Each client frame is one `send`; every frame
// the bridge reports on all four legs crosses the sequence diagram on a
// simulated clock, and its shape changes where the bridge rewrote it.
const SPEEDS = [0.5, 1, 2, 4, 8];
const FLY = 280, MORPH = 240, MINT = 200, TRACE = 150, SESSION = 300, GAP = 70, FRAME_GAP = 650, HOLD = 2600;
const KEEP_SESSIONS = 3;
const SEED = 1;
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
const ERA = { legacy: "2024-11-05, session", modern: "2026-07-28, stateless" };
const SERVER_ERA = { legacy: "initialize session", modern: "2026-07-28, stateless" };
const LEG = { c2b: "client to bridge", b2s: "bridge to server", s2b: "server to bridge", b2c: "bridge to client" };
const PRESETS = [
  ["call", "tools/call test_simple_text", "tools/call", { name: "test_simple_text", arguments: {} }],
  ["prompt", "prompts/get test_simple_prompt", "prompts/get", { name: "test_simple_prompt" }],
  ["read", "resources/read test://static-text", "resources/read", { uri: "test://static-text" }],
  ["list", "tools/list", "tools/list", {}],
  ["unknown", "tools/call no_such_tool", "tools/call", { name: "no_such_tool", arguments: {} }],
  ["ping", "ping", "ping", {}],
  ["tasks", "tasks/list", "tasks/list", {}],
  ["bare", "prompts/list without _meta", "prompts/list", {}, "modern"],
  ["batch", "a JSON-RPC batch of two", null, null, "legacy"],
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const btn = (text, cls) => Object.assign(el("button", cls, text), { type: "button" });
const field = (label, input, cls) => { const f = el("label", "demo-field" + (cls ? " " + cls : "")); f.append(el("span", "demo-label", label), input); return f; };
const select = (name, opts, value) => {
  const s = el("select");
  s.name = name;
  for (const [v, t] of opts) s.append(Object.assign(el("option", null, t), { value: String(v), selected: String(v) === String(value) }));
  return s;
};
const fmt = (n) => n.toLocaleString("en-US");
const ms = (v) => (v < 10 ? v.toFixed(1) : fmt(Math.round(v))) + " ms";
const bytesOf = (s) => new TextEncoder().encode(s).length;
const B = (n) => fmt(n) + " B";
const parse = (s) => { try { return [JSON.parse(s), null]; } catch (e) { return [undefined, e]; } };
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; };
const shortId = (id) => {
  if (id === undefined || id === null) return "";
  const s = typeof id === "string" ? id : JSON.stringify(id);
  return s.replace(/^(mcpbridge(?:-state)?)#[0-9a-f]{16}#/, "$1#…#");
};

// Keys that differ between two frames: {op: "+", path: ["params", "_meta"]}.
function changes(after, before) {
  const out = [];
  const walk = (a, b, path) => {
    if (same(a, b)) return;
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(a)) if (!(k in b)) out.push({ op: "+", path: [...path, k] });
      for (const k of Object.keys(b)) if (!(k in a)) out.push({ op: "−", path: [...path, k] });
      for (const k of Object.keys(a)) if (k in b) walk(a[k], b[k], [...path, k]);
      return;
    }
    out.push({ op: "~", path });
  };
  walk(after, before, []);
  return out;
}
// The same, cut to two keys deep and deduplicated: "+params._meta…".
const shallow = (list) => [...new Set(list.map((c) => c.op + c.path.slice(0, 2).join(".") + (c.path.length > 2 ? "…" : "")))];
const counts = (list) => {
  const c = { "+": 0, "−": 0, "~": 0 };
  for (const x of list) c[x.op]++;
  return c;
};

// JSON as coloured spans.
function tokens(text, into) {
  let i = 0;
  const push = (cls, s) => { if (s) into.append(cls ? el("span", cls, s) : document.createTextNode(s)); };
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      push("mb-s", text.slice(i, j + 1));
      i = j + 1;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9eE+.-]/.test(text[j])) j++;
      push("mb-n", text.slice(i, j));
      i = j;
    } else if (/^(true|false|null)/.test(text.slice(i, i + 5))) {
      const w = text.slice(i).match(/^(true|false|null)/)[0];
      push("mb-n", w);
      i += w.length;
    } else {
      let j = i + 1;
      while (j < text.length && !'"-0123456789tfn'.includes(text[j])) j++;
      push("mb-p", text.slice(i, j));
      i = j;
    }
  }
}

// Side-by-side structural diff: rows of {l, r}, each a line or null, so a
// key the bridge removed sits opposite a gap and an added one opposite a gap.
function sideBySide(after, before) {
  const rows = [];
  const lines = (v, ind, key, mark, fold) => {
    const out = [];
    const go = (v, ind, key, top) => {
      const kids = isObj(v) ? Object.entries(v) : Array.isArray(v) ? v.map((x) => [null, x]) : null;
      if (!kids) return out.push({ ind, key, text: JSON.stringify(v), mark });
      const [o, c] = isObj(v) ? ["{", "}"] : ["[", "]"];
      if (!kids.length) return out.push({ ind, key, text: o + c, mark });
      const size = JSON.stringify(v).length;
      if (fold && !top && size > 160) {
        const n = kids.length;
        return out.push({ ind, key, text: `${o} ${n} ${isObj(v) ? (n === 1 ? "key" : "keys") : n === 1 ? "item" : "items"} ${c}`, mark: "fold" });
      }
      out.push({ ind, key, text: o, mark });
      for (const [k, x] of kids) go(x, ind + 1, k, false);
      out.push({ ind, key: null, text: c, mark });
    };
    go(v, ind, key, true);
    return out;
  };
  const pair = (L, R) => { for (let i = 0; i < Math.max(L.length, R.length); i++) rows.push({ l: L[i] || null, r: R[i] || null }); };
  const walk = (a, b, ind, key) => {
    if (same(a, b)) {
      const L = lines(a, ind, key, null, ind > 0);
      return pair(L, L);
    }
    if (isObj(a) && isObj(b)) {
      rows.push({ l: { ind, key, text: "{" }, r: { ind, key, text: "{" } });
      const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))];
      for (const k of keys) {
        if (!(k in b)) pair([], lines(a[k], ind + 1, k, "add", false));
        else if (!(k in a)) pair(lines(b[k], ind + 1, k, "del", false), []);
        else walk(a[k], b[k], ind + 1, k);
      }
      return rows.push({ l: { ind, key: null, text: "}" }, r: { ind, key: null, text: "}" } });
    }
    pair(lines(b, ind, key, "del", false), lines(a, ind, key, "add", false));
  };
  if (before === undefined) pair([], lines(after, 0, null, "made", true));
  else if (after === undefined) pair(lines(before, 0, null, null, true), []);
  else walk(after, before, 0, null);
  return rows;
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
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const scenarios = (await demo.call("scenarios", {})).scenarios;
  const clientEra = (s) => (s.server === "modern" ? "legacy" : "modern");
  // Controls.
  const scnSel = el("select");
  scnSel.name = "scenario";
  for (const era of ["legacy", "modern"]) {
    const g = el("optgroup");
    g.label = `${era === "legacy" ? "2024-11-05" : "2026-07-28"} client`;
    for (const s of scenarios.filter((x) => clientEra(x) === era)) {
      const o = el("option", null, s.title);
      o.value = s.id;
      g.append(o);
    }
    scnSel.append(g);
  }
  const srvSel = select("server", [["auto", "as the scenario says"], ["modern", "2026-07-28, stateless"], ["legacy", "initialize session"]], "auto");
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 1);
  const knobs = el("div", "mb-knobs");
  knobs.append(field("scenario", scnSel, "mb-scn"), field("server", srvSel, "mb-srv"), field("speed", speed));
  const play = btn("Pause");
  const step = btn("Step", "secondary");
  const reset = btn("Reset", "secondary");
  const mineSel = el("select");
  mineSel.name = "request";
  const send = btn("Send mine");
  const acts = el("div", "mb-acts");
  const yoursBox = el("div", "mb-yours");
  yoursBox.append(field("your request", mineSel, "mb-mine"), send);
  acts.append(play, step, reset, yoursBox);
  const edit = el("details", "mb-edit");
  const ta = el("textarea");
  ta.name = "frame";
  ta.spellcheck = false;
  ta.rows = 6;
  ta.setAttribute("autocapitalize", "off");
  ta.setAttribute("autocomplete", "off");
  const taNote = el("p", "mb-fine");
  taNote.setAttribute("aria-live", "polite");
  edit.append(el("summary", null, "Edit your frame"), field("your frame, JSON-RPC (sent compact, one line)", ta, "mb-ta"), taNote);
  const form = el("form", "mb-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(knobs, acts, edit);
  const canvas = el("canvas", "mb-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend mb-legend");
  for (const [k, t] of [["in", "sent by client or server"], ["sig", "rewritten or made by mcpbridge"], ["same", "passed as is"], ["bad", "refused or dropped"], ["you", "your request"]]) {
    const s = el("span", "mb-key", t);
    s.dataset.k = k;
    legend.append(s);
  }
  const youLine = el("div", "mb-you");
  youLine.setAttribute("aria-live", "polite");
  const status = el("p", "mb-status");
  status.setAttribute("aria-live", "polite");
  const note = el("p", "mb-note");
  const cells = el("ul", "cells stack mb-cells");
  const cell = {};
  for (const [k, t] of [["sessions", "sessions"], ["messages", "messages"], ["translated", "translated"], ["passed", "passed as is"], ["made", "bridge-made"],
    ["dropped", "dropped"], ["refused", "refused"], ["in", "bytes in"], ["out", "bytes out"], ["p50", "send p50"]]) {
    const li = el("li");
    li.dataset.k = k;
    li.append(el("span", "mb-ck", t), (cell[k] = el("span", "mb-v", "–")));
    cells.append(li);
  }
  // Inspector: the selected frame beside the frame it came from.
  const insp = el("section", "mb-insp");
  insp.setAttribute("aria-label", "Translation inspector");
  const iBar = el("div", "mb-ibar");
  const iHead = el("p", "mb-ihead");
  const older = btn("Older", "secondary");
  const newer = btn("Newer", "secondary");
  const live = btn("Follow live", "secondary");
  const nav = el("div", "mb-nav");
  nav.append(older, newer, live);
  iBar.append(iHead, nav);
  const sbsWrap = el("div", "mb-sbsw");
  sbsWrap.tabIndex = 0;
  sbsWrap.setAttribute("role", "region");
  sbsWrap.setAttribute("aria-label", "Frame before and after the bridge");
  const sbs = el("div", "mb-sbs");
  sbsWrap.append(sbs);
  const iFoot = el("p", "mb-ifoot");
  insp.append(iBar, sbsWrap, iFoot);
  const receipt = el("p", "demo-out mb-out");
  root.replaceChildren(form, canvas, legend, youLine, status, note, cells, insp, receipt);
  // State.
  let rows = [];           // everything drawn: session headers, frames, traces
  let sessions = [];
  let sess = null;         // the live session
  let beats = [];          // rows waiting to cross
  let cur = null;          // the row crossing now
  let sim = 0, waitUntil = 0, last = 0, raf = 0;
  let playing = !reduce.matches, visible = true, busy = false, stepTo = 0, committed = 0;
  let scrollY = 0, follow = true, contentH = 0;
  let selected = null, following = true;
  let gen = 0, yours = 0, dirty = false, pendingYou = null, youBatch = null;
  let colors = {}, G = null, lastDom = 0;
  let st;
  const zero = () => ({ sessions: 0, frames: 0, translated: 0, passed: 0, made: 0, dropped: 0, refused: 0, bin: 0, bout: 0, calls: [], callMs: 0 });
  st = zero();
  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = { bg: v("--sunken"), surface: v("--surface"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"),
      text3: v("--text-3"), accent: v("--accent"), tint: v("--accent-tint"), sig: v("--signal"), danger: v("--danger"), mono: v("--mono") || "monospace" };
  }
  const timed = async (method, params) => {
    const t0 = performance.now();
    try { return await demo.call(method, params); } finally {
      const d = performance.now() - t0;
      st.callMs += d;
      if (method === "send") st.calls.push(d);
    }
  };
  // ---- rows ----
  const H_ROW = { session: 34, frame: 30, trace: 17, fatal: 24 };
  const addRow = (r) => { r.y = contentH; r.h = H_ROW[r.type]; contentH += r.h; rows.push(r); return r; };
  function frameRow(e, s, you) {
    const r = { type: "frame", ev: e, s, you, leg: e.leg, bytes: bytesOf(e.frame) };
    [r.json] = parse(e.frame);
    r.out = e.leg === "b2s" || e.leg === "b2c";
    r.src = e.src ? s.bySeq.get(e.src) : null;
    r.re = e.re ? s.bySeq.get(e.re) : null;
    const errFrame = r.json && isObj(r.json) && r.json.error;
    r.err = errFrame ? r.json.error.code : null;
    if (r.out) {
      if (e.unsupported || (e.leg === "b2c" && e.kind === "response" && errFrame && !r.src)) r.cls = "refused";
      else if (e.kind === "unparseable") r.cls = "passed";
      else if (!r.src) r.cls = "made";
      else {
        r.changes = changes(r.json, r.src.json);
        r.cls = r.changes.length ? "translated" : "passed";
      }
    }
    if (e.kind === "unparseable") r.bad = true;
    const m = e.method || (e.kind === "unparseable" ? "unparseable" : e.kind);
    r.label = e.kind === "response" ? `${m} ${r.err !== null ? "error " + r.err : "result"}` : m;
    r.idText = e.id !== undefined && e.id !== null ? shortId(e.id) : "";
    s.bySeq.set(e.seq, r);
    return r;
  }
  const classifyTrace = (t) => (/^LOUD: unsupported/.test(t) ? "refused" : /^(dropping|swallowed|consumed) /.test(t) ? "dropped" : "");
  // Attach a send's events: rows in wire order, each a beat.
  function ingest(evs, you) {
    const batch = [];
    for (const e of evs) {
      let r;
      if (e.leg === "trace") r = { type: "trace", ev: e, s: sess, text: e.text, cls: classifyTrace(e.text), you };
      else if (e.leg === "fatal") r = { type: "fatal", ev: e, s: sess, text: e.text, cls: "refused", you };
      else r = frameRow(e, sess, you);
      // An incoming frame that is dropped ends at the bridge with a cross.
      if (r.type === "trace" && r.cls) {
        for (let i = batch.length - 1; i >= 0; i--) if (batch[i].type === "frame" && !batch[i].out) { batch[i].stop = r.cls; break; }
      }
      batch.push(addRow(r));
    }
    for (const r of batch) beats.push(r);
    return batch;
  }
  function trim() {
    if (sessions.length <= KEEP_SESSIONS) return;
    const drop = sessions.shift();
    const i = rows.findIndex((r) => r.s !== drop);
    const dy = i < 0 ? 0 : rows[i].y;
    rows = rows.slice(i);
    for (const r of rows) r.y -= dy;
    contentH -= dy;
    scrollY = Math.max(0, scrollY - dy);
    if (selected && selected.s === drop) selected = null;
  }
  // ---- the director: sessions, sends and beats on the sim clock ----
  function scenario() { return scenarios.find((s) => s.id === scnSel.value); }
  function serverFor(s) { return srvSel.value === "auto" ? s.server : srvSel.value; }
  async function openSession() {
    const s = scenario();
    const server = serverFor(s);
    const g = gen;
    const r = await timed("open", { server, seed: SEED });
    if (g !== gen) return;
    st.sessions++;
    sess = { n: st.sessions, scn: s, server, era: clientEra(s), next: 0, state: r.state, bySeq: new Map(), frames: 0 };
    sessions.push(sess);
    trim();
    const head = addRow({ type: "session", s: sess });
    beats.push(head);
    note.textContent = server === s.server ? s.note : `The same client frames against a ${server === "modern" ? "2026-07-28" : "session-era"} server, which this scenario was not written for. The bridge's probe decides what to do.`;
    refreshMine();
    showStatus();
  }
  async function sendFrame(text, you) {
    const g = gen;
    const s = sess;
    const r = await timed("send", { frame: text });
    if (g !== gen || s !== sess) return;
    s.state = r.state;
    s.frames++;
    const batch = ingest(r.events, you);
    if (you) youBatch = batch;
    if (you && !playing) stepTo = committed + beats.length;
  }
  function work() {
    if (busy || !sess) return false;
    const fail = (e) => { status.textContent = `The demo call failed: ${e.message}`; };
    const run = (p) => { busy = true; p.catch(fail).finally(() => { busy = false; waitUntil = sim; kick(); }); };
    if (pendingYou) { run(sendFrame(pendingYou, true)); pendingYou = null; return true; }
    if (!playing && !stepTo) return false;
    const frames = sess.scn.frames;
    if (sess.next < frames.length && !sess.state.ended) {
      run(sendFrame(frames[sess.next++], false));
      return true;
    }
    if (!sess.done) {
      // A step that finishes a session stops there; the next one opens the next.
      sess.done = true;
      stepTo = 0;
      showStatus();
      updateDom(true);
      waitUntil = sim + HOLD;
      return playing;
    }
    const list = [...scnSel.options].map((o) => o.value);
    scnSel.value = list[(list.indexOf(scnSel.value) + 1) % list.length];
    run(openSession());
    return true;
  }
  const beatDur = (r) => (reduce.matches ? 0 : r.type === "trace" ? TRACE : r.type !== "frame" ? SESSION : r.out ? (r.src ? MORPH : MINT) + FLY : FLY);
  function advance() {
    for (let guard = 0; guard < 400; guard++) {
      if (cur) {
        if (sim < cur.t0 + cur.dur) return;
        commit(cur);
        const nextIsClient = beats.length === 0;
        cur = null;
        waitUntil = sim + (reduce.matches ? 0 : nextIsClient ? FRAME_GAP : GAP);
        if (stepTo && committed >= stepTo) { stepTo = 0; return; }
        continue;
      }
      if (beats.length && (sim >= waitUntil || stepTo)) {
        cur = Object.assign(beats.shift(), { t0: sim });
        cur.dur = beatDur(cur);
        continue;
      }
      if (beats.length) return;
      if (pendingYou && !busy) { work(); return; }
      if (sim < waitUntil && !stepTo) return;
      if (!work()) return;
      if (busy) return;
    }
  }
  function commit(r) {
    r.done = true;
    committed++;
    if (r.type === "frame") {
      st.frames++;
      if (r.out) { st.bout += r.bytes; st[r.cls]++; } else st.bin += r.bytes;
      if (r.out && following && (r.cls !== "passed" || r.you)) inspect(r);
    } else if (r.type === "trace" && r.cls) st[r.cls]++;
    else if (r.type === "fatal") st.refused++;
    if (r.type === "trace" || r.type === "fatal") r.s.lastTrace = r.text;
    if (youBatch && r === youBatch[youBatch.length - 1]) describeYou(youBatch);
    if (r.type === "session" || (r.type === "trace" && /engine|passthrough|handshake|dialect/.test(r.text))) showStatus();
  }
  // ---- drawing ----
  function layout() {
    const W = Math.max(280, canvas.clientWidth);
    const H = W < 560 ? 420 : 460;
    const cx = Math.round(Math.max(22, W * 0.07));
    G = { W, H, head: 46, cx, sx: W - cx, bx: Math.round(W / 2), bw: Math.round(Math.min(78, Math.max(30, W * 0.11))), wide: W >= 520 };
    canvas.style.height = H + "px";
    const dpr = devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  }
  const font = (px, w = 400) => `${w} ${px}px ${colors.mono}`;
  function colorOf(r) {
    if (r.you) return colors.accent;
    if (r.cls === "refused" || r.bad || r.stop) return colors.danger;
    if (r.type !== "frame") return colors.text3;
    if (!r.out) return r.leg === "c2b" ? colors.text : colors.text2;
    return r.cls === "passed" ? colors.text3 : colors.sig;
  }
  const ends = (r) => {
    const { cx, sx, bx } = G;
    return { c2b: [cx, bx], s2b: [sx, bx], b2s: [bx, sx], b2c: [bx, cx] }[r.leg];
  };
  const lineY = (r) => r.y + 20;
  const chipW = (n) => Math.round(Math.min(G.wide ? 96 : 64, 10 + Math.sqrt(n) * (G.wide ? 2.1 : 1.5)));
  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let t = text.replace(/^notifications\//, "…/");
    if (ctx.measureText(t).width <= max) return t;
    while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
    return t.replace(/[…\s·]+$/, "") + "…";
  }
  function tagOf(r) {
    if (r.cls === "made") return "made";
    if (r.cls === "refused") return "refused";
    if (!r.changes || !r.changes.length) return "";
    if (!G.wide) return Object.entries(counts(r.changes)).filter(([, v]) => v).map(([k, v]) => k + v).join(" ");
    const u = shallow(r.changes);
    return u[0] + (u.length > 1 ? ` +${u.length - 1}` : "");
  }
  function drawFrame(ctx, r, p) {
    const [x0, x1] = ends(r);
    const y = lineY(r) + 0.5;
    const col = colorOf(r);
    const dir = Math.sign(x1 - x0);
    const fly = r.done ? 1 : flyT(r);
    const xe = x0 + (x1 - x0) * fly;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = r.you ? 2 : 1.25;
    if (fly > 0) {
      if (r.stop || r.cls === "refused" || r.bad) ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xe, y); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (r.out && r.cls === "made") ctx.fillRect(x0 - 3.5, y - 3.5, 7, 7);
    if (fly >= 1) {
      if (r.stop) {
        ctx.lineWidth = 1.75;
        ctx.beginPath(); ctx.moveTo(x1 - 4, y - 4); ctx.lineTo(x1 + 4, y + 4); ctx.moveTo(x1 + 4, y - 4); ctx.lineTo(x1 - 4, y + 4); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x1 - dir * 6, y - 4); ctx.lineTo(x1 - dir * 6, y + 4); ctx.closePath(); ctx.fill();
      }
    }
    // Translations run down the bridge from the frame they came from.
    if (r.out && r.src && r.src.done && r.cls === "translated") {
      const ys = lineY(r.src) + 0.5;
      ctx.globalAlpha = 0.55 * p;
      ctx.strokeStyle = r.you ? colors.accent : colors.sig;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(G.bx + 0.5, ys); ctx.lineTo(G.bx + 0.5, y); ctx.stroke();
    }
    // Label at the outer lane, change tag at the bridge.
    ctx.globalAlpha = p;
    const left = r.leg === "c2b" || r.leg === "b2c";
    const span = G.bx - G.cx - 10;
    ctx.font = font(9.5, 600);
    const tag = fit(ctx, r.out ? tagOf(r) : r.stop || "", span * 0.55);
    const tagW = tag ? ctx.measureText(tag).width + 10 : 0;
    ctx.font = font(10.5, 600);
    const name = r.idText ? `${r.label} · ${r.idText}` : r.label;
    const text = fit(ctx, name, span - tagW);
    ctx.fillStyle = r.you ? colors.accent : r.bad ? colors.danger : colors.text;
    ctx.textAlign = left ? "left" : "right";
    ctx.fillText(text, left ? G.cx + 6 : G.sx - 6, r.y + 13);
    if (tag) {
      ctx.font = font(9.5, 600);
      ctx.fillStyle = col;
      ctx.textAlign = left ? "right" : "left";
      ctx.fillText(tag, left ? G.bx - 6 : G.bx + 6, r.y + 13);
    }
    ctx.globalAlpha = 1;
  }
  // 0..1: how far a frame has flown along its arrow (after any morph).
  function flyT(r) {
    if (r !== cur) return 0;
    const t = sim - r.t0;
    const lead = r.out ? (r.src ? MORPH : MINT) : 0;
    return ease((t - lead) / FLY);
  }
  function drawChip(ctx, r) {
    const t = sim - r.t0;
    const y = lineY(r);
    const [x0, x1] = ends(r);
    let x, w, alpha = 1, col = colorOf(r), cy = y, scale = 1;
    if (r.out) {
      const lead = r.src ? MORPH : MINT;
      const k = ease(t / lead);
      if (r.src) {
        const ys = r.src.done ? lineY(r.src) : y;
        cy = ys + (y - ys) * k;
        w = chipW(r.src.bytes) + (chipW(r.bytes) - chipW(r.src.bytes)) * k;
      } else {
        w = chipW(r.bytes);
        scale = k;
      }
      x = t < lead ? x0 : x0 + (x1 - x0) * ease((t - lead) / FLY);
      if (t < lead && r.src) {
        // The morph: the chip changes size where the bridge rewrites it.
        ctx.globalAlpha = 0.18 + 0.5 * Math.sin(Math.PI * k);
        ctx.fillStyle = col;
        ctx.fillRect(G.bx - G.bw, cy - 9, G.bw * 2, 18);
      }
    } else {
      x = x0 + (x1 - x0) * ease(t / FLY);
      w = chipW(r.bytes);
      if (r.stop) alpha = 1 - Math.max(0, (t / FLY - 0.8) * 5);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    const ww = w * scale, hh = 10 * scale;
    ctx.fillRect(Math.round(x - ww / 2), Math.round(cy - hh / 2), Math.round(ww), Math.round(hh));
    if (!r.out || scale >= 1) {
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x - ww / 2) + 0.5, Math.round(cy - hh / 2) + 0.5, Math.round(ww) - 1, Math.round(hh) - 1);
    }
    if (r.out && !r.src && t < MINT) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 1 - t / MINT;
      ctx.beginPath(); ctx.arc(x, cy, 6 + 14 * (t / MINT), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawText(ctx, r, p) {
    ctx.globalAlpha = p;
    if (r.type === "session") {
      const y = r.y + 8.5;
      ctx.strokeStyle = colors.strong;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(G.W, y); ctx.stroke();
      ctx.font = font(10.5, 600);
      ctx.fillStyle = colors.text;
      ctx.textAlign = "left";
      const right = `against ${r.s.server === "modern" ? "2026-07-28" : "session-era"} server`;
      ctx.font = font(9.5);
      const rw = G.wide ? ctx.measureText(right).width + 16 : 0;
      ctx.font = font(10.5, 600);
      ctx.fillText(fit(ctx, `session ${r.s.n} · ${r.s.scn.title}`, G.W - 16 - rw), 8, r.y + 25);
      if (G.wide) {
        ctx.font = font(9.5);
        ctx.fillStyle = colors.text3;
        ctx.textAlign = "right";
        ctx.fillText(right, G.W - 8, r.y + 25);
      }
    } else {
      const fatal = r.type === "fatal";
      ctx.font = font(fatal ? 10 : 9.5, fatal ? 600 : 400);
      const text = fit(ctx, (fatal ? "session ended: " : "") + r.text, G.W - 20);
      const w = ctx.measureText(text).width;
      const y = r.y + (fatal ? 15 : 12);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(G.bx - w / 2 - 5, r.y + 2, w + 10, r.h - 4);
      if (fatal) {
        ctx.strokeStyle = colors.danger;
        ctx.beginPath(); ctx.moveTo(G.cx, r.y + 2.5); ctx.lineTo(G.sx, r.y + 2.5); ctx.stroke();
      }
      ctx.fillStyle = r.cls || r.ev.unsupported ? colors.danger : r.you ? colors.accent : colors.text2;
      ctx.textAlign = "center";
      ctx.fillText(text, G.bx, y);
    }
    ctx.globalAlpha = 1;
  }
  function draw(now) {
    if (!G) return;
    const dpr = devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { W, H, head, cx, sx, bx, bw } = G;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = colors.tint;
    ctx.fillRect(bx - bw, 0, bw * 2, H);
    ctx.strokeStyle = colors.strong;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (const x of [cx, sx]) { ctx.moveTo(x + 0.5, head); ctx.lineTo(x + 0.5, H); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(bx + 0.5, head); ctx.lineTo(bx + 0.5, H); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, head, W, H - head); ctx.clip();
    ctx.translate(0, head + 6 - scrollY);
    for (const r of rows) {
      if (!r.done && r !== cur) continue;
      if (r.y + r.h < scrollY - 4 || r.y > scrollY + H) continue;
      const p = r.done ? 1 : Math.min(1, (sim - r.t0) / Math.max(1, r.dur * 0.6));
      if (selected === r) {
        ctx.fillStyle = colors.accent;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(0, r.y + 1, W, r.h - 2);
        ctx.globalAlpha = 1;
        ctx.fillRect(0, r.y + 1, 3, r.h - 2);
      }
      if (r.type === "frame") drawFrame(ctx, r, p);
      else drawText(ctx, r, p);
    }
    if (cur && cur.type === "frame" && cur.dur) drawChip(ctx, cur);
    ctx.restore();
    // Lane heads.
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, head);
    ctx.fillStyle = colors.tint;
    ctx.fillRect(bx - bw, 0, bw * 2, head);
    ctx.strokeStyle = colors.strong;
    ctx.beginPath(); ctx.moveTo(0, head + 0.5); ctx.lineTo(W, head + 0.5); ctx.stroke();
    const s = sess;
    const lane = (x, align, title, sub, col) => {
      ctx.textAlign = align;
      ctx.font = font(11, 700);
      ctx.fillStyle = col;
      ctx.fillText(title, x, 18);
      ctx.font = font(9.5);
      ctx.fillStyle = colors.text2;
      ctx.fillText(sub, x, 34);
    };
    const engine = s?.state?.engine || "waiting";
    lane(cx - (G.wide ? 0 : 14), "left", "client", s ? (G.wide ? ERA[s.era] : s.era) : "", colors.text);
    lane(bx, "center", "mcpbridge", engine, colors.accent);
    lane(sx + (G.wide ? 0 : 14), "right", "server", s ? (G.wide ? SERVER_ERA[s.server] : s.server) : "", colors.text);
    if (!follow && contentH > H - head) {
      ctx.font = font(9.5, 600);
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "right";
      ctx.fillText("scrolled back · wheel down to follow", W - 8, H - 8);
    }
  }
  // ---- inspector ----
  function pairOf(r) {
    if (!r || r.type !== "frame") return null;
    if (r.out) return { before: r.src, after: r };
    const next = rows.find((x) => x.type === "frame" && x.out && x.src === r && x.done);
    return { before: r, after: next || null };
  }
  function inspect(r, user) {
    const pr = pairOf(r);
    if (!pr) return;
    selected = r;
    if (user) setFollowing(false);
    const a = pr.after, b = pr.before;
    const main = a || b;
    iHead.textContent = `frame ${main.ev.seq} · ${LEG[main.leg]} · ${main.label}`;
    sbs.replaceChildren();
    const colHead = (x, side) => {
      const h = el("p", "mb-ch mb-ch-" + side);
      if (x) h.textContent = `${side === "l" ? "before" : "after"} · frame ${x.ev.seq} · ${LEG[x.leg]} · ${B(x.bytes)}`;
      else h.textContent = side === "l" ? "before · nothing: mcpbridge wrote this frame" : "after · nothing crossed the bridge";
      return h;
    };
    sbs.append(colHead(b, "l"), colHead(a, "r"));
    const lines = sideBySide(a ? a.json : undefined, b ? b.json : undefined);
    for (const row of lines) {
      for (const [side, ln] of [["l", row.l], ["r", row.r]]) {
        const c = el("span", "mb-c mb-c-" + side + (ln?.mark ? " mb-" + ln.mark : ln ? "" : " mb-gap"));
        if (ln) {
          c.style.paddingLeft = `calc(${ln.ind * 1.5}ch + 2px)`;
          const body = el("span", "mb-b");
          c.append(el("span", "mb-g", ln.mark === "add" || ln.mark === "made" ? "+" : ln.mark === "del" ? "−" : ""), body);
          if (ln.key !== null && ln.key !== undefined) body.append(el("span", "mb-k", JSON.stringify(ln.key)), el("span", "mb-p", ": "));
          tokens(ln.text, body);
        }
        sbs.append(c);
      }
    }
    if (a && !a.json) {
      sbs.append(el("span", "mb-c mb-c-l"), el("span", "mb-c mb-c-r mb-bad", a.ev.frame));
    }
    iFoot.textContent = footFor(pr);
  }
  function footFor({ before: b, after: a }) {
    if (!a) {
      if (b.stop) return `Stopped at the bridge: ${b.stop}, as the bridge's trace says.`;
      return b.ev.kind === "response" ? "The bridge consumed this answer: it was for a request the bridge itself made." : "Nothing crossed: the bridge answered or consumed this frame itself.";
    }
    if (a.cls === "refused") return a.err !== null ? `Refused out loud with error ${a.err}: ${a.json.error.message}` : "Refused out loud: the frame has no faithful translation.";
    if (a.cls === "made") return a.re ? `Made by the bridge to answer frame ${a.re.ev.seq}; no frame on the other side carried it.` : "Made by the bridge; no frame on the other side carried it.";
    if (a.cls === "passed") return `Crossed byte for byte: ${B(a.bytes)}, nothing to translate.`;
    const c = counts(a.changes), u = shallow(a.changes);
    return `${B(b.bytes)} in, ${B(a.bytes)} out: ${c["+"]} keys added, ${c["−"]} removed, ${c["~"]} changed (${u.slice(0, 3).join(", ")}${u.length > 3 ? ", …" : ""}).`;
  }
  function setFollowing(v) {
    following = v;
    live.setAttribute("aria-pressed", String(v));
    if (v) {
      const lastOut = [...rows].reverse().find((r) => r.type === "frame" && r.out && r.done && r.cls !== "passed");
      if (lastOut) inspect(lastOut);
    }
  }
  function framesDone() { return rows.filter((r) => r.type === "frame" && r.done); }
  function navTo(d) {
    const list = framesDone();
    if (!list.length) return;
    let i = list.indexOf(selected);
    i = i < 0 ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + d));
    inspect(list[i], true);
    reveal(list[i]);
  }
  function reveal(r) {
    const view = G.H - G.head - 12;
    if (r.y < scrollY || r.y + r.h > scrollY + view) {
      scrollY = Math.max(0, Math.min(contentH - view, r.y - view / 2));
      follow = scrollY >= contentH - view - 2;
    }
    draw(performance.now());
  }
  // ---- your request ----
  function presetFrame(k) {
    const p = PRESETS.find((x) => x[0] === k);
    const id = 101 + yours;
    const era = sess ? sess.era : clientEra(scenario());
    if (k === "batch") return [{ jsonrpc: "2.0", id, method: "tools/list" }, { jsonrpc: "2.0", id: id + 1, method: "prompts/list" }];
    const f = { jsonrpc: "2.0", id, method: p[2] };
    const params = { ...p[3] };
    if (era === "modern" && k !== "bare") params._meta = META;
    if (Object.keys(params).length) f.params = params;
    return f;
  }
  function refreshMine() {
    const era = sess ? sess.era : clientEra(scenario());
    const keep = mineSel.value;
    mineSel.replaceChildren();
    for (const p of PRESETS) if (!p[4] || p[4] === era) mineSel.append(Object.assign(el("option", null, p[1]), { value: p[0] }));
    if ([...mineSel.options].some((o) => o.value === keep)) mineSel.value = keep;
    if (!dirty) ta.value = JSON.stringify(presetFrame(mineSel.value), null, 2);
    checkTa();
  }
  function checkTa() {
    const [v, err] = parse(ta.value);
    taNote.textContent = err ? `Not valid JSON (${err.message}); the bridge will judge it as typed.` : `${B(bytesOf(JSON.stringify(v)))} on the wire.`;
    taNote.classList.toggle("mb-bad", !!err);
  }
  function sendMine() {
    if (!sess) return;
    const [v, err] = parse(ta.value);
    const text = err ? ta.value.replace(/\s*\n\s*/g, " ") : JSON.stringify(v);
    yours++;
    pendingYou = text;
    youBatch = null;
    dirty = false;
    youLine.replaceChildren(el("p", null, "Your frame is next on the wire."));
    if (!playing) stepTo = committed + beats.length + 1;
    refreshMine();
    kick();
  }
  function describeYou(batch) {
    youBatch = null;
    const c = batch.find((r) => r.type === "frame" && r.leg === "c2b");
    const p = el("p");
    const acts = [];
    if (!c) return;
    const m = c.ev.method || "frame";
    const out = batch.find((r) => r.type === "frame" && r.leg === "b2s" && r.src === c);
    const resp = batch.find((r) => r.type === "frame" && r.leg === "b2c" && r.re === c);
    const over = batch.find((r) => r.type === "trace" && /^session over/.test(r.text));
    const fatal = batch.find((r) => r.type === "fatal");
    let text;
    if (over) text = `The session had already ended, so mcpbridge did not deliver your ${m}.`;
    else if (fatal) text = `mcpbridge ended the session over your frame: ${fatal.text}.`;
    else {
      if (out) {
        text = out.cls === "translated"
          ? `Your ${m} reached the server rewritten, ${B(c.bytes)} to ${B(out.bytes)} (${shallow(out.changes).slice(0, 2).join(", ")})`
          : `Your ${m} reached the server as is, ${B(out.bytes)}`;
        acts.push(["Show request", out]);
      } else if (c.stop) text = `mcpbridge ${c.stop === "refused" ? "refused" : "dropped"} your ${m}`;
      else if (resp && !resp.src) text = `mcpbridge answered your ${m} itself`;
      else text = `Your ${m} stopped at the bridge`;
      if (resp) {
        const what = resp.err !== null ? `error ${resp.err}` : "a result";
        text += resp.src
          ? resp.cls === "translated" ? `; ${what} came back rewritten, ${B(resp.src.bytes)} to ${B(resp.bytes)}.` : `; ${what} came back as is.`
          : resp.cls === "refused" ? `, with ${what}: ${resp.json.error.message}.` : ` with ${what}.`;
        acts.push(["Show answer", resp]);
      } else text += ".";
    }
    p.textContent = text;
    const row = el("div", "mb-yacts");
    for (const [t, r] of acts) {
      const b = btn(t, "secondary");
      b.addEventListener("click", () => { inspect(r, true); reveal(r); });
      row.append(b);
    }
    youLine.replaceChildren(p, row);
    inspect(out || resp || c, true);
  }
  // ---- DOM readouts ----
  function showStatus() {
    if (!sess) return;
    const s = sess;
    const engine = s.state?.engine ? `engine ${s.state.engine}` : "engine not picked yet";
    const done = s.done ? ` · finished: ${s.frames} client frames, ${s.state.ended ? "session ended by the bridge" : "session open"}` : "";
    status.textContent = `session ${s.n} · ${s.era} client, ${s.server} server · ${engine}${done}`;
  }
  function updateDom(force) {
    const now = performance.now();
    if (!force && now - lastDom < 200) return;
    lastDom = now;
    const set = (k, v) => { if (cell[k].textContent !== v) cell[k].textContent = v; };
    for (const k of ["sessions", "translated", "passed", "made", "dropped", "refused"]) set(k, fmt(st[k]));
    set("messages", fmt(st.frames));
    set("in", B(st.bin));
    set("out", B(st.bout));
    const c = [...st.calls].sort((a, b) => a - b);
    set("p50", c.length ? ms(c[Math.floor((c.length - 1) / 2)]) : "–");
    if (st.sessions) {
      receipt.textContent = `${fmt(st.frames)} frames through mcpbridge's engines in ${fmt(st.sessions)} session${st.sessions === 1 ? "" : "s"}, ${fmt(st.translated)} translated, ${fmt(st.made)} made by the bridge, in ${ms(st.callMs)} of calls, in your browser.`;
    }
    canvas.setAttribute("aria-label", sess ? `Sequence diagram of session ${sess.n}, ${sess.scn.title}: ${fmt(st.frames)} frames so far, ${fmt(st.translated)} translated by mcpbridge, ${fmt(st.refused)} refused.` : "Sequence diagram");
    older.disabled = !selected;
  }
  // ---- loop ----
  function frame(ts) {
    raf = 0;
    if (!root.isConnected) return;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing || stepTo) sim += dt * (stepTo && !playing ? Math.max(2, Number(speed.value)) : Number(speed.value));
    advance();
    const view = G.H - G.head - 12;
    if (follow) {
      const tip = cur || rows[rows.length - 1];
      const target = Math.max(0, (tip ? tip.y + tip.h : 0) - view);
      scrollY += reduce.matches ? target - scrollY : (target - scrollY) * Math.min(1, dt / 140);
      if (Math.abs(target - scrollY) < 0.5) scrollY = target;
    }
    draw(ts);
    updateDom(false);
    const moving = playing || stepTo || cur || busy || (follow && Math.abs(scrollY - Math.max(0, contentH - view)) > 0.5);
    if (moving && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else { last = 0; updateDom(true); }
  }
  const kick = () => { if (!raf && visible && !document.hidden && root.isConnected) raf = requestAnimationFrame(frame); };
  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) kick();
  }
  async function restart() {
    gen++;
    rows = []; sessions = []; sess = null; beats = []; cur = null; selected = null;
    sim = 0; waitUntil = 0; stepTo = 0; committed = 0; contentH = 0; scrollY = 0; follow = true;
    busy = false; pendingYou = null; youBatch = null; yours = 0;
    st = zero();
    youLine.replaceChildren();
    sbs.replaceChildren();
    iHead.textContent = "";
    iFoot.textContent = "";
    setFollowing(true);
    busy = true;
    try {
      await openSession();
    } finally {
      busy = false;
    }
  }
  // With reduced motion: one finished session, drawn at once, nothing playing.
  async function settleFirst() {
    const g = gen;
    while (g === gen && sess && sess.next < sess.scn.frames.length && !sess.state.ended) {
      await sendFrame(sess.scn.frames[sess.next++], false);
    }
    while (beats.length) { const r = beats.shift(); r.t0 = 0; r.dur = 0; commit(r); }
    sess.done = true;
    showStatus();
    scrollY = Math.max(0, contentH - (G.H - G.head - 12));
  }
  // ---- inputs ----
  const fail = (e) => { status.textContent = `The demo call failed: ${e.message}`; };
  const restartAndGo = () => restart().then(() => (reduce.matches && !playing ? settleFirst() : null)).then(() => { updateDom(true); draw(performance.now()); kick(); }).catch(fail);
  scnSel.addEventListener("change", restartAndGo);
  srvSel.addEventListener("change", restartAndGo);
  reset.addEventListener("click", restartAndGo);
  speed.addEventListener("change", kick);
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    stepTo = committed + 1;
    if (cur) cur.t0 = Math.min(cur.t0, sim - cur.dur + Math.min(cur.dur, 200));
    kick();
  });
  send.addEventListener("click", sendMine);
  mineSel.addEventListener("change", () => { dirty = false; refreshMine(); });
  ta.addEventListener("input", () => { dirty = true; checkTa(); });
  older.addEventListener("click", () => navTo(-1));
  newer.addEventListener("click", () => navTo(1));
  live.addEventListener("click", () => setFollowing(!following));
  canvas.addEventListener("wheel", (e) => {
    const view = G.H - G.head - 12;
    const max = Math.max(0, contentH - view);
    const next = Math.max(0, Math.min(max, scrollY + e.deltaY));
    if (next === scrollY) return;
    e.preventDefault();
    scrollY = next;
    follow = next >= max - 2;
    draw(performance.now());
  }, { passive: false });
  canvas.addEventListener("click", (e) => {
    const b = canvas.getBoundingClientRect();
    const y = e.clientY - b.top - G.head - 6 + scrollY;
    if (e.clientY - b.top < G.head) return;
    let hit = null;
    for (const r of rows) if (r.done && r.type === "frame" && y >= r.y - 4 && y < r.y + r.h + 4) hit = r;
    if (hit) { inspect(hit, true); draw(performance.now()); }
  });
  const redraw = () => { readColors(); draw(performance.now()); };
  new ResizeObserver(() => { if (!root.isConnected) return; layout(); redraw(); }).observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(canvas);
  document.addEventListener("visibilitychange", kick);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  addEventListener("themechange", redraw);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));
  await cssReady;
  readColors();
  layout();
  await restart();
  if (reduce.matches) await settleFirst();
  else {
    // First real output before resolving: the client's opening frame.
    busy = true;
    try { await sendFrame(sess.scn.frames[sess.next++], false); } finally { busy = false; }
    while (beats.length && beats[0].type === "session") commit(beats.shift());
  }
  setPlaying(playing);
  updateDom(true);
  draw(performance.now());
  kick();
}
