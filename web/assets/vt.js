// Cross-document view transitions: a project's title flies between its reel
// panel or index card and its page, and title, diagram and screen between projects. Only
// the elements of the project being opened or left get names, so nothing else lifts out of
// the page. Classic and in the head: pagereveal fires before modules run.
(() => {
  document.documentElement.classList.add("js");
  const slugOf = (url) => url && /^\/projects\/([a-z0-9-]+)\/$/.exec(new URL(url).pathname)?.[1];
  const here = slugOf(location.href);
  // The screen flies too: the current panel's screen on home becomes the
  // project page's screen.
  const parts = (slug) => {
    const q = (s) => document.querySelector(s);
    if (here) return { title: q(".project-head h1 span"), fig: q(".facts-fig .dm"), screen: q(".ph-screen") };
    // From the index at the end of the reel, its card flies instead.
    const card = q(`#c-${slug}`);
    if (card && !q(".it[data-now]")) {
      const r = card.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) return { title: q(`#c-${slug} .card-name`), screen: q(`#c-${slug} .card-shot`) };
    }
    return { title: q(`#p-${slug} .it-name`), screen: q(`#p-${slug}[data-now] .it-glass`) };
  };
  const name = (slug, vt) => {
    if (!slug || !vt) return;
    const els = Object.entries(parts(slug)).filter(([, el]) => el);
    for (const [n, el] of els) el.style.viewTransitionName = n;
    vt.finished.finally(() => els.forEach(([, el]) => { el.style.viewTransitionName = ""; }));
  };
  addEventListener("pageswap", (e) => name(here || slugOf(e.activation?.entry?.url), e.viewTransition));
  addEventListener("pagereveal", (e) => name(here || slugOf(navigation.activation?.from?.url), e.viewTransition));
})();
