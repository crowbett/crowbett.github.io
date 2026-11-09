// AnchorFlow demo: a basket you build, answered by AnchorFlow's real packaging
// fit engine (internal/packfit) against its reference catalog. The answer is
// drawn from the placements the engine accepted, top-down and from the front.
const SVG = "http://www.w3.org/2000/svg";
const LINE_COLORS = 6;

// Dimensions are the ones the engine's own tests pin for each class.
const PRESETS = [
  { name: "Dropper bottle", class: "LIQUID", l: 1.5, w: 1.5, h: 4.5 },
  { name: "Supplement bottle", class: "CAPS", l: 2.75, w: 2.75, h: 4.75 },
  { name: "Small pill bottle", class: "CAPS", l: 2, w: 2, h: 3.5 },
  { name: "Powder tub", class: "TUB", l: 3.5, w: 3.5, h: 4.5 },
  { name: "Coffee bag", class: "BAG", l: 8.75, w: 4.5, h: 2.25 },
  { name: "Folded T-shirt", class: "TS", l: 7.75, w: 6.75, h: 0.25 },
  { name: "Cap", class: "HAT", l: 8, w: 6.5, h: 4.5 },
  { name: "Challenge coin", class: "COIN", l: 1.75, w: 1.75, h: 0.1 },
  { name: "Shaker bottle", class: "SHAKER", l: 3.75, w: 3.75, h: 8.75 },
  { name: "Rolled poster", class: "POSTER", l: 24, w: 2, h: 2 },
  { name: "Boxed item", class: "", l: 10, w: 8, h: 3.5 },
];
// A shaker with two bottles: the shaker forces a box and lies down in it.
const START = [
  { preset: 8, qty: 1 },
  { preset: 1, qty: 2 },
];
const KIND = { box: "box", poly_mailer: "poly mailer", poly_bubble_mailer: "bubble mailer", bubble_bag: "bubble bag", tube: "tube" };

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
const inches = (n) => `${Number(n.toFixed(2))}"`;
const dims = (l, w, h) => `${Number(l.toFixed(2))} × ${Number(w.toFixed(2))} × ${Number(h.toFixed(2))}`;
const money = (n) => `$${n.toFixed(2)}`;

function field(label, input, cls) {
  const wrap = el("label", `demo-field ${cls || ""}`.trim());
  wrap.append(el("span", "demo-label", label), input);
  return wrap;
}

function numberInput(name, value, min, max, step) {
  const i = el("input");
  Object.assign(i, { type: "number", name, value: String(value), min: String(min), max: String(max), step: String(step), inputMode: "decimal" });
  return i;
}

function classSelect(classes, value) {
  const s = el("select");
  s.name = "class";
  const plain = el("option", null, "plain rigid item");
  plain.value = "";
  s.append(plain);
  for (const c of classes) {
    const traits = [c.forcesBox && "box only", c.fragile && "fragile", c.soft && "soft", c.round && "round"].filter(Boolean);
    const o = el("option", null, traits.length ? `${c.class} (${traits.join(", ")})` : c.class);
    o.value = c.class;
    s.append(o);
  }
  s.value = value;
  return s;
}

// view draws one projection of the accepted arrangement: a = the horizontal
// axis ("x"), b = the vertical one ("y" top-down, "z" from the front).
function view(title, plan, units, b) {
  const W = plan.usableL, H = b === "y" ? plan.usableW : plan.usableH;
  const pad = Math.max(W, H) * 0.04;
  const fig = el("figure", "af-view");
  const g = svg("svg", {
    viewBox: `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`,
    role: "img",
    "aria-label": `${title}: ${plan.placements.length} items in ${dims(plan.usableL, plan.usableW, plan.usableH)} inches`,
  });
  g.append(svg("rect", { class: "af-bin", x: 0, y: 0, width: W, height: H, "vector-effect": "non-scaling-stroke" }));
  if (b === "y" && plan.structure) {
    for (const [x, y, w, h] of plan.structure.cells) {
      g.append(svg("rect", { class: "af-cell", x, y, width: w, height: h, "vector-effect": "non-scaling-stroke" }));
    }
  }
  // Draw far-to-near so the nearer item covers the one behind it.
  const order = [...plan.placements].sort((p, q) => (b === "y" ? p.z - q.z : q.y - p.y));
  for (const p of order) {
    const u = units[p.index];
    const y = b === "y" ? p.y : H - p.z - p.dz;
    const h = b === "y" ? p.dy : p.dz;
    const r = svg("rect", {
      class: `af-item af-c${u.line % LINE_COLORS}`,
      x: p.x, y, width: p.dx, height: h,
      "vector-effect": "non-scaling-stroke",
    });
    const t = svg("title", {});
    t.textContent = `${u.name || u.class || "item"}: ${dims(p.dx, p.dy, p.dz)} at (${dims(p.x, p.y, p.z)})`;
    r.append(t);
    g.append(r);
  }
  fig.append(g, el("figcaption", "af-cap", `${title} · ${inches(W)} × ${inches(H)}`));
  return fig;
}

const usableFit = (p) => !p.excluded && p.engineFits;

// verdict says why the engine took or passed over p. The engine's order is
// the cheapest usable mailer that fits, else the cheapest usable box; the
// reasons for barring a package come from the engine itself.
function verdict(p, answer) {
  if (p.suggested) return "the answer";
  if (p.excluded) return p.excluded;
  if (!p.engineFits) return "too small";
  if (answer && answer.kind !== "box" && p.kind === "box") return "fits, but a mailer fits too";
  if (answer && p.marginalCost === answer.marginalCost) return "fits, same cost but larger";
  return "fits, costs more";
}

function candidatesTable(packages) {
  const answer = packages.find((p) => p.suggested);
  const wrap = el("details", "af-table");
  wrap.append(el("summary", null, `Every package judged: ${packages.filter(usableFit).length} of ${packages.length} usable and big enough`));
  wrap.append(el("p", "af-dim af-note", "The engine takes the cheapest usable mailer the basket fits, else the cheapest usable box. Cost is what the engine counts: the package plus tape, inserts and wrap."));
  const t = el("table");
  const head = el("tr");
  for (const h of ["Package", "Kind", "Cost", "Verdict"]) head.append(el("th", null, h));
  const thead = el("thead");
  thead.append(head);
  const body = el("tbody");
  const rank = (p) => (p.suggested ? 0 : usableFit(p) ? 1 : !p.excluded ? 2 : 3);
  const rows = [...packages].sort((a, b) => rank(a) - rank(b) || a.marginalCost - b.marginalCost);
  for (const p of rows) {
    const tr = el("tr", p.suggested ? "af-answer" : usableFit(p) ? "" : "af-nofit");
    for (const v of [p.name, KIND[p.kind] || p.kind, money(p.marginalCost), verdict(p, answer)]) tr.append(el("td", null, v));
    body.append(tr);
  }
  t.append(thead, body);
  const scroll = el("div", "af-scroll");
  scroll.append(t);
  wrap.append(scroll);
  return wrap;
}

export async function mount(root, demo) {
  const css = el("link");
  css.rel = "stylesheet";
  css.href = new URL("./ui.css", import.meta.url).href;
  const cssReady = new Promise((r) => { css.onload = r; css.onerror = r; });
  document.head.append(css);

  const cat = await demo.call("catalog", {});
  const lines = START.map(({ preset, qty }) => ({ ...PRESETS[preset], qty }));
  const off = new Set();

  const wrap = el("div", "af");
  const adder = el("form", "af-add");
  adder.addEventListener("submit", (e) => { e.preventDefault(); add(); });
  const pick = el("select");
  pick.name = "preset";
  PRESETS.forEach((p, i) => {
    const o = el("option", null, `${p.name} (${p.class || "plain"}, ${dims(p.l, p.w, p.h)})`);
    o.value = String(i);
    pick.append(o);
  });
  const addBtn = el("button", null, "Add to basket");
  addBtn.type = "submit";
  adder.append(field("Item", pick, "af-pick"), addBtn);

  const basket = el("ol", "af-basket");
  basket.setAttribute("aria-label", "Basket");

  const shelf = el("details", "af-shelf");
  const shelfSum = el("summary");
  const shelfList = el("ul", "af-shelf-list");
  shelf.append(shelfSum, shelfList);
  for (const p of cat.packages) {
    const li = el("li");
    const cb = el("input");
    Object.assign(cb, { type: "checkbox", checked: true, name: "shelf" });
    cb.addEventListener("change", () => { if (cb.checked) off.delete(p.name); else off.add(p.name); shelfCount(); run(); });
    const lab = el("label");
    lab.append(cb, el("span", null, ` ${p.name}`), el("span", "af-dim", ` ${KIND[p.kind] || p.kind}, ${money(p.unitCost)}`));
    li.append(lab);
    shelfList.append(li);
  }
  const shelfCount = () => { shelfSum.textContent = `Packaging on the shelf: ${cat.packages.length - off.size} of ${cat.packages.length}`; };
  shelfCount();

  const answer = el("div", "af-answer-box");
  const views = el("div", "af-views");
  const table = el("div");
  const status = el("p", "demo-out af-status");
  status.setAttribute("aria-live", "polite");
  wrap.append(adder, basket, shelf, answer, views, table, status);
  root.replaceChildren(wrap);

  function units() { return lines.reduce((n, l) => n + l.qty, 0); }

  function renderBasket() {
    basket.replaceChildren();
    lines.forEach((l, i) => {
      const li = el("li", `af-line af-c${i % LINE_COLORS}`);
      li.append(el("span", "af-swatch"), el("strong", "af-name", l.name));
      const cls = classSelect(cat.classes, l.class);
      cls.addEventListener("change", () => { l.class = cls.value; run(); });
      const inputs = ["l", "w", "h"].map((k) => {
        const n = numberInput(k, l[k], 0.05, cat.maxSide, 0.05);
        n.addEventListener("input", () => { if (n.validity.valid && n.value !== "") { l[k] = Number(n.value); later(); } else bad(`${l.name}: each side is 0.05 to ${cat.maxSide} inches.`); });
        return n;
      });
      const qty = numberInput("qty", l.qty, 1, cat.maxUnits, 1);
      qty.addEventListener("input", () => {
        const v = Number(qty.value);
        if (qty.validity.valid && qty.value !== "" && units() - l.qty + v <= cat.maxUnits) { l.qty = v; later(); }
        else bad(`The engine answers baskets of at most ${cat.maxUnits} units.`);
      });
      const rm = el("button", "secondary af-rm", "Remove");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${l.name}`);
      rm.addEventListener("click", () => { lines.splice(i, 1); renderBasket(); run(); });
      li.append(field("Class", cls, "af-class"), field("L", inputs[0], "af-n"), field("W", inputs[1], "af-n"), field("H", inputs[2], "af-n"), field("Qty", qty, "af-n"), rm);
      basket.append(li);
    });
    addBtn.disabled = units() >= cat.maxUnits;
  }

  function add() {
    if (units() >= cat.maxUnits) return;
    lines.push({ ...PRESETS[Number(pick.value)], qty: 1 });
    renderBasket();
    run();
  }

  function bad(msg) {
    seq++;
    status.textContent = msg;
  }

  let seq = 0;
  async function run(first = false) {
    const mine = ++seq;
    if (!lines.length) {
      answer.replaceChildren(el("p", null, "The basket is empty. Add an item."));
      views.replaceChildren();
      table.replaceChildren();
      status.textContent = "";
      return;
    }
    const params = { lines: lines.map(({ name, class: c, l, w, h, qty }) => ({ name, class: c, l, w, h, qty })), exclude: [...off] };
    const t0 = performance.now();
    let r;
    try {
      r = await demo.call("plan", params);
    } catch (err) {
      if (first) throw err;
      if (mine === seq) status.textContent = err.message;
      return;
    }
    const ms = performance.now() - t0;
    if (mine !== seq) return;

    const pick = r.packages.find((p) => p.suggested);
    const head = el("p", "af-verdict");
    if (pick) {
      head.append(el("span", "demo-label", "Engine's answer"), el("strong", "af-pkg", pick.name),
        el("span", "af-dim", `${KIND[pick.kind] || pick.kind}, ${pick.kind === "box" ? dims(pick.l, pick.w, pick.h) : `${Number(pick.l.toFixed(2))} × ${Number(pick.w.toFixed(2))}`} in, ${money(pick.marginalCost)} all in`));
    } else {
      head.append(el("span", "demo-label", "Engine's answer"), el("strong", "af-pkg", "none"),
        el("span", "af-dim", "Nothing on the shelf fits, so the engine stays silent and a person decides."));
    }
    answer.replaceChildren(head);
    if (pick && !pick.packed) {
      // The fit rules and the drawing's packer are separate checks; say so
      // rather than hide the drawing when they disagree.
      answer.append(el("p", "af-dim", `The drawing seats ${pick.placements.length} of ${r.units.length} units. The fit rules accept this basket; the packer that draws it could not place the rest.`));
    }
    if (pick && pick.placements.length) {
      views.replaceChildren(view("Top-down", pick, r.units, "y"), view("From the front", pick, r.units, "z"));
    } else {
      views.replaceChildren();
    }
    const wasOpen = Boolean(table.querySelector("details")?.open);
    const judged = candidatesTable(r.packages);
    judged.open = wasOpen;
    table.replaceChildren(judged);
    status.textContent = `${r.units.length} units judged against ${r.packages.length} packages in ${Math.round(ms)} ms, in your browser.`;
  }

  let timer;
  function later() { clearTimeout(timer); timer = setTimeout(run, 200); }

  renderBasket();
  await cssReady;
  await run(true);
}
