// The raytracer tour: the Cornell box traced two ways side by side, paused
// to read the noise, a burst of samples poured into a band of rows, then the
// right half switched to the book 3 mixture.
const v = (t, k) => t.text(`.rt-cells [data-k=${k}] .rt-v`);
const cell = (t, k) => [...t.root.querySelectorAll(".rt-cells li")].find((li) => li.querySelector(".rt-k").textContent.startsWith(k))?.querySelector(".rt-v").textContent ?? "";
const status = (t) => t.text(".rt-status");
const play = (t) => t.q(".rt-play");
// A restart disables the play button until the new run has loaded.
const loaded = (t) => t.until(() => !play(t).disabled && /: (sampling, )?[\d,]+ spp in each half/.test(status(t)));
// Sample until each half has `n` samples per pixel, then pause.
const sampleTo = async (t, n) => {
  if (play(t).textContent !== "Pause") await t.click(play(t));
  await t.until(() => Number(v(t, "spp").replace(/,/g, "")) >= n, 60000);
  await t.click("Pause");
  await t.until(() => /^Paused at \d+ spp: /.test(status(t)));
};

export const steps = [
  {
    say: "The real C++ path tracer renders the Cornell box twice: material-only sampling on the left, light sampling (NEE + MIS) on the right.",
    run: async (t) => {
      await t.set(0, "cornell");
      await t.set(1, "nee");
      await t.set(2, "300");
      await t.until(() => t.text(".rt-info").startsWith("Cornell box: 300 × 300 px"));
      await loaded(t);
    },
    then: (t) => t.text(".rt-info"),
  },
  {
    say: "Both halves get the same samples per pixel. Sampling until each has 16, then pausing:",
    run: (t) => sampleTo(t, 16),
    then: (t) => status(t),
  },
  {
    say: "Focus +32 spp pours 32 more samples into every pixel of a band of rows, in both halves:",
    run: async (t) => {
      await t.click(t.q(".rt-you-btn"));
      await t.until(() => /^you \+32 spp on rows /.test(t.text(".rt-you")));
    },
    then: (t) => t.text(".rt-you").replace(/^you /, ""),
  },
  {
    say: "The chart can also plot the noise against each half's render time instead of samples:",
    run: async (t) => {
      await t.click("per second");
      await t.until(() => t.q(".rt-seg button:last-child").getAttribute("aria-pressed") === "true");
    },
    then: (t) => `Each pass took ${cell(t, "ms per pass")} ms, left / right, and the chart now plots est. RMSE against render time.`,
  },
  {
    say: "Switching the right half to the light/material mixture from book 3 restarts both halves:",
    run: async (t) => {
      await t.set(1, "mixture");
      await loaded(t);
      await sampleTo(t, 16);
    },
    then: (t) => status(t),
  },
];

export const end = "That's the tour. Tap the image to focus samples, drag the divider, or pick another scene.";

export const share = {
  apply: async (t) => {
    await t.click("Restart");
    await t.until(() => !play(t).disabled);
  },
};
