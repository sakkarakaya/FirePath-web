export const drawdownResponseOptions = ["Sell", "Reduce", "Hold", "Buy more"];

export const learningTopicOptions = ["FIRE", "ETF", "Budgeting", "Taxes", "Risk", "Dividends"];

export const initialOnboardingValues = {
  age: "30",
  country: "Germany",
  currency: "EUR",
  monthlyIncome: "3000",
  monthlyExpenses: "1800",
  currentCash: "5000",
  currentInvestments: "10000",
  debts: "0",
  monthlyInvestment: "500",
  emergencyFund: "6000",
  targetFireAge: "50",
  desiredMonthlyFireSpending: "2000",
  withdrawalRate: "3.5",
  expectedReturn: "6",
  expectedInflation: "2",
  investingExperience: "beginner",
  drawdownResponse: "Hold",
  learningTopics: ["FIRE", "ETF"],
  weeklySummaryEnabled: false,
  monthlyReportEnabled: false,
  progressAlertEnabled: false
};

export const onboardingMoneyExamples = {
  EUR: {
    monthlyIncome: 3000,
    monthlyExpenses: 1800,
    currentCash: 5000,
    currentInvestments: 10000,
    debts: 0,
    monthlyInvestment: 500,
    emergencyFund: 6000,
    desiredMonthlyFireSpending: 2000
  },
  USD: {
    monthlyIncome: 4500,
    monthlyExpenses: 2600,
    currentCash: 8000,
    currentInvestments: 20000,
    debts: 0,
    monthlyInvestment: 800,
    emergencyFund: 12000,
    desiredMonthlyFireSpending: 3000
  },
  TRY: {
    monthlyIncome: 80000,
    monthlyExpenses: 45000,
    currentCash: 150000,
    currentInvestments: 300000,
    debts: 0,
    monthlyInvestment: 15000,
    emergencyFund: 250000,
    desiredMonthlyFireSpending: 60000
  },
  GBP: {
    monthlyIncome: 3200,
    monthlyExpenses: 1900,
    currentCash: 6000,
    currentInvestments: 12000,
    debts: 0,
    monthlyInvestment: 550,
    emergencyFund: 7000,
    desiredMonthlyFireSpending: 2200
  },
  CHF: {
    monthlyIncome: 5000,
    monthlyExpenses: 3000,
    currentCash: 10000,
    currentInvestments: 25000,
    debts: 0,
    monthlyInvestment: 1000,
    emergencyFund: 18000,
    desiredMonthlyFireSpending: 3500
  }
};

export const onboardingMoneyFieldKeys = [
  "monthlyIncome",
  "monthlyExpenses",
  "currentCash",
  "currentInvestments",
  "debts",
  "monthlyInvestment",
  "emergencyFund",
  "desiredMonthlyFireSpending"
];

export const scenarioPresets = [
  {
    name: "Conservative",
    monthlyInvestment: 0,
    monthlyExpenses: 0,
    withdrawalRate: 0.03,
    expectedReturn: 0.04,
    expectedInflation: 0.02
  },
  {
    name: "Balanced",
    monthlyInvestment: 0,
    monthlyExpenses: 0,
    withdrawalRate: 0.035,
    expectedReturn: 0.06,
    expectedInflation: 0.02
  },
  {
    name: "Optimistic",
    monthlyInvestment: 0,
    monthlyExpenses: 0,
    withdrawalRate: 0.04,
    expectedReturn: 0.07,
    expectedInflation: 0.02
  }
];

export const incomeCategories = ["Salary", "Bonus", "Freelance", "Interest", "Dividend", "Other"];

export const expenseCategories = [
  "Rent",
  "Groceries",
  "Transport",
  "Insurance",
  "Subscriptions",
  "Travel",
  "Health",
  "Shopping",
  "Other"
];

export const assetTypes = ["ETF", "Stock", "Cash", "Bond", "Crypto", "Real Estate", "Other"];

export const regions = ["USA", "Europe", "Emerging Markets", "Global", "Other"];

export const countryOptions = [
  "Germany",
  "Turkey",
  "United States",
  "United Kingdom",
  "Netherlands",
  "France",
  "Spain",
  "Other"
];

export const currencyOptions = ["EUR", "USD", "TRY", "GBP", "CHF"];

export const withdrawalRateOptions = ["3", "3.5", "4", "Custom"];

export const investingExperienceOptions = ["beginner", "intermediate", "advanced"];
