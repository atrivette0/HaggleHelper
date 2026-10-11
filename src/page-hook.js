// Runs in Haggle's own page context before its scripts start, so HaggleHelper
// can see what the page already receives:
// - live bids from Haggle's bid websocket (current bid isn't shown on cards);
// - the address and key of Haggle's data API.
// It sends a "subscribe" for listings that are grouped with something on
// screen, so their bids show too. On the results page it also starts loading
// the results right away, with the API key remembered from an earlier visit,
// instead of waiting for the page to finish loading and use the key itself.
(function () {
  "use strict";
  if (window.__HaggleHelper) return;

  const API_STORE = "hh-api";
  function rememberedApi() {
    try {
      const api = JSON.parse(localStorage.getItem(API_STORE));
      return api && api.url && api.key ? { url: api.url, key: api.key, remembered: true } : null;
    } catch (e) {
      return null;
    }
  }

  const hh = (window.__HaggleHelper = {
    bids: new Map(), // "event:lot" -> latest bid message, as raw parsed JSON
    api: rememberedApi(), // { url, key } of Haggle's GraphQL API
    // The first pages of results, requested as the page starts:
    // { queryJson, pages: Map(from -> Promise of the parsed response) }.
    prefetch: null,
    // A remembered key Haggle no longer accepts: wait for the page's own.
    forgetApi() {
      try {
        localStorage.removeItem(API_STORE);
      } catch (e) {
        // Nothing to forget.
      }
      hh.api = null;
    },
    socket: null,
    subscribed: new Set(),
    subscribe(eventId, lotNumber) {
      const key = eventId + ":" + lotNumber;
      const ws = hh.socket;
      if (hh.subscribed.has(key) || !ws || ws.readyState !== 1) return;
      hh.subscribed.add(key);
      ws.send(JSON.stringify({ type: "subscribe", lot_id: String(lotNumber), event_id: String(eventId) }));
    },
  });

  let notifyTimer = null;
  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      document.dispatchEvent(new CustomEvent("hh:update"));
    }, 250);
  }

  const NativeWebSocket = window.WebSocket;
  function HookedWebSocket(url, protocols) {
    const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    if (/wssbid\./.test(String(url))) {
      ws.addEventListener("open", () => {
        hh.socket = ws;
        hh.subscribed.clear();
        notify();
      });
      ws.addEventListener("message", (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        const d = msg && msg.data;
        if (!d || d.lot_id == null || d.event_id == null) return;
        if (msg.type === "time_remaining") return;
        const key = d.event_id + ":" + d.lot_id;
        const prev = hh.bids.get(key);
        // A sold notice carries no amount, so keep the last known bid with it.
        hh.bids.set(key, msg.type === "lot_sold" && prev ? { ...prev, type: "lot_sold" } : msg);
        notify();
      });
    }
    return ws;
  }
  HookedWebSocket.prototype = NativeWebSocket.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) HookedWebSocket[k] = NativeWebSocket[k];
  window.WebSocket = HookedWebSocket;

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && /\/graphql\b/.test(url) && /appsync-api/.test(url) && init) {
        const headers = new Headers(init.headers || {});
        const key = headers.get("x-api-key");
        if (key && (!hh.api || hh.api.remembered)) {
          const changed = !hh.api || hh.api.url !== url || hh.api.key !== key;
          hh.api = { url, key };
          try {
            localStorage.setItem(API_STORE, JSON.stringify(hh.api));
          } catch (e) {
            // Private window or storage blocked: just don't remember it.
          }
          if (changed) notify();
        }
      }
    } catch (e) {
      // Never get in the way of the page's own requests.
    }
    return nativeFetch.apply(this, arguments);
  };

  // The results load as several requests at once; start the first few now.
  const PARALLEL = 4;
  hh.parallel = PARALLEL;
  const core = window.HaggleHelperCore;
  const off = document.documentElement.getAttribute("data-hh-enabled") === "false";
  if (core && hh.api && !off && location.pathname === "/browse") {
    const query = core.lotsQuery(location.search);
    const pages = new Map();
    for (let i = 0; i < PARALLEL; i++) {
      const from = i * core.PAGE_SIZE;
      const request = nativeFetch.call(window, hh.api.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": hh.api.key },
        body: core.lotsRequestBody(query, from),
      }).then((res) => res.json());
      request.catch(() => {}); // a failure is handled when the result is used
      pages.set(from, request);
    }
    hh.prefetch = { queryJson: JSON.stringify(query), pages };
  }
})();
