import { readJson, STORAGE_KEYS, writeJson } from "./storage.js";

const defaults = {
  apiBaseUrl: "https://firepath-market-data.sakkarakaya-firepath.workers.dev",
  benchmarkSymbol: "URTH"
};

export function getMarketDataSettings() {
  const saved = readJson(STORAGE_KEYS.marketData, defaults);
  return {
    apiBaseUrl: normalizeBaseUrl(saved?.apiBaseUrl),
    benchmarkSymbol: normalizeSymbol(saved?.benchmarkSymbol ?? defaults.benchmarkSymbol)
  };
}

export function saveMarketDataSettings(input) {
  const current = getMarketDataSettings();
  const apiBaseUrl = normalizeBaseUrl(input?.apiBaseUrl ?? current.apiBaseUrl);

  if (apiBaseUrl && !/^https?:\/\//i.test(apiBaseUrl)) {
    throw new Error("Market data URL must start with http:// or https://.");
  }

  const settings = {
    apiBaseUrl,
    benchmarkSymbol: normalizeSymbol(input?.benchmarkSymbol ?? current.benchmarkSymbol)
  };

  if (!writeJson(STORAGE_KEYS.marketData, settings)) {
    throw new Error("This browser refused to save the market data setting.");
  }
  return settings;
}

/** The index the portfolio is compared against. Empty turns the overlay off. */
export function saveBenchmarkSymbol(symbol) {
  return saveMarketDataSettings({ benchmarkSymbol: symbol });
}

function normalizeSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,16}$/.test(symbol) ? symbol : "";
}

export function marketDataIsConfigured() {
  return Boolean(getMarketDataSettings().apiBaseUrl);
}

function normalizeBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}
