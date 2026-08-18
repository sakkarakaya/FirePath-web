import assert from "node:assert/strict";
import test from "node:test";

import { fetchCurrentPricesForImportedHoldings } from "../app/domain/marketData.js";

test("links an imported ISIN and writes a current price in the ledger currency", async () => {
  const holdings = [
    {
      importKey: "US24703L2025",
      name: "Dell Technologies C",
      ticker: "US24703L2025",
      quantity: 2,
      currentPrice: 361.5,
      currency: "EUR"
    }
  ];

  const result = await fetchCurrentPricesForImportedHoldings(holdings, {
    search: async (query) => {
      assert.equal(query, "US24703L2025");
      return [
        {
          symbol: "DELL",
          name: "Dell Technologies Inc.",
          exchange: "NYSE",
          micCode: "XNYS",
          currency: "USD",
          provider: "twelve-data"
        }
      ];
    },
    quote: async () => ({
      symbol: "DELL",
      currency: "USD",
      currentPrice: 100,
      previousClose: 98,
      priceUpdatedAt: "2026-08-18T12:00:00.000Z",
      provider: "twelve-data"
    }),
    exchangeRate: async (from, to) => {
      assert.equal(from, "USD");
      assert.equal(to, "EUR");
      return { rate: 0.9 };
    }
  });

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.holdings[0].currentPrice, 90);
  assert.equal(result.holdings[0].previousClose, 88.2);
  assert.equal(result.holdings[0].marketSymbol, "DELL");
  assert.equal(result.holdings[0].marketQuoteCurrency, "USD");
  assert.equal(result.holdings[0].currency, "EUR");
});

test("resolves every imported holding into the portfolio base currency", async () => {
  const result = await fetchCurrentPricesForImportedHoldings(
    [
      {
        importKey: "USX",
        name: "US asset",
        ticker: "USX",
        quantity: 10,
        currentPrice: 120,
        currency: "USD",
        exchangeRateToBase: 0
      }
    ],
    {
      baseCurrency: "EUR",
      search: async () => [],
      exchangeRate: async (from, to) => {
        assert.equal(from, "USD");
        assert.equal(to, "EUR");
        return { rate: 0.85 };
      }
    }
  );

  assert.equal(result.holdings[0].exchangeRateToBase, 0.85);
  assert.deepEqual(result.exchangeRateFailures, []);
});

test("does not spend quote requests on closed imported positions", async () => {
  let searches = 0;
  const result = await fetchCurrentPricesForImportedHoldings(
    [{ name: "Closed asset", ticker: "CLOSED", quantity: 0, currentPrice: 1, currency: "EUR" }],
    {
      search: async () => {
        searches += 1;
        return [];
      }
    }
  );

  assert.equal(searches, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 1);
});
