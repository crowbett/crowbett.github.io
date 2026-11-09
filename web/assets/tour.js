// Autopilot tours and shareable settings for a live demo. A demo's own
// /demos/<slug>/tour.js exports `steps` (the tour) and optionally `share`
// (how to apply settings read from a link). A tour drives the demo's real
// controls, with a cursor showing what it presses and a caption saying why;
// any press or key of the visitor's own stops it. A share link carries the
// demo's control values and the binary they were set on.
const section = document.querySelector("[data-demo][data-tour]");
const acts = section?.querySelector("[data-acts]");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// e2e speeds tours up; a visitor always gets 1.
const speed = () => Number(document.documentElement.dataset.tourSpeed) || 1;

class Stopped extends Error {}

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("p", "toast", msg);
  t.setAttribute("role", "status");
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

// controls are the mount's labelled fields, in order: the order is what a
// link records, with the binary's sha so a link from another build is refused.
const controls = (mount) => [...mount.querySelectorAll(".demo-field")].map((f) => f.querySelector("select, input:not([type=file]), textarea")).filter(Boolean);
const valueOf = (c) => (c.type === "checkbox" || c.type === "radio" ? c.checked : c.value);
function setValue(c, v) {
  if (c.type === "checkbox" || c.type === "radio") c.checked = Boolean(v);
  else c.value = String(v);
  c.dispatchEvent(new Event("input", { bubbles: true }));
  c.dispatchEvent(new Event("change", { bubbles: true }));
}
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)));

if (section && acts) {
  const mount = section.querySelector("[data-demo-mount]");
  const sha = section.dataset.sha;
  const showBtn = acts.querySelector("[data-tour-go]");
  const linkBtn = acts.querySelector("[data-share]");
  const cap = acts.querySelector("[data-tour-cap]");
  let mod = null, running = null, cursor = null;

  // The helpers a tour's steps get. Each throws once the tour is stopped.
  const kit = (stop) => {
    const live = () => { if (stop.aborted) throw new Stopped(); };
    const find = (what) => {
      if (what instanceof Element) return what;
      const all = [...mount.querySelectorAll("button, [role=button], a")];
      const b = all.find((x) => x.textContent.trim() === what) || all.find((x) => x.textContent.trim().startsWith(what));
      if (!b) throw new Error(`tour: no control "${what}"`);
      return b;
    };
    const point = async (target) => {
      live();
      target.scrollIntoView({ block: "nearest", behavior: reduce.matches ? "instant" : "smooth" });
      await sleep(reduce.matches ? 0 : 350 / speed());
      const r = target.getBoundingClientRect();
      if (!cursor) { cursor = document.body.appendChild(el("span", "tour-cursor")); cursor.setAttribute("aria-hidden", "true"); }
      cursor.hidden = false;
      cursor.style.setProperty("translate", `${r.left + Math.min(r.width / 2, 28)}px ${r.top + r.height / 2}px`);
      target.classList.add("tour-on");
      await sleep(reduce.matches ? 200 : 520 / speed());
      target.classList.remove("tour-on");
      live();
    };
    const t = {
      root: mount,
      q: (sel) => mount.querySelector(sel),
      text: (sel) => mount.querySelector(sel)?.textContent.trim() ?? "",
      async click(what) { const b = find(what); await point(b); b.click(); },
      async set(i, v) { const c = controls(mount)[i]; if (!c) throw new Error(`tour: no control ${i}`); await point(c); setValue(c, v); },
      async wait(ms) { live(); await sleep(ms / speed()); live(); },
      async until(fn, ms = 20000) {
        for (const end = performance.now() + ms; !fn(); await sleep(50)) {
          live();
          if (performance.now() > end) throw new Error("tour: the demo did not get there in time");
        }
        live();
      },
    };
    return t;
  };

  const say = (n, total, text) => {
    cap.replaceChildren(el("span", "tour-n", `${n} / ${total}`), el("span", "tour-say", text));
    cap.hidden = false;
  };

  async function tour() {
    if (running) { running.abort(); return; }
    const stop = new AbortController();
    running = stop;
    section.dataset.touring = "";
    showBtn.textContent = "Stop";
    showBtn.setAttribute("aria-pressed", "true");
    const t = kit(stop.signal);
    const steps = mod.steps;
    // The visitor's own press or key takes the demo back.
    const own = (e) => { if (e.isTrusted && !showBtn.contains(e.target)) stop.abort(); };
    mount.addEventListener("pointerdown", own, true);
    mount.addEventListener("keydown", own, true);
    try {
      for (const [i, s] of steps.entries()) {
        say(i + 1, steps.length, typeof s.say === "function" ? s.say(t) : s.say);
        if (s.run) await s.run(t);
        if (s.then) say(i + 1, steps.length, s.then(t));
        await t.wait(s.hold ?? 2200 + 28 * (cap.textContent.length));
      }
      say(steps.length, steps.length, mod.end ?? "That's the tour. The controls are yours.");
      section.dataset.toured = "";
    } catch (err) {
      if (!(err instanceof Stopped)) { console.error(err); say(0, steps.length, `The tour stopped: ${err.message}`); }
      else cap.hidden = true;
    } finally {
      mount.removeEventListener("pointerdown", own, true);
      mount.removeEventListener("keydown", own, true);
      if (cursor) cursor.hidden = true;
      delete section.dataset.touring;
      showBtn.textContent = "Show me";
      showBtn.setAttribute("aria-pressed", "false");
      running = null;
    }
  }

  function link() {
    const vals = controls(mount).map(valueOf);
    const url = `${location.origin}${location.pathname}#run=${sha}.${b64(JSON.stringify(vals))}`;
    history.replaceState(null, "", url);
    navigator.clipboard?.writeText(url).then(() => toast("Link copied: it opens this demo with these settings."), () => toast("The link is in the address bar."))
      ?? toast("The link is in the address bar.");
  }

  async function apply() {
    const m = /^#run=([0-9a-f]{8})\.([\w-]+)$/.exec(location.hash);
    if (!m) return;
    if (m[1] !== sha) { toast("This link was made on an earlier build of the demo, so its settings were not applied."); return; }
    let vals;
    try { vals = JSON.parse(unb64(m[2])); } catch { return; }
    const cs = controls(mount);
    if (!Array.isArray(vals) || vals.length !== cs.length) return;
    // One control's handler can rewrite another (a preset fills a field), so
    // set every value in order, then re-set any that moved until they hold.
    vals.forEach((v, i) => setValue(cs[i], v));
    for (let pass = 0; pass < 3; pass++) {
      await new Promise((r) => setTimeout(r, 400));
      const off = cs.filter((c, i) => String(valueOf(c)) !== String(vals[i]));
      if (!off.length) break;
      off.forEach((c) => setValue(c, vals[cs.indexOf(c)]));
    }
    const stop = new AbortController();
    await mod.share.apply(kit(stop.signal));
    section.dataset.shared = "";
    toast("Opened with the settings from the link.");
  }

  section.addEventListener("demoready", async () => {
    try { mod = await import(section.dataset.tour); } catch (err) { console.error(err); return; }
    showBtn.addEventListener("click", tour);
    if (mod.share) linkBtn.addEventListener("click", link);
    else linkBtn.remove();
    acts.hidden = false;
    apply().catch((err) => console.error(err));
  });
  // A link with settings starts the demo, as "Run it live" would.
  if (/^#run=/.test(location.hash)) {
    const go = () => { const b = section.querySelector("[data-demo-start]"); if (!b.disabled && !("demoReady" in section.dataset)) b.click(); };
    if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
  }
}
