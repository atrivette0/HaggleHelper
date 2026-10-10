// Site-independent logic: deciding which listings are "the same product",
// grouping them, and building the Google Shopping link.
(function (root) {
  "use strict";

  // Lowercase, drop punctuation and collapse whitespace so small differences
  // in how a seller typed the title don't split one product into two.
  function normalizeTitle(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/&amp;/g, "&")
      .replace(/[^a-z0-9&+]+/g, " ")
      .trim();
  }

  function normalizeCondition(condition) {
    return String(condition || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function groupKey(listing) {
    return normalizeTitle(listing.title) + "|" + normalizeCondition(listing.condition);
  }

  // "$1,234.50" -> 1234.5; returns null when no amount is present.
  function parsePrice(text) {
    const match = String(text || "").match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  // Returns groups in the order their first listing appeared on the page.
  // Each group's listings are sorted by bid, lowest first, unknown bids last.
  function groupListings(listings) {
    const groups = new Map();
    for (const listing of listings) {
      if (!normalizeTitle(listing.title)) continue;
      const key = groupKey(listing);
      if (!groups.has(key)) groups.set(key, { key, listings: [] });
      groups.get(key).listings.push(listing);
    }
    for (const group of groups.values()) {
      group.listings.sort((a, b) => bidOrder(a.bid) - bidOrder(b.bid));
    }
    return [...groups.values()];
  }

  function bidOrder(bid) {
    return bid == null ? Infinity : bid;
  }

  function googleShoppingUrl(title) {
    const query = String(title || "").replace(/\s+/g, " ").trim();
    return "https://www.google.com/search?tbm=shop&q=" + encodeURIComponent(query);
  }

  const api = { normalizeTitle, normalizeCondition, groupKey, parsePrice, groupListings, googleShoppingUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HaggleHelperCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
