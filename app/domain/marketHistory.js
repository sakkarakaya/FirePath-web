import { fetchTimeSeries } from "./marketData.js";
import { transactionsForHolding } from "./portfolioLedger.js";
import { getAllPriceSeries, getPriceSeries, savePriceSeries, seriesKey } from "../store/priceSeries.js";

/**
 * Price history retrieval.
 *
 * One instrument costs one API credit against a small free quota, so a refresh
 * takes a few instruments at a time, oldest cache first, and a series that was
 * fetched today is not fetched again. The result is cached locally, which is
 * what lets the history screens work offline and across visits.
 */

/** Kept under the provider's per-minute credit allowance. */
export const MAX_SERIES_PER_REFRESH = 4;

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export const BENCHMARK_PRESETS = [
  { symbol: "URTH", label: "MSCI World (URTH)" },
  { symbol: "VT", label: "FTSE All-World (VT)" },
  { symbol: "SPY", label: "S&P 500 (SPY)" },
  { symbol: "QQQ", label: "Nasdaq 100 (QQQ)" }
];

export function historyKeyForHolding(holding) {
  return seriesKey(holding.marketSymbol, holding.marketExchange);
}

/**
 * The holdings a value history can actually be rebuilt for: a market symbol to
 * price them with, and a ledger that says how many units were held when.
 */
export function holdingsWithRebuildableHistory(holdings, transactions) {
  return holdings.filter(
    (holding) =>
      Boolean(holding.marketSymbol) && transactionsForHolding(transactions, holding.id).length > 0
  );
}

export function isSeriesStale(entry) {
  if (!entry) return true;
  const updatedAt = Date.parse(entry.updatedAt ?? "");
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt >= STALE_AFTER_MS;
}

export function readCachedSeries() {
  return getAllPriceSeries();
}

/**
 * Fetches the instruments whose cache is missing or stale, oldest first, up to
 * the credit budget. Returns what changed so the caller can say whether another
 * refresh is still needed.
 */
export async function refreshPriceHistory(instruments, { start, budget = MAX_SERIES_PER_REFRESH } = {}) {
  const cached = getAllPriceSeries();

  const pending = instruments
    .filter((instrument) => isSeriesStale(cached[seriesKey(instrument.symbol, instrument.exchange)]))
    .sort((left, right) => {
      const leftAt = cached[seriesKey(left.symbol, left.exchange)]?.updatedAt ?? "";
      const rightAt = cached[seriesKey(right.symbol, right.exchange)]?.updatedAt ?? "";
      return String(leftAt).localeCompare(String(rightAt));
    });

  const batch = pending.slice(0, budget);
  const failed = [];
  let updated = 0;

  // Sequential on purpose: the provider counts credits per minute, and a burst
  // of parallel requests is the fastest way to get every one of them rejected.
  for (const instrument of batch) {
    try {
      const series = await fetchTimeSeries({
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        micCode: instrument.micCode,
        provider: instrument.provider,
        start
      });

      if (series.bars.length > 0) {
        savePriceSeries(series);
        updated += 1;
      } else {
        failed.push({ symbol: instrument.symbol, error: "No price history was returned." });
      }
    } catch (error) {
      failed.push({
        symbol: instrument.symbol,
        error: error instanceof Error ? error.message : "History could not be loaded."
      });
    }
  }

  return {
    updated,
    failed,
    remaining: Math.max(0, pending.length - batch.length),
    upToDate: pending.length === 0
  };
}

/**
 * The closing price of an instrument on a given date.
 *
 * Markets are shut at weekends and on holidays, so an exact date often has no
 * bar of its own. The last close on or before it is returned instead, together
 * with the date it actually came from, because a price silently taken from a
 * different day is exactly the kind of detail a reader needs to be told about.
 *
 * The cache is consulted first and only extended when it cannot reach back far
 * enough, so repeatedly dating entries against the same instrument costs one
 * API credit rather than one per entry.
 */
export async function lookupHistoricalClose({
  symbol,
  exchange = "",
  micCode = "",
  provider = "",
  date
}) {
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return null;
  }

  const cached = getPriceSeries(symbol, exchange);
  const fromCache = closeOnOrBefore(cached?.bars ?? [], date);

  if (fromCache) {
    return { ...fromCache, requestedDate: date, fromCache: true };
  }

  // Either nothing is cached or the cache starts after the date asked for, so
  // the series is refetched from a little before it.
  const series = await fetchTimeSeries({
    symbol,
    exchange,
    micCode,
    provider,
    start: startBefore(date)
  });
  // Read the answer from the full response first: saving trims the series to
  // the cache's length limit, which could drop the very bar being looked up.
  const found = closeOnOrBefore(series.bars, date);

  if (series.bars.length > 0) {
    savePriceSeries(series);
  }

  return found ? { ...found, requestedDate: date, fromCache: false } : null;
}

function closeOnOrBefore(bars, date) {
  let found = null;

  for (const bar of bars) {
    if (bar.date > date) break;
    found = bar;
  }

  return found ? { close: found.close, date: found.date } : null;
}

function startBefore(date) {
  const start = new Date(`${date}T00:00:00`);
  start.setDate(start.getDate() - 10);
  return start.toISOString().slice(0, 10);
}

export function getBenchmarkSeries(symbol) {
  return symbol ? getPriceSeries(symbol, "") : null;
}

/** Earliest date worth asking the provider for, given what the ledger holds. */
export function earliestLedgerDate(transactions) {
  const dates = transactions.map((transaction) => transaction.date).filter(Boolean).sort();
  if (dates.length === 0) {
    return null;
  }

  // A little margin before the first trade so the chart does not start on a
  // vertical line from zero.
  const first = new Date(`${dates[0]}T00:00:00`);
  first.setDate(first.getDate() - 7);
  return first.toISOString().slice(0, 10);
}
