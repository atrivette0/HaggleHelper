// Runs on Haggle pages: adds a "Check MSRP" link to every listing and folds
// identical listings (same title and condition) into one card that lists
// every current bid.
(function () {
  "use strict";

  const core = globalThis.HaggleHelperCore;
  const adapter = globalThis.HaggleHelperAdapter;
  const MARK = "data-hh";

  function money(n) {
    return n == null ? "No bids" : "$" + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children || []) node.appendChild(child);
    node.setAttribute(MARK, "");
    return node;
  }

  // Our own links live inside cards that are often one big link; keep clicks on
  // them from also opening the listing.
  function isolateClick(node) {
    node.addEventListener("click", (e) => e.stopPropagation());
    return node;
  }

  function addMsrpLink(listing) {
    if (listing.card.querySelector(".hh-msrp")) return;
    const link = el("a", {
      class: "hh-msrp",
      href: core.googleShoppingUrl(listing.title),
      target: "_blank",
      rel: "noopener noreferrer",
      title: "Search Google Shopping for this product's retail price",
      text: "Check MSRP on Google Shopping",
    });
    listing.card.appendChild(isolateClick(link));
  }

  function bidPanel(group) {
    const bids = group.listings.map((l) => l.bid).filter((b) => b != null);
    const summary =
      group.listings.length + " listings" +
      (bids.length ? " · bids " + money(Math.min(...bids)) + " to " + money(Math.max(...bids)) : "");
    const rows = group.listings.map((l) =>
      el("li", {}, [
        el("a", { href: l.url, text: money(l.bid) }),
      ])
    );
    const details = el("details", { class: "hh-group" }, [
      el("summary", { text: summary }),
      el("ul", {}, rows),
    ]);
    return isolateClick(details);
  }

  // Undo the previous pass so regrouping after new results load starts clean.
  function reset() {
    document.querySelectorAll(".hh-group").forEach((n) => n.remove());
    document.querySelectorAll(".hh-duplicate").forEach((n) => n.classList.remove("hh-duplicate"));
  }

  function apply() {
    reset();
    const listings = adapter.readListings(document, core);
    for (const listing of listings) addMsrpLink(listing);
    for (const group of core.groupListings(listings)) {
      if (group.listings.length < 2) continue;
      // Keep the first card in page order visible so the layout doesn't jump.
      const cards = group.listings.map((l) => l.card);
      const keep = listings.find((l) => cards.includes(l.card)).card;
      for (const card of cards) if (card !== keep) card.classList.add("hh-duplicate");
      keep.appendChild(bidPanel(group));
    }
  }

  // Haggle loads more results without a full page load, so re-run whenever the
  // page changes, ignoring changes we made ourselves.
  let timer = null;
  const observer = new MutationObserver((mutations) => {
    const external = mutations.some((m) =>
      [...m.addedNodes, ...m.removedNodes].some((n) => !(n.nodeType === 1 && n.hasAttribute(MARK)))
    );
    if (!external) return;
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });

  function run() {
    observer.disconnect();
    try {
      apply();
    } finally {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  run();
})();
