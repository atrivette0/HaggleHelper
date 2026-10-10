// Haggle-specific page reading: finds listing cards and pulls out the title,
// condition, current bid and link from each one.
//
// The SELECTORS below are empty until they are matched to Haggle's real markup;
// while a selector is empty the adapter falls back to a heuristic that looks for
// a grid of repeated cards that each contain a price.
(function (root) {
  "use strict";

  const SELECTORS = {
    card: "",
    title: "",
    condition: "",
    bid: "",
    link: "",
  };

  const PRICE_RE = /\$\s*[\d,]+(?:\.\d{1,2})?/;
  const CONDITION_RE =
    /\b(brand new|new(?: in box)?|like new|open box|used|refurbished|pre-?owned|damaged|for parts|salvage|returns?)\b/i;

  function findCards(doc) {
    if (SELECTORS.card) return [...doc.querySelectorAll(SELECTORS.card)];
    return guessCards(doc);
  }

  // Find the parent element with the most look-alike children (same tag and
  // class) that each show a price. That set of children is the results grid.
  function guessCards(doc) {
    const priceLeaves = [...doc.body.querySelectorAll("*")].filter(
      (el) => el.children.length === 0 && PRICE_RE.test(el.textContent)
    );
    let best = [];
    const seen = new Set();
    for (const leaf of priceLeaves) {
      for (let el = leaf; el && el.parentElement && el !== doc.body; el = el.parentElement) {
        const parent = el.parentElement;
        const signature = el.tagName + "." + el.className;
        const siblings = [...parent.children].filter(
          (c) => c.tagName + "." + c.className === signature && PRICE_RE.test(c.textContent)
        );
        if (siblings.length >= 2 && el.querySelector("a[href]")) {
          if (!seen.has(siblings[0]) && siblings.length > best.length) best = siblings;
          seen.add(siblings[0]);
          break;
        }
      }
    }
    return best;
  }

  function pick(card, selector) {
    return selector ? card.querySelector(selector) : null;
  }

  function readTitle(card) {
    const el = pick(card, SELECTORS.title);
    if (el) return el.textContent.trim();
    const candidates = [...card.querySelectorAll("h1, h2, h3, h4, h5, a[href], [title]")]
      .filter((c) => !c.closest("[data-hh]"))
      .map((c) => (c.getAttribute("title") || c.textContent || "").trim())
      .filter((t) => t && !PRICE_RE.test(t));
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  // Card text with a space between elements, so "Vacuum" and "New" in
  // neighboring elements don't run together, and without our own additions.
  function visibleText(card) {
    const parts = [];
    const walker = card.ownerDocument.createTreeWalker(card, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement.closest("[data-hh]")) parts.push(n.nodeValue);
    }
    return parts.join(" ").replace(/\s+/g, " ");
  }

  function readCondition(card) {
    const el = pick(card, SELECTORS.condition);
    if (el) return el.textContent.trim();
    const match = visibleText(card).match(CONDITION_RE);
    return match ? match[1] : "";
  }

  // Prefer an amount labeled as a bid; otherwise the first amount in the card.
  function readBid(card, parsePrice) {
    const el = pick(card, SELECTORS.bid);
    if (el) return parsePrice(el.textContent);
    const text = visibleText(card);
    const labeled = text.match(/bid[^$]{0,20}(\$\s*[\d,]+(?:\.\d{1,2})?)/i);
    return parsePrice(labeled ? labeled[1] : text);
  }

  function readLink(card) {
    const el = pick(card, SELECTORS.link) || card.querySelector("a[href]");
    return el ? el.href : "";
  }

  function readListings(doc, core) {
    return findCards(doc).map((card) => ({
      card,
      title: readTitle(card),
      condition: readCondition(card),
      bid: readBid(card, core.parsePrice),
      url: readLink(card),
    }));
  }

  const api = { SELECTORS, readListings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HaggleHelperAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
