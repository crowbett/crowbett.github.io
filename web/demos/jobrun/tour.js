// The jobrun tour: the scripted warm-up, a flaky job retried through the real
// backoff policy, then a cron expression of your own read by cronx.
const v = (t, k) => t.text(`.jr-cells [data-k=${k}] .jr-v`);
const status = (t) => t.text(".jr-status");
const you = (t) => t.text(".jr-you");
const named = (t, n) => t.q(`[name=${n}]`);
// Sets a control only when it is not already at the tour's value.
const put = async (t, i, n, val) => { const c = named(t, n); if ((c.type === "checkbox" ? c.checked : c.value) !== val) await t.set(i, val); };
const step = async (t) => { const at = v(t, "t"); await t.click("Step 1 min"); await t.until(() => v(t, "t") !== at); };
export const steps = [
  {
    say: "Three cron schedules feed a queue with four workers, through jobrun's own cron parser (cronx) and backoff policy (job.Policy). Reset replays the warm-up:",
    run: async (t) => {
      if ([...t.root.querySelectorAll("button")].some((b) => b.textContent === "Pause")) await t.click("Pause");
      await put(t, 4, "tz", "UTC"); await put(t, 5, "policy", "0"); await put(t, 6, "maxAttempts", "5"); await put(t, 7, "jitter", true);
      await put(t, 8, "workers", "4");
      if (named(t, "expr").value !== "*/5 * * * *") await t.set(3, "*/5 * * * *");
      await t.click("Reset");
      await t.until(() => /sync's handler fails its first attempt/.test(status(t)));
    },
    then: (t) => `At ${v(t, "t")}: ${v(t, "fires")} fires, ${v(t, "runs")} runs, ${v(t, "retries")} retries, ${v(t, "ok")} succeeded. Longest backoff so far: ${v(t, "maxwait")}.`,
  },
  {
    say: "Enqueue a flaky job that fails its first 3 attempts:",
    run: async (t) => { await put(t, 0, "fails", "3"); await t.click("Enqueue flaky job"); await t.until(() => /^Your flaky job #\d+ is queued/.test(you(t))); },
    then: (t) => you(t),
  },
  {
    say: "Stepping a minute at a time while its retries wait out the backoff:",
    run: async (t) => { for (let i = 0; i < 10 && !/succeeded|dead/.test(you(t)); i++) await step(t); await t.until(() => /succeeded|dead/.test(you(t))); },
    then: (t) => `${v(t, "t")}: ${you(t)}`,
  },
  {
    say: "Now a cron expression of your own. Typing 61 * * * * into the cron field:",
    run: async (t) => { await t.set(2, "61 * * * *"); await t.until(() => /^yours: cronx: /.test(status(t))); },
    then: (t) => `cronx refuses it: ${status(t).replace(/^yours: cronx: /, "")}.`,
  },
  {
    say: "And a schedule that fires only on leap days, 0 0 29 2 *:",
    run: async (t) => { await t.set(3, "0 0 29 2 *"); await t.until(() => /^yours: cronx reads it as 0 0 29 2 \*/.test(status(t)) && t.q(".jr-runs li .jr-mono")); },
    then: (t) => `${status(t).replace(/^yours: /, "")} Its next fire is ${t.text(".jr-runs li .jr-mono")} ${t.text(".jr-runs li .jr-zone")}, then ${[...t.root.querySelectorAll(".jr-runs li .jr-mono")].slice(1, 3).map((e) => e.textContent).join(" and ")}.`,
  },
];

export const end = "That's the tour. Press Play, try an outage, or type your own cron expression.";

export const share = {
  apply: async (t) => {
    await t.click("Reset");
    await t.until(() => /sync's handler fails its first attempt/.test(status(t)));
  },
};
