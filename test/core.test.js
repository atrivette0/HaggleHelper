const test = require("node:test");
const assert = require("node:assert");
const core = require("../src/core.js");

test("titles that differ only in case and punctuation match", () => {
  assert.strictEqual(
    core.normalizeTitle("Apple AirPods Pro (2nd Gen) - White"),
    core.normalizeTitle("apple airpods pro 2nd gen white")
  );
});

test("listings with the same title group together whatever their condition, in page order", () => {
  const groups = core.groupListings([
    { title: "Dyson V8 Vacuum", condition: "Brand New", lot_number: "1" },
    { title: "Dyson V8 vacuum", condition: "Brand New ", lot_number: "2" },
    { title: "Lamp", condition: "As Is", lot_number: "3" },
    { title: "Dyson V8 Vacuum!", condition: "As Is", lot_number: "4" },
  ]);
  assert.strictEqual(groups.length, 2);
  assert.deepStrictEqual(groups[0].listings.map((l) => l.lot_number), ["1", "2", "4"]);
  assert.deepStrictEqual(groups[1].listings.map((l) => l.lot_number), ["3"]);
});

test("sortByBid puts lowest bid first, then no bids, then sold", () => {
  const rows = core.sortByBid([
    { id: "sold", bid: 5, sold: true },
    { id: "none", bid: null },
    { id: "high", bid: 30 },
    { id: "low", bid: 12 },
  ]);
  assert.deepStrictEqual(rows.map((r) => r.id), ["low", "high", "none", "sold"]);
});

test("bidFromMessage reads Haggle's live bid messages", () => {
  const now = Date.parse("2026-10-10T05:00:00Z");
  const update = core.bidFromMessage(
    JSON.stringify({
      type: "bid_update",
      data: { lot_id: "200", event_id: 5016, bid_amount: "14", next_bid_amount: "15", status: "1", time_remaining: 60, bidding_history: [{}, {}] },
    }),
    now
  );
  assert.deepStrictEqual(update, {
    key: "5016:200",
    bid: 14,
    nextBid: 15,
    bidCount: 2,
    sold: false,
    endsAt: "2026-10-10T05:01:00.000Z",
  });

  const noBids = core.bidFromMessage({ type: "lot_state", data: { lot_id: "1", event_id: "2", bid_amount: "0", time_remaining: 30 } });
  assert.strictEqual(noBids.bid, null);
  assert.strictEqual(noBids.sold, false);

  assert.deepStrictEqual(core.bidFromMessage({ type: "lot_sold", data: { lot_id: "1", event_id: "2" } }), { key: "2:1", sold: true });
  assert.strictEqual(core.bidFromMessage({ type: "time_remaining", data: { lot_id: "1", event_id: "2" } }), null);
  assert.strictEqual(core.bidFromMessage({ type: "pong" }), null);
  assert.strictEqual(core.bidFromMessage("not json"), null);
});

test("lotsQuery builds Haggle's filters from the address", () => {
  const endingSoonest = [{ field: "end_event_date", order: "asc" }];
  assert.deepStrictEqual(core.lotsQuery(""), { sort: endingSoonest });
  assert.deepStrictEqual(core.lotsQuery("?search=vacuum"), {
    sort: endingSoonest,
    query: [{ field: "title", value: "vacuum" }],
  });
  assert.deepStrictEqual(core.lotsQuery("?search=lamp&sort=retail-price-desc&categories=18,21&locations=111&conditions=1,4"), {
    sort: [{ field: "retail_value", order: "desc" }],
    query: [
      { field: "title", value: "lamp" },
      { field: "condition_id", values: ["1", "4"] },
      { field: "location_id", values: ["111"] },
      { field: "category_id", values: ["18", "21"] },
    ],
  });
  assert.deepStrictEqual(core.lotsQuery("?sort=default&categories=18,18"), {
    sort: endingSoonest,
    query: [{ field: "category_id", values: ["18"] }],
  });
});

test("shoppingQuery uses the full name when the description starts with the title", () => {
  assert.strictEqual(
    core.shoppingQuery({ title: "KMM Handheld Car Vacuum Cleaner Hand Held Vacuum C", description: "KMM Handheld Car Vacuum Cleaner Hand Held Vacuum Cordless" }),
    "KMM Handheld Car Vacuum Cleaner Hand Held Vacuum Cordless"
  );
  assert.strictEqual(
    core.shoppingQuery({ title: "3 In 1 Vacuum Cleaner Portable", description: "In a busy life having a cost-effective vacuum cleaner is a good helper" }),
    "3 In 1 Vacuum Cleaner Portable"
  );
  const long = core.shoppingQuery({ title: "word word", description: "word ".repeat(40) });
  assert.ok(long.length <= 100 && !long.endsWith(" "));
  assert.strictEqual(core.shoppingQuery({ title: "Lamp", description: "" }), "Lamp");
});

test("google shopping link searches the text", () => {
  assert.strictEqual(
    core.googleShoppingUrl("Dyson V8  Vacuum & Charger"),
    "https://www.google.com/search?tbm=shop&q=Dyson%20V8%20Vacuum%20%26%20Charger"
  );
});

test("itemPath builds Haggle's listing address", () => {
  assert.strictEqual(core.itemPath({ event_id: 5016, lot_number: "20000026125569678" }), "/event/5016/20000026125569678");
});

test("timeLeft counts down and is empty once ended", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  assert.strictEqual(core.timeLeft("2026-10-11T04:30:00Z", now), "1d 4h");
  assert.strictEqual(core.timeLeft("2026-10-10T02:05:00Z", now), "2h 5m");
  assert.strictEqual(core.timeLeft("2026-10-10T00:04:10Z", now), "4m 10s");
  assert.strictEqual(core.timeLeft("2026-10-09T23:00:00Z", now), "");
  assert.strictEqual(core.timeLeft(null, now), "");
});

test("loadAllLots fetches pages several at a time and hands them over in order", async () => {
  const total = 1234;
  const requested = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const got = [];
  await core.loadAllLots(
    async (from) => {
      requested.push(from);
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      // Later pages answer first, to check the order is kept.
      await new Promise((r) => setTimeout(r, 20 - from / 100));
      inFlight--;
      const size = Math.max(0, Math.min(core.PAGE_SIZE, total - from));
      return Array.from({ length: size }, (_, i) => from + i);
    },
    { max: 5000, parallel: 4, onPage: (page) => got.push(...page) }
  );
  assert.deepStrictEqual(got, Array.from({ length: total }, (_, i) => i));
  assert.strictEqual(mostInFlight, 4);
  // Stops asking once a short page shows where the results end.
  assert.ok(requested.length <= 4, "requested " + requested.join(","));
});

test("loadAllLots stops when onPage says so, and reports a failed page", async () => {
  const full = (from) => Array.from({ length: core.PAGE_SIZE }, (_, i) => from + i);
  let pages = 0;
  await core.loadAllLots(async (from) => full(from), {
    max: 5000,
    parallel: 2,
    onPage: () => (++pages < 2 ? undefined : false),
  });
  assert.strictEqual(pages, 2);
  await assert.rejects(
    core.loadAllLots(async (from) => { if (from > 0) throw new Error("down"); return full(from); }, {
      max: 5000,
      parallel: 2,
      onPage: () => {},
    })
  );
});
