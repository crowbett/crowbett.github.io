// Code peek: a home panel's Code button flips its screen over to the
// project's first excerpt of real source (/code/<slug>.json, highlighted by
// the build); pressed again, or Escape inside it, flips back.
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

for (const b of document.querySelectorAll("[data-peek]")) {
  const slug = b.dataset.peek;
  const face = document.getElementById(b.getAttribute("aria-controls"));
  const view = face?.closest(".it-view");
  if (!view) continue;
  let loaded = null;
  const load = () => (loaded ??= fetch(`/code/${slug}.json`).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }).then(render).catch((e) => { loaded = null; throw e; }));

  function render(x) {
    const to = x.f + x.l.length - 1;
    const head = el("p", "pk-h");
    head.append(el("b", null, x.t), el("span", null, `${x.p}:${x.f}–${to}`));
    const pre = el("pre", "pk-c");
    pre.tabIndex = 0;
    pre.setAttribute("role", "region");
    pre.setAttribute("aria-label", `${x.p}, lines ${x.f} to ${to}`);
    const code = el("code");
    x.l.forEach((h, i) => {
      const l = el("span", "l");
      const n = el("span", "ln", String(x.f + i));
      n.setAttribute("aria-hidden", "true");
      // Lines are the build's own escaped HTML, token spans only (checkCode).
      const t = document.createElement("template");
      t.innerHTML = h;
      l.append(n, t.content, "\n");
      code.append(l);
    });
    pre.append(code);
    const more = el("a", "pk-more", x.n > 1 ? `All ${x.n} excerpts on its page` : "On its page");
    more.href = `/projects/${slug}/#code-0`;
    face.replaceChildren(head, el("p", "pk-y", x.y), pre, more);
  }

  b.addEventListener("click", async () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    if (on) {
      try { await load(); } catch { b.textContent = "Code didn't load"; return; }
    }
    b.textContent = "Code";
    b.setAttribute("aria-pressed", String(on));
    face.hidden = !on;
    view.toggleAttribute("data-peek", on);
  });
  face.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    b.click();
    b.focus();
  });
}
