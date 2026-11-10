// The arena: a game on the home page, played on netcode's real server and
// rollback clients (the netcode demo's binary, in a worker). Six players on
// simulated 60 Hz ticks, every datagram through netcode's codec and lag
// simulator. Flags appear in the arena; a flag is taken when a player's
// position ON THE SERVER reaches it, so on a slow link your own screen gets
// there first and the server agrees later. The flags, the tally and the
// autopilot are this page's; every position, rollback and hash check comes
// from the binary. Until Play is pressed an autopilot steers player 0 (it
// starts on its own only where the stage would); Play hands player 0 over
// for 45 seconds of ticks, after a count of three. Trails, bursts and the
// end card are drawing only; they stand down under reduced motion.
import { connect } from "/assets/demo.js";

const root = document.querySelector("[data-arena]");
const TICK_MS = 1000 / 60;
const GAME_TICKS = 45 * 60;
const PLAYERS = 6;
const SEED = 1;
const FLAGS = 3;
const REACH = 24;
const FX_MS = 500;
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, DASH = 16;
const KEYS = { ArrowUp: UP, KeyW: UP, ArrowDown: DOWN, KeyS: DOWN, ArrowLeft: LEFT, KeyA: LEFT, ArrowRight: RIGHT, KeyD: RIGHT, Space: DASH };
const COMPASS = [RIGHT, RIGHT | DOWN, DOWN, DOWN | LEFT, LEFT, LEFT | UP, UP, UP | RIGHT];

if (root) {
  const slug = root.dataset.arena;
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const key = root.querySelector("[data-play]");
  const out = root.querySelector("[role=status]");
  const links = [...root.querySelectorAll("[data-link]")];
  const dial = (k) => root.querySelector(`[data-k=${k}]`);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const net = navigator.connection;
  const lean = net?.saveData || /(^|-)(2g|3g)$/.test(net?.effectiveType || "") || (navigator.hardwareConcurrency || 4) < 4;
  const fmt = (n) => n.toLocaleString("en-US");
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;
  const hashes = (n) => `${fmt(n)} state hash${n === 1 ? "" : "es"}`;

  let demo = null;
  let booting = null;
  let view = null;
  let playing = false;
  let visible = false;
  let busy = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let flags = [];
  let fx = [];
  let score = { you: 0, bots: 0 };
  let from = null;
  let held = 0;
  let dash = false;
  let aim = null;
  let byKeys = false;
  let col = null;
  let rnd = SEED;
  let starting = 0;
  let over = null;
  let bits = [];
  const trails = new Map();
  const COUNT_MS = 700;
  const TRAIL = 18;
  const CARD_MS = 4200;

  // The page's own draw for where flags go (mulberry32), so a run is repeatable.
  const rand = () => {
    rnd = (rnd + 0x6d2b79f5) | 0;
    let t = Math.imul(rnd ^ (rnd >>> 15), 1 | rnd);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const link = () => {
    const b = links.find((x) => x.getAttribute("aria-pressed") === "true") ?? links[0];
    return { name: b.textContent, latency_ms: Number(b.dataset.lat), jitter_ms: Number(b.dataset.jit), loss_pct: Number(b.dataset.loss) };
  };
  const wire = ({ latency_ms, jitter_ms, loss_pct }) => ({ latency_ms, jitter_ms, loss_pct });
  const me = () => view?.clients[0].me;
  const set = (k, v) => {
    const d = dial(k);
    if (d.textContent === v) return;
    d.textContent = v;
    // A tally pops when it counts.
    if (!reduced && (k === "you" || k === "bots") && v !== "0") d.animate([{ scale: 1.4 }, { scale: 1 }], { duration: 280, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  };
  const say = (text) => { out.textContent = text; };

  function colors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    col = { floor: v("--screen"), ink: v("--screen-ink"), dim: v("--screen-dim"), ok: v("--screen-ok"), signal: v("--screen-signal"), you: v("--block"), sans: v("--sans") || "sans-serif", display: v("--display") || "sans-serif" };
  }
  colors();
  addEventListener("themechange", colors);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", colors);

  // A flag lands on the one of eight draws that is farthest from every bot,
  // so most flags are a race and not a gift (with player 0 idle the bots took
  // 18 to 22 in 45 s that way, 22 to 37 with a single draw; measured).
  const plant = () => {
    const m = 56, span = view.arena - 2 * m;
    let best = null, far = -1;
    for (let i = 0; i < 8; i++) {
      const f = { x: m + rand() * span, y: m + rand() * span, t0: performance.now() };
      const d = Math.min(...view.players.filter(([id]) => id !== 0).map(([, x, y]) => Math.hypot(x - f.x, y - f.y)));
      if (d > far) { far = d; best = f; }
    }
    return best;
  };

  // The server's positions decide who took a flag.
  function judge() {
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      const by = view.players.find(([, x, y]) => Math.hypot(x - f.x, y - f.y) <= REACH);
      if (!by) continue;
      if (by[0] === 0) score.you++; else score.bots++;
      const t0 = performance.now(), you = by[0] === 0;
      fx.push({ x: f.x, y: f.y, t0, you });
      if (!reduced) for (let b = 0; b < 12; b++) bits.push({ x: f.x, y: f.y, a: (b / 12) * Math.PI * 2 + rand(), v: 0.6 + rand() * 1.1, t0, you });
      flags[i] = plant();
    }
    root.dataset.taken = String(score.you + score.bots);
    if (playing && view.tick - from.tick >= GAME_TICKS) finish(true);
  }

  function readouts() {
    const c = view.clients[0];
    set("you", fmt(score.you));
    set("bots", fmt(score.bots));
    const left = playing ? Math.max(0, GAME_TICKS - (view.tick - from.tick)) : GAME_TICKS;
    const secs = Math.ceil(left / 60);
    set("time", `0:${String(secs).padStart(2, "0")}`);
    set("rollbacks", fmt(c.rollbacks - (from?.rollbacks ?? 0)));
    set("desyncs", fmt(view.check.desyncs));
    // Hooks for tests: the server's tick and where this client has player 0.
    root.dataset.tick = String(view.tick);
    if (c.me) root.dataset.x = String(Math.round(c.me[0]));
    root.toggleAttribute("data-late", playing && left <= 300);
    // Where each player has been, for the trails.
    const mark = (id, x, y) => { const t = trails.get(id) ?? []; t.push([x, y]); if (t.length > TRAIL) t.shift(); trails.set(id, t); };
    if (c.me) mark(0, c.me[0], c.me[1]);
    for (const [i, x, y] of c.others) mark(i, x, y);
  }

  // Which buttons to hold this step: the visitor's keys or pointer while
  // playing, otherwise the autopilot heading for the nearest flag.
  function buttons() {
    if (starting) return 0;
    const at = me();
    let to = aim;
    if (playing && byKeys) {
      const b = held | (dash ? DASH : 0);
      dash = false;
      return b;
    }
    if (!playing && at) {
      to = flags.reduce((best, f) => (!best || Math.hypot(f.x - at[0], f.y - at[1]) < Math.hypot(best.x - at[0], best.y - at[1]) ? f : best), null);
    }
    if (!at || !to) return 0;
    const dx = to.x - at[0], dy = to.y - at[1];
    const b = Math.hypot(dx, dy) < 10 ? 0 : COMPASS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    const d = playing && dash ? DASH : 0;
    dash = false;
    return b | d;
  }

  function draw(now) {
    const size = canvas.clientWidth;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(size * dpr)) canvas.width = canvas.height = Math.round(size * dpr);
    const k = (size * dpr) / view.arena;
    const r = view.radius * k;
    const c = view.clients[0];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = col.floor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const ring = (x, y, rad, stroke, fill, w = 1.5, dashes = []) => {
      ctx.beginPath();
      ctx.arc(x * k, y * k, rad, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.setLineDash(dashes); ctx.lineWidth = w * dpr; ctx.strokeStyle = stroke; ctx.stroke(); ctx.setLineDash([]); }
    };
    // Flags: a square that settles in.
    for (const f of flags) {
      const a = Math.min(1, (now - f.t0) / 240), s = 7 * dpr * (2 - a);
      ctx.globalAlpha = a;
      ctx.fillStyle = col.signal;
      ctx.fillRect(f.x * k - s, f.y * k - s, 2 * s, 2 * s);
      ctx.globalAlpha = 1;
    }
    // Trails: where each player has been, fading; yours in your colour.
    if (!reduced) {
      ctx.lineCap = "round";
      for (const [id, t] of trails) {
        for (let i = 1; i < t.length; i++) {
          ctx.globalAlpha = (i / t.length) * (id === 0 ? 0.5 : 0.16);
          ctx.beginPath();
          ctx.moveTo(t[i - 1][0] * k, t[i - 1][1] * k);
          ctx.lineTo(t[i][0] * k, t[i][1] * k);
          ctx.lineWidth = r * 1.6 * (i / t.length);
          ctx.strokeStyle = id === 0 ? col.you : col.dim;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    // The other players as this client draws them (interpolated in the past).
    ctx.font = `400 ${11 * dpr}px ${col.sans}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [i, x, y] of c.others) {
      ring(x, y, r, col.dim, "rgb(255 255 255 / 0.06)");
      ctx.fillStyle = col.dim;
      ctx.fillText(String(i), x * k, y * k);
    }
    // You: where the server has you (dashed), where your screen has you (filled).
    const mine = c.me, auth = view.players.find(([id]) => id === 0);
    if (auth && mine) {
      ctx.beginPath();
      ctx.moveTo(auth[1] * k, auth[2] * k);
      ctx.lineTo(mine[0] * k, mine[1] * k);
      ctx.lineWidth = dpr;
      ctx.strokeStyle = col.signal;
      ctx.stroke();
      ring(auth[1], auth[2], r, col.signal, null, 1.5, [4 * dpr, 4 * dpr]);
    }
    if (mine) ring(mine[0], mine[1], r, col.ink, col.you, 2);
    // A rollback: the correction, from where the client had you to where it put you.
    const rb = c.last_rollback;
    if (rb && rb.ago < 12) {
      ctx.globalAlpha = 1 - rb.ago / 12;
      ctx.beginPath();
      ctx.moveTo(rb.from[0] * k, rb.from[1] * k);
      ctx.lineTo(rb.to[0] * k, rb.to[1] * k);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = col.ok;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // A flag taken: a ring where it was, green for yours.
    fx = fx.filter((f) => now - f.t0 < FX_MS);
    for (const f of fx) {
      const a = (now - f.t0) / FX_MS;
      ctx.globalAlpha = 1 - a;
      ring(f.x, f.y, (10 + 26 * a) * dpr, f.you ? col.ok : col.dim, null, 2);
      if (f.you) {
        ctx.fillStyle = col.ok;
        ctx.font = `800 ${18 * dpr}px ${col.display}`;
        ctx.fillText("+1", f.x * k, f.y * k - (18 + 30 * a) * dpr);
      }
      ctx.globalAlpha = 1;
    }
    // The burst of a taken flag: squares thrown outward, slowing.
    bits = bits.filter((b) => now - b.t0 < FX_MS * 1.4);
    for (const b of bits) {
      const a = (now - b.t0) / (FX_MS * 1.4), d = 46 * b.v * (1 - (1 - a) ** 2) * dpr, s = 3.5 * dpr * (1 - a);
      ctx.globalAlpha = 1 - a;
      ctx.fillStyle = b.you ? col.ok : col.signal;
      ctx.fillRect(b.x * k + Math.cos(b.a) * d - s, b.y * k + Math.sin(b.a) * d - s, 2 * s, 2 * s);
    }
    ctx.globalAlpha = 1;
    const mid = canvas.width / 2;
    const veil = (alpha) => { ctx.globalAlpha = alpha; ctx.fillStyle = col.floor; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; };
    // The count before a game: three, two, one.
    if (starting) {
      const t = now - starting, n = 3 - Math.floor(t / COUNT_MS), a = (t % COUNT_MS) / COUNT_MS;
      if (n < 1) { begin(); return; }
      veil(0.45);
      ctx.globalAlpha = reduced ? 1 : 1 - a * a;
      ctx.fillStyle = col.ink;
      ctx.font = `800 ${(reduced ? 150 : 150 + 90 * (1 - a)) * dpr}px ${col.display}`;
      ctx.fillText(String(n), mid, mid);
      ctx.globalAlpha = 1;
    }
    // The end card: the count, large, over the match as it carries on.
    if (over) {
      const t = now - over.t0;
      if (t > CARD_MS) { over = null; return; }
      const a = Math.min(1, t / 240) * Math.min(1, (CARD_MS - t) / 400);
      veil(0.62 * a);
      ctx.globalAlpha = a;
      ctx.fillStyle = col.ink;
      ctx.font = `800 ${170 * dpr}px ${col.display}`;
      ctx.fillText(fmt(over.you), mid, mid - 24 * dpr);
      ctx.font = `400 ${17 * dpr}px ${col.sans}`;
      ctx.fillStyle = col.dim;
      ctx.fillText(`${over.you === 1 ? "flag" : "flags"} in 45 seconds · the bots took ${fmt(over.bots)}`, mid, mid + 84 * dpr);
      ctx.globalAlpha = 1;
    }
  }

  const active = () => demo && view && visible && !document.hidden;
  function frame(now) {
    raf = 0;
    if (!active()) return;
    // A frame's timestamp can sit just before the clock read that woke the loop.
    acc = Math.min(acc + Math.min(Math.max(now - last, 0), 100), 6 * TICK_MS);
    last = now;
    const n = Math.floor(acc / TICK_MS);
    if (n && !busy) {
      acc -= n * TICK_MS;
      busy = true;
      demo.call("step", { ticks: n, buttons: buttons() }).then((v) => { view = v; judge(); readouts(); }, fail).finally(() => { busy = false; });
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf && active()) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  function fail(err) {
    demo?.close();
    demo = null;
    booting = null;
    view = null;
    playing = false;
    delete root.dataset.live;
    delete root.dataset.playing;
    key.textContent = "Try again";
    say(err.message);
  }

  // Loads the binary, starts a match on the chosen link and steps it until
  // client 0 has joined, so the first frame drawn has every player in it.
  function boot() {
    booting ??= (async () => {
      say("Loading netcode…");
      const d = await connect(slug);
      let v = await d.call("new", { seed: SEED, players: PLAYERS, ...wire(link()) });
      for (let i = 0; i < 60 && !v.clients[0].me; i++) v = await d.call("step", { ticks: 10, buttons: 0 });
      demo = d;
      view = v;
      rnd = SEED;
      flags = Array.from({ length: FLAGS }, plant);
      root.dataset.live = "";
      say("The autopilot has player 0. Press Play to take over.");
      readouts();
      wake();
    })();
    return booting.catch(fail);
  }

  function finish(full) {
    const c = view.clients[0], l = link();
    playing = false;
    starting = 0;
    held = 0;
    delete root.dataset.playing;
    delete root.dataset.late;
    key.textContent = "Play again";
    for (const b of links) b.disabled = false;
    if (!full) { say("Stopped. The autopilot has player 0 again."); from = null; readouts(); return; }
    let best = 0;
    try { best = Number(localStorage.getItem("arena-best")) || 0; } catch { /* storage is optional */ }
    const record = score.you > best;
    if (record) try { localStorage.setItem("arena-best", String(score.you)); } catch { /* storage is optional */ }
    const mark = record && best ? `, past your best of ${fmt(best)}` : !record && best ? ` (your best is ${fmt(best)})` : "";
    over = { t0: performance.now(), you: score.you, bots: score.bots };
    say(`You took ${plural(score.you, "flag")}${mark}; the bots took ${fmt(score.bots)}. Link: ${l.name}. In those 45 seconds your client rolled back ${plural(c.rollbacks - from.rollbacks, "time")}, and the server compared ${hashes(view.check.matches - from.matches)} and found ${plural(view.check.desyncs, "desync")}.`);
    root.dataset.over = "";
  }

  // The game proper: the tally and the clock start when the count ends.
  function begin() {
    starting = 0;
    score = { you: 0, bots: 0 };
    from = { tick: view.tick, rollbacks: view.clients[0].rollbacks, matches: view.check.matches };
    playing = true;
    byKeys = false;
    aim = null;
    root.dataset.playing = "";
    readouts();
  }
  key.addEventListener("click", async () => {
    if (playing || starting) { finish(false); return; }
    key.disabled = true;
    await boot();
    key.disabled = false;
    if (!demo) return;
    over = null;
    delete root.dataset.over;
    key.textContent = "Stop";
    for (const b of links) b.disabled = true;
    say("");
    canvas.focus({ preventScroll: true });
    starting = performance.now();
    wake();
  });

  for (const b of links) {
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-pressed") === "true") return;
      for (const o of links) o.setAttribute("aria-pressed", String(o === b));
      if (demo) view = await demo.call("lag", wire(link())).catch(fail) ?? view;
    });
  }

  // Keys steer while the arena has focus; the pointer steers toward itself.
  canvas.addEventListener("keydown", (e) => {
    if (!(playing || starting) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Escape") { finish(false); return; }
    if (!playing) return;
    const bit = KEYS[e.code];
    if (!bit) return;
    e.preventDefault();
    byKeys = true;
    if (bit === DASH) dash = !e.repeat || dash; else held |= bit;
  });
  canvas.addEventListener("keyup", (e) => { held &= ~(KEYS[e.code] ?? 0); });
  canvas.addEventListener("blur", () => { held = 0; });
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    aim = { x: ((e.clientX - r.left) / r.width) * view.arena, y: ((e.clientY - r.top) / r.height) * view.arena };
    byKeys = false;
  };
  canvas.addEventListener("pointermove", (e) => { if (playing && view) point(e); });
  canvas.addEventListener("pointerdown", (e) => {
    if (!playing || !view) return;
    point(e);
    dash = e.pointerType !== "touch" || dash;
  });
  // A touch steers by dragging; a second finger, or a quick tap, dashes.
  canvas.addEventListener("pointerup", (e) => { if (playing && e.pointerType === "touch") dash = true; });

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !demo && !reduced && !lean) boot();
    wake();
  }, { threshold: 0.35 }).observe(canvas);
  document.addEventListener("visibilitychange", wake);
}
