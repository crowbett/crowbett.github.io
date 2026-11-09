// stash demo: stash's FastCDC chunker, keyed BLAKE3 ids and zstd + XChaCha20-Poly1305
// packs, compiled to WebAssembly. A small file tree changes day by day; every file goes
// through the binary's backup each snapshot, so the strips are its chunk boundaries, the
// grid is the repository's unique chunks, and only new chunks fly in and get sealed.
const SPEEDS = [1, 2, 4];
const SNAP_MS = 1800;
const FLY_MS = 300;
const GROW_MS = 250;
const WARM = 3;
const SCRIPT_DAYS = 12;
const MAX_DAYS = 36;
const ROWS = 6;
const NOTES = "notes/harbour-log.md", ARCH = "archive/harbour-log-2026-10.md", CONF = "config/stash.toml",
  LOGF = "logs/web-1.log", CSV = "data/stock.csv";
const enc = new TextEncoder();
const blen = (s) => enc.encode(s).length;

const PROSE = `Harbour log, kept at the north light.

Day 1. Wind from the north-west, force five, backing west by evening. The relief boat came at noon with oil, flour, two crates of lamp mantles and a letter for the keeper that he put in his coat without opening.

Day 2. Fog from first light until the afternoon. Sounded the horn every ninety seconds for six hours. The gulls stood on the gallery rail and complained about it in a single long chorus.

Day 3. Cleaned the lens, all eight panels, with spirit and soft cloth. A hairline crack in the third panel has not grown since it was marked in the spring. Measured it twice to be sure.

Day 4. Clear and cold. Counted eleven fishing boats out past the reef before dawn and eleven back by dark. The keeper says that is the only count that matters on this coast.

Day 5. Painted the north side of the tower where the salt had lifted the whitewash. Ran out of paint a metre short of the doorway, so the door now wears a grey collar.

Day 6. Storm overnight. Rain came under the lantern room door and froze on the stairs. Spread ash on the steps at four in the morning and wound the clockwork twice by hand.

Day 7. The letter was from his sister. He read it at supper, folded it into the log book between the pages for March, and asked whether the flour had been the coarse kind or the fine.

Day 8. Calm. Took the dinghy round to the cove and brought back driftwood, a fishing float of green glass and a boot, which the keeper says belonged to the previous assistant.

Day 9. Oil delivery short by one drum. Wrote it in the margin and in the letter to the board, in the same words, so that nobody can say the two records disagree.

Day 10. Light lit at 16:42, extinguished at 07:51. Visibility twenty miles. Nothing to report, which is the best thing a log can say.

Day 11. Rain all day, straight down, no wind at all. Rewound the spare clockwork, oiled the gears and found a sparrow's nest in the old fog bell, which we left where it was.

Day 12. The keeper taught me to read the barometer by tapping the glass and watching which way the needle leans before it settles. He says the lean is the forecast and the number is only gossip.

Day 13. Supply boat turned back at the reef because of the swell. Counted the flour: nine days at the usual rate, twelve if the keeper stops making bread for the gulls.

Day 14. Boat came. Coarse flour, as it happens. The keeper said nothing about it, but he wrote the word coarse in the margin and underlined it twice.

Day 15. Repainted the doorway. The grey collar is gone. Somebody on the mainland will have to find another way to tell the doors apart.

Day 16. A yacht anchored in the cove overnight, then left at dawn without coming ashore. Logged her name, her rig and her heading, as we log everything that passes.

Day 17. Gale warning from the radio at noon. Lashed the dinghy, filled every lamp and laid out dry socks by the stove, which is the part of storm preparation nobody writes down.

Day 18. Gale. The tower hummed all night. The light never missed a turn.

Day 19. After the gale, the reef was white for an hour and then went quiet, as if nothing had happened. The keeper says that is how the sea apologises.

Day 20. End of the month. Copied the log into the fair book for the board, page for page, so that the two agree to the letter.
`;

const CODE = `//! Beacon controller for the north light: one flash group every period,
//! timed from the clockwork and logged for the board.

/// Fl(2) W 10s: two white flashes every ten seconds.
pub const PERIOD_MS: u32 = 10_000;
pub const FLASH_MS: u32 = 500;
pub const ECLIPSE_MS: u32 = 1_500;
pub const FLASHES: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lamp { Lit, Dark }

pub struct Beacon {
    started_ms: u64,
    fog: bool,
    turns: u64,
}

impl Beacon {
    pub fn new(started_ms: u64) -> Self {
        Self { started_ms, fog: false, turns: 0 }
    }

    /// Where the lamp is in its period at \`now_ms\`.
    pub fn lamp(&self, now_ms: u64) -> Lamp {
        let t = ((now_ms - self.started_ms) % PERIOD_MS as u64) as u32;
        for k in 0..FLASHES {
            let on = k * (FLASH_MS + ECLIPSE_MS);
            if t >= on && t < on + FLASH_MS {
                return Lamp::Lit;
            }
        }
        Lamp::Dark
    }

    /// Sounds the horn every ninety seconds while fog is set.
    pub fn horn_due(&self, now_ms: u64) -> bool {
        self.fog && (now_ms - self.started_ms) % 90_000 < 3_000
    }

    pub fn set_fog(&mut self, fog: bool) {
        self.fog = fog;
    }

    pub fn tick(&mut self, now_ms: u64) {
        if self.lamp(now_ms) == Lamp::Lit {
            self.turns += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_flashes_then_dark() {
        let b = Beacon::new(0);
        assert_eq!(b.lamp(0), Lamp::Lit);
        assert_eq!(b.lamp(600), Lamp::Dark);
        assert_eq!(b.lamp(2_100), Lamp::Lit);
        assert_eq!(b.lamp(9_000), Lamp::Dark);
    }
}
`;

const METHOD = `
    /// Turns of the lamp since it was lit, for the monthly return.
    pub fn turns(&self) -> u64 {
        self.turns
    }
`;

const CONFIG = `# stash settings for the north light
[repository]
path = "/mnt/share/stash/northlight"
compression = "zstd"
level = 3

[backup]
paths = ["notes", "src", "config", "logs", "data"]
exclude = ["*.tmp", "target/", ".cache/"]
one_file_system = true

[forget]
keep_daily = 7
keep_weekly = 4
keep_monthly = 12
`;

const ENTRIES = [
  "Wind backing south-west. Trimmed the wicks and topped up the reservoir before dusk.",
  "Supply boat on time. Oil, flour and a parcel of newspapers three weeks old, read twice anyway.",
  "Fog at dawn, clear by ten. Sounded the horn for two hours and logged every blast.",
  "Gale warning at noon. Lashed the dinghy, filled every lamp and laid out dry socks by the stove.",
];
const NOTE = "Note for the board. From this month the log is backed up nightly to the share on the mainland, so a lost book costs a day, not a season.\n\n";
const ITEMS = ["lamp mantle", "wick 2in", "paraffin drum", "lens cloth", "brass polish", "flour coarse", "flour fine", "horn reed", "storm lantern", "rope 20m"];
const REQS = ["GET /api/orders 200 12ms", "GET /api/stock?sku=8811 200 4ms", "POST /api/orders 201 38ms", "GET /healthz 200 1ms",
  "PUT /api/orders/4417 409 9ms", "GET /api/users/me 200 6ms"];
const hash = (a, b) => (Math.imul(a, 2654435761) ^ Math.imul(b + 7, 40503)) >>> 0;

function logLines(w, n) {
  let s = "";
  for (let k = 0; k < n; k++, w.lines++) {
    const i = w.lines;
    const at = new Date(Date.UTC(2026, 9, 1) + i * 97000).toISOString().slice(0, 19);
    s += `${at}Z web-${(i % 3) + 1} ${REQS[(i * 5) % REQS.length]} req=${hash(i, 1).toString(16).padStart(8, "0")}\n`;
  }
  return s;
}
const csv = (w) => "sku,item,qty,bin\n" + w.qty.map((q, i) => `NL-${1000 + i},${ITEMS[i % ITEMS.length]},${q},${"ABCD"[i % 4]}-${(i % 9) + 1}\n`).join("");

function world() {
  const w = { lines: 0, qty: Array.from({ length: 90 }, (_, i) => (i * 37) % 90 + 5), code: "src/beacon.rs", tree: new Map(), day: 0, entry: 0 };
  w.tree.set(NOTES, PROSE);
  w.tree.set(w.code, CODE);
  w.tree.set(CONF, CONFIG);
  w.tree.set(LOGF, logLines(w, 44));
  w.tree.set(CSV, csv(w));
  return w;
}

// One day of change to the tree; returns what changed, in words.
function mutate(w) {
  const d = ++w.day, t = w.tree, said = [];
  if (d === 1) return "first snapshot: every chunk is new";
  const edit = (path, f, what) => {
    const a = t.get(path);
    if (a === undefined) return;
    const b = f(a);
    if (b !== a) { t.set(path, b); said.push(what); }
  };
  const entry = () => edit(NOTES, (s) => `${s}\nDay ${21 + w.entry}. ${ENTRIES[w.entry++ % ENTRIES.length]}\n`, `${NOTES}: a day appended at the end`);
  if (d === 3) entry();
  if (d === 4) { t.set(ARCH, t.get(NOTES)); said.push(`${NOTES} copied to ${ARCH}`); }
  if (d === 5) edit(w.code, (s) => s.replace("90_000", "60_000").replace("every ninety", "every sixty"), `${w.code}: the horn every 60 s, mid-file`);
  if (d === 6) edit(CONF, (s) => s.replace("keep_daily = 7", "keep_daily = 14"), `${CONF}: keep_daily 7 to 14`);
  if (d === 7) edit(NOTES, (s) => { const i = s.indexOf("\n\n") + 2; return s.slice(0, i) + NOTE + s.slice(i); }, `${NOTES}: a paragraph inserted at the top`);
  if (d === 8) {
    const s = t.get(w.code);
    t.delete(w.code);
    said.push(`${w.code} renamed to src/lamp.rs`);
    w.code = "src/lamp.rs";
    t.set(w.code, s);
  }
  if (d === 9 && t.delete(ARCH)) said.push(`${ARCH} deleted; its chunks stay until prune`);
  if (d === 10) {
    for (let k = 0; k < 12; k++) w.qty.push((hash(d, k) % 60) + 3);
    said.push(`12 rows added to ${CSV}`);
  }
  if (d === 11) edit(NOTES, (s) => { const i = s.indexOf("Day 10."), j = s.indexOf("\n\n", i); return i < 0 || j < 0 ? s : s.slice(0, i) + s.slice(j + 2); }, `${NOTES}: Day 10 deleted from the middle`);
  if (d === 12) edit(w.code, (s) => { const i = s.indexOf("\n", s.indexOf("pub fn set_fog") + 60); return s.slice(0, i + 1) + METHOD + s.slice(i + 1); }, `${w.code}: a method added mid-file`);
  if (d > SCRIPT_DAYS && d % 4 === 1) entry();
  if (d > SCRIPT_DAYS && d % 5 === 0) edit(CONF, (s) => s.replace(/keep_weekly = (\d)/, (_, n) => `keep_weekly = ${n === "4" ? 5 : 4}`), `${CONF}: keep_weekly changed`);
  const n = 5 + ((d * 3) % 5);
  let log = t.get(LOGF) + logLines(w, n);
  said.push(`${n} lines appended to ${LOGF}`);
  if (blen(log) > 9000) {
    log = log.slice(log.indexOf("\n", log.length >> 1) + 1);
    said.push(`${LOGF} rotated, older half dropped`);
  }
  t.set(LOGF, log);
  for (let k = 1; k <= 2; k++) { const i = hash(d, k) % w.qty.length; w.qty[i] = (w.qty[i] + 7 + (hash(d, k + 2) % 40)) % 200; }
  t.set(CSV, csv(w));
  said.push("2 stock counts changed");
  return said.join("; ");
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const B = (n) => `${fmt(n)} B`;
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const kib = (n) => (n >= 1024 ? `${(n / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 })} KiB` : `${n} B`);
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function field(label, input, cls) {
  const f = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  f.append(el("span", "demo-label", label), input);
  return f;
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
// The UTF-16 index where byte offset `b` of `s` falls.
function indexAt(s, b) {
  let i = 0, n = 0;
  while (i < s.length && n < b) {
    const cp = s.codePointAt(i);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
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

  // Controls.
  const avg = select("avg", [[256, "256 B"], [512, "512 B"], [1024, "1 KiB"]], 256);
  const key = select("key", [[1, "key 1"], [2, "key 2"], [3, "key 3"]], 1);
  const speed = select("speed", SPEEDS.map((s) => [s, `${s}×`]), 1);
  const knobs = el("div", "sh-knobs");
  knobs.append(field("average chunk", avg), field("repository key", key), field("speed", speed));
  const play = button("Pause");
  const step = button("Next snapshot", "secondary");
  const reset = button("Reset", "secondary");
  const acts = el("div", "sh-acts");
  acts.append(play, step, reset);
  const mine = el("input");
  Object.assign(mine, { type: "text", name: "mine", value: "Corbett was here, mid-file.", maxLength: 400 });
  mine.setAttribute("autocomplete", "off");
  const into = el("select");
  into.name = "into";
  const insert = button("Insert and back up");
  const you = el("div", "sh-you");
  you.append(field("your text", mine, "sh-grow"), field("into", into), insert);
  const form = el("form", "sh-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.append(knobs, acts, you);

  const day = el("p", "sh-day");
  const canvas = el("canvas", "sh-canvas");
  canvas.setAttribute("role", "img");
  const legend = el("p", "demo-legend sh-legend");
  for (const [k, t] of [["new", "new chunk, sealed into a pack"], ["reused", "reused: linked, not stored"], ["you", "your edit"], ["stored", "bytes stored"]]) {
    const s = el("span", "sh-key", t);
    s.dataset.k = k;
    legend.append(s);
  }
  const youLine = el("p", "sh-yours");
  youLine.setAttribute("aria-live", "polite");
  const snapSel = el("select");
  snapSel.name = "snapshot";
  const restoreBtn = button("Restore", "secondary");
  const flipBtn = button("Flip one bit", "secondary");
  const rrow = el("div", "sh-rrow");
  rrow.append(field("snapshot", snapSel), restoreBtn, flipBtn);
  const fline = el("p", "sh-rline sh-fline");
  fline.setAttribute("aria-live", "polite");
  const rline = el("p", "sh-rline sh-res");
  rline.setAttribute("aria-live", "polite");
  const cells = el("ul", "cells stack sh-cells");
  const cell = {};
  for (const [k, t] of [["snaps", "snapshots"], ["files", "files"], ["logical", "logical"], ["stored", "stored"], ["ratio", "dedup"],
    ["chunks", "unique chunks"], ["fresh", "new this snapshot"], ["ms", "backup time"]]) {
    const li = el("li");
    li.dataset.k = k;
    const v = el("span", "sh-v", "–");
    li.append(el("span", "sh-k", t), v);
    cell[k] = v;
    cells.append(li);
  }
  const receipt = el("p", "demo-out sh-out");
  root.replaceChildren(form, day, canvas, legend, youLine, rrow, fline, rline, cells, receipt);

  // State.
  let w = null, snaps = [], grid = [], cellOf = new Map(), repo = null, flights = [], restored = null, flipped = null, damaged = new Set();
  let gen = 0, chain = Promise.resolve(), callMs = 0, cut = 0, sealed = 0, restores = 0, colors = null, G = null;
  let playing = !reduce.matches, visible = true, pending = 0, last = 0, raf = 0, running = 0, hover = null, pinned = false, warming = false;

  const exec = (method, params) => {
    const g = gen;
    const run = chain.then(async () => {
      if (g !== gen) throw new Error("stale");
      const t0 = performance.now();
      try {
        return await demo.call(method, params);
      } finally {
        callMs += performance.now() - t0;
      }
    });
    chain = run.catch(() => {});
    return run.then((r) => { if (g !== gen) throw new Error("stale"); return r; });
  };

  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = { bg: v("--sunken"), line: v("--line"), strong: v("--line-strong"), text: v("--text"), text2: v("--text-2"), text3: v("--text-3"),
      accent: v("--accent"), signal: v("--signal"), danger: v("--danger"), mono: v("--mono") || "monospace" };
  }

  // Geometry, in CSS pixels.
  function layout() {
    const W = Math.max(280, canvas.clientWidth), pad = 12, wide = W >= 520;
    const nameW = wide ? Math.min(190, Math.round(W * 0.3)) : 0;
    const rowH = wide ? 24 : 30;
    const filesTop = 28, repoTop = filesTop + ROWS * rowH + 30, repoH = wide ? 70 : 84;
    const chartTop = repoTop + repoH + 34, chartH = wide ? 150 : 130, axisL = 44;
    const H = chartTop + chartH + 30;
    G = { W, H, pad, wide, nameW, rowH, filesTop, stripX: pad + nameW, stripW: W - 2 * pad - nameW, repoTop, repoH, chartTop, chartH, axisL };
    canvas.style.height = `${H}px`;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) Object.assign(canvas, { width: cw, height: ch });
  }
  const cur = () => snaps[snaps.length - 1];
  const scaleMax = () => Math.ceil(Math.max(4096, ...(cur()?.files.map((f) => f.r.logical) || [0])) / 2048) * 2048;
  function stripRect(row, o, l) {
    const k = G.stripW / scaleMax();
    const y = G.filesTop + row * G.rowH + (G.wide ? 5 : 15);
    return { x: G.stripX + o * k, y, w: Math.max(1, l * k - 1), h: G.wide ? 14 : 10 };
  }
  function pitch() {
    const span = G.W - 2 * G.pad;
    for (let p = 22; p > 4; p--) if (Math.ceil(grid.length / Math.floor(span / p)) * p <= G.repoH) return p;
    return 4;
  }
  function cellRect(i, p) {
    const cols = Math.floor((G.W - 2 * G.pad) / p), s = p >= 8 ? p - 2 : p - 1;
    return { x: G.pad + (i % cols) * p, y: G.repoTop + Math.floor(i / cols) * p, w: s, h: s };
  }
  function bars() {
    const plotW = G.W - G.pad - G.axisL;
    const n = Math.max(12, Math.min(snaps.length, Math.floor(plotW / 14)));
    const vis = snaps.slice(-Math.floor(plotW / 14));
    const slot = plotW / n;
    return { vis, slot, bw: Math.max(6, Math.min(26, slot * 0.66)), x0: G.pad + G.axisL };
  }

  function draw(now) {
    if (!G || !colors) return;
    const c = colors, dpr = window.devicePixelRatio || 1, ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, G.W, G.H);
    const font = (px, wt = 400) => `${wt} ${px}px ${c.mono}`;
    const s = cur();
    const label = (t, x, y, align = "left", col = c.text3, wt = 400) => { ctx.font = font(10, wt); ctx.fillStyle = col; ctx.textAlign = align; ctx.fillText(t, x, y); };
    if (!s) return;
    const P = pitch();

    // Files: the binary's chunks of each file in the latest snapshot.
    label(`files in snapshot ${s.n}`, G.pad, 16, "left", c.text, 600);
    label(G.wide ? "click a file to insert your text there" : "tap a file to insert", G.W - G.pad, 16, "right");
    ctx.textBaseline = "alphabetic";
    s.files.forEach((f, row) => {
      const y0 = G.filesTop + row * G.rowH;
      const name = f.path;
      const fresh = f.r.new;
      const tag = fresh ? `${fresh} new` : "all reused";
      if (G.wide) {
        ctx.font = font(10);
        let shown = name;
        while (shown.length > 4 && ctx.measureText(shown).width > G.nameW - 10) shown = "…" + shown.slice(2);
        label(shown, G.pad, y0 + 15, "left", c.text2);
      } else {
        label(name, G.pad, y0 + 11, "left", c.text2);
        label(tag, G.W - G.pad, y0 + 11, "right", fresh ? (s.you ? c.accent : c.signal) : c.text3);
      }
      if (hover?.row === row) {
        ctx.fillStyle = c.accent;
        ctx.globalAlpha = 0.12;
        const r = stripRect(row, 0, f.r.logical);
        ctx.fillRect(r.x - 2, r.y - 3, r.w + 5, r.h + 6);
        ctx.globalAlpha = 1;
      }
      let end = 0;
      for (const ch of f.r.chunks) {
        const r = stripRect(row, ch.o, ch.l);
        const isNew = ch.s === "new";
        ctx.fillStyle = isNew ? (s.you ? c.accent : c.signal) : c.text3;
        ctx.globalAlpha = isNew ? 1 : 0.4;
        if (damaged.has(ch.id)) { ctx.fillStyle = c.danger; ctx.globalAlpha = 1; }
        ctx.fillRect(r.x, r.y, r.w, r.h);
        end = r.x + r.w;
      }
      ctx.globalAlpha = 1;
      if (G.wide) {
        ctx.font = font(10);
        if (end + 8 + ctx.measureText(tag).width < G.W - G.pad) label(tag, end + 8, y0 + 15, "left", fresh ? (s.you ? c.accent : c.signal) : c.text3);
      }
      if (hover?.row === row && hover.x != null) {
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 2;
        const r = stripRect(row, 0, 1);
        ctx.beginPath(); ctx.moveTo(hover.x, r.y - 4); ctx.lineTo(hover.x, r.y + r.h + 4); ctx.stroke();
      }
    });

    // Repository: one cell per unique chunk, in the order the binary stored them.
    const packs = repo ? repo.packs : 0;
    label(`repository: ${fmt(grid.length)} sealed chunks in ${fmt(packs)} packs`, G.pad, G.repoTop - 10, "left", c.text, 600);
    const landing = new Map();
    for (const f of flights) if (f.kind === "new") landing.set(f.cell, f);
    const lit = restored && restored.n <= s.n ? restored.ids : null;
    grid.forEach((g, i) => {
      const r = cellRect(i, P);
      const fl = landing.get(i);
      if (fl && now < fl.t0 + FLY_MS) return;
      const isCur = g.snap === s.n;
      if (damaged.has(g.id)) { ctx.fillStyle = c.danger; ctx.globalAlpha = 1; }
      else if (isCur) { ctx.fillStyle = g.you ? c.accent : c.signal; ctx.globalAlpha = 1; }
      else { ctx.fillStyle = c.text2; ctx.globalAlpha = 0.45; }
      if (lit) {
        // A restore lights the cells its snapshot reads, in file order; the rest dim.
        const t = lit.has(g.id) ? ease((now - restored.t0 - restored.order.get(g.id) * restored.gap) / 200) : 0;
        if (!isCur && !damaged.has(g.id)) { ctx.fillStyle = c.text; ctx.globalAlpha = 0.12 + 0.68 * t; }
      }
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });
    ctx.globalAlpha = 1;
    if (!grid.length) label("empty", G.pad, G.repoTop + 10);

    // Flights: new chunks fly into their cell; reused chunks draw a link to theirs.
    flights = flights.filter((f) => now < f.t0 + FLY_MS);
    for (const f of flights) {
      const t = (now - f.t0) / FLY_MS;
      if (t < 0) continue;
      const a = stripRect(f.row, f.o, f.l), b = cellRect(f.cell, P);
      if (f.kind === "link") {
        ctx.globalAlpha = 0.35 * (1 - t);
        ctx.strokeStyle = c.text2;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x + a.w / 2, a.y + a.h); ctx.lineTo(b.x + b.w / 2, b.y); ctx.stroke();
        continue;
      }
      const e = ease(t);
      const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e - Math.sin(e * Math.PI) * 14;
      const wd = a.w + (b.w - a.w) * e, ht = a.h + (b.h - a.h) * e;
      ctx.globalAlpha = 1;
      ctx.fillStyle = f.you ? c.accent : c.signal;
      ctx.fillRect(x, y, wd, ht);
    }
    ctx.globalAlpha = 1;

    // Per snapshot: bytes of new chunks (stored) and reused chunks (linked); the tick is what the packs took.
    const { vis, slot, bw, x0 } = bars();
    const top = G.chartTop, base = G.chartTop + G.chartH;
    label("bytes per snapshot", G.pad, top - 12, "left", c.text, 600);
    const max = Math.max(1024, ...vis.map((v) => v.logical));
    const stepB = [1024, 2048, 4096, 8192, 16384].find((q) => max / q <= 5) || 32768;
    const yMax = Math.ceil((max * 1.12) / stepB) * stepB;
    const sy = (v) => base - (v / yMax) * G.chartH;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = 0; v <= yMax; v += stepB) { const y = Math.round(sy(v)) + 0.5; ctx.moveTo(x0, y); ctx.lineTo(G.W - G.pad, y); }
    ctx.stroke();
    ctx.textBaseline = "middle";
    for (let v = 0; v <= yMax; v += stepB) label(v ? kib(v) : "0", x0 - 6, sy(v), "right");
    ctx.textBaseline = "alphabetic";
    const every = Math.ceil(24 / slot);
    vis.forEach((v, i) => {
      const x = x0 + slot * i + (slot - bw) / 2;
      const grow = v.t0 ? ease((now - v.t0 - FLY_MS * 0.6) / GROW_MS) : 1;
      const yN = sy(v.nb * grow), yL = sy((v.nb + v.rb) * grow);
      ctx.fillStyle = c.text3;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x, yL, bw, yN - yL);
      ctx.globalAlpha = 1;
      ctx.fillStyle = v.you ? c.accent : c.signal;
      ctx.fillRect(x, yN, bw, base - yN);
      if (v.stored && grow >= 1) {
        ctx.strokeStyle = c.text;
        ctx.lineWidth = 2;
        const y = Math.round(sy(v.stored));
        ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + bw + 3, y); ctx.stroke();
      }
      if (restored?.n === v.n || hover?.bar === v.n) {
        ctx.strokeStyle = restored?.n === v.n ? (restored.ok === false ? c.danger : c.text) : c.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 3.5, yL - 3.5, bw + 7, base - yL + 7);
      }
      const latest = i === vis.length - 1;
      ctx.globalAlpha = grow;
      if (v.you || latest) label(`${v.you ? "you " : ""}${latest ? `+${kib(v.nb)}` : ""}`.trim(), x + bw / 2, yL - 7, latest && x + bw / 2 > G.W - 40 ? "right" : "center", v.you ? c.accent : c.signal, 600);
      ctx.globalAlpha = 1;
      if ((vis.length - 1 - i) % every === 0) label(String(v.n), x + bw / 2, base + 14, "center");
    });
    label("snapshot", x0, base + 27, "left");
    label(G.wide ? "click a bar to restore it" : "tap a bar to restore", G.W - G.pad, base + 27, "right");
  }

  function setCells() {
    const s = cur();
    if (!s || !repo) return;
    cell.snaps.textContent = fmt(snaps.length);
    cell.files.textContent = fmt(s.files.length);
    cell.logical.textContent = B(repo.logical);
    cell.stored.textContent = B(repo.stored);
    cell.ratio.textContent = repo.stored ? `${(repo.logical / repo.stored).toFixed(2)}×` : "–";
    cell.chunks.textContent = fmt(repo.blobs);
    cell.fresh.textContent = fmt(s.nc);
    cell.ms.textContent = `${s.ms.toFixed(1)} ms`;
    receipt.textContent = `stash cut ${plural(cut, "chunk")} from ${plural(repo.backups, "file version")} in ${plural(snaps.length, "snapshot")} and sealed the ${fmt(sealed)} new ${sealed === 1 ? "one" : "ones"} with XChaCha20-Poly1305` +
      `${restores ? `, then restored ${plural(restores, "file")}` : ""}, in ${fmt(Math.round(callMs))} ms.`;
    day.textContent = `Snapshot ${s.n}${s.day ? `, day ${s.day}` : ""}: ${s.label}.`;
    canvas.setAttribute("aria-label", `Snapshot ${s.n} of ${s.files.length} files: ${s.nc} of ${s.chunks} chunks new (${B(s.nb)}), the rest reused. ` +
      `Repository: ${repo.blobs} unique chunks in ${repo.packs} packs, ${B(repo.stored)} stored for ${B(repo.logical)} backed up.`);
  }
  function syncSelects() {
    const paths = cur().files.map((f) => f.path);
    const was = into.value;
    into.replaceChildren(...paths.map((p) => { const o = el("option", null, p); o.value = p; return o; }));
    into.value = paths.includes(was) ? was : (paths.includes(NOTES) ? NOTES : paths[0]);
    const keep = snapSel.value;
    snapSel.replaceChildren(...snaps.map((s) => { const o = el("option", null, `${s.n}${s.you ? " (you)" : ""}`); o.value = String(s.n); return o; }));
    snapSel.value = pinned && snaps.some((s) => String(s.n) === keep) ? keep : String(snaps.length);
  }

  // One snapshot: every file in the tree through the binary's backup.
  async function snapshot(label, yours, animate) {
    const g = gen;
    const paths = [...w.tree.keys()].sort();
    const files = [];
    const t0 = performance.now();
    for (const path of paths) {
      const text = w.tree.get(path);
      files.push({ path, text, r: await exec("backup", { text }) });
    }
    const ms = performance.now() - t0;
    if (g !== gen) throw new Error("stale");
    const n = snaps.length + 1, now = performance.now();
    const s = { n, day: yours ? 0 : w.day, label, you: !!yours, files, ms, nb: 0, rb: 0, nc: 0, chunks: 0, stored: 0, logical: 0, t0: animate ? now : 0 };
    let k = 0;
    files.forEach((f, row) => {
      const r = f.r;
      s.stored += r.stored;
      s.logical += r.logical;
      s.nc += r.new;
      s.chunks += r.chunks.length;
      cut += r.chunks.length;
      sealed += r.new;
      repo = r.repo;
      for (const ch of r.chunks) {
        if (ch.s === "new") {
          s.nb += ch.l;
          cellOf.set(ch.id, grid.length);
          grid.push({ id: ch.id, snap: n, you: !!yours });
        } else s.rb += ch.l;
        if (animate && row < ROWS) {
          const delay = Math.min(220, k++ * 6);
          flights.push({ kind: ch.s === "new" ? "new" : "link", row, o: ch.o, l: ch.l, cell: cellOf.get(ch.id), t0: now + delay, you: !!yours });
        }
      }
    });
    snaps.push(s);
    syncSelects();
    setCells();
    return s;
  }

  async function nextDay(animate) {
    const label = mutate(w);
    return snapshot(label, null, animate);
  }

  // Serialises snapshots so autoplay, Step and your edits never overlap.
  let tail = Promise.resolve();
  function run(f) {
    running++;
    const p = tail.then(() => f());
    const done = () => { running--; };
    tail = p.then(done, done);
    return p;
  }

  async function warm() {
    gen++;
    const g = gen;
    w = world();
    snaps = []; grid = []; cellOf = new Map(); repo = null; flights = []; restored = null; flipped = null; damaged = new Set();
    callMs = 0; cut = 0; sealed = 0; restores = 0; pending = 0; pinned = false;
    youLine.textContent = "";
    rline.textContent = "";
    fline.textContent = "";
    flipBtn.textContent = "Flip one bit";
    await exec("init", { seed: Number(key.value), avg: Number(avg.value) });
    const n = reduce.matches ? SCRIPT_DAYS : WARM;
    for (let d = 0; d < n && g === gen; d++) await nextDay(false);
    draw(performance.now());
  }
  let restarting = Promise.resolve();
  const restart = () => {
    warming = true;
    restarting = run(warm).finally(() => { warming = false; });
    return restarting;
  };

  const fail = (err) => { if (err.message !== "stale") day.textContent = err.message; };

  function frame(ts) {
    raf = 0;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    if (playing && !warming && !running) {
      pending += dt * Number(speed.value);
      if (pending >= SNAP_MS) {
        pending = 0;
        if (w.day >= MAX_DAYS) {
          setPlaying(false);
          day.textContent = `${fmt(w.day)} days backed up; Reset to run them again.`;
        } else run(() => nextDay(!reduce.matches)).catch(fail);
      }
    }
    draw(ts);
    const busy = flights.length || snaps.some((s) => s.t0 && ts - s.t0 < FLY_MS + GROW_MS) || (restored && ts - restored.t0 < 600);
    if ((playing || busy) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  function setPlaying(v) {
    playing = v;
    play.textContent = v ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(v));
    if (v) kick();
  }

  // Your edit: your text goes in as a line at a line start, then the tree is backed up.
  async function insertMine(path, at) {
    const text = mine.value.replace(/\r?\n/g, " ");
    if (!text.trim()) { youLine.textContent = "Type some text to insert first."; return; }
    await restarting;
    await run(async () => {
      const s = w.tree.get(path);
      if (s === undefined) return;
      let i = at == null ? s.indexOf("\n", s.length >> 1) + 1 : s.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
      if (i <= 0 && at == null) i = s.length;
      const add = `${text}\n`;
      w.tree.set(path, s.slice(0, i) + add + s.slice(i));
      const byte = blen(s.slice(0, i));
      const snap = await snapshot(`your ${B(blen(add))} inserted into ${path}`, true, !reduce.matches);
      const f = snap.files.find((x) => x.path === path);
      const fresh = f.r.chunks.filter((c) => c.s === "new");
      const lo = fresh.length ? fresh[0].o : 0, hi = fresh.length ? fresh[fresh.length - 1].o + fresh[fresh.length - 1].l : 0;
      youLine.textContent = `Your ${B(blen(add))} went into ${path} at byte ${fmt(byte)}. stash cut the file into ${fmt(f.r.chunks.length)} ${f.r.chunks.length === 1 ? "chunk" : "chunks"}: ` +
        (fresh.length ? `${fmt(fresh.length)} new (bytes ${fmt(lo)} to ${fmt(hi)}), ${fmt(f.r.chunks.length - fresh.length)} reused` : "none new") +
        `. Snapshot ${snap.n} stored ${B(snap.stored)} for ${B(snap.logical)} of files.`;
      pending = -SNAP_MS;
    });
    draw(performance.now());
    kick();
  }

  // Restore: every file of the snapshot read back through the index, its chunks opened and checked.
  async function restore(n) {
    const s = snaps[n - 1];
    if (!s) return;
    await restarting;
    await run(async () => {
      const t0 = performance.now();
      let bytes = 0, chunks = 0, bad = null, same = true;
      const packs = new Set(), ids = new Set(), order = new Map();
      for (const f of s.files) {
        for (const c of f.r.chunks) { packs.add(c.p); ids.add(c.id); if (!order.has(c.id)) order.set(c.id, order.size); }
        const r = await exec("restore", { backup: f.r.backup });
        restores++;
        if (!r.ok) { bad = bad || { path: f.path, ...r }; continue; }
        bytes += r.bytes;
        chunks += r.chunks;
        same = same && r.identical;
      }
      const ms = performance.now() - t0;
      restored = { n, ids, order, t0: reduce.matches ? -1e9 : performance.now(), gap: Math.min(4, 250 / Math.max(1, order.size)), ok: !bad };
      rline.className = `sh-rline sh-res ${bad ? "sh-bad" : "sh-ok"}`;
      rline.textContent = bad
        ? `Snapshot ${n} refused at ${bad.path}, chunk ${fmt(bad.chunk + 1)} in pack ${fmt(bad.pack + 1)}: ${bad.problem}.`
        : `Snapshot ${n} restored: ${plural(s.files.length, "file")}, ${B(bytes)} from ${plural(chunks, "chunk")} in ${plural(packs.size, "pack")}. ` +
          `Every chunk's tag verified and ${same ? "every file's BLAKE3 hash matches its backup" : "a file differs from its backup"}, in ${fmt(Math.max(1, Math.round(ms)))} ms.`;
      setCells();
    });
    draw(performance.now());
    kick();
  }

  // Flip: one bit in the middle of a chunk of snapshot 1's notes pack, so later snapshots that reuse it fail.
  async function flip() {
    await restarting;
    let target = 0;
    await run(async () => {
      if (!flipped) {
        const f = snaps[0].files.find((x) => x.path === NOTES);
        const pk = await exec("pack", { pack: f.r.pack.n });
        const b = pk.blobs[pk.blobs.length >> 1];
        flipped = { pack: pk.n, off: b.o + pk.nonce + ((b.l - pk.nonce - pk.tag) >> 1), id: b.id };
      }
      const r = await exec("flip", { pack: flipped.pack, offset: flipped.off });
      const on = r.flipped.includes(flipped.off);
      damaged = on ? new Set([flipped.id]) : new Set();
      flipBtn.textContent = on ? "Flip it back" : "Flip one bit";
      const hit = [...snaps].reverse().find((s) => s.files.some((f) => f.r.chunks.some((c) => c.id === flipped.id)));
      target = on && hit ? hit.n : Number(snapSel.value);
      const blob = r.blobs.find((x) => x.id === flipped.id);
      fline.textContent = on
        ? `Flipped one bit of byte ${fmt(flipped.off)} in pack ${fmt(flipped.pack + 1)}, inside chunk ${flipped.id}: ${blob?.problem || "verified"}. ` +
          `The pack's BLAKE3 name ${r.hash_ok ? "still matches" : "no longer matches its bytes"}.`
        : `Flipped it back: pack ${fmt(flipped.pack + 1)} verifies again${r.hash_ok ? " and matches its BLAKE3 name" : ""}.`;
    });
    if (target) { snapSel.value = String(target); pinned = true; await restore(target); }
  }

  // Inputs.
  play.addEventListener("click", () => setPlaying(!playing));
  step.addEventListener("click", () => {
    setPlaying(false);
    restarting.then(() => run(() => nextDay(!reduce.matches))).then(() => { draw(performance.now()); kick(); }).catch(fail);
  });
  reset.addEventListener("click", () => restart().then(() => kick()).catch(fail));
  for (const s of [avg, key]) s.addEventListener("change", () => restart().then(() => kick()).catch(fail));
  insert.addEventListener("click", () => insertMine(into.value, null).catch(fail));
  mine.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); insertMine(into.value, null).catch(fail); } });
  snapSel.addEventListener("change", () => { pinned = true; });
  restoreBtn.addEventListener("click", () => restore(Number(snapSel.value)).catch(fail));
  flipBtn.addEventListener("click", () => flip().catch(fail));

  function hit(e) {
    const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, s = cur();
    if (!G || !s) return null;
    const row = Math.floor((y - G.filesTop) / G.rowH);
    if (row >= 0 && row < s.files.length && x >= G.stripX - 4) {
      const f = s.files[row], r = stripRect(row, 0, f.r.logical);
      if (x <= r.x + r.w + 4) {
        const byte = Math.round(((Math.min(Math.max(x, r.x), r.x + r.w) - G.stripX) / G.stripW) * scaleMax());
        return { row, x: Math.min(Math.max(x, r.x), r.x + r.w), path: f.path, at: indexAt(f.text, byte) };
      }
    }
    if (y >= G.chartTop - 4 && y <= G.chartTop + G.chartH + 18) {
      const { vis, slot, x0 } = bars();
      const i = Math.floor((x - x0) / slot);
      if (i >= 0 && i < vis.length) return { bar: vis[i].n };
    }
    return null;
  }
  canvas.addEventListener("pointermove", (e) => {
    hover = e.pointerType === "touch" ? null : hit(e);
    canvas.classList.toggle("sh-aim", !!hover);
    if (!raf) draw(performance.now());
  });
  canvas.addEventListener("pointerleave", () => { hover = null; if (!raf) draw(performance.now()); });
  canvas.addEventListener("click", (e) => {
    const h = hit(e);
    if (h?.path) { into.value = h.path; insertMine(h.path, h.at).catch(fail); }
    else if (h?.bar) { snapSel.value = String(h.bar); pinned = true; restore(h.bar).catch(fail); }
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
  setPlaying(playing);
}
