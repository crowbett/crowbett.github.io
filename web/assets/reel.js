// The home work reel. The panel crossing the middle of the screen is the
// current one: the rail (or, on narrow screens, the sticky bar) names it and
// only its clip plays. Clips load as their panel comes near and never with
// reduced motion or Save-Data, where the poster stands in.
const reel = document.querySelector(".reel");
if (reel) {
  const shots = [...reel.querySelectorAll(".shot")];
  const railBox = reel.querySelector(".rail > div");
  const rail = new Map([...railBox.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]));
  const bar = reel.querySelector(".reel-now");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;
  let now;

  const clip = (shot) => shot.querySelector("video");
  const load = (shot) => {
    const img = shot.querySelector("img[data-clip]");
    if (still || !img || clip(shot)) return;
    const v = document.createElement("video");
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: "auto", poster: img.src, src: img.dataset.clip, disablePictureInPicture: true });
    v.setAttribute("aria-hidden", "true");
    v.addEventListener("playing", () => { v.dataset.on = ""; }, { once: true });
    img.after(v);
    if (shot === now) v.play().catch(() => {});
  };

  const select = (shot) => {
    if (shot === now) return;
    if (now) { delete now.dataset.now; clip(now)?.pause(); }
    now = shot;
    shot.dataset.now = "";
    clip(shot)?.play().catch(() => {});
    for (const [id, a] of rail) {
      if (id !== shot.id) { a.removeAttribute("aria-current"); continue; }
      a.setAttribute("aria-current", "true");
      if (a.offsetTop < railBox.scrollTop || a.offsetTop + a.offsetHeight > railBox.scrollTop + railBox.clientHeight) railBox.scrollTop = a.offsetTop - railBox.clientHeight / 2;
    }
    const i = shots.indexOf(shot);
    bar.querySelector("b").textContent = shot.querySelector(".shot-name").textContent;
    bar.querySelector("span").textContent = `${String(i + 1).padStart(2, "0")} / ${shots.length}`;
    bar.querySelector("i").style.setProperty("--p", (i + 1) / shots.length);
    bar.dataset.on = "";
  };

  const near = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { load(e.target); near.unobserve(e.target); }
  }, { rootMargin: "75% 0px" });
  const middle = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) select(e.target);
  }, { rootMargin: "-50% 0px -50% 0px" });
  for (const s of shots) { near.observe(s); middle.observe(s); }
}
