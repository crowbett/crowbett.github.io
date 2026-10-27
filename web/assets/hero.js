// Re-runs the home replay's recorded call through the real WebAssembly build
// when the visitor asks, and says whether the answer matches the chart.
const box = document.querySelector("[data-replay]");
const same = (a, b) => a === b || (a !== null && b !== null && typeof a === "object" && typeof b === "object" &&
  Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((k) => same(a[k], b[k])));

// Counts the readouts up as the wipe draws the chart: each shows the run's own
// total over the buckets drawn so far, and ends on the figure the page prints.
let ticking = 0;
function tick({ allowed, denied }) {
  const wipe = [...box.closest(".replay").querySelectorAll(".rw")].flatMap((r) => r.getAnimations())[0];
  if (!wipe) return;
  const id = ++ticking;
  const cells = [[".k-a", allowed], [".k-d", denied]].map(([sel, per]) => {
    let sum = 0;
    const el = box.closest(".replay").querySelector(sel);
    return { el, end: (el.dataset.end ??= el.textContent), cum: per.map((v) => (sum += v)) };
  });
  const { delay, duration } = wipe.effect.getTiming();
  const frame = () => {
    if (id !== ticking) return;
    const t = wipe.currentTime;
    const p = t === null ? 1 : Math.min(1, Math.max(0, (t - delay) / duration));
    for (const { el, end, cum } of cells) {
      const k = Math.round(p * cum.length);
      el.textContent = p >= 1 ? end : (k ? cum[k - 1] : 0).toLocaleString("en-US");
    }
    if (p < 1 && wipe.playState !== "idle") requestAnimationFrame(frame);
  };
  frame();
}

async function run(button, status) {
  const { replay: slug, call, params, result, bytes } = box.dataset;
  button.disabled = true;
  button.textContent = "Downloading…";
  delete box.dataset.replayMatch;
  const shown = [box.querySelector("a"), box.closest(".replay").querySelector(".replay-stamp")];
  for (const n of shown) n.hidden = true;
  let demo;
  try {
    const { connect } = await import("/assets/demo.js");
    demo = await connect(slug, {
      onProgress: (n) => { button.textContent = `Downloading ${Math.min(99, Math.floor((100 * n) / bytes))}%`; },
    });
    button.textContent = "Running…";
    const args = JSON.parse(params);
    const t0 = performance.now();
    const got = await demo.call(call, args);
    const ms = Math.max(1, Math.round(performance.now() - t0));
    if (same(got, JSON.parse(result))) {
      status.textContent = `Your browser ran it in ${ms} ms and got this chart, bar for bar.`;
      box.dataset.replayMatch = "";
      for (const n of shown) n.hidden = false;
      for (const a of box.closest(".replay").getAnimations({ subtree: true })) { a.cancel(); a.play(); }
      tick(got.series[0]);
    } else {
      status.textContent = "Your browser's run differs from this recording.";
    }
  } catch (err) {
    status.textContent = `It did not run: ${err.message}`;
  } finally {
    if (demo) demo.close();
    box.dataset.replayDone = "";
    button.textContent = "Run it again";
    button.disabled = false;
  }
}

if (box) {
  const button = box.querySelector("button");
  tick(JSON.parse(box.dataset.result).series[0]);
  button.addEventListener("click", () => run(button, box.querySelector("[role=status]")));
}
