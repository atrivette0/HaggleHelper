// Runs on Haggle pages, in the page's own context (it reads React props and
// what src/page-hook.js collected):
// - adds a "Check MSRP" Google Shopping link to every listing card;
// - when the same product (same title and condition) is listed more than once
//   in the current results, the first card gets a panel with every listing's
//   location and current bid, and the repeat cards are hidden (toggleable);
// - remembers how far down the results you scrolled and returns there when
//   you come back from an item.
(function () {
  "use strict";

  const core = globalThis.HaggleHelperCore;
  const adapter = globalThis.HaggleHelperAdapter;
  const hook = window.__HaggleHelper || { bids: new Map(), subscribed: new Set(), subscribe() {} };
  const MARK = "data-hh";
  const MAX_RESULTS = 500; // Haggle's API returns at most 500 per request.
  const MAX_EXTRA_SUBSCRIPTIONS = 200;
  const LOTS_QUERY =
    "query HaggleHelperLots($from: Int!, $size: Int!, $sort: [SortInput]!, $query: [QueryInput!]) {" +
    " getLots(from: $from, size: $size, sort: $sort, query: $query) {" +
    " lot_number event_id title description condition location retail_value end_event_date" +
    " bid_detail { current_bid bid_history { bidder } } } }";

  // ---- Settings ----------------------------------------------------------

  function storageGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Private windows can refuse storage; the setting just won't stick.
    }
  }
  let hideRepeats = storageGet("hh-hide-repeats", true);
  const openPanels = new Set(); // group keys whose bid list is expanded

  // ---- All results for the current search --------------------------------
  // The grid only renders the rows on screen, so repeats further down aren't
  // in the page yet. Ask Haggle's API for the whole result set, using the same
  // filters the page used.

  let results = { queryJson: null, lots: [] };

  function currentQuery() {
    const here = location.pathname + location.search;
    const pageVars = hook.lastLotsPath === here ? hook.lastLotsVariables : null;
    return core.lotsQuery(new URLSearchParams(location.search).get("search"), pageVars);
  }

  async function refreshResults() {
    if (location.pathname !== "/browse" || !hook.api) return;
    const query = currentQuery();
    const queryJson = JSON.stringify(query);
    if (queryJson === results.queryJson) return;
    results = { queryJson, lots: [] };
    try {
      const res = await fetch(hook.api.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": hook.api.key },
        body: JSON.stringify({
          operationName: "HaggleHelperLots",
          query: LOTS_QUERY,
          variables: { ...query, from: 0, size: MAX_RESULTS },
        }),
      });
      const json = await res.json();
      const lots = (json && json.data && json.data.getLots) || [];
      if (results.queryJson === queryJson) {
        results.lots = lots;
        schedule();
      }
    } catch (e) {
      // Fall back to grouping only the cards on screen.
    }
  }

  // ---- Bids ---------------------------------------------------------------

  function bidInfo(lot) {
    const key = core.lotKey(lot.event_id, lot.lot_number);
    const msg = hook.bids.get(key);
    const live = msg ? core.bidFromMessage(msg) : null;
    if (live) return { ...live, known: true };
    const detail = lot.bid_detail || {};
    const ended = lot.end_event_date && Date.parse(lot.end_event_date) < Date.now();
    return {
      bid: detail.current_bid > 0 ? detail.current_bid : null,
      bidCount: detail.bid_history ? detail.bid_history.length : null,
      sold: !!ended,
      known: detail.current_bid > 0 || !!ended,
    };
  }

  function bidText(info) {
    if (info.bid != null) return (info.sold ? "Sold at " : "Bid ") + core.money(info.bid);
    if (info.sold) return "Ended";
    return info.known ? "No bids yet" : "Bid loading…";
  }

  // ---- Building our additions ---------------------------------------------

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

  // Haggle opens a listing when its card is clicked; keep clicks on our links
  // and panel from also doing that.
  function isolateClick(node) {
    node.addEventListener("click", (e) => e.stopPropagation());
    return node;
  }

  function msrpLink(lot) {
    return isolateClick(
      el("a", {
        class: "hh-msrp",
        href: core.googleShoppingUrl(core.shoppingQuery(lot)),
        target: "_blank",
        rel: "noopener noreferrer",
        title: "Search Google Shopping for this product's retail price",
        text: "Check MSRP on Google Shopping",
      })
    );
  }

  function groupPanel(group, current) {
    const rows = core.sortByBid(group.listings.map((lot) => ({ lot, ...bidInfo(lot) })));
    const live = rows.filter((r) => r.bid != null && !r.sold).map((r) => r.bid);
    const summary =
      "Listed " + group.listings.length + " times · " +
      (live.length > 1
        ? "bids " + core.money(Math.min(...live)) + " to " + core.money(Math.max(...live))
        : live.length
          ? "bid " + core.money(live[0])
          : "no bids yet");
    const currentKey = core.lotKey(current.event_id, current.lot_number);
    const items = rows.map((r) => {
      const isCurrent = core.lotKey(r.lot.event_id, r.lot.lot_number) === currentKey;
      return el("li", isCurrent ? { class: "hh-current" } : {}, [
        el("a", { href: core.itemPath(r.lot), text: r.lot.location || "Listing" }),
        el("span", { class: "hh-bid", text: bidText(r) }),
        el("span", { class: "hh-note", text: isCurrent ? "this card" : "" }),
      ]);
    });
    const details = el("details", { class: "hh-group" }, [el("summary", { text: summary }), el("ul", {}, items)]);
    if (openPanels.has(group.key)) details.open = true;
    details.addEventListener("toggle", () => {
      if (details.open) openPanels.add(group.key);
      else openPanels.delete(group.key);
    });
    return isolateClick(details);
  }

  // ---- Applying to the page -----------------------------------------------

  const applied = new WeakMap(); // card -> signature of what we last added

  function apply() {
    const cards = adapter.findCards(document).map((card) => ({ card, lot: adapter.readLot(card) })).filter((c) => c.lot);

    // Group the full result set plus anything on screen that isn't in it.
    const seen = new Set();
    const universe = [];
    for (const lot of [...results.lots, ...cards.map((c) => c.lot)]) {
      const key = core.lotKey(lot.event_id, lot.lot_number);
      if (seen.has(key)) continue;
      seen.add(key);
      universe.push(lot);
    }
    const groupOf = new Map();
    for (const group of core.groupListings(universe)) {
      for (const lot of group.listings) groupOf.set(core.lotKey(lot.event_id, lot.lot_number), group);
    }

    let repeats = 0;
    for (const { card, lot } of cards) {
      const key = core.lotKey(lot.event_id, lot.lot_number);
      const group = groupOf.get(key);
      const multi = group && group.listings.length > 1;
      const first = multi && core.lotKey(group.listings[0].event_id, group.listings[0].lot_number) === key;
      const cell = adapter.gridCell(card);
      const hide = multi && !first && hideRepeats && !!cell;
      if (multi) {
        repeats++;
        for (const other of group.listings) {
          if (hook.subscribed.size >= MAX_EXTRA_SUBSCRIPTIONS) break;
          if (!hook.bids.has(core.lotKey(other.event_id, other.lot_number))) hook.subscribe(other.event_id, other.lot_number);
        }
      }

      if (cell) {
        if (hide) cell.setAttribute("data-hh-repeat", "");
        else cell.removeAttribute("data-hh-repeat");
      }

      const signature = [
        key,
        multi ? group.listings.map((l) => core.lotKey(l.event_id, l.lot_number) + "=" + bidText(bidInfo(l))).join(",") : "",
        openPanels.has(group && group.key),
      ].join("|");
      const hasOurs = card.querySelector(".hh-extras");
      if (applied.get(card) === signature && hasOurs) continue;
      applied.set(card, signature);

      if (hasOurs) hasOurs.remove();
      const extras = el("div", { class: "hh-extras" }, [msrpLink(lot)]);
      if (multi && (first || !hideRepeats || !cell)) extras.appendChild(groupPanel(group, lot));
      card.appendChild(extras);
    }
    updateToggle(repeats > 0);
  }

  // A small switch for showing the hidden repeat cards.
  let toggle = null;
  function updateToggle(show) {
    if (!show) {
      if (toggle) toggle.remove();
      toggle = null;
      return;
    }
    if (!toggle) {
      toggle = el("button", { class: "hh-toggle", type: "button" });
      toggle.addEventListener("click", () => {
        hideRepeats = !hideRepeats;
        storageSet("hh-hide-repeats", hideRepeats);
        schedule();
      });
    }
    toggle.textContent = hideRepeats ? "Repeat listings grouped · Show all" : "Showing every listing · Group repeats";
    if (!toggle.isConnected) document.body.appendChild(toggle);
  }

  // ---- Keeping scroll position --------------------------------------------
  // The results scroll inside their own box and only render rows near the
  // screen, so the browser can't restore the position by itself. Save it as
  // you scroll; when you come back to the same results, scroll back down
  // (more results load along the way, so keep nudging until it sticks).

  const SCROLL_PREFIX = "hh-scroll:";
  let restoring = null;

  function pageKey() {
    return SCROLL_PREFIX + location.pathname + location.search;
  }

  let saveTimer = null;
  document.addEventListener(
    "scroll",
    (e) => {
      const scroller = adapter.findScroller(document);
      if (!scroller || e.target !== scroller || restoring) return;
      clearTimeout(saveTimer);
      const key = pageKey();
      saveTimer = setTimeout(() => {
        try {
          sessionStorage.setItem(key, String(scroller.scrollTop));
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
        const scroller = adapter.findScroller(document);
        if (Date.now() - startedAt > 15000) return stopRestoring();
        if (!scroller) return;
        scroller.scrollTop = target;
        settled = Math.abs(scroller.scrollTop - target) < 4 ? settled + 1 : 0;
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

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  }

  const observer = new MutationObserver((mutations) => {
    const external = mutations.some((m) =>
      [...m.addedNodes, ...m.removedNodes].some((n) => !(n.nodeType === 1 && n.hasAttribute(MARK)))
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
    schedule();
  });

  const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  if (nav && nav.type === "back_forward") restoreScroll();
  refreshResults();
  run();
})();
