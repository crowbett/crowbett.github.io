// mcpbridge demo: the real translation engines (xlate.New / xlate.NewReverse),
// compiled to WebAssembly, between a client you script and the repo's own
// conformance fixture server. Every frame on all four legs is captured; the
// inspector diffs each bridge-emitted frame against the frame it translates.
const DIRS = {
  forward: { server: "modern", label: "2024-11 client to 2026-07-28 server", client: "legacy client", serverName: "modern-stub", serverEra: "2026-07-28 only" },
  reverse: { server: "legacy", label: "2026-07-28 client to 2024-11 server", client: "modern client", serverName: "legacy-stub", serverEra: "2025-era handshake" },
};
const LEG = {
  c2b: "client to bridge", b2s: "bridge to server", s2b: "server to bridge", b2c: "bridge to client",
};
const HOP_MS = 240;
const TRACE_MS = 110;
const SEED = 1;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const btn = (text, cls) => {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
};
const field = (label, input) => {
  const f = el("label", "demo-field");
  f.append(el("span", "demo-label", label), input);
  return f;
};
const shortId = (id) => {
  if (id === undefined || id === null) return "";
  const s = typeof id === "string" ? id : JSON.stringify(id);
  return s.replace(/^(mcpbridge(?:-state)?)#[0-9a-f]{16}#/, "$1#…#");
};
const parse = (s) => {
  try { return [JSON.parse(s), null]; } catch (e) { return [undefined, e]; }
};
const pretty = (s) => {
  const [v, err] = parse(s);
  return err ? s : JSON.stringify(v, null, 2);
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- JSON as spans ----

function tokens(text, into) {
  let i = 0;
  const push = (cls, s) => {
    if (!s) return;
    if (!cls) into.append(document.createTextNode(s));
    else into.append(el("span", cls, s));
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      j = Math.min(j + 1, text.length);
      let k = j;
      while (text[k] === " ") k++;
      push(text[k] === ":" ? "mb-k" : "mb-s", text.slice(i, j));
      i = j;
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9eE+.\-]/.test(text[j])) j++;
      push("mb-n", text.slice(i, j));
      i = j;
    } else if (/[tfn]/.test(c) && /^(true|false|null)/.test(text.slice(i, i + 5))) {
      const w = text.slice(i).match(/^(true|false|null)/)[0];
      push("mb-n", w);
      i += w.length;
    } else if ("{}[],:".includes(c)) {
      push("mb-p", c);
      i++;
    } else {
      let j = i + 1;
      while (j < text.length && !'"{}[],:-0123456789tfn'.includes(text[j])) j++;
      push(null, text.slice(i, j));
      i = j;
    }
  }
}

// Unified structural diff: one line per key, marked "add" or "del".
function diffLines(cur, prev, hasPrev) {
  const out = [];
  const ops = { add: 0, del: 0, chg: 0 };
  const line = (ind, key, text, mark) => out.push({ ind, key, text, mark });
  const emit = (ind, key, v, mark, comma) => {
    if (isObj(v) || Array.isArray(v)) {
      const entries = isObj(v) ? Object.entries(v) : v.map((x, i) => [null, x]);
      const [o, c] = isObj(v) ? ["{", "}"] : ["[", "]"];
      if (!entries.length) return line(ind, key, o + c + comma, mark);
      line(ind, key, o, mark);
      entries.forEach(([k, x], i) => emit(ind + 1, k, x, mark, i < entries.length - 1 ? "," : ""));
      line(ind, null, c + comma, mark);
    } else line(ind, key, JSON.stringify(v) + comma, mark);
  };
  const walk = (ind, key, a, b, comma) => {
    if (same(a, b)) return emit(ind, key, a, null, comma);
    if (isObj(a) && isObj(b)) {
      const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))];
      line(ind, key, "{", null);
      keys.forEach((k, i) => {
        const c = i < keys.length - 1 ? "," : "";
        if (!(k in b)) { ops.add++; emit(ind + 1, k, a[k], "add", c); }
        else if (!(k in a)) { ops.del++; emit(ind + 1, k, b[k], "del", c); }
        else walk(ind + 1, k, a[k], b[k], c);
      });
      return line(ind, null, "}" + comma, null);
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      line(ind, key, "[", null);
      a.forEach((x, i) => walk(ind + 1, null, x, b[i], i < a.length - 1 ? "," : ""));
      return line(ind, null, "]" + comma, null);
    }
    ops.chg++;
    emit(ind, key, b, "del", comma);
    emit(ind, key, a, "add", comma);
  };
  if (hasPrev) walk(0, null, cur, prev, "");
  else emit(0, null, cur, null, "");
  return { out, ops };
}

function renderLines(pre, lines) {
  pre.replaceChildren();
  for (const l of lines) {
    const row = el("span", "mb-l" + (l.mark ? " mb-" + l.mark : ""));
    row.append(el("span", "mb-g", l.mark === "add" ? "+" : l.mark === "del" ? "−" : " "));
    row.style.setProperty("--mb-i", l.ind);
    if (l.key !== null) {
      row.append(el("span", "mb-k", JSON.stringify(l.key)), el("span", "mb-p", ": "));
    }
    tokens(l.text, row);
    pre.append(row);
  }
}

// ---- the demo ----

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
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // Controls
  const dirSel = el("select");
  dirSel.name = "direction";
  for (const [k, d] of Object.entries(DIRS)) {
    const o = el("option", null, d.label);
    o.value = k;
    dirSel.append(o);
  }
  const scnSel = el("select");
  scnSel.name = "scenario";
  const play = btn("Play");
  const stepB = btn("Step", "secondary");
  const addB = btn("Add frame", "secondary");
  const bar = el("div", "mb-bar");
  bar.append(field("Direction", dirSel), field("Scenario", scnSel), play, stepB, addB);
  const note = el("p", "mb-note");
  const from = el("p", "mb-from");

  // Timeline
  const head = el("div", "mb-head");
  head.setAttribute("aria-hidden", "true");
  const hClient = el("span", "mb-hc");
  const hBridge = el("span", "mb-hb", "mcpbridge");
  const hServer = el("span", "mb-hs");
  head.append(hClient, hBridge, hServer);
  const scroller = el("div", "mb-scroll");
  scroller.setAttribute("aria-label", "Frames on the wire");
  const flow = el("div", "mb-flow");
  const canvas = el("canvas", "mb-canvas");
  canvas.setAttribute("aria-hidden", "true");
  const list = el("ol", "mb-rows");
  list.setAttribute("aria-label", "Captured frames, in wire order");
  flow.append(canvas, list);
  scroller.append(flow);
  const legend = el("p", "mb-legend");
  for (const [k, t] of [["you", "your frame"], ["add", "added or rewritten by the bridge"], ["del", "removed by the bridge"], ["bad", "refused as unsupported"], ["lane", "inside mcpbridge"]]) {
    legend.append(el("span", "mb-key mb-key-" + k, t));
  }
  const timeline = el("div", "mb-timeline");
  timeline.append(head, scroller, legend);

  // Inspector
  const insp = el("section", "mb-inspect");
  insp.setAttribute("aria-label", "Frame inspector");
  const iHead = el("p", "mb-ihead");
  iHead.setAttribute("aria-live", "polite");
  const iLinks = el("p", "mb-links");
  const iBody = el("div", "mb-ibody");
  const iFoot = el("p", "mb-ifoot");
  insp.append(iHead, iLinks, iBody, iFoot);

  const main = el("div", "mb-main");
  main.append(timeline, insp);
  const status = el("p", "mb-status");
  status.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells mb-cells");
  cells.setAttribute("aria-label", "Bridge state");
  const nonceNote = el("p", "mb-fine");
  root.replaceChildren(bar, note, from, main, status, cells, nonceNote);

  // State
  let scenarios = [];
  let dir = "forward";
  let script = [];
  let events = [];
  let meta = new Map();
  let state = null;
  let cursor = 0;
  let selected = 0;
  let anim = 0;
  let editorStep = 0;
  let packet = null;
  const rows = new Map();
  let geom = new Map();
  let colors = {};

  const readColors = () => {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { accent: v("--accent"), tint: v("--accent-tint"), sig: v("--mb-sig"), text: v("--text"), dim: v("--text-3"), danger: v("--danger"), line: v("--line-strong") };
  };

  // Per-event derived data: parsed frame, diff against its source.
  function derive(e) {
    if (!e.frame) return { ops: null };
    const [cur, err] = parse(e.frame);
    if (err) return { ops: null, cur: e.frame };
    let ops = null;
    if (e.src) {
      const [prev] = parse(events[e.src - 1].frame);
      ops = diffLines(cur, prev, true).ops;
    }
    const changed = ops && ops.add + ops.del + ops.chg > 0;
    const bridgeMade = (e.leg === "b2s" || e.leg === "b2c") && !e.src;
    return { cur, ops, changed, bridgeMade, touched: changed || bridgeMade };
  }

  function label(e) {
    if (e.kind === "response") {
      const [f] = parse(e.frame);
      const what = f && f.error ? `error ${f.error.code}` : "result";
      return [e.method ? `${e.method} ${what}` : what, e.id];
    }
    return [e.method || e.kind, e.id];
  }

  function rowFor(e) {
    const li = el("li", "mb-row");
    li.dataset.leg = e.leg;
    li.dataset.seq = e.seq;
    if (e.leg === "trace" || e.leg === "fatal") {
      li.append(el("span", "mb-trace", (e.leg === "fatal" ? "session ended: " : "") + e.text));
      if (e.unsupported || e.leg === "fatal") li.classList.add("mb-refused");
      return li;
    }
    const m = meta.get(e.seq);
    const b = btn("", "mb-pkt");
    b.tabIndex = -1;
    const [name, id] = label(e);
    b.append(el("span", "mb-seq", String(e.seq)), el("span", "mb-method", name));
    if (id !== undefined) b.append(el("span", "mb-id", "id " + shortId(id)));
    let badge = "";
    if (e.unsupported) { li.classList.add("mb-refused"); badge = "unsupported"; }
    else if (m.changed) badge = [m.ops.add && `+${m.ops.add}`, m.ops.del && `−${m.ops.del}`, m.ops.chg && `~${m.ops.chg}`].filter(Boolean).join(" ");
    else if (m.bridgeMade) badge = "bridge-made";
    else if (m.ops) badge = "unchanged";
    if (badge) b.append(el("span", "mb-badge" + (badge === "unchanged" ? " mb-quiet" : ""), badge));
    if (m.touched) li.classList.add("mb-touched");
    const why = e.unsupported ? "refused as unsupported" : m.changed ? `translated from frame ${e.src}` : m.bridgeMade ? "originated by the bridge" : m.ops ? "forwarded unchanged" : "";
    b.setAttribute("aria-label", `Frame ${e.seq}, ${LEG[e.leg]}: ${name}${id !== undefined ? ", id " + shortId(id) : ""}${why ? ", " + why : ""}`);
    b.addEventListener("click", () => select(e.seq, true));
    li.append(b);
    return li;
  }

  function addRows(evs, hidden) {
    for (const e of evs) {
      meta.set(e.seq, derive(e));
      const li = rowFor(e);
      if (hidden) li.classList.add("mb-pending");
      rows.set(e.seq, li);
      list.append(li);
    }
    measure();
  }

  function measure() {
    geom = new Map();
    const mid = flow.clientWidth / 2;
    for (const [seq, li] of rows) {
      const b = li.querySelector(".mb-pkt, .mb-trace");
      const y = li.offsetTop + li.offsetHeight / 2;
      geom.set(seq, { y, l: b.offsetLeft + b.offsetWidth, r: b.offsetLeft, mid });
    }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(flow.clientWidth * dpr));
    const h = Math.max(1, Math.round(flow.scrollHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
    draw();
  }

  function legColor(e) {
    const m = meta.get(e.seq) || {};
    if (e.unsupported || e.leg === "fatal") return colors.danger;
    if (e.leg === "c2b") return colors.text;
    return m.touched ? colors.sig : colors.dim;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = canvas.width / dpr, H = canvas.height / dpr, mid = Math.round(W / 2);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = colors.tint;
    ctx.fillRect(mid - 9, 0, 18, H);
    ctx.fillStyle = colors.accent;
    ctx.fillRect(mid - 0.5, 0, 1, H);
    for (const e of events) {
      const li = rows.get(e.seq), g = geom.get(e.seq);
      if (!li || !g || li.classList.contains("mb-pending")) continue;
      const y = Math.round(g.y) + 0.5;
      if (e.leg === "trace" || e.leg === "fatal") continue;
      const left = e.leg === "c2b" || e.leg === "b2c";
      const edge = left ? g.l : g.r;
      const toBridge = e.leg === "c2b" || e.leg === "s2b";
      const c = legColor(e);
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(edge + (left ? 2 : -2), y);
      ctx.lineTo(mid, y);
      ctx.stroke();
      const tip = toBridge ? mid - (left ? 10 : -10) : edge + (left ? 3 : -3);
      const dirx = toBridge ? (left ? 1 : -1) : (left ? -1 : 1);
      ctx.beginPath();
      ctx.moveTo(tip, y);
      ctx.lineTo(tip - dirx * 5, y - 3.5);
      ctx.lineTo(tip - dirx * 5, y + 3.5);
      ctx.fill();
      const m = meta.get(e.seq);
      if (!toBridge && (m.touched || e.unsupported)) {
        ctx.fillRect(mid - 3.5, y - 3.5, 7, 7);
      }
    }
    if (packet) {
      ctx.fillStyle = packet.color;
      packet.trail.forEach((p, i) => {
        ctx.globalAlpha = 0.12 + (0.5 * i) / packet.trail.length;
        ctx.fillRect(p[0] - 2.5, p[1] - 2.5, 5, 5);
      });
      ctx.globalAlpha = 1;
      ctx.fillRect(packet.x - 4, packet.y - 4, 8, 8);
    }
  }

  let lastY = 0;
  function pathFor(e) {
    const g = geom.get(e.seq);
    const y = g.y, mid = g.mid;
    switch (e.leg) {
      case "c2b": return [[g.l, y], [mid, y]];
      case "s2b": return [[g.r, y], [mid, y]];
      case "b2s": return [[mid, lastY], [mid, y], [g.r, y]];
      case "b2c": return [[mid, lastY], [mid, y], [g.l, y]];
      default: return [[mid, lastY], [mid, y]];
    }
  }

  function travel(path, ms, color, token) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      segs.push(d);
      total += d;
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const trail = [];
      const frame = (now) => {
        if (token !== anim) { packet = null; draw(); return resolve(false); }
        const t = Math.min(1, (now - t0) / ms);
        const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        let dist = k * total, i = 0;
        while (i < segs.length - 1 && dist > segs[i]) { dist -= segs[i]; i++; }
        const f = segs[i] ? dist / segs[i] : 1;
        const x = path[i][0] + (path[i + 1][0] - path[i][0]) * f;
        const y = path[i][1] + (path[i + 1][1] - path[i][1]) * f;
        trail.push([x, y]);
        if (trail.length > 6) trail.shift();
        packet = { x, y, color, trail: trail.slice(0, -1) };
        draw();
        if (t < 1) requestAnimationFrame(frame);
        else { packet = null; resolve(true); }
      };
      requestAnimationFrame(frame);
    });
  }

  function reveal(e) {
    const li = rows.get(e.seq);
    li.classList.remove("mb-pending");
    const top = li.offsetTop, bottom = top + li.offsetHeight;
    if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight + 8;
    else if (top < scroller.scrollTop) scroller.scrollTop = top - 8;
    draw();
  }

  async function animate(evs, token) {
    for (const e of evs) {
      if (token !== anim) return false;
      if (!reduced.matches && geom.get(e.seq)) {
        const ms = e.leg === "trace" || e.leg === "fatal" ? TRACE_MS : HOP_MS;
        if (!(await travel(pathFor(e), ms, legColor(e), token))) return false;
        lastY = geom.get(e.seq).y;
      }
      reveal(e);
      if ((e.leg === "b2s" || e.leg === "b2c") && meta.get(e.seq).touched) select(e.seq, false);
    }
    return true;
  }

  // ---- inspector ----

  function select(seq, user) {
    const e = events[seq - 1];
    if (!e || !e.frame) return;
    const prev = rows.get(selected);
    if (prev) {
      prev.classList.remove("mb-sel");
      const pb = prev.querySelector(".mb-pkt");
      if (pb) { pb.tabIndex = -1; pb.removeAttribute("aria-current"); }
    }
    selected = seq;
    const li = rows.get(seq);
    if (li) {
      li.classList.add("mb-sel");
      const b = li.querySelector(".mb-pkt");
      b.tabIndex = 0;
      b.setAttribute("aria-current", "true");
      if (user) b.focus();
    }
    inspect(e);
  }

  function linkTo(seq, text) {
    const b = btn(text, "mb-link secondary");
    b.addEventListener("click", () => select(seq, true));
    return b;
  }

  function inspect(e) {
    const m = meta.get(e.seq);
    const [name] = label(e);
    iHead.textContent = `${e.seq} · ${LEG[e.leg]} · ${name}`;
    iLinks.replaceChildren();
    if (e.src) iLinks.append(linkTo(e.src, `Translates ${e.src}`));
    if (e.re) iLinks.append(linkTo(e.re, `Answers ${e.re}`));
    if (e.leg === "c2b") {
      iFoot.textContent = "Your frame. Edit it and the whole conversation replays through the bridge. Frames are sent compact, one per line, as stdio framing requires.";
      if (editorStep !== e.step || !iBody.querySelector("textarea")) editor(e.step);
      return;
    }
    editorStep = 0;
    const pre = el("pre", "mb-json");
    pre.setAttribute("aria-label", `Frame ${e.seq} JSON`);
    if (e.src && m.cur !== undefined) {
      const [prev] = parse(events[e.src - 1].frame);
      const d = diffLines(m.cur, prev, true);
      renderLines(pre, d.out);
      const { add, del, chg } = d.ops;
      iFoot.textContent = add + del + chg
        ? `Against frame ${e.src}: ${add} added, ${del} removed, ${chg} changed. Added keys are marked +, removed keys −; everything else crossed unchanged.`
        : `Byte for byte what frame ${e.src} carried: nothing needed translating.`;
    } else {
      renderLines(pre, diffLines(m.cur, null, false).out);
      iFoot.textContent = e.leg === "s2b"
        ? "What the conformance fixture server sent. It speaks only its own era."
        : e.unsupported
          ? "Refused out loud: no faithful translation exists, so the bridge says so instead of approximating."
          : "Originated by the bridge: no frame on the other side carried it. It answers or asks on someone's behalf.";
      if (m.bridgeMade && !e.unsupported) pre.classList.add("mb-made");
    }
    iBody.replaceChildren(pre);
  }

  function editor(step) {
    editorStep = step;
    const idx = step - 1;
    const wrap = el("div", "mb-ed");
    const hl = el("pre", "mb-hl");
    hl.setAttribute("aria-hidden", "true");
    const ta = el("textarea");
    ta.name = "frame";
    ta.spellcheck = false;
    ta.wrap = "off";
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("autocomplete", "off");
    ta.value = script[idx];
    wrap.append(hl, ta);
    const f = field(`Frame ${step} of ${script.length}, JSON-RPC`, wrap);
    f.classList.add("mb-edf");
    const valid = el("p", "mb-valid");
    valid.setAttribute("aria-live", "polite");
    const remove = btn("Remove frame", "secondary");
    remove.disabled = script.length < 2;
    remove.addEventListener("click", async () => {
      script.splice(idx, 1);
      editorStep = 0;
      await runAll(Math.max(1, step - 1));
    });
    const tools = el("div", "mb-edtools");
    tools.append(valid, remove);
    const paint = () => {
      hl.replaceChildren();
      tokens(ta.value + "\n", hl);
      ta.rows = Math.min(22, Math.max(4, ta.value.split("\n").length));
      const [, err] = parse(ta.value);
      valid.textContent = err ? `Not valid JSON: ${err.message}` : `Valid JSON, ${JSON.stringify(JSON.parse(ta.value)).length} bytes on the wire.`;
      valid.classList.toggle("mb-bad", !!err);
      return !err;
    };
    let timer = 0;
    ta.addEventListener("input", () => {
      script[idx] = ta.value;
      const ok = paint();
      clearTimeout(timer);
      if (ok) timer = setTimeout(() => runAll(step, true), 160);
      else status.textContent = `Frame ${step} is not valid JSON; showing the last run that was.`;
    });
    ta.addEventListener("scroll", () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
    paint();
    iBody.replaceChildren(f, tools);
  }

  // ---- runs ----

  function stats() {
    let touched = 0, made = 0, refused = 0, wire = 0;
    for (const e of events) {
      const m = meta.get(e.seq);
      if (e.frame) wire++;
      if (e.leg === "fatal" || (e.frame ? e.unsupported : e.text.startsWith("LOUD: unsupported"))) refused++;
      else if (e.unsupported) continue;
      else if (m && m.changed) touched++;
      else if (m && m.bridgeMade) made++;
    }
    return { touched, made, refused, wire };
  }

  function showState() {
    const s = stats();
    const d = DIRS[dir];
    hClient.replaceChildren(el("b", null, "client"), el("span", null, state && state.dialect ? `${state.dialect} dialect` : d.client));
    hServer.replaceChildren(el("b", null, "server"), el("span", null, `${d.serverName}, ${d.serverEra}`));
    const items = [
      ["dialect", state?.dialect || "—"], ["engine", state?.engine || "—"], ["frames on the wire", s.wire],
      ["translated", s.touched], ["bridge-made", s.made], ["refused", s.refused], ["client owes", state?.awaiting.length || 0],
    ];
    cells.replaceChildren(...items.map(([k, v]) => {
      const li = el("li");
      li.append(el("span", "mb-ck", k + " "), el("span", null, String(v)));
      return li;
    }));
    const sent = events.filter((e) => e.leg === "c2b").length;
    status.textContent = `${sent} client frame${sent === 1 ? "" : "s"}, ${s.wire} frames on the wire: ${s.touched} translated, ${s.made} made by the bridge, ${s.refused} refused` +
      (state?.ended ? ". The bridge ended the session." : ".");
    nonceNote.textContent = state ? `Bridge-minted ids carry nonce ${state.nonce}, fixed here so a replay is identical; the shipped binary draws a fresh one per connection.` : "";
    stepB.textContent = `Step ${(cursor % script.length) + 1}/${script.length}`;
  }

  function clear() {
    rows.clear();
    meta.clear();
    list.replaceChildren();
    events = [];
    selected = 0;
    lastY = 0;
  }

  function compact() {
    const out = [];
    for (let i = 0; i < script.length; i++) {
      const [v, err] = parse(script[i]);
      if (err) return [null, i + 1];
      out.push(JSON.stringify(v));
    }
    return [out, 0];
  }

  let chain = Promise.resolve();
  const queue = (fn) => (chain = chain.then(fn).catch((err) => { status.textContent = `The demo call failed: ${err.message}`; }));
  const flush = () => {
    for (const li of rows.values()) li.classList.remove("mb-pending");
    packet = null;
    draw();
  };

  function runAll(focusStep, fromEditor) {
    ++anim;
    return queue(() => replay(focusStep, fromEditor));
  }

  async function replay(focusStep, fromEditor) {
    const [frames, bad] = compact();
    if (!frames) { status.textContent = `Frame ${bad} is not valid JSON; fix it to replay.`; return; }
    const r = await demo.call("run", { server: DIRS[dir].server, seed: SEED, frames });
    const keep = fromEditor ? scroller.scrollTop : 0;
    clear();
    events = r.events;
    state = r.state;
    cursor = script.length;
    addRows(events, false);
    scroller.scrollTop = keep;
    showState();
    const c2b = events.find((e) => e.leg === "c2b" && e.step === focusStep);
    const first = events.find((e) => e.leg === "b2s" && meta.get(e.seq).changed);
    const target = focusStep ? c2b : first;
    if (target) select(target.seq, false);
    if (target && !fromEditor) {
      const li = rows.get(target.seq);
      if (li.offsetTop + li.offsetHeight > scroller.clientHeight) scroller.scrollTop = li.offsetTop - 8;
    }
  }

  async function stepOnce(token) {
    flush();
    if (cursor >= script.length) {
      await demo.call("open", { server: DIRS[dir].server, seed: SEED });
      clear();
      cursor = 0;
      state = null;
    }
    const [frames, bad] = compact();
    if (!frames) { status.textContent = `Frame ${bad} is not valid JSON; fix it to replay.`; return; }
    const r = await demo.call("send", { frame: frames[cursor] });
    cursor++;
    events = events.concat(r.events);
    state = r.state;
    const animated = token === anim && !reduced.matches;
    addRows(r.events, animated);
    if (animated) await animate(r.events, token);
    flush();
    showState();
  }

  play.addEventListener("click", () => {
    const token = ++anim;
    queue(async () => {
      play.textContent = "Playing…";
      try {
        cursor = script.length;
        do {
          await stepOnce(token);
          if (token === anim && cursor < script.length && !reduced.matches) await new Promise((r) => setTimeout(r, 160));
        } while (token === anim && cursor < script.length);
      } finally {
        play.textContent = "Play";
      }
    });
  });
  stepB.addEventListener("click", () => {
    const token = ++anim;
    queue(() => stepOnce(token));
  });

  addB.addEventListener("click", async () => {
    await chain;
    script.push(nextFrame());
    await runAll(script.length);
    const li = rows.get(selected);
    if (li) scroller.scrollTop = Math.max(0, li.offsetTop - 64);
  });

  // The frame a client would send next: a reply the bridge is waiting on, an
  // input_required retry, or a fresh request.
  function nextFrame() {
    const j = (v) => JSON.stringify(v, null, 2);
    for (const id of state?.awaiting || []) {
      const req = events.find((e) => e.leg === "b2c" && e.kind === "request" && JSON.stringify(e.id) === id);
      const result = req?.method === "elicitation/create" ? { action: "accept", content: { response: "Ada" } }
        : req?.method === "sampling/createMessage" ? { role: "assistant", content: { type: "text", text: "Hello!" }, model: "demo-model", stopReason: "endTurn" }
          : req?.method === "roots/list" ? { roots: [] } : {};
      return j({ jsonrpc: "2.0", id: JSON.parse(id), result });
    }
    const ids = events.filter((e) => e.leg === "c2b" && typeof e.id === "number").map((e) => e.id);
    const id = ids.length ? Math.max(...ids) + 1 : 1;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.leg !== "b2c" || e.kind !== "response") continue;
      const [f] = parse(e.frame);
      if (f?.result?.resultType !== "input_required") break;
      const [orig] = parse(events[e.re - 1].frame);
      const inputResponses = {};
      for (const [k, q] of Object.entries(f.result.inputRequests || {})) {
        inputResponses[k] = q.method === "sampling/createMessage" ? { role: "assistant", content: { type: "text", text: "Hello!" }, model: "demo-model", stopReason: "endTurn" }
          : q.method === "roots/list" ? { roots: [] } : { action: "accept", content: {} };
      }
      return j({ ...orig, id, params: { ...orig.params, inputResponses, requestState: f.result.requestState } });
    }
    const params = { name: "test_simple_text", arguments: {} };
    if (dir === "reverse") params._meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
    return j({ jsonrpc: "2.0", id, method: "tools/call", params });
  }

  function fillScenarios() {
    scnSel.replaceChildren();
    for (const s of scenarios.filter((s) => s.server === DIRS[dir].server)) {
      const o = el("option", null, s.title);
      o.value = s.id;
      scnSel.append(o);
    }
  }

  async function load(id, first) {
    const s = scenarios.find((x) => x.id === id);
    scnSel.value = id;
    note.textContent = s.note;
    from.textContent = "Follows the conformance suite's " + s.from.join(", ");
    script = s.frames.map(pretty);
    editorStep = 0;
    if (first) await replay(0);
    else await runAll(0);
  }

  dirSel.addEventListener("change", async () => {
    dir = dirSel.value;
    fillScenarios();
    await load(scnSel.value);
  });
  scnSel.addEventListener("change", () => load(scnSel.value));

  list.addEventListener("keydown", (ev) => {
    const seqs = [...rows.keys()].filter((s) => events[s - 1].frame && !rows.get(s).classList.contains("mb-pending"));
    const i = seqs.indexOf(selected);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: seqs.length - 1 }[ev.key];
    if (to === undefined || !seqs.length) return;
    ev.preventDefault();
    select(seqs[Math.max(0, Math.min(seqs.length - 1, to))], true);
    rows.get(selected).scrollIntoView({ block: "nearest" });
  });

  new ResizeObserver(() => measure()).observe(flow);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); draw(); });

  await cssReady;
  readColors();
  scenarios = (await demo.call("scenarios", {})).scenarios;
  fillScenarios();
  await load(scnSel.value, true);
}
