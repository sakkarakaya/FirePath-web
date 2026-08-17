import { getMarketDataSettings } from "../store/marketData.js";

const REQUEST_TIMEOUT_MS = 12_000;
export const MAX_QUOTES_PER_REFRESH = 8;

export async function checkMarketDataConnection() {
  return request("/api/market/health");
}

export async function searchMarketInstruments(query) {
  const normalized = String(query ?? "").trim();
  if (normalized.length < 2) {
    return [];
  }

  const result = await request(`/api/market/search?q=${encodeURIComponent(normalized)}`);
  return Array.isArray(result.data) ? result.data : [];
}

export async function fetchMarketQuote({ symbol, exchange }) {
  const params = new URLSearchParams({ symbol });
  if (exchange) {
    params.set("exchange", exchange);
  }
  return request(`/api/market/quote?${params.toString()}`);
}

export async function fetchExchangeRate(from, to) {
  if (!from || !to || from.toUpperCase() === to.toUpperCase()) {
    return { rate: 1, updatedAt: new Date().toISOString() };
  }

  const params = new URLSearchParams({ from: from.toUpperCase(), to: to.toUpperCase() });
  return request(`/api/market/exchange-rate?${params.toString()}`);
}

export async function fetchMarketQuotes(holdings) {
  const allLinked = holdings.filter(
    (holding) => holding.marketProvider === "twelve-data" && holding.marketSymbol
  );
  const linked = allLinked
    .sort((left, right) => {
      const leftTime = Date.parse(left.priceUpdatedAt ?? "") || 0;
      const rightTime = Date.parse(right.priceUpdatedAt ?? "") || 0;
      return leftTime - rightTime;
    })
    .slice(0, MAX_QUOTES_PER_REFRESH);

  if (linked.length === 0) {
    return { quotes: [], requested: 0, remaining: 0 };
  }

  const result = await request("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruments: linked.map((holding) => ({
        symbol: holding.marketSymbol,
        exchange: holding.marketExchange || ""
      }))
    })
  });

  const quotes = Array.isArray(result.data) ? result.data : [];
  return {
    quotes: quotes.map((quote, index) => ({ ...quote, holdingId: linked[index]?.id })),
    requested: linked.length,
    remaining: Math.max(0, allLinked.length - linked.length)
  };
}

export function marketInstrumentTypeToAssetType(type) {
  const normalized = String(type ?? "").toLowerCase();
  if (normalized.includes("etf") || normalized.includes("fund")) return "ETF";
  if (normalized.includes("bond")) return "Bond";
  if (normalized.includes("digital") || normalized.includes("crypto")) return "Crypto";
  if (normalized.includes("stock") || normalized.includes("equity") || normalized.includes("receipt")) {
    return "Stock";
  }
  return "Other";
}

export function marketCountryToRegion(country) {
  const normalized = String(country ?? "").toLowerCase();
  if (["united states", "usa", "us", "canada"].includes(normalized)) return "USA";
  if (
    [
      "germany",
      "france",
      "netherlands",
      "spain",
      "italy",
      "belgium",
      "austria",
      "switzerland",
      "united kingdom",
      "uk"
    ].includes(normalized)
  ) {
    return "Europe";
  }
  return normalized ? "Other" : "Global";
}

async function request(path, options = {}) {
  const { apiBaseUrl } = getMarketDataSettings();
  if (!apiBaseUrl) {
    throw new Error("Connect a market data service in Settings first.");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || marketDataErrorMessage(response.status));
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Market data request timed out. Try again.");
    }
    if (error instanceof TypeError) {
      throw new Error("Market data service could not be reached. Check its URL and allowed origins.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function marketDataErrorMessage(status) {
  if (status === 429) return "The free market data quota is temporarily full. Try again in a minute.";
  if (status === 403) return "This website is not allowed to use the configured market data service.";
  return "Market data could not be loaded right now.";
}
