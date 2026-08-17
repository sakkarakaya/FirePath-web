import { drawdownResponseOptions } from "../data/defaults.js";

export function validateProfileInput(input) {
  const errors = [];

  if (!Number.isInteger(input.age) || input.age < 16 || input.age > 100) {
    errors.push("Age must be between 16 and 100.");
  }
  if (!input.country.trim()) {
    errors.push("Country is required.");
  }
  if (!input.currency.trim()) {
    errors.push("Currency is required.");
  }
  requirePositive(input.monthlyIncome, "Monthly income", errors);
  requirePositive(input.monthlyExpenses, "Monthly expenses", errors);
  requireNonNegative(input.currentCash, "Current cash", errors);
  requireNonNegative(input.currentInvestments, "Current investments", errors);
  requireNonNegative(input.debts, "Debts", errors);
  requireNonNegative(input.monthlyInvestment, "Monthly investment", errors);
  requireNonNegative(input.emergencyFund, "Emergency fund", errors);
  if (!Number.isInteger(input.targetFireAge) || input.targetFireAge <= input.age || input.targetFireAge > 100) {
    errors.push("Target FIRE age must be above your current age and at most 100.");
  }
  requirePositive(input.desiredMonthlyFireSpending, "Desired monthly FIRE spending", errors);
  requireRange(input.withdrawalRate, 0.01, 0.1, "Withdrawal rate must be between 1% and 10%.", errors);
  requireRange(input.expectedReturn, -0.2, 0.3, "Expected return must be between -20% and 30%.", errors);
  requireRange(input.expectedInflation, -0.05, 0.2, "Expected inflation must be between -5% and 20%.", errors);
  if (!["beginner", "intermediate", "advanced"].includes(input.investingExperience)) {
    errors.push("Investing experience is invalid.");
  }
  if (!drawdownResponseOptions.includes(input.drawdownResponse)) {
    errors.push("Drawdown response is invalid.");
  }

  return { isValid: errors.length === 0, errors };
}

export function assertValidProfileInput(input) {
  const result = validateProfileInput(input);
  if (!result.isValid) {
    throw new Error(result.errors[0]);
  }
}

/** Strips store-managed fields so a Profile can be fed back into saveProfile. */
export function profileToInput(profile) {
  return {
    age: profile.age,
    country: profile.country,
    currency: profile.currency,
    monthlyIncome: profile.monthlyIncome,
    monthlyExpenses: profile.monthlyExpenses,
    currentCash: profile.currentCash,
    currentInvestments: profile.currentInvestments,
    debts: profile.debts,
    monthlyInvestment: profile.monthlyInvestment,
    emergencyFund: profile.emergencyFund,
    targetFireAge: profile.targetFireAge,
    desiredMonthlyFireSpending: profile.desiredMonthlyFireSpending,
    withdrawalRate: profile.withdrawalRate,
    expectedReturn: profile.expectedReturn,
    expectedInflation: profile.expectedInflation,
    investingExperience: profile.investingExperience,
    drawdownResponse: profile.drawdownResponse,
    learningTopics: profile.learningTopics,
    weeklySummaryEnabled: profile.weeklySummaryEnabled,
    monthlyReportEnabled: profile.monthlyReportEnabled,
    progressAlertEnabled: profile.progressAlertEnabled
  };
}

function requirePositive(value, label, errors) {
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${label} must be greater than zero.`);
  }
}

function requireNonNegative(value, label, errors) {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} cannot be negative.`);
  }
}

function requireRange(value, min, max, message, errors) {
  if (!Number.isFinite(value) || value < min || value > max) {
    errors.push(message);
  }
}
