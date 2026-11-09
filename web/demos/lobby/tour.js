// The lobby tour: a warmed-up squad queue, one player far from the crowd
// whose window widens until someone fits, then squad refill off and on.
const v = (t, k) => t.text(`.lb-cells [data-k=${k}] .lb-v`);
const you = (t) => t.text(".lb-you");
const pause = async (t) => { const b = t.q(".lb-acts button"); if (b.textContent === "Pause") await t.click(b); };
const reset = async (t) => { await t.click("Reset"); await t.until(() => v(t, "t") === "8.0 s"); };

export const steps = [
  {
    say: "lobby's own match.Queue and handoff code, compiled to WebAssembly. Squads of four, 3 arrivals a second; Reset warms up 8 s of simulated time.",
    run: async (t) => {
      await pause(t);
      await t.set(0, "squad");
      await t.until(() => v(t, "t") === "8.0 s");
      await t.set(1, 3); await t.set(2, "600"); await t.set(3, "0.2"); await t.set(4, true); await t.set(5, "5");
      await reset(t);
    },
    then: (t) => `After ${v(t, "t")}: ${v(t, "rooms")} rooms started, wait p50 ${v(t, "p50")}, ${v(t, "queue")} players still waiting.`,
  },
  {
    say: "Now a player at skill 1,900, far from most of the queue. Each band is match.Window for that player's wait: it starts narrow and widens while they wait.",
    run: async (t) => {
      await t.set(6, 1900);
      await t.click("Queue me");
      await t.until(() => you(t).startsWith("You are queued"));
      await t.click("Play");
      await t.until(() => /^(Matched|Expired)/.test(you(t)), 60000);
      await pause(t);
    },
    then: (t) => you(t),
  },
  {
    say: "Squad refill off, at 8 arrivals a second with 40 % of players walking out of forming squads:",
    run: async (t) => { await t.set(1, 5); await t.set(3, "0.4"); await t.set(4, false); await reset(t); },
    then: (t) => `By ${v(t, "t")}: ${v(t, "walkouts")} walk-outs left ${v(t, "short")} rooms short-handed.`,
  },
  {
    say: "Refill on: when a player walks out, the rest go back into the queue as one unit and keep their wait. Same settings, reset:",
    run: async (t) => { await t.set(4, true); await reset(t); },
    then: (t) => `By ${v(t, "t")}: ${v(t, "walkouts")} walk-outs, ${v(t, "refills")} refills, ${v(t, "short")} rooms short-handed.`,
  },
];

export const end = "That's the tour. Tap the skill axis to queue a player of your own, or change the mode, arrivals and walk-outs yourself.";

export const share = {
  apply: async (t) => {
    await t.until(() => v(t, "t") !== "–");
    await t.click("Reset");
    await t.until(() => v(t, "t") !== "–");
  },
};
