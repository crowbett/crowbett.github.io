// Plays and pauses the muted clips. iOS Low Power Mode refuses autoplay
// (NotAllowedError); a refused clip starts on the visitor's next tap or key,
// which iOS lets play.
const refused = new Set();
const retry = () => {
  for (const v of refused) if (v.isConnected) v.play().catch(() => {});
  refused.clear();
};
for (const t of ["touchend", "click", "keydown"]) addEventListener(t, retry, { capture: true, passive: true });

export const play = (v) => v.play().catch((e) => { if (e.name === "NotAllowedError") refused.add(v); });
export const pause = (v) => { refused.delete(v); v.pause(); };

// poster is the recording a screen shows at its current width: the
// <source> whose media matches (the desktop crop), else the <img> (phone).
export const poster = (box) => {
  const s = box.querySelector("source");
  return s && matchMedia(s.media).matches ? s.srcset : box.querySelector("img").getAttribute("src");
};
