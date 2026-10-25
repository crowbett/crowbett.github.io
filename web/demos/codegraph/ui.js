// codegraph demo: codegraph's real indexer, resolver and SQLite graph, compiled to
// WebAssembly. A four-file Rust sample is indexed in the tab; pick a function to see
// its callers and callees exactly as the resolver reports them, with each edge's confidence.
const START = "src/main.rs:11";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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

  const info = await demo.call("sample", {});
  const prefix = `${info.root}/`;
  const rel = (p) => (p && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  const files = new Map(info.files.map((f) => [f.path, f]));
  const symbols = new Map();
  for (const f of info.files) for (const s of f.symbols) symbols.set(s.spec, { ...s, file: f.path });
  const label = (s) => (s.owner ? `${s.owner}::${s.name}` : s.name);

  const form = el("form", "cg-controls");
  form.addEventListener("submit", (e) => e.preventDefault());
  const pick = el("select");
  pick.name = "symbol";
  for (const f of info.files) {
    const group = el("optgroup");
    group.label = f.path;
    for (const s of f.symbols) {
      const o = el("option", null, `${label(s)} · line ${s.line}`);
      o.value = s.spec;
      group.append(o);
    }
    pick.append(group);
  }
  const field = el("label", "demo-field cg-field");
  field.append(el("span", "demo-label", "Function or method"), pick);
  form.append(field);

  const summary = el("p", "cg-summary");
  summary.setAttribute("aria-live", "polite");

  const lists = {};
  const graph = el("div", "cg-graph");
  for (const [dir, title] of [["callers", "Callers"], ["callees", "Callees"]]) {
    const sec = el("section", "cg-col");
    const h = el("h3", "demo-label", title);
    h.id = `cg-${dir}`;
    const ul = el("ul", "cg-edges");
    ul.setAttribute("aria-labelledby", h.id);
    sec.append(h, ul);
    graph.append(sec);
    lists[dir] = ul;
  }

  const codeHead = el("p", "demo-label cg-code-head");
  const code = el("pre", "cg-code");
  code.tabIndex = 0;
  code.setAttribute("role", "region");

  const c = info.counts;
  const foot = el(
    "p",
    "cg-foot",
    `Indexed in this tab: ${plural(info.files.length, "file", "files")}, ${c.symbols} symbols, ` +
      `${c.edges} edges (imports excluded), ${c.resolved} resolved to a definition: ` +
      `${c.exact} exact, ${c.likely} likely, ${c.name_only} name_only.`,
  );

  root.replaceChildren(form, summary, graph, codeHead, code, foot);

  const badge = (conf) => el("span", `cg-conf cg-${conf || "none"}`, conf || "unresolved");

  function edge(n, dir) {
    const li = el("li", "cg-edge");
    const site = rel(n.site);
    const where = [];
    if (site) where.push(`${dir === "callers" ? "calls at" : "at"} ${site}`);
    if (n.sites > 1) where.push(`${n.sites} sites`);
    if (n.via) where.push(`via ${n.via}`);
    if (n.as_value) where.push("as value");
    let name;
    if (n.qname) {
      const spec = `${rel(n.file)}:${n.line}`;
      name = el("button", "cg-go", n.qname);
      name.type = "button";
      name.dataset.spec = spec;
      name.addEventListener("click", () => select(spec, true));
    } else {
      name = el("code", "cg-ext", n.external);
    }
    li.append(name, badge(n.confidence), el("span", "cg-where", where.join(" · ")));
    return li;
  }

  function fill(dir, tree) {
    const kids = tree.roots[0].children || [];
    const ul = lists[dir];
    if (!kids.length) {
      ul.replaceChildren(el("li", "cg-empty", dir === "callers" ? "No callers in the sample" : "No calls"));
    } else {
      ul.replaceChildren(...kids.map((n) => edge(n, dir)));
    }
    return kids;
  }

  function show(sym, sites) {
    const f = files.get(sym.file);
    codeHead.textContent = f.path;
    code.setAttribute("aria-label", `Source of ${f.path}`);
    const lines = f.text.replace(/\n$/, "").split("\n");
    let first = null;
    code.replaceChildren(...lines.map((text, i) => {
      const n = i + 1;
      const row = el("span", "cg-line");
      if (n >= sym.line && n <= sym.end_line) row.classList.add("cg-def");
      if (sites.has(n)) row.classList.add("cg-site");
      if (n === sym.line) first = row;
      row.append(el("span", "cg-ln", String(n)), document.createTextNode(text || " "));
      return row;
    }));
    if (first) code.scrollTop = first.previousSibling ? first.previousSibling.offsetTop : 0;
  }

  let seq = 0;
  let shown = null;
  // Errors land here for every caller: only the latest request may report, and the
  // picker goes back to the symbol still on screen. Before anything is shown, mount fails.
  async function select(spec, focus) {
    const sym = symbols.get(spec);
    if (!sym) return;
    const mine = ++seq;
    pick.value = spec;
    let callers, callees;
    try {
      [callers, callees] = await Promise.all([
        demo.call("callers", { symbol: spec }),
        demo.call("callees", { symbol: spec }),
      ]);
    } catch (err) {
      if (!shown) throw err;
      if (mine === seq) {
        pick.value = shown;
        summary.textContent = err.message;
      }
      return;
    }
    if (mine !== seq) return;
    const up = fill("callers", callers);
    const down = fill("callees", callees);
    const open = down.filter((n) => !n.confidence).length;
    const sites = new Set();
    for (const n of down) {
      const s = rel(n.site);
      if (s && s.startsWith(`${sym.file}:`)) sites.add(Number(s.slice(sym.file.length + 1)));
    }
    show(sym, sites);
    shown = spec;
    summary.textContent =
      `${callees.roots[0].qname} (${sym.file}:${sym.line}): ${plural(up.length, "caller", "callers")}; ` +
      `${plural(down.length, "callee", "callees")}, ${down.length - open} resolved, ${open} unresolved.`;
    if (focus) pick.focus();
  }

  pick.addEventListener("change", () => select(pick.value));

  await cssReady;
  await select(symbols.has(START) ? START : symbols.keys().next().value);
}
