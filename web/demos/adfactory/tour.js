// The adfactory tour: the default brief planned into nine deliverables, then
// a smaller source and a shorter cut, with the reasons the planner gives for
// each verdict that changes.
const v = (t, k) => t.text(`.adf-cells [data-k=${k}] .adf-v`);
const you = (t) => t.text(".adf-you");
const tile = (t, k) => t.q(`.adf-tile[data-key=${k}]`);
const reasons = (t) => [...t.root.querySelectorAll(".adf-reasons li")].map((li) => li.textContent);
// A tile's first reason, to its first sentence.
const why = (t, k) => `${k}, ${tile(t, k).dataset.state}: ${reasons(t)[0].split(". ")[0].replace(/\.?$/, ".")}`;
const tally = (t) => `${v(t, "ready")} ready, ${v(t, "advisory")} advisory, ${v(t, "refused")} refused`;
const pick = async (t, k) => {
  await t.click(tile(t, k));
  await t.until(() => tile(t, k).getAttribute("aria-pressed") === "true" && reasons(t).length > 0);
};

export const steps = [
  {
    say: "adfactory's real planner turns one source clip into nine platform deliverables: crops, captions, loudness and a verdict for each. Starting from Reset:",
    run: async (t) => {
      const was = v(t, "replans");
      await t.click("Reset");
      await t.until(() => v(t, "replans") !== was && you(t) === "");
    },
    then: (t) => `${t.text(".adf-out").replace(/^planned/, "Planned").split(". ")[0]}. ${tally(t)}.`,
  },
  {
    say: "A smaller source: 1280 × 720 instead of 3840 × 2160.",
    run: async (t) => {
      await t.set(0, "1280x720");
      await t.until(() => you(t).startsWith("Source set to 1280×720: re-planned in "));
    },
    then: (t) => you(t),
  },
  {
    say: "Each tile opens the planner's reasons for its verdict. The first one for reels:",
    run: (t) => pick(t, "reels"),
    then: (t) => why(t, "reels"),
  },
  {
    say: "Now a shorter cut: the first 10 s instead of the full 15 s.",
    run: async (t) => {
      await t.set(1, "10");
      await t.until(() => you(t).startsWith("Cut set to first 10 s: re-planned in "));
    },
    then: (t) => you(t),
  },
  {
    say: "And the first reason for broadcast_1080i:",
    run: (t) => pick(t, "broadcast_1080i"),
    then: (t) => why(t, "broadcast_1080i"),
  },
];

export const end = "That's the tour. Drag the presenter across the frame, or change the brief, and every deliverable re-plans.";

// The link's values each re-plan as they are set; the hook re-plans last.
export const share = { apply: (t) => t.until(() => you(t).startsWith("You edited the hook: re-planned in ")) };
