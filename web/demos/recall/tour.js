// The recall tour: the corpus indexed, a query ranked by both lanes and
// fused, Tantivy's own score explanation, redaction, and a note of your own.
const v = (t, k) => t.text(`.rc-cells [data-k=${k}] .rc-v`);
const status = (t) => t.text(".rc-status");
const row = (t, sel) => t.q(sel)?.getAttribute("aria-label") || "";
const ask = async (t, q) => {
  await t.set(0, q);
  await t.until(() => t.text(".rc-plan").startsWith(`query ${q} →`) && status(t) && t.text(".rc-why h3") &&
    row(t, ".rc-row[aria-label^='Result 1:']").startsWith(`Result 1: ${t.text(".rc-why h3")},`));
};

export const steps = [
  {
    say: "recall's own source parsers, redaction, Tantivy index and ranking, compiled from Rust, index a small synthetic project in this tab. Reset streams it into the index:",
    run: async (t) => {
      if (t.text(".rc-transport button") === "Pause") await t.click("Pause");
      if (t.q("select[name=mode]").value !== "hybrid") await t.set(1, "hybrid");
      // Reset empties the index line first; it fills again once the corpus is in.
      const live = t.q(".rc-live");
      let cleared = false;
      const mo = new MutationObserver((rs) => { if (rs.some((r) => !r.addedNodes.length)) cleared = true; });
      mo.observe(live, { childList: true });
      try {
        await t.click("Reset");
        await t.until(() => cleared && status(t) && t.text(".rc-plan").startsWith("query "));
      } finally { mo.disconnect(); }
    },
    then: (t) => `${t.text(".rc-live")}. ${t.text(".rc-absent .rc-sname")} is ${t.text(".rc-absent .rc-why-off")}.`,
  },
  {
    say: "Each query runs BM25 and a vector lane, and reciprocal rank fusion merges them. Searching graceful shutdown:",
    run: (t) => ask(t, "graceful shutdown"),
    then: (t) => `${row(t, ".rc-row[aria-label^='Result 1:']")}. ${status(t)}`,
  },
  {
    say: (t) => {
      const parts = [...t.root.querySelectorAll(".rc-parts tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent))
        .filter((c) => c[1]).slice(0, 4).map((c) => `${c[1]} in ${c[0]} ${c[7]}`);
      return `Tantivy's own explanation of ${t.text(".rc-why h3")}'s BM25 score: ${parts.join(", ")}, total ${t.text(".rc-parts tfoot td:last-child")}.`;
    },
  },
  {
    say: "recall redacts obvious secrets before anything is stored. Searching postgres password:",
    run: (t) => ask(t, "postgres password"),
    then: (t) => status(t),
  },
  {
    say: "Index my note adds the note in the box as a document of your own, then ranks it with the rest. Searching duplicate jobs lease first:",
    run: async (t) => {
      await ask(t, "duplicate jobs lease");
      await t.set(2, "a slow job must renew its lease or it runs twice: duplicate jobs again #leases");
      await t.click("Index my note");
      await t.until(() => status(t).startsWith("your note is") && (t.q(".rc-row.is-you[aria-label^='Result']") || status(t).includes("not in the top")));
    },
    then: (t) => `${status(t).split("; ")[0].replace(/^y/, "Y")}. ${row(t, ".rc-row.is-you[aria-label^='Result']") || status(t).split("; ")[1]}.`,
  },
];

export const end = "That's the tour. Type your own query, turn sources off, or index a note of yours.";
