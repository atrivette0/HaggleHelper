// Runs on Haggle pages, in the page's own context (it reads React props and
// what src/page-hook.js collected).
//
// On search results (/browse) it swaps Haggle's grid for its own list:
// - every result is loaded up front, not a few rows at a time;
// - listings of the same product (same title) share one card
//   (whatever their condition) that lists each listing's location,
//   condition, current bid and time left;
// - each card links to Google Shopping to check the MSRP.
// Haggle's own grid only renders the rows on screen and re-renders them as you
// scroll, so changing it in place made cards blink in and out; HaggleHelper
// leaves it alone and hides it instead.
//
// Elsewhere (home, event pages) it only adds the MSRP link to Haggle's cards.
// It also keeps your place in the results when you go back from an item.
// The switch in the extension's toolbar menu turns all of this off and on.
(function () {
  "use strict";

  const core = globalThis.HaggleHelperCore;
  const adapter = globalThis.HaggleHelperAdapter;
  const hook = window.__HaggleHelper || { bids: new Map(), subscribed: new Set(), subscribe() {} };
  const MARK = "data-hh";
  const PAGE_SIZE = 500; // the most Haggle's API returns per request
  const MAX_RESULTS = 5000;
  const LOTS_QUERY =
    "query HaggleHelperLots($from: Int!, $size: Int!, $sort: [SortInput]!, $query: [QueryInput!]) {" +
    " getLots(from: $from, size: $size, sort: $sort, query: $query) {" +
    " lot_number event_id title description condition location retail_value end_event_date" +
    " images { order url } bid_detail { current_bid bid_history { bidder } } } }";

  let enabled = document.documentElement.getAttribute("data-hh-enabled") !== "false";

  function onResultsPage() {
    return location.pathname === "/browse";
  }

  // ---- Loading every result ------------------------------------------------

  let results = { queryJson: null, lots: [], loading: false, failed: false, version: 0 };

  function currentQuery() {
    return core.lotsQuery(location.search);
  }

  async function refreshResults() {
    if (!enabled || !onResultsPage() || !hook.api) return;
    const query = currentQuery();
    const queryJson = JSON.stringify(query);
    if (queryJson === results.queryJson) return;
    results = { queryJson, lots: [], loading: true, failed: false, version: results.version + 1 };
    const mine = results;
    try {
      for (let from = 0; from < MAX_RESULTS; from += PAGE_SIZE) {
        const res = await fetch(hook.api.url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": hook.api.key },
          body: JSON.stringify({
            operationName: "HaggleHelperLots",
            query: LOTS_QUERY,
            variables: { ...query, from, size: PAGE_SIZE },
          }),
        });
        const json = await res.json();
        if (results !== mine) return; // the search changed meanwhile
        const page = (json && json.data && json.data.getLots) || [];
        if (!json || !json.data) throw new Error("no data");
        mine.lots = mine.lots.concat(page);
        mine.version++;
        renderView();
        if (page.length < PAGE_SIZE) break;
      }
    } catch (e) {
      if (results === mine) mine.failed = true;
    }
    if (results === mine) {
      mine.loading = false;
      mine.version++;
      renderView();
    }
  }

  // ---- Bids ---------------------------------------------------------------

  function bidInfo(lot) {
    const key = core.lotKey(lot.event_id, lot.lot_number);
    const msg = hook.bids.get(key);
    const live = msg ? core.bidFromMessage(msg) : null;
    if (live) return { ...live, endsAt: live.endsAt || lot.end_event_date, known: true };
    const detail = lot.bid_detail || {};
    const ended = !core.timeLeft(lot.end_event_date);
    return {
      bid: detail.current_bid > 0 ? detail.current_bid : null,
      sold: ended,
      endsAt: lot.end_event_date,
      known: detail.current_bid > 0 || ended,
    };
  }

  function bidText(info) {
    if (info.bid != null) return (info.sold ? "Sold " : "Bid ") + core.money(info.bid);
    if (info.sold) return "Time's up";
    return info.known ? "No bids" : "…";
  }

  // ---- Building nodes -------------------------------------------------------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "text") node.textContent = v;
      else if (v != null) node.setAttribute(k, v);
    }
    for (const child of children || []) if (child) node.appendChild(child);
    node.setAttribute(MARK, "");
    return node;
  }

  function msrpLink(lot) {
    const a = el("a", {
      class: "hh-msrp",
      href: core.googleShoppingUrl(core.shoppingQuery(lot)),
      target: "_blank",
      rel: "noopener noreferrer",
      title: "Search Google Shopping for this product's retail price",
      text: "Check MSRP on Google Shopping",
    });
    // Haggle's own cards open the listing when clicked anywhere.
    a.addEventListener("click", (e) => e.stopPropagation());
    return a;
  }

  function firstImage(lot) {
    const images = [...(lot.images || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    return images[0] && images[0].url;
  }

  function listingRow(lot, showCondition) {
    const key = core.lotKey(lot.event_id, lot.lot_number);
    const condition = (lot.condition || "").trim();
    return el("li", { "data-hh-lot": key }, [
      el("a", { href: core.itemPath(lot), text: lot.location || "Listing" }),
      showCondition ? el("span", { class: "hh-rcond", "data-cond": condition, text: condition }) : null,
      el("span", { class: "hh-bid" }),
      el("span", { class: "hh-left" }),
    ]);
  }

  function fillRow(row, lot) {
    const info = bidInfo(lot);
    row.querySelector(".hh-bid").textContent = bidText(info);
    row.querySelector(".hh-left").textContent = info.sold ? "" : core.timeLeft(info.endsAt);
    row.classList.toggle("hh-ended", !!info.sold);
  }

  function groupCard(group) {
    // Lowest current bid first, so the best deal is the card's main link.
    const lots = core.sortByBid(group.listings.map((lot) => ({ lot, ...bidInfo(lot) }))).map((r) => r.lot);
    const lead = lots[0];
    const img = firstImage(lead);
    const conditions = [...new Set(lots.map((l) => (l.condition || "").trim()))];
    const mixed = conditions.length > 1;
    const card = el("article", { class: "hh-card" }, [
      el("a", { class: "hh-photo", href: core.itemPath(lead) }, [
        img ? el("img", { src: img, alt: "", loading: "lazy" }) : null,
        mixed
          ? el("span", { class: "hh-cond", "data-cond": "mixed", text: conditions.length + " conditions" })
          : el("span", { class: "hh-cond", "data-cond": conditions[0], text: conditions[0] }),
        lead.retail_value ? el("span", { class: "hh-retail", text: core.money(lead.retail_value) }) : null,
        lots.length > 1 ? el("span", { class: "hh-count", text: "×" + lots.length }) : null,
      ]),
      el("a", { class: "hh-title", href: core.itemPath(lead), title: lead.description || lead.title, text: lead.title }),
      // Listings and bids stay folded until you open them.
      el("details", { class: "hh-listings" }, [
        el("summary", { class: "hh-sum" }),
        el("ul", { class: "hh-rows" }, lots.map((lot) => listingRow(lot, mixed))),
      ]),
      msrpLink(lead),
    ]);
    card.hhLots = lots;
    return card;
  }

  // ---- The results view --------------------------------------------------------

  let view = null;
  let built = { version: -1 };
  let cardObserver = null;
  const visibleCards = new Set();

  function ensureView() {
    const native = adapter.findScroller(document);
    if (!native) return null;
    if (!native.hasAttribute("data-hh-hidden")) native.setAttribute("data-hh-hidden", "");
    if (!view) {
      view = el("section", { class: "hh-view" }, [
        el("div", { class: "hh-head" }, [el("h2", { text: "Browse All Items" }), el("span", { class: "hh-summary" })]),
        el("div", { class: "hh-grid" }),
        el("div", { class: "hh-status" }),
      ]);
      cardObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) visibleCards.add(e.target);
            else visibleCards.delete(e.target);
          }
          subscribeVisible();
        },
        { root: view, rootMargin: "1000px 0px" }
      );
    }
    if (view.nextElementSibling !== native) native.parentElement.insertBefore(view, native);
    return view;
  }

  function removeView() {
    document.querySelectorAll("[data-hh-hidden]").forEach((n) => n.removeAttribute("data-hh-hidden"));
    if (view) view.remove();
    if (cardObserver) cardObserver.disconnect();
    view = null;
    cardObserver = null;
    visibleCards.clear();
    built = { version: -1 };
  }

  function renderView() {
    if (!enabled || !onResultsPage() || !ensureView()) return;
    const grid = view.querySelector(".hh-grid");
    if (built.version !== results.version || built.queryJson !== results.queryJson) {
      const groups = core.groupListings(results.lots);
      const keep = built.queryJson === results.queryJson ? built.cards : new Map();
      const cards = new Map();
      // Reuse cards whose listings haven't changed, so images don't reload
      // and the list doesn't jump while later pages arrive.
      const frag = document.createDocumentFragment();
      for (const group of groups) {
        const sig = group.listings.map((l) => core.lotKey(l.event_id, l.lot_number)).join(",");
        let card = keep.get(group.key);
        if (!card || card.hhSig !== sig) {
          card = groupCard(group);
          card.hhSig = sig;
        }
        cards.set(group.key, card);
        frag.appendChild(card);
      }
      if (built.queryJson !== results.queryJson) view.scrollTop = 0;
      const fresh = new Set(cards.values());
      for (const old of keep.values()) {
        if (fresh.has(old)) continue;
        cardObserver.unobserve(old);
        visibleCards.delete(old);
      }
      grid.replaceChildren(frag);
      for (const card of cards.values()) cardObserver.observe(card);
      built = { version: results.version, queryJson: results.queryJson, cards, groups: groups.length };
    }
    const n = results.lots.length;
    view.querySelector(".hh-summary").textContent = n
      ? n + " listings · " + built.groups + " products" + (results.loading ? " · loading more…" : "")
      : "";
    view.querySelector(".hh-status").textContent = results.failed
      ? "Couldn't load all results from Haggle. Turn HaggleHelper off to use Haggle's own list."
      : results.loading || !results.queryJson
        ? "Loading results…"
        : n
          ? ""
          : "No items found.";
    refreshRows();
  }

  // Bids and countdowns change all the time; update just those texts, and
  // keep each card's listings ordered lowest bid first as bids come in.
  function refreshRows() {
    if (!view) return;
    for (const card of visibleCards) {
      if (card.hhLots.length > 1) {
        const order = core.sortByBid(card.hhLots.map((lot) => ({ lot, ...bidInfo(lot) }))).map((r) => r.lot);
        if (order.some((lot, i) => lot !== card.hhLots[i])) {
          const list = card.querySelector(".hh-rows");
          const byKey = new Map([...list.children].map((li) => [li.getAttribute("data-hh-lot"), li]));
          for (const lot of order) list.appendChild(byKey.get(core.lotKey(lot.event_id, lot.lot_number)));
          card.hhLots = order;
        }
      }
      const rows = card.querySelectorAll("li[data-hh-lot]");
      card.hhLots.forEach((lot, i) => rows[i] && fillRow(rows[i], lot));
      card.querySelector(".hh-sum").textContent = summaryText(card.hhLots);
    }
  }

  // The folded line: the best live bid, and how many listings there are.
  function summaryText(lots) {
    const infos = lots.map(bidInfo);
    const live = infos.filter((i) => !i.sold);
    const bids = live.map((i) => i.bid).filter((b) => b != null);
    const count = lots.length > 1 ? lots.length + " listings · " : "";
    if (!live.length) return count + "Time's up";
    if (bids.length) return count + (lots.length > 1 ? "lowest bid " : "Bid ") + core.money(Math.min(...bids));
    if (live.some((i) => !i.known)) return count + "Loading bids…";
    return count + "No bids yet";
  }

  function subscribeVisible() {
    for (const card of visibleCards) {
      for (const lot of card.hhLots) {
        if (!core.timeLeft(lot.end_event_date)) continue;
        hook.subscribe(lot.event_id, lot.lot_number);
      }
    }
    refreshRows();
  }

  // ---- MSRP links on Haggle's own cards (pages other than results) ---------

  function decorateNativeCards() {
    for (const card of adapter.findCards(document)) {
      if (card.querySelector(".hh-msrp")) continue;
      const lot = adapter.readLot(card);
      if (!lot) continue;
      const box = el("div", { class: "hh-extras" }, [msrpLink(lot)]);
      card.appendChild(box);
    }
  }

  function removeNativeDecorations() {
    document.querySelectorAll(".hh-extras").forEach((n) => n.remove());
  }

  // ---- On/off ---------------------------------------------------------------
  // The switch lives in the extension's toolbar menu (src/popup.html). This
  // script runs in the page, which can't read extension settings, so
  // src/bridge.js passes the setting on as an attribute and an event.

  function readSetting() {
    return document.documentElement.getAttribute("data-hh-enabled") !== "false";
  }

  function setEnabled(value) {
    if (value === enabled) return;
    enabled = value;
    stopRestoring();
    if (enabled) {
      results = { queryJson: null, lots: [], loading: false, failed: false, version: results.version + 1 };
      refreshResults();
    } else {
      removeView();
      removeNativeDecorations();
    }
    run();
  }

  document.addEventListener("hh:setting", () => setEnabled(readSetting()));

  // ---- Keeping scroll position --------------------------------------------
  // Save how far down the results you are as you scroll; when you come back to
  // the same results, scroll back there (keep nudging while results load).

  let restoring = null;

  function scrollBox() {
    return enabled && view && view.isConnected ? view : adapter.findScroller(document);
  }

  function pageKey() {
    return "hh-scroll:" + (enabled ? "hh:" : "") + location.pathname + location.search;
  }

  let saveTimer = null;
  document.addEventListener(
    "scroll",
    (e) => {
      const box = scrollBox();
      if (!box || e.target !== box || restoring) return;
      clearTimeout(saveTimer);
      const key = pageKey();
      saveTimer = setTimeout(() => {
        try {
          sessionStorage.setItem(key, String(box.scrollTop));
        } catch (err) {
          // Storage refused; nothing to restore later.
        }
      }, 150);
    },
    true
  );

  function restoreScroll() {
    let target;
    try {
      target = Number(sessionStorage.getItem(pageKey()));
    } catch (e) {
      return;
    }
    if (!target) return;
    stopRestoring();
    const startedAt = Date.now();
    let settled = 0;
    const stop = () => stopRestoring();
    for (const type of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(type, stop, { capture: true, once: true });
    restoring = {
      stop,
      timer: setInterval(() => {
        const box = scrollBox();
        if (Date.now() - startedAt > 15000) return stopRestoring();
        if (!box) return;
        box.scrollTop = target;
        settled = Math.abs(box.scrollTop - target) < 4 ? settled + 1 : 0;
        if (settled >= 3) stopRestoring();
      }, 200),
    };
  }

  function stopRestoring() {
    if (!restoring) return;
    clearInterval(restoring.timer);
    for (const type of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(type, restoring.stop, { capture: true });
    restoring = null;
  }

  // ---- Wiring ---------------------------------------------------------------

  function apply() {
    if (!enabled) return;
    if (onResultsPage()) renderView();
    else {
      if (view) removeView();
      decorateNativeCards();
    }
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  }

  const observer = new MutationObserver((mutations) => {
    const external = mutations.some((m) =>
      [...m.addedNodes, ...m.removedNodes].some((n) => !(n.nodeType === 1 && (n.hasAttribute(MARK) || n.closest("[" + MARK + "]"))))
    );
    if (external) schedule();
  });

  function run() {
    observer.disconnect();
    try {
      apply();
    } finally {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Haggle changes pages without reloading; notice when the address changes.
  let lastHref = location.href;
  let cameBack = false;
  window.addEventListener("popstate", () => (cameBack = true));
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    stopRestoring();
    refreshResults();
    schedule();
    if (cameBack) restoreScroll();
    cameBack = false;
  }, 300);

  document.addEventListener("hh:update", () => {
    refreshResults();
    if (enabled && view) subscribeVisible();
    else schedule();
  });

  // Countdowns.
  setInterval(refreshRows, 1000);

  const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  if (nav && nav.type === "back_forward") restoreScroll();
  refreshResults();
  run();
})();
