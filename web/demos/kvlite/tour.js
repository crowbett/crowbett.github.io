// The kvlite tour: a seeded store, a key of your own, the plug pulled
// mid-write, recovery from kvlite's own files, then a compaction.
const v = (t, k) => t.text(`.kv-cells [data-k=${k}] .kv-v`);
const status = (t) => t.text(".kv-status");
const writes = (t) => /^([\d,]+) writes?/.exec(t.text(".kv-out"))?.[1];

// Step (which pauses) moves the store off any warmed-up state, so the wait
// after Reset can only pass once Reset has replayed the seeded writes.
async function fresh(t) {
  const at = writes(t);
  await t.click("Step");
  await t.until(() => writes(t) !== at);
  await t.click("Reset");
  await t.until(() => { const m = /^Warmed up with (\d+) seeded writes/.exec(status(t)); return !!m && writes(t) === m[1]; });
}

export const steps = [
  {
    say: "kvlite's own engine writes real segment, hint and MANIFEST files to an in-memory file system here. Reset replays a seeded workload of puts and deletes:",
    run: async (t) => { await t.set(1, "0.1"); await t.set(2, "0.5"); await fresh(t); },
    then: (t) => `${writes(t)} writes later: ${v(t, "keys")} keys, ${v(t, "disk")} on disk, of which ${v(t, "live")} live and ${v(t, "dead").replace(" · ", " dead (")}). Compactions so far: ${v(t, "compactions")}.`,
  },
  {
    say: "Putting a key of your own, my:key = hello:",
    run: async (t) => {
      await t.set(4, "my:key");
      await t.set(5, "hello");
      await t.click("Put");
      await t.until(() => t.text(".kv-you").startsWith("my:key = hello"));
    },
    then: (t) => t.text(".kv-you"),
  },
  {
    say: "Now Pull the plug, set to mid-write: one more write starts, the store is dropped without Close and the end of that record is cut off.",
    run: async (t) => { await t.set(3, "mid"); await t.click("Pull the plug"); await t.until(() => status(t).startsWith("Plug pulled") && v(t, "lost") !== "–"); },
    then: (t) => {
      const cut = /cut off the end of (\S+) at byte ([\d,]+)/.exec(status(t));
      const back = /rolled back: (.*)\.$/.exec(status(t));
      return `${cut ? `Cut at byte ${cut[2]} of ${cut[1]}. ` : ""}kvlite reopened from its own files: ${v(t, "recovered")} recovered, ${v(t, "lost")} lost${back ? `; rolled back ${back[1]}` : ""}.`;
    },
  },
  {
    say: "Your key was written before the cut. Get reads it back through the reopened store:",
    run: async (t) => { await t.click("Get"); await t.until(() => status(t).startsWith("Get my:key")); },
    then: (t) => status(t),
  },
  {
    say: "Compact rewrites only the live records into a fresh sealed segment and drops the dead ones:",
    run: async (t) => { await t.click("Compact"); await t.until(() => status(t).startsWith("kvlite rewrote")); },
    then: (t) => `${status(t).replace(/, swapped the MANIFEST.*$/, ".")} Reclaimed so far: ${v(t, "reclaimed")}.`,
  },
];

export const end = "That's the tour. Press Play to let the workload run, or put, get and delete keys of your own.";

export const share = { apply: async (t) => { await fresh(t); await t.click("Play"); } };
