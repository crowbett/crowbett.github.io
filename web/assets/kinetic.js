// Home motion that needs a script to set up; all of it stands down under
// reduced motion.
//   Letters: project names and section titles are split into letters that
//   drop into place as their panel or title scrolls in (home.css times them
//   on scroll, so they move only as the page moves).
//   Peek: under a mouse, a row of the Work index shows its project's recorded
//   clip on a card that trails the pointer.
import { play, pause } from "/assets/play.js";

const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

if (!calm && CSS.supports("animation-timeline: view()")) {
  for (const host of document.querySelectorAll(".it-name, .work-head h2, .play h2, .all-head h3")) {
    const text = host.textContent;
    // The link or heading keeps its name for assistive tech; the letters are drawing.
    const named = host.closest("a") ?? host;
    named.setAttribute("aria-label", named.textContent.replace(/\s+/g, " ").trim());
    host.textContent = "";
    host.classList.add("split");
    let i = 0;
    for (const [k, word] of text.split(" ").entries()) {
      if (k) host.append(" ");
      const w = el("span", "wd");
      for (const c of word) {
        const s = el("span", "ch", c);
        s.style.setProperty("--i", String(i++));
        w.append(s);
      }
      host.append(w);
    }
  }
}

const toc = document.querySelector(".work-toc");
if (toc && fine && !calm) {
  const card = el("div", "toc-peek");
  card.setAttribute("aria-hidden", "true");
  const v = Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, preload: "none", disablePictureInPicture: true });
  card.append(v);
  document.body.append(card);
  const still = navigator.connection?.saveData;
  let on = null, x = 0, y = 0, tx = 0, ty = 0, raf = 0;
  const step = () => {
    x += (tx - x) * 0.18;
    y += (ty - y) * 0.18;
    card.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    raf = on || Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(step) : 0;
  };
  const hide = () => { on = null; delete card.dataset.on; pause(v); };
  toc.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const a = e.target.closest("li a");
    const w = card.offsetWidth, h = card.offsetHeight;
    tx = Math.min(e.clientX + 28, innerWidth - w - 12);
    ty = Math.max(12, Math.min(e.clientY - h / 2, innerHeight - h - 12));
    if (a !== on) {
      if (!a) { hide(); return; }
      if (!on) { x = tx; y = ty; }
      on = a;
      const slug = a.hash.slice(3);
      v.poster = `/reel/${slug}-n.webp`;
      v.src = `/reel/${slug}-n.mp4`;
      if (!still) play(v);
      card.dataset.on = "";
    }
    if (!raf) raf = requestAnimationFrame(step);
  });
  toc.addEventListener("pointerleave", hide);
  addEventListener("scroll", () => { if (on) hide(); }, { passive: true });
}
