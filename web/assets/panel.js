// Live panels: on the home reel, a panel's "Run it live" runs the project's
// real binary inside the panel rather than opening its page. The recorded
// clip holds the screen until the binary is ready; then the demo covers the
// screen's column (the whole panel below 64rem, where a 16:10 screen is too
// small to use). One panel runs at a time, and once it is covered by the
// next panel or scrolled off screen its worker is terminated and the clip
// comes back. Nothing downloads until the key is pressed. work.js keeps the
// clip and the dock in step through "panel:state".
import { run, release, took } from "/assets/demo.js";

const reel = document.querySelector(".reel[data-live-css]");
if (reel) {
  const css = reel.dataset.liveCss;
  const header = document.querySelector(".top");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  let live = null;
  const tell = (it) => it.dispatchEvent(new Event("panel:state", { bubbles: true }));

  function stop() {
    if (!live) return;
    const { it, key, layer, plate, ctl, demo } = live;
    live = null;
    removeEventListener("scroll", queue);
    removeEventListener("resize", queue);
    ctl.abort();
    demo?.close();
    const back = layer.contains(document.activeElement);
    release(key.dataset.run, layer.querySelector(".demo-mount"));
    layer.remove();
    plate.remove();
    delete it.dataset.running;
    key.textContent = "Run it live";
    key.disabled = false;
    tell(it);
    if (back) key.focus({ preventScroll: true });
  }

  // The demo stops once nothing of it can be seen: the next panel (or the
  // index) has slid over it, or it has left the screen. Measured from the
  // panel, not the layer: the panel's slide-in and sink transforms move the
  // layer, but not what covers it.
  let queued = false;
  function check() {
    queued = false;
    if (!live) return;
    const { it, layer } = live;
    const r = it.getBoundingClientRect();
    const top = r.top + layer.offsetParent.offsetTop + layer.offsetTop;
    const over = it.nextElementSibling?.getBoundingClientRect();
    if ((over && over.top <= top + 1) || top + layer.offsetHeight <= header.offsetHeight || r.top >= innerHeight) stop();
  }
  function queue() {
    if (!queued) { queued = true; requestAnimationFrame(check); }
  }

  // reveal scrolls the demo's own box, never the page, the least it takes to
  // show its main picture (the element its recording is framed on).
  function reveal(box, sel) {
    const f = sel && box.querySelector(sel);
    if (!f) return;
    const top = f.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8;
    const need = top + f.offsetHeight + 16 - box.clientHeight;
    if (need > 0) box.scrollTop = Math.min(top, need);
  }

  async function start(it, key) {
    if (live?.it === it && "running" in it.dataset) { stop(); return; }
    stop();
    const peek = it.querySelector(".it-peek[aria-pressed=true]");
    if (peek) peek.click();
    const slug = key.dataset.run;
    const name = it.querySelector(".it-name").textContent;
    const layer = el("section", "it-live");
    layer.setAttribute("aria-label", `${name}, live demo`);
    layer.dataset.bytes = key.dataset.bytes;
    const bar = el("p", "it-live-bar");
    const spec = el("span", null, `~${key.dataset.kb} KB`);
    const page = el("a", null, "Full page");
    page.href = `/projects/${slug}/#demo`;
    const off = el("button", null, "Stop");
    off.type = "button";
    off.addEventListener("click", () => { stop(); key.focus({ preventScroll: true }); });
    bar.append(el("b", null, "Live demo"), spec, page, off);
    const box = el("div", "it-live-m");
    const mount = el("div", "demo-mount");
    box.append(mount);
    layer.append(bar, box);
    it.querySelector(".it-in").append(layer);
    const plate = el("div", "it-load");
    const status = el("p", "it-load-s");
    status.setAttribute("role", "status");
    plate.append(status);
    it.querySelector(".it-view").append(plate);
    const ctl = new AbortController();
    live = { it, key, layer, plate, ctl, demo: null };
    tell(it);
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    const r = await run(layer, {
      slug, ui: `/demos/${slug}/ui.js`, css, button: key, status, mount,
      progressAt: (row) => plate.prepend(row),
      signal: ctl.signal,
      preventScroll: true,
      onReady: (ms) => {
        spec.textContent = `~${key.dataset.kb} KB · ${took(ms)}`;
        plate.remove();
        layer.dataset.on = "";
        it.dataset.running = "";
        key.textContent = "Stop";
        key.disabled = false;
        tell(it);
      },
    });
    if (!r) { tell(it); return; }
    if (live?.ctl !== ctl) { r.demo.close(); return; }
    live.demo = r.demo;
    requestAnimationFrame(() => requestAnimationFrame(() => reveal(box, key.dataset.focus)));
  }

  for (const key of reel.querySelectorAll(".it-run")) {
    const it = key.closest(".it");
    key.addEventListener("click", () => start(it, key));
  }
  // Opening the code peek puts the clip back: one thing in the screen at a time.
  reel.addEventListener("click", (e) => {
    if (live && e.target.closest(".it-peek") && live.it.contains(e.target) && "running" in live.it.dataset) stop();
  }, { capture: true });
}
