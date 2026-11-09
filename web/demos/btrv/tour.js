// The btrv tour: the sample mapped and read, one data page corrupted so the
// read stops rather than skip it, the repair, then a layout btrv infers itself.
const v = (t, k) => t.text(`.bt-cells [data-k=${k}] .bt-v`);
const status = (t) => t.text(".bt-status");
const btn = (t, s) => [...t.root.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(s));
const kinds = (t, k) => t.text(`.bt-key[data-kind=${k}] .bt-count`);

// walk runs one action that maps and reads the file again, and waits for that
// read to finish: a fresh map shows "Map.Describe" under the map first.
async function walk(t, act) {
  let fresh = false;
  const mo = new MutationObserver((rs) => { if (rs.some((r) => r.addedNodes[0]?.data?.startsWith("Map.Describe"))) fresh = true; });
  mo.observe(t.q(".bt-now"), { childList: true });
  try {
    await act();
    await t.until(() => fresh);
    if (btn(t, "Play")?.textContent === "Play") await t.click("Play");
    await t.until(() => btn(t, "Replay") && !btn(t, "Reset").disabled, 60000);
  } finally { mo.disconnect(); }
}

export const steps = [
  {
    say: "btrv's page reader, page map and export loop, compiled from Go. It maps a synthetic Btrieve 6.x sample one page header at a time, then reads its data pages in logical order:",
    run: async (t) => {
      if (btn(t, "Back to the sample") && !btn(t, "Back to the sample").hidden) await walk(t, () => t.click("Back to the sample"));
      await t.set(2, "5");
      const file = [...t.q("select[name=file]").options].find((o) => !o.textContent.endsWith("(dictionary)")).value;
      await walk(t, () => t.set(0, file));
      if (btn(t, "Repair page")) await walk(t, () => t.click("Repair page"));
    },
    then: (t) => `${v(t, "format")}, ${v(t, "pages")} pages of ${v(t, "pagesize")}, ${kinds(t, "data")} of them data pages. ${status(t)}`,
  },
  {
    say: "Corrupt page flips one header byte of the picked data page in this tab's copy, and btrv maps and reads the file again:",
    run: async (t) => walk(t, () => t.click("Corrupt page")),
    then: (t) => `${status(t).replace(/(rather than skip a page).*$/, "$1.")} Bad pages: ${v(t, "bad")}.`,
  },
  {
    say: "Repair puts the byte back, and the same read runs again:",
    run: async (t) => walk(t, () => t.click("Repair page")),
    then: (t) => status(t),
  },
  {
    say: "Without the DDF dictionary, btrv infers the record layout itself (schema: inferred by btrv):",
    run: async (t) => walk(t, () => t.set(1, "infer")),
    then: (t) => `${v(t, "records")} records decoded into columns ${[...t.root.querySelectorAll(".bt-feed thead th")].slice(1, 4).map((th) => th.textContent).join(", ")} and so on.`,
  },
];

export const end = "That's the tour. Pick any page on the map, or open your own Btrieve files; they are read in this tab and never uploaded.";

export const share = {
  apply: async (t) => {
    await t.until(() => !btn(t, "Reset").disabled);
    await walk(t, () => t.click("Reset"));
  },
};
