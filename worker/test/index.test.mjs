import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import worker from "../src/index.js";

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const env = {
  TWELVE_DATA_API_KEY: "test-key",
  ALLOWED_ORIGINS: "http://localhost:4173"
};

beforeEach(() => {
  // Every test that needs the provider stubs this. Failing loudly here keeps a
  // test that forgot to from quietly spending real API credits.
  globalThis.fetch = async (request) => {
    throw new Error(`Unexpected upstream call to ${request}`);
  };

  globalThis.caches = {
    default: {
      match: async () => null,
      put: async () => undefined
    }
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
});

test("health confirms the configured provider without exposing its key", async () => {
  const response = await call("/api/market/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    provider: "Twelve Data + Yahoo Finance"
  });
});

test("search returns only the instrument fields the browser needs", async () => {
  globalThis.fetch = async (request, options) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      assert.match(String(request), /symbol_search\?symbol=Apple&outputsize=8/);
      assert.equal(options.headers.Authorization, "apikey test-key");
      return Response.json({
        data: [
          {
            symbol: "AAPL",
            instrument_name: "Apple Inc",
            exchange: "NASDAQ",
            mic_code: "XNAS",
            currency: "USD",
            country: "United States",
            instrument_type: "Common Stock"
          }
        ]
      });
    }

    assert.equal(url.hostname, "query2.finance.yahoo.com");
    assert.equal(url.pathname, "/v1/finance/search");
    assert.equal(url.searchParams.get("q"), "Apple");
    return Response.json({ quotes: [] });
  };

  const response = await call("/api/market/search?q=Apple");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data[0], {
    symbol: "AAPL",
    name: "Apple Inc",
    exchange: "NASDAQ",
    micCode: "XNAS",
    currency: "USD",
    country: "United States",
    type: "Common Stock",
    provider: "twelve-data"
  });
});

test("search marks European and Istanbul listings for Yahoo Finance", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      // These rows must be discarded: Europe/BIST search comes from Yahoo.
      return Response.json({
        data: [
          { symbol: "ASML", mic_code: "XAMS", country: "Netherlands" },
          { symbol: "THYAO", mic_code: "XIST", country: "Turkey" }
        ]
      });
    }

    return Response.json({
      quotes: [
        {
          symbol: "ASML.AS",
          longname: "ASML Holding N.V.",
          exchange: "AMS",
          exchDisp: "Amsterdam",
          quoteType: "EQUITY",
          typeDisp: "Equity"
        },
        {
          symbol: "THYAO.IS",
          longname: "Türk Hava Yollari Anonim Ortakligi",
          exchange: "IST",
          exchDisp: "Istanbul",
          quoteType: "EQUITY",
          typeDisp: "Equity"
        }
      ]
    });
  };

  const response = await call("/api/market/search?q=holding");
  const payload = await response.json();

  assert.equal(payload.data[0].provider, "yahoo-finance");
  assert.equal(payload.data[0].symbol, "ASML.AS");
  assert.equal(payload.data[0].micCode, "XAMS");
  assert.equal(payload.data[1].provider, "yahoo-finance");
  assert.equal(payload.data[1].symbol, "THYAO.IS");
  assert.equal(payload.data[1].micCode, "XIST");
});

test("an Amsterdam quote goes directly to Yahoo as ASML.AS", async () => {
  globalThis.fetch = async (request, options) => {
    const url = new URL(String(request));
    assert.equal(url.hostname, "query2.finance.yahoo.com");
    assert.equal(url.pathname, "/v8/finance/chart/ASML.AS");
    assert.equal(url.searchParams.get("range"), "5d");
    assert.equal(options.headers.Authorization, undefined);
    return Response.json(
      yahooChartPayload({
        symbol: "ASML.AS",
        currency: "EUR",
        exchangeName: "AMS",
        fullExchangeName: "Amsterdam",
        longName: "ASML Holding N.V.",
        closes: [1172.2, 1184.4]
      })
    );
  };

  const response = await call(
    "/api/market/quote?symbol=ASML&exchange=Euronext%20Amsterdam&micCode=XAMS"
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.symbol, "ASML");
  assert.equal(payload.micCode, "XAMS");
  assert.equal(payload.currency, "EUR");
  assert.equal(payload.currentPrice, 1184.4);
  assert.equal(payload.previousClose, 1172.2);
  assert.equal(payload.provider, "yahoo-finance");
});

test("a Borsa Istanbul quote goes directly to Yahoo as THYAO.IS", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    assert.equal(url.pathname, "/v8/finance/chart/THYAO.IS");
    return Response.json(
      yahooChartPayload({
        symbol: "THYAO.IS",
        currency: "TRY",
        exchangeName: "IST",
        fullExchangeName: "Istanbul",
        longName: "Türk Hava Yollari Anonim Ortakligi",
        closes: [308.75, 301.25]
      })
    );
  };

  const response = await call(
    "/api/market/quote?symbol=THYAO&exchange=Borsa%20Istanbul&micCode=XIST"
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.symbol, "THYAO");
  assert.equal(payload.currency, "TRY");
  assert.equal(payload.currentPrice, 301.25);
  assert.equal(payload.provider, "yahoo-finance");
});

test("provider failures remain readable by the browser instead of becoming a CORS error", async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        chart: {
          result: null,
          error: { code: "Forbidden", description: "Yahoo access was refused." }
        }
      },
      { status: 403 }
    );

  const response = await call(
    "/api/market/quote?symbol=ASML.AS&exchange=Amsterdam&micCode=XAMS"
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:4173");
  assert.deepEqual(await response.json(), {
    error: "Yahoo access was refused."
  });
});

test("a provider-level 404 is not confused with a missing Worker route", async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        chart: {
          result: null,
          error: { code: "Not Found", description: "No data is available for that listing." }
        }
      },
      { status: 404 }
    );

  const response = await call("/api/market/quote?symbol=ASML.AS&micCode=XAMS");

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:4173");
  assert.deepEqual(await response.json(), {
    error: "No data is available for that listing."
  });
});

test("a missing Twelve Data batch quote falls back to Yahoo in request order", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      assert.match(String(request), /symbol=AAPL%3ANASDAQ%2CMSFT%3ANASDAQ/);
      return Response.json({
        "AAPL:NASDAQ": {
          symbol: "AAPL",
          name: "Apple Inc",
          exchange: "NASDAQ",
          currency: "USD",
          close: "231.42",
          previous_close: "229.10",
          percent_change: "1.01",
          timestamp: 1_787_062_200,
          is_market_open: true
        },
        "MSFT:NASDAQ": { status: "error", message: "Quote unavailable" }
      });
    }

    assert.equal(url.pathname, "/v8/finance/chart/MSFT");
    return Response.json(
      yahooChartPayload({
        symbol: "MSFT",
        currency: "USD",
        exchangeName: "NMS",
        fullExchangeName: "NASDAQ",
        longName: "Microsoft Corporation",
        closes: [528.1, 530.5]
      })
    );
  };

  const response = await call("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruments: [
        { symbol: "AAPL", exchange: "NASDAQ" },
        { symbol: "MSFT", exchange: "NASDAQ" }
      ]
    })
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data[0].currentPrice, 231.42);
  assert.equal(payload.data[1].symbol, "MSFT");
  assert.equal(payload.data[1].currentPrice, 530.5);
  assert.equal(payload.data[1].provider, "twelve-data");
  assert.equal(payload.data[1].sourceProvider, "yahoo-finance");
});

test("a Twelve Data batch quota error immediately falls back to Yahoo for every quote", async () => {
  let calls = 0;
  globalThis.fetch = async (request) => {
    calls += 1;
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      return Response.json({ status: "error", code: 429, message: "Quota full" }, { status: 429 });
    }

    const symbol = url.pathname.endsWith("/AAPL") ? "AAPL" : "MSFT";
    return Response.json(
      yahooChartPayload({
        symbol,
        currency: "USD",
        exchangeName: "NMS",
        fullExchangeName: "NASDAQ",
        longName: symbol,
        closes: symbol === "AAPL" ? [229.1, 231.42] : [528.1, 530.5]
      })
    );
  };

  const response = await call("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruments: [
        { symbol: "AAPL", exchange: "NASDAQ", micCode: "XNAS" },
        { symbol: "MSFT", exchange: "NASDAQ", micCode: "XNAS" }
      ]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(
    payload.data.map((quote) => quote.currentPrice),
    [231.42, 530.5]
  );
  assert.ok(payload.data.every((quote) => quote.sourceProvider === "yahoo-finance"));
});

test("US search falls back to Yahoo when the Twelve Data quota is full", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      return Response.json({ status: "error", code: 429, message: "Quota full" }, { status: 429 });
    }
    return Response.json({
      quotes: [
        {
          symbol: "AAPL",
          longname: "Apple Inc.",
          exchange: "NMS",
          exchDisp: "NASDAQ",
          quoteType: "EQUITY",
          typeDisp: "Equity"
        }
      ]
    });
  };

  const response = await call("/api/market/search?q=Apple");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data[0].symbol, "AAPL");
  assert.equal(payload.data[0].provider, "twelve-data");
  assert.equal(payload.data[0].sourceProvider, "yahoo-finance");
});

test("a US quote falls back to Yahoo after a Twelve Data quota error", async () => {
  let calls = 0;
  globalThis.fetch = async (request) => {
    calls += 1;
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      return Response.json({ status: "error", code: 429, message: "Quota full" }, { status: 429 });
    }
    assert.equal(url.pathname, "/v8/finance/chart/AAPL");
    return Response.json(
      yahooChartPayload({
        symbol: "AAPL",
        currency: "USD",
        exchangeName: "NMS",
        fullExchangeName: "NASDAQ",
        longName: "Apple Inc.",
        closes: [229.1, 231.42]
      })
    );
  };

  const response = await call("/api/market/quote?symbol=AAPL&exchange=NASDAQ&micCode=XNAS");
  const payload = await response.json();

  assert.equal(calls, 2);
  assert.equal(response.status, 200);
  assert.equal(payload.currentPrice, 231.42);
  assert.equal(payload.provider, "twelve-data");
  assert.equal(payload.sourceProvider, "yahoo-finance");
});

test("a mixed quote refresh keeps US on Twelve Data and sends Europe to Yahoo", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      assert.equal(url.searchParams.get("symbol"), "AAPL:NASDAQ");
      return Response.json({
        symbol: "AAPL",
        exchange: "NASDAQ",
        currency: "USD",
        close: "231.42",
        previous_close: "229.10",
        timestamp: 1_787_062_200
      });
    }

    assert.equal(url.pathname, "/v8/finance/chart/ASML.AS");
    return Response.json(
      yahooChartPayload({
        symbol: "ASML.AS",
        currency: "EUR",
        exchangeName: "AMS",
        fullExchangeName: "Amsterdam",
        longName: "ASML Holding N.V.",
        closes: [1172.2, 1184.4]
      })
    );
  };

  const response = await call("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruments: [
        { symbol: "ASML", exchange: "Euronext Amsterdam", micCode: "XAMS" },
        { symbol: "AAPL", exchange: "NASDAQ", micCode: "XNAS" }
      ]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data[0].provider, "yahoo-finance");
  assert.equal(payload.data[0].currentPrice, 1184.4);
  assert.equal(payload.data[1].provider, "twelve-data");
  assert.equal(payload.data[1].currentPrice, 231.42);
});

test("time series returns sorted daily closes and nothing else", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    assert.equal(url.pathname, "/time_series");
    assert.equal(url.searchParams.get("interval"), "1day");
    assert.equal(url.searchParams.get("symbol"), "VWCE");
    assert.equal(url.searchParams.get("start_date"), "2024-01-01");

    return Response.json({
      meta: { symbol: "VWCE", currency: "EUR", exchange: "XETR" },
      // Deliberately out of order, with one unusable row: the worker is what
      // guarantees the browser gets a clean ascending series.
      values: [
        { datetime: "2024-01-03", close: "102.50" },
        { datetime: "2024-01-02", close: "101.00" },
        { datetime: "2024-01-04", close: "not-a-number" }
      ]
    });
  };

  const response = await call("/api/market/time-series?symbol=VWCE&start=2024-01-01");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.currency, "EUR");
  assert.deepEqual(payload.bars, [
    { date: "2024-01-02", close: 101 },
    { date: "2024-01-03", close: 102.5 }
  ]);
});

test("a US time series falls back to Yahoo when Twelve Data is unavailable", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      return Response.json({ status: "error", code: 429, message: "Quota full" }, { status: 429 });
    }
    assert.equal(url.pathname, "/v8/finance/chart/AAPL");
    return Response.json(
      yahooChartPayload({
        symbol: "AAPL",
        currency: "USD",
        exchangeName: "NMS",
        fullExchangeName: "NASDAQ",
        longName: "Apple Inc.",
        timestamps: [1704153600, 1704240000],
        closes: [185.2, 186.9]
      })
    );
  };

  const response = await call(
    "/api/market/time-series?symbol=AAPL&exchange=NASDAQ&micCode=XNAS&start=2024-01-01"
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.provider, "twelve-data");
  assert.equal(payload.sourceProvider, "yahoo-finance");
  assert.deepEqual(payload.bars, [
    { date: "2024-01-02", close: 185.2 },
    { date: "2024-01-03", close: 186.9 }
  ]);
});

test("an exchange rate falls back to Yahoo when Twelve Data is unavailable", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      return Response.json({ status: "error", code: 429, message: "Quota full" }, { status: 429 });
    }
    assert.equal(url.pathname, "/v8/finance/chart/USDEUR%3DX");
    return Response.json(
      yahooChartPayload({
        symbol: "USDEUR=X",
        currency: "EUR",
        exchangeName: "CCY",
        fullExchangeName: "FX",
        longName: "USD/EUR",
        closes: [0.85, 0.86]
      })
    );
  };

  const response = await call("/api/market/exchange-rate?from=USD&to=EUR");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.rate, 0.86);
  assert.equal(payload.provider, "twelve-data");
  assert.equal(payload.sourceProvider, "yahoo-finance");
});

test("historical exchange rates fall back to a Yahoo currency series", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.hostname === "api.twelvedata.com") {
      assert.equal(url.searchParams.get("symbol"), "USD/EUR");
      return Response.json({ status: "error", code: 429, message: "Quota full" }, { status: 429 });
    }
    assert.equal(url.pathname, "/v8/finance/chart/USDEUR%3DX");
    return Response.json(
      yahooChartPayload({
        symbol: "USDEUR=X",
        currency: "EUR",
        exchangeName: "CCY",
        fullExchangeName: "FX",
        longName: "USD/EUR",
        timestamps: [1704153600, 1704240000],
        closes: [0.85, 0.86]
      })
    );
  };

  const response = await call("/api/market/time-series?symbol=USD%2FEUR&start=2024-01-01");
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.symbol, "USD/EUR");
  assert.equal(payload.currency, "EUR");
  assert.deepEqual(payload.bars, [
    { date: "2024-01-02", close: 0.85 },
    { date: "2024-01-03", close: 0.86 }
  ]);
});

test("an international time series comes from Yahoo with the exchange suffix", async () => {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    assert.equal(url.hostname, "query2.finance.yahoo.com");
    assert.equal(url.pathname, "/v8/finance/chart/ASML.AS");
    assert.equal(url.searchParams.get("period1"), "1704067200");
    return Response.json(
      yahooChartPayload({
        symbol: "ASML.AS",
        currency: "EUR",
        exchangeName: "AMS",
        fullExchangeName: "Amsterdam",
        longName: "ASML Holding N.V.",
        timestamps: [1704153600, 1704240000],
        closes: [1172.2, 1184.4]
      })
    );
  };

  const response = await call(
    "/api/market/time-series?symbol=ASML&exchange=Euronext%20Amsterdam&micCode=XAMS&start=2024-01-01"
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.provider, "yahoo-finance");
  assert.deepEqual(payload.bars, [
    { date: "2024-01-02", close: 1172.2 },
    { date: "2024-01-03", close: 1184.4 }
  ]);
});

test("time series rejects a request with no usable symbol", async () => {
  const response = await call("/api/market/time-series?symbol=");
  assert.equal(response.status, 400);
});

test("an unlisted browser origin cannot consume the provider quota", async () => {
  const request = new Request("https://worker.example/api/market/health", {
    headers: { Origin: "https://untrusted.example" }
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 403);
});

function call(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Origin", "http://localhost:4173");
  return worker.fetch(new Request(`https://worker.example${path}`, { ...options, headers }), env);
}

function yahooChartPayload({
  symbol,
  currency,
  exchangeName,
  fullExchangeName,
  longName,
  timestamps = [1_787_000_000, 1_787_086_400],
  closes
}) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            currency,
            exchangeName,
            fullExchangeName,
            longName,
            instrumentType: "EQUITY",
            regularMarketPrice: closes.at(-1),
            regularMarketTime: timestamps.at(-1),
            currentTradingPeriod: {
              regular: { start: timestamps.at(-1) - 10_000, end: timestamps.at(-1) + 10_000 }
            }
          },
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] }
        }
      ],
      error: null
    }
  };
}
