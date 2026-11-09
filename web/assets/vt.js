// Cross-document view transitions: a project's title and diagram fly between
// its home row and its page, and between projects. Only the two elements of
// the project being opened or left get names, so nothing else lifts out of
// the page. Classic and in the head: pagereveal fires before modules run.
(() => {
  const slugOf = (url) => url && /^\/projects\/([a-z0-9-]+)\/$/.exec(new URL(url).pathname)?.[1];
  const here = slugOf(location.href);
  const parts = (slug) => {
    if (here) return [document.querySelector(".project-head h1 span"), document.querySelector(".facts-fig .dm")];
    const a = document.querySelector(`.row:not([hidden]) a[href^="/projects/${slug}/"]`);
    return a ? [a.querySelector(".row-name span"), a.querySelector(".dm")] : [];
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
