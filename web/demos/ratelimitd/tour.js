// The ratelimitd tour: the same requests through three limiters, then an
// attack launched on demand, then a higher limit judging the same requests.
const v = (t, k) => t.text(`.rl-cells [data-k=${k}] .rl-v`);
const status = (t) => t.text(".rl-status");
const steps1 = async (t, n) => {
  for (let i = 0; i < n; i++) {
    const at = v(t, "t");
    await t.click("Step 1 s");
    await t.until(() => v(t, "t") !== at);
  }
};

export const steps = [
  {
    say: "Three limiters from ratelimitd's own code (GCRA, token bucket and sliding window) judge the same stream of requests, a bar per quarter second.",
    run: async (t) => { await t.click("Reset"); await t.until(() => /seed 1$/.test(v(t, "run"))); },
  },
  {
    say: "Steady traffic at 1.2× the limit. Stepping three seconds:",
    run: async (t) => { await t.set(0, "steady"); await t.until(() => /^Started run \d+: steady/.test(status(t))); await steps1(t, 3); },
    then: (t) => `After ${v(t, "t")}: ${v(t, "offered")} requests offered. GCRA let through ${v(t, "gcra")}, the sliding window ${v(t, "sliding_window")}.`,
  },
  {
    say: "Now attack traffic: half the limit, then ten times more in the middle third. Five seconds in, the tour launches the attack early:",
    run: async (t) => {
      await t.set(0, "attack");
      await t.until(() => /^Started run \d+: attack/.test(status(t)));
      await steps1(t, 5);
      await t.click("Launch the attack");
      await t.until(() => /^Re-ran run \d+/.test(status(t)));
      await steps1(t, 3);
    },
    then: (t) => `${v(t, "offered")} offered by ${v(t, "t")}. GCRA let through ${v(t, "gcra")}. ${t.text(".rl-you-tick")}`,
  },
  {
    say: "Raising the limit to 50 /s re-runs the same requests through all three:",
    run: async (t) => { await t.set(1, 4); await t.until(() => /limit 50 \/s/.test(status(t)) && v(t, "emit") === "20 ms"); },
    then: (t) => `Same seed, same requests: GCRA now lets through ${v(t, "gcra")}, and the emission interval is ${v(t, "emit")}.`,
  },
];

export const end = "That's the tour. Press Play to let it run, or change the traffic, limit and burst yourself.";

export const share = { apply: (t) => t.click("Reset") };
