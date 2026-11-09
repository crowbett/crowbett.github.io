// Cross-document view transitions: a project's title flies between its index
// entry and its page, and title and diagram between projects. Only the two elements of
// the project being opened or left get names, so nothing else lifts out of
// the page. Classic and in the head: pagereveal fires before modules run.
(() => {
  document.documentElement.classList.add("js");
  const slugOf = (url) => url && /^\/projects\/([a-z0-9-]+)\/$/.exec(new URL(url).pathname)?.[1];
  const here = slugOf(location.href);
  const parts = (slug) => {
    if (here) return [document.querySelector(".project-head h1 span"), document.querySelector(".facts-fig .dm")];
    return [document.querySelector(`#p-${slug} .it-name`)];
  };
  const name = (slug, vt) => {
    if (!slug || !vt) return;
    const els = parts(slug);
    els.forEach((el, i) => { if (el) el.style.viewTransitionName = i ? "fig" : "title"; });
    vt.finished.finally(() => els.forEach((el) => { if (el) el.style.viewTransitionName = ""; }));
  };
  addEventListener("pageswap", (e) => name(here || slugOf(e.activation?.entry?.url), e.viewTransition));
  addEventListener("pagereveal", (e) => name(here || slugOf(navigation.activation?.from?.url), e.viewTransition));
})();
