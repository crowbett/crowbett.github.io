// The strata tour: the XY test piece sliced by the real engine, its layers
// drawn in the order they were generated, then sliced again finer.
const v = (t, k) => t.text(`.st-cells [data-k=${k}] .st-v`);
const sliced = (t) => !/^(Loading|Slicing)/.test(t.text(".st-summary")) && /layers fetched in/.test(t.text(".st-out"));
const kinds = (t) => [...t.root.querySelectorAll(".st-key")].filter((k) => k.dataset.kind !== "nozzle").map((k) => k.textContent).join(", ");
const load = async (t, value) => { await t.set(0, value); await t.until(() => sliced(t), 60000); };

export const steps = [
  {
    say: "strata's Rust slicing engine, the one the iPad app is built on, compiled to WebAssembly. It repairs the XY test piece, stands it on the plate and slices it at 0.2 mm:",
    run: async (t) => { await t.set(1, "0.2"); await t.set(2, "5"); await load(t, "xy"); },
    then: (t) => t.text(".st-out"),
  },
  {
    say: "From the first layer, the nozzle traces each layer's toolpaths in the order the engine generated them, and the layers stack up. Pausing once it passes layer 10:",
    run: async (t) => {
      await t.click("Restart");
      await t.until(() => parseInt(v(t, "layer"), 10) > 10, 60000);
      await t.click("Pause");
    },
    then: (t) => `Layer ${v(t, "layer")} at z ${v(t, "z")}: ${kinds(t)}.`,
  },
  {
    say: "Playing on to the top layer:",
    run: async (t) => { await t.click("Play"); await t.until(() => t.text(".st-acts button") === "Replay", 60000); },
    then: (t) => `Layer ${v(t, "layer")}: ${v(t, "drawn")} of extrusion drawn across ${v(t, "paths")} toolpaths.`,
  },
  {
    say: "Changing the layer height to 0.12 mm slices the same model again:",
    run: async (t) => { await t.set(1, "0.12"); await t.until(() => sliced(t) && t.text(".st-summary").includes("At 0.12 mm:"), 60000); },
    then: (t) => t.text(".st-summary").replace(/^.*?(At 0\.12 mm:)/, "$1") + ` Sliced in ${v(t, "slice")}.`,
  },
];

export const end = "That's the tour. Pick another model or layer height, or open your own STL, OBJ or 3MF: it stays in your browser.";

export const share = {
  apply: async (t) => {
    const m = t.q("select[name=model]");
    await load(t, m.value || m.options[0].value);
  },
};
