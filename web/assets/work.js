// The work reel: one full-screen panel per project, each pinned under the
// header while the next slides up over it. The panel covering the middle of
// the screen is current: its recorded clip plays and lights its glow (poster
// only with reduced motion or Save-Data). A covered panel sinks as the next
// one slides in (scroll-driven; the timelines are named here), and panels
// buried two or more deep are not drawn (opacity 0, which keeps their links
// focusable), since none of them shows. Focus that
// lands in a panel brings it up, so nothing focused sits under another.
import { play, pause } from "/assets/play.js";
const reel = document.querySelector(".reel");
if (reel) {
  const items = [...reel.querySelectorAll(".it")];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = reduced || navigator.connection?.saveData;
  const header = document.querySelector(".top");
  let tops = [];
  let end = 0;
  let now = null;
  let video = null;
  let tick = 0;

  if (CSS.supports("animation-timeline: view()") && !reduced) {
    reel.style.setProperty("timeline-scope", items.map((_, i) => `--it${i}`).join(", "));
    items.forEach((it, i) => {
      it.style.setProperty("view-timeline", `--it${i} block`);
      if (i > 0) items[i - 1].querySelector(".it-in").style.setProperty("animation-timeline", `--it${i}`);
    });
  }

  const tint = (it, src) => {
    const g = it.querySelector(".glow");
    try { g.getContext("2d").drawImage(src, 0, 0, g.width, g.height); } catch {}
  };
  for (const it of items) {
    const img = it.querySelector(".it-glass img");
    if (!img) continue;
    if (img.complete && img.naturalWidth) tint(it, img);
    else img.addEventListener("load", () => tint(it, img), { once: true });
  }
  const paint = () => {
    if (video && !video.paused) tint(now, video);
    tick = video && !video.paused ? setTimeout(paint, 250) : 0;
  };

  function select(it) {
    if (it === now) return;
    if (now) delete now.dataset.now;
    if (video) {
      const v = video;
      pause(v);
      delete v.dataset.on;
      setTimeout(() => v.remove(), 400);
      video = null;
    }
    now = it;
    const k = items.indexOf(it);
    items.forEach((x, i) => x.toggleAttribute("data-gone", k > 0 && i < k - 1));
    if (!it) return;
    it.dataset.now = "";
    const glass = it.querySelector(".it-glass");
    if (it.dataset.clip && !still) {
      const img = glass.querySelector("img");
      const v = document.createElement("video");
      Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto", poster: img.currentSrc || img.src, src: it.dataset.clip, disablePictureInPicture: true });
      v.setAttribute("aria-hidden", "true");
      v.addEventListener("playing", () => { v.dataset.on = ""; if (!tick) paint(); });
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
    const mid = scrollY + innerHeight / 2;
    let best = null;
    if (mid < end) items.forEach((it, i) => { if (tops[i] <= mid) best = it; });
    select(best);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(pick); };
  addEventListener("scroll", queue, { passive: true });

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
}
