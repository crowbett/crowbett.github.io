// Site-wide keys and speed. The Search link goes to the home work index without
// JS. ⌘K, Ctrl+K or "/" opens the palette anywhere and ` the terminal; j and k
// walk the index; [ and ] step between projects. A link the pointer or focus rests on is
// prefetched, so the next page is usually there before the click lands.
const button = document.querySelector("[data-palette]");
const mac = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform ?? navigator.platform);
let palette, shell;
const open = async () => (palette ??= await import("/assets/palette.js")).open(button);
// The terminal (shell.js) opens from its header key, the ` key or the palette.
const term = document.querySelector("[data-shell]");
export const openShell = async (from) => (shell ??= await import("/assets/shell.js")).open(from);
if (term) {
  term.hidden = false;
  term.addEventListener("click", () => openShell(term));
  term.addEventListener("pointerenter", () => import("/assets/shell.js"), { once: true });
}

if (button) {
  button.querySelector("kbd").textContent = mac ? "⌘K" : "Ctrl K";
  button.addEventListener("click", (e) => { e.preventDefault(); open(); });
  button.addEventListener("pointerenter", () => import("/assets/palette.js"), { once: true });
}

const typing = (t) => t instanceof Element && t.closest("input, textarea, select, [contenteditable], .demo-mount, dialog");

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    open();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
  if (e.key === "`") {
    e.preventDefault();
    openShell(term);
  } else if (e.key === "/") {
    e.preventDefault();
    open();
  } else if (e.key === "j" || e.key === "k") {
    const names = [...document.querySelectorAll(".it h4 a")];
    if (!names.length) return;
    const i = names.indexOf(document.activeElement);
    const next = names[i < 0 ? 0 : Math.max(0, Math.min(names.length - 1, i + (e.key === "j" ? 1 : -1)))];
    // The reel (work.js) brings a panel up when focus lands in it.
    next.focus({ preventScroll: true });
    e.preventDefault();
  } else if (e.key === "[" || e.key === "]") {
    document.querySelector(`.pager [rel=${e.key === "[" ? "prev" : "next"}]`)?.click();
  }
});

const warmed = new Set([location.pathname]);
const warm = (e) => {
  const a = e.target instanceof Element && e.target.closest("a[href]");
  if (!a || a.origin !== location.origin || !a.pathname.endsWith("/") || warmed.has(a.pathname)) return;
  warmed.add(a.pathname);
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = a.pathname;
  document.head.append(link);
};
addEventListener("pointerover", warm, { passive: true });
addEventListener("touchstart", warm, { passive: true });
addEventListener("focusin", warm);
