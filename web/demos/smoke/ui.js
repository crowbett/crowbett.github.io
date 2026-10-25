// Smoke demo UI: one round trip through the worker and the Go binary.
export async function mount(el, demo) {
  const out = document.createElement("p");
  out.className = "demo-out";
  const r = await demo.call("ping", { echo: "hello from the page" });
  out.textContent = `Go ${r.go} answered: ${r.echo}`;
  el.replaceChildren(out);
}
