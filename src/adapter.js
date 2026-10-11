// Haggle-specific page reading. Haggle is a React (Next.js) app: listing cards
// aren't links and don't carry the lot number in their markup, but each card's
// React props hold the full listing, so we read it from there.
(function (root) {
  "use strict";

  // Every listing card's root element has this class (search grid, event pages
  // and the home page's rows). The horizontal rows also wrap each card in an
  // outer ".item-card", so only the innermost one counts.
  const CARD = ".item-card";
  // The results grid scrolls inside this element, not the window.
  const SCROLLER = 'div[class*="max-h-[calc(100vh-140px)]"]';

  function findCards(doc) {
    return [...doc.querySelectorAll(CARD)].filter((el) => !el.querySelector(CARD));
  }

  // Walk up the React tree from the card's element to the component that was
  // given the listing (prop "initialLot", or "lot" inside the card).
  function readLot(card) {
    const fiberKey = Object.keys(card).find((k) => k.startsWith("__reactFiber$"));
    let fiber = fiberKey ? card[fiberKey] : null;
    for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const lot = props && (props.initialLot || props.lot);
      if (lot && lot.lot_number != null && lot.event_id != null) return lot;
    }
    return null;
  }

  // The grid cell holding a card (its direct wrapper inside a row grid), or
  // null when the card isn't in a grid, such as the home page's sliding rows.
  function gridCell(card) {
    for (let el = card, depth = 0; el && el.parentElement && depth < 3; el = el.parentElement, depth++) {
      if (el.parentElement.classList.contains("grid")) return el;
    }
    return null;
  }

  function findScroller(doc) {
    return doc.querySelector(SCROLLER);
  }

  const api = { CARD, SCROLLER, findCards, readLot, gridCell, findScroller };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HaggleHelperAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
