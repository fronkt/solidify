// The site header's behavior (tokens.css .hdr), shared by the landing, the
// science page and the contact page.
//
// The bar is transparent while the page sits at its top and takes its overlay
// and rule once it scrolls; without this module it keeps the overlay, so it is
// legible over anything. It runs for reduced-motion users too: it is
// navigation. The phone menu is a <details>, so it works without script; this
// only closes it on a click elsewhere or on Escape.

export function topnav(): void {
  const nav = document.getElementById("topnav");
  if (!nav) return;
  const onScroll = () => nav.classList.toggle("is-top", scrollY < 4);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const menu = nav.querySelector<HTMLDetailsElement>(".hdr__menu");
  if (!menu) return;
  addEventListener("pointerdown", e => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false; });
  addEventListener("keydown", e => {
    if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary")?.focus(); }
  });
}
