// A project page's head: a dark band that pins under the header while the
// sheet slides over it, with the demo's recorded clip on a screen that casts
// a glow sampled from its frames. The clip plays only while the screen is in
// view and not covered; with reduced motion or Save-Data the poster stays.
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

  const img = screen.querySelector("img");
  if (img) {
    if (img.complete) tint(img);
    else img.addEventListener("load", () => tint(img), { once: true });
  }
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
    let seen = false;
    let covered = false;
    const update = () => {
      if (seen && !covered && !document.hidden) {
        v.preload = "auto";
        v.play().catch(() => {});
      } else v.pause();
    };
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; update(); }, { threshold: 0.2 }).observe(screen);
    if (sheet) new IntersectionObserver(([e]) => { covered = e.isIntersecting; update(); }, { rootMargin: "0px 0px -55% 0px" }).observe(sheet);
    document.addEventListener("visibilitychange", update);
  }
}
