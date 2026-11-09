// The anchorflow tour: a fresh floor paused after its first tote, a coffee
// basket the fit engine declines, the same basket again until shape history
// answers, a bin the parser refuses, and the packing slip.
const v = (t, k) => t.text(`.af-cells [data-k=${k}] .af-v`);
const status = (t) => t.text(".af-status");
const pause = async (t) => { if (t.text(".af-acts button") === "Pause") await t.click("Pause"); };
// next presses Next step and waits for the floor to say what it did.
const next = async (t) => {
  const key = () => `${status(t)}|${v(t, "shipped")}|${v(t, "carts")}|${v(t, "stops")}`;
  const before = key();
  await t.click("Next step");
  await t.until(() => key() !== before);
};
const until = async (t, re, n) => {
  for (let i = 0; i < n && !re.test(status(t)); i++) await next(t);
  if (!re.test(status(t))) throw new Error("the floor did not get there");
};

export const steps = [
  {
    say: "AnchorFlow's own floor code, compiled to WebAssembly. A fresh floor, paused: a cart of four orders from the demo org's stores is picked in walk order, and its first tote packed and labelled.",
    run: async (t) => {
      await pause(t);
      await t.set(0, "");
      await t.set(1, "");
      await t.click("Reset");
      await t.until(() => /^[A-Z]{3}-\d+ went in /.test(status(t)) && v(t, "shipped") === "1");
    },
    then: (t) => `${v(t, "stops")} stops walked. ${status(t)}`,
  },
  {
    say: "The coffee store's bags and mugs are classes the fit engine declines, so a coffee basket falls through the pyramid. A cart of coffee orders:",
    run: async (t) => {
      await t.set(0, "DRF");
      await until(t, /^DRF-\d+ went in /, 8);
    },
    then: (t) => status(t),
  },
  {
    say: "Now the same basket, again and again. Shape history answers once it has shipped at least 3 times with 70 % in one package:",
    run: async (t) => {
      await t.set(0, "repeat");
      await until(t, /\(shape history: /, 16);
    },
    then: (t) => status(t),
  },
  {
    say: "Bins are checked against the aisle layout by warehouse.ParseBin. Aisle A-01 has odd-numbered bins only:",
    run: async (t) => {
      await t.set(3, "LNT-PIN-COMPASS");
      await t.set(4, "A-01-012-C");
      await t.click("Move");
      await t.until(() => status(t).startsWith("warehouse.ParseBin refused"));
    },
    then: (t) => status(t),
  },
  {
    say: "A-01-011-D is a real bin, so the pin moves and the next cart picks it there:",
    run: async (t) => {
      await t.set(4, "A-01-011-D");
      await t.click("Move");
      await t.until(() => status(t).startsWith("Moved "));
    },
    then: (t) => status(t),
  },
  {
    say: "Every packed order gets a 4x6 label and a packing slip as ZPL from labelzpl, drawn here from that ZPL. The packing slip:",
    run: async (t) => {
      await t.click("packing slip");
      await t.until(() => t.text(".af-cap").includes("picks listed"));
    },
    then: (t) => `${t.text(".af-cap")}. ${t.text(".af-out")}`,
  },
];

export const end = "That's the tour. Press Play to let the floor run, pick a store or the same basket again, or tell the packer to take another package.";

export const share = {
  apply: async (t) => {
    await t.until(() => v(t, "carts") !== "0");
    await t.click("Reset");
    await t.until(() => /^A fresh floor|went in /.test(status(t)));
  },
};
