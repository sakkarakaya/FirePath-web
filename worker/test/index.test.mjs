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
  assert.deepEqual(await response.json(), { ok: true, provider: "Twelve Data" });
});

test("search returns only the instrument fields the browser needs", async () => {
  globalThis.fetch = async (request, options) => {
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
    type: "Common Stock"
  });
});

test("batch quotes preserve request order and tolerate one missing quote", async () => {
  globalThis.fetch = async (request) => {
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
  assert.equal(payload.data[1].error, "Quote unavailable");
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
