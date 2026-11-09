// The anchorflow tour: a fresh shift paused after its first orders, one more
// order packed by hand, your own order dropped on the line, then the top
// pick taken off the shelf so the engine re-judges the whole shift.
const v = (t, k) => t.text(`.af-cells [data-k=${k}] .af-v`);
const status = (t) => t.text(".af-status");
const label = (t) => t.q(".af-canvas").getAttribute("aria-label") ?? "";
const chips = (t) => [...t.root.querySelectorAll(".af-chip")];
const ITEM = { cap: "7", shirt: "6" };
// A fresh mixed shift (seed 1) stops after its third order, or its twelfth with reduced motion.
const fresh = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? /: 12 orders packed/ : /^Packing floor at 0:01:27 of floor time: 3 orders packed/);

export const steps = [
  {
    say: "AnchorFlow's real fit engine picks the package for every order on a simulated packing floor. Starting a fresh shift of mixed orders, paused:",
    run: async (t) => {
      if (t.text(".af-acts button") === "Pause") await t.click("Pause");
      if (!t.q(".af-shelfhead button:last-child").disabled) {
        await t.click("Restock");
        await t.until(() => status(t).startsWith("Every package is back on the shelf."));
      }
      await t.set(0, "mixed");
      await t.until(() => fresh().test(label(t)) && status(t).startsWith("mixed: orders arrive"));
    },
    then: (t) => `${v(t, "orders")} orders packed by ${v(t, "t")} of floor time: ${v(t, "boxes")} in boxes, ${v(t, "mailers")} in mailers, cost ${v(t, "cost")}.`,
  },
  {
    say: "Next order sends the next one through the engine:",
    run: async (t) => {
      await t.click("Next order");
      await t.until(() => /latest #004 in /.test(label(t)));
    },
    then: (t) => {
      const [lines, ...notes] = t.text(".af-now").replace(/^at the station, #004: /, "").split(" · ");
      return `Order #004 (${lines}) went in ${label(t).replace(/^.*latest #004 in /, "").replace(/\.$/, "")}${notes.length ? `; ${notes.join("; ")}` : ""}.`;
    },
  },
  {
    say: "Your own order: a cap and two folded T-shirts, dropped on the line.",
    run: async (t) => {
      if (chips(t).map((b) => b.textContent).join("|") !== "Cap ✕|Folded T-shirt ×2 ✕") {
        while (chips(t).length) await t.click(chips(t)[0]);
        await t.set(2, ITEM.cap);
        await t.click("Add");
        await t.set(2, ITEM.shirt);
        await t.click("Add");
        await t.click("Add");
      }
      await t.click("Drop on the line");
      await t.until(() => /^Your order #Y1 \(.*\) went in /.test(t.text(".af-youline")));
    },
    then: (t) => t.text(".af-youline"),
  },
  {
    say: "Take top pick off removes the most-picked package from the shelf, and the engine re-judges every order packed so far:",
    run: async (t) => {
      await t.click("Take top pick off");
      await t.until(() => / is off the shelf\. The engine re-judged all \d+ orders packed so far: /.test(status(t)));
    },
    then: (t) => status(t),
  },
  {
    say: "Restock puts every package back, and the engine re-judges the shift once more. Its tally for the tour:",
    run: async (t) => {
      await t.click("Restock");
      await t.until(() => status(t).startsWith("Every package is back on the shelf."));
    },
    then: (t) => t.text(".af-out"),
  },
];

export const end = "That's the tour. Press Play to let the shift run, or build an order and take packages off the shelf yourself.";

export const share = {
  apply: async (t) => {
    await t.click("Reset");
    await t.until(() => / orders arrive at random/.test(status(t)) && Number(v(t, "orders")) >= 3);
  },
};
