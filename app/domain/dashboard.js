import { getMonthRange } from "./dateRange.js";
import {
  calculateFireSpendingReductionImpact,
  calculateInflationAdjustedReturn,
  calculateMonthlyInvestmentImpact,
  calculateReturnAssumptionImpact,
  calculateSavingsRate,
  calculateYearsToFire,
  estimateFireYear,
  toNonNegativeNumber
} from "./fireCalculations.js";
import { formatCurrency, formatDurationYears, formatPercent } from "./formatters.js";
import {
  calculateMonthlyPassiveIncome,
  calculatePassiveIncomeCoverage,
  calculateTransactionTotals
} from "./moneyCalculations.js";

/**
 * Dashboard presentation logic. The dashboard view only arranges what this
 * module decides: which numbers matter, how healthy they are, and which single
 * what-if lever is worth showing first.
 */

// What-if deltas surfaced on the dashboard. Named constants so the copy and the
// calculation can never drift apart.
export const EXTRA_MONTHLY_CONTRIBUTION = 100;
export const SPENDING_REDUCTION_RATE = 0.1;
export const RETURN_DELTA = 0.02;

export { estimateFireYear };

export function buildGreeting(date = new Date()) {
  const hour = date.getHours();

  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

/** One-line orientation under the greeting: where the plan stands right now. */
export function buildStatusLine(metrics, date = new Date()) {
  if (metrics.fireNumber <= 0) {
    return "Set your FIRE target to start tracking progress.";
  }

  if (metrics.fireProgress >= 1) {
    return "Your saved plan already covers your FIRE number.";
  }

  const fireYear = estimateFireYear(metrics.yearsToFire, date);
  if (fireYear === null) {
    return "Add a monthly investment to project a FIRE date.";
  }

  return `${formatPercent(metrics.fireProgress)} of the way — on track for ${fireYear}.`;
}

/**
 * Inputs that are still missing or zero. Every gap listed here makes at least
 * one dashboard number meaningless, so the screen asks for it explicitly
 * instead of quietly rendering zeros.
 */
export function findPlanGaps(profile) {
  if (!profile) {
    return [];
  }

  const gaps = [];

  if (profile.monthlyIncome <= 0) {
    gaps.push({
      key: "income",
      title: "Add your monthly income",
      description: "Savings rate and monthly savings stay at zero without it.",
      route: "/settings/fire-assumptions"
    });
  }

  if (profile.monthlyExpenses <= 0) {
    gaps.push({
      key: "expenses",
      title: "Add your monthly expenses",
      description: "Expenses drive the FIRE number and emergency fund cover.",
      route: "/settings/fire-assumptions"
    });
  }

  const fireSpending = profile.desiredMonthlyFireSpending || profile.monthlyExpenses;
  if (fireSpending <= 0 || profile.withdrawalRate <= 0) {
    gaps.push({
      key: "fireTarget",
      title: "Set your FIRE target",
      description: "Desired FIRE spending and a withdrawal rate define the target.",
      route: "/settings/fire-assumptions"
    });
  }

  if (profile.monthlyInvestment <= 0) {
    gaps.push({
      key: "investing",
      title: "Add a monthly investment",
      description: "Without it the model cannot project a FIRE date.",
      route: "/settings/fire-assumptions"
    });
  }

  if (profile.emergencyFund <= 0) {
    gaps.push({
      key: "safetyNet",
      title: "Add your emergency fund",
      description: "Months of cover feed the plan health score.",
      route: "/settings/financial-status"
    });
  }

  return gaps;
}

export function describeEmergencyFund(months) {
  if (!Number.isFinite(months) || months <= 0) {
    return { label: "Not set", level: "neutral" };
  }
  if (months >= 6) {
    return { label: "Healthy", level: "good" };
  }
  if (months >= 3) {
    return { label: "Building", level: "watch" };
  }
  return { label: "Thin", level: "risk" };
}

export function describeSavingsRate(savingsRate) {
  if (!Number.isFinite(savingsRate) || savingsRate <= 0) {
    return { label: "No surplus", level: "risk" };
  }
  if (savingsRate >= 0.3) {
    return { label: "Strong", level: "good" };
  }
  if (savingsRate >= 0.15) {
    return { label: "Steady", level: "watch" };
  }
  return { label: "Low", level: "risk" };
}

export function describePlanScore(score, maxScore) {
  const ratio = maxScore <= 0 ? 0 : score / maxScore;

  if (ratio >= 0.75) {
    return { label: "Strong", level: "good" };
  }
  if (ratio >= 0.5) {
    return { label: "On track", level: "good" };
  }
  if (ratio >= 0.25) {
    return { label: "Building", level: "watch" };
  }
  return { label: "Getting started", level: "neutral" };
}

/** Where the user fixes the weakest plan-health component. */
export function routeForScoreComponent(key) {
  switch (key) {
    case "emergencyFund":
    case "debtLoad":
      return "/settings/financial-status";
    case "fireProgress":
      return "/fire";
    default:
      return "/settings/fire-assumptions";
  }
}

/**
 * This month at a glance. Logged transactions win; otherwise the saved plan
 * baseline is shown so the card is never empty, flagged via `isLogged`.
 */
export function buildMonthSnapshot({ profile, transactions, date = new Date() }) {
  const { periodLabel, startDate, endDate } = getMonthRange(date);
  const monthlyTransactions = transactions.filter(
    (transaction) => transaction.date >= startDate && transaction.date <= endDate
  );
  const isLogged = monthlyTransactions.length > 0;
  const totals = calculateTransactionTotals(monthlyTransactions);

  const income = isLogged ? totals.totalIncome : toNonNegativeNumber(profile?.monthlyIncome);
  const expenses = isLogged ? totals.totalExpenses : toNonNegativeNumber(profile?.monthlyExpenses);
  const passiveIncome = calculateMonthlyPassiveIncome(transactions, date);

  return {
    periodLabel,
    isLogged,
    income,
    expenses,
    savings: Math.max(0, income - expenses),
    savingsRate: calculateSavingsRate(income, expenses),
    passiveIncome,
    passiveCoverage: calculatePassiveIncomeCoverage(passiveIncome, expenses)
  };
}

/**
 * Picks the single highest-impact what-if instead of listing every lever.
 * Impact is measured in years saved so the two levers stay comparable.
 */
export function buildDashboardInsight({ profile, metrics, date = new Date() }) {
  if (!profile) {
    return null;
  }

  const currency = profile.currency;

  if (metrics.fireNumber <= 0) {
    return {
      key: "needsInputs",
      eyebrow: "Next step",
      headline: "Set your FIRE target",
      body: "Desired monthly FIRE spending and a withdrawal rate unlock the projections on this screen.",
      riskNote: null,
      actionLabel: "Add plan inputs",
      route: "/settings/fire-assumptions"
    };
  }

  const realReturn = calculateInflationAdjustedReturn(profile.expectedReturn, profile.expectedInflation);

  const investmentImpact = calculateMonthlyInvestmentImpact({
    currentAmount: metrics.netWorth,
    monthlyContribution: profile.monthlyInvestment,
    targetAmount: metrics.fireNumber,
    annualReturn: realReturn,
    extraMonthlyContribution: EXTRA_MONTHLY_CONTRIBUTION
  });

  const spendingImpact = calculateFireSpendingReductionImpact({
    monthlyFireSpending: profile.desiredMonthlyFireSpending || profile.monthlyExpenses,
    withdrawalRate: profile.withdrawalRate,
    reductionRate: SPENDING_REDUCTION_RATE
  });
  const spendingYears = calculateYearsToFire({
    currentAmount: metrics.netWorth,
    monthlyContribution: profile.monthlyInvestment,
    targetAmount: spendingImpact.adjustedFireNumber,
    annualReturn: realReturn
  });
  const spendingYearsSaved =
    metrics.yearsToFire === null || spendingYears === null
      ? null
      : Math.max(0, metrics.yearsToFire - spendingYears);

  const riskNote = buildRiskNote(profile, metrics);
  const investmentYearsSaved = investmentImpact.yearsSaved ?? 0;

  if (spendingYearsSaved !== null && spendingYearsSaved > investmentYearsSaved) {
    return {
      key: "lowerSpending",
      eyebrow: "Biggest lever",
      headline: `Spend ${formatPercent(spendingImpact.reductionRate)} less in FIRE`,
      body: `That trims the target by ${formatCurrency(
        spendingImpact.fireNumberReduction,
        currency
      )} to ${formatCurrency(spendingImpact.adjustedFireNumber, currency)}${describeYearsSaved(
        spendingYearsSaved
      )}`,
      riskNote,
      actionLabel: "Test in FIRE planner",
      route: "/fire"
    };
  }

  if (investmentImpact.yearsSaved === null) {
    // The saved plan never reaches the target, so frame the extra contribution
    // as what makes it reachable at all rather than as time saved.
    return {
      key: "extraInvestment",
      eyebrow: "Biggest lever",
      headline: `Invest ${formatCurrency(EXTRA_MONTHLY_CONTRIBUTION, currency)} more per month`,
      body:
        investmentImpact.adjustedYearsToFire === null
          ? "The current inputs never reach the target in this model. A higher monthly investment is the fastest way to change that."
          : `That alone would make the target reachable in about ${formatDurationYears(
              investmentImpact.adjustedYearsToFire
            )} in this model.`,
      riskNote,
      actionLabel: "Test in FIRE planner",
      route: "/fire"
    };
  }

  return {
    key: "extraInvestment",
    eyebrow: "Biggest lever",
    headline: `Invest ${formatCurrency(EXTRA_MONTHLY_CONTRIBUTION, currency)} more per month`,
    body: `On top of ${formatCurrency(profile.monthlyInvestment, currency)} already planned${describeYearsSaved(
      investmentImpact.yearsSaved
    )}`,
    riskNote,
    actionLabel: "Test in FIRE planner",
    route: "/fire"
  };
}

function describeYearsSaved(yearsSaved) {
  if (yearsSaved < 1 / 12) {
    return ", which keeps the timeline about the same in this model.";
  }
  return `, moving FIRE about ${formatDurationYears(yearsSaved)} earlier in this model.`;
}

/** Keeps the downside visible next to the upside so the insight stays balanced. */
function buildRiskNote(profile, metrics) {
  const returnImpact = calculateReturnAssumptionImpact({
    currentAmount: metrics.netWorth,
    monthlyContribution: profile.monthlyInvestment,
    targetAmount: metrics.fireNumber,
    annualReturn: profile.expectedReturn,
    annualInflation: profile.expectedInflation,
    returnDelta: RETURN_DELTA
  });

  if (returnImpact.yearsDelayed === null) {
    return returnImpact.adjustedYearsToFire === null
      ? `A ${formatPercent(
          returnImpact.returnDelta
        )} lower return would leave the target out of reach without another change.`
      : null;
  }

  if (returnImpact.yearsDelayed < 1 / 12) {
    return null;
  }

  return `If returns come in ${formatPercent(
    returnImpact.returnDelta
  )} lower, FIRE moves about ${formatDurationYears(returnImpact.yearsDelayed)} later.`;
}
