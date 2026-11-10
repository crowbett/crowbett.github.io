// Pointer feel, for a mouse with motion allowed (touch and pens get none of
// it): previews tilt toward the pointer with their layers at different
// depths. Browsers already deliver pointermove and scroll once a frame.
const fine = matchMedia("(hover: hover) and (pointer: fine)");
const calm = matchMedia("(prefers-reduced-motion: reduce)");
let tilted = null, ev = null;

const clear = (el, ...props) => { if (!el) return; for (const p of props) el.style.removeProperty(p); delete el.dataset.feel; };
const frame = (hit) => {
  const { clientX: x, clientY: y } = ev;
  const t = hit instanceof Element ? hit : document.elementFromPoint(x, y);
  const g = calm.matches ? null : t?.closest(".it-glass, .card-shot");
  if (g !== tilted) { clear(tilted, "--rx", "--ry"); clear(tilted?.parentElement, "--dx", "--dy"); tilted = g; }
  if (!g) return;
  const r = g.getBoundingClientRect();
  const px = (x - r.left) / r.width, py = (y - r.top) / r.height;
  g.style.setProperty("--rx", `${((0.5 - py) * 7).toFixed(2)}deg`);
  g.style.setProperty("--ry", `${((px - 0.5) * 9).toFixed(2)}deg`);
  g.dataset.feel = "";
  g.parentElement.style.setProperty("--dx", (px - 0.5).toFixed(3));
  g.parentElement.style.setProperty("--dy", (py - 0.5).toFixed(3));
  g.parentElement.dataset.feel = "";
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
  clear(tilted, "--rx", "--ry"); clear(tilted?.parentElement, "--dx", "--dy");
  tilted = null;
});

// The footer's address: each letter lifts under the pointer and its
// neighbours follow (site.css). The link keeps its text as its name.
const mail = document.querySelector(".foot-mail");
if (mail && fine.matches && !calm.matches) {
  const text = mail.textContent;
  mail.setAttribute("aria-label", text);
  mail.textContent = "";
  for (const c of text) {
    const s = document.createElement("span");
    s.className = "fl";
    s.textContent = c;
    mail.append(s);
  }
}
