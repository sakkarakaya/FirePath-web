import { readJson, STORAGE_KEYS, writeJson } from "./storage.js";

/**
 * Cached daily price bars.
 *
 * Fetching a multi-year series costs an API credit per instrument against a
 * small free quota, and daily bars only change once a day, so they are kept in
 * localStorage between visits. Bars are stored as `[date, close]` tuples: the
 * object form of the same data is roughly three times the size, and this cache
 * is the largest thing the app writes.
 */

/** ~6 years of trading days per instrument. */
const MAX_BARS = 1600;

/** Bounded so a long-lived portfolio cannot fill the storage quota. */
const MAX_SERIES = 32;

export function seriesKey(symbol, exchange = "") {
  const cleanSymbol = String(symbol ?? "").trim().toUpperCase();
  const cleanExchange = String(exchange ?? "").trim().toUpperCase();
  return cleanExchange ? `${cleanSymbol}:${cleanExchange}` : cleanSymbol;
}

export function readPriceSeries() {
  const stored = readJson(STORAGE_KEYS.priceSeries, {});
  return stored && typeof stored === "object" ? stored : {};
}

export function getPriceSeries(symbol, exchange) {
  const entry = readPriceSeries()[seriesKey(symbol, exchange)];
  return entry ? expandSeries(entry) : null;
}

/** Every cached series, expanded into `{ date, close }` bars. */
export function getAllPriceSeries() {
  const stored = readPriceSeries();
  return Object.fromEntries(
    Object.entries(stored).map(([key, entry]) => [key, expandSeries(entry)])
  );
}

export function savePriceSeries({ symbol, exchange, currency, bars }) {
  const stored = readPriceSeries();
  const key = seriesKey(symbol, exchange);

  stored[key] = {
    symbol: String(symbol ?? "").toUpperCase(),
    exchange: String(exchange ?? "").toUpperCase(),
    currency: String(currency ?? "").toUpperCase(),
    updatedAt: new Date().toISOString(),
    bars: bars
      .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
      .slice(-MAX_BARS)
      .map((bar) => [bar.date, bar.close])
  };

  writeJson(STORAGE_KEYS.priceSeries, evictOldest(stored, key));
}

export function removePriceSeries(symbol, exchange) {
  const stored = readPriceSeries();
  delete stored[seriesKey(symbol, exchange)];
  writeJson(STORAGE_KEYS.priceSeries, stored);
}

export function clearPriceSeries() {
  writeJson(STORAGE_KEYS.priceSeries, {});
}

/** Rough footprint of the cache, so the UI can be honest about what it costs. */
export function describePriceSeriesCache() {
  const stored = readPriceSeries();
  const entries = Object.values(stored);

  return {
    count: entries.length,
    bars: entries.reduce((total, entry) => total + entry.bars.length, 0),
    oldestUpdate: entries.reduce(
      (oldest, entry) => (oldest === null || entry.updatedAt < oldest ? entry.updatedAt : oldest),
      null
    ),
    approximateBytes: JSON.stringify(stored).length
  };
}

function expandSeries(entry) {
  return {
    symbol: entry.symbol,
    exchange: entry.exchange,
    currency: entry.currency,
    updatedAt: entry.updatedAt,
    bars: (Array.isArray(entry.bars) ? entry.bars : []).map(([date, close]) => ({ date, close }))
  };
}

/** Keeps the newest series; the one just written is never a candidate. */
function evictOldest(stored, protectedKey) {
  const keys = Object.keys(stored);

  if (keys.length <= MAX_SERIES) {
    return stored;
  }

  const ordered = keys
    .filter((key) => key !== protectedKey)
    .sort((left, right) => String(stored[left].updatedAt).localeCompare(String(stored[right].updatedAt)));

  ordered.slice(0, keys.length - MAX_SERIES).forEach((key) => delete stored[key]);
  return stored;
}
