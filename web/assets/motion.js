// Plays a project diagram once, when it is mostly on screen, so
// the visitor sees it (site.css flips .dm.play; hover loops need no JS).
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("play");
    seen.unobserve(e.target);
  }
}, { threshold: 0.6 });
for (const dg of document.querySelectorAll(".row .dm, .facts .dm")) seen.observe(dg);
