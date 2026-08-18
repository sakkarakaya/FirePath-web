import assert from "node:assert/strict";
import test from "node:test";

import {
  alignBenchmark,
  buildYearlyPerformance,
  calculateRiskMetrics,
  calculateTimeWeightedReturn,
  reconstructPortfolioSeries
} from "../app/domain/portfolioReconstruction.js";

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
}

test("does not turn a cash withdrawal into investment drawdown", () => {
  const points = [
    { label: "2024-01-01", value: 100 },
    { label: "2024-01-02", value: 200 },
    { label: "2024-01-03", value: 100 }
  ];
  const twr = calculateTimeWeightedReturn(points, [
    { date: "2024-01-02", amount: 100 },
    { date: "2024-01-03", amount: -100 }
  ]);
  const risk = calculateRiskMetrics(points, twr.dailyReturns, { drawdownPoints: twr.indexSeries });

  assert.equal(twr.total, 0);
  assert.equal(risk.maxDrawdown, 0);
});

test("reconstructs foreign prices with the exchange rate from each historical date", () => {
  const holding = {
    id: 1,
    name: "US asset",
    quantity: 1,
    averageBuyPrice: 100,
    currentPrice: 100,
    currency: "USD",
    exchangeRateToBase: 0.9,
    marketSymbol: "USX"
  };
  const series = reconstructPortfolioSeries({
    holdings: [holding],
    transactions: [
      { id: 1, holdingId: 1, type: "buy", date: "2024-01-01", quantity: 1, price: 100, fee: 0 }
    ],
    seriesByKey: {
      USX: {
        currency: "USD",
        bars: [
          { date: "2024-01-01", close: 100 },
          { date: "2024-01-02", close: 100 }
        ]
      },
      "USD/EUR": {
        currency: "EUR",
        bars: [
          { date: "2024-01-01", close: 0.8 },
          { date: "2024-01-02", close: 0.9 }
        ]
      }
    },
    keyForHolding: () => "USX",
    baseCurrency: "EUR",
    today: new Date("2024-01-02T12:00:00")
  });

  assert.deepEqual(series.points, [
    { label: "2024-01-01", value: 80 },
    { label: "2024-01-02", value: 90 }
  ]);
  assert.equal(series.invested[0].value, 80);
  assertClose(calculateTimeWeightedReturn(series.points, series.cashFlows).total, 0.125);
});

test("excludes a foreign series until its historical exchange rates are cached", () => {
  const holding = {
    id: 1,
    name: "US asset",
    quantity: 1,
    currentPrice: 100,
    currency: "USD",
    exchangeRateToBase: 0.9,
    marketSymbol: "USX"
  };
  const result = reconstructPortfolioSeries({
    holdings: [holding],
    transactions: [
      { id: 1, holdingId: 1, type: "buy", date: "2024-01-01", quantity: 1, price: 100, fee: 0 }
    ],
    seriesByKey: {
      USX: { currency: "USD", bars: [{ date: "2024-01-01", close: 100 }] }
    },
    keyForHolding: () => "USX",
    baseCurrency: "EUR",
    today: new Date("2024-01-02T12:00:00")
  });

  assert.equal(result.isEmpty, true);
  assert.deepEqual(result.excludedHoldings, ["US asset"]);
});

test("converts yearly ledger totals with the rate from each transaction date", () => {
  const [year] = buildYearlyPerformance({
    points: [
      { label: "2024-01-01", value: 100 },
      { label: "2024-12-31", value: 100 }
    ],
    indexSeries: [
      { label: "2024-01-01", value: 100 },
      { label: "2024-12-31", value: 100 }
    ],
    holdings: [{ id: 1, currency: "USD", exchangeRateToBase: 0.5 }],
    transactions: [
      { id: 1, holdingId: 1, type: "dividend", date: "2024-06-01", amount: 10, fee: 1 }
    ],
    seriesByKey: {
      "USD/EUR": { bars: [{ date: "2024-06-01", close: 0.9 }] }
    },
    baseCurrency: "EUR",
    today: new Date("2024-12-31T12:00:00")
  });

  assertClose(year.dividends, 8.1);
  assertClose(year.fees, 0.9);
});

test("starts benchmark comparison only when both series have observations", () => {
  const points = [
    { label: "2024-01-01", value: 100 },
    { label: "2024-01-02", value: 110 },
    { label: "2024-01-03", value: 120 }
  ];
  const comparison = alignBenchmark(points, [{ date: "2024-01-03", close: 50 }]);

  assert.deepEqual(comparison.portfolio, [{ label: "2024-01-03", value: 100 }]);
  assert.deepEqual(comparison.benchmark, [{ label: "2024-01-03", value: 100 }]);
  assert.equal(comparison.benchmarkReturn, 0);
});
