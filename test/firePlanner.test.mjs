import test from "node:test";
import assert from "node:assert/strict";

import { summarizeScenarios } from "../app/domain/firePlanner.js";

test("starter scenarios inherit the profile amounts in saved comparisons", () => {
  const [summary] = summarizeScenarios(
    [
      {
        name: "Conservative",
        monthlyInvestment: 0,
        monthlyExpenses: 0,
        withdrawalRate: 0.03,
        expectedReturn: 0.04,
        expectedInflation: 0.02
      }
    ],
    { fireCapital: 10_000, fireNumber: 800_000, yearsToFire: 45 },
    { monthlyInvestment: 500, monthlyExpenses: 1_800, desiredMonthlyFireSpending: 2_000 }
  );

  assert.equal(summary.monthlyInvestment, 500);
  assert.equal(summary.fireNumber, 800_000);
  assert.ok(summary.yearsToFire > 0);
});

test("saved scenario amounts take precedence over profile fallbacks", () => {
  const [summary] = summarizeScenarios(
    [
      {
        name: "Lower spend",
        monthlyInvestment: 750,
        monthlyExpenses: 1_500,
        withdrawalRate: 0.04,
        expectedReturn: 0.06,
        expectedInflation: 0.02
      }
    ],
    { fireCapital: 10_000, fireNumber: 800_000, yearsToFire: 45 },
    { monthlyInvestment: 500, desiredMonthlyFireSpending: 2_000 }
  );

  assert.equal(summary.monthlyInvestment, 750);
  assert.equal(summary.fireNumber, 450_000);
});
