// The grepall tour: the index built, a literal typed key by key while its
// posting lists narrow the files, a regexp plan, and a pattern no index helps.
const v = (t, k) => t.text(`.ga-cells [data-k=${k}] .ga-v`);
const board = (t) => t.q(".ga-canvas").getAttribute("aria-label") || "";
const q = (t) => t.q("input[name=q]").value;
const shown = (t) => board(t).startsWith(`Index board for ${q(t)}: `);
const built = (t) => !t.q(".ga-acts button:last-child").disabled;
const after = (t) => board(t).slice(`Index board for ${q(t)}: `.length);
const pair = (t, k) => v(t, k).split(" · ");
const type = async (t, text) => {
  for (const ch of text) { await t.set(0, q(t) + ch); await t.until(() => shown(t)); }
};

export const steps = [
  {
    say: "grepall's own shard builder, query planner, posting lists and matcher, compiled to WebAssembly, index part of the Go standard library here, one shard per package:",
    run: async (t) => {
      await t.until(() => built(t), 60000);
      if (t.text(".ga-acts button") === "Pause") await t.click("Pause");
    },
    then: (t) => `${v(t, "files")} files, ${v(t, "bytes")} of source, ${/into (\d+ shards?)/.exec(t.text(".ga-out"))?.[1]}: ${v(t, "lists")} posting lists, one per trigram per shard.`,
  },
  {
    say: "Typing a literal, Kelvin, one key at a time. From the third letter on, each key adds a trigram whose posting list is read from the index:",
    run: async (t) => {
      await t.set(1, false);
      await t.set(2, "auto");
      await t.set(0, "");
      await type(t, "Kel");
    },
    then: (t) => `Kel: ${after(t)}`,
  },
  {
    say: "Three more keys, three more lists, intersected:",
    run: (t) => type(t, "vin"),
    then: (t) => `Kelvin: ${after(t)} The matcher read ${pair(t, "read")[0]}, ${pair(t, "read")[1]} of the source.`,
  },
  {
    say: "A regexp: the planner turns func\\s+New\\w+\\( into a boolean query over trigrams before any file is read.",
    run: async (t) => { await t.click("regexp"); await t.until(() => shown(t)); },
    then: (t) => `${v(t, "tri")} trigrams in the plan. ${pair(t, "cand")[0]} candidate files (${pair(t, "cand")[1]}), of which ${pair(t, "hit")[0]} (${pair(t, "hit")[1]}) match.`,
  },
  {
    say: "Last, :=.*<-. No trigram is required by every match, so the index cannot rule out a file:",
    run: async (t) => { await t.click(".* defeats the index"); await t.until(() => shown(t)); },
    then: (t) => `${after(t).replace(/^n/, "N")} The matcher read ${pair(t, "read")[0]}, ${pair(t, "read")[1]} of the source.`,
  },
];

export const end = "That's the tour. Type your own query or regexp; the board re-runs on every keystroke.";

// A link's values are set while the index may still be building, and the build
// ends by showing its own query, so they are set again once it is done.
export const share = {
  apply: async (t) => {
    const want = [q(t), t.q("input[name=regex]").checked, t.q("select[name=case]").value];
    await t.until(() => built(t), 60000);
    await t.set(1, want[1]);
    await t.set(2, want[2]);
    await t.set(0, want[0]);
    await t.until(() => shown(t));
  },
};
