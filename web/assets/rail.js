// The rail: each section opens onto its projects, built from /search.json the
// first time a section is pointed at, focused or the drawer opens. On the
// home page the section in view is marked as you scroll; under 64rem the
// header's Sections key opens the rail as a drawer.
const rail = document.getElementById("rail");
const key = document.querySelector("[data-rail]");
let projects;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function fill(g) {
  const fly = g.querySelector(".rail-fly");
  if (fly.dataset.ready != null || fly.dataset.busy != null) return;
  fly.dataset.busy = "";
  (projects ??= fetch("/search.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })).then((all) => {
    const mine = all.filter((p) => p.group === g.dataset.group);
    const head = el("p", "rail-fh");
    const link = el("a", null, g.dataset.group);
    link.href = g.querySelector(".rail-i").getAttribute("href");
    head.append(link, el("span", null, `${mine.length} ${mine.length === 1 ? "project" : "projects"}`));
    const list = el("ul");
    for (const p of mine) {
      const a = el("a", "rail-p");
      a.href = `/projects/${p.slug}/`;
      if (location.pathname === a.pathname) a.setAttribute("aria-current", "page");
      if (p.live) {
        const img = el("img");
        img.src = `/reel/${p.slug}-n.webp`;
        img.alt = "";
        img.width = 1324;
        img.height = 828;
        img.loading = "lazy";
        img.decoding = "async";
        a.append(img);
      } else a.append(el("span", "rail-ph"));
      const t = el("span", "rail-t", p.title);
      if (p.live) t.append(el("i", null, "live"));
      a.append(t, el("span", "rail-s", p.tagline));
      const li = el("li");
      li.append(a);
      list.append(li);
    }
    fly.replaceChildren(head, list);
    fly.hidden = false;
    fly.dataset.ready = "";
  }).catch(() => { projects = undefined; }).finally(() => delete fly.dataset.busy);
}

if (rail) {
  const groups = [...rail.querySelectorAll(".rail-g")];
  for (const g of groups) {
    g.addEventListener("pointerenter", () => fill(g));
    g.addEventListener("focusin", () => fill(g));
  }

  // The home page marks the section in view.
  const spied = groups.map((g) => [g.querySelector("[data-spy]"), document.getElementById(g.querySelector("[data-spy]").dataset.spy)]).filter(([, s]) => s);
  if (spied.length) {
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting ? e.intersectionRect.height : 0);
      let best = null, most = 0;
      for (const [a, s] of spied) if ((seen.get(s) ?? 0) > most) { most = seen.get(s); best = a; }
      for (const [a] of spied) a.toggleAttribute("data-here", a === best);
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    for (const [, s] of spied) io.observe(s);
  }

  if (key) {
    key.hidden = false;
    let scrim;
    const close = (back = true) => {
      if (!rail.hasAttribute("data-open")) return;
      rail.removeAttribute("data-open");
      for (const e of document.querySelectorAll("[data-rail-inert]")) { e.inert = false; delete e.dataset.railInert; }
      key.setAttribute("aria-expanded", "false");
      scrim?.remove();
      if (back) key.focus();
    };
    key.addEventListener("click", () => {
      if (rail.hasAttribute("data-open")) return close();
      for (const g of groups) fill(g);
      rail.setAttribute("data-open", "");
      key.setAttribute("aria-expanded", "true");
      scrim = el("div", "rail-scrim");
      scrim.addEventListener("click", () => close());
      document.body.append(scrim);
      for (const e of document.querySelectorAll("body > :is(header, main, footer)")) { e.inert = true; e.dataset.railInert = ""; }
      rail.querySelector("a").focus();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    rail.addEventListener("click", (e) => { if (e.target.closest("a")) close(false); });
    matchMedia("(width >= 64rem)").addEventListener("change", (m) => { if (m.matches) close(false); });
  }
}
