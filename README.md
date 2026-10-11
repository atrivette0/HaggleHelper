# HaggleHelper

A Chrome and Firefox extension that makes Haggle (haggle.com) search results easier to shop.

- **Repeat listings grouped.** When the same product (same title and condition) is listed more than once in your results, the first card gets a "Listed N times" panel with every listing's location and current bid, lowest first, each linking to that listing. The repeat cards are hidden; the button at the bottom left shows them again.
- **Check MSRP.** Every card gets a link that searches Google Shopping for the product, so you can check Haggle's retail price.
- **Keeps your place.** Going back from an item returns you to where you were in the results instead of the top.

## Install for development

**Chrome (111 or later):** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder.

**Firefox (128 or later):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `manifest.json`.

Then search on haggle.com.

## How it works

Haggle is a Next.js app whose results grid only renders the rows on screen, and whose cards show the next bid but not the current one. So the extension runs in the page's own context:

- `src/page-hook.js` loads before Haggle's scripts. It listens to Haggle's live-bid websocket to learn each listing's current bid, notes the API key and filters behind the results the page requested, and subscribes to bids for grouped listings that aren't on screen.
- `src/content.js` asks Haggle's API for the whole result set (up to 500 listings) with the same filters, groups it, and decorates the cards on screen. It also saves and restores the results' scroll position.
- `src/adapter.js` holds everything tied to Haggle's markup: the card class, reading each card's listing from its React props, and the results' scroll box.
- `src/core.js` is the site-independent logic (grouping, reading bid messages, building links) and is covered by the tests.

## Tests

```
npm test
```
