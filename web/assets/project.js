// A project page's head: a dark band, with the live demo whose recorded clip
// holds its screen until the build runs (demo.js). A head without a demo pins
// under the header while the sheet slides over it. The clip plays only while
// the screen is in view and not covered; with reduced motion or Save-Data the
// poster stays.
import { play, pause, poster } from "/assets/play.js";
const head = document.querySelector(".project-head");
if (head) {
  const sheet = document.querySelector(".sheet");
  const screen = head.querySelector(".ph-screen");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;

  // A head taller than the screen pins once its bottom edge is in view.
  const fit = () => {
    const top = document.querySelector(".top").offsetHeight;
    head.style.setProperty("--pin-top", `${Math.min(top, innerHeight - head.offsetHeight)}px`);
  };
  fit();
  addEventListener("resize", fit);
  new ResizeObserver(fit).observe(head);
  // The header names the project once its title has scrolled under it: a
  // scroll position against the title's foot, measured when the layout changes.
  const bar = document.querySelector(".top");
  const title = head.querySelector("h1");
  let foot = Infinity;
  const past = () => bar.toggleAttribute("data-past", scrollY > foot);
  const edge = () => { foot = title.getBoundingClientRect().bottom + scrollY - bar.offsetHeight; past(); };
  edge();
  addEventListener("scroll", past, { passive: true });
  addEventListener("resize", edge);
  addEventListener("load", edge, { once: true });
  let seen = false;
  let covered = false;
  const shown = () => seen && !covered && !document.hidden;

  let update = () => {};
  if ("clip" in screen.dataset && !still) {
    const shot = poster(screen);
    const v = document.createElement("video");
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "none", poster: shot, src: shot.replace(/\.webp$/, ".mp4"), disablePictureInPicture: true });
    v.setAttribute("aria-hidden", "true");
    v.addEventListener("playing", () => { v.dataset.on = ""; });
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
}

// The pager cards light where the pointer is.
for (const a of document.querySelectorAll(".pager a")) {
  a.addEventListener("pointermove", (e) => {
    const r = a.getBoundingClientRect();
    a.style.setProperty("--mx", `${e.clientX - r.left}px`);
    a.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
}

// #find=<words>, as the palette links a page's prose, scrolls to the first
// passage that starts with those words and marks it.
function find() {
  const m = /^#find=(.+)$/.exec(location.hash);
  if (!m) return;
  let words;
  try { words = decodeURIComponent(m[1]); } catch { return; }
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const hit = [...document.querySelectorAll("main :is(p, li, h2, h3)")].find((e) => norm(e.textContent).includes(words));
  if (!hit) return;
  document.querySelector(".found")?.classList.remove("found");
  hit.classList.add("found");
  hit.scrollIntoView({ block: "center" });
}
addEventListener("hashchange", find);
if (document.readyState === "complete") find(); else addEventListener("load", find, { once: true });
