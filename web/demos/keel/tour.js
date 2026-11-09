// The keel tour: one seed run twice to the same digest, the nemesis's first
// faults stepped through, more seeds checked, then a seed of the tour's own.
const v = (t, k) => t.text(`.kl-cells [data-k=${k}] .kl-v`);
const rows = (t) => [...t.root.querySelectorAll(".kl-row")].map((r) => [...r.querySelectorAll(".kl-which, .kl-digest, .kl-match, .kl-differ")].map((x) => x.textContent));
const twice = (t, label) => { const r = rows(t); return r.length === 2 && r[0][0] === label && r[1].length === 3; };
const pause = async (t) => { if (t.text(".kl-acts button") === "Pause") await t.click("Pause"); };
const fault = async (t) => { const at = v(t, "t"); await t.click("Next fault"); await t.until(() => v(t, "t") !== at); };

export const steps = [
  {
    say: "keel's real deterministic simulator, compiled from Rust to WebAssembly: five Raft servers and three clients under a nemesis, one seed per call. Reset runs seed 2 twice:",
    run: async (t) => {
      await pause(t);
      await t.click("Reset");
      await t.until(() => !t.q(".kl-acts button:last-child").disabled && v(t, "seeds") === "24" && twice(t, "seed 2"));
    },
    then: (t) => { const [a, b] = rows(t); return `Trace digests ${a[1]} and ${b[1]}: ${b[2]}. ${v(t, "ok")} ok ops, ${v(t, "info")} indeterminate; the history is ${v(t, "hist")}.`; },
  },
  {
    say: "The nemesis crashes, pauses, partitions and clock-skews the servers. Stepping through seed 2's first faults:",
    run: async (t) => { for (let i = 0; i < 3; i++) await fault(t); },
    then: (t) => `At ${v(t, "t")} of simulated time, ${v(t, "faults")} faults in: faulty now ${v(t, "faulty")}; partition ${v(t, "part")}.`,
  },
  {
    say: (t) => `Each bar is a seed whose history keel's own checker has judged: ${v(t, "seeds")} so far. Checking 24 more:`,
    run: async (t) => {
      const before = v(t, "seeds");
      await t.click("Check 24 more seeds");
      await t.until(() => v(t, "seeds") !== before && !t.q(".kl-acts button:last-child").disabled, 60000);
    },
    then: (t) => `${v(t, "seeds")} seeds checked, ${v(t, "lin")} linearizable.`,
  },
  {
    say: "A seed reproduces a run bit for bit. Typing a seed of our own, 1,234, and running it twice:",
    run: async (t) => {
      await t.set(2, 1234);
      await t.click("Run my seed");
      await t.until(() => twice(t, "your seed 1,234"));
    },
    then: (t) => { const [a, b] = rows(t); return `Your seed 1,234 ran twice: digests ${a[1]} and ${b[1]}, ${b[2]}. ${v(t, "ok")} ok ops; the history is ${v(t, "hist")}.`; },
  },
];

export const end = "That's the tour. Press Play to watch the nemesis, or type your own seed and run it.";

export const share = {
  apply: async (t) => {
    await t.click("Run my seed");
    await t.until(() => rows(t)[0]?.[0].startsWith("your seed") && rows(t).length === 2);
  },
};
