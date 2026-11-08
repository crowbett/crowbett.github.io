// Filters the home index by tag: one pressed button at a time, "All" clears.
const box = document.querySelector(".filter");
const index = box?.closest(".index");
if (box && index) {
  const buttons = [...box.querySelectorAll("button")];
  const count = index.querySelector(".count");
  const total = count.textContent;
  const rows = [...index.querySelectorAll(".row")];
  box.hidden = false;
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const f = b.dataset.f;
    for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
    let shown = 0;
    for (const r of rows) {
      const on = !f || r.dataset.tags.split(" ").includes(f);
      r.hidden = !on;
      if (on) shown++;
    }
    count.textContent = f ? `${shown} of ${rows.length} shown` : total;
  });
}
