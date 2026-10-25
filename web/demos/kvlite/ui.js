// kvlite demo: the real engine writing real segment, hint and MANIFEST files
// to an in-memory file system in this tab.
const SVG = "http://www.w3.org/2000/svg";
const INTRO = [
  ["put", { key: "user:1", value: "alice" }],
  ["put", { key: "user:2", value: "bob" }],
  ["put", { key: "user:1", value: "carol" }],
  ["delete", { key: "user:2" }],
];
const TEARS = [["0", "nothing torn"], ["5", "last 5 bytes torn"], ["30", "last 30 bytes torn"]];

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
const bytes = (n) => `${n.toLocaleString("en-US")} B`;

function field(label, input, cls) {
  const wrap = el("label", "demo-field kv-field" + (cls ? " " + cls : ""));
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function input(name, value, max) {
  const i = el("input");
  Object.assign(i, { type: "text", name, value, maxLength: max, spellcheck: false, autocomplete: "off", className: "kv-mono" });
  return i;
}

function button(text, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  return b;
}

function stats(s) {
  const wrap = el("div", "kv-stats");
  const total = s.liveBytes + s.deadBytes;
  const bar = svg("svg", { viewBox: "0 0 100 8", preserveAspectRatio: "none", role: "img",
    "aria-label": `${bytes(s.liveBytes)} live, ${bytes(s.deadBytes)} dead` });
  const live = total ? (100 * s.liveBytes) / total : 0;
  bar.append(svg("rect", { class: "kv-live", x: 0, y: 0, width: live, height: 8 }),
    svg("rect", { class: "kv-dead", x: live, y: 0, width: 100 - live, height: 8 }));
  const dl = el("dl", "kv-facts");
  for (const [k, v] of [
    ["Keys", String(s.keys)],
    ["Segments", String(s.segments)],
    ["Live", bytes(s.liveBytes)],
    ["Dead", `${bytes(s.deadBytes)} (${Math.round(100 * s.deadRatio)}%)`],
    ["Compactions", String(s.compactions)],
    ["Reclaimed", bytes(s.reclaimedBytes)],
  ]) {
    const d = el("div");
    d.append(el("dt", null, k), el("dd", "kv-mono", v));
    dl.append(d);
  }
  wrap.append(bar, dl);
  return wrap;
}

function segmentTable(seg) {
  const box = el("section", "kv-seg");
  const name = String(seg.id).padStart(8, "0") + ".log";
  const head = el("h4", "kv-seg-h");
  head.append(el("span", "kv-mono", name), el("span", "kv-seg-meta",
    [seg.active ? "active" : "sealed", bytes(seg.bytes), seg.hint ? "hint file" : ""].filter(Boolean).join(" · ")));
  box.append(head);
  if (seg.torn) box.append(el("p", "kv-torn", seg.torn));
  if (seg.records.length === 0) {
    box.append(el("p", "kv-empty", "Header only (16 bytes), no records."));
    return box;
  }
  const scroll = el("div", "kv-scroll");
  // It scrolls both ways, so it is focusable here; the frame only handles sideways boxes.
  Object.assign(scroll, { tabIndex: 0 });
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", `Records in ${name}`);
  const t = el("table", "kv-table");
  const tr = el("tr");
  for (const c of ["Offset", "Bytes", "Record", "Key", "Value"]) tr.append(el("th", null, c));
  const thead = el("thead");
  thead.append(tr);
  const tbody = el("tbody");
  for (const r of seg.records) {
    const row = el("tr", r.kind === "delete" ? "kv-tomb" : null);
    row.append(el("td", "kv-mono", String(r.off)), el("td", "kv-mono", String(r.size)), el("td", null, r.kind),
      el("td", "kv-mono", r.key), el("td", "kv-mono kv-val", r.value));
    tbody.append(row);
  }
  t.append(thead, tbody);
  scroll.append(t);
  box.append(scroll);
  if (seg.more) box.append(el("p", "kv-empty", `${seg.more} older records not shown.`));
  return box;
}

function filesList(files) {
  const ul = el("ul", "kv-files");
  for (const f of files) {
    const li = el("li");
    li.append(el("span", "kv-mono", f.name), el("span", "kv-mono kv-size", bytes(f.size)));
    ul.append(li);
  }
  return ul;
}

function keysList(v) {
  const ul = el("ul", "kv-keys");
  for (const kv of v.keys) {
    const li = el("li");
    li.append(el("span", "kv-mono", kv.key), el("span", "kv-mono kv-val", kv.value));
    ul.append(li);
  }
  if (v.keys.length === 0) ul.append(el("li", "kv-empty", "No keys."));
  if (v.keysMore) ul.append(el("li", "kv-empty", `and ${v.keysMore} more`));
  return ul;
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

  const key = input("key", "user:3", 64);
  const value = input("value", "dave", 256);
  const put = button("Put");
  const del = button("Delete", "secondary");
  const get = button("Get", "secondary");
  const bulk = button("Write 20 keys", "secondary");
  const compact = button("Compact");
  const tear = el("select");
  tear.name = "tear";
  for (const [v, t] of TEARS) {
    const o = el("option", null, t);
    o.value = v;
    tear.append(o);
  }
  const crash = button("Crash and reopen", "secondary");
  const reset = button("Reset", "secondary");

  const form = el("form", "kv-controls");
  form.addEventListener("submit", (e) => { e.preventDefault(); put.click(); });
  const ops = el("div", "kv-row");
  ops.append(put, del, get, bulk);
  form.append(field("Key", key), field("Value", value, "kv-grow"), ops);
  const maint = el("div", "kv-controls");
  maint.append(compact, field("On crash", tear), crash, reset);
  const note = el("p", "kv-note", "Crash and reopen drops the store without Close, as a killed process would, and removes the LOCK file it leaves behind: the browser has no file locks, so kvlite falls back to an O_EXCL file that an operator removes by hand. A tear cuts bytes off the end of the active segment, the way a power cut can leave the last write half on disk. Then kvlite's own Open recovers: it truncates the torn record and logs it. If a decodable record turns up inside the torn record's remaining bytes, kvlite cannot prove the tail was torn and refuses to open with ErrCorrupt, by design.");

  const status = el("p", "demo-out kv-status");
  status.setAttribute("aria-live", "polite");
  const statsBox = el("div");
  const segs = el("div", "kv-segs");
  const side = el("div", "kv-side");
  const filesBox = el("div");
  const keysBox = el("div");
  const logBox = el("pre", "kv-log");
  side.append(el("h4", "kv-sub", "Files"), filesBox, el("h4", "kv-sub", "Keys (snapshot)"), keysBox, el("h4", "kv-sub", "Engine log"), logBox);
  const body = el("div", "kv-body");
  body.append(segs, side);
  root.replaceChildren(form, maint, note, status, statsBox, body);

  let last = null;
  function render(v) {
    last = v;
    statsBox.replaceChildren(stats(v.stats));
    segs.replaceChildren(...v.segments.map(segmentTable));
    filesBox.replaceChildren(filesList(v.files));
    keysBox.replaceChildren(keysList(v));
    logBox.textContent = v.log.length ? v.log.join("\n") : "Nothing logged yet.";
  }

  // closed clears the view when kvlite refused to open the store: nothing on
  // screen may claim to be its current state.
  function closed() {
    statsBox.replaceChildren();
    segs.replaceChildren(el("p", "kv-empty", "The store is closed. Reset starts an empty one."));
    filesBox.replaceChildren();
    keysBox.replaceChildren();
    logBox.textContent = "";
  }

  let busy = Promise.resolve();
  // run serializes calls: the store is one engine and each click waits its turn.
  function run(steps, say) {
    busy = busy.then(async () => {
      const before = last;
      const t0 = performance.now();
      let v;
      try {
        for (const [m, p] of steps) v = await demo.call(m, p);
      } catch (err) {
        status.textContent = err.message;
        // A failed step can follow ones that landed: show the store as it is.
        try { render(await demo.call("state", {})); } catch { closed(); }
        return;
      }
      render(v);
      status.textContent = `${say(v, before)} kvlite, in ${Math.round(performance.now() - t0)} ms, in your browser.`;
    }).catch((err) => { status.textContent = err.message; });
    return busy;
  }
  // Each click captures its inputs: a queued call must report what it ran.
  const k = () => ({ key: key.value, value: value.value });
  put.addEventListener("click", () => { const p = k(); run([["put", p]], () => `Put ${p.key}: one record appended by`); });
  del.addEventListener("click", () => { const p = k(); run([["delete", p]], () => `Delete ${p.key}: one tombstone appended by`); });
  get.addEventListener("click", () => run([["get", k()]], (v) =>
    v.get.found ? `Get ${v.get.key} = ${v.get.value}, read back by` : `Get ${v.get.key}: not found, answered by`));
  let round = 0;
  bulk.addEventListener("click", () => {
    const r = ++round;
    const steps = Array.from({ length: 20 }, (_, i) => ["put", { key: `k${String(i).padStart(2, "0")}`, value: `round ${r}` }]);
    run(steps, () => `20 puts (round ${r}) through`);
  });
  // The counter restarts when the store reopens, so compare with the view just before.
  compact.addEventListener("click", () => run([["compact", {}]], (v, before) =>
    !before || v.stats.compactions > before.stats.compactions
      ? `Compaction ${v.stats.compactions}: the active segment rotated and every sealed one merged; ${bytes(v.stats.reclaimedBytes)} reclaimed so far by`
      : "Nothing to compact in an empty store, said"));
  crash.addEventListener("click", () => run([["crash", { tear: Number(tear.value) }]], (v) =>
    `Dropped without Close${v.torn ? `, ${v.torn} bytes torn off the active segment` : ""}, then reopened and recovered by`));
  reset.addEventListener("click", () => { round = 0; run([["reset", {}]], () => "Empty store opened by"); });

  await cssReady;
  const t0 = performance.now();
  let v;
  for (const [m, p] of INTRO) v = await demo.call(m, p);
  render(v);
  status.textContent = `4 writes (user:1 twice, user:2 put then deleted) through kvlite, in ${Math.round(performance.now() - t0)} ms, in your browser.`;
}
