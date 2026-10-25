// Re-runs the home replay's recorded call through the real WebAssembly build
// when the visitor asks, and says whether the answer matches the chart.
const box = document.querySelector("[data-replay]");
const same = (a, b) => a === b || (a !== null && b !== null && typeof a === "object" && typeof b === "object" &&
  Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((k) => same(a[k], b[k])));

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
  button.addEventListener("click", () => run(button, box.querySelector("[role=status]")));
}
