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
import { appendSnapshot, normalizeSnapshots, toSnapshotDate } from "../domain/portfolioHistory.js";
import {
  OPENING_NOTE,
  calculatePortfolioNetInvested,
  deriveHoldingSnapshot,
  transactionsForHolding
} from "../domain/portfolioLedger.js";
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
  articles: [],
  portfolioHistory: [],
  portfolioTransactions: []
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
  state.portfolioHistory = normalizeSnapshots(readJson(STORAGE_KEYS.portfolioHistory, []));
  state.portfolioTransactions = readJson(STORAGE_KEYS.portfolioTransactions, []);

  seedArticles();
  seedScenarioPresets();
  migrateLegacyData();
  reconcileLedgerManagedHoldings();

  state.isReady = true;
  notify();
}

/**
 * Recomputes every ledger-managed holding from its transactions on boot.
 *
 * Inside the app the two are written together, but stored data can also arrive
 * hand-edited or from a future import. Reconciling once at startup makes "the
 * ledger is the source of truth" hold no matter how the data got here.
 */
function reconcileLedgerManagedHoldings() {
  const holdingIds = new Set(state.portfolioTransactions.map((transaction) => transaction.holdingId));

  if (holdingIds.size === 0) {
    return;
  }

  let changed = false;

  state.holdings = state.holdings.map((holding) => {
    if (!holdingIds.has(holding.id)) {
      return holding;
    }

    const snapshot = deriveHoldingSnapshot(
      transactionsForHolding(state.portfolioTransactions, holding.id)
    );

    if (
      snapshot === null ||
      (snapshot.quantity === holding.quantity &&
        snapshot.averageBuyPrice === holding.averageBuyPrice &&
        holding.ledgerManaged)
    ) {
      return holding;
    }

    changed = true;
    return { ...holding, ...snapshot, ledgerManaged: true };
  });

  if (changed) {
    writeJson(STORAGE_KEYS.holdings, state.holdings);
  }
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

/**
 * Adds broker-imported holdings and their dated ledger rows as one operation.
 * The parser uses a stable import key (normally an ISIN) because database ids
 * do not exist until this point. Only the generated numeric ids are persisted.
 */
export function addPortfolioLedgerImport({ holdings: inputs, transactions: transactionInputs }) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("No portfolio holdings were found in this CSV.");
  }

  const timestamp = nowISO();
  const previousHoldings = state.holdings;
  const previousTransactions = state.portfolioTransactions;
  const idsByImportKey = new Map();
  let holdingId = nextId(previousHoldings);

  let addedHoldings = inputs.map((input) => {
    const { importKey, ...holdingInput } = input;
    const key = String(importKey ?? "").trim();
    if (!key || idsByImportKey.has(key)) {
      throw new Error("The CSV contains a holding without a unique security identifier.");
    }

    idsByImportKey.set(key, holdingId);
    const holding = {
      ...holdingInput,
      id: holdingId,
      ledgerManaged: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    holdingId += 1;
    return holding;
  });

  let transactionId = nextId(previousTransactions);
  const addedTransactions = (transactionInputs ?? []).map((input) => {
    const mappedHoldingId = idsByImportKey.get(String(input.holdingKey ?? "").trim());
    if (!mappedHoldingId) {
      throw new Error("A CSV transaction could not be linked to its holding.");
    }

    const { holdingKey, ...transactionInput } = input;
    const transaction = {
      ...blankTransaction(),
      ...normalizeTransactionInput({ ...transactionInput, holdingId: mappedHoldingId }),
      id: transactionId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    transactionId += 1;
    return transaction;
  });

  addedHoldings = addedHoldings.map((holding) => {
    const snapshot = deriveHoldingSnapshot(
      addedTransactions.filter((transaction) => transaction.holdingId === holding.id)
    );
    return snapshot ? { ...holding, ...snapshot } : holding;
  });

  state.holdings = [...previousHoldings, ...addedHoldings];
  state.portfolioTransactions = [...previousTransactions, ...addedTransactions];

  try {
    persist(STORAGE_KEYS.holdings, state.holdings);
    persist(STORAGE_KEYS.portfolioTransactions, state.portfolioTransactions);
  } catch (error) {
    state.holdings = previousHoldings;
    state.portfolioTransactions = previousTransactions;
    writeJson(STORAGE_KEYS.holdings, previousHoldings);
    writeJson(STORAGE_KEYS.portfolioTransactions, previousTransactions);
    throw error;
  }

  notify();
  return { holdings: addedHoldings, transactions: addedTransactions };
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
      // A missing previous close must clear the old value. Keeping it would
      // compare today's price with an unrelated, stale trading session.
      previousClose:
        Number.isFinite(Number(update.previousClose)) && Number(update.previousClose) > 0
          ? Number(update.previousClose)
          : null,
      priceUpdatedAt: update.priceUpdatedAt,
      priceMarketOpen: update.priceMarketOpen,
      marketSourceProvider: update.marketSourceProvider || holding.marketProvider || "",
      marketQuoteCurrency: update.marketQuoteCurrency || holding.marketQuoteCurrency || holding.currency,
      updatedAt: timestamp
    };
  });

  persist(STORAGE_KEYS.holdings, state.holdings);
  notify();
}

/**
 * Applies fresh base-currency rates to every holding in the given currencies.
 *
 * The rate is captured when a holding is added, so without this a foreign
 * position keeps converting at the rate that happened to apply on the day it
 * was entered and drifts away from its real base-currency value.
 */
export function updateHoldingExchangeRates(ratesByCurrency) {
  const timestamp = nowISO();
  let changed = false;

  state.holdings = state.holdings.map((holding) => {
    const rate = ratesByCurrency[String(holding.currency ?? "").trim().toUpperCase()];

    if (!Number.isFinite(rate) || rate <= 0 || rate === holding.exchangeRateToBase) {
      return holding;
    }

    changed = true;
    return { ...holding, exchangeRateToBase: rate, exchangeRateUpdatedAt: timestamp, updatedAt: timestamp };
  });

  if (!changed) {
    return 0;
  }

  persist(STORAGE_KEYS.holdings, state.holdings);
  notify();
  return state.holdings.filter((holding) => holding.exchangeRateUpdatedAt === timestamp).length;
}

export function removeHolding(id) {
  state.holdings = state.holdings.filter((holding) => holding.id !== id);
  persist(STORAGE_KEYS.holdings, state.holdings);

  // The ledger describes a position that no longer exists; leaving it behind
  // would resurrect the holding's numbers the next time it is recalculated.
  if (state.portfolioTransactions.some((transaction) => transaction.holdingId === id)) {
    state.portfolioTransactions = state.portfolioTransactions.filter(
      (transaction) => transaction.holdingId !== id
    );
    persist(STORAGE_KEYS.portfolioTransactions, state.portfolioTransactions);
  }

  notify();
}

export function findHolding(id) {
  return state.holdings.find((holding) => holding.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Portfolio history                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Records one snapshot of the tracked portfolio for today.
 *
 * There is no broker connection to replay history from, so the portfolio charts
 * are built from what this browser has seen. Views call this while rendering,
 * which means it must not notify: it writes through and returns whether the
 * series changed, and the caller is already about to paint.
 */
export function recordPortfolioSnapshot() {
  if (state.holdings.length === 0) {
    return false;
  }

  const summary = calculatePortfolioSummary(state.holdings);
  const next = appendSnapshot(state.portfolioHistory, {
    date: toSnapshotDate(),
    value: summary.totalPortfolioValue,
    invested: calculatePortfolioNetInvested(state.holdings, state.portfolioTransactions),
    positions: state.holdings.filter((holding) => Number(holding.quantity) > 0).length
  });

  if (next === state.portfolioHistory) {
    return false;
  }

  state.portfolioHistory = next;
  writeJson(STORAGE_KEYS.portfolioHistory, next);
  return true;
}

export function clearPortfolioHistory() {
  state.portfolioHistory = [];
  writeJson(STORAGE_KEYS.portfolioHistory, state.portfolioHistory);
  notify();
}

/* -------------------------------------------------------------------------- */
/* Portfolio ledger                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Adds a buy, sell or dividend to a holding's ledger.
 *
 * A holding that was entered by hand already claims a quantity and an average
 * price. Recording the first transaction against it would contradict that, so
 * the existing position is written into the ledger as an opening lot first and
 * the reader is told it happened.
 *
 * `openingDate` is when those existing units were actually acquired. It matters:
 * lots are matched oldest-first, so an opening lot dated later than the history
 * being entered would leave earlier sales with nothing to sell.
 *
 * `seedOpeningPosition: false` turns the seeding off, for the one case where it
 * would be wrong: a holding created together with the dated buy that produced
 * it. There is no earlier position to preserve, and seeding one would count the
 * same units twice.
 */
export function addPortfolioTransaction(input, { openingDate, seedOpeningPosition = true } = {}) {
  const holding = findHolding(input.holdingId);

  if (!holding) {
    throw new Error("That holding no longer exists.");
  }

  const timestamp = nowISO();
  let openingTransaction = null;
  let id = nextId(state.portfolioTransactions);
  const added = [];

  if (seedOpeningPosition && !hasLedger(holding.id) && holding.quantity > 0) {
    openingTransaction = {
      ...blankTransaction(),
      id,
      holdingId: holding.id,
      type: "buy",
      date: normalizeDate(openingDate) || (holding.createdAt ?? timestamp).slice(0, 10),
      quantity: holding.quantity,
      price: holding.averageBuyPrice,
      note: OPENING_NOTE,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    added.push(openingTransaction);
    id += 1;
  }

  const transaction = {
    ...blankTransaction(),
    ...normalizeTransactionInput(input),
    id,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  added.push(transaction);

  state.portfolioTransactions = [...state.portfolioTransactions, ...added];
  persist(STORAGE_KEYS.portfolioTransactions, state.portfolioTransactions);
  syncHoldingFromLedger(holding.id);
  notify();

  return { transaction, openingTransaction };
}

export function updatePortfolioTransaction(id, input) {
  const existing = state.portfolioTransactions.find((transaction) => transaction.id === id);

  if (!existing) {
    throw new Error("That transaction no longer exists.");
  }

  state.portfolioTransactions = state.portfolioTransactions.map((transaction) =>
    transaction.id === id
      ? { ...transaction, ...normalizeTransactionInput(input), id, updatedAt: nowISO() }
      : transaction
  );

  persist(STORAGE_KEYS.portfolioTransactions, state.portfolioTransactions);
  syncHoldingFromLedger(existing.holdingId);
  notify();
}

export function removePortfolioTransaction(id) {
  const existing = state.portfolioTransactions.find((transaction) => transaction.id === id);

  if (!existing) {
    return;
  }

  state.portfolioTransactions = state.portfolioTransactions.filter(
    (transaction) => transaction.id !== id
  );
  persist(STORAGE_KEYS.portfolioTransactions, state.portfolioTransactions);
  syncHoldingFromLedger(existing.holdingId);
  notify();
}

export function findPortfolioTransaction(id) {
  return state.portfolioTransactions.find((transaction) => transaction.id === id) ?? null;
}

export function hasLedger(holdingId) {
  return state.portfolioTransactions.some((transaction) => transaction.holdingId === holdingId);
}

/**
 * Rewrites the holding's quantity and average buy price from its ledger.
 *
 * Keeping those two fields authoritative is what lets every existing screen,
 * calculation and CSV export stay unchanged: the ledger is the source, the
 * snapshot is its cached result.
 */
function syncHoldingFromLedger(holdingId) {
  const rows = transactionsForHolding(state.portfolioTransactions, holdingId);
  const snapshot = deriveHoldingSnapshot(rows);
  const timestamp = nowISO();

  state.holdings = state.holdings.map((holding) => {
    if (holding.id !== holdingId) {
      return holding;
    }

    if (snapshot === null) {
      // Last transaction removed: the position goes back to manual entry with
      // whatever the ledger last derived, rather than silently zeroing out.
      const { ledgerManaged, ...rest } = holding;
      return { ...rest, updatedAt: timestamp };
    }

    return { ...holding, ...snapshot, ledgerManaged: true, updatedAt: timestamp };
  });

  persist(STORAGE_KEYS.holdings, state.holdings);
}

function blankTransaction() {
  return {
    holdingId: 0,
    type: "buy",
    date: nowISO().slice(0, 10),
    quantity: 0,
    price: 0,
    amount: 0,
    fee: 0,
    note: ""
  };
}

function normalizeDate(value) {
  const date = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizeTransactionInput(input) {
  const type = ["buy", "sell", "dividend"].includes(input.type) ? input.type : "buy";
  const positive = (value) => Math.max(0, Number(value) || 0);

  return {
    holdingId: input.holdingId,
    type,
    date: String(input.date ?? "").slice(0, 10),
    quantity: type === "dividend" ? 0 : positive(input.quantity),
    price: type === "dividend" ? 0 : positive(input.price),
    amount: type === "dividend" ? positive(input.amount) : 0,
    fee: positive(input.fee),
    note: String(input.note ?? "").trim()
  };
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

/**
 * Clears the tracked portfolio without touching the user's wider FIRE plan.
 *
 * The investment total saved on the profile is deliberately preserved: it can
 * include assets that are not tracked as holdings. After this reset the app
 * therefore treats that amount as an untracked portfolio snapshot.
 */
export function resetPortfolioData() {
  state.holdings = [];
  state.portfolioHistory = [];
  state.portfolioTransactions = [];

  persist(STORAGE_KEYS.holdings, state.holdings);
  removeKey(STORAGE_KEYS.portfolioHistory);
  persist(STORAGE_KEYS.portfolioTransactions, state.portfolioTransactions);
  removeKey(STORAGE_KEYS.priceSeries);
  notify();
}

/** Clears the user's own data. Lessons are content, so they stay installed. */
export function resetUserData() {
  state.profile = null;
  state.holdings = [];
  state.transactions = [];
  state.scenarios = [];
  state.portfolioHistory = [];
  state.portfolioTransactions = [];
  state.articles = state.articles.map((article) => ({ ...article, isRead: false }));

  removeKey(STORAGE_KEYS.profile);
  removeKey(STORAGE_KEYS.marketData);
  removeKey(STORAGE_KEYS.portfolioHistory);
  removeKey(STORAGE_KEYS.priceSeries);
  writeJson(STORAGE_KEYS.portfolioTransactions, state.portfolioTransactions);
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
      fireCapital: 0,
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
  // FIRE withdrawals come from invested assets. Cash still belongs in net
  // worth, but it must not silently compound at the portfolio return.
  const fireCapital = portfolioCoverage.totalValue;
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
    fireCapital,
    annualExpenses,
    fireNumber,
    fireProgress: calculateFireProgress(fireCapital, fireNumber),
    monthlySavings: calculateMonthlySavings(profile.monthlyIncome, profile.monthlyExpenses),
    savingsRate: calculateSavingsRate(profile.monthlyIncome, profile.monthlyExpenses),
    yearsToFire: calculateYearsToFire({
      currentAmount: fireCapital,
      monthlyContribution: profile.monthlyInvestment,
      targetAmount: fireNumber,
      annualReturn: inflationAdjustedReturn
    }),
    emergencyFundMonths: calculateEmergencyFundMonths(profile.emergencyFund, profile.monthlyExpenses),
    portfolioCoverage,
    passiveIncomeCoverage: calculatePassiveIncomeCoverage(monthlyPassiveIncome, profile.monthlyExpenses)
  };
}
