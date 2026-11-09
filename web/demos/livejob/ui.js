// LiveJob demo: lj's own Go packages, compiled to WebAssembly, play one made-up
// coding-agent session on a simulated clock. The binary pairs a Mac and a phone
// (X25519, the pairing proof), seals every frame (AES-256-GCM), feeds both
// screens through job.Screen, reads prompts with Screen.Detect, signs the
// Lock Screen's buttons and checks the phone's input with Stream.Accept. This
// page only draws what each call returns.
const SPEEDS = [1, 2, 4];
const FLY_MS = 260;
const AUTO_MS = 6000;
const MAX_LOG = 40;
const LINES = ["add a regression test", "tidy the error messages", "check the retry path"];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const secs = (ms, d = 1) => `${(ms / 1000).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} s`;
const bytes = (n) => `${fmt(n)} B`;

function field(label, input, cls) {
  const wrap = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
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
  const play = button("Pause");
  const step = button("Step 1 s", "secondary");
  const reset = button("Reset", "secondary");
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 1);
  const auto = el("input");
  Object.assign(auto, { type: "checkbox", name: "auto", checked: true });
  const acts = el("div", "lj-acts");
  acts.append(play, step, reset, field("speed", speed), field("answer for me", auto, "lj-check"));
  const ATTACKS = [["flip", "Flip a bit"], ["relabel", "Rewrite a button"], ["replay", "Replay my last frame"], ["inject", "Inject keystrokes"]];
  const attackBtn = {};
  const attacks = el("div", "lj-attacks");
  attacks.append(el("span", "demo-label", "play the relay"));
  for (const [k, t] of ATTACKS) {
    const b = button(t, "secondary");
    b.dataset.k = k;
    attackBtn[k] = b;
    attacks.append(b);
  }
  const form = el("form", "lj-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(acts);

  // Pairing.
  const pair = el("ul", "lj-pair");
  pair.setAttribute("aria-label", "Pairing, as lj pair and the app run it");

  // The stage: Mac, relay, phone.
  const wrap = el("div", "lj-wrap");
  const stage = el("div", "lj-stage");
  wrap.append(stage);
  const mac = el("section", "lj-pane lj-mac");
  const macHead = el("p", "lj-head");
  macHead.append(el("b", null, "mac"), el("span", "lj-cmd", "lj run -- …"));
  const macTerm = el("div", "lj-term");
  macTerm.setAttribute("role", "img");
  const gate = el("div", "lj-gate");
  const gateBar = el("span", "lj-gate-bar");
  const gateText = el("span", "lj-gate-text", "–");
  gate.append(gateBar, gateText);
  mac.append(macHead, macTerm, gate);

  const relay = el("section", "lj-pane lj-relay");
  const relayHead = el("p", "lj-head");
  relayHead.append(el("b", null, "relay"), el("span", null, "what it holds"));
  const lane = el("div", "lj-lane");
  lane.setAttribute("aria-hidden", "true");
  lane.append(el("span", "lj-end", "mac"), el("span", "lj-end lj-end-r", "phone"));
  const log = el("ol", "lj-log");
  log.tabIndex = 0;
  log.setAttribute("aria-label", "Frames and pushes through the relay, newest first");
  relay.append(relayHead, lane, log, attacks);

  const phone = el("section", "lj-pane lj-phone");
  const phoneHead = el("p", "lj-head");
  phoneHead.append(el("b", null, "phone"), el("span", null, "lock screen, then the app"));
  const card = el("div", "lj-card");
  card.setAttribute("aria-live", "polite");
  const cardTop = el("p", "lj-card-top");
  const cardStatus = el("span", "lj-card-status", "–");
  cardTop.append(el("span", "lj-card-cmd", "agent"), cardStatus);
  const cardText = el("p", "lj-card-text", "pairing…");
  const cardBtns = el("div", "lj-card-btns");
  card.append(cardTop, cardText, cardBtns);
  const phoneTerm = el("div", "lj-term lj-term-phone");
  phoneTerm.setAttribute("role", "img");
  const type = el("div", "lj-type");
  const line = el("input");
  Object.assign(line, { type: "text", name: "line", maxLength: 40, placeholder: "type a line", autocomplete: "off", spellcheck: false });
  line.enterKeyHint = "send";
  const send = button("Send");
  type.append(field("type into the session", line, "lj-line"), send);
  phone.append(phoneHead, card, phoneTerm, type);
  stage.append(mac, phone, relay);

  const legend = el("p", "demo-legend lj-legend");
  for (const [k, t] of [["m2d", "sealed frame, mac to phone"], ["d2m", "sealed frame, your input"], ["push", "lock screen push, readable by the relay"], ["bad", "refused"]]) {
    const s = el("span", "lj-key", t);
    s.dataset.kind = k;
    legend.append(s);
  }
  const cells = el("ul", "cells stack lj-cells");
  const cell = {};
  const CELLS = [["t", "sim"], ["m2d", "frames out"], ["d2m", "frames in"], ["pty", "terminal bytes"], ["plain", "plaintext"], ["sealed", "sealed"],
    ["prompts", "prompts read"], ["answered", "answers typed"], ["blocked", "refused"], ["rtt", "round trip"]];
  for (const [k, t] of CELLS) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "lj-v", "–");
    li.append(el("span", null, t), v);
    cell[k] = v;
    cells.append(li);
  }
  const status = el("p", "lj-status");
  status.setAttribute("aria-live", "polite");
  const receipt = el("p", "demo-out lj-out");
  receipt.setAttribute("aria-live", "polite");
  root.replaceChildren(form, pair, wrap, legend, cells, status, receipt);

  // State.
  let gen = 0;
  let v = null;
  let playing = !reduce.matches;
  let visible = true;
  let pending = 0;
  let last = 0;
  let busy = 0;
  let chain = Promise.resolve();
  let raf = 0;
  let callMs = 0;
  let calls = 0;
  let rtt = null;
  let shownCard = "";
  let waitSince = null;
  let waitKey = "";
  let autoUsed = 0;
  let lastDom = 0;
  let cols = 46;

  const exec = (method, params) => {
    busy++;
    const g = gen;
    const run = chain.then(async () => {
      const t0 = performance.now();
      try {
        return { r: await demo.call(method, params), ms: performance.now() - t0 };
      } finally {
        callMs += performance.now() - t0;
        calls++;
      }
    }).finally(() => { busy--; });
    chain = run.catch(() => {});
    return run.then(({ r, ms }) => ({ r, ms, g }));
  };

  // Terminals: one row per screen line, sized so every column fits the pane.
  function rows(term, n) {
    while (term.children.length < n) term.append(el("div", "lj-row"));
    while (term.children.length > n) term.lastChild.remove();
  }
  function paint(term, lines) {
    rows(term, lines.length);
    lines.forEach((l, i) => {
      const r = term.children[i];
      if (r.textContent !== l) r.textContent = l || " ";
      r.classList.toggle("lj-hl", /^\s*❯/.test(l));
    });
  }
  function fit() {
    for (const t of [macTerm, phoneTerm]) {
      const w = t.clientWidth - 16;
      if (w <= 0) continue;
      t.style.fontSize = `${Math.max(7, Math.min(12.5, w / (cols * 0.62)))}px`;
    }
  }

  // The relay's log and lane.
  function fly(kind, dir, size) {
    if (reduce.matches || !visible) return;
    const p = el("span", `lj-pkt lj-pkt-${kind}`);
    const w = Math.max(6, Math.min(48, Math.round(size / 6)));
    p.style.width = `${w}px`;
    lane.append(p);
    const span = Math.max(0, lane.clientWidth - w - 2);
    const from = dir === "d2m" ? span : 0, to = dir === "d2m" ? 0 : span;
    const a = p.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: FLY_MS, easing: "cubic-bezier(.3,.7,.4,1)" });
    a.onfinish = () => p.remove();
    a.oncancel = () => p.remove();
  }

  function logEvent(e) {
    const li = el("li", "lj-ev");
    const bad = !e.ok && !!e.note;
    li.dataset.kind = bad ? "bad" : e.kind === "push" ? "push" : e.dir;
    const route = e.kind === "push" ? "mac → push service" : e.dir === "d2m" ? `${v?.device || "phone"} → mac` : "mac → phone";
    const head = el("p", "lj-ev-head");
    head.append(el("span", "lj-ev-t", secs(e.t)), el("span", "lj-ev-route", route));
    if (e.box) head.append(el("span", "lj-ev-size", bytes(e.box)));
    li.append(head);
    if (e.kind === "push" && e.push) {
      const p = e.push;
      const bits = [p.status];
      if (p.prompt) bits.push(`"${p.prompt}"`);
      else if (p.lastLine) bits.push(`"${p.lastLine}"`);
      if (p.choices?.length) bits.push(p.choices.map((c) => c.label).join(" / ") + ", signed");
      li.append(el("p", "lj-ev-body", bits.join(" · ")));
    } else if (e.head) {
      li.append(el("p", "lj-ev-body lj-hex", `${e.head}…`));
    }
    if (e.note) li.append(el("p", "lj-ev-note", e.note.replace(/^; /, "")));
    if (!reduce.matches) li.classList.add("lj-in");
    log.prepend(li);
    while (log.children.length > MAX_LOG) log.lastChild.remove();
  }

  function narrate(e) {
    if (e.kind === "push" && e.push?.status === "waiting") {
      const p = e.push;
      const n = p.choices?.length || 0;
      status.textContent = e.ok
        ? `lj read the settled screen: waiting${p.prompt ? ` on "${p.prompt}"` : ""}${n ? `, ${n} signed ${n === 1 ? "button" : "buttons"}` : ", no buttons, so type a line"}.`
        : `The relay rewrote a button: its signature fails on the phone, which offers "open the app to answer" instead.`;
    } else if (e.dir === "d2m" || e.kind === "replay" || e.kind === "inject") {
      status.textContent = `${e.kind === "choose" ? "Your tap" : e.kind === "in" ? "Your line" : e.kind === "replay" ? "A replayed frame" : "Injected keystrokes"}: ${e.note}.`;
    } else if (e.note && !e.ok) {
      status.textContent = `Frame ${fmt(e.n)}: ${e.note.replace(/^; /, "")}.`;
    }
  }

  // Lock Screen card, from the last push the phone verified.
  // Only a new push repaints: rebuilding the buttons would drop keyboard focus.
  function paintCard(c) {
    const key = JSON.stringify(c ?? null);
    if (key === shownCard) return;
    shownCard = key;
    cardBtns.replaceChildren();
    if (!c) {
      delete card.dataset.state;
      cardStatus.textContent = "–";
      cardText.textContent = "pairing…";
      return;
    }
    const waiting = c.status === "waiting";
    card.dataset.state = c.status;
    cardStatus.textContent = waiting ? "needs you" : c.status;
    cardText.textContent = waiting ? (c.prompt || "waiting") : (c.lastLine || "working");
    if (!waiting) return;
    if (!c.choices?.length) {
      cardBtns.append(el("span", "lj-card-hint", "open the app to answer: type below"));
      return;
    }
    c.choices.forEach((ch, i) => {
      const b = button(ch.ok ? ch.label : "open the app to answer", ch.ok ? "lj-tap" : "lj-tap secondary");
      b.disabled = !ch.ok;
      b.dataset.i = String(i);
      if (!ch.ok) b.title = `"${ch.label}" failed its signature`;
      b.addEventListener("click", () => tap(i, false).catch(fail));
      cardBtns.append(b);
    });
  }

  function apply(r, animate) {
    v = r;
    cols = r.cols;
    const evs = r.events || [];
    for (const e of evs) {
      if (e.kind === "out" || e.kind === "size") { if (animate) fly("m2d", "m2d", e.box); }
      else if (e.kind === "push") { if (animate) fly("push", "m2d", 20); }
      else if (animate && e.box) fly(e.ok ? "d2m" : "bad", "d2m", e.box);
      if (e.kind !== "out" || !e.ok) logEvent(e);
      narrate(e);
    }
    const outs = evs.filter((e) => e.kind === "out" && e.ok);
    if (outs.length) logOuts(outs);
    const delay = animate ? FLY_MS : 0;
    const dIn = animate && evs.some((e) => e.dir === "d2m" && e.kind !== "out") ? FLY_MS : 0;
    const g = gen;
    const paintMac = () => { if (g === gen) paint(macTerm, r.mac); };
    const paintPhone = () => { if (g === gen) { paint(phoneTerm, r.phone); paintCard(r.card); } };
    if (dIn) setTimeout(paintMac, dIn); else paintMac();
    if (delay) setTimeout(paintPhone, dIn + delay); else paintPhone();
    const k = r.card?.status === "waiting" ? `${r.card.promptID}` : "";
    if (k !== waitKey) { waitKey = k; waitSince = k ? r.t : null; autoUsed = 0; }
  }

  // Output frames go in the log as one line per call, so a spinner doesn't flood it.
  function logOuts(outs) {
    const box = outs.reduce((a, e) => a + e.box, 0);
    const e = outs[outs.length - 1];
    logEvent({ t: e.t, kind: "out", dir: "m2d", ok: true, box, head: outs.length > 1 ? `${outs.length} frames, last ${e.head}` : e.head });
  }

  function paintPair(p) {
    pair.replaceChildren();
    const item = (k, val, good) => {
      const li = el("li");
      li.append(el("span", "lj-pk", k), el("span", good === false ? "lj-pv lj-bad" : "lj-pv", val));
      pair.append(li);
    };
    item("mac key", `${p.machinePub}…`);
    item("phone key", `${p.phonePub}…`);
    item("proof", p.trusted ? `${p.proofBytes} B, checked` : "failed", p.trusted);
    item("swapped key", p.swappedTrusted ? "accepted" : "refused", !p.swappedTrusted);
    item("pair key", p.pairKeysMatch ? `same on both, ${p.pairKey}…` : "differs", p.pairKeysMatch);
    item("session key", p.sessionKeysMatch ? `wrapped in ${bytes(p.wrapped)}, opened` : "failed", p.sessionKeysMatch);
  }

  function updateDom(force) {
    const now = performance.now();
    if (!force && now - lastDom < 150) return;
    lastDom = now;
    if (!v) return;
    const s = v.stats;
    cell.t.textContent = secs(v.t);
    cell.m2d.textContent = fmt(s.m2d);
    cell.d2m.textContent = fmt(s.d2m);
    cell.pty.textContent = bytes(s.ptyBytes);
    cell.plain.textContent = bytes(s.plainBytes);
    cell.sealed.textContent = bytes(s.sealedBytes);
    cell.prompts.textContent = fmt(s.prompts);
    cell.answered.textContent = fmt(s.answered);
    cell.blocked.textContent = fmt(s.blocked);
    cell.rtt.textContent = rtt === null ? "–" : `${rtt.toFixed(1)} ms`;
    const q = Math.min(v.quietMs, v.idleMs);
    gateBar.style.transform = `scaleX(${Math.max(0.001, q / v.idleMs)})`;
    gate.dataset.on = v.quietMs >= v.idleMs ? "1" : "";
    gateText.textContent = v.quietMs >= v.idleMs ? `screen settled, lj reads it` : `screen quiet ${secs(q)} of ${secs(v.idleMs)}`;
    macTerm.setAttribute("aria-label", `Mac terminal at ${secs(v.t)}: ${v.mac.filter(Boolean).slice(-3).join(" / ")}`);
    phoneTerm.setAttribute("aria-label", `Phone's copy of the terminal, decrypted: ${v.phone.filter(Boolean).slice(-3).join(" / ")}`);
    receipt.textContent = `${plural(s.m2d + s.d2m, "frame")} sealed and opened, ${plural(s.prompts, "prompt")} read off the screen and ${fmt(s.blocked)} refused by lj's own code, over ${plural(calls, "call")} and ${fmt(Math.round(callMs))} ms.`;
    const mode = v.mode;
    line.placeholder = mode === "ask" ? "type your answer" : mode === "yesno" ? "y or n" : "type a line";
    attackBtn.replay.disabled = s.d2m === 0;
  }

  const fail = (err) => { status.textContent = err.message; };

  async function restart() {
    gen++;
    const g = gen;
    callMs = 0; calls = 0; rtt = null; pending = 0; waitKey = ""; waitSince = null;
    log.replaceChildren();
    paintCard(null);
    status.textContent = "";
    const { r } = await exec("start", { seed: 1, cols: 46, rows: 13 });
    if (g !== gen) return;
    macHead.querySelector(".lj-cmd").textContent = `lj run -- ${r.command}`;
    card.querySelector(".lj-card-cmd").textContent = r.command;
    paintPair(r.pairing);
    fit();
    apply(r, false);
    if (reduce.matches) {
      // One finished state: play on to the first question and stop there.
      for (let i = 0; i < 40 && v.card?.status !== "waiting"; i++) {
        const { r: a, g: g2 } = await exec("advance", { ms: 1000 });
        if (g2 !== gen) return;
        apply(a, false);
      }
      status.textContent = "Paused on the first question: tap an answer, or press Play.";
    }
    updateDom(true);
  }

  async function advance(ms, animate) {
    const { r, g } = await exec("advance", { ms });
    if (g !== gen) return;
    apply(r, animate);
    updateDom(false);
  }

  async function tap(i, byAuto) {
    const { r, ms, g } = await exec("answer", { i });
    if (g !== gen) return;
    rtt = ms;
    apply(r, !reduce.matches);
    if (byAuto) status.textContent = `Answered for you after ${secs(AUTO_MS, 0)}: ${status.textContent}`;
    updateDom(true);
    kick();
  }

  async function typeLine(text, byAuto) {
    text = text.trim();
    if (!text) { status.textContent = "Type something to send."; return; }
    const { r, ms, g } = await exec("type", { text });
    if (g !== gen) return;
    rtt = ms;
    if (!byAuto) line.value = "";
    apply(r, !reduce.matches);
    if (byAuto) status.textContent = `Typed "${text}" for you: ${status.textContent}`;
    updateDom(true);
    kick();
  }

  async function attack(k) {
    const { r, g } = await exec("attack", { kind: k });
    if (g !== gen) return;
    apply(r, !reduce.matches);
    if (k === "flip") status.textContent = "The relay will flip one bit of the next output frame.";
    if (k === "relabel" && !(r.card?.status === "waiting" && r.card.choices?.length)) status.textContent = "The relay will rewrite the next button it carries.";
    updateDom(true);
    kick();
  }

  // The visitor's stand-in: once a question has waited 6 s of sim time, answer it the way a person might.
  function autopilot() {
    if (!auto.checked || !v || waitSince === null || autoUsed || busy) return;
    if (v.t - waitSince < AUTO_MS) return;
    autoUsed = 1;
    const c = v.card;
    const i = c.choices?.findIndex((ch) => ch.ok) ?? -1;
    if (c.choices?.length) { if (i >= 0) tap(i, true).catch(fail); }
    else typeLine(LINES[v.stats.answered % LINES.length], true).catch(fail);
  }

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && v) {
      pending += dt * Number(speed.value);
      if (!busy && pending >= 50) {
        const ms = Math.min(2000, Math.round(pending));
        pending -= ms;
        advance(ms, true).catch(fail);
      }
      autopilot();
    }
    updateDom(false);
    if (playing && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

  function setPlaying(on) {
    playing = on;
    play.textContent = on ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(on));
    if (on) kick();
  }

  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => { setPlaying(false); advance(1000, !reduce.matches).then(() => updateDom(true)).catch(fail); });
  reset.addEventListener("click", () => restart().then(kick).catch(fail));
  for (const [k] of ATTACKS) attackBtn[k].addEventListener("click", () => attack(k).catch(fail));
  send.addEventListener("click", () => typeLine(line.value, false).catch(fail));
  line.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); typeLine(line.value, false).catch(fail); } });

  new ResizeObserver(() => { if (root.isConnected) fit(); }).observe(stage);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; kick(); }).observe(stage);
  document.addEventListener("visibilitychange", kick);
  reduce.addEventListener("change", () => setPlaying(playing && !reduce.matches));

  await cssReady;
  await restart();
  setPlaying(playing);
}
