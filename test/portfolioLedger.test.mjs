import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePortfolioNetInvested,
  calculateXirr,
  summarizeHoldingLedger
} from "../app/domain/portfolioLedger.js";

test("uses net ledger cash instead of open cost basis for history invested", () => {
  const holdings = [
    {
      id: 1,
      quantity: 1,
      averageBuyPrice: 101,
      exchangeRateToBase: 1
    }
  ];
  const transactions = [
    { id: 1, holdingId: 1, type: "buy", date: "2024-01-01", quantity: 2, price: 100, fee: 2 },
    { id: 2, holdingId: 1, type: "sell", date: "2024-02-01", quantity: 1, price: 120, fee: 1 }
  ];

  assert.equal(summarizeHoldingLedger(transactions).costBasis, 101);
  assert.equal(calculatePortfolioNetInvested(holdings, transactions), 83);
});

test("keeps manual positions on their entered open cost", () => {
  const holdings = [{ id: 1, quantity: 2, averageBuyPrice: 50, exchangeRateToBase: 0.9 }];
  assert.equal(calculatePortfolioNetInvested(holdings, []), 90);
});

test("calculates a basic one-year XIRR", () => {
  assert.equal(
    calculateXirr([
      { date: "2025-01-01", amount: -100 },
      { date: "2026-01-01", amount: 110 }
    ]),
    0.1
  );
});
