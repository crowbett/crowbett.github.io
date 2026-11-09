// The edgecache tour: bursty traffic through the real cache engine, your own
// reload through the running edge, then other origin policies replayed over it.
const v = (t, k) => t.text(`.ec-cells [data-k=${k}] .ec-v`);
const status = (t) => t.text(".ec-status");
const row = (t, n) => t.text(`.ec-table tbody tr:first-child td:nth-child(${n})`);
// Waits until the edge has stopped moving: no answer changed for a second.
const settled = async (t) => {
  let seen = "", at = 0;
  await t.until(() => {
    const k = t.q(".ec-canvas").getAttribute("aria-label") + t.text(".ec-table tbody");
    if (k !== seen) { seen = k; at = performance.now(); }
    return performance.now() - at > 1000;
  }, 30000);
};
// The link's own origin policy: setting the header fields marks it custom.
export const steps = [
  {
    say: "Every GET here is played through edgecache's own cache engine against a scripted origin. Starting fresh: bursty traffic, a stale-while-revalidate origin.",
    run: async (t) => {
      if (t.text(".ec-acts button") === "Pause") await t.click("Pause");
      await t.set(0, "bursts");
      await t.set(1, "swr");
      await t.click("Reset");
      if (t.text(".ec-acts button") === "Pause") await t.click("Pause");
      await t.until(() => / took [\d,]+ calls?, /.test(t.text(".ec-out")) && Number(v(t, "requests")) >= 1 && t.q(".ec-table tbody .ec-badge"));
      await settled(t);
    },
    then: (t) => `The newest request, at ${row(t, 1)}: ${t.text(".ec-table tbody .ec-badge")}. The origin saw ${row(t, 5)}.`,
  },
  {
    say: "Playing all 300 simulated seconds at 40×:",
    run: async (t) => { await t.set(2, "40"); await t.click("Play"); await t.until(() => t.text(".ec-acts button") === "Replay", 30000); await settled(t); },
    then: (t) => `${v(t, "requests")} requests, hit ratio ${v(t, "ratio")}. ${v(t, "origin")} reached the origin, ${v(t, "r304")} of them answered 304. Age p50 ${v(t, "p50")}.`,
  },
  {
    say: "Now your own request: a reload (Cache-Control: no-cache) through the running edge.",
    run: async (t) => { await t.set(6, "reload"); await t.click("Send my request"); await t.until(() => t.text(".ec-you") !== ""); },
    then: (t) => t.text(".ec-you"),
  },
  {
    say: "Changing the origin to no-store replays the same requests under the new headers:",
    run: async (t) => { await t.set(1, "no-store"); await t.until(() => /^Replayed/.test(status(t))); },
    then: (t) => `${v(t, "requests")} requests: hit ratio ${v(t, "ratio")}, ${v(t, "origin")} origin requests. The newest body is "${row(t, 4)}".`,
  },
  {
    say: "And max-age=30 with an ETag: a stale copy is revalidated with If-None-Match.",
    run: async (t) => { const at = status(t); await t.set(1, "etag"); await t.until(() => /^Replayed/.test(status(t)) && status(t) !== at); },
    then: (t) => `Same ${v(t, "requests")} requests: hit ratio ${v(t, "ratio")}, ${v(t, "origin")} origin requests, ${v(t, "r304")} of them answered 304 instead of resending the body.`,
  },
];

export const end = "That's the tour. Press Replay, pick another origin policy or traffic, or send requests of your own.";

export const share = {
  apply: async (t) => {
    await t.click("Reset");
    await t.until(() => !/^Replayed/.test(status(t)));
  },
};
