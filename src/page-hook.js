// Runs in Haggle's own page context before its scripts start, so HaggleHelper
// can see what the page already receives:
// - live bids from Haggle's bid websocket (current bid isn't shown on cards);
// - the API address and key, and the filters behind the results on screen.
// It only listens; the one thing it sends is a "subscribe" for listings that
// are grouped with something on screen, so their bids show too.
(function () {
  "use strict";
  if (window.__HaggleHelper) return;

  const hh = (window.__HaggleHelper = {
    bids: new Map(), // "event:lot" -> latest bid message, as raw parsed JSON
    api: null, // { url, key } of Haggle's GraphQL API
    lastLotsVariables: null, // variables of the page's latest GetLots request
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
        if (key) hh.api = { url, key };
        const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        if (body && body.operationName === "GetLots" && body.variables && !hasLotList(body.variables)) {
          hh.lastLotsVariables = body.variables;
          hh.lastLotsPath = location.pathname + location.search;
          notify();
        }
      }
    } catch (e) {
      // Never get in the way of the page's own requests.
    }
    return nativeFetch.apply(this, arguments);
  };

  // GetLots is also used to look up specific lots (watchlist, an event's
  // preview); only searches describe the results grid.
  function hasLotList(variables) {
    return (variables.query || []).some((q) => q.field === "lot_number");
  }
})();
