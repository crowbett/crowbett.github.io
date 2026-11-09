// The code panel: tabs between a project's excerpts, and a live trace. Each
// answered demo call (demo.js's "demo:call") lights the excerpts whose source
// that call runs, counts it on their tab, and sweeps a beam down the code.
const root = document.querySelector("[data-code]");
const fmt = (n) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`);

if (root) {
  const slug = root.dataset.code;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll(".code-ex")];
  // "render sampling=nee": the method, and the params a call needs to run this code.
  const calls = panels.map((p) => p.dataset.calls.split("|").filter(Boolean).map((c) => {
    const [method, ...need] = c.split(" ");
    return { method, need: need.map((kv) => kv.split("=")) };
  }));
  const runs = (c, method, params) => c.some((x) => x.method === method && x.need.every(([k, v]) => String(params?.[k]) === v));
  const titles = panels.map((p) => p.querySelector(".cx-t").textContent);

  const select = (i, focus) => {
    tabs.forEach((t, j) => { t.setAttribute("aria-selected", String(i === j)); t.tabIndex = i === j ? 0 : -1; });
    panels.forEach((p, j) => { p.hidden = i !== j; });
    if (focus) tabs[i].focus();
  };
  if (tabs.length) {
    root.querySelector("[data-code-tabs]").hidden = false;
    select(0);
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(i));
      t.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const to = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : step === undefined ? -1 : (i + step + tabs.length) % tabs.length;
        if (to < 0) return;
        e.preventDefault();
        select(to, true);
      });
    });
  }

  // Lines arrive in a quick cascade the first time a panel scrolls into view.
  for (const p of panels) p.querySelectorAll(".l").forEach((l, i) => l.style.setProperty("--i", String(Math.min(i, 40))));
  root.classList.add("cue");
  const seen = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add("seen"); seen.unobserve(e.target); }
  }, { rootMargin: "0px 0px -15% 0px" });
  seen.observe(root);

  const counts = panels.map(() => 0);
  const trace = root.querySelector("[data-code-trace]");
  const led = trace?.querySelector(".led");
  const text = trace?.querySelector("[data-trace-text]");
  const link = document.querySelector("[data-code-link]");
  const total = link?.querySelector("[data-code-total]");
  let sum = 0, lastMethod = "", lastHit = -1, raf = 0, idle = 0;
  const flash = (el, cls) => {
    if (!el || el.classList.contains(cls)) return;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  };
  const paint = () => {
    raf = 0;
    panels.forEach((p, i) => {
      const badge = tabs[i]?.querySelector("[data-ran]");
      if (badge && counts[i]) badge.textContent = fmt(counts[i]);
    });
    if (total) total.textContent = fmt(sum);
    if (text && lastHit >= 0) {
      text.textContent = `${lastMethod} → ${titles[lastHit]}`;
      led.textContent = "live";
      led.classList.remove("off");
    }
  };
  document.addEventListener("demo:call", (e) => {
    if (e.detail.slug !== slug) return;
    let hit = -1;
    calls.forEach((c, i) => {
      if (!runs(c, e.detail.method, e.detail.params)) return;
      counts[i]++;
      sum++;
      if (hit < 0 || !panels[i].hidden) hit = i;
      if (panels[i].hidden) flash(tabs[i], "ping"); else flash(panels[i], "hot");
    });
    if (hit < 0) return;
    lastMethod = e.detail.method;
    lastHit = hit;
    if (link) link.hidden = false;
    flash(link, "ping");
    if (!raf) raf = requestAnimationFrame(paint);
    clearTimeout(idle);
    idle = setTimeout(() => { if (led) { led.textContent = "idle"; led.classList.add("off"); } }, 2500);
  });
}
