import {
  OPENING_NOTE,
  summarizeHoldingLedger,
  transactionAmount,
  transactionsForHolding
} from "./portfolioLedger.js";

/**
 * Portfolio value reconstruction.
 *
 * The daily snapshots this browser records only start the day someone first
 * opened the app. The ledger, however, knows how many units were held on every
 * past date, and cached price bars know what those units were worth. Multiplying
 * the two rebuilds the value history backwards, which is what turns the history
 * screen from "since you installed this" into a real record.
 *
 * A holding with no ledger has no known past quantity. Rather than assume today's
 * quantity was always held — which would invent a history — it is left out and
 * the share of value that could be priced is reported alongside the result.
 */

/** Rebuilding more than this many days is chart noise, not insight. */
const MAX_DAYS = 2000;

export function buildQuantityTimeline(transactions) {
  const changes = new Map();

  transactions.forEach((transaction) => {
    if (transaction.type !== "buy" && transaction.type !== "sell") {
      return;
    }

    const quantity = Math.max(0, Number(transaction.quantity) || 0);
    const delta = transaction.type === "buy" ? quantity : -quantity;
    changes.set(transaction.date, (changes.get(transaction.date) ?? 0) + delta);
  });

  return [...changes.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, delta]) => ({ date, delta }));
}

/**
 * Net cash put into a holding by a date: buys and their fees, less what sales
 * and dividends paid back. This is the line a value chart is measured against.
 */
export function buildInvestedTimeline(transactions) {
  const changes = new Map();

  transactions.forEach((transaction) => {
    const fee = Math.max(0, Number(transaction.fee) || 0);
    const gross =
      transaction.type === "dividend"
        ? Math.max(0, Number(transaction.amount) || 0)
        : Math.max(0, Number(transaction.quantity) || 0) * Math.max(0, Number(transaction.price) || 0);

    const delta =
      transaction.type === "buy" ? gross + fee : transaction.type === "sell" ? -(gross - fee) : -(gross - fee);

    changes.set(transaction.date, (changes.get(transaction.date) ?? 0) + delta);
  });

  return [...changes.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, delta]) => ({ date, delta }));
}

/**
 * Rebuilds the daily value of every holding that has both a ledger and cached
 * price bars.
 *
 * Prices are carried forward across non-trading days, and a holding contributes
 * nothing before its first buy — so the series starts where the portfolio
 * actually started rather than at an artificial zero.
 */
export function reconstructPortfolioSeries({
  holdings,
  transactions,
  seriesByKey,
  keyForHolding,
  baseCurrency = "EUR",
  // The whole portfolio, so coverage is measured against everything the reader
  // owns rather than against the subset that happened to be rebuildable.
  allHoldings = holdings,
  today = new Date()
}) {
  const parts = holdings
    .map((holding) => {
      const rows = transactionsForHolding(transactions, holding.id);
      const series = seriesByKey[keyForHolding(holding)] ?? null;

      if (rows.length === 0 || series === null || series.bars.length === 0) {
        return null;
      }

      const normalizedBase = normalizeCurrency(baseCurrency);
      const priceCurrency = normalizeCurrency(
        series.currency || holding.marketQuoteCurrency || holding.currency || normalizedBase
      );
      const cashCurrency = normalizeCurrency(holding.currency || normalizedBase);
      const priceRates = currencyRateSeries(seriesByKey, priceCurrency, normalizedBase);
      const cashRates = currencyRateSeries(seriesByKey, cashCurrency, normalizedBase);
      const firstRelevantDate = [rows[0]?.date, series.bars[0]?.date].filter(Boolean).sort().at(-1);

      if (
        !firstRelevantDate ||
        !hasRateOn(priceRates, firstRelevantDate) ||
        rows.some((transaction) => !hasRateOn(cashRates, transaction.date))
      ) {
        return null;
      }

      return {
        holding,
        rows,
        bars: series.bars,
        priceRates,
        cashRates,
        quantities: buildQuantityTimeline(rows),
        invested: buildInvestedTimelineInBase(rows, cashRates)
      };
    })
    .filter(Boolean);

  const currentValue = (holding) =>
    Math.max(0, Number(holding.quantity) || 0) *
    Math.max(0, Number(holding.currentPrice) || 0) *
    Math.max(0, Number(holding.exchangeRateToBase) || 0);

  const totalValue = allHoldings.reduce((total, holding) => total + currentValue(holding), 0);
  const pricedValue = parts.reduce((total, part) => total + currentValue(part.holding), 0);

  if (parts.length === 0) {
    return {
      isEmpty: true,
      points: [],
      invested: [],
      cashFlows: [],
      coverage: 0,
      pricedHoldings: [],
      excludedHoldings: allHoldings.map((holding) => holding.name)
    };
  }

  const dates = buildDateAxis(parts, today);
  const cursors = parts.map(() => ({ bar: 0, quantity: 0, quantityIndex: 0, invested: 0, investedIndex: 0 }));
  const points = [];
  const invested = [];

  dates.forEach((date) => {
    let value = 0;
    let cost = 0;

    parts.forEach((part, index) => {
      const cursor = cursors[index];

      while (
        cursor.quantityIndex < part.quantities.length &&
        part.quantities[cursor.quantityIndex].date <= date
      ) {
        cursor.quantity += part.quantities[cursor.quantityIndex].delta;
        cursor.quantityIndex += 1;
      }

      while (
        cursor.investedIndex < part.invested.length &&
        part.invested[cursor.investedIndex].date <= date
      ) {
        cursor.invested += part.invested[cursor.investedIndex].delta;
        cursor.investedIndex += 1;
      }

      // Carry the last close forward: weekends, holidays and gaps in the
      // provider's data are not days the position stopped existing.
      while (cursor.bar + 1 < part.bars.length && part.bars[cursor.bar + 1].date <= date) {
        cursor.bar += 1;
      }

      const bar = part.bars[cursor.bar];
      if (!bar || bar.date > date || cursor.quantity <= 0) {
        cost += Math.max(0, cursor.invested);
        return;
      }

      const priceRate = rateOn(part.priceRates, date);
      if (priceRate !== null) {
        value += cursor.quantity * bar.close * priceRate;
      }
      cost += Math.max(0, cursor.invested);
    });

    points.push({ label: date, value });
    invested.push({ label: date, value: cost });
  });

  return {
    isEmpty: false,
    points,
    invested,
    cashFlows: buildDatedCashFlows(parts),
    coverage: totalValue === 0 ? 0 : pricedValue / totalValue,
    pricedHoldings: parts.map((part) => part.holding.name),
    excludedHoldings: allHoldings
      .filter((holding) => !parts.some((part) => part.holding.id === holding.id))
      .map((holding) => holding.name)
  };
}

/**
 * Time-weighted return.
 *
 * Splits the period at every cash flow so that adding or withdrawing money
 * neither helps nor hurts the number. This is the return that can be compared
 * against an index, where XIRR answers the different question of what the
 * money itself earned given when it arrived.
 */
export function calculateTimeWeightedReturn(points, cashFlows) {
  if (points.length < 2) {
    return { total: null, annualized: null, dailyReturns: [], indexSeries: [] };
  }

  // Flows are matched to the interval they fall in, not to an exact date. A buy
  // settled on a Saturday has no bar of its own, and keying by date would leave
  // Monday's jump in value looking like performance instead of a deposit.
  const flows = normalizeFlows(cashFlows);
  let cursor = 0;

  // Anything on or before the first point is already inside its value.
  while (cursor < flows.length && flows[cursor].date <= points[0].label) {
    cursor += 1;
  }

  const dailyReturns = [];
  // Growth of one unit of money, which is the only portfolio line that can be
  // laid over an index: raw value would show every contribution as performance.
  const indexSeries = [{ label: points[0].label, value: 100 }];
  let growth = 1;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].value;
    const current = points[index].value;

    let flow = 0;
    while (cursor < flows.length && flows[cursor].date <= points[index].label) {
      flow += flows[cursor].amount;
      cursor += 1;
    }

    // The flow arrived during the day, so it is removed before measuring how
    // much the money that was already there actually grew.
    const periodReturn = previous <= 0 ? null : (current - flow) / previous - 1;
    const usable = periodReturn !== null && Number.isFinite(periodReturn) && periodReturn > -1;

    if (usable) {
      growth *= 1 + periodReturn;
      dailyReturns.push(periodReturn);
    }

    // One entry per point, carrying the last value through days that could not
    // be measured, so looking the index up by date can never land on a gap.
    indexSeries.push({ label: points[index].label, value: growth * 100 });
  }

  const total = growth - 1;
  const days = daysBetween(points[0].label, points[points.length - 1].label);
  const annualized = days < 30 ? null : (1 + total) ** (365 / days) - 1;

  return { total, annualized, dailyReturns, indexSeries };
}

/** Volatility, drawdown and the day extremes, all from the observed series. */
export function calculateRiskMetrics(points, dailyReturns, { drawdownPoints = points } = {}) {
  if (points.length < 2) {
    return {
      volatility: null,
      maxDrawdown: 0,
      drawdownSeries: [],
      bestDay: null,
      worstDay: null,
      sharpe: null
    };
  }

  const returns = dailyReturns ?? [];
  const mean = returns.length === 0 ? 0 : returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.length < 2
      ? 0
      : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  // 252 trading days is the convention; the series carries prices forward on
  // non-trading days, so this is an approximation and the UI says so.
  const volatility = returns.length < 2 ? null : Math.sqrt(variance) * Math.sqrt(252);

  const drawdownInput = drawdownPoints.length > 0 ? drawdownPoints : points;
  let peak = drawdownInput[0].value;
  let maxDrawdown = 0;
  const drawdownSeries = [];

  drawdownInput.forEach((point) => {
    peak = Math.max(peak, point.value);
    const drawdown = peak <= 0 ? 0 : (point.value - peak) / peak;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    drawdownSeries.push({ label: point.label, value: drawdown });
  });

  const best = returns.length === 0 ? null : Math.max(...returns);
  const worst = returns.length === 0 ? null : Math.min(...returns);

  return {
    volatility,
    maxDrawdown: Math.abs(maxDrawdown),
    drawdownSeries,
    bestDay: best,
    worstDay: worst,
    // Risk-free rate is taken as zero rather than guessed at; the UI labels it.
    sharpe: volatility === null || volatility === 0 ? null : (mean * 252) / volatility
  };
}

/**
 * Calendar-year breakdown.
 *
 * Each year is measured from the last valuation of the year before, so a year's
 * return picks up exactly where the previous one left off and the years chain
 * back to the total. The current year is marked partial: it is a year-to-date
 * figure and annualizing it would be a forecast, which this app does not make.
 */
export function buildYearlyPerformance({
  points,
  indexSeries,
  cashFlows,
  holdings = [],
  transactions = [],
  seriesByKey = {},
  baseCurrency = "EUR",
  benchmarkBars = [],
  today = new Date()
}) {
  if (points.length < 2 || indexSeries.length < 2) {
    return [];
  }

  const flows = Array.isArray(cashFlows) ? cashFlows : [];
  const currentYear = Number(toDateKey(today).slice(0, 4));
  const years = [...new Set(points.map((point) => Number(point.label.slice(0, 4))))].sort();
  const ledger = buildLedgerByYear(holdings, transactions, { seriesByKey, baseCurrency });

  return years.map((year) => {
    const yearEnd = `${year}-12-31`;
    const previousEnd = `${year - 1}-12-31`;

    const endIndex = lastAtOrBefore(indexSeries, yearEnd, (entry) => entry.label);
    const startIndex = lastAtOrBefore(indexSeries, previousEnd, (entry) => entry.label);
    const endPoint = lastAtOrBefore(points, yearEnd, (point) => point.label);
    const startPoint = lastAtOrBefore(points, previousEnd, (point) => point.label);

    // The first year has nothing before it, so its return starts at the index
    // base rather than at a prior year that was never observed.
    const openingIndex = startIndex?.value ?? indexSeries[0].value;
    const twr = openingIndex === 0 || !endIndex ? null : endIndex.value / openingIndex - 1;

    const benchmarkEnd = lastAtOrBefore(benchmarkBars, yearEnd, (bar) => bar.date);
    const benchmarkStart =
      lastAtOrBefore(benchmarkBars, previousEnd, (bar) => bar.date) ??
      firstAtOrAfter(benchmarkBars, `${year}-01-01`, (bar) => bar.date);
    const benchmarkReturn =
      benchmarkEnd && benchmarkStart && benchmarkStart.close !== 0
        ? benchmarkEnd.close / benchmarkStart.close - 1
        : null;

    const yearLedger = ledger.get(year) ?? { realized: 0, dividends: 0, fees: 0, trades: 0 };

    return {
      year,
      isPartial: year === currentYear,
      startValue: startPoint?.value ?? points.find((point) => point.label.startsWith(String(year)))?.value ?? 0,
      endValue: endPoint?.value ?? 0,
      contributions: flows
        .filter((flow) => flow.date.startsWith(String(year)))
        .reduce((total, flow) => total + flow.amount, 0),
      twr,
      benchmarkReturn,
      difference: twr === null || benchmarkReturn === null ? null : twr - benchmarkReturn,
      ...yearLedger
    };
  });
}

/** Realized results, income and fees per calendar year, in base currency. */
function buildLedgerByYear(holdings, transactions, { seriesByKey, baseCurrency }) {
  const byYear = new Map();
  const bucket = (year) => {
    if (!byYear.has(year)) {
      byYear.set(year, { realized: 0, dividends: 0, fees: 0, trades: 0 });
    }
    return byYear.get(year);
  };

  holdings.forEach((holding) => {
    const rows = transactionsForHolding(transactions, holding.id);
    if (rows.length === 0) return;

    const rates = currencyRateSeries(
      seriesByKey,
      normalizeCurrency(holding.currency || baseCurrency),
      normalizeCurrency(baseCurrency)
    );
    const summary = summarizeHoldingLedger(rows);

    summary?.sales.forEach((sale) => {
      const rate = rateOn(rates, sale.date);
      if (rate !== null) bucket(Number(sale.date.slice(0, 4))).realized += sale.gainLoss * rate;
    });

    rows.forEach((transaction) => {
      const rate = rateOn(rates, transaction.date);
      if (rate === null) return;
      const year = Number(transaction.date.slice(0, 4));
      const entry = bucket(year);
      const fee = Math.max(0, Number(transaction.fee) || 0);

      entry.fees += fee * rate;

      if (transaction.type === "dividend") {
        entry.dividends += (transactionAmount(transaction) - fee) * rate;
      } else {
        entry.trades += 1;
      }
    });
  });

  return byYear;
}

function lastAtOrBefore(rows, date, pick) {
  let found = null;
  for (const row of rows) {
    if (pick(row) > date) break;
    found = row;
  }
  return found;
}

function firstAtOrAfter(rows, date, pick) {
  return rows.find((row) => pick(row) >= date) ?? null;
}

/** Rebases a series to 100 at its first point, for like-for-like comparison. */
export function normalizeSeries(points, base = 100) {
  if (points.length === 0 || points[0].value <= 0) {
    return [];
  }

  const first = points[0].value;
  return points.map((point) => ({ label: point.label, value: (point.value / first) * base }));
}

/**
 * Puts a benchmark's bars onto the portfolio's dates and rebases both to 100.
 *
 * `portfolioIndex` should be the time-weighted growth series. Comparing the raw
 * value against an index would credit every deposit as outperformance, which is
 * the single easiest way for a portfolio tracker to flatter its owner.
 */
export function alignBenchmark(points, bars, { portfolioIndex = null } = {}) {
  if (points.length === 0 || bars.length === 0) {
    return { portfolio: [], benchmark: [], benchmarkReturn: null };
  }

  const orderedBars = [...bars].sort((left, right) => left.date.localeCompare(right.date));
  const start = points[0].label > orderedBars[0].date ? points[0].label : orderedBars[0].date;
  const comparablePoints = points.filter((point) => point.label >= start);

  if (comparablePoints.length === 0) {
    return { portfolio: [], benchmark: [], benchmarkReturn: null };
  }

  let cursor = 0;
  const aligned = [];

  comparablePoints.forEach((point) => {
    while (cursor + 1 < orderedBars.length && orderedBars[cursor + 1].date <= point.label) {
      cursor += 1;
    }
    aligned.push({ label: point.label, value: orderedBars[cursor].close });
  });

  const first = aligned[0].value;
  const last = aligned[aligned.length - 1].value;

  return {
    portfolio: normalizeSeries(
      (portfolioIndex ?? points).filter((point) => point.label >= comparablePoints[0].label)
    ),
    benchmark: normalizeSeries(aligned),
    benchmarkReturn: first === 0 ? null : last / first - 1
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function buildDateAxis(parts, today) {
  const firstBuy = parts
    .map((part) => part.quantities[0]?.date)
    .filter(Boolean)
    .sort()
    .at(0);

  const firstBar = parts
    .map((part) => part.bars[0]?.date)
    .filter(Boolean)
    .sort()
    .at(0);

  const start = [firstBuy, firstBar].filter(Boolean).sort().at(-1);
  const end = toDateKey(today);

  if (!start || start > end) {
    return [];
  }

  // Trading days come from the bars themselves, so the axis has no weekend
  // gaps to carry forward and stays the length a chart can actually draw.
  const dates = [
    ...new Set(parts.flatMap((part) => part.bars.map((bar) => bar.date)).filter((date) => date >= start && date <= end))
  ].sort();

  if (dates.length === 0) {
    return [];
  }

  if (dates[dates.length - 1] !== end) {
    dates.push(end);
  }

  return dates.slice(-MAX_DAYS);
}

/**
 * Cash flows in base currency, dated, for the time-weighted return.
 *
 * An opening position is the one entry whose recorded price is deliberately not
 * a trade price: it is the average of purchases spread over years, stamped on a
 * single date. Treating it as cash paid that day would make the difference
 * against that day's market price look like a return — a portfolio would appear
 * to lurch the moment its owner started tracking it. It is valued instead at
 * what the units were worth that day, which is what "transferred into tracking"
 * actually means.
 */
function buildDatedCashFlows(parts) {
  const flows = new Map();

  parts.forEach((part) => {
    part.rows.forEach((transaction) => {
      const fee = Math.max(0, Number(transaction.fee) || 0);
      const quantity = Math.max(0, Number(transaction.quantity) || 0);
      const marketClose =
        transaction.note === OPENING_NOTE && transaction.type === "buy"
          ? closeOn(part.bars, transaction.date)
          : null;

      const cashRate = rateOn(part.cashRates, transaction.date);
      const priceRate = marketClose === null ? null : rateOn(part.priceRates, transaction.date);
      if (cashRate === null || (marketClose !== null && priceRate === null)) return;

      const transactionGross =
        transaction.type === "dividend"
          ? Math.max(0, Number(transaction.amount) || 0)
          : quantity * Math.max(0, Number(transaction.price) || 0);
      const grossInBase =
        marketClose === null ? transactionGross * cashRate : quantity * marketClose * priceRate;
      const feeInBase = fee * cashRate;

      // Positive means money entered the portfolio that day.
      const flow =
        transaction.type === "buy"
          ? grossInBase + feeInBase
          : transaction.type === "sell"
            ? -(grossInBase - feeInBase)
            : -(grossInBase - feeInBase);

      flows.set(transaction.date, (flows.get(transaction.date) ?? 0) + flow);
    });
  });

  return [...flows.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function buildInvestedTimelineInBase(transactions, rates) {
  const changes = new Map();

  transactions.forEach((transaction) => {
    const rate = rateOn(rates, transaction.date);
    if (rate === null) return;
    const fee = Math.max(0, Number(transaction.fee) || 0);
    const gross =
      transaction.type === "dividend"
        ? Math.max(0, Number(transaction.amount) || 0)
        : Math.max(0, Number(transaction.quantity) || 0) * Math.max(0, Number(transaction.price) || 0);
    const delta = transaction.type === "buy" ? gross + fee : -(gross - fee);
    changes.set(transaction.date, (changes.get(transaction.date) ?? 0) + delta * rate);
  });

  return [...changes.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, delta]) => ({ date, delta }));
}

function currencyRateSeries(seriesByKey, from, to) {
  if (!from || !to || from === to) return null;
  return seriesByKey[`${from}/${to}`] ?? undefined;
}

function hasRateOn(series, date) {
  return series === null || (series !== undefined && rateOn(series, date) !== null);
}

function rateOn(series, date) {
  if (series === null) return 1;
  if (!series || !Array.isArray(series.bars)) return null;
  return closeOn(series.bars, date);
}

function normalizeCurrency(value) {
  return String(value ?? "").trim().toUpperCase();
}

/** Accepts a Map keyed by date or a list, and returns a date-sorted list. */
function normalizeFlows(cashFlows) {
  const rows =
    cashFlows instanceof Map
      ? [...cashFlows.entries()].map(([date, amount]) => ({ date, amount }))
      : Array.isArray(cashFlows)
        ? cashFlows
        : Object.entries(cashFlows ?? {}).map(([date, amount]) => ({ date, amount }));

  return rows
    .map((row) => ({ date: String(row.date), amount: Number(row.amount) || 0 }))
    .filter((row) => row.amount !== 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

/** Last close on or before a date, or null when the bars start later. */
function closeOn(bars, date) {
  let found = null;

  for (const bar of bars) {
    if (bar.date > date) break;
    found = bar.close;
  }

  return found;
}

function daysBetween(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00`);
  const end = Date.parse(`${endDate}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function toDateKey(date) {
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
