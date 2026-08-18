import assert from "node:assert/strict";
import test from "node:test";

import { calculateFireTimeline } from "../app/domain/fireCalculations.js";
import { selectFireMetrics } from "../app/store/store.js";

function profile(overrides = {}) {
  return {
    currentCash: 0,
    currentInvestments: 0,
    debts: 0,
    desiredMonthlyFireSpending: 3333.3333333333,
    monthlyExpenses: 2000,
    withdrawalRate: 0.04,
    expectedReturn: 0.05,
    expectedInflation: 0,
    monthlyInvestment: 0,
    monthlyIncome: 3000,
    emergencyFund: 0,
    ...overrides
  };
}

test("does not compound uninvested cash toward the FIRE target", () => {
  const metrics = selectFireMetrics(profile({ currentCash: 500000 }), [], []);

  assert.equal(metrics.netWorth, 500000);
  assert.equal(metrics.fireCapital, 0);
  assert.equal(metrics.fireProgress, 0);
  assert.equal(metrics.yearsToFire, null);
});

test("uses the larger tracked or saved investment total as FIRE capital", () => {
  const metrics = selectFireMetrics(
    profile({ currentCash: 500000, currentInvestments: 100000 }),
    [
      {
        quantity: 2,
        currentPrice: 75000,
        averageBuyPrice: 50000,
        exchangeRateToBase: 1
      }
    ],
    []
  );

  assert.equal(metrics.fireCapital, 150000);
  assert.equal(metrics.netWorth, 650000);
  assert.ok(metrics.fireProgress > 0.149 && metrics.fireProgress < 0.151);
});

test("uses net worth only for the net-worth milestone and invested capital for FI milestones", () => {
  const timeline = calculateFireTimeline({
    currentDate: new Date("2026-08-18T12:00:00"),
    netWorth: 500000,
    fireCapital: 0,
    emergencyFund: 0,
    monthlyExpenses: 0,
    monthlySavings: 0,
    monthlyInvestment: 0,
    fireNumber: 400000,
    annualReturn: 0.05
  });

  const nextNetWorth = timeline.find((milestone) => milestone.key === "netWorthMilestone");
  const halfFi = timeline.find((milestone) => milestone.key === "halfFi");
  const financialIndependence = timeline.find(
    (milestone) => milestone.key === "financialIndependence"
  );

  assert.notEqual(nextNetWorth.yearsUntil, null);
  assert.equal(halfFi.yearsUntil, null);
  assert.equal(financialIndependence.yearsUntil, null);
});
