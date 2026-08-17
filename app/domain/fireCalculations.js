/**
 * Core FIRE arithmetic.
 *
 * Ported from the FirePath mobile app (src/domain/fireCalculations.ts) so both
 * platforms project identical numbers from identical inputs. Behaviour changes
 * here must be mirrored in the mobile domain module.
 */

export function toSafeNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

export function toNonNegativeNumber(value) {
  return Math.max(0, toSafeNumber(value));
}

export function normalizeRate(rate) {
  return Math.max(-0.999999, toSafeNumber(rate));
}

export function percentToRate(percent) {
  return toSafeNumber(percent) / 100;
}

export function calculateInflationAdjustedReturn(annualReturn, annualInflation) {
  const returnRate = normalizeRate(annualReturn);
  const inflationRate = normalizeRate(annualInflation);
  return normalizeRate((1 + returnRate) / (1 + inflationRate) - 1);
}

export function calculateMonthlyReturnFromAnnualReturn(annualReturn) {
  const rate = normalizeRate(annualReturn);
  if (rate === 0) {
    return 0;
  }
  return Math.pow(1 + rate, 1 / 12) - 1;
}

export function calculateAnnualExpenses(monthlyExpenses) {
  return toNonNegativeNumber(monthlyExpenses) * 12;
}

export function calculateFireNumber(annualExpenses, withdrawalRate) {
  const expenses = toNonNegativeNumber(annualExpenses);
  const rate = normalizeRate(withdrawalRate);
  if (expenses === 0 || rate === 0) {
    return 0;
  }
  return expenses / rate;
}

export function calculateMonthlySavings(monthlyIncome, monthlyExpenses) {
  return Math.max(0, toNonNegativeNumber(monthlyIncome) - toNonNegativeNumber(monthlyExpenses));
}

export function calculateSavingsRate(monthlyIncome, monthlyExpenses) {
  const income = toNonNegativeNumber(monthlyIncome);
  if (income === 0) {
    return 0;
  }
  return Math.min(1, calculateMonthlySavings(income, monthlyExpenses) / income);
}

export function calculateNetWorth(cash, investments, debts) {
  return toNonNegativeNumber(cash) + toNonNegativeNumber(investments) - toNonNegativeNumber(debts);
}

export function calculateFireProgress(netWorth, fireNumber) {
  const target = toNonNegativeNumber(fireNumber);
  if (target === 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, toSafeNumber(netWorth) / target));
}

export function calculateYearsToFire({ currentAmount, monthlyContribution, targetAmount, annualReturn }) {
  const current = Math.max(0, toSafeNumber(currentAmount));
  const contribution = toNonNegativeNumber(monthlyContribution);
  const target = toNonNegativeNumber(targetAmount);
  const monthlyReturn = calculateMonthlyReturnFromAnnualReturn(annualReturn);

  if (target === 0 || current >= target) {
    return 0;
  }

  if (contribution === 0 && monthlyReturn === 0) {
    return null;
  }

  if (monthlyReturn === 0) {
    return contribution === 0 ? null : (target - current) / contribution / 12;
  }

  const contributionFactor = contribution / monthlyReturn;
  const denominator = current + contributionFactor;
  const numerator = target + contributionFactor;
  const ratio = numerator / denominator;

  if (denominator === 0 || ratio <= 0) {
    return null;
  }

  const years = Math.log(ratio) / Math.log(1 + monthlyReturn) / 12;
  return Number.isFinite(years) && years >= 0 ? years : null;
}

export function calculateEmergencyFundMonths(emergencyFund, monthlyExpenses) {
  const expenses = toNonNegativeNumber(monthlyExpenses);
  if (expenses === 0) {
    return 0;
  }
  return toNonNegativeNumber(emergencyFund) / expenses;
}

/**
 * The amount that, invested today and left untouched, compounds to the target
 * by the target age. Below this figure coasting cannot reach the target; at or
 * above it, further contributions are optional in this model.
 */
export function calculateCoastFireNumber({ targetAmount, yearsUntilTargetAge, annualReturn }) {
  const target = toNonNegativeNumber(targetAmount);
  const years = toNonNegativeNumber(yearsUntilTargetAge);
  const rate = normalizeRate(annualReturn);

  if (target === 0) {
    return 0;
  }

  if (years === 0 || rate === 0) {
    return target;
  }

  return target / Math.pow(1 + rate, years);
}

export function calculateCoastFire({ currentAmount, ...input }) {
  return Math.max(0, calculateCoastFireNumber(input) - toNonNegativeNumber(currentAmount));
}

/** Calendar year a projection lands in, or null when the target is unreachable. */
export function estimateFireYear(yearsToFire, date = new Date()) {
  if (yearsToFire === null || !Number.isFinite(yearsToFire)) {
    return null;
  }

  const projected = new Date(date);
  projected.setMonth(projected.getMonth() + Math.round(Math.max(0, yearsToFire) * 12));
  return projected.getFullYear();
}

export function calculateBaristaFireNumber({ annualExpenses, expectedAnnualPartTimeIncome, withdrawalRate }) {
  const unfundedExpenses = Math.max(
    0,
    toNonNegativeNumber(annualExpenses) - toNonNegativeNumber(expectedAnnualPartTimeIncome)
  );
  return calculateFireNumber(unfundedExpenses, withdrawalRate);
}

export function calculateMonthlyInvestmentImpact({ extraMonthlyContribution = 100, ...input }) {
  const extra = toNonNegativeNumber(extraMonthlyContribution);
  const contribution = toNonNegativeNumber(input.monthlyContribution);
  const baseYearsToFire = calculateYearsToFire(input);
  const adjustedYearsToFire = calculateYearsToFire({
    ...input,
    monthlyContribution: contribution + extra
  });

  return {
    extraMonthlyContribution: extra,
    baseYearsToFire,
    adjustedYearsToFire,
    yearsSaved:
      baseYearsToFire === null || adjustedYearsToFire === null
        ? null
        : Math.max(0, baseYearsToFire - adjustedYearsToFire)
  };
}

export function calculateFireSpendingReductionImpact({ monthlyFireSpending, withdrawalRate, reductionRate = 0.1 }) {
  const spending = toNonNegativeNumber(monthlyFireSpending);
  const reduction = Math.min(1, normalizeRate(reductionRate));
  const baseFireNumber = calculateFireNumber(calculateAnnualExpenses(spending), withdrawalRate);
  const reducedMonthlyFireSpending = spending * (1 - reduction);
  const adjustedFireNumber = calculateFireNumber(
    calculateAnnualExpenses(reducedMonthlyFireSpending),
    withdrawalRate
  );

  return {
    reductionRate: reduction,
    reducedMonthlyFireSpending,
    adjustedFireNumber,
    fireNumberReduction: Math.max(0, baseFireNumber - adjustedFireNumber)
  };
}

export function calculateReturnAssumptionImpact({ annualInflation, returnDelta = 0.02, ...input }) {
  const delta = Math.min(1, normalizeRate(returnDelta));
  const baseAnnualReturn = normalizeRate(input.annualReturn);
  const adjustedAnnualReturn = normalizeRate(baseAnnualReturn - delta);
  const baseYearsToFire = calculateYearsToFire({
    ...input,
    annualReturn: calculateInflationAdjustedReturn(baseAnnualReturn, annualInflation)
  });
  const adjustedYearsToFire = calculateYearsToFire({
    ...input,
    annualReturn: calculateInflationAdjustedReturn(adjustedAnnualReturn, annualInflation)
  });

  return {
    returnDelta: delta,
    adjustedAnnualReturn,
    adjustedYearsToFire,
    yearsDelayed:
      baseYearsToFire === null || adjustedYearsToFire === null
        ? null
        : Math.max(0, adjustedYearsToFire - baseYearsToFire)
  };
}

export function calculateFireScore({
  savingsRate,
  emergencyFundMonths,
  debts,
  currentCash,
  currentInvestments,
  monthlyInvestment,
  monthlySavings,
  fireProgress
}) {
  const components = [
    { key: "savingsRate", label: "Savings rate", score: scoreByTarget(savingsRate, 0.5, 30), maxScore: 30 },
    { key: "emergencyFund", label: "Emergency fund", score: scoreByTarget(emergencyFundMonths, 6, 20), maxScore: 20 },
    {
      key: "debtLoad",
      label: "Debt load",
      score: scoreDebtLoad(debts, currentCash, currentInvestments, 20),
      maxScore: 20
    },
    {
      key: "investmentPlan",
      label: "Investment plan",
      score: scoreInvestmentPlan(monthlyInvestment, monthlySavings, 15),
      maxScore: 15
    },
    { key: "fireProgress", label: "FIRE progress", score: scoreByTarget(fireProgress, 0.5, 15), maxScore: 15 }
  ];
  const score = Math.round(components.reduce((total, component) => total + component.score, 0));

  return {
    score,
    maxScore: 100,
    components,
    strongestComponent: findComponentByRelativeScore(components, "highest"),
    improvementComponent: findComponentByRelativeScore(components, "lowest")
  };
}

export function calculateFireTimeline({
  currentDate = new Date(),
  netWorth,
  emergencyFund,
  monthlyExpenses,
  monthlySavings,
  monthlyInvestment,
  fireNumber,
  annualReturn
}) {
  const safeNetWorth = Math.max(0, toSafeNumber(netWorth));
  const emergencyFundTarget = calculateEmergencyFundTarget(monthlyExpenses);
  const nextNetWorthTarget = calculateNextNetWorthMilestone(safeNetWorth);
  const halfFiTarget = calculateHalfFiTarget(fireNumber);

  return [
    buildMilestone({
      key: "emergencyFund",
      label: "Emergency fund",
      description: "Six months of current expenses set aside.",
      targetAmount: emergencyFundTarget,
      yearsUntil: calculateYearsToFire({
        currentAmount: emergencyFund,
        monthlyContribution: monthlySavings,
        targetAmount: emergencyFundTarget,
        annualReturn: 0
      }),
      currentDate
    }),
    buildMilestone({
      key: "netWorthMilestone",
      label: `${formatCompactAmount(nextNetWorthTarget)} net worth`,
      description: "Next round-number net worth marker.",
      targetAmount: nextNetWorthTarget,
      yearsUntil: calculateYearsToFire({
        currentAmount: safeNetWorth,
        monthlyContribution: monthlyInvestment,
        targetAmount: nextNetWorthTarget,
        annualReturn
      }),
      currentDate
    }),
    buildMilestone({
      key: "halfFi",
      label: "50% FI",
      description: "Halfway to the current FIRE number.",
      targetAmount: halfFiTarget,
      yearsUntil: calculateYearsToFire({
        currentAmount: safeNetWorth,
        monthlyContribution: monthlyInvestment,
        targetAmount: halfFiTarget,
        annualReturn
      }),
      currentDate
    }),
    buildMilestone({
      key: "financialIndependence",
      label: "Financial independence",
      description: "Current FIRE number reached in this model.",
      targetAmount: toNonNegativeNumber(fireNumber),
      yearsUntil: calculateYearsToFire({
        currentAmount: safeNetWorth,
        monthlyContribution: monthlyInvestment,
        targetAmount: fireNumber,
        annualReturn
      }),
      currentDate
    })
  ];
}

function scoreByTarget(value, target, maxScore) {
  const safeTarget = toNonNegativeNumber(target);
  if (safeTarget === 0) {
    return 0;
  }
  return clamp01(toSafeNumber(value) / safeTarget) * maxScore;
}

function scoreDebtLoad(debts, currentCash, currentInvestments, maxScore) {
  const safeDebts = toNonNegativeNumber(debts);
  if (safeDebts === 0) {
    return maxScore;
  }

  const totalAssets = toNonNegativeNumber(currentCash) + toNonNegativeNumber(currentInvestments);
  if (totalAssets === 0) {
    return 0;
  }

  const debtToAssetRatio = safeDebts / totalAssets;
  return clamp01(1 - debtToAssetRatio / 0.5) * maxScore;
}

function scoreInvestmentPlan(monthlyInvestment, monthlySavings, maxScore) {
  const investment = toNonNegativeNumber(monthlyInvestment);
  const savings = toNonNegativeNumber(monthlySavings);

  if (savings === 0) {
    return investment > 0 ? maxScore : 0;
  }

  return clamp01(investment / savings) * maxScore;
}

function findComponentByRelativeScore(components, direction) {
  return components.reduce((selected, component) => {
    const selectedRatio = selected.maxScore === 0 ? 0 : selected.score / selected.maxScore;
    const componentRatio = component.maxScore === 0 ? 0 : component.score / component.maxScore;
    return direction === "highest"
      ? componentRatio > selectedRatio
        ? component
        : selected
      : componentRatio < selectedRatio
        ? component
        : selected;
  }, components[0]);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, toSafeNumber(value)));
}

function calculateEmergencyFundTarget(monthlyExpenses) {
  return calculateAnnualExpenses(monthlyExpenses) / 2;
}

function calculateNextNetWorthMilestone(netWorth) {
  const step = 100000;
  return Math.max(step, Math.ceil((toNonNegativeNumber(netWorth) + 1) / step) * step);
}

function calculateHalfFiTarget(fireNumber) {
  return toNonNegativeNumber(fireNumber) / 2;
}

function buildMilestone({ key, label, description, targetAmount, yearsUntil, currentDate }) {
  const safeTarget = toNonNegativeNumber(targetAmount);
  const status =
    safeTarget === 0 || yearsUntil === null ? "needsInput" : yearsUntil === 0 ? "completed" : "projected";

  return {
    key,
    label,
    description,
    targetAmount: safeTarget,
    yearsUntil,
    status,
    yearLabel: formatMilestoneYear(currentDate, status, yearsUntil)
  };
}

function formatMilestoneYear(currentDate, status, yearsUntil) {
  if (status === "needsInput") {
    return "Needs inputs";
  }

  if (status === "completed") {
    return "Now";
  }

  if (yearsUntil === null) {
    return "Needs inputs";
  }

  const projectedDate = new Date(currentDate);
  projectedDate.setMonth(projectedDate.getMonth() + Math.max(1, Math.round(yearsUntil * 12)));
  return String(projectedDate.getFullYear());
}

function formatCompactAmount(value) {
  const safeValue = toNonNegativeNumber(value);
  if (safeValue >= 1000000) {
    return `${Number((safeValue / 1000000).toFixed(1))}M`;
  }
  if (safeValue >= 1000) {
    return `${Math.round(safeValue / 1000)}k`;
  }
  return String(Math.round(safeValue));
}
