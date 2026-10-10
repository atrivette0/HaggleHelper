# HaggleHelper

A Chrome and Firefox extension that makes Haggle (haggle.com) search results easier to shop.

- **Identical listings grouped.** Listings with the same title and condition fold into one card with a panel listing every current bid, lowest first, each linking to its listing.
- **Check MSRP.** Every listing gets a link that searches Google Shopping for the product, so you can see the real retail price.

## Install for development

**Chrome:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `manifest.json`.

Then open a Haggle search page.

## How it works

- `src/core.js` decides which listings are the same product and builds the Google Shopping link.
- `src/adapter.js` reads listing cards from Haggle's page. Its `SELECTORS` are empty until matched to Haggle's markup; until then it guesses the results grid by finding repeated cards that show a price.
- `src/content.js` adds the links and grouping, and re-runs when more results load.

## Tests

```
npm test
```
