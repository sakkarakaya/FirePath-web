import { getMarketDataSettings } from "../store/marketData.js";

const REQUEST_TIMEOUT_MS = 12_000;
export const MAX_QUOTES_PER_REQUEST = 8;

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

/**
 * Resolves imported ISINs/symbols to market instruments and replaces the CSV's
 * last execution price with a live quote. Closed positions are left alone: a
 * current quote cannot affect their portfolio value and resolving them would
 * consume provider quota for no benefit.
 *
 * Broker ledgers can be denominated in EUR while the primary listing is USD.
 * In that case the quote is converted back into the ledger currency so all
 * historical transactions and the current price stay comparable.
 */
export async function fetchCurrentPricesForImportedHoldings(
  holdings,
  {
    baseCurrency = "",
    concurrency = 4,
    onProgress,
    search = searchMarketInstruments,
    quote = fetchMarketQuote,
    exchangeRate = fetchExchangeRate
  } = {}
) {
  const source = Array.isArray(holdings) ? holdings : [];
  const openIndexes = source
    .map((holding, index) => ({ holding, index }))
    .filter(({ holding }) => Number(holding.quantity) > 1e-8);
  let resolved = [...source];
  const rateRequests = new Map();
  const cachedExchangeRate = (from, to) => {
    const pair = `${String(from).toUpperCase()}/${String(to).toUpperCase()}`;
    if (!rateRequests.has(pair)) {
      rateRequests.set(pair, exchangeRate(from, to));
    }
    return rateRequests.get(pair);
  };
  let cursor = 0;
  let completed = 0;
  let updated = 0;
  let failed = 0;

  const worker = async () => {
    while (cursor < openIndexes.length) {
      const entry = openIndexes[cursor];
      cursor += 1;

      try {
        const linked = await resolveImportedHolding(entry.holding, {
          search,
          quote,
          exchangeRate: cachedExchangeRate
        });
        if (linked) {
          resolved[entry.index] = linked;
          updated += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      } finally {
        completed += 1;
        onProgress?.({ completed, total: openIndexes.length, updated, failed });
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), openIndexes.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const normalizedBase = String(baseCurrency ?? "").trim().toUpperCase();
  const exchangeRateFailures = [];

  if (normalizedBase) {
    resolved = await Promise.all(
      resolved.map(async (holding) => {
        const currency = String(holding.currency ?? normalizedBase).trim().toUpperCase();
        if (currency === normalizedBase) {
          return { ...holding, exchangeRateToBase: 1 };
        }

        try {
          const rate = Number((await cachedExchangeRate(currency, normalizedBase)).rate);
          if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid exchange rate");
          return { ...holding, exchangeRateToBase: rate };
        } catch {
          if (!(Number(holding.exchangeRateToBase) > 0)) {
            exchangeRateFailures.push(currency);
          }
          return holding;
        }
      })
    );
  }

  return {
    holdings: resolved,
    updated,
    failed,
    skipped: source.length - openIndexes.length,
    exchangeRateFailures: [...new Set(exchangeRateFailures)]
  };
}

async function resolveImportedHolding(holding, { search, quote, exchangeRate }) {
  const primaryQuery = String(holding.ticker || holding.name || "").trim();
  let instruments = await search(primaryQuery);

  if (instruments.length === 0 && holding.name && holding.name !== primaryQuery) {
    instruments = await search(holding.name);
  }

  const candidates = rankImportCandidates(holding, instruments).slice(0, 2);
  for (const instrument of candidates) {
    try {
      const marketQuote = await quote(instrument);
      const currentPrice = Number(marketQuote?.currentPrice);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      const quoteCurrency = String(marketQuote.currency || instrument.currency || holding.currency)
        .trim()
        .toUpperCase();
      const holdingCurrency = String(holding.currency ?? "").trim().toUpperCase();
      const conversion =
        !quoteCurrency || quoteCurrency === holdingCurrency
          ? 1
          : Number((await exchangeRate(quoteCurrency, holdingCurrency)).rate);
      if (!Number.isFinite(conversion) || conversion <= 0) continue;

      const converted = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number * conversion : null;
      };

      return {
        ...holding,
        currentPrice: currentPrice * conversion,
        previousClose: converted(marketQuote.previousClose),
        marketProvider: instrument.provider || marketQuote.provider || "twelve-data",
        marketSourceProvider:
          marketQuote.sourceProvider || marketQuote.provider || instrument.provider || "twelve-data",
        marketSymbol: marketQuote.symbol || instrument.symbol,
        marketExchange: marketQuote.exchange || instrument.exchange || "",
        marketMicCode: marketQuote.micCode || instrument.micCode || "",
        marketQuoteCurrency: quoteCurrency || holdingCurrency,
        priceUpdatedAt: marketQuote.priceUpdatedAt || new Date().toISOString(),
        priceMarketOpen: Boolean(marketQuote.marketOpen)
      };
    } catch {
      // A secondary listing may work when the provider cannot quote the first.
    }
  }
  return null;
}

function rankImportCandidates(holding, instruments) {
  const holdingCurrency = String(holding.currency ?? "").trim().toUpperCase();
  const holdingTokens = nameTokens(holding.name);

  return [...instruments].sort((left, right) => score(right) - score(left));

  function score(instrument) {
    const currency = String(instrument.currency ?? "").trim().toUpperCase();
    const tokens = nameTokens(instrument.name);
    const commonTokens = [...holdingTokens].filter((token) => tokens.has(token)).length;
    const exactName = normalizeName(instrument.name) === normalizeName(holding.name);
    return (currency === holdingCurrency ? 50 : 0) + (exactName ? 200 : 0) + commonTokens * 20;
  }
}

function nameTokens(value) {
  return new Set(normalizeName(value).split(" ").filter((token) => token.length > 2));
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function fetchMarketQuote({ symbol, exchange, micCode, provider }) {
  const params = new URLSearchParams({ symbol });
  if (exchange) {
    params.set("exchange", exchange);
  }
  if (micCode) {
    params.set("micCode", micCode);
  }
  if (provider) {
    params.set("provider", provider);
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

/**
 * Latest rate for every foreign currency the holdings use. Failures are
 * reported per currency rather than aborting: one unavailable pair should not
 * stop the rest of a refresh.
 */
export async function fetchExchangeRatesForHoldings(holdings, baseCurrency) {
  const base = String(baseCurrency ?? "").trim().toUpperCase();
  const currencies = [
    ...new Set(
      holdings
        .map((holding) => String(holding.currency ?? "").trim().toUpperCase())
        .filter((currency) => currency.length === 3 && currency !== base)
    )
  ];

  if (currencies.length === 0 || !base) {
    return { rates: {}, failed: [] };
  }

  const results = await Promise.allSettled(
    currencies.map((currency) => fetchExchangeRate(currency, base))
  );

  const rates = {};
  const failed = [];

  results.forEach((result, index) => {
    const rate = result.status === "fulfilled" ? Number(result.value?.rate) : Number.NaN;

    if (Number.isFinite(rate) && rate > 0) {
      rates[currencies[index]] = rate;
    } else {
      failed.push(currencies[index]);
    }
  });

  return { rates, failed };
}

/** Daily closes for one instrument, oldest first. */
export async function fetchTimeSeries({ symbol, exchange, micCode, provider, start }) {
  const params = new URLSearchParams({ symbol });
  if (exchange) params.set("exchange", exchange);
  if (micCode) params.set("micCode", micCode);
  if (provider) params.set("provider", provider);
  if (start) params.set("start", start);

  const payload = await request(`/api/market/time-series?${params.toString()}`);
  return {
    symbol: payload.symbol ?? symbol,
    exchange: payload.exchange ?? exchange ?? "",
    currency: payload.currency ?? "",
    bars: Array.isArray(payload.bars) ? payload.bars : []
  };
}

export async function fetchMarketQuotes(holdings, { fetchBatch = fetchQuoteBatch } = {}) {
  const linked = holdings.filter(
    (holding) =>
      ["twelve-data", "yahoo-finance"].includes(holding.marketProvider) && holding.marketSymbol
  )
    .sort((left, right) => {
      const leftTime = Date.parse(left.priceUpdatedAt ?? "") || 0;
      const rightTime = Date.parse(right.priceUpdatedAt ?? "") || 0;
      return leftTime - rightTime;
    });

  if (linked.length === 0) {
    return { quotes: [], requested: 0, remaining: 0 };
  }

  const batches = [];
  for (let index = 0; index < linked.length; index += MAX_QUOTES_PER_REQUEST) {
    batches.push(linked.slice(index, index + MAX_QUOTES_PER_REQUEST));
  }

  // The Worker accepts eight symbols per request because that is Twelve
  // Data's batch size. Send every batch now: if Twelve Data has no credits,
  // the Worker immediately resolves that batch through Yahoo Finance instead
  // of making the reader wait for another refresh cycle.
  const results = await Promise.all(
    batches.map(async (batch) => {
      try {
        const result = await fetchBatch(
          batch.map((holding) => ({
            symbol: holding.marketSymbol,
            exchange: holding.marketExchange || "",
            micCode: holding.marketMicCode || "",
            provider: holding.marketProvider
          }))
        );
        const quotes = Array.isArray(result?.data) ? result.data : [];
        return batch.map((holding, index) => ({
          ...(quotes[index] || { error: `No price was returned for ${holding.name}.` }),
          holdingId: holding.id
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Market prices could not be loaded.";
        return batch.map((holding) => ({
          holdingId: holding.id,
          symbol: holding.marketSymbol,
          error: message
        }));
      }
    })
  );

  return {
    quotes: results.flat(),
    requested: linked.length,
    remaining: 0
  };
}

async function fetchQuoteBatch(instruments) {
  return request("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruments })
  });
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
      "uk",
      "ireland",
      "portugal",
      "denmark",
      "sweden",
      "norway",
      "finland",
      "iceland",
      "poland",
      "czech republic",
      "greece",
      "romania",
      "hungary",
      "turkey",
      "türkiye"
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
      // The worker's own "Not found." says nothing useful to a reader: a 404
      // from a service that is otherwise answering means the deployed worker is
      // older than this app and does not have the route yet.
      throw new Error(
        response.status === 404 ? marketDataErrorMessage(404) : payload.error || marketDataErrorMessage(response.status)
      );
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
  if (status === 429) {
    return "Twelve Data quota is full and the immediate Yahoo Finance fallback was unavailable.";
  }
  if (status === 403) return "This website is not allowed to use the configured market data service.";
  if (status === 404) {
    return "The market data service does not offer this yet. Its deployed version is older than this app — redeploy the worker to enable it.";
  }
  return "Market data could not be loaded right now.";
}
