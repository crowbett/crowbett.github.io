// Narrows the home index: a search box (every word must match a project's name,
// tagline, language or topics) and one group chip at a time. "/" focuses the
// search and Escape clears it. The query and group live in the URL (?q=, ?g=)
// so a filtered view can be shared or reloaded.
const finder = document.querySelector(".finder");
const index = finder?.closest(".index");
if (finder && index) {
  const input = finder.querySelector("input");
  const chips = [...finder.querySelectorAll("[data-g]")];
  const groups = [...index.querySelectorAll(".group")];
  const count = index.querySelector(".count");
  const nomatch = index.querySelector(".nomatch");
  const total = count.textContent;
  const all = index.querySelectorAll(".row").length;
  let group = "";

  const apply = () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const g of groups) {
      let inGroup = 0;
      for (const r of g.querySelectorAll(".row")) {
        const on = (!group || g.dataset.g === group) && words.every((w) => r.dataset.q.includes(w));
        r.hidden = !on;
        if (on) inGroup++;
      }
      g.hidden = inGroup === 0;
      shown += inGroup;
    }
    for (const c of chips) c.setAttribute("aria-pressed", String(c.dataset.g === group));
    nomatch.hidden = shown > 0;
    count.textContent = shown === all ? total : `${shown} of ${all} shown`;
    const url = new URL(location.href);
    for (const [k, v] of [["q", input.value.trim()], ["g", group]]) {
      if (v) url.searchParams.set(k, v); else url.searchParams.delete(k);
    }
    if (url.href !== location.href) history.replaceState(history.state, "", url);
  };

  const params = new URLSearchParams(location.search);
  input.value = params.get("q") ?? "";
  group = chips.some((c) => c.dataset.g === params.get("g")) ? params.get("g") : "";
  finder.hidden = false;
  apply();

  input.addEventListener("input", apply);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) { input.value = ""; apply(); e.stopPropagation(); }
    if (e.key === "Enter") index.querySelector(".row:not([hidden]) a")?.focus();
  });
  finder.addEventListener("click", (e) => {
    const c = e.target.closest("[data-g]");
    if (!c) return;
    group = c.dataset.g;
    apply();
  });
  nomatch.querySelector("button").addEventListener("click", () => {
    input.value = "";
    group = "";
    apply();
    input.focus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
}
