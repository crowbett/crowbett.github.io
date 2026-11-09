// stash demo: stash's FastCDC chunker, keyed BLAKE3 ids, zstd + XChaCha20-Poly1305
// packs and Argon2id key slots, compiled to WebAssembly. The text is chunked live as
// you type; "Back up" seals only the chunks the repository has not seen.
const MAX = 128 * 1024;
const enc = new TextEncoder();

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

const LOG = Array.from({ length: 64 }, (_, i) => {
  const t = `${String(8 + Math.floor(i / 6)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}`;
  const kinds = ["GET /api/orders 200 12ms", "GET /api/stock?sku=8811 200 4ms", "POST /api/orders 201 38ms", "GET /healthz 200 1ms", "PUT /api/orders/4417 409 9ms", "GET /api/users/me 200 6ms"];
  return `2026-11-08T${t}Z web-${(i % 3) + 1} ${kinds[(i * 5) % kinds.length]} req=${(i * 2654435761 >>> 0).toString(16).padStart(8, "0")}\n`;
}).join("");

const INSERTS = [
  "Later the same week. A gull got into the store room and ate most of a loaf before anyone noticed. It left by the window it came in through, which was a window nobody knew opened.\n\n",
  "Inserted note. The assistant was asked what the boot was for and said it was for the record.\n\n",
  "Late entry. Barometer fell four millibars in two hours; secured the boat and the shutters.\n\n",
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");
const bytes = (n) => `${fmt(n)} B`;
const ratio = (a, b) => (b ? `${(a / b).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×` : "–");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function field(label, input, cls) {
  const f = el("label", `demo-field${cls ? ` ${cls}` : ""}`);
  f.append(el("span", "demo-label", label), input);
  return f;
}
function button(text, secondary) {
  const b = el("button", secondary ? "secondary" : null, text);
  b.type = "button";
  return b;
}
function cells(pairs) {
  const ul = el("ul", "cells stack sh-cells");
  for (const [k, v, cls] of pairs) {
    const li = el("li", cls);
    li.append(el("span", "sh-k", k), el("span", "sh-v", v));
    ul.append(li);
  }
  return ul;
}

// Splits text into the UTF-16 slices covering each chunk's byte range (a boundary
// inside a multi-byte character moves to that character's end).
function slices(text, chunks) {
  const out = [];
  let i = 0, b = 0;
  for (const c of chunks) {
    const start = i, end = c.o + c.l;
    while (i < text.length && b < end) {
      const cp = text.codePointAt(i);
      b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      i += cp > 0xffff ? 2 : 1;
    }
    out.push(text.slice(start, i));
  }
  if (i < text.length && out.length) out[out.length - 1] += text.slice(i);
  return out;
}

// Theme colours for canvases, read from ui.css custom properties.
function palette(node) {
  const probe = el("span");
  node.append(probe);
  const v = (n) => {
    probe.style.color = `var(${n})`;
    return getComputedStyle(probe).color;
  };
  const out = { new: v("--sh-new"), reused: v("--sh-reused"), dup: v("--sh-dup"), ground: v("--sh-ground"), nonce: v("--accent"),
    ct: v("--text-2"), tag: v("--sh-tag"), hdr: v("--sh-hdr"), sel: v("--text") };
  probe.remove();
  return out;
}

function sizeCanvas(c, w, h) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.height = `${h}px`;
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

const SWATCH = { nonce: "var(--accent)", ct: "var(--text-2)", bad: "var(--text)" };
const STATUS = { new: "new, sealed and stored", reused: "reused from the repository", dup: "repeats an earlier chunk of this document" };

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

  // Calls run one at a time, in order.
  let chain = Promise.resolve();
  const receipt = el("p", "demo-out sh-out");
  let calls = 0;
  let callMs = 0;
  const call = (m, p) => {
    const run = chain.then(async () => {
      const t0 = performance.now();
      try {
        return await demo.call(m, p);
      } finally {
        calls++;
        callMs += performance.now() - t0;
        receipt.textContent = `${fmt(calls)} calls to stash's engine, ${fmt(Math.round(callMs))} ms in total, in your browser.`;
      }
    });
    chain = run.catch(() => {});
    return run;
  };

  // ---- Backups panel ----
  const backupBtn = button("Back up");
  const insertBtn = button("Insert a paragraph", true);
  const deleteBtn = button("Delete a line", true);
  const preset = el("select");
  preset.name = "preset";
  for (const [v, t] of [["prose", "Harbour log (prose)"], ["log", "Server log"], ["file", "Your file"]]) {
    const o = el("option", null, t);
    o.value = v;
    if (v === "file") o.hidden = o.disabled = true;
    preset.append(o);
  }
  const avg = el("select");
  avg.name = "avg";
  for (const n of [256, 512, 1024]) {
    const o = el("option", null, n < 1024 ? `${n} B` : "1 KiB");
    o.value = String(n);
    avg.append(o);
  }
  const file = el("input");
  file.type = "file";
  file.name = "file";
  file.accept = "text/*,.txt,.md,.csv,.json,.log,.toml,.yaml,.yml,.go,.rs,.js,.ts,.py,.html,.css";
  const controls = el("div", "sh-controls");
  file.className = "vh";
  const filePick = el("label", "sh-pick");
  filePick.append(file, el("span", null, "Open a text file"));
  const fname = el("span", "sh-fname", "stays in this tab");
  controls.append(backupBtn, insertBtn, deleteBtn, field("document", preset), field("average chunk", avg), filePick, fname);

  const ta = el("textarea");
  ta.name = "text";
  ta.spellcheck = false;
  ta.setAttribute("autocomplete", "off");
  ta.setAttribute("autocapitalize", "off");
  const mirror = el("span", "sh-mirror");
  mirror.setAttribute("aria-hidden", "true");
  const ed = el("span", "sh-ed");
  ed.append(mirror, ta);
  const edBox = el("div", "sh-edbox");
  edBox.append(ed);
  const edField = field("edit anywhere, then back up. Each band is one FastCDC chunk; vermilion bands are new since the last backup.", edBox, "sh-edfield");

  const live = el("p", "sh-live");
  live.setAttribute("aria-live", "polite");
  const legend = el("p", "demo-legend sh-legend");
  for (const [k, t] of [["new", "new: sealed and stored"], ["reused", "reused: already in the repository"], ["dup", "repeat within the document"]]) {
    const s = el("span", "sh-key", t);
    s.dataset.s = k;
    s.style.setProperty("--c", SWATCH[k] || `var(--sh-${k})`);
    legend.append(s);
  }
  const rows = el("ol", "sh-rows");
  rows.setAttribute("aria-label", "Backups");
  const totals = el("div", "sh-totals");
  totals.setAttribute("aria-live", "polite");

  const dedup = el("section", "sh-panel");
  dedup.append(el("h3", "sh-h", "Deduplicated backups"), controls, edField, live, legend, rows, totals);

  // ---- Encryption panel ----
  const pass = el("input");
  Object.assign(pass, { type: "text", name: "passphrase", value: "correct horse battery staple" });
  pass.setAttribute("autocomplete", "off");
  const sealBtn = button("Seal the key slot");
  const tryPass = el("input");
  Object.assign(tryPass, { type: "text", name: "try", value: "correct horse battery stapler" });
  tryPass.setAttribute("autocomplete", "off");
  const unlockBtn = button("Unlock", true);
  const kdf = el("p", "sh-kdf");
  kdf.setAttribute("aria-live", "polite");
  const slotHex = el("p", "sh-hex sh-slot");
  slotHex.setAttribute("aria-label", "Sealed key slot bytes: nonce, ciphertext, tag");
  const unlockOut = el("p", "sh-result");
  unlockOut.setAttribute("aria-live", "polite");
  const slotRow1 = el("div", "sh-controls");
  slotRow1.append(field("passphrase", pass, "sh-grow"), sealBtn);
  const slotRow2 = el("div", "sh-controls");
  slotRow2.append(field("try a passphrase", tryPass, "sh-grow"), unlockBtn);

  const packSel = el("select");
  packSel.name = "pack";
  const offset = el("input");
  Object.assign(offset, { type: "number", name: "offset", min: 0, step: 1, value: 0 });
  offset.inputMode = "numeric";
  const flipBtn = button("Flip one bit", true);
  const packRow = el("div", "sh-controls");
  packRow.append(field("pack", packSel), field("byte", offset, "sh-num"), flipBtn);
  const mapBox = el("div", "sh-mapbox");
  const map = el("canvas", "sh-map");
  map.setAttribute("role", "img");
  mapBox.append(map);
  const plegend = el("p", "demo-legend sh-legend");
  for (const [k, t] of [["nonce", "nonce (24 B)"], ["ct", "ciphertext"], ["tag", "Poly1305 tag (16 B)"], ["hdr", "sealed header + length"], ["bad", "flipped"]]) {
    const s = el("span", "sh-key", t);
    s.dataset.s = k;
    s.style.setProperty("--c", SWATCH[k] || `var(--sh-${k})`);
    plegend.append(s);
  }
  const byteInfo = el("p", "sh-byte");
  byteInfo.setAttribute("aria-live", "polite");
  const verify = el("ul", "sh-verify");
  verify.setAttribute("aria-label", "Pack verification");
  verify.setAttribute("aria-live", "polite");

  const crypt = el("section", "sh-panel");
  crypt.append(el("h3", "sh-h", "Encryption"),
    el("p", "sh-note", "The passphrase never encrypts data. Argon2id stretches it into a key that seals the repository's random master key in a key slot; chunks are sealed with keys derived from that master key."),
    slotRow1, kdf, slotHex, slotRow2, unlockOut,
    el("p", "sh-note", "Each new chunk is compressed with zstd and sealed with XChaCha20-Poly1305 into a pack. Pick a byte and flip one bit of it: the tag no longer verifies, so restore refuses that chunk."),
    packRow, mapBox, plegend, byteInfo, verify);

  root.replaceChildren(dedup, crypt, receipt);

  // ---- State ----
  let text = PROSE;
  let backups = []; // {n, chunks, logical, stored, new, reused, dup, pack, restore?}
  let repo = null;
  let liveChunks = [];
  let lastBackupChunks = new Set();
  let pack = null; // last pack response
  let sel = 0;
  let animating = null;
  let inserts = 0;
  let reveal = false; // scroll the editor to the first changed chunk on the next paint

  // ---- Editor ----
  // Grows the textarea to its content (the box around it scrolls), keeping the box's scroll.
  const fit = () => {
    const top = edBox.scrollTop;
    // Holding the box open while the textarea is measured keeps the page from reflowing.
    ed.style.minHeight = `${ed.offsetHeight}px`;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    ed.style.minHeight = "";
    edBox.scrollTop = top;
  };
  function paintMirror() {
    const parts = slices(ta.value, liveChunks);
    const frag = document.createDocumentFragment();
    parts.forEach((s, i) => {
      const c = liveChunks[i];
      const span = el("span", `sh-c sh-${c.s}${i % 2 ? " sh-odd" : ""}`, s);
      if (c.s !== "new" && lastBackupChunks.has(c.id)) span.classList.add("sh-last");
      frag.append(span);
    });
    // A trailing newline needs a character after it to take up a line, as in the textarea.
    frag.append(el("span", null, "​"));
    mirror.replaceChildren(frag);
    if (reveal) {
      const hit = mirror.querySelector(".sh-new, .sh-last");
      if (hit) { edBox.scrollTop = Math.max(0, hit.offsetTop - 48); reveal = false; }
    }
  }
  function summarize() {
    const n = liveChunks.length;
    const fresh = liveChunks.filter((c) => c.s === "new");
    const freshBytes = fresh.reduce((a, c) => a + c.l, 0);
    const len = enc.encode(ta.value).length;
    if (!backups.length) live.textContent = `${fmt(n)} chunks over ${bytes(len)}.`;
    else if (!fresh.length) live.textContent = `No unsaved changes: all ${fmt(n)} chunks of ${bytes(len)} are already in the repository.`;
    else live.textContent = `Unsaved: ${fmt(fresh.length)} of ${fmt(n)} chunks (${bytes(freshBytes)}) are new; a backup now stores only those.`;
  }

  let scanning = false, dirty = false;
  async function scan() {
    if (scanning) { dirty = true; return; }
    scanning = true;
    try {
      do {
        dirty = false;
        const value = ta.value;
        if (enc.encode(value).length > MAX) {
          live.textContent = `The document is over ${fmt(MAX / 1024)} KiB, the most this demo chunks in one call. Shorten it to back up.`;
          backupBtn.disabled = true;
          continue;
        }
        const r = await call("scan", { text: value });
        if (ta.value !== value) { dirty = true; continue; }
        liveChunks = r.chunks;
        backupBtn.disabled = false;
        paintMirror();
        summarize();
      } while (dirty);
    } finally {
      scanning = false;
    }
  }
  let raf = 0;
  const rescan = () => {
    fit();
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; scan().catch((e) => { live.textContent = e.message; }); });
  };
  ta.addEventListener("input", rescan);
  window.addEventListener("resize", () => { fit(); drawRows(); drawMap(); });

  function setText(t, show) {
    reveal = !!show;
    ta.value = t;
    text = t;
    rescan();
  }

  // Inserts at the paragraph break nearest the middle; deletes the non-empty line there.
  function middleBreak(t) {
    const mid = t.length >> 1;
    const after = t.indexOf("\n\n", mid), before = t.lastIndexOf("\n\n", mid);
    const pick = after < 0 ? before : before < 0 ? after : (after - mid < mid - before ? after : before);
    return pick < 0 ? t.lastIndexOf("\n", mid) + 1 : pick + 2;
  }
  const insert = () => {
    const t = ta.value, at = middleBreak(t);
    setText(t.slice(0, at) + INSERTS[inserts++ % INSERTS.length] + t.slice(at), true);
  };
  insertBtn.addEventListener("click", insert);
  deleteBtn.addEventListener("click", () => {
    const t = ta.value;
    const lines = t.split("\n");
    let i = lines.length >> 1;
    for (let d = 0; d < lines.length; d++) {
      const j = (lines.length >> 1) + (d % 2 ? -(d + 1) / 2 : d / 2);
      if (lines[j]?.trim()) { i = j; break; }
    }
    if (lines.length < 2) return;
    lines.splice(i, 1);
    if (!lines[i]?.trim() && (i === 0 || !lines[i - 1].trim())) lines.splice(i, 1);
    setText(lines.join("\n"), true);
  });
  preset.addEventListener("change", () => {
    if (preset.value === "prose") setText(PROSE);
    else if (preset.value === "log") setText(LOG);
  });

  async function loadFile(f) {
    if (!f) return;
    if (f.size > MAX) {
      live.textContent = `${f.name} is ${fmt(f.size)} bytes; this demo takes text files up to ${fmt(MAX)} bytes.`;
      return;
    }
    let t;
    try {
      t = new TextDecoder("utf-8", { fatal: true }).decode(await f.arrayBuffer());
    } catch {
      live.textContent = `${f.name} is not UTF-8 text. The demo chunks what you can see and edit, so it takes text files only.`;
      return;
    }
    const o = preset.querySelector("option[value=file]");
    o.hidden = o.disabled = false;
    o.textContent = f.name;
    preset.value = "file";
    fname.textContent = f.name;
    setText(t);
  }
  file.addEventListener("change", () => loadFile(file.files[0]));
  ed.addEventListener("dragover", (e) => { e.preventDefault(); ed.classList.add("sh-drop"); });
  ed.addEventListener("dragleave", () => ed.classList.remove("sh-drop"));
  ed.addEventListener("drop", (e) => {
    ed.classList.remove("sh-drop");
    if (e.dataTransfer?.files?.length) { e.preventDefault(); loadFile(e.dataTransfer.files[0]); }
  });

  // ---- Backups ----
  function rowFor(b) {
    const li = el("li", "sh-row");
    const head = el("div", "sh-rowhead");
    head.append(el("span", "sh-n", `#${b.n + 1}`),
      el("span", "sh-sum", `${fmt(b.chunks.length)} chunks: ${fmt(b.new)} new, ${fmt(b.reused)} reused${b.dup ? `, ${fmt(b.dup)} repeated` : ""} · `));
    head.lastChild.append(el("span", "sh-nw", `${bytes(b.logical)} → ${bytes(b.stored)} stored`));
    const restore = button("Restore", true);
    restore.setAttribute("aria-label", `Restore backup ${b.n + 1}`);
    restore.addEventListener("click", () => doRestore(b, li));
    head.append(restore);
    const c = el("canvas", "sh-strip");
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", `Backup ${b.n + 1}: ${b.new} new chunks stored, ${b.reused} reused`);
    const out = el("p", "sh-restore");
    out.setAttribute("aria-live", "polite");
    li.append(head, c, out);
    b.canvas = c;
    b.out = out;
    return li;
  }

  function drawStrip(b, t) {
    const c = b.canvas;
    const W = c.clientWidth || c.parentElement.clientWidth;
    if (!W) return;
    const H = 22;
    const g = sizeCanvas(c, W, H);
    const p = palette(dedup);
    const max = Math.max(...backups.map((x) => x.logical), 1);
    g.fillStyle = p.ground;
    g.fillRect(0, 0, (W * b.logical) / max, H);
    const ease = 1 - (1 - t) ** 3;
    for (const ch of b.chunks) {
      const x = (ch.o / max) * W, w = Math.max(1, (ch.l / max) * W - 1);
      if (x > ease * W + 1) break;
      g.fillStyle = p[ch.s];
      if (ch.s === "new") {
        const rise = (1 - ease) * H;
        g.fillRect(x, rise, w, H - rise);
      } else {
        g.globalAlpha = Math.min(1, ease * 1.5);
        g.fillRect(x, 4, w, H - 8);
        g.globalAlpha = 1;
      }
    }
  }
  function drawRows() {
    for (const b of backups) if (b.canvas) drawStrip(b, b === animating?.b ? animating.t : 1);
  }
  function animate(b) {
    if (reduced()) { drawStrip(b, 1); return; }
    const t0 = performance.now();
    animating = { b, t: 0 };
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 300);
      animating.t = t;
      drawStrip(b, t);
      if (t < 1) requestAnimationFrame(step); else animating = null;
    };
    requestAnimationFrame(step);
  }

  function renderTotals() {
    if (!repo) return;
    totals.replaceChildren(cells([
      ["backups", fmt(repo.backups)],
      ["logical", bytes(repo.logical)],
      ["stored", bytes(repo.stored)],
      ["logical ÷ stored", ratio(repo.logical, repo.stored), "sh-ratio"],
      ["unique chunks", fmt(repo.blobs)],
      ["packs", fmt(repo.packs)],
    ]));
  }

  async function backup(animated) {
    const value = ta.value;
    const r = await call("backup", { text: value });
    const b = { n: r.backup, chunks: r.chunks, logical: r.logical, stored: r.stored, new: r.new, reused: r.reused, dup: r.dup, pack: r.pack };
    backups.push(b);
    repo = r.repo;
    lastBackupChunks = new Set(r.chunks.filter((c) => c.s === "new").map((c) => c.id));
    rows.prepend(rowFor(b));
    while (rows.children.length > 8) rows.lastChild.remove();
    drawRows();
    if (animated) animate(b); else drawStrip(b, 1);
    renderTotals();
    if (r.pack) await addPack(r.pack, b);
    liveChunks = r.chunks.map((c) => ({ ...c, s: c.s === "new" ? "reused" : c.s }));
    paintMirror();
    flashNew();
    summarize();
    return r;
  }
  function flashNew() {
    if (reduced()) return;
    for (const s of mirror.querySelectorAll(".sh-c")) s.classList.remove("sh-flash");
    const spans = mirror.querySelectorAll(".sh-c");
    liveChunks.forEach((c, i) => { if (lastBackupChunks.has(c.id)) spans[i]?.classList.add("sh-flash"); });
  }

  async function doRestore(b, li) {
    const r = await call("restore", { backup: b.n });
    b.out.classList.toggle("sh-bad", !r.ok);
    b.out.textContent = r.ok
      ? `Restored ${bytes(r.bytes)} from ${fmt(r.chunks)} chunks; every tag and chunk id verified${r.identical ? ", identical to what was backed up" : ", but it differs from what was backed up"}.`
      : `Restore refused at chunk ${fmt(r.chunk + 1)} (pack ${r.pack + 1}): ${r.problem}`;
    li.classList.toggle("sh-damaged", !r.ok);
  }

  backupBtn.addEventListener("click", () => guard(() => backup(true)));
  avg.addEventListener("change", () => guard(async () => {
    await init();
    await backup(true);
  }));

  // ---- Key slot ----
  function showSlot(slot, ms) {
    kdf.textContent = `${slot.algorithm}: ${fmt(slot.memory_kib / 1024)} MiB, ${slot.iterations} pass, ${slot.parallelism} lane, salt ${slot.salt}` +
      (ms === undefined ? "" : ` · ${fmt(Math.max(1, Math.round(ms)))} ms in your browser`) +
      ". The demo uses the smallest cost stash accepts; stash init defaults to 64 MiB, 3 passes, 4 lanes.";
    const d = slot.data, n = slot.nonce * 2, t = slot.tag * 2;
    const parts = [["sh-hn", d.slice(0, n)], ["sh-hc", d.slice(n, d.length - t)], ["sh-ht", d.slice(d.length - t)]];
    slotHex.replaceChildren(...parts.map(([c, s]) => el("span", c, s)));
  }
  sealBtn.addEventListener("click", () => guard(async () => {
    const t0 = performance.now();
    const r = await call("seal", { passphrase: pass.value });
    showSlot(r.slot, performance.now() - t0);
    unlockOut.textContent = "Sealed a fresh slot: new salt, new nonce, same master key. The packs did not change.";
    unlockOut.className = "sh-result";
  }));
  unlockBtn.addEventListener("click", () => guard(async () => {
    const t0 = performance.now();
    const r = await call("unlock", { passphrase: tryPass.value });
    const ms = fmt(Math.max(1, Math.round(performance.now() - t0)));
    unlockOut.className = `sh-result ${r.unlocked ? "sh-ok" : "sh-bad"}`;
    unlockOut.textContent = r.unlocked
      ? `Unlocked in ${ms} ms: master key ${r.master}${r.matches ? ", the key that sealed every pack below" : ""}.`
      : `Refused in ${ms} ms: with that passphrase the slot's Poly1305 tag does not verify, so the master key stays sealed.`;
  }));

  // ---- Packs ----
  function addPack(p, b) {
    const o = el("option", null, `pack ${p.n + 1} · ${p.id} · from backup #${b.n + 1}`);
    o.value = String(p.n);
    packSel.append(o);
    packSel.value = String(p.n);
    return showPack(p.n, true);
  }
  const region = (o) => {
    if (!pack) return null;
    for (const b of pack.blobs) {
      if (o >= b.o && o < b.o + b.l) {
        const k = o - b.o;
        return { kind: k < pack.nonce ? "nonce" : k >= b.l - pack.tag ? "tag" : "ct", blob: b };
      }
    }
    return { kind: "hdr" };
  };
  // Cells sized so a pack fills about 160 px of height, between 5 and 20 px each.
  let grid = { cs: 8, cols: 1 };
  function drawMap() {
    if (!pack) return;
    const W = mapBox.clientWidth;
    if (!W) return;
    const n = pack.bytes.length;
    const cs = Math.max(5, Math.min(20, Math.floor(Math.sqrt((W * 160) / n))));
    const cols = Math.max(8, Math.floor(W / cs)), rowsN = Math.ceil(n / cols);
    grid = { cs, cols };
    const g = sizeCanvas(map, cols * cs, rowsN * cs);
    map.style.width = `${cols * cs}px`;
    const p = palette(dedup);
    const flipped = new Set(pack.flipped);
    g.fillStyle = p.ground;
    g.fillRect(0, 0, cols * cs, rowsN * cs);
    const kinds = new Array(n).fill("hdr");
    for (const b of pack.blobs) for (let i = 0; i < b.l; i++) kinds[b.o + i] = i < pack.nonce ? "nonce" : i >= b.l - pack.tag ? "tag" : "ct";
    for (let i = 0; i < n; i++) {
      const x = (i % cols) * cs, y = Math.floor(i / cols) * cs;
      if (flipped.has(i)) {
        g.globalAlpha = 1;
        g.fillStyle = p.sel;
        g.fillRect(x, y, cs, cs);
        g.fillStyle = p.ground;
        const q = Math.max(2, Math.round(cs * 0.4));
        g.fillRect(x + (cs - q) / 2, y + (cs - q) / 2, q, q);
        continue;
      }
      g.fillStyle = p[kinds[i]];
      g.globalAlpha = 0.3 + (0.7 * pack.bytes[i]) / 255;
      const gap = cs > 9 ? 2 : 1;
      g.fillRect(x + gap / 2, y + gap / 2, cs - gap, cs - gap);
    }
    g.globalAlpha = 1;
    g.strokeStyle = p.sel;
    g.lineWidth = 1.5;
    g.strokeRect((sel % cols) * cs + 0.75, Math.floor(sel / cols) * cs + 0.75, cs - 1.5, cs - 1.5);
    map.setAttribute("aria-label", `Pack ${pack.n + 1}: ${fmt(n)} bytes, ${pack.blobs.length} sealed chunks then the sealed header`);
  }
  function describeByte() {
    if (!pack) return;
    const r = region(sel);
    const what = r.kind === "hdr" ? (sel >= pack.bytes.length - 4 ? "header length" : "sealed pack header")
      : `${r.kind === "nonce" ? "nonce" : r.kind === "tag" ? "Poly1305 tag" : "ciphertext"} of chunk ${r.blob.id}`;
    const from = Math.max(0, Math.min(sel - 7, pack.bytes.length - 16));
    const hex = [];
    for (let i = from; i < Math.min(from + 16, pack.bytes.length); i++) hex.push([i, pack.bytes[i].toString(16).padStart(2, "0")]);
    const line = el("code", "sh-hexline");
    for (const [i, h] of hex) line.append(el("span", i === sel ? "sh-hsel" : null, h), " ");
    byteInfo.replaceChildren(el("span", null, `byte ${fmt(sel)} of ${fmt(pack.bytes.length)}: ${what}`), line);
  }
  function renderVerify() {
    const items = [];
    const add = (ok, label, detail) => {
      const li = el("li", ok ? "sh-ok" : "sh-bad");
      li.append(el("span", "sh-mark", ok ? "verified" : "rejected"), el("span", "sh-what", label));
      if (detail) li.append(el("span", "sh-why", detail));
      items.push(li);
    };
    for (const b of pack.blobs) add(!b.problem, `chunk ${b.id}: ${bytes(b.raw)} plain, ${bytes(b.l)} sealed`, b.problem);
    add(!pack.header.problem, `pack header: ${pack.blobs.length} ${pack.blobs.length === 1 ? "entry" : "entries"}`, pack.header.problem);
    add(pack.hash_ok, `pack name ${pack.id} = BLAKE3 of its bytes`, pack.hash_ok ? null : "the bytes no longer hash to the pack's name (stash check reports this without the key)");
    verify.replaceChildren(...items);
  }
  async function showPack(n, resetSel) {
    const r = await call("pack", { pack: n });
    setPack(r, resetSel);
  }
  function setPack(r, resetSel) {
    const hex = r.hex;
    r.bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < r.bytes.length; i++) r.bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    pack = r;
    offset.max = String(r.bytes.length - 1);
    if (resetSel || sel >= r.bytes.length) {
      const b = r.blobs[0];
      sel = b ? b.o + r.nonce + Math.floor((b.l - r.nonce - r.tag) / 2) : 0;
    }
    offset.value = String(sel);
    drawMap();
    describeByte();
    renderVerify();
  }
  packSel.addEventListener("change", () => guard(() => showPack(Number(packSel.value), true)));
  const select = (i) => {
    if (!pack) return;
    sel = Math.max(0, Math.min(pack.bytes.length - 1, i));
    offset.value = String(sel);
    drawMap();
    describeByte();
  };
  offset.addEventListener("input", () => { const v = Number(offset.value); if (Number.isInteger(v)) select(v); });
  const pick = (e) => {
    if (!pack) return;
    const r = map.getBoundingClientRect(), { cs, cols } = grid;
    const i = Math.floor((e.clientY - r.top) / cs) * cols + Math.floor((e.clientX - r.left) / cs);
    if (i >= 0 && i < pack.bytes.length) select(i);
  };
  map.addEventListener("pointerdown", (e) => { map.setPointerCapture(e.pointerId); pick(e); });
  map.addEventListener("pointermove", (e) => { if (e.buttons) pick(e); });
  flipBtn.addEventListener("click", () => guard(async () => {
    const r = await call("flip", { pack: pack.n, offset: sel });
    setPack(r, false);
    flipBtn.textContent = r.flipped.includes(sel) ? "Flip it back" : "Flip one bit";
    for (const b of backups) if (b.out.textContent) await doRestore(b, b.out.parentElement);
  }));
  const syncFlip = () => { flipBtn.textContent = pack?.flipped.includes(sel) ? "Flip it back" : "Flip one bit"; };
  offset.addEventListener("input", syncFlip);
  map.addEventListener("pointerup", syncFlip);

  // ---- Lifecycle ----
  let busy = false;
  const all = [backupBtn, insertBtn, deleteBtn, sealBtn, unlockBtn, flipBtn];
  async function guard(f, rethrow) {
    if (busy) return;
    busy = true;
    all.forEach((b) => { b.disabled = true; });
    try {
      await f();
    } catch (err) {
      if (rethrow) throw err;
      live.textContent = err.message;
    } finally {
      busy = false;
      all.forEach((b) => { b.disabled = false; });
    }
  }

  async function init() {
    const r = await call("init", { seed: 1, avg: Number(avg.value) });
    backups = [];
    repo = null;
    rows.replaceChildren();
    totals.replaceChildren();
    packSel.replaceChildren();
    pack = null;
    lastBackupChunks = new Set();
    showSlot(r.slot);
    unlockOut.textContent = "";
    return r;
  }

  await cssReady;
  ta.value = text;
  fit();
  await guard(async () => {
    await init();
    await backup(false);
    insert();
    await scan();
    await backup(false);
    await scan();
  }, true);
}
