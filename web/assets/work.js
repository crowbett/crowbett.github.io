// The work index and its monitor. The project at the reading line (the middle
// of the screen, or of the part below the pinned monitor on narrow screens),
// or under the pointer, is current: the monitor shows its recorded clip with a
// glow taken from the picture. With reduced motion or Save-Data it shows the
// poster only. The screen opens the project it shows (pointer only: the
// index links are the keyboard and screen reader path).
import { play, pause } from "/assets/play.js";
const work = document.querySelector(".work");
if (work) {
  const items = [...work.querySelectorAll(".it")];
  const mon = work.querySelector(".mon");
  const box = mon.querySelector(".mon-box");
  const screen = mon.querySelector(".mon-screen");
  const hud = mon.querySelector(".mon-hud");
  const glow = mon.querySelector(".glow");
  const gx = glow.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;
  const wide = matchMedia("(min-width: 48rem)");
  let now = null;
  let layer = null;
  let tick = 0;
  let near = false;

  const tint = (src) => { try { gx.drawImage(src, 0, 0, glow.width, glow.height); } catch {} };
  const paint = () => {
    const v = layer?.querySelector("video");
    if (v && !v.paused) tint(v);
    tick = v && !v.paused ? setTimeout(paint, 250) : 0;
  };

  function show(it) {
    const old = layer;
    if (it.dataset.poster) {
      layer = document.createElement("div");
      layer.className = "mon-l";
      const img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.src = it.dataset.poster;
      img.addEventListener("load", () => { if (layer?.contains(img)) tint(img); }, { once: true });
      layer.append(img);
      if (!still) {
        const v = document.createElement("video");
        Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto", poster: it.dataset.poster, src: it.dataset.clip, disablePictureInPicture: true });
        v.addEventListener("playing", () => { v.dataset.on = ""; if (!tick) paint(); });
        layer.append(v);
        play(v);
      }
      const l = layer;
      screen.append(l);
      requestAnimationFrame(() => requestAnimationFrame(() => { if (l === layer) l.dataset.on = ""; }));
      delete screen.dataset.dm;
    } else {
      layer = null;
      screen.dataset.dm = "";
      gx.clearRect(0, 0, glow.width, glow.height);
    }
    if (old) {
      const ov = old.querySelector("video");
      if (ov) pause(ov);
      delete old.dataset.on;
      setTimeout(() => old.remove(), 400);
    }
  }

  function select(it) {
    if (it === now) return;
    if (now) delete now.dataset.now;
    now = it;
    it.dataset.now = "";
    screen.href = it.querySelector("h4 a").href;
    hud.querySelector("b").textContent = it.querySelector(".it-name").textContent;
    hud.querySelector("span").textContent = `${it.querySelector(".it-n").textContent} / ${items.length}`;
    show(it);
    const next = items[items.indexOf(it) + 1];
    if (next?.dataset.poster) new Image().src = next.dataset.poster;
  }

  // The reading line sits 40% of the way down what the pinned monitor leaves.
  let raf = 0;
  const pick = () => {
    raf = 0;
    if (!near) return;
    const top = wide.matches ? 0 : Math.max(0, box.getBoundingClientRect().bottom);
    const line = top + (innerHeight - top) * 0.4;
    let best = items[0];
    for (const it of items) {
      if (it.getBoundingClientRect().top <= line) best = it;
      else break;
    }
    select(best);
  };
  addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(pick); }, { passive: true });
  // The stage stays pinned while the sheet slides over it; one taller than the
  // screen pins once its bottom edge is in view.
  const stage = document.querySelector(".stage");
  const fit = () => {
    const top = document.querySelector(".top").offsetHeight;
    stage?.style.setProperty("--stage-top", `${Math.min(top, innerHeight - stage.offsetHeight)}px`);
  };
  fit();
  addEventListener("resize", () => { fit(); if (!raf) raf = requestAnimationFrame(pick); });
  for (const it of items) {
    it.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") select(it); });
    it.addEventListener("focusin", () => select(it));
  }
  const resume = () => {
    const v = layer?.querySelector("video");
    if (!v) return;
    if (document.hidden || !near) pause(v); else play(v);
  };
  document.addEventListener("visibilitychange", resume);
  new IntersectionObserver(([e]) => {
    near = e.isIntersecting;
    if (near) pick();
    resume();
  }, { rootMargin: "50% 0px" }).observe(work);
}
