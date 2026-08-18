import {
  calculateAnnualExpenses,
  calculateBaristaFireNumber,
  calculateCoastFireNumber,
  calculateFireNumber,
  calculateFireProgress,
  calculateInflationAdjustedReturn,
  calculateYearsToFire,
  estimateFireYear,
  percentToRate,
  toNonNegativeNumber
} from "./fireCalculations.js";
import { formatCurrency, formatDurationYears } from "./formatters.js";
import {
  formatNumberForInput,
  formatRateForInput,
  parsePositiveNumber,
  parseSignedNumber
} from "./numberInput.js";

/**
 * FIRE planner logic. The FIRE view only arranges what this module decides:
 * the saved plan headline, the three FIRE styles, the what-if sandbox model and
 * how a sandbox run compares with the saved plan.
 *
 * Everything here is descriptive. No function returns a recommendation — the
 * app explains what the arithmetic implies and leaves the decision to the user.
 */

/** Smallest projection difference worth wording as a change rather than noise. */
const MEANINGFUL_YEARS_DELTA = 1 / 12;

export function buildPlannerStatusLine(metrics, date = new Date()) {
  if (metrics.fireNumber <= 0) {
    return "Add FIRE spending and a withdrawal rate to set your target.";
  }

  if (metrics.fireProgress >= 1) {
    return "Your saved plan already covers this target.";
  }

  const fireYear = estimateFireYear(metrics.yearsToFire, date);
  if (fireYear === null) {
    return "This plan does not reach the target — test a change below.";
  }

  return `Saved plan reaches the target around ${fireYear}.`;
}

/** Age the model reaches FIRE at, or null when the target is out of reach. */
export function estimateFireAge(currentAge, yearsToFire) {
  if (yearsToFire === null || !Number.isFinite(yearsToFire) || !Number.isFinite(currentAge)) {
    return null;
  }

  return Math.round(toNonNegativeNumber(currentAge) + Math.max(0, yearsToFire));
}

/* -------------------------------------------------------------------------- */
/* What-if sandbox                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The sandbox holds raw text, not numbers: a half-typed value such as "3," must
 * survive a re-render instead of being rounded away between keystrokes.
 */
export const EMPTY_SCENARIO_DRAFT = {
  monthlyInvestment: "",
  monthlyExpenses: "",
  expectedReturn: "",
  withdrawalRate: "",
  inflation: ""
};

export function draftFromProfile(profile) {
  if (!profile) {
    return { ...EMPTY_SCENARIO_DRAFT };
  }

  return {
    monthlyInvestment: formatNumberForInput(profile.monthlyInvestment),
    monthlyExpenses: formatNumberForInput(profile.desiredMonthlyFireSpending || profile.monthlyExpenses),
    expectedReturn: formatRateForInput(profile.expectedReturn),
    withdrawalRate: formatRateForInput(profile.withdrawalRate),
    inflation: formatRateForInput(profile.expectedInflation)
  };
}

/** Saved scenarios can predate a field, so the profile fills any zero gaps. */
export function draftFromScenario(scenario, profile) {
  return {
    monthlyInvestment: formatNumberForInput(
      scenario.monthlyInvestment || toNonNegativeNumber(profile?.monthlyInvestment)
    ),
    monthlyExpenses: formatNumberForInput(
      scenario.monthlyExpenses ||
        profile?.desiredMonthlyFireSpending ||
        toNonNegativeNumber(profile?.monthlyExpenses)
    ),
    expectedReturn: formatRateForInput(scenario.expectedReturn),
    withdrawalRate: formatRateForInput(scenario.withdrawalRate),
    inflation: formatRateForInput(scenario.expectedInflation)
  };
}

export function parseScenarioDraft(draft) {
  return {
    monthlyInvestment: parsePositiveNumber(draft.monthlyInvestment),
    monthlyExpenses: parsePositiveNumber(draft.monthlyExpenses),
    expectedReturn: percentToRate(parseSignedNumber(draft.expectedReturn)),
    withdrawalRate: percentToRate(parsePositiveNumber(draft.withdrawalRate)),
    expectedInflation: percentToRate(parseSignedNumber(draft.inflation))
  };
}

/** Compares parsed values, so "3.50" and "3.5" count as the same plan. */
export function isDraftEqual(a, b) {
  const left = parseScenarioDraft(a);
  const right = parseScenarioDraft(b);

  return (
    left.monthlyInvestment === right.monthlyInvestment &&
    left.monthlyExpenses === right.monthlyExpenses &&
    left.expectedReturn === right.expectedReturn &&
    left.withdrawalRate === right.withdrawalRate &&
    left.expectedInflation === right.expectedInflation
  );
}

export function calculateScenarioOutcome(draft, { fireCapital, date = new Date() }) {
  const parsed = parseScenarioDraft(draft);
  const annualExpenses = calculateAnnualExpenses(parsed.monthlyExpenses);
  const fireNumber = calculateFireNumber(annualExpenses, parsed.withdrawalRate);
  const realReturn = calculateInflationAdjustedReturn(parsed.expectedReturn, parsed.expectedInflation);
  const yearsToFire = calculateYearsToFire({
    currentAmount: fireCapital,
    monthlyContribution: parsed.monthlyInvestment,
    targetAmount: fireNumber,
    annualReturn: realReturn
  });

  return {
    annualExpenses,
    fireNumber,
    realReturn,
    yearsToFire,
    fireYear: estimateFireYear(yearsToFire, date),
    progress: calculateFireProgress(fireCapital, fireNumber)
  };
}

/** Blocks a save that would store a scenario the model cannot project from. */
export function validateScenarioDraft(draft) {
  const parsed = parseScenarioDraft(draft);

  if (parsed.withdrawalRate <= 0) {
    return "Set a withdrawal rate above 0% before saving this scenario.";
  }

  if (parsed.monthlyExpenses <= 0) {
    return "Set monthly FIRE spending above 0 before saving this scenario.";
  }

  return null;
}

/**
 * States the sandbox result against the saved plan in plain words. Time is the
 * comparison axis because both levers — saving more and needing less — move it,
 * which keeps otherwise unrelated scenarios comparable.
 */
export function compareScenarioWithPlan({ outcome, metrics, currency }) {
  const fireNumberDelta = outcome.fireNumber - metrics.fireNumber;
  const targetLine = describeTargetChange(fireNumberDelta, outcome.fireNumber, currency);

  if (outcome.fireNumber <= 0) {
    return {
      direction: "needsInput",
      yearsDelta: null,
      fireNumberDelta,
      headline: "Needs a target",
      detail: "Add monthly FIRE spending and a withdrawal rate above 0% to project this scenario.",
      level: "neutral"
    };
  }

  if (outcome.yearsToFire === null) {
    return {
      direction: "unreachable",
      yearsDelta: null,
      fireNumberDelta,
      headline: "Never reaches the target",
      detail: `These inputs never reach ${formatCurrency(outcome.fireNumber, currency)} in this model.`,
      level: "risk"
    };
  }

  if (metrics.yearsToFire === null) {
    return {
      direction: "nowReachable",
      yearsDelta: null,
      fireNumberDelta,
      headline: "Makes the target reachable",
      detail: `Your saved plan never gets there; this one takes about ${formatDurationYears(
        outcome.yearsToFire
      )}. ${targetLine}`,
      level: "good"
    };
  }

  const yearsDelta = outcome.yearsToFire - metrics.yearsToFire;

  if (Math.abs(yearsDelta) < MEANINGFUL_YEARS_DELTA) {
    return {
      direction: "same",
      yearsDelta,
      fireNumberDelta,
      headline: "About the same timeline",
      detail: `This scenario lands within a month of your saved plan. ${targetLine}`,
      level: "neutral"
    };
  }

  const isFaster = yearsDelta < 0;

  return {
    direction: isFaster ? "faster" : "slower",
    yearsDelta,
    fireNumberDelta,
    headline: `${formatDurationYears(yearsDelta)} ${isFaster ? "earlier" : "later"}`,
    detail: `${formatDurationYears(yearsDelta)} ${isFaster ? "sooner" : "later"} than your saved plan. ${targetLine}`,
    level: isFaster ? "good" : "watch"
  };
}

function describeTargetChange(fireNumberDelta, fireNumber, currency) {
  if (Math.abs(fireNumberDelta) < 1) {
    return `The target stays at ${formatCurrency(fireNumber, currency)}.`;
  }

  const direction = fireNumberDelta > 0 ? "higher" : "lower";
  return `The target is ${formatCurrency(
    Math.abs(fireNumberDelta),
    currency
  )} ${direction}, at ${formatCurrency(fireNumber, currency)}.`;
}

/* -------------------------------------------------------------------------- */
/* Saved scenarios                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Saved scenarios are only useful next to each other, so each one is re-run
 * against today's invested FIRE capital rather than shown as the raw inputs it stores.
 */
export function summarizeScenarios(scenarios, metrics, profile) {
  return scenarios.map((scenario) => {
    const monthlyExpenses =
      scenario.monthlyExpenses ||
      profile?.desiredMonthlyFireSpending ||
      toNonNegativeNumber(profile?.monthlyExpenses);
    const monthlyInvestment =
      scenario.monthlyInvestment || toNonNegativeNumber(profile?.monthlyInvestment);
    const fireNumber = calculateFireNumber(
      calculateAnnualExpenses(monthlyExpenses),
      scenario.withdrawalRate
    );
    const yearsToFire = calculateYearsToFire({
      currentAmount: metrics.fireCapital,
      monthlyContribution: monthlyInvestment,
      targetAmount: fireNumber,
      annualReturn: calculateInflationAdjustedReturn(scenario.expectedReturn, scenario.expectedInflation)
    });
    const yearsDelta =
      yearsToFire === null || metrics.yearsToFire === null ? null : yearsToFire - metrics.yearsToFire;

    return {
      scenario,
      fireNumber,
      yearsToFire,
      yearsDelta,
      monthlyInvestment,
      status: describeScenarioDelta(yearsToFire, yearsDelta)
    };
  });
}

function describeScenarioDelta(yearsToFire, yearsDelta) {
  if (yearsToFire === null) {
    return { label: "Out of reach", level: "risk" };
  }

  if (yearsDelta === null) {
    return { label: "Reachable", level: "good" };
  }

  if (Math.abs(yearsDelta) < MEANINGFUL_YEARS_DELTA) {
    return { label: "Same pace", level: "neutral" };
  }

  return yearsDelta < 0
    ? { label: `${formatDurationYears(yearsDelta)} earlier`, level: "good" }
    : { label: `${formatDurationYears(yearsDelta)} later`, level: "watch" };
}

/* -------------------------------------------------------------------------- */
/* FIRE styles                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The three FIRE styles side by side. They all derive from the same saved FIRE
 * number and differ only in what has to be funded, so comparing them shows the
 * cost of each option instead of three unrelated numbers.
 */
export function buildFireVariants({ profile, metrics, partTimeAnnualIncome, currency }) {
  const realReturn = calculateInflationAdjustedReturn(profile.expectedReturn, profile.expectedInflation);
  const yearsUntilTargetAge = Math.max(0, profile.targetFireAge - profile.age);

  const coastTarget = calculateCoastFireNumber({
    targetAmount: metrics.fireNumber,
    yearsUntilTargetAge,
    annualReturn: realReturn
  });
  const baristaTarget = calculateBaristaFireNumber({
    annualExpenses: metrics.annualExpenses,
    expectedAnnualPartTimeIncome: partTimeAnnualIncome,
    withdrawalRate: profile.withdrawalRate
  });

  return [
    buildVariant({
      key: "coast",
      label: "Coast FIRE",
      description: `Enough invested today to reach your target by age ${profile.targetFireAge} without adding more.`,
      targetAmount: coastTarget,
      currentAmount: metrics.fireCapital,
      currency,
      reachedDetail: `Your invested portfolio already coasts to ${formatCurrency(
        metrics.fireNumber,
        currency
      )} by age ${profile.targetFireAge} at ${formatRatePercent(realReturn)} real return.`,
      pendingDetail:
        yearsUntilTargetAge === 0
          ? "Your target FIRE age leaves no years left to compound."
          : `Compounded over ${yearsUntilTargetAge} ${
              yearsUntilTargetAge === 1 ? "year" : "years"
            } at ${formatRatePercent(realReturn)} real return.`
    }),
    buildVariant({
      key: "barista",
      label: "Barista FIRE",
      description: "Part-time income covers part of your spending, so the portfolio funds only the rest.",
      targetAmount: baristaTarget,
      currentAmount: metrics.fireCapital,
      currency,
      reachedDetail:
        partTimeAnnualIncome > 0
          ? `${formatCurrency(partTimeAnnualIncome, currency)} a year of part-time work covers the gap.`
          : "Add expected part-time income to lower this target.",
      pendingDetail:
        partTimeAnnualIncome > 0
          ? `${formatCurrency(
              partTimeAnnualIncome,
              currency
            )} a year of part-time income lowers the target by ${formatCurrency(
              Math.max(0, metrics.fireNumber - baristaTarget),
              currency
            )}.`
          : "Add expected part-time income to see how much it lowers the target."
    }),
    buildVariant({
      key: "full",
      label: "Full FIRE",
      description: "The portfolio alone covers your planned FIRE spending, with no work income.",
      targetAmount: metrics.fireNumber,
      currentAmount: metrics.fireCapital,
      currency,
      reachedDetail: "Your saved plan already covers your full FIRE spending in this model.",
      pendingDetail: `${formatCurrency(metrics.annualExpenses, currency)} a year at a ${formatRatePercent(
        profile.withdrawalRate
      )} withdrawal rate.`
    })
  ];
}

function buildVariant({
  key,
  label,
  description,
  targetAmount,
  currentAmount,
  currency,
  reachedDetail,
  pendingDetail
}) {
  const target = toNonNegativeNumber(targetAmount);

  if (target === 0) {
    return {
      key,
      label,
      description,
      targetAmount: 0,
      progress: 0,
      shortfall: 0,
      status: { label: "Needs inputs", level: "neutral" },
      detail: "Set your FIRE spending and withdrawal rate to calculate this target."
    };
  }

  const shortfall = Math.max(0, target - Math.max(0, currentAmount));

  return {
    key,
    label,
    description,
    targetAmount: target,
    progress: calculateFireProgress(currentAmount, target),
    shortfall,
    status: shortfall === 0 ? { label: "Reached", level: "good" } : { label: "In progress", level: "watch" },
    detail: shortfall === 0 ? reachedDetail : `${formatCurrency(shortfall, currency)} to go. ${pendingDetail}`
  };
}

function formatRatePercent(rate) {
  return `${(Number.isFinite(rate) ? rate * 100 : 0).toFixed(1)}%`;
}

/* -------------------------------------------------------------------------- */
/* Missing inputs                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Inputs the projections on this page cannot work without. Listed explicitly so
 * the view asks for them instead of rendering confident-looking zeros.
 */
export function findPlannerGaps(profile) {
  if (!profile) {
    return [];
  }

  const gaps = [];
  const fireSpending = profile.desiredMonthlyFireSpending || profile.monthlyExpenses;

  if (fireSpending <= 0 || profile.withdrawalRate <= 0) {
    gaps.push({
      key: "fireTarget",
      title: "Set your FIRE target",
      description: "Monthly FIRE spending and a withdrawal rate define the number to reach.",
      route: "/settings/fire-assumptions"
    });
  }

  if (profile.monthlyInvestment <= 0) {
    gaps.push({
      key: "investing",
      title: "Add a monthly investment",
      description: "Without a contribution the timeline below cannot be projected.",
      route: "/settings/fire-assumptions"
    });
  }

  if (profile.expectedReturn <= 0) {
    gaps.push({
      key: "returnAssumption",
      title: "Set an expected return",
      description: "Compounding drives every projection on this screen.",
      route: "/settings/fire-assumptions"
    });
  }

  if (profile.targetFireAge <= profile.age) {
    gaps.push({
      key: "targetAge",
      title: "Set a target FIRE age",
      description: "Coast FIRE needs years of compounding left to be meaningful.",
      route: "/settings/fire-assumptions"
    });
  }

  return gaps;
}
