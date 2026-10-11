// Site-independent logic: deciding which listings are "the same product",
// grouping them, reading live bid messages and building links.
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

  // Listings of the same product share one card whatever their condition;
  // each listing's condition is shown on its own row.
  function groupKey(listing) {
    return normalizeTitle(listing.title);
  }

  // Haggle identifies a listing by event id plus lot number; its live-bid feed
  // uses the same "event:lot" key.
  function lotKey(eventId, lotNumber) {
    return String(eventId) + ":" + String(lotNumber);
  }

  // Groups listings in the order their first listing appears. Each group keeps
  // that order too, so group.listings[0] is the one shown first on the page.
  function groupListings(listings) {
    const groups = new Map();
    for (const listing of listings) {
      if (!normalizeTitle(listing.title)) continue;
      const key = groupKey(listing);
      if (!groups.has(key)) groups.set(key, { key, listings: [] });
      groups.get(key).listings.push(listing);
    }
    return [...groups.values()];
  }

  // Lowest current bid first; listings with no bids yet after those, then sold.
  function sortByBid(rows) {
    const rank = (r) => (r.sold ? 2 : r.bid == null ? 1 : 0);
    return [...rows].sort((a, b) => rank(a) - rank(b) || (a.bid || 0) - (b.bid || 0));
  }

  // Reads one message from Haggle's live-bid websocket. Returns
  // { key, bid, nextBid, bidCount, sold, endsAt } or null for messages that
  // aren't about a listing's bid (pings, timer ticks).
  function bidFromMessage(message, now) {
    let msg = message;
    if (typeof msg === "string") {
      try {
        msg = JSON.parse(msg);
      } catch (e) {
        return null;
      }
    }
    const data = msg && msg.data;
    if (!data || data.lot_id == null || data.event_id == null) return null;
    const key = lotKey(data.event_id, data.lot_id);
    if (msg.type === "lot_sold") return { key, sold: true };
    if (msg.type !== "lot_state" && msg.type !== "bid_update") return null;
    const amount = parseFloat(data.bid_amount);
    const next = parseFloat(data.next_bid_amount);
    const history = Array.isArray(data.bidding_history) ? data.bidding_history : null;
    return {
      key,
      bid: amount > 0 ? amount : null,
      nextBid: next > 0 ? next : null,
      bidCount: history ? history.length : null,
      sold: data.status === "2" || data.time_remaining <= 0 || msg.type === "error",
      endsAt: data.end_time || (data.time_remaining > 0 ? new Date((now || Date.now()) + data.time_remaining * 1000).toISOString() : null),
    };
  }

  // Haggle keeps the search and the filter bar's choices in the address, e.g.
  // /browse?search=lamp&sort=retail-price-asc&categories=18,21&conditions=1.
  // Builds the same GetLots variables Haggle's own page builds from them.
  const SORTS = {
    "ending-soonest": { field: "end_event_date", order: "asc" },
    "retail-price-asc": { field: "retail_value", order: "asc" },
    "retail-price-desc": { field: "retail_value", order: "desc" },
  };
  function lotsQuery(search) {
    const params = new URLSearchParams(search);
    const list = (name) => (params.get(name) || "").split(",").map((v) => v.trim()).filter(Boolean);
    const query = [];
    const text = (params.get("search") || "").trim();
    if (text) query.push({ field: "title", value: text });
    const filters = [["conditions", "condition_id"], ["locations", "location_id"], ["categories", "category_id"]];
    for (const [param, field] of filters) {
      const values = [...new Set(list(param))];
      if (values.length) query.push({ field, values });
    }
    const out = { sort: [SORTS[params.get("sort")] || SORTS["ending-soonest"]] };
    if (query.length) out.query = query;
    return out;
  }

  function money(n) {
    if (n == null) return "";
    return "$" + Number(n).toFixed(2);
  }

  // Haggle cuts titles off at about 50 characters. When the description
  // starts with the title it's the full product name, so search by that.
  function shoppingQuery(listing) {
    const title = String(listing.title || "").replace(/\s+/g, " ").trim();
    const full = String(listing.description || "").replace(/\s+/g, " ").trim();
    const titleStart = normalizeTitle(title).replace(/\s*\S+$/, ""); // last word may be cut
    let text = title;
    if (titleStart && full.length > title.length && normalizeTitle(full).startsWith(titleStart)) text = full;
    if (text.length > 100) text = text.slice(0, 100).replace(/\s+\S*$/, "");
    return text;
  }

  function googleShoppingUrl(text) {
    const query = String(text || "").replace(/\s+/g, " ").trim();
    return "https://www.google.com/search?tbm=shop&q=" + encodeURIComponent(query);
  }

  // "3d 4h", "2h 5m", "4m 10s"; "" once the time has passed.
  function timeLeft(endIso, now) {
    const ms = Date.parse(endIso) - (now == null ? Date.now() : now);
    if (!(ms > 0)) return "";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return d + "d " + h + "h";
    if (h) return h + "h " + m + "m";
    return m + "m " + (s % 60) + "s";
  }

  function itemPath(listing) {
    return "/event/" + encodeURIComponent(listing.event_id) + "/" + encodeURIComponent(listing.lot_number);
  }

  const api = {
    normalizeTitle,
    normalizeCondition,
    groupKey,
    lotKey,
    groupListings,
    sortByBid,
    bidFromMessage,
    lotsQuery,
    money,
    shoppingQuery,
    googleShoppingUrl,
    itemPath,
    timeLeft,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HaggleHelperCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
