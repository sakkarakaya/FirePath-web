import { articles as articleLibrary } from "../data/articles.js";
import { initialOnboardingValues, scenarioPresets } from "../data/defaults.js";
import {
  calculateAnnualExpenses,
  calculateEmergencyFundMonths,
  calculateFireNumber,
  calculateFireProgress,
  calculateInflationAdjustedReturn,
  calculateMonthlySavings,
  calculateNetWorth,
  calculateSavingsRate,
  calculateYearsToFire,
  percentToRate
} from "../domain/fireCalculations.js";
import { calculateMonthlyPassiveIncome, calculatePassiveIncomeCoverage } from "../domain/moneyCalculations.js";
import { calculatePortfolioCoverage, calculatePortfolioSummary } from "../domain/portfolioCalculations.js";
import { parseLocaleNumber } from "../domain/numberInput.js";
import { assertValidProfileInput } from "../domain/profileValidation.js";
import {
  clearLegacyData,
  isPersistent,
  nextId,
  nowISO,
  readJson,
  readLegacyData,
  readMeta,
  removeKey,
  STORAGE_KEYS,
  writeJson,
  writeMeta
} from "./storage.js";

/**
 * Single application store.
 *
 * Mirrors the mobile DataProvider: one place owns the persisted collections,
 * views subscribe and re-render. Every mutation writes through to localStorage
 * immediately so a refresh never loses a change.
 */

const SCENARIO_PRESETS_SEEDED = "scenarioPresetsSeeded";
const LEGACY_MIGRATED = "legacyMigrated";

const listeners = new Set();

const state = {
  isReady: false,
  profile: null,
  holdings: [],
  transactions: [],
  scenarios: [],
  articles: []
};

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => listener(state));
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

export function initStore() {
  state.profile = readJson(STORAGE_KEYS.profile, null);
  state.holdings = readJson(STORAGE_KEYS.holdings, []);
  state.transactions = readJson(STORAGE_KEYS.transactions, []);
  state.scenarios = readJson(STORAGE_KEYS.scenarios, []);
  state.articles = readJson(STORAGE_KEYS.articles, []);

  seedArticles();
  seedScenarioPresets();
  migrateLegacyData();

  state.isReady = true;
  notify();
}

export function storageIsPersistent() {
  return isPersistent();
}

/** Articles are content, not user data, so new lessons appear without a reset. */
function seedArticles() {
  const readTitles = new Set(
    state.articles.filter((article) => article.isRead).map((article) => article.title)
  );

  state.articles = articleLibrary.map((article, index) => ({
    ...article,
    id: index + 1,
    isRead: readTitles.has(article.title)
  }));

  writeJson(STORAGE_KEYS.articles, state.articles);
}

/**
 * Seeds the starter scenarios exactly once, tracked with a meta flag rather
 * than by list length. Counting rows would resurrect presets the user
 * deliberately deleted on the next visit.
 */
function seedScenarioPresets() {
  if (readMeta(SCENARIO_PRESETS_SEEDED)) {
    return;
  }

  const createdAt = nowISO();
  const baseId = nextId(state.scenarios);

  state.scenarios = [
    ...state.scenarios,
    ...scenarioPresets.map((preset, index) => ({
      ...preset,
      id: baseId + index,
      createdAt
    }))
  ];

  writeJson(STORAGE_KEYS.scenarios, state.scenarios);
  writeMeta(SCENARIO_PRESETS_SEEDED, true);
}

/**
 * Carries data from the previous single-page version across.
 *
 * The old page stored ten calculator inputs and a flat holdings list. Those map
 * onto a profile and tracked holdings, so a returning visitor lands on a filled
 * dashboard instead of an empty one.
 */
function migrateLegacyData() {
  if (readMeta(LEGACY_MIGRATED)) {
    return;
  }

  const legacy = readLegacyData();
  writeMeta(LEGACY_MIGRATED, true);

  if (!legacy) {
    return;
  }

  const inputs = legacy.inputs;
  const readNumber = (key, fallback) => {
    const parsed = parseLocaleNumber(inputs[key] ?? "");
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };

  if (!state.profile && Object.keys(inputs).length > 0) {
    const monthlyExpenses = readNumber("monthlyExpenses", 0);
    const defaults = initialOnboardingValues;
    const timestamp = nowISO();

    state.profile = {
      id: 1,
      age: Number(defaults.age),
      country: defaults.country,
      currency: "EUR",
      monthlyIncome: readNumber("monthlyIncome", 0),
      monthlyExpenses,
      currentCash: readNumber("cash", 0),
      currentInvestments: readNumber("investments", 0),
      debts: readNumber("debts", 0),
      monthlyInvestment: readNumber("monthlyInvestment", 0),
      emergencyFund: readNumber("cash", 0),
      targetFireAge: Number(defaults.targetFireAge),
      desiredMonthlyFireSpending: readNumber("fireSpending", monthlyExpenses),
      withdrawalRate: percentToRate(readNumber("withdrawalRate", 4)),
      expectedReturn: percentToRate(readNumber("expectedReturn", 6)),
      expectedInflation: percentToRate(readNumber("inflation", 2)),
      investingExperience: defaults.investingExperience,
      drawdownResponse: defaults.drawdownResponse,
      learningTopics: [...defaults.learningTopics],
      weeklySummaryEnabled: false,
      monthlyReportEnabled: false,
      progressAlertEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    writeJson(STORAGE_KEYS.profile, state.profile);
  }

  if (state.holdings.length === 0 && legacy.holdings.length > 0) {
    const currency = state.profile?.currency ?? "EUR";
    const timestamp = nowISO();

    // The old rows stored a total value and a total invested amount with no
    // quantity, so quantity 1 keeps the price * quantity arithmetic exact.
    state.holdings = legacy.holdings.map((holding, index) => ({
      id: index + 1,
      assetType: "Other",
      name: String(holding.name ?? "Holding"),
      ticker: "",
      quantity: 1,
      averageBuyPrice: Math.max(0, Number(holding.invested) || 0),
      currentPrice: Math.max(0, Number(holding.value) || 0),
      currency,
      exchangeRateToBase: 1,
      region: "Global",
      sector: "",
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    writeJson(STORAGE_KEYS.holdings, state.holdings);
  }

  clearLegacyData();
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export function saveProfile(input) {
  assertValidProfileInput(input);

  const timestamp = nowISO();
  state.profile = {
    ...input,
    id: state.profile?.id ?? 1,
    createdAt: state.profile?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  persist(STORAGE_KEYS.profile, state.profile);
  notify();
  return state.profile;
}

/** Partial update that keeps the rest of the saved profile untouched. */
export function patchProfile(patch) {
  if (!state.profile) {
    throw new Error("Complete onboarding before changing plan settings.");
  }

  state.profile = { ...state.profile, ...patch, updatedAt: nowISO() };

  persist(STORAGE_KEYS.profile, state.profile);
  notify();
  return state.profile;
}

/* -------------------------------------------------------------------------- */
/* Holdings                                                                   */
/* -------------------------------------------------------------------------- */

export function addHolding(input) {
  const timestamp = nowISO();
  const holding = { ...input, id: nextId(state.holdings), createdAt: timestamp, updatedAt: timestamp };

  state.holdings = [...state.holdings, holding];
  persist(STORAGE_KEYS.holdings, state.holdings);
  notify();
  return holding;
}

export function addHoldings(inputs) {
  const timestamp = nowISO();
  let id = nextId(state.holdings);

  const added = inputs.map((input) => {
    const holding = { ...input, id, createdAt: timestamp, updatedAt: timestamp };
    id += 1;
    return holding;
  });

  state.holdings = [...state.holdings, ...added];
  persist(STORAGE_KEYS.holdings, state.holdings);
  notify();
  return added;
}

export function updateHolding(id, input) {
  state.holdings = state.holdings.map((holding) =>
    holding.id === id ? { ...holding, ...input, id, updatedAt: nowISO() } : holding
  );

  persist(STORAGE_KEYS.holdings, state.holdings);
  notify();
}

export function updateHoldingPrices(updates) {
  const byId = new Map(updates.map((update) => [update.id, update]));
  const timestamp = nowISO();

  state.holdings = state.holdings.map((holding) => {
    const update = byId.get(holding.id);
    if (!update) {
      return holding;
    }

    return {
      ...holding,
      currentPrice: update.currentPrice,
      priceUpdatedAt: update.priceUpdatedAt,
      priceMarketOpen: update.priceMarketOpen,
      updatedAt: timestamp
    };
  });

  persist(STORAGE_KEYS.holdings, state.holdings);
  notify();
}

export function removeHolding(id) {
  state.holdings = state.holdings.filter((holding) => holding.id !== id);
  persist(STORAGE_KEYS.holdings, state.holdings);
  notify();
}

export function findHolding(id) {
  return state.holdings.find((holding) => holding.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Swaps the entries a given source owns inside one month, leaving everything
 * else alone. The monthly-update screen re-submits totals, so replacing by
 * note prefix keeps re-saving idempotent instead of stacking duplicates.
 */
export function replaceTransactions(startDate, endDate, notePrefix, replacements) {
  const kept = state.transactions.filter(
    (transaction) =>
      !(
        transaction.date >= startDate &&
        transaction.date <= endDate &&
        transaction.note.startsWith(notePrefix)
      )
  );

  const timestamp = nowISO();
  let id = nextId(kept);

  const added = replacements.map((input) => {
    const transaction = { ...input, id, createdAt: timestamp, updatedAt: timestamp };
    id += 1;
    return transaction;
  });

  state.transactions = [...kept, ...added];
  persist(STORAGE_KEYS.transactions, state.transactions);
  notify();
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

export function addScenario(input) {
  const scenario = { ...input, id: nextId(state.scenarios), createdAt: nowISO() };

  state.scenarios = [...state.scenarios, scenario];
  persist(STORAGE_KEYS.scenarios, state.scenarios);
  notify();
  return scenario;
}

export function removeScenario(id) {
  state.scenarios = state.scenarios.filter((scenario) => scenario.id !== id);
  persist(STORAGE_KEYS.scenarios, state.scenarios);
  notify();
}

/* -------------------------------------------------------------------------- */
/* Articles                                                                   */
/* -------------------------------------------------------------------------- */

export function setArticleRead(id, isRead) {
  state.articles = state.articles.map((article) => (article.id === id ? { ...article, isRead } : article));

  persist(STORAGE_KEYS.articles, state.articles);
  notify();
}

export function findArticle(id) {
  return state.articles.find((article) => article.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Reset                                                                      */
/* -------------------------------------------------------------------------- */

/** Clears the user's own data. Lessons are content, so they stay installed. */
export function resetUserData() {
  state.profile = null;
  state.holdings = [];
  state.transactions = [];
  state.scenarios = [];
  state.articles = state.articles.map((article) => ({ ...article, isRead: false }));

  removeKey(STORAGE_KEYS.profile);
  removeKey(STORAGE_KEYS.marketData);
  writeJson(STORAGE_KEYS.holdings, state.holdings);
  writeJson(STORAGE_KEYS.transactions, state.transactions);
  writeJson(STORAGE_KEYS.scenarios, state.scenarios);
  writeJson(STORAGE_KEYS.articles, state.articles);
  writeMeta(SCENARIO_PRESETS_SEEDED, false);

  seedScenarioPresets();
  notify();
}

/** Clears only the profile, so the onboarding flow can be walked again. */
export function resetOnboarding() {
  state.profile = null;
  removeKey(STORAGE_KEYS.profile);
  notify();
}

function persist(key, value) {
  if (!writeJson(key, value)) {
    throw new Error("This browser refused to save the change. Check your storage settings and try again.");
  }
}

/* -------------------------------------------------------------------------- */
/* Derived metrics                                                            */
/* -------------------------------------------------------------------------- */

/** Same shape and arithmetic as the mobile useFireMetrics hook. */
export function selectFireMetrics(
  profile = state.profile,
  holdings = state.holdings,
  transactions = state.transactions
) {
  const portfolioSummary = calculatePortfolioSummary(holdings);

  if (!profile) {
    return {
      netWorth: 0,
      annualExpenses: 0,
      fireNumber: 0,
      fireProgress: 0,
      monthlySavings: 0,
      savingsRate: 0,
      yearsToFire: null,
      emergencyFundMonths: 0,
      portfolioCoverage: calculatePortfolioCoverage({
        trackedValue: portfolioSummary.totalPortfolioValue,
        snapshotValue: 0
      }),
      passiveIncomeCoverage: 0
    };
  }

  // Holdings can be a partial tracked subset, so they should not reduce the
  // saved investment snapshot.
  const portfolioCoverage = calculatePortfolioCoverage({
    trackedValue: portfolioSummary.totalPortfolioValue,
    snapshotValue: profile.currentInvestments
  });
  const netWorth = calculateNetWorth(profile.currentCash, portfolioCoverage.totalValue, profile.debts);
  const annualExpenses = calculateAnnualExpenses(
    profile.desiredMonthlyFireSpending || profile.monthlyExpenses
  );
  const fireNumber = calculateFireNumber(annualExpenses, profile.withdrawalRate);
  const monthlyPassiveIncome = calculateMonthlyPassiveIncome(transactions);
  const inflationAdjustedReturn = calculateInflationAdjustedReturn(
    profile.expectedReturn,
    profile.expectedInflation
  );

  return {
    netWorth,
    annualExpenses,
    fireNumber,
    fireProgress: calculateFireProgress(netWorth, fireNumber),
    monthlySavings: calculateMonthlySavings(profile.monthlyIncome, profile.monthlyExpenses),
    savingsRate: calculateSavingsRate(profile.monthlyIncome, profile.monthlyExpenses),
    yearsToFire: calculateYearsToFire({
      currentAmount: Math.max(netWorth, 0),
      monthlyContribution: profile.monthlyInvestment,
      targetAmount: fireNumber,
      annualReturn: inflationAdjustedReturn
    }),
    emergencyFundMonths: calculateEmergencyFundMonths(profile.emergencyFund, profile.monthlyExpenses),
    portfolioCoverage,
    passiveIncomeCoverage: calculatePassiveIncomeCoverage(monthlyPassiveIncome, profile.monthlyExpenses)
  };
}
