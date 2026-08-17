const TWELVE_DATA_URL = "https://api.twelvedata.com";
const MAX_QUERY_LENGTH = 64;
const MAX_BATCH_SIZE = 8;

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
        return json({ ok: true, provider: "Twelve Data" }, 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/market/search") {
        return handleSearch(url, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/market/quote") {
        return handleQuote(url, env, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/market/quotes") {
        return handleQuotes(request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/market/exchange-rate") {
        return handleExchangeRate(url, env, corsHeaders);
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

  const payload = await fetchProvider(upstream, env, 21_600);
  const rows = Array.isArray(payload.data) ? payload.data : [];

  return json(
    {
      data: rows.map((row) => ({
        symbol: row.symbol || "",
        name: row.instrument_name || row.name || row.symbol || "",
        exchange: row.exchange || "",
        micCode: row.mic_code || "",
        currency: row.currency || "",
        country: row.country || "",
        type: row.instrument_type || row.type || ""
      })),
      provider: "Twelve Data"
    },
    200,
    corsHeaders
  );
}

async function handleQuote(url, env, corsHeaders) {
  const symbol = cleanSymbol(url.searchParams.get("symbol"));
  const exchange = cleanExchange(url.searchParams.get("exchange"));
  if (!symbol) {
    return jsonError("A valid symbol is required.", 400, corsHeaders);
  }

  const upstream = quoteUrl(symbol, exchange);
  const payload = await fetchProvider(upstream, env, 60);
  return json(normalizeQuote(payload), 200, corsHeaders);
}

async function handleQuotes(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  const instruments = Array.isArray(body?.instruments) ? body.instruments : [];

  if (instruments.length === 0 || instruments.length > MAX_BATCH_SIZE) {
    return jsonError(`Send between 1 and ${MAX_BATCH_SIZE} instruments.`, 400, corsHeaders);
  }

  const normalized = instruments.map((instrument) => ({
    symbol: cleanSymbol(instrument?.symbol),
    exchange: cleanExchange(instrument?.exchange)
  }));

  if (normalized.some((instrument) => !instrument.symbol)) {
    return jsonError("Every instrument needs a valid symbol.", 400, corsHeaders);
  }

  const upstream = new URL(`${TWELVE_DATA_URL}/quote`);
  upstream.searchParams.set(
    "symbol",
    normalized.map((instrument) => qualifiedSymbol(instrument.symbol, instrument.exchange)).join(",")
  );

  const payload = await fetchProvider(upstream, env, 60);
  const quotes = normalizeBatchQuotes(payload, normalized);
  return json({ data: quotes, provider: "Twelve Data" }, 200, corsHeaders);
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
      provider: "Twelve Data"
    },
    200,
    corsHeaders
  );
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

function normalizeBatchQuotes(payload, instruments) {
  if (instruments.length === 1 && payload?.symbol) {
    return [normalizeQuote(payload)];
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
    return normalizeQuote(row);
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
    provider: "Twelve Data"
  };
}

function quoteUrl(symbol, exchange) {
  const url = new URL(`${TWELVE_DATA_URL}/quote`);
  url.searchParams.set("symbol", symbol);
  if (exchange) url.searchParams.set("exchange", exchange);
  return url;
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
  error.status =
    providerStatus === 429 || fallbackStatus === 429
      ? 429
      : providerStatus >= 400 && providerStatus <= 599
        ? providerStatus
        : fallbackStatus >= 400 && fallbackStatus <= 599
          ? fallbackStatus
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
