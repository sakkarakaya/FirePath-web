import assert from "node:assert/strict";
import test from "node:test";

import { MAX_QUOTES_PER_REQUEST, fetchMarketQuotes } from "../app/domain/marketData.js";

test("loads every holding immediately in parallel worker-sized batches", async () => {
  const holdings = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    name: `Holding ${index + 1}`,
    marketProvider: "twelve-data",
    marketSymbol: `SYM${index + 1}`,
    marketExchange: "NASDAQ",
    marketMicCode: "XNAS",
    priceUpdatedAt: new Date(index * 1_000).toISOString()
  }));
  const batchSizes = [];
  let active = 0;
  let maxActive = 0;

  const result = await fetchMarketQuotes(holdings, {
    fetchBatch: async (instruments) => {
      batchSizes.push(instruments.length);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        data: instruments.map((instrument, index) => ({
          symbol: instrument.symbol,
          currentPrice: 100 + index,
          sourceProvider: "yahoo-finance"
        }))
      };
    }
  });

  assert.equal(MAX_QUOTES_PER_REQUEST, 8);
  assert.deepEqual(batchSizes, [8, 8, 2]);
  assert.equal(maxActive, 3);
  assert.equal(result.requested, 18);
  assert.equal(result.remaining, 0);
  assert.equal(result.quotes.length, 18);
  assert.deepEqual(
    result.quotes.map((quote) => quote.holdingId),
    holdings.map((holding) => holding.id)
  );
  assert.ok(result.quotes.every((quote) => quote.sourceProvider === "yahoo-finance"));
});

test("keeps successful batches when another market request fails", async () => {
  const holdings = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    name: `Holding ${index + 1}`,
    marketProvider: "twelve-data",
    marketSymbol: `SYM${index + 1}`
  }));
  let calls = 0;

  const result = await fetchMarketQuotes(holdings, {
    fetchBatch: async (instruments) => {
      calls += 1;
      if (calls === 2) throw new Error("Temporary upstream failure");
      return { data: instruments.map((instrument) => ({ symbol: instrument.symbol, currentPrice: 10 })) };
    }
  });

  assert.equal(result.quotes.filter((quote) => quote.currentPrice === 10).length, 8);
  assert.equal(result.quotes.filter((quote) => quote.error === "Temporary upstream failure").length, 1);
});
