// A project page's head: a dark band that pins under the header while the
// sheet slides over it, with the live demo whose recorded clip holds its
// screen until the build runs (demo.js). The glow is sampled from the clip,
// then from the running demo's canvas. The clip plays only while the screen
// is in view and not covered; with reduced motion or Save-Data the poster stays.
import { play, pause } from "/assets/play.js";
const head = document.querySelector(".project-head");
if (head) {
  const sheet = document.querySelector(".sheet");
  const screen = head.querySelector(".ph-screen");
  const glow = head.querySelector(".glow");
  const gx = glow.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;
  const tint = (src) => { try { gx.drawImage(src, 0, 0, glow.width, glow.height); } catch {} };

  // A head taller than the screen pins once its bottom edge is in view.
  const fit = () => {
    const top = document.querySelector(".top").offsetHeight;
    head.style.setProperty("--pin-top", `${Math.min(top, innerHeight - head.offsetHeight)}px`);
  };
  fit();
  addEventListener("resize", fit);
  new ResizeObserver(fit).observe(head);
  let seen = false;
  let covered = false;
  const shown = () => seen && !covered && !document.hidden;

  const img = screen.querySelector("img");
  if (img) {
    if (img.complete) tint(img);
    else img.addEventListener("load", () => tint(img), { once: true });
  }
  let update = () => {};
  if (screen.dataset.clip && !still) {
    const v = document.createElement("video");
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "none", poster: img.src, src: screen.dataset.clip, disablePictureInPicture: true });
    v.setAttribute("aria-hidden", "true");
    let tick = 0;
    const paint = () => {
      if (!v.paused) tint(v);
      tick = v.paused ? 0 : setTimeout(paint, 250);
    };
    v.addEventListener("playing", () => { v.dataset.on = ""; if (!tick) paint(); });
    screen.prepend(v);
    update = () => {
      if (!v.isConnected) return;
      if (shown()) {
        v.preload = "auto";
        play(v);
      } else pause(v);
    };
  }
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; update(); }, { threshold: 0.2 }).observe(head.querySelector(".ph-fig"));
  if (sheet) new IntersectionObserver(([e]) => { covered = e.isIntersecting; update(); }, { rootMargin: "0px 0px -55% 0px" }).observe(sheet);
  document.addEventListener("visibilitychange", () => update());
  // Once the demo runs, its largest canvas (if it draws one) lights the glow.
  head.addEventListener("demoready", (e) => {
    const c = [...e.target.querySelectorAll("[data-demo-mount] canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!c) return;
    setInterval(() => { if (shown()) tint(c); }, 500);
  });
}

// The pager cards light where the pointer is.
for (const a of document.querySelectorAll(".pager a")) {
  a.addEventListener("pointermove", (e) => {
    const r = a.getBoundingClientRect();
    a.style.setProperty("--mx", `${e.clientX - r.left}px`);
    a.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
}
