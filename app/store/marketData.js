import { readJson, STORAGE_KEYS, writeJson } from "./storage.js";

const defaults = {
  apiBaseUrl: "https://firepath-market-data.sakkarakaya-firepath.workers.dev"
};

export function getMarketDataSettings() {
  const saved = readJson(STORAGE_KEYS.marketData, defaults);
  return {
    apiBaseUrl: normalizeBaseUrl(saved?.apiBaseUrl)
  };
}

export function saveMarketDataSettings(input) {
  const apiBaseUrl = normalizeBaseUrl(input?.apiBaseUrl);

  if (apiBaseUrl && !/^https?:\/\//i.test(apiBaseUrl)) {
    throw new Error("Market data URL must start with http:// or https://.");
  }

  const settings = { apiBaseUrl };
  if (!writeJson(STORAGE_KEYS.marketData, settings)) {
    throw new Error("This browser refused to save the market data setting.");
  }
  return settings;
}

export function marketDataIsConfigured() {
  return Boolean(getMarketDataSettings().apiBaseUrl);
}

function normalizeBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}
