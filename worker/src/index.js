const TWELVE_DATA_URL = "https://api.twelvedata.com";
const YAHOO_FINANCE_URL = "https://query2.finance.yahoo.com";
const MAX_QUERY_LENGTH = 64;
const MAX_BATCH_SIZE = 8;
/** ~20 years of daily bars, which is more than the app ever charts. */
const MAX_SERIES_SIZE = 5000;
/** Daily bars change once a day, so a long cache costs nothing in accuracy. */
const SERIES_CACHE_SECONDS = 21_600;

/**
 * Yahoo's exchange suffixes for European listings. Twelve Data Basic remains
 * the US provider; every MIC listed here is sent straight to Yahoo instead.
 */
const YAHOO_SUFFIX_BY_MIC = {
  XAMS: ".AS",
  XATH: ".AT",
  XBER: ".BE",
  XBRU: ".BR",
  XBSE: ".RO",
  XBUD: ".BD",
  XCSE: ".CO",
  XDUB: ".IR",
  XDUS: ".DU",
  XETR: ".DE",
  XFRA: ".F",
  XHAM: ".HM",
  XHAN: ".HA",
  XHEL: ".HE",
  XICE: ".IC",
  XIST: ".IS",
  XLIS: ".LS",
  XLON: ".L",
  XMAD: ".MC",
  XMIL: ".MI",
  XMUN: ".MU",
  XOSL: ".OL",
  XPAR: ".PA",
  XPRA: ".PR",
  XSTO: ".ST",
  XSTU: ".SG",
  XSWX: ".SW",
  XWAR: ".WA",
  XWBO: ".VI"
};

const YAHOO_MARKET_BY_EXCHANGE = {
  AMS: { micCode: "XAMS", country: "Netherlands", currency: "EUR" },
  ATH: { micCode: "XATH", country: "Greece", currency: "EUR" },
  BER: { micCode: "XBER", country: "Germany", currency: "EUR" },
  BRU: { micCode: "XBRU", country: "Belgium", currency: "EUR" },
  BUD: { micCode: "XBUD", country: "Hungary", currency: "HUF" },
  CPH: { micCode: "XCSE", country: "Denmark", currency: "DKK" },
  EBS: { micCode: "XSWX", country: "Switzerland", currency: "CHF" },
  FRA: { micCode: "XFRA", country: "Germany", currency: "EUR" },
  GER: { micCode: "XETR", country: "Germany", currency: "EUR" },
  HEL: { micCode: "XHEL", country: "Finland", currency: "EUR" },
  ICE: { micCode: "XICE", country: "Iceland", currency: "ISK" },
  IST: { micCode: "XIST", country: "Turkey", currency: "TRY" },
  LIS: { micCode: "XLIS", country: "Portugal", currency: "EUR" },
  LSE: { micCode: "XLON", country: "United Kingdom", currency: "GBP" },
  MCE: { micCode: "XMAD", country: "Spain", currency: "EUR" },
  MIL: { micCode: "XMIL", country: "Italy", currency: "EUR" },
  OSL: { micCode: "XOSL", country: "Norway", currency: "NOK" },
  PAR: { micCode: "XPAR", country: "France", currency: "EUR" },
  PRA: { micCode: "XPRA", country: "Czech Republic", currency: "CZK" },
  STO: { micCode: "XSTO", country: "Sweden", currency: "SEK" },
  VIE: { micCode: "XWBO", country: "Austria", currency: "EUR" },
  WSE: { micCode: "XWAR", country: "Poland", currency: "PLN" }
};

const YAHOO_US_MARKET_BY_EXCHANGE = {
  ASE: { micCode: "XASE", exchange: "NYSE American" },
  BTS: { micCode: "BATS", exchange: "Cboe BZX" },
  NCM: { micCode: "XNAS", exchange: "NASDAQ" },
  NGM: { micCode: "XNAS", exchange: "NASDAQ" },
  NMS: { micCode: "XNAS", exchange: "NASDAQ" },
  NYQ: { micCode: "XNYS", exchange: "NYSE" },
  PCX: { micCode: "ARCX", exchange: "NYSE Arca" }
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return corsHeaders ? new Response(null, { status: 204, headers: corsHeaders }) : jsonError("Origin not allowed.", 403);
    }

    if (!corsHeaders && origin) {
      return jsonError("Origin not allowed.", 403);
    }

    if (!env.TWELVE_DATA_API_KEY) {
      return jsonError("Market data service is not configured.", 503, corsHeaders);
    }

    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/api/market/health") {
        return json({ ok: true, provider: "Twelve Data + Yahoo Finance" }, 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/market/search") {
        return await handleSearch(url, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/market/quote") {
        return await handleQuote(url, env, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/market/quotes") {
        return await handleQuotes(request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/market/exchange-rate") {
        return await handleExchangeRate(url, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/market/time-series") {
        return await handleTimeSeries(url, env, corsHeaders);
      }

      return jsonError("Not found.", 404, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected market data error.";
      return jsonError(message, error.status || 500, corsHeaders);
    }
  }
};

async function handleSearch(url, env, corsHeaders) {
  const query = cleanText(url.searchParams.get("q"), MAX_QUERY_LENGTH);
  if (query.length < 2) {
    return jsonError("Enter at least two characters.", 400, corsHeaders);
  }

  const upstream = new URL(`${TWELVE_DATA_URL}/symbol_search`);
  upstream.searchParams.set("symbol", query);
  upstream.searchParams.set("outputsize", "8");

  const yahooUpstream = new URL(`${YAHOO_FINANCE_URL}/v1/finance/search`);
  yahooUpstream.searchParams.set("q", query);
  yahooUpstream.searchParams.set("quotesCount", "8");
  yahooUpstream.searchParams.set("newsCount", "0");
  yahooUpstream.searchParams.set("enableFuzzyQuery", "false");

  const [twelveResult, yahooResult] = await Promise.allSettled([
    fetchProvider(upstream, env, 21_600),
    fetchYahooProvider(yahooUpstream, 21_600)
  ]);
  if (twelveResult.status === "rejected" && yahooResult.status === "rejected") {
    throw twelveResult.reason;
  }
  const payload = twelveResult.status === "fulfilled" ? twelveResult.value : {};
  const yahooPayload = yahooResult.status === "fulfilled" ? yahooResult.value : {};
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const twelveResults = rows
    .map((row) => {
      const micCode = cleanMicCode(row.mic_code);
      return {
        symbol: row.symbol || "",
        name: row.instrument_name || row.name || row.symbol || "",
        exchange: row.exchange || "",
        micCode,
        currency: row.currency || "",
        country: row.country || "",
        type: row.instrument_type || row.type || "",
        provider: providerForInstrument("", micCode)
      };
    })
    // European and BIST search results come from Yahoo itself, not Twelve Data.
    .filter((instrument) => instrument.provider === "twelve-data");
  const yahooResults = (Array.isArray(yahooPayload.quotes) ? yahooPayload.quotes : [])
    .map((row) => normalizeYahooSearchResult(row, { includeUs: twelveResult.status === "rejected" }))
    .filter(Boolean);
  const combined = deduplicateInstruments([...twelveResults, ...yahooResults]).slice(0, 12);

  return json(
    {
      data: combined,
      provider: "Twelve Data + Yahoo Finance"
    },
    200,
    corsHeaders
  );
}

async function handleQuote(url, env, corsHeaders) {
  const symbol = cleanSymbol(url.searchParams.get("symbol"));
  const exchange = cleanExchange(url.searchParams.get("exchange"));
  const micCode = cleanMicCode(url.searchParams.get("micCode"));
  const provider = providerForInstrument(cleanProvider(url.searchParams.get("provider")), micCode);
  if (!symbol) {
    return jsonError("A valid symbol is required.", 400, corsHeaders);
  }

  if (provider === "yahoo-finance") {
    const payload = await fetchYahooProvider(yahooChartUrl(symbol, micCode, { range: "5d" }), 60);
    return json(normalizeYahooQuote(payload, { symbol, exchange, micCode }), 200, corsHeaders);
  }

  try {
    const upstream = quoteUrl(symbol, exchange, micCode);
    const payload = await fetchProvider(upstream, env, 60);
    return json(normalizeQuote(payload), 200, corsHeaders);
  } catch {
    const payload = await fetchYahooProvider(yahooChartUrl(symbol, micCode, { range: "5d" }), 60);
    return json(
      normalizeYahooQuote(payload, { symbol, exchange, micCode }, { provider: "twelve-data" }),
      200,
      corsHeaders
    );
  }
}

async function handleQuotes(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  const instruments = Array.isArray(body?.instruments) ? body.instruments : [];

  if (instruments.length === 0 || instruments.length > MAX_BATCH_SIZE) {
    return jsonError(`Send between 1 and ${MAX_BATCH_SIZE} instruments.`, 400, corsHeaders);
  }

  const normalized = instruments.map((instrument) => ({
    symbol: cleanSymbol(instrument?.symbol),
    exchange: cleanExchange(instrument?.exchange),
    micCode: cleanMicCode(instrument?.micCode),
    provider: providerForInstrument(
      cleanProvider(instrument?.provider),
      cleanMicCode(instrument?.micCode)
    )
  }));

  if (normalized.some((instrument) => !instrument.symbol)) {
    return jsonError("Every instrument needs a valid symbol.", 400, corsHeaders);
  }

  const quotes = new Array(normalized.length);
  const yahooQueue = [];
  const twelveData = normalized
    .map((instrument, index) => ({ instrument, index }))
    .filter(({ instrument }) => instrument.provider === "twelve-data");

  if (twelveData.length > 0) {
    try {
      const upstream = new URL(`${TWELVE_DATA_URL}/quote`);
      upstream.searchParams.set(
        "symbol",
        twelveData
          .map(({ instrument }) => qualifiedSymbol(instrument.symbol, instrument.exchange))
          .join(",")
      );
      const payload = await fetchProvider(upstream, env, 60);
      const rows = normalizeBatchQuotes(
        payload,
        twelveData.map(({ instrument }) => instrument)
      );
      twelveData.forEach(({ instrument, index }, rowIndex) => {
        if (rows[rowIndex]?.error) {
          yahooQueue.push({ instrument, index, fallback: true });
        } else {
          quotes[index] = rows[rowIndex];
        }
      });
    } catch {
      yahooQueue.push(...twelveData.map(({ instrument, index }) => ({ instrument, index, fallback: true })));
    }
  }

  yahooQueue.push(
    ...normalized
      .map((instrument, index) => ({ instrument, index, fallback: false }))
      .filter(({ instrument }) => instrument.provider === "yahoo-finance")
  );

  await Promise.all(
    yahooQueue.map(async ({ instrument, index, fallback }) => {
      try {
        const payload = await fetchYahooProvider(
          yahooChartUrl(instrument.symbol, instrument.micCode, { range: "5d" }),
          60
        );
        quotes[index] = normalizeYahooQuote(
          payload,
          instrument,
          fallback ? { provider: "twelve-data" } : undefined
        );
      } catch (error) {
        quotes[index] = {
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          micCode: instrument.micCode,
          provider: fallback ? "twelve-data" : "yahoo-finance",
          sourceProvider: "yahoo-finance",
          error: error instanceof Error ? error.message : "Yahoo Finance quote unavailable."
        };
      }
    })
  );

  return json({ data: quotes, provider: "Twelve Data + Yahoo Finance" }, 200, corsHeaders);
}

async function handleExchangeRate(url, env, corsHeaders) {
  const from = cleanCurrency(url.searchParams.get("from"));
  const to = cleanCurrency(url.searchParams.get("to"));
  if (!from || !to) {
    return jsonError("Two valid currency codes are required.", 400, corsHeaders);
  }

  if (from === to) {
    return json({ rate: 1, updatedAt: new Date().toISOString(), provider: "Twelve Data" }, 200, corsHeaders);
  }

  try {
    const upstream = new URL(`${TWELVE_DATA_URL}/exchange_rate`);
    upstream.searchParams.set("symbol", `${from}/${to}`);
    const payload = await fetchProvider(upstream, env, 300);
    const rate = Number(payload.rate);

    if (!Number.isFinite(rate) || rate <= 0) {
      throw providerError(payload, 502);
    }

    return json(
      {
        rate,
        updatedAt: timestampToIso(payload.timestamp) || new Date().toISOString(),
        provider: "twelve-data"
      },
      200,
      corsHeaders
    );
  } catch {
    const payload = await fetchYahooProvider(
      yahooChartUrl(`${from}${to}=X`, "", { range: "5d" }),
      300
    );
    const quote = normalizeYahooQuote(payload, { symbol: `${from}/${to}`, exchange: "FX", micCode: "" });
    return json(
      {
        rate: quote.currentPrice,
        updatedAt: quote.priceUpdatedAt,
        provider: "twelve-data",
        sourceProvider: "yahoo-finance"
      },
      200,
      corsHeaders
    );
  }
}

/**
 * Daily closing prices for one instrument.
 *
 * The browser rebuilds a portfolio's value history from these plus the units it
 * knows were held on each date, so only the date and the close are returned —
 * open/high/low/volume would triple the payload for data no screen shows.
 */
async function handleTimeSeries(url, env, corsHeaders) {
  const symbol = cleanSymbol(url.searchParams.get("symbol"));
  const exchange = cleanExchange(url.searchParams.get("exchange"));
  const micCode = cleanMicCode(url.searchParams.get("micCode"));
  const provider = providerForInstrument(cleanProvider(url.searchParams.get("provider")), micCode);
  const startDate = cleanDate(url.searchParams.get("start"));
  const currencyPair = symbol.match(/^([A-Z]{3})\/([A-Z]{3})$/);

  if (!symbol) {
    return jsonError("A valid symbol is required.", 400, corsHeaders);
  }

  if (provider === "yahoo-finance") {
    const payload = await fetchYahooProvider(
      yahooChartUrl(
        currencyPair ? `${currencyPair[1]}${currencyPair[2]}=X` : symbol,
        micCode,
        { startDate: startDate || "2000-01-01" }
      ),
      SERIES_CACHE_SECONDS
    );
    return json(
      normalizeYahooTimeSeries(payload, { symbol, exchange, micCode }),
      200,
      corsHeaders
    );
  }

  try {
    const upstream = new URL(`${TWELVE_DATA_URL}/time_series`);
    upstream.searchParams.set("symbol", symbol);
    upstream.searchParams.set("interval", "1day");
    upstream.searchParams.set("outputsize", String(MAX_SERIES_SIZE));
    upstream.searchParams.set("order", "ASC");
    if (exchange) upstream.searchParams.set("exchange", exchange);
    if (micCode) upstream.searchParams.set("mic_code", micCode);
    if (startDate) upstream.searchParams.set("start_date", startDate);

    const payload = await fetchProvider(upstream, env, SERIES_CACHE_SECONDS);
    const values = Array.isArray(payload.values) ? payload.values : [];
    const bars = values
      .map((row) => ({ date: String(row.datetime ?? "").slice(0, 10), close: Number(row.close) }))
      .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && Number.isFinite(bar.close) && bar.close > 0)
      .sort((left, right) => left.date.localeCompare(right.date));

    if (bars.length === 0) {
      throw providerError(payload, 502);
    }

    return json(
      {
        symbol: payload.meta?.symbol || symbol,
        exchange: payload.meta?.exchange || exchange,
        currency: payload.meta?.currency || currencyPair?.[2] || "",
        bars,
        provider: "twelve-data"
      },
      200,
      corsHeaders
    );
  } catch {
    const payload = await fetchYahooProvider(
      yahooChartUrl(
        currencyPair ? `${currencyPair[1]}${currencyPair[2]}=X` : symbol,
        micCode,
        { startDate: startDate || "2000-01-01" }
      ),
      SERIES_CACHE_SECONDS
    );
    const series = normalizeYahooTimeSeries(payload, { symbol, exchange, micCode });
    return json(
      { ...series, provider: "twelve-data", sourceProvider: "yahoo-finance" },
      200,
      corsHeaders
    );
  }
}

async function fetchProvider(url, env, cacheSeconds) {
  const cacheKey = new Request(`https://firepath-market-cache.invalid${url.pathname}${url.search}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached.json();
  }

  const response = await fetch(url, {
    headers: { Authorization: `apikey ${env.TWELVE_DATA_API_KEY}` }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.status === "error" || payload.code) {
    throw providerError(payload, response.status || 502);
  }

  const cachedResponse = new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cacheSeconds}`
    }
  });
  await cache.put(cacheKey, cachedResponse);
  return payload;
}

async function fetchYahooProvider(url, cacheSeconds) {
  const cacheKey = new Request(`https://firepath-yahoo-cache.invalid${url.pathname}${url.search}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached.json();
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; FirePath/1.0)"
    }
  });
  const payload = await response.json().catch(() => ({}));
  const yahooError = payload?.chart?.error;

  if (!response.ok || yahooError) {
    throw providerError(
      {
        code: response.status,
        message: yahooError?.description || yahooError?.code || "Yahoo Finance returned an invalid response."
      },
      response.status || 502
    );
  }

  const cachedResponse = new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cacheSeconds}`
    }
  });
  await cache.put(cacheKey, cachedResponse);
  return payload;
}

function normalizeBatchQuotes(payload, instruments) {
  if (instruments.length === 1 && payload?.symbol) {
    try {
      return [normalizeQuote(payload)];
    } catch (error) {
      return [{
        symbol: instruments[0].symbol,
        exchange: instruments[0].exchange,
        error: error instanceof Error ? error.message : "No quote was returned for this instrument."
      }];
    }
  }

  return instruments.map((instrument) => {
    const qualified = qualifiedSymbol(instrument.symbol, instrument.exchange);
    const row =
      payload[qualified] ||
      payload[instrument.symbol] ||
      Object.values(payload).find(
        (candidate) =>
          candidate?.symbol === instrument.symbol &&
          (!instrument.exchange || candidate?.exchange === instrument.exchange)
      );

    if (!row || row.status === "error") {
      return {
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        error: row?.message || "No quote was returned for this instrument."
      };
    }
    try {
      return normalizeQuote(row);
    } catch (error) {
      return {
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        error: error instanceof Error ? error.message : "No quote was returned for this instrument."
      };
    }
  });
}

function normalizeQuote(payload) {
  const currentPrice = Number(payload.close ?? payload.price);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw providerError(payload, 502);
  }

  return {
    symbol: payload.symbol || "",
    name: payload.name || payload.symbol || "",
    exchange: payload.exchange || "",
    micCode: payload.mic_code || "",
    currency: payload.currency || "",
    type: payload.type || "",
    currentPrice,
    previousClose: finiteNumberOrNull(payload.previous_close),
    percentChange: finiteNumberOrNull(payload.percent_change),
    marketOpen: Boolean(payload.is_market_open),
    priceUpdatedAt:
      timestampToIso(payload.last_quote_at) ||
      timestampToIso(payload.timestamp) ||
      dateTimeToIso(payload.datetime) ||
      new Date().toISOString(),
    provider: "twelve-data"
  };
}

function normalizeYahooQuote(payload, instrument, { provider = "yahoo-finance" } = {}) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta || {};
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter((value) =>
    Number.isFinite(Number(value))
  );
  const currentPrice = Number(meta.regularMarketPrice ?? closes.at(-1));

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw providerError({ message: "Yahoo Finance returned no usable price." }, 502);
  }

  const previousClose = closes.length > 1 ? Number(closes.at(-2)) : Number(meta.chartPreviousClose);
  const regular = meta.currentTradingPeriod?.regular;
  const now = Math.floor(Date.now() / 1000);

  return {
    symbol: instrument.symbol,
    name: meta.longName || meta.shortName || instrument.symbol,
    exchange: instrument.exchange || meta.fullExchangeName || meta.exchangeName || "",
    micCode: instrument.micCode || "",
    currency: meta.currency || "",
    type: meta.instrumentType || "",
    currentPrice,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    percentChange:
      Number.isFinite(previousClose) && previousClose > 0
        ? ((currentPrice - previousClose) / previousClose) * 100
        : null,
    marketOpen: Boolean(regular && now >= Number(regular.start) && now <= Number(regular.end)),
    priceUpdatedAt: timestampToIso(meta.regularMarketTime) || new Date().toISOString(),
    provider,
    sourceProvider: "yahoo-finance"
  };
}

function normalizeYahooSearchResult(row, { includeUs = false } = {}) {
  const exchangeCode = String(row?.exchange || "").toUpperCase();
  const europeanMarket = YAHOO_MARKET_BY_EXCHANGE[exchangeCode];
  const usMarket = includeUs ? YAHOO_US_MARKET_BY_EXCHANGE[exchangeCode] : null;
  const market = europeanMarket || usMarket;
  const symbol = cleanSymbol(row?.symbol);
  if (!market || !symbol) return null;

  return {
    symbol,
    name: row.longname || row.shortname || symbol,
    exchange: market.exchange || row.exchDisp || row.exchange || "",
    micCode: market.micCode,
    currency: market.currency || "USD",
    country: market.country || "United States",
    type: row.typeDisp || row.quoteType || "",
    sector: row.sector || "",
    provider: europeanMarket ? "yahoo-finance" : "twelve-data",
    sourceProvider: "yahoo-finance"
  };
}

function deduplicateInstruments(instruments) {
  const seen = new Set();
  return instruments.filter((instrument) => {
    const key = `${instrument.provider}:${instrument.symbol}:${instrument.micCode}`;
    if (!instrument.symbol || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeYahooTimeSeries(payload, instrument) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta || {};
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close
    : [];
  const bars = timestamps
    .map((timestamp, index) => ({
      date: timestampToDate(timestamp),
      close: Number(closes[index])
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (bars.length === 0) {
    throw providerError({ message: "Yahoo Finance returned no price history." }, 502);
  }

  return {
    symbol: instrument.symbol,
    exchange: instrument.exchange || meta.fullExchangeName || meta.exchangeName || "",
    currency: meta.currency || "",
    bars,
    provider: "yahoo-finance"
  };
}

function quoteUrl(symbol, exchange, micCode = "") {
  const url = new URL(`${TWELVE_DATA_URL}/quote`);
  url.searchParams.set("symbol", symbol);
  if (exchange) url.searchParams.set("exchange", exchange);
  if (micCode) url.searchParams.set("mic_code", micCode);
  return url;
}

function yahooChartUrl(symbol, micCode, { range = "", startDate = "" } = {}) {
  const yahooSymbol = yahooSymbolFor(symbol, micCode);
  const url = new URL(`${YAHOO_FINANCE_URL}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
  url.searchParams.set("interval", "1d");

  if (range) {
    url.searchParams.set("range", range);
  } else {
    const start = Date.parse(`${startDate}T00:00:00Z`);
    url.searchParams.set("period1", String(Math.floor(start / 1000)));
    url.searchParams.set("period2", String(Math.floor(Date.now() / 1000) + 86_400));
  }
  return url;
}

function yahooSymbolFor(symbol, micCode) {
  const suffix = YAHOO_SUFFIX_BY_MIC[micCode] || "";
  return suffix && !symbol.endsWith(suffix) ? `${symbol}${suffix}` : symbol;
}

function providerForInstrument(requestedProvider, micCode) {
  if (YAHOO_SUFFIX_BY_MIC[micCode]) return "yahoo-finance";
  return requestedProvider === "yahoo-finance" ? "yahoo-finance" : "twelve-data";
}

function qualifiedSymbol(symbol, exchange) {
  return exchange ? `${symbol}:${exchange}` : symbol;
}

function buildCorsHeaders(origin, configuredOrigins = "") {
  const allowed = String(configuredOrigins)
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const normalizedOrigin = origin.replace(/\/$/, "");

  if (origin && !allowed.includes("*") && !allowed.includes(normalizedOrigin)) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : origin || allowed[0] || "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function providerError(payload, fallbackStatus) {
  const error = new Error(payload?.message || "Market data provider returned an invalid response.");
  const providerStatus = Number(payload?.code);
  // A provider-level 404 means that symbol/listing was unavailable. Keeping it
  // as HTTP 404 would make the browser mistake it for a missing Worker route
  // and tell the user to redeploy instead of showing the provider's message.
  const normalizedProviderStatus = providerStatus === 404 ? 502 : providerStatus;
  const normalizedFallbackStatus = fallbackStatus === 404 ? 502 : fallbackStatus;
  error.status =
    normalizedProviderStatus === 429 || normalizedFallbackStatus === 429
      ? 429
      : normalizedProviderStatus >= 400 && normalizedProviderStatus <= 599
        ? normalizedProviderStatus
        : normalizedFallbackStatus >= 400 && normalizedFallbackStatus <= 599
          ? normalizedFallbackStatus
          : 502;
  return error;
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanSymbol(value) {
  const symbol = cleanText(value, 32).toUpperCase();
  return /^[A-Z0-9./_-]+$/.test(symbol) ? symbol : "";
}

function cleanExchange(value) {
  const exchange = cleanText(value, 24).toUpperCase();
  return /^[A-Z0-9 ._-]*$/.test(exchange) ? exchange : "";
}

function cleanMicCode(value) {
  const micCode = cleanText(value, 4).toUpperCase();
  return /^[A-Z0-9]{4}$/.test(micCode) ? micCode : "";
}

function cleanProvider(value) {
  const provider = cleanText(value, 24).toLowerCase();
  return ["twelve-data", "yahoo-finance"].includes(provider) ? provider : "";
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function cleanCurrency(value) {
  const currency = cleanText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

function finiteNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampToIso(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp * 1000).toISOString();
}

function timestampToDate(value) {
  const iso = timestampToIso(value);
  return iso ? iso.slice(0, 10) : "";
}

function dateTimeToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function json(payload, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
  });
}

function jsonError(error, status = 400, corsHeaders = {}) {
  return json({ error }, status, corsHeaders || {});
}
