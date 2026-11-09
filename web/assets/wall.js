// The live wall: every live demo as a tile. A tile runs its project's real
// binary while at least half of it is on screen, at most cap at once (half
// that on phones and tablets), and stops as soon as it leaves, which
// terminates its worker and frees its memory. A tile scrolled past quickly
// never starts. With reduced motion, Save-Data, a 2g/3g link or fewer than 4
// cores nothing starts on its own: Run starts a tile, stopping the one least
// in view when the cap is reached. Stop keeps a tile still until it leaves.
import { run, release, took, calm, lean } from "/assets/demo.js";

const grid = document.querySelector(".wall-grid[data-live-css]");
if (grid) {
  const css = grid.dataset.liveCss;
  const most = Number(grid.dataset.liveCap) || 1;
  const cap = matchMedia("(width < 48rem), (pointer: coarse)").matches ? Math.max(1, Math.floor(most / 2)) : most;
  for (const b of document.querySelectorAll("[data-cap]")) b.textContent = cap;
  const auto = !calm() && !lean();
  const note = document.querySelector("[data-wall-note]");
  if (auto && note) note.dataset.auto = "";
  const el = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };

  const tiles = [...grid.querySelectorAll(".wt")].map((li) => {
    const st = li.querySelector(".wt-st");
    return { li, slug: li.dataset.run, key: li.querySelector(".wt-go"), st, rest: st.textContent, ratio: 0, state: "idle", held: false, t: 0 };
  });
  const active = () => tiles.filter((x) => x.state === "loading" || x.state === "live");

  function clear(x) {
    x.ctl?.abort();
    x.demo?.close();
    if (x.layer) {
      release(x.slug, x.layer.querySelector(".demo-mount"));
      x.layer.remove();
    }
    x.plate?.remove();
    Object.assign(x, { layer: null, plate: null, ctl: null, demo: null });
    for (const k of ["demoReady", "demoError", "demoLoaded"]) delete x.li.dataset[k];
  }

  function stop(x) {
    if (x.state === "idle") return;
    const back = x.li.querySelector(".wt-screen").contains(document.activeElement);
    clear(x);
    x.state = "idle";
    x.li.dataset.state = "idle";
    x.key.textContent = "Run";
    x.key.disabled = false;
    x.st.textContent = x.rest;
    x.st.removeAttribute("title");
    if (back) x.key.focus({ preventScroll: true });
  }

  async function start(x, byHand) {
    clear(x);
    x.state = "loading";
    x.li.dataset.state = "loading";
    x.t = performance.now();
    const screen = x.li.querySelector(".wt-screen");
    const layer = el("div", "wt-live");
    layer.setAttribute("role", "region");
    layer.setAttribute("aria-label", `${x.li.querySelector("h2").textContent}, live demo`);
    const mount = el("div", "demo-mount");
    layer.append(mount);
    const plate = el("div", "wt-load");
    screen.append(layer, plate);
    const ctl = new AbortController();
    Object.assign(x, { layer, plate, ctl });
    const r = await run(x.li, {
      slug: x.slug, ui: `/demos/${x.slug}/ui.js`, css, button: x.key, status: x.st, mount,
      progressAt: (row) => plate.append(row),
      auto: !byHand,
      signal: ctl.signal,
      preventScroll: true,
      onReady: (ms) => {
        plate.remove();
        layer.dataset.on = "";
        x.state = "live";
        x.li.dataset.state = "live";
        x.st.textContent = `live · ${took(ms)}`;
        x.key.textContent = "Stop";
        x.key.disabled = false;
      },
    });
    if (x.ctl !== ctl) { r?.demo.close(); return; }
    if (!r) {
      clear(x);
      x.state = "error";
      x.li.dataset.state = "error";
      x.st.title = x.st.textContent;
      fill();
      return;
    }
    x.demo = r.demo;
    // The tile opens on the demo's main picture, as its recording does.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = x.li.dataset.focus && layer.querySelector(x.li.dataset.focus);
      if (f) layer.scrollTop = Math.max(0, f.getBoundingClientRect().top - layer.getBoundingClientRect().top + layer.scrollTop - 6);
    }));
  }

  // fill starts the tiles in view, in page order, up to the cap.
  function fill() {
    if (!auto) return;
    for (const x of tiles) {
      if (active().length >= cap) return;
      if (x.state === "idle" && !x.held && x.ratio >= 0.5) start(x, false);
    }
  }
  let wait = 0;
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const x = tiles.find((t) => t.li === e.target);
      x.ratio = e.isIntersecting ? e.intersectionRatio : 0;
      if (!e.isIntersecting) {
        stop(x);
        x.held = false;
      }
    }
    clearTimeout(wait);
    wait = setTimeout(fill, 300);
  }, { threshold: [0, 0.5, 1] });
  for (const x of tiles) {
    io.observe(x.li);
    x.key.addEventListener("click", () => {
      if (x.state === "loading") return;
      if (x.state === "live") {
        stop(x);
        x.held = true;
        return;
      }
      x.held = false;
      while (active().length >= cap) {
        const out = active().sort((a, b) => a.ratio - b.ratio || a.t - b.t)[0];
        stop(out);
      }
      start(x, true);
    });
  }
}
