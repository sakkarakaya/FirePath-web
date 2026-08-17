import { getMonthRange } from "./dateRange.js";
import { calculateSavingsRate } from "./fireCalculations.js";

export function calculateTransactionTotals(transactions) {
  const totalIncome = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalExpenses = transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const savingsAmount = Math.max(0, totalIncome - totalExpenses);

  return {
    totalIncome,
    totalExpenses,
    savingsAmount,
    savingsRate: calculateSavingsRate(totalIncome, totalExpenses)
  };
}

export function calculateMonthlyPassiveIncome(transactions, date = new Date()) {
  const { startDate, endDate } = getMonthRange(date);
  const passiveCategories = new Set(["Dividend", "Interest"]);

  return transactions
    .filter((transaction) => transaction.type === "income")
    .filter((transaction) => passiveCategories.has(transaction.category))
    .filter((transaction) => transaction.date >= startDate && transaction.date <= endDate)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function calculatePassiveIncomeCoverage(monthlyPassiveIncome, monthlyExpenses) {
  if (monthlyExpenses <= 0) {
    return 0;
  }
  return Math.max(0, monthlyPassiveIncome) / monthlyExpenses;
}
