// The work reel: one full-screen panel per project, each pinned under the
// header while the next slides up over it, and last the index of every
// project. The panel covering the middle of the screen is current: its
// recorded clip plays (poster only with reduced motion or Save-Data). A
// covered panel sinks as the next one slides in (scroll-driven; the
// timelines are named here), and panels buried two or more deep are not
// drawn (opacity 0, which keeps their links focusable). Focus that lands in a
// panel brings it up, so nothing focused sits under another. The dock mirrors
// the reel for the pointer (keys have Tab and j/k): a tick per project jumps
// to it, and the index at the end filters by area and language.
import { play, pause, poster } from "/assets/play.js";
const reel = document.querySelector(".reel");
if (reel) {
  const items = [...reel.querySelectorAll(".it")];
  const fin = reel.querySelector(".fin");
  const panels = fin ? [...items, fin] : items;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = reduced || navigator.connection?.saveData;
  const header = document.querySelector(".top");
  let tops = [];
  let end = 0;
  let now = null;
  let video = null;
  let jumping = null;
  let shown;

  if (CSS.supports("animation-timeline: view()") && !reduced) {
    reel.style.setProperty("timeline-scope", panels.map((_, i) => `--it${i}`).join(", "));
    panels.forEach((it, i) => {
      it.style.setProperty("view-timeline", `--it${i} block`);
      if (i === 0) return;
      const covered = panels[i - 1].querySelector(".it-in").style;
      covered.setProperty("animation-name", "sink");
      covered.setProperty("animation-timeline", `--it${i}`);
    });
  }

  const dock = document.querySelector(".dock");
  const ticks = dock ? [...dock.querySelectorAll(".dock-ticks a")] : [];
  const steps = dock ? [...dock.querySelectorAll("[data-step]")] : [];
  // The dock's number and name roll in from the direction of travel.
  let was = -1;
  const showDock = (k) => {
    if (!dock) return;
    const t = ticks[k];
    if (!t) { delete dock.dataset.on; return; }
    dock.dataset.on = "";
    const label = dock.querySelector(".dock-now");
    label.querySelector("[data-dock-n]").textContent = t.dataset.n;
    label.querySelector("[data-dock-name]").textContent = t.dataset.name;
    if (!reduced && was >= 0 && was !== k) {
      const d = k > was ? 1 : -1;
      for (const [i, x] of [...label.children].entries()) {
        x.animate([{ translate: `0 ${d * 110}%`, opacity: 0, filter: "blur(3px)" }, { translate: "0 0", opacity: 1, filter: "blur(0)" }], { duration: 420, delay: i * 40, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" });
      }
    }
    was = k;
    const go = dock.querySelector("[data-dock-go]");
    go.href = `/projects/${t.dataset.slug}/${"live" in t.dataset ? "#demo" : ""}`;
    go.textContent = "live" in t.dataset ? "Run it live" : "Open";
    ticks.forEach((x, i) => { x.toggleAttribute("data-now", i === k); x.toggleAttribute("data-past", i < k); });
    steps[0].disabled = k === 0;
  };

  // past is true once the middle of the screen is beyond the last panel: the
  // index covers them all, so every panel but the last is buried.
  function select(it, past = false) {
    if ((it || past) === shown) return;
    shown = it || past;
    if (now) delete now.dataset.now;
    if (video) {
      const v = video;
      pause(v);
      delete v.dataset.on;
      setTimeout(() => v.remove(), 400);
      video = null;
    }
    now = it;
    const k = it ? items.indexOf(it) : past ? items.length : -1;
    items.forEach((x, i) => x.toggleAttribute("data-gone", k > 0 && i < k - 1));
    showDock(k);
    if (!it) return;
    it.dataset.now = "";
    const glass = it.querySelector(".it-glass");
    if ("clip" in it.dataset && !still) {
      const shot = poster(glass);
      const v = document.createElement("video");
      Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto", poster: shot, src: shot.replace(/\.webp$/, ".mp4"), disablePictureInPicture: true });
      v.setAttribute("aria-hidden", "true");
      v.addEventListener("playing", () => { v.dataset.on = ""; });
      glass.append(v);
      video = v;
      if (!document.hidden) play(v);
    }
  }

  // Panels are measured where they sit in the flow; pinned, they report
  // where they are stuck. One taller than the screen pins once its bottom
  // edge is in view.
  const measure = () => {
    const h = header.offsetHeight;
    let y = reel.getBoundingClientRect().top + scrollY;
    tops = items.map((it) => {
      it.style.setProperty("--pin", `${Math.min(h, innerHeight - it.offsetHeight)}px`);
      const t = y;
      y += it.offsetHeight;
      return t;
    });
    end = y;
  };
  let raf = 0;
  const pick = () => {
    raf = 0;
    if (jumping) return;
    const mid = scrollY + innerHeight / 2;
    let best = null;
    if (mid < end) items.forEach((it, i) => { if (tops[i] <= mid) best = it; });
    select(best, mid >= end);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(pick); };
  addEventListener("scroll", queue, { passive: true });

  // A jump scrolls straight to a panel (or the index, past the last); the
  // panels it passes do not start their clips on the way.
  let landed = 0;
  const land = () => { clearTimeout(landed); jumping = null; queue(); };
  addEventListener("scrollend", land);
  const jump = (k) => {
    const i = Math.max(0, Math.min(k, items.length));
    const top = (i < items.length ? tops[i] : end) - header.offsetHeight;
    if (Math.abs(scrollY - top) < 2) return;
    jumping = items[i] || fin;
    if (items[i]) select(items[i]);
    clearTimeout(landed);
    landed = setTimeout(land, 1500);
    scrollTo({ top, behavior: reduced ? "instant" : "smooth" });
  };

  // The stage stays pinned while the work slides over it; one taller than
  // the screen pins once its bottom edge is in view.
  const stage = document.querySelector(".stage");
  const fit = () => {
    stage?.style.setProperty("--stage-top", `${Math.min(header.offsetHeight, innerHeight - stage.offsetHeight)}px`);
    measure();
    queue();
  };
  fit();
  addEventListener("resize", fit);
  addEventListener("load", fit, { once: true });

  reel.addEventListener("focusin", (e) => {
    const it = e.target.closest(".it");
    if (!it || it === now) return;
    select(it);
    scrollTo({ top: tops[items.indexOf(it)] - header.offsetHeight, behavior: reduced ? "instant" : "smooth" });
  });
  document.addEventListener("visibilitychange", () => {
    if (!video) return;
    if (document.hidden) pause(video); else play(video);
  });

  if (dock) {
    const plain = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    ticks.forEach((t, i) => t.addEventListener("click", (e) => { if (plain(e)) { e.preventDefault(); jump(i); } }));
    steps.forEach((b) => b.addEventListener("click", () => jump(items.indexOf(now) + Number(b.dataset.step))));
    dock.querySelector(".dock-all").addEventListener("click", (e) => {
      if (plain(e)) { e.preventDefault(); jump(items.length); }
    });
    // Hovering a tick shows that project's poster, name and line above it.
    const peek = document.createElement("span");
    peek.className = "dock-peek";
    const img = Object.assign(document.createElement("img"), { alt: "", width: 1324, height: 828, decoding: "async" });
    peek.append(img, document.createElement("b"), document.createElement("span"));
    dock.append(peek);
    const box = dock.querySelector(".dock-ticks");
    box.addEventListener("pointerover", (e) => {
      const t = e.target.closest(".dock-ticks a");
      if (!t || e.pointerType !== "mouse") return;
      img.hidden = !("live" in t.dataset);
      if (!img.hidden) img.src = `/reel/${t.dataset.slug}-n.webp`;
      peek.children[1].textContent = `${t.dataset.n} ${t.dataset.name}`;
      peek.children[2].textContent = t.dataset.tag;
      const d = dock.getBoundingClientRect(), r = t.getBoundingClientRect();
      peek.style.setProperty("--x", `${Math.max(120, Math.min(r.left + r.width / 2 - d.left, d.width - 120))}px`);
      peek.dataset.on = "";
    });
    box.addEventListener("pointerleave", () => delete peek.dataset.on);
  }

  // Index cards: each poster fades in as it arrives; under a mouse, a card
  // plays its recorded clip.
  const cards = fin ? [...fin.querySelectorAll(".card")] : [];
  for (const c of cards) {
    const img = c.querySelector(".card-shot img");
    if (!img) continue;
    const show = () => { img.dataset.in = ""; };
    if (img.complete) show();
    else { img.addEventListener("load", show, { once: true }); img.addEventListener("error", show, { once: true }); }
    if (still) continue;
    let v = null;
    c.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse" || v) return;
      const src = img.getAttribute("src");
      v = Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, preload: "auto", poster: src, src: src.replace(/\.webp$/, ".mp4"), disablePictureInPicture: true });
      v.setAttribute("aria-hidden", "true");
      v.addEventListener("playing", () => { if (v) v.dataset.on = ""; });
      img.after(v);
      play(v);
    });
    c.addEventListener("pointerleave", () => {
      if (!v) return;
      const old = v;
      v = null;
      pause(old);
      delete old.dataset.on;
      setTimeout(() => old.remove(), 300);
    });
  }

  // The index: an area and a language narrow it; cards glide to their new
  // places where the browser has view transitions.
  const filters = fin?.querySelector("[data-filters]");
  if (filters) {
    const count = fin.querySelector("[data-all-n]");
    const all = count.textContent;
    const want = { g: "", lang: "" };
    const apply = () => {
      let shown = 0;
      for (const c of cards) {
        c.hidden = !((!want.g || c.dataset.g === want.g) && (!want.lang || c.dataset.lang.split(", ").includes(want.lang)));
        if (!c.hidden) shown++;
      }
      count.textContent = shown === cards.length ? all : shown ? `${shown} of ${cards.length} projects` : "None match both; pick another area or language.";
      fit();
    };
    filters.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b || b.getAttribute("aria-pressed") === "true") return;
      for (const x of filters.querySelectorAll(`[data-f=${b.dataset.f}]`)) x.setAttribute("aria-pressed", String(x === b));
      want[b.dataset.f] = b.dataset.v;
      if (reduced || !("types" in (globalThis.ViewTransition?.prototype ?? {}))) { apply(); return; }
      cards.forEach((c, i) => { c.style.viewTransitionName = `card-${i}`; c.style.setProperty("view-transition-class", "card"); });
      // A transition skipped by the next click, or timed out in a tab that
      // is not drawing, still leaves the filter applied.
      let done = false;
      const vt = document.startViewTransition({ update: () => { done = true; apply(); }, types: ["filter"] });
      vt.ready.catch(() => {});
      vt.finished.catch(() => { if (!done) apply(); }).finally(() => cards.forEach((c) => { c.style.viewTransitionName = ""; }));
    });
  }
}
