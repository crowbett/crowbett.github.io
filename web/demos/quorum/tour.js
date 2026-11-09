// The quorum tour: crash the leader and watch an election, cut the new leader
// off with a minority, write on both sides of the cut, then heal and watch the
// minority's uncommitted entry get overwritten.
const v = (t, k) => t.text(`.qr-cells [data-k=${k}] .qr-v`);
const status = (t) => t.text(".qr-status");
const leader = (t) => { const m = /^node (\d+)$/.exec(v(t, "leader")); return m ? Number(m[1]) : 0; };
const term = (t) => Number(v(t, "term").replace(/,/g, "")) || 0;
const writes = (t) => [...t.root.querySelectorAll(".qr-writes li")].map((li) => ({
  kv: li.querySelector(".qr-wk").textContent, st: li.dataset.st, meta: li.querySelector(".qr-wm").textContent,
}));
const write = (t, kv) => writes(t).find((w) => w.kv === kv);
const pause = async (t) => { const b = t.q(".qr-acts button"); if (b.textContent === "Pause") await t.click(b); };
const play = async (t) => { const b = t.q(".qr-acts button"); if (b.textContent === "Play") await t.click(b); };
// e2e plays tours sped up; the cluster then ticks faster too.
const fast = () => (Number(document.documentElement.dataset.tourSpeed) || 1) > 1;
let old = 0, oldTerm = 0;

export const steps = [
  {
    say: "quorum's own raft core and deterministic simulator, compiled to WebAssembly. The leader's heartbeats keep resetting each follower's election timer, the arc around it.",
    run: async (t) => {
      await pause(t);
      await t.set(0, "5"); await t.set(1, "0"); await t.set(2, "0.1"); await t.set(3, fast() ? "20" : "5");
      await t.click("Reset");
      await t.until(() => leader(t) > 0 && /^Warmed up/.test(status(t)));
    },
    then: (t) => `After ${v(t, "tick")} ticks node ${leader(t)} leads term ${v(t, "term")}, with commit index ${v(t, "commit")}.`,
  },
  {
    say: "Crash the leader. The heartbeats stop, the arcs fill, and the first follower whose randomized timeout runs out asks for votes.",
    run: async (t) => {
      old = leader(t); oldTerm = term(t);
      await play(t);
      await t.click("Crash leader");
      await t.until(() => leader(t) > 0 && term(t) > oldTerm, 60000);
    },
    then: (t) => `${status(t)} ${v(t, "leaders")} leaders elected so far; node ${old} is still down.`,
  },
  {
    say: "Restart the old node, then cut the new leader off with one follower, a minority. A write sent right away still reaches that leader.",
    run: async (t) => {
      // A node is an SVG button, which has no click(): press it as a pointer would.
      await t.wait(400);
      t.q(`.qr-node:nth-child(${old})`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await t.until(() => !/down/.test(t.q(`.qr-node:nth-child(${old})`).dataset.role));
      await pause(t);
      old = leader(t); oldTerm = term(t);
      await t.click("Cut off leader");
      await t.set(4, "x"); await t.set(5, "minority");
      await t.click("Put");
      await t.until(() => write(t, "x=minority"));
      await play(t);
      await t.until(() => leader(t) > 0 && leader(t) !== old && term(t) > oldTerm, 60000);
    },
    then: (t) => `The majority elected node ${leader(t)} in term ${v(t, "term")}. x=minority sits on node ${old}'s side, ${write(t, "x=minority").st}: a minority can never commit it.`,
  },
  {
    say: "Write to the majority. Its leader needs acknowledgements from a majority of the cluster, and that side is one.",
    run: async (t) => {
      await t.set(5, "majority");
      await t.click("Put");
      await t.until(() => write(t, "x=majority")?.st === "committed", 60000);
    },
    then: (t) => `x=majority committed (${write(t, "x=majority").meta}). x=minority is ${write(t, "x=minority").st}.`,
  },
  {
    say: "Heal the network. The cut-off nodes hear the higher term, step down, and the new leader overwrites their uncommitted entries.",
    run: async (t) => {
      await t.click("Heal");
      await t.until(() => /log was repaired/.test(status(t)), 60000);
      await t.wait(1500);
      await pause(t);
    },
    then: (t) => `${status(t)} x=minority: ${write(t, "x=minority").st}; x=majority: ${write(t, "x=majority").st}.`,
  },
];

export const end = "That's the tour. Click any node to crash or restart it, cut off the leader, or put your own keys.";

export const share = {
  apply: async (t) => {
    await t.until(() => v(t, "tick") !== "–");
    await t.click("Reset");
    await t.until(() => /^Warmed up/.test(status(t)));
  },
};
