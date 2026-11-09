// The mcpbridge tour: a 2024-11-05 client and a 2026-07-28 server talking
// through the real bridge, your own request rewritten, then a legacy server.
const v = (t, k) => t.text(`.mb-cells [data-k=${k}] .mb-v`);
const status = (t) => t.text(".mb-status");
const engine = (t) => (status(t).split(" · ")[2] || "").replace(/^engine /, "");
const playing = (t) => [...t.root.querySelectorAll("button")].some((b) => b.textContent === "Pause");
const pause = async (t) => { if (playing(t)) await t.click("Pause"); };

export const steps = [
  {
    say: "A 2024-11-05 client and a 2026-07-28 server, with mcpbridge's own engine between them. Every frame is shown before and after the bridge.",
    run: async (t) => {
      await pause(t);
      if (t.q("select[name=server]").value !== "auto") await t.set(1, "auto");
      if (t.q("select[name=speed]").value !== "2") await t.set(2, "2");
      await t.set(0, "tour");
      await t.until(() => /^session 1 · legacy client, modern server/.test(status(t)));
    },
  },
  {
    say: "Playing the scenario at 2×: handshake, tools, progress, cancel.",
    run: async (t) => {
      await t.click("Play");
      await t.until(() => / · finished: /.test(status(t)), 60000);
      await pause(t);
    },
    then: (t) => `Engine ${engine(t)}: ${v(t, "messages")} messages, ${v(t, "translated")} translated, ${v(t, "passed")} passed as is, ${v(t, "made")} made by the bridge, ${v(t, "refused")} refused.`,
  },
  {
    say: "Now your own request, a tools/call from the legacy client:",
    run: async (t) => {
      await t.set(3, "call");
      await t.click("Send mine");
      await t.until(() => /^Your tools\/call /.test(t.text(".mb-you p")) || /did not deliver|ended the session/.test(t.text(".mb-you p")));
    },
    then: (t) => t.text(".mb-you p"),
  },
  {
    say: "The same client frames against a legacy server, which this scenario was not written for. The bridge's probe decides what to do:",
    run: async (t) => {
      await t.set(1, "legacy");
      await t.click("Play");
      await t.until(() => /^session 1 · legacy client, legacy server · .* · finished: /.test(status(t)), 60000);
      await pause(t);
    },
    then: (t) => `The probe picked ${engine(t)}: ${v(t, "messages")} messages, ${v(t, "passed")} passed as is, ${v(t, "translated")} translated, ${v(t, "made")} made by the bridge.`,
  },
];

export const end = "That's the tour. Press Play, pick another scenario or server, or edit and send a frame of your own.";

export const share = {
  apply: async (t) => {
    await t.click("Reset");
    await t.until(() => /^session 1 · /.test(status(t)));
  },
};
