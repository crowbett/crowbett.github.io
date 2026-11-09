// Pointer feel, for a mouse only (touch and pens get none of it): a light
// that follows the pointer across the dark screens' graticule and along the
// edge of the panel it is over; with motion allowed, previews that tilt
// toward it under a glare with their layers at different depths, and primary
// keys that lean to it. Browsers already deliver pointermove and scroll once a frame.
const fine = matchMedia("(hover: hover) and (pointer: fine)");
const calm = matchMedia("(prefers-reduced-motion: reduce)");
let lit = null, rimmed = null, tilted = null, leaned = null, ev = null;

const clear = (el, ...props) => { if (!el) return; for (const p of props) el.style.removeProperty(p); delete el.dataset.feel; };
const frame = (hit) => {
  const { clientX: x, clientY: y } = ev;
  const t = hit instanceof Element ? hit : document.elementFromPoint(x, y);

  const s = t?.closest(".stage, .project-head, .it");
  if (s !== lit) { clear(lit); lit = s; }
  if (s) {
    const r = s.getBoundingClientRect();
    s.style.setProperty("--mx", `${x - r.left}px`);
    s.style.setProperty("--my", `${y - r.top}px`);
    s.dataset.feel = "";
  }
  const h = t?.closest(".result, .demo, .project-info, .code, .card-shot");
  if (h !== rimmed) { if (rimmed) delete rimmed.dataset.rim; rimmed = h; }
  if (h) {
    const r = h.getBoundingClientRect();
    h.style.setProperty("--hx", `${x - r.left}px`);
    h.style.setProperty("--hy", `${y - r.top}px`);
    h.dataset.rim = "";
  }
  if (calm.matches) return;

  const g = t?.closest(".it-glass, .card-shot");
  if (g !== tilted) { clear(tilted, "--rx", "--ry"); clear(tilted?.parentElement, "--dx", "--dy"); tilted = g; }
  if (g) {
    const r = g.getBoundingClientRect();
    const px = (x - r.left) / r.width, py = (y - r.top) / r.height;
    g.style.setProperty("--rx", `${((0.5 - py) * 7).toFixed(2)}deg`);
    g.style.setProperty("--ry", `${((px - 0.5) * 9).toFixed(2)}deg`);
    g.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
    g.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
    g.dataset.feel = "";
    g.parentElement.style.setProperty("--dx", (px - 0.5).toFixed(3));
    g.parentElement.style.setProperty("--dy", (py - 0.5).toFixed(3));
    g.parentElement.dataset.feel = "";
  }

  const k = t?.closest(".stage-go .key, .ph-go .key, .it .key, .dock-go");
  if (k !== leaned) { clear(leaned, "--lx", "--ly"); leaned = k; }
  if (k) {
    const r = k.getBoundingClientRect();
    k.style.setProperty("--lx", `${((x - r.left - r.width / 2) * 0.22).toFixed(1)}px`);
    k.style.setProperty("--ly", `${((y - r.top - r.height / 2) * 0.3).toFixed(1)}px`);
    k.dataset.feel = "";
  }
};

addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || !fine.matches) return;
  ev = e;
  frame(e.target);
}, { passive: true });
// Scrolling moves the page under a still pointer.
addEventListener("scroll", () => { if (ev) frame(); }, { passive: true });
document.documentElement.addEventListener("pointerleave", () => {
  ev = null;
  clear(lit); clear(tilted, "--rx", "--ry"); clear(tilted?.parentElement, "--dx", "--dy"); clear(leaned, "--lx", "--ly");
  if (rimmed) delete rimmed.dataset.rim;
  lit = rimmed = tilted = leaned = null;
});
