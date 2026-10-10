const test = require("node:test");
const assert = require("node:assert");
const core = require("../src/core.js");

test("titles that differ only in case and punctuation match", () => {
  assert.strictEqual(
    core.normalizeTitle("Apple AirPods Pro (2nd Gen) - White"),
    core.normalizeTitle("apple airpods pro 2nd gen white")
  );
});

test("parsePrice reads dollar amounts", () => {
  assert.strictEqual(core.parsePrice("Current bid: $1,234.50"), 1234.5);
  assert.strictEqual(core.parsePrice("$12"), 12);
  assert.strictEqual(core.parsePrice("No bids"), null);
});

test("same title and condition group together, sorted by bid", () => {
  const groups = core.groupListings([
    { title: "Dyson V8 Vacuum", condition: "New", bid: 120 },
    { title: "Dyson V8 vacuum", condition: "new", bid: 95 },
    { title: "Dyson V8 Vacuum", condition: "Used", bid: 60 },
    { title: "Dyson V8 Vacuum", condition: "New", bid: null },
  ]);
  assert.strictEqual(groups.length, 2);
  assert.deepStrictEqual(groups[0].listings.map((l) => l.bid), [95, 120, null]);
  assert.deepStrictEqual(groups[1].listings.map((l) => l.bid), [60]);
});

test("different conditions stay separate", () => {
  const groups = core.groupListings([
    { title: "Lamp", condition: "New", bid: 5 },
    { title: "Lamp", condition: "Open Box", bid: 4 },
  ]);
  assert.strictEqual(groups.length, 2);
});

test("google shopping link searches the title", () => {
  assert.strictEqual(
    core.googleShoppingUrl("Dyson V8  Vacuum & Charger"),
    "https://www.google.com/search?tbm=shop&q=Dyson%20V8%20Vacuum%20%26%20Charger"
  );
});
