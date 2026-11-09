// The stash tour: a line inserted mid-file re-stores only the chunks around
// it, a copied day dedups, and one flipped bit makes the restore refuse.
const v = (t, k) => t.text(`.sh-cells [data-k=${k}] .sh-v`);
const yours = (t) => t.text(".sh-yours");
const res = (t) => t.text(".sh-res");

export const steps = [
  {
    say: "stash's own chunker, crypto and pack code keep one repository in this tab while a small file tree changes day by day. After Reset replays the first days, a line goes mid-file:",
    run: async (t) => {
      if (t.text(".sh-acts button") === "Pause") await t.click("Pause");
      if (t.q("select[name=avg]").value !== "256") await t.set(0, "256");
      if (t.q("select[name=key]").value !== "1") await t.set(1, "1");
      await t.set(3, "Corbett was here, mid-file.");
      await t.set(4, "notes/harbour-log.md");
      // Reset empties the line about your edit; only the insert after it fills it again.
      const line = t.q(".sh-yours");
      let cleared = line.textContent === "";
      const mo = new MutationObserver((rs) => { if (rs.some((r) => !r.addedNodes.length)) cleared = true; });
      mo.observe(line, { childList: true });
      try {
        await t.click("Reset");
        await t.click("Insert and back up");
        await t.until(() => cleared && yours(t).startsWith("Your "));
      } finally { mo.disconnect(); }
    },
    then: (t) => yours(t),
  },
  {
    say: "Next snapshot backs up the next day of changes. Every file goes through stash's backup, even unchanged ones; chunks the repository has seen are linked, not stored:",
    run: async (t) => { const n = Number(v(t, "snaps")); await t.click("Next snapshot"); await t.until(() => Number(v(t, "snaps")) === n + 1); },
    then: (t) => `${t.text(".sh-day").split("; ")[0].replace(/\.$/, "")}. ${v(t, "fresh")} chunks new. The repository stores ${v(t, "stored")} for ${v(t, "logical")} backed up, ${v(t, "ratio")} smaller.`,
  },
  {
    say: "Flip one bit flips a single bit in the middle of a chunk inside a pack, then restores the newest snapshot that uses that chunk:",
    run: async (t) => { await t.click("Flip one bit"); await t.until(() => t.text(".sh-fline").startsWith("Flipped one bit") && /^Snapshot \d+ (refused|restored)/.test(res(t))); },
    then: (t) => res(t),
  },
  {
    say: "Flip it back, and the same restore runs again:",
    run: async (t) => { await t.click("Flip it back"); await t.until(() => /^Snapshot \d+ (refused|restored)/.test(res(t)) && t.text(".sh-fline").startsWith("Flipped it back")); },
    then: (t) => res(t),
  },
];

export const end = "That's the tour. Press Play to keep the days coming, or insert your own text into any file.";
