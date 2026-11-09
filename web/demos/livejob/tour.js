// The livejob tour: a fresh pairing, the session played to its first
// question on the Lock Screen, a tap that travels back sealed, then the relay
// trying to inject keystrokes of its own.
const v = (t, k) => t.text(`.lj-cells [data-k=${k}] .lj-v`);
const status = (t) => t.text(".lj-status");
const tap = (t, label) => [...t.root.querySelectorAll(".lj-card[data-state=waiting] .lj-tap")].find((b) => b.textContent === label);
const pv = (t, k) => [...t.root.querySelectorAll(".lj-pair li")].find((li) => li.querySelector(".lj-pk").textContent === k)?.querySelector(".lj-pv").textContent ?? "";

export const steps = [
  {
    say: "lj's own Go code, compiled to WebAssembly, pairs a Mac and a phone, then plays one coding-agent session. Answering by hand, so the tour can tap:",
    run: async (t) => {
      if (t.text(".lj-acts button") === "Pause") await t.click("Pause");
      if (t.q("input[name=auto]").checked) await t.set(1, false);
      await t.set(0, "4");
      await t.click("Reset");
      await t.until(() => v(t, "t") === "0.0 s" && /, opened$/.test(pv(t, "session key")));
    },
    then: (t) => `Pairing proof: ${pv(t, "proof")}. A swapped key: ${pv(t, "swapped key")}. Session key: ${pv(t, "session key")}.`,
  },
  {
    say: "Playing at 4× until the agent asks something. lj reads the settled screen and pushes the question to the Lock Screen with signed buttons:",
    run: async (t) => {
      await t.click("Play");
      await t.until(() => tap(t, "Yes"), 60000);
      await t.click("Pause");
    },
    then: (t) => status(t),
  },
  {
    say: "Tapping Yes sends the answer back through the relay, sealed, into the Mac's terminal:",
    run: async (t) => {
      await t.click(tap(t, "Yes"));
      await t.until(() => v(t, "answered") === "1" && v(t, "d2m") === "1" && / ms$/.test(v(t, "rtt")));
    },
    then: (t) => `${status(t)} Round trip: ${v(t, "rtt")}.`,
  },
  {
    say: "Now play the relay: Inject keystrokes forges input toward the Mac.",
    run: async (t) => {
      await t.click("Inject keystrokes");
      await t.until(() => v(t, "blocked") === "1");
    },
    then: (t) => status(t),
  },
  { say: (t) => `The tally: ${t.text(".lj-out")}` },
];

export const end = "That's the tour. Press Play, tap the answers yourself, or try the other relay attacks.";
