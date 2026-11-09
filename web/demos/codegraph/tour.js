// The codegraph tour: who calls bump, hop by hop; a trait method's callers;
// then what main calls, one hop and all the way down.
const v = (t, k) => t.text(`.cg-cells [data-k=${k}] .cg-v`);
const status = (t) => t.text(".cg-status");
const summary = (t) => t.text(".cg-summary");
// Waits until the ripple has stopped: tiles and receipt unchanged for 800 ms.
const settled = async (t) => {
  let seen = "", at = 0;
  await t.until(() => {
    const k = t.text(".cg-cells") + t.text(".cg-out") + t.root.querySelectorAll(".cg-node.is-up, .cg-node.is-down").length;
    if (k !== seen) { seen = k; at = performance.now(); }
    return performance.now() - at > 800;
  });
};
const find = async (t, name) => {
  const before = t.text(".cg-out");
  await t.set(0, name);
  await t.click("Go");
  await t.until(() => status(t).startsWith(`${name} `) && t.text(".cg-out") !== before);
  await settled(t);
};
const hops = (t) => [...t.root.querySelectorAll(".cg-node.is-up")]
  .map((g) => [g.querySelector(".cg-name").textContent, g.querySelector(".cg-hop").textContent])
  .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([n, h]) => `${n} ${h}`).join(", ");

export const steps = [
  {
    say: "codegraph indexed this small Rust crate in this tab. Asking who calls bump, all the way up:",
    run: async (t) => {
      if ([...t.root.querySelectorAll("button")].some((b) => b.textContent === "Pause")) await t.click("Pause");
      if (t.q("select[name=ripple]").value !== "both") await t.set(1, "both");
      if (t.q("select[name=depth]").value !== "8") await t.set(2, "8");
      await find(t, "bump");
    },
    then: (t) => { const [, fn, n] = /^(.*?\)): (\d+ callers?);/.exec(summary(t)) || []; return `${fn} has ${n} one hop away. The ripple reached ${v(t, "callers")} callers in ${v(t, "depth")} hops: ${hops(t)}.`; },
  },
  {
    say: "write names two functions. A caller that reaches one through a trait is marked via:",
    run: (t) => find(t, "write"),
    then: (t) => `${summary(t)} ${[...t.root.querySelectorAll("[aria-labelledby=cg-callers] .cg-where")].filter((w) => w.textContent.includes("via ")).length} of the callers are marked via.`,
  },
  {
    say: "Now the other way: what main calls, one hop down.",
    run: async (t) => {
      await find(t, "main");
      await t.set(1, "callees");
      await t.set(2, "1");
      await t.until(() => v(t, "callers") === "–" && v(t, "depth") === "1");
      await settled(t);
    },
    then: (t) => `${v(t, "callees")} callees one hop from main, ${v(t, "unresolved")} of them unresolved.`,
  },
  {
    say: "And all the way down:",
    run: async (t) => { const before = t.text(".cg-out"); await t.set(2, "8"); await t.until(() => t.text(".cg-out") !== before); await settled(t); },
    then: (t) => `${v(t, "callees")} callees reached, ${v(t, "depth")} hops deep, ${v(t, "unresolved")} unresolved, in ${v(t, "query")} of queries.`,
  },
];

export const end = "That's the tour. Tap any function in the graph, or type a name, to watch its ripple.";

export const share = {
  apply: async (t) => {
    const name = t.q("input[name=symbol]").value.trim();
    if (!name) return;
    await t.click("Go");
    await t.until(() => status(t).includes(name));
    await settled(t);
  },
};
