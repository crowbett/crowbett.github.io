// The netcode tour: a match over the soak's link, player 0 taken over, then
// the same seed over a mobile link, with the server's state-hash check.
const v = (t, k) => t.text(`.nc-cells [data-k=${k}] .nc-v`);
const echo = (t) => t.text(".nc-echo");
const pause = async (t) => { if (t.text(".nc-play") === "Pause") await t.click("Pause"); };
const tick1 = async (t) => { const at = v(t, "tick"); await t.click("Step 1 tick"); await t.until(() => v(t, "tick") !== at); };
const soak = {};

export const steps = [
  {
    say: "netcode's real server and rollback clients, compiled from Rust to WebAssembly: six players at 60 Hz over the soak's link, 100 ms latency, 20 ms jitter and 2 % loss each way.",
    run: async (t) => {
      await pause(t);
      await t.set(0, "1");
      await t.click("Reset");
      await t.set(1, "soak");
      await t.until(() => t.text(".nc-status").startsWith("Link set to the soak"));
      await tick1(t);
      await t.click("Reset");
      await t.until(() => v(t, "tick") === "180");
      for (const k of ["rollbacks", "depth"]) soak[k] = v(t, k);
    },
    then: (t) => `After ${v(t, "tick")} ticks your client has rolled back ${v(t, "rollbacks")} ${v(t, "rollbacks") === "1" ? "time" : "times"}, up to ${v(t, "depth")} deep. ${v(t, "checks")} state hashes compared, ${v(t, "desyncs")} desyncs.`,
  },
  {
    say: "Taking over player 0 from the autopilot with the → button. Your client predicts your move at once; the server and bot 1 see it later:",
    run: async (t) => {
      await t.click("Play");
      await t.click("→");
      await t.until(() => echo(t).startsWith("Your input"));
      await pause(t);
    },
    then: (t) => echo(t),
  },
  {
    say: "Now the link switches to mobile: 180 ms latency, 60 ms jitter and 4 % loss each way. Reset starts a new match from seed 1, autopilot steering:",
    run: async (t) => {
      await t.set(1, "mobile");
      await t.until(() => t.text(".nc-status").startsWith("Link set to mobile"));
      await t.click("Reset");
      await t.until(() => v(t, "tick") === "180");
    },
    then: (t) => `After ${v(t, "tick")} ticks: ${v(t, "rollbacks")} rollbacks up to ${v(t, "depth")} deep, against ${soak.rollbacks} up to ${soak.depth} over the soak's link.`,
  },
  {
    say: "Playing on for five seconds of simulated time. The server keeps comparing every client's state hash with its own:",
    run: async (t) => {
      await t.click("Play");
      await t.until(() => Number(v(t, "tick").replace(/,/g, "")) >= 480);
      await pause(t);
      await tick1(t);
    },
    then: (t) => `By tick ${v(t, "tick")}: rtt ${v(t, "rtt")}, ${v(t, "rollbacks")} rollbacks up to ${v(t, "depth")} deep. ${v(t, "checks")} hashes compared, ${v(t, "desyncs")} desyncs. ${t.text(".nc-lamp-text")}: ${t.text(".nc-lamp-hash")}.`,
  },
];

export const end = "That's the tour. Steer player 0 with the arrow keys or the buttons, or change the link yourself.";

export const share = {
  apply: async (t) => {
    await t.click("Reset");
    await t.until(() => !echo(t).startsWith("Waiting"));
  },
};
