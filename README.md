# HaggleHelper

A Chrome and Firefox extension that makes Haggle search results easier to shop, on haggle.com and a-stock.bid.

- **Every result at once.** Search results load in full up front (up to 5,000), instead of a few rows at a time as you scroll.
- **Repeat listings grouped.** Listings of the same product (same title and condition) share one card. A folded line shows how many listings there are and the lowest bid; open it to see each listing's location, current bid and time left, lowest bid first, each linking to that listing.
- **Check MSRP.** Every card gets a link that searches Google Shopping for the product, so you can check Haggle's retail price.
- **Keeps your place.** Going back from an item returns you to where you were in the results instead of the top.
- **On/off switch.** Click HaggleHelper in the browser's extensions menu (the puzzle-piece icon; pin it to keep it in the toolbar) to switch back to Haggle's own pages. Open Haggle tabs switch right away, and the choice is remembered.

## Install for development

**Chrome (111 or later):** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder.

**Firefox (128 or later):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `manifest.json`.

Then search on haggle.com or a-stock.bid.

## How it works

Haggle is a Next.js app whose results grid only renders the rows on screen, and whose cards show the next bid but not the current one. So the extension runs in the page's own context:

- `src/page-hook.js` loads before Haggle's scripts. It listens to Haggle's live-bid websocket to learn each listing's current bid, notes the API key and filters behind the results the page requested, and subscribes to bids for grouped listings that aren't on screen.
- `src/content.js` asks Haggle's API for the whole result set with the same filters, 500 at a time, groups it, and shows it in its own list in place of Haggle's grid (which it hides rather than changes, since that grid re-renders as you scroll). On other pages it only adds the MSRP link to Haggle's cards. It also saves and restores the results' scroll position.
- `src/adapter.js` holds everything tied to Haggle's markup: the card class, reading each card's listing from its React props, and the results' scroll box.
- `src/popup.html` is the toolbar switch. `src/bridge.js` passes its setting to the page scripts, which can't read extension settings themselves.
- `src/core.js` is the site-independent logic (grouping, reading bid messages, building links) and is covered by the tests.

## Tests

```
npm test
```
