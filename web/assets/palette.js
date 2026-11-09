// The command palette: every project plus what this page can do, narrowed as
// you type. A modal <dialog> keeps focus inside and closes on Escape; the input
// is a combobox over a listbox, so a screen reader hears the active option.
// Loaded on first use by nav.js; /search.json is written by the site build.
const data = fetch("/search.json").then((r) => r.json());
let dlg, input, list, count, shown = [], active = 0, projects = [];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("p", "toast", msg);
  t.setAttribute("role", "status");
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

// What this page can do (ahead of the projects) and how to reach me (after).
function actions() {
  const out = [];
  const start = document.querySelector("[data-demo-start]");
  if (start && !start.disabled && !document.querySelector("[data-demo-ready]")) {
    out.push({ tag: "run", title: "Run the live demo", run: () => { start.closest("[data-demo]").scrollIntoView({ block: "start" }); start.click(); } });
  }
  const full = document.querySelector("[data-demo-full][data-on]");
  if (full) out.push({ tag: "view", title: full.textContent.trim(), run: () => full.click() });
  for (const [rel, word, key] of [["prev", "Previous", "["], ["next", "Next", "]"]]) {
    const a = document.querySelector(`.pager [rel=${rel}]`);
    if (a) out.push({ tag: "go", title: `${word}: ${a.lastChild.textContent.trim()}`, key, href: a.pathname });
  }
  if (location.pathname !== "/") out.push({ tag: "go", title: "Work index", href: "/#work" });
  if (location.pathname !== "/numbers/") out.push({ tag: "go", title: "Numbers: every measurement and binary", href: "/numbers/" });
  out.push({ tag: "shell", title: "Open the terminal", key: "`", run: () => import("/assets/nav.js").then((m) => m.openShell()) });
  out.push({ tag: "theme", title: "Switch light and dark", key: "t", run: () => import("/assets/nav.js").then((m) => m.toggleTheme()) });
  const mail = document.querySelector('.top a[href^="mailto:"]');
  if (mail) {
    const addr = mail.href.slice(7);
    out.push({ tag: "copy", contact: true, title: "Copy email address", run: () => navigator.clipboard.writeText(addr).then(() => toast(`Copied ${addr}`), () => toast(addr)) });
    out.push({ tag: "mail", contact: true, title: "Write an email", href: mail.href });
  }
  return out;
}

// Every word must hit the title, or failing that the language, topics, group
// or tagline; title hits rank first. A word with no hit can still match the
// title as a subsequence ("rlim" finds ratelimitd).
function score(p, words) {
  let s = 0;
  for (const w of words) {
    const t = p.title.toLowerCase();
    if (t.startsWith(w)) s += 100;
    else if (t.includes(w)) s += 60;
    else if (p.hay.includes(w)) s += 10;
    else if ([...w].every(((i) => (c) => (i = t.indexOf(c, i) + 1) > 0)(0))) s += 5;
    else return -1;
  }
  return s;
}

function marked(text, words) {
  const span = el("b");
  const lower = text.toLowerCase();
  const w = words.find((x) => lower.includes(x));
  if (!w) { span.textContent = text; return span; }
  const i = lower.indexOf(w);
  span.append(text.slice(0, i), el("mark", null, text.slice(i, i + w.length)), text.slice(i + w.length));
  return span;
}

function option(item, words) {
  const li = el("li", "pal-o");
  li.setAttribute("role", "option");
  li.id = `pal-o-${shown.length}`;
  shown.push(item);
  if (item.slug) {
    const dm = el("span", `dm dm-${item.slug}`);
    dm.setAttribute("aria-hidden", "true");
    dm.append(el("i", "pa"), el("i", "pb"));
    const text = el("span", "pal-t");
    text.append(marked(item.title, words), el("small", null, `${item.lang} · ${item.group}`), el("span", "pal-d", item.tagline));
    li.append(dm, text, el("span", item.live ? "led" : "led off", item.live ? "live" : "source"));
  } else {
    const text = el("span", "pal-t");
    text.append(marked(item.title, words));
    li.append(el("span", "pal-i", item.tag), text);
    if (item.key) li.append(el("kbd", null, item.key));
  }
  return li;
}

function render() {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  shown = [];
  const acts = actions().filter((a) => words.every((w) => a.title.toLowerCase().includes(w)));
  const hits = projects.map((p) => [score(p, words), p]).filter(([s]) => s >= 0);
  if (words.length) hits.sort((a, b) => b[0] - a[0] || a[1].n - b[1].n);
  const nodes = [];
  const page = acts.filter((a) => !a.contact), contact = acts.filter((a) => a.contact);
  if (page.length) nodes.push(el("li", "pal-h", "This page"), ...page.map((a) => option(a, words)));
  if (hits.length) nodes.push(el("li", "pal-h", `Projects · ${hits.length}`), ...hits.map(([, p]) => option(p, words)));
  if (contact.length) nodes.push(el("li", "pal-h", "Contact"), ...contact.map((a) => option(a, words)));
  if (!nodes.length) nodes.push(el("li", "pal-h", "Nothing matches. Try a language or a topic."));
  for (const n of nodes) if (n.className === "pal-h") n.setAttribute("role", "presentation");
  list.replaceChildren(...nodes);
  count.textContent = `${shown.length} result${shown.length === 1 ? "" : "s"}`;
  select(0);
}

function select(i) {
  if (!shown.length) { input.removeAttribute("aria-activedescendant"); return; }
  active = (i + shown.length) % shown.length;
  for (const o of list.querySelectorAll("[aria-selected]")) o.removeAttribute("aria-selected");
  const o = document.getElementById(`pal-o-${active}`);
  o.setAttribute("aria-selected", "true");
  input.setAttribute("aria-activedescendant", o.id);
  o.scrollIntoView({ block: "nearest" });
}

function go(i) {
  const item = shown[i];
  if (!item) return;
  dlg.close();
  if (item.run) item.run();
  else if (item.href.startsWith("mailto:")) location.href = item.href;
  else location.assign(item.href);
}

function build() {
  dlg = el("dialog", "pal");
  dlg.setAttribute("aria-label", "Go to a project or action");
  dlg.setAttribute("closedby", "any");
  const plate = el("div", "pal-p");
  const shut = el("button", "pal-x", "close");
  shut.type = "button";
  shut.tabIndex = -1;
  shut.addEventListener("click", () => dlg.close());
  plate.append(el("span", null, "Go to"), shut);
  const bar = el("div", "pal-in");
  input = el("input");
  Object.assign(input, { type: "text", placeholder: "Project, language or topic", autocomplete: "off", spellcheck: false, enterKeyHint: "go" });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search projects and actions");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "pal-list");
  input.setAttribute("aria-autocomplete", "list");
  bar.append(input);
  list = el("ul");
  list.id = "pal-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Results");
  count = el("p", "vh");
  count.setAttribute("role", "status");
  const foot = el("p", "pal-foot", "↑↓ move · ↵ open · esc close · j k walk the index · [ ] step projects");
  dlg.append(plate, bar, list, foot, count);
  document.body.append(dlg);

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key] ?? (e.ctrlKey && { n: 1, p: -1 }[e.key]);
    if (step) { e.preventDefault(); select(active + step); }
    else if (e.key === "Home" && e.ctrlKey) select(0);
    else if (e.key === "Enter") { e.preventDefault(); go(active); }
  });
  list.addEventListener("pointermove", (e) => {
    const o = e.target.closest("[role=option]");
    if (o && o.id !== `pal-o-${active}`) select(Number(o.id.slice(6)));
  });
  list.addEventListener("click", (e) => {
    const o = e.target.closest("[role=option]");
    if (o) go(Number(o.id.slice(6)));
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
}

export async function open() {
  if (dlg?.open) { dlg.close(); return; }
  projects = (await data).map((p) => ({ ...p, hay: [p.lang, p.group, p.tagline, ...p.tags].join(" ").toLowerCase() }));
  if (!dlg) build();
  input.value = "";
  render();
  dlg.showModal();
  input.focus();
}
