// The keys sheet: every keyboard shortcut on the site in one dialog, in the
// palette's frame. nav.js loads it on first use: the ? key, the footer or the
// palette. Each row is a key nav.js or xray.js handles.
const groups = (mac) => [
  ["Anywhere", [
    [[mac ? "⌘K" : "Ctrl K", "/"], "Search projects, write-ups and code"],
    [["`"], "Open the terminal"],
    [["t"], "Switch light and dark"],
    [["?"], "Show this list"],
    [["Esc"], "Close whatever is open"],
  ]],
  ["Home", [
    [["j", "k"], "Next and previous project"],
  ]],
  ["A project page", [
    [["[", "]"], "Previous and next project"],
    [["x"], "X-ray: the demo's live numbers"],
  ]],
];
let dlg;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function open(mac) {
  if (!dlg) {
    dlg = el("dialog", "pal pal-keys");
    dlg.setAttribute("aria-label", "Keyboard shortcuts");
    dlg.setAttribute("closedby", "any");
    const plate = el("div", "pal-p");
    const shut = el("button", "pal-x", "close");
    shut.type = "button";
    shut.addEventListener("click", () => dlg.close());
    plate.append(el("span", null, "Keys"), shut);
    const list = el("div", "keys-l");
    for (const [name, rows] of groups(mac)) {
      const dl = el("dl");
      for (const [ks, what] of rows) {
        const row = el("div"), dt = el("dt");
        ks.forEach((k, i) => dt.append(i ? " " : "", el("kbd", null, k)));
        row.append(dt, el("dd", null, what));
        dl.append(row);
      }
      list.append(el("h2", "pal-h", name), dl);
    }
    dlg.append(plate, list);
    document.body.append(dlg);
  }
  if (!dlg.open) dlg.showModal();
}
