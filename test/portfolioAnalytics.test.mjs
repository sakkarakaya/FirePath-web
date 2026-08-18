import assert from "node:assert/strict";
import test from "node:test";

import {
  POSITION_MAP_RANGES,
  buildAllocation,
  buildDayMovers,
  buildPortfolioStatistics,
  buildPositionMap,
  planContribution
} from "../app/domain/portfolioAnalytics.js";
import { calculatePortfolioHealth } from "../app/domain/portfolioCalculations.js";

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
}

test("builds one allocation slice per holding", () => {
  const slices = buildAllocation(
    [
      {
        id: 1,
        name: "Example stock",
        quantity: 1,
        currentPrice: 75,
        averageBuyPrice: 60,
        exchangeRateToBase: 1
      },
      {
        id: 2,
        name: "Example stock",
        quantity: 1,
        currentPrice: 25,
        averageBuyPrice: 20,
        exchangeRateToBase: 1
      }
    ],
    "holding"
  );

  assert.equal(slices.length, 2);
  assert.deepEqual(
    slices.map((slice) => slice.label),
    ["Example stock", "Example stock"]
  );
  assertClose(slices[0].percentage, 0.75);
  assertClose(slices[1].percentage, 0.25);
});

test("excludes closed positions from allocation and current-position statistics", () => {
  const holdings = [
    {
      id: 1,
      name: "Open fund",
      assetType: "ETF",
      currency: "EUR",
      quantity: 1,
      currentPrice: 100,
      averageBuyPrice: 80,
      exchangeRateToBase: 1
    },
    {
      id: 2,
      name: "Closed stock",
      assetType: "Stock",
      currency: "USD",
      quantity: 0,
      currentPrice: 200,
      averageBuyPrice: 150,
      exchangeRateToBase: 0.9
    }
  ];

  assert.deepEqual(buildAllocation(holdings, "holding").map((row) => row.label), ["Open fund"]);
  assert.equal(buildPortfolioStatistics(holdings).positionCount, 1);
  assert.equal(calculatePortfolioHealth(holdings, "EUR")[0].headline, "Open fund");
});

test("does not reuse a previous close for a manually priced holding", () => {
  const holding = {
    id: 1,
    name: "Manual fund",
    quantity: 1,
    currentPrice: 110,
    previousClose: 100,
    averageBuyPrice: 90,
    exchangeRateToBase: 1,
    marketSourceProvider: "manual"
  };

  assert.deepEqual(buildDayMovers([holding]), []);
  assert.equal(
    buildPositionMap([holding], {
      rangeKey: "1D",
      now: new Date("2026-08-18T12:00:00")
    })[0].gainLossPercentage,
    null
  );
});

test("allocates the full contribution including sub-unit target needs", () => {
  const plan = planContribution(
    {
      totalValue: 99,
      hasTargets: true,
      rows: [
        { label: "Fund", targetPercentage: 0.996, actualPercentage: 1, actualValue: 99 },
        { label: "Cash", targetPercentage: 0.004, actualPercentage: 0, actualValue: 0 }
      ]
    },
    1
  );

  assert.equal(plan.length, 2);
  assertClose(plan.reduce((total, row) => total + row.amount, 0), 1);
});

test("uses the holding name instead of its ISIN in the allocation position map", () => {
  const positions = buildPositionMap([
    {
      name: "ASML Holding N.V.",
      ticker: "NL0010273215",
      quantity: 1,
      currentPrice: 100,
      averageBuyPrice: 80,
      exchangeRateToBase: 1
    }
  ]);

  assert.equal(positions[0].label, "ASML Holding N.V.");
  assert.equal(positions[0].title, "ASML Holding N.V.");
});

test("offers daily through all-time position map periods", () => {
  assert.deepEqual(
    POSITION_MAP_RANGES.map((range) => range.key),
    ["1D", "1W", "1M", "YTD", "1Y", "ALL"]
  );
});

test("uses previous close for the daily position return", () => {
  const [position] = buildPositionMap(
    [
      {
        id: 1,
        name: "Daily mover",
        quantity: 2,
        currentPrice: 110,
        previousClose: 100,
        averageBuyPrice: 70,
        exchangeRateToBase: 1
      }
    ],
    { rangeKey: "1D", now: new Date("2026-08-18T12:00:00") }
  );

  assertClose(position.gainLossPercentage, 0.1);
  assert.equal(position.gainLoss, 20);
  assert.equal(position.returnSource, "previous-close");
});

test("calculates weekly, monthly, YTD and yearly returns from cached closes", () => {
  const holding = {
    id: 1,
    name: "History-backed",
    quantity: 1,
    currentPrice: 120,
    averageBuyPrice: 60,
    exchangeRateToBase: 1
  };
  const priceSeries = {
    1: {
      bars: [
        { date: "2025-08-18", close: 80 },
        { date: "2025-12-31", close: 90 },
        { date: "2026-07-18", close: 100 },
        { date: "2026-08-11", close: 110 }
      ]
    }
  };
  const options = {
    priceSeries,
    keyForHolding: ({ id }) => id,
    now: new Date("2026-08-18T12:00:00")
  };

  assertClose(buildPositionMap([holding], { ...options, rangeKey: "1W" })[0].gainLossPercentage, 120 / 110 - 1);
  assertClose(buildPositionMap([holding], { ...options, rangeKey: "1M" })[0].gainLossPercentage, 0.2);
  assertClose(buildPositionMap([holding], { ...options, rangeKey: "YTD" })[0].gainLossPercentage, 120 / 90 - 1);
  assertClose(buildPositionMap([holding], { ...options, rangeKey: "1Y" })[0].gainLossPercentage, 0.5);
});

test("starts all-time return at the first investment", () => {
  const [position] = buildPositionMap(
    [
      {
        id: 7,
        name: "Long-held fund",
        quantity: 3,
        currentPrice: 150,
        averageBuyPrice: 120,
        exchangeRateToBase: 1
      }
    ],
    {
      rangeKey: "ALL",
      transactions: [
        { id: 2, holdingId: 7, type: "buy", date: "2024-05-01", quantity: 1, price: 100 },
        { id: 3, holdingId: 7, type: "buy", date: "2025-01-01", quantity: 2, price: 130 }
      ]
    }
  );

  assertClose(position.gainLossPercentage, 0.5);
  assert.equal(position.returnFrom, "2024-05-01");
  assert.equal(position.returnSource, "first-buy");
});

test("starts a period at the first buy when the position was opened inside it", () => {
  const [position] = buildPositionMap(
    [
      {
        id: 4,
        name: "New position",
        quantity: 1,
        currentPrice: 105,
        averageBuyPrice: 100,
        exchangeRateToBase: 1
      }
    ],
    {
      rangeKey: "1M",
      transactions: [
        { id: 1, holdingId: 4, type: "buy", date: "2026-08-10", quantity: 1, price: 100 }
      ],
      now: new Date("2026-08-18T12:00:00")
    }
  );

  assertClose(position.gainLossPercentage, 0.05);
  assert.equal(position.returnFrom, "2026-08-10");
});

test("marks a historical period unavailable when no valid baseline exists", () => {
  const [position] = buildPositionMap(
    [
      {
        id: 9,
        name: "Manual position",
        quantity: 1,
        currentPrice: 100,
        averageBuyPrice: 80,
        exchangeRateToBase: 1
      }
    ],
    { rangeKey: "1W", now: new Date("2026-08-18T12:00:00") }
  );

  assert.equal(position.gainLossPercentage, null);
  assert.equal(position.returnSource, null);
});
