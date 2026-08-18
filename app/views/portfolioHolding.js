import { assetTypes, currencyOptions, regions } from "../data/defaults.js";
import { getCurrencySymbol } from "../domain/formatters.js";
import { parsePositiveNumber } from "../domain/numberInput.js";
import {
  fetchExchangeRate,
  fetchExchangeRatesForHoldings,
  fetchMarketQuote,
  fetchMarketQuotes,
  marketCountryToRegion,
  marketInstrumentTypeToAssetType,
  searchMarketInstruments
} from "../domain/marketData.js";
import { lookupHistoricalClose } from "../domain/marketHistory.js";
import { marketDataIsConfigured } from "../store/marketData.js";
import {
  addHolding,
  addPortfolioTransaction,
  updateHolding,
  updateHoldingExchangeRates,
  updateHoldingPrices
} from "../store/store.js";
import { Button, Field, SegmentedControl, SelectField, StatusChip } from "../ui/components.js";
import { h } from "../ui/dom.js";
import { openModal, toast } from "../ui/feedback.js";

/**
 * Holding editor and market price refresh.
 *
 * Split out of the portfolio screens so those stay about presenting the
 * portfolio: this file owns everything that writes a holding, including the
 * Twelve Data search and quote plumbing behind the search field.
 */

const AUTO_REFRESH_AFTER_MS = 5 * 60 * 1000;

let pricesRefreshing = false;
let lastMarketRefreshAt = 0;

export function isRefreshingPrices() {
  return pricesRefreshing;
}

function requestRerender() {
  window.dispatchEvent(new CustomEvent("firepath:rerender"));
}

function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatPurchaseDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatQuoteTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

/**
 * Batch price editor shared by the portfolio header and each price cell.
 *
 * Manual and market-linked holdings deliberately live in the same dialog: a
 * mixed portfolio should not force the reader to remember two update paths.
 * Live quotes stay as drafts until Save, so one cancelled dialog never changes
 * only half of a portfolio.
 */
export function openPriceUpdateModal({ holdings, baseCurrency }) {
  if (!Array.isArray(holdings) || holdings.length === 0) return;

  const marketConnected = marketDataIsConfigured();
  const linkedCount = holdings.filter(isMarketLinked).length;
  const drafts = new Map(
    holdings.map((holding) => [
      holding.id,
      {
        value: String(holding.currentPrice),
        originalPrice: Number(holding.currentPrice),
        liveUpdate: null,
        error: ""
      }
    ])
  );
  let loading = false;
  let loadNote = "";
  let loadError = "";
  let pendingRates = {};

  const body = h("div", { class: "price-editor" });
  const modal = openModal({
    title: holdings.length === 1 ? `Update ${holdings[0].name} price` : "Update portfolio prices",
    description:
      linkedCount > 0
        ? "Edit any price manually, or load available market prices before saving everything together."
        : "Enter the latest prices and save the portfolio in one step.",
    size: "lg",
    content: body,
    actions: [
      Button({ variant: "ghost", onclick: () => modal.close() }, "Cancel"),
      Button(
        { variant: "primary", onclick: () => savePrices() },
        holdings.length === 1 ? "Save price" : "Save all prices"
      )
    ]
  });

  renderBody();

  function renderBody() {
    const loadedLiveCount = holdings.filter((holding) => drafts.get(holding.id)?.liveUpdate).length;
    const pendingLiveCount = linkedCount - loadedLiveCount;

    body.replaceChildren(
      ...[
        h("div", { class: "price-editor__toolbar" }, [
          h("div", { class: "price-editor__summary" }, [
            h("strong", {
              text: `${holdings.length} ${holdings.length === 1 ? "holding" : "holdings"}`
            }),
            h("span", {
              text:
                linkedCount > 0
                  ? `${linkedCount} market-linked · ${holdings.length - linkedCount} manual`
                  : "Manual prices"
            })
          ]),
          linkedCount > 0 && marketConnected
            ? Button(
                {
                  variant: "secondary",
                  size: "sm",
                  loading,
                  disabled: pendingLiveCount === 0,
                  onclick: () => loadLivePrices()
                },
                pendingLiveCount === 0
                  ? "Live prices ready"
                  : loadedLiveCount > 0
                    ? "Retry unavailable prices"
                    : "Load live prices"
              )
            : null
        ]),
        linkedCount > 0 && !marketConnected
          ? h("p", {
              class: "inline-note inline-note--watch",
              text: "Market data is not connected. You can update every price manually here, or connect it later in Settings."
            })
          : null,
        loadNote ? h("p", { class: "inline-note inline-note--good", text: loadNote }) : null,
        loadError ? h("p", { class: "inline-note inline-note--watch", role: "alert", text: loadError }) : null,
        h(
          "div",
          { class: "price-editor__list" },
          holdings.map((holding) => priceRow(holding, drafts.get(holding.id)))
        )
      ].filter(Boolean)
    );
  }

  function priceRow(holding, draft) {
    const linked = isMarketLinked(holding);
    const source = draft.liveUpdate ? "Live price loaded" : linked ? "Market linked" : "Manual price";
    const sourceLevel = draft.liveUpdate ? "good" : linked ? "neutral" : "watch";

    return h("article", { class: "price-editor__row" }, [
      h("div", { class: "price-editor__holding" }, [
        h("strong", { text: holding.name }),
        h("span", { text: [holding.ticker, holding.assetType].filter(Boolean).join(" · ") || "Holding" }),
        StatusChip({ label: source, level: sourceLevel, size: "sm" })
      ]),
      h("div", { class: "price-editor__old" }, [
        h("span", { text: "Saved price" }),
        h("strong", { text: `${holding.currentPrice} ${holding.currency}` })
      ]),
      h("div", { class: "price-editor__input" }, [
        Field({
          label: "New price",
          value: draft.value,
          inputMode: "decimal",
          suffix: holding.currency,
          error: draft.error,
          onInput: (value) => {
            draft.value = value;
            draft.error = "";
            if (draft.liveUpdate && parsePositiveNumber(value) !== Number(draft.liveUpdate.currentPrice)) {
              draft.liveUpdate = null;
            }
          }
        })
      ])
    ]);
  }

  async function loadLivePrices() {
    if (loading) return;
    const pendingHoldings = holdings.filter(
      (holding) => isMarketLinked(holding) && !drafts.get(holding.id)?.liveUpdate
    );
    if (pendingHoldings.length === 0) return;

    loading = true;
    loadNote = "";
    loadError = "";
    renderBody();

    try {
      const [quoteResult, rateResult] = await Promise.all([
        fetchLivePriceUpdates(pendingHoldings),
        fetchExchangeRatesForHoldings(holdings, baseCurrency).catch(() => ({ rates: {}, failed: [] }))
      ]);
      pendingRates = rateResult.rates;

      quoteResult.updates.forEach((update) => {
        const draft = drafts.get(update.id);
        if (!draft) return;
        draft.value = String(update.currentPrice);
        draft.liveUpdate = update;
        draft.error = "";
      });

      if (quoteResult.updates.length === 0) {
        throw new Error(quoteResult.failures[0]?.error || "No live prices could be loaded.");
      }

      const details = [
        `${quoteResult.updates.length} ${quoteResult.updates.length === 1 ? "price" : "prices"} ready to save`,
        quoteResult.failures.length > 0 ? `${quoteResult.failures.length} unavailable` : ""
      ]
        .filter(Boolean)
        .join(" · ");
      loadNote = `${details}. Review them, then save.`;
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Live prices could not be loaded.";
    } finally {
      loading = false;
      renderBody();
    }
  }

  function savePrices() {
    let invalid = false;
    const updates = [];

    holdings.forEach((holding) => {
      const draft = drafts.get(holding.id);
      const currentPrice = parsePositiveNumber(draft.value);

      if (currentPrice <= 0) {
        draft.error = "Enter a price greater than zero.";
        invalid = true;
        return;
      }

      if (!draft.liveUpdate && currentPrice === draft.originalPrice) return;

      updates.push(
        draft.liveUpdate
          ? { ...draft.liveUpdate, currentPrice }
          : {
              id: holding.id,
              currentPrice,
              previousClose: null,
              priceUpdatedAt: new Date().toISOString(),
              priceMarketOpen: false,
              marketSourceProvider: "manual",
              marketQuoteCurrency: holding.currency
            }
      );
    });

    if (invalid) {
      loadError = "Check the highlighted prices before saving.";
      renderBody();
      return;
    }

    if (updates.length === 0 && Object.keys(pendingRates).length === 0) {
      toast("No price changes to save.", { level: "info" });
      modal.close();
      return;
    }

    const rateCount =
      Object.keys(pendingRates).length > 0 ? updateHoldingExchangeRates(pendingRates) : 0;
    if (updates.length > 0) updateHoldingPrices(updates);

    const details =
      rateCount > 0
        ? ` · ${rateCount} ${rateCount === 1 ? "exchange rate" : "exchange rates"} updated`
        : "";
    toast(`${updates.length} ${updates.length === 1 ? "price" : "prices"} saved${details}.`);
    modal.close();
  }
}

/**
 * Add / edit holding.
 *
 * A modal keeps the user on the portfolio page so the list stays visible while
 * they type, which is the main advantage the web layout has over the mobile
 * push-screen equivalent.
 */
export function openHoldingModal({ currency, holding = null }) {
  const isEdit = holding !== null;
  const marketConnected = marketDataIsConfigured();
  // Quantity and average price are derived from the ledger once one exists, so
  // the fields that would contradict it are shown but not editable.
  const ledgerManaged = Boolean(holding?.ledgerManaged);
  const draft = {
    assetType: holding?.assetType ?? "ETF",
    name: holding?.name ?? "",
    ticker: holding?.ticker ?? "",
    quantity: holding ? String(holding.quantity) : "",
    averageBuyPrice: holding ? String(holding.averageBuyPrice) : "",
    currentPrice: holding ? String(holding.currentPrice) : "",
    currency: holding?.currency ?? currency,
    exchangeRateToBase: holding ? String(holding.exchangeRateToBase) : "1",
    region: holding?.region ?? "Global",
    sector: holding?.sector ?? "",
    marketProvider: holding?.marketProvider ?? "",
    marketSourceProvider: holding?.marketSourceProvider ?? holding?.marketProvider ?? "",
    marketSymbol: holding?.marketSymbol ?? "",
    marketExchange: holding?.marketExchange ?? "",
    marketMicCode: holding?.marketMicCode ?? "",
    previousClose: holding?.previousClose ?? null,
    purchaseDate: "",
    priceUpdatedAt: holding?.priceUpdatedAt ?? "",
    priceMarketOpen: Boolean(holding?.priceMarketOpen),
    searchQuery: ""
  };

  let error = "";
  let searchError = "";
  let searchResults = [];
  let searchTimer = null;
  let searchRequestId = 0;
  let quoteLoading = false;
  let marketLinkNote = "";
  let historicalPriceLoading = false;
  let historicalPriceNote = "";

  const body = h("div", { class: "stack" });

  const modal = openModal({
    title: isEdit ? `Edit ${holding.name}` : "Add holding",
    description: marketConnected
      ? "Search for a real instrument or enter the values manually."
      : "Values are entered manually and stay in this browser.",
    content: body,
    actions: [
      Button({ variant: "ghost", onclick: () => modal.close() }, "Cancel"),
      Button({ variant: "primary", onclick: () => save() }, isEdit ? "Save changes" : "Add holding")
    ]
  });

  renderBody();

  function renderBody() {
    body.replaceChildren(...[
      marketConnected ? MarketSearch() : null,
      SegmentedControl({
        options: assetTypes,
        value: draft.assetType,
        label: "Asset type",
        onChange: (value) => {
          draft.assetType = value;
          renderBody();
        }
      }),
      h("div", { class: "field-grid" }, [
        Field({
          label: "Name",
          value: draft.name,
          placeholder: "Your ETF, stock or cash account",
          onInput: (value) => {
            draft.name = value;
          }
        }),
        Field({
          label: "Ticker or ISIN",
          value: draft.ticker,
          placeholder: "Optional",
          onInput: (value) => {
            draft.ticker = value;
            if (value.trim().toUpperCase() !== draft.marketSymbol) {
              clearMarketLink();
            }
          }
        }),
        Field({
          label: "Quantity",
          value: draft.quantity,
          inputMode: "decimal",
          disabled: ledgerManaged,
          hint: ledgerManaged ? "Derived from this holding's transactions." : undefined,
          onInput: (value) => {
            draft.quantity = value;
          }
        }),
        Field({
          label: "Average buy price",
          value: draft.averageBuyPrice,
          inputMode: "decimal",
          disabled: ledgerManaged,
          hint: ledgerManaged ? "Cost basis of the units still open, fees included." : undefined,
          onInput: (value) => {
            draft.averageBuyPrice = value;
          }
        }),
        Field({
          label: "Current price",
          value: draft.currentPrice,
          inputMode: "decimal",
          onInput: (value) => {
            draft.currentPrice = value;
          }
        }),
        SelectField({
          label: "Currency",
          value: draft.currency,
          options: [...new Set([...currencyOptions, draft.currency])],
          getLabel: (code) => `${code} ${getCurrencySymbol(code)}`,
          onChange: (value) => {
            draft.currency = value;
            renderBody();
          }
        }),
        SelectField({
          label: "Region",
          value: draft.region,
          options: regions,
          onChange: (value) => {
            draft.region = value;
          }
        }),
        Field({
          label: "Sector",
          value: draft.sector,
          placeholder: "Optional",
          onInput: (value) => {
            draft.sector = value;
          }
        }),
        // Only on create: an existing holding's dates live in its ledger, and
        // editing them belongs on the Activity screen where every entry is.
        isEdit
          ? null
          : Field({
              label: "Purchase date",
              value: draft.purchaseDate,
              type: "date",
              max: todayISO(),
              hint: "Optional. Given a date, this is recorded as a dated buy, which is what lets returns, holding period and value history be computed.",
              onInput: (value) => {
                draft.purchaseDate = value;
                historicalPriceNote = "";
                renderBody();
              }
            })
      ].filter(Boolean)),
      isEdit ? null : HistoricalPriceRow(),
      draft.currency !== currency
        ? Field({
            label: `1 ${draft.currency} in ${currency}`,
            value: draft.exchangeRateToBase,
            inputMode: "decimal",
            hint: "Used to convert this holding into your base currency; adjust it manually if needed.",
            onInput: (value) => {
              draft.exchangeRateToBase = value;
            }
          })
        : null,
      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null
    ].filter(Boolean));
  }

  /**
   * Fills the buy price from the instrument's own close on the purchase date.
   *
   * Typing a years-old price from memory is the easiest way to put a wrong
   * number into every return that follows, so where the price is knowable the
   * app looks it up. It stays an offer rather than something automatic: a close
   * is not necessarily what was paid, and whoever knows their real fill price
   * should keep it.
   */
  function HistoricalPriceRow() {
    if (!draft.purchaseDate) {
      return null;
    }

    if (!draft.marketSymbol) {
      return h("p", {
        class: "inline-note",
        text: marketConnected
          ? "Search for the instrument above and its closing price on that date can be filled in for you."
          : "Connect market data in Settings and the price on that date can be filled in for you."
      });
    }

    return h("div", { class: "stack stack--tight" }, [
      h("div", { class: "row row--between" }, [
        h("span", {
          class: "muted",
          text: `Use ${draft.marketSymbol}'s closing price on ${formatPurchaseDate(draft.purchaseDate)}?`
        }),
        Button(
          {
            variant: "secondary",
            size: "sm",
            loading: historicalPriceLoading,
            onclick: () => fillHistoricalPrice()
          },
          "Use closing price"
        )
      ]),
      historicalPriceNote
        ? h("p", { class: "inline-note inline-note--good", text: historicalPriceNote })
        : null
    ]);
  }

  async function fillHistoricalPrice() {
    if (historicalPriceLoading || !draft.marketSymbol || !draft.purchaseDate) return;

    historicalPriceLoading = true;
    historicalPriceNote = "";
    error = "";
    renderBody();

    try {
      const found = await lookupHistoricalClose({
        symbol: draft.marketSymbol,
        exchange: draft.marketExchange,
        micCode: draft.marketMicCode,
        provider: draft.marketProvider,
        date: draft.purchaseDate
      });

      if (!found) {
        error = `No price is available for ${draft.marketSymbol} on or before ${formatPurchaseDate(
          draft.purchaseDate
        )}.`;
      } else {
        draft.averageBuyPrice = String(found.close);
        historicalPriceNote =
          found.date === found.requestedDate
            ? `Filled with the ${formatPurchaseDate(found.date)} close. That is the day's closing price, not necessarily what you paid.`
            : `No trading on ${formatPurchaseDate(found.requestedDate)}, so the ${formatPurchaseDate(
                found.date
              )} close was used. That is a closing price, not necessarily what you paid.`;
      }
    } catch (lookupError) {
      error =
        lookupError instanceof Error ? lookupError.message : "That price could not be looked up.";
    } finally {
      historicalPriceLoading = false;
      renderBody();
    }
  }

  function MarketSearch() {
    const resultsHost = h("div", { class: "market-search__results", "aria-live": "polite" });
    renderSearchResults(resultsHost);

    return h("section", { class: "market-search" }, [
      h("div", { class: "row row--between" }, [
        h("div", { class: "stack stack--tight" }, [
          h("strong", { text: "Find a real ETF or stock" }),
          h("span", { class: "muted", text: "Search by ticker, company or fund name." })
        ]),
        draft.marketSymbol
          ? StatusChip({
              label: draft.priceMarketOpen ? "Market open" : "Market linked",
              level: draft.priceMarketOpen ? "good" : "neutral"
            })
          : null
      ]),
      Field({
        label: "Instrument search",
        value: draft.searchQuery,
        placeholder: "e.g. AAPL, Vanguard S&P 500, VWCE",
        autocomplete: "off",
        onInput: (value) => scheduleSearch(value, resultsHost)
      }),
      resultsHost,
      draft.marketSymbol
        ? h("div", { class: "market-search__selected" }, [
            h("div", { class: "stack stack--tight" }, [
              h("strong", { text: `${draft.marketSymbol}${draft.marketExchange ? ` · ${draft.marketExchange}` : ""}` }),
              h("span", {
                class: "muted",
                text: draft.priceUpdatedAt
                  ? `${marketProviderLabel(draft.marketSourceProvider)} quote ${formatQuoteTime(draft.priceUpdatedAt)}`
                  : `Linked to ${marketProviderLabel(draft.marketProvider)}`
              })
            ]),
            Button(
              {
                variant: "ghost",
                size: "sm",
                loading: quoteLoading,
                onclick: () => updateSelectedQuote()
              },
              "Update quote"
            )
          ])
        : null,
      marketLinkNote
        ? h("p", { class: "inline-note", role: "status", text: marketLinkNote })
        : null
    ]);
  }

  function scheduleSearch(value, resultsHost) {
    draft.searchQuery = value;
    searchError = "";
    window.clearTimeout(searchTimer);
    const query = value.trim();

    if (query.length < 2) {
      searchResults = [];
      renderSearchResults(resultsHost);
      return;
    }

    resultsHost.replaceChildren(
      h("p", { class: "market-search__status" }, [
        h("span", { class: "spinner", "aria-hidden": "true" }),
        h("span", { text: "Searching instruments…" })
      ])
    );

    const requestId = ++searchRequestId;
    searchTimer = window.setTimeout(async () => {
      try {
        const results = await searchMarketInstruments(query);
        if (requestId !== searchRequestId || !document.body.contains(resultsHost)) return;
        searchResults = results;
      } catch (searchFailure) {
        if (requestId !== searchRequestId || !document.body.contains(resultsHost)) return;
        searchResults = [];
        searchError = searchFailure instanceof Error ? searchFailure.message : "Search failed.";
      }
      renderSearchResults(resultsHost);
    }, 450);
  }

  function renderSearchResults(resultsHost) {
    if (searchError) {
      resultsHost.replaceChildren(h("p", { class: "inline-error", role: "alert", text: searchError }));
      return;
    }

    if (!draft.searchQuery.trim()) {
      resultsHost.replaceChildren();
      return;
    }

    if (draft.searchQuery.trim().length >= 2 && searchResults.length === 0) {
      resultsHost.replaceChildren(h("p", { class: "market-search__status", text: "No matching instruments found." }));
      return;
    }

    resultsHost.replaceChildren(
      ...searchResults.map((instrument) =>
        h("button", {
          type: "button",
          class: "market-result",
          onclick: () => selectInstrument(instrument, resultsHost)
        }, [
          h("span", { class: "market-result__copy" }, [
            h("strong", { text: instrument.name }),
            h("span", {
              text: [instrument.symbol, instrument.exchange, instrument.country].filter(Boolean).join(" · ")
            })
          ]),
          h("span", {
            class: "market-result__type",
            text: `${instrument.type || "Security"} · ${marketProviderLabel(instrument.provider)}`
          })
        ])
      )
    );
  }

  async function selectInstrument(instrument, resultsHost) {
    resultsHost.replaceChildren(
      h("p", { class: "market-search__status" }, [
        h("span", { class: "spinner", "aria-hidden": "true" }),
        h("span", { text: `Loading ${instrument.symbol} quote…` })
      ])
    );

    const notes = [];
    let quote = null;

    try {
      quote = await fetchMarketQuote(instrument);
    } catch (quoteError) {
      const message = quoteError instanceof Error ? quoteError.message : "The quote could not be loaded.";
      notes.push(`Latest price unavailable: ${message} Enter the current price manually.`);
    }

    const instrumentCurrency = quote?.currency || instrument.currency || currency;
    let exchangeRate = instrumentCurrency === currency ? 1 : null;

    if (exchangeRate === null) {
      try {
        const conversion = await fetchExchangeRate(instrumentCurrency, currency);
        exchangeRate = conversion.rate;
      } catch {
        notes.push(`Enter the ${instrumentCurrency}/${currency} exchange rate manually.`);
      }
    }

    draft.assetType = marketInstrumentTypeToAssetType(quote?.type || instrument.type);
    draft.name = quote?.name || instrument.name;
    draft.ticker = quote?.symbol || instrument.symbol;
    draft.currentPrice = quote ? String(quote.currentPrice) : "";
    draft.currency = instrumentCurrency;
    draft.exchangeRateToBase = exchangeRate === null ? "" : String(exchangeRate);
    draft.region = marketCountryToRegion(instrument.country);
    draft.sector = instrument.sector || "";
    draft.marketProvider = instrument.provider || quote?.provider || "twelve-data";
    draft.marketSourceProvider = quote?.sourceProvider || quote?.provider || draft.marketProvider;
    draft.marketSymbol = quote?.symbol || instrument.symbol;
    draft.marketExchange = quote?.exchange || instrument.exchange || "";
    draft.marketMicCode = quote?.micCode || instrument.micCode || "";
    draft.previousClose = quote?.previousClose ?? null;
    draft.priceUpdatedAt = quote?.priceUpdatedAt || "";
    draft.priceMarketOpen = Boolean(quote?.marketOpen);
    draft.searchQuery = "";
    searchResults = [];
    searchError = "";
    marketLinkNote = notes.join(" ");
    renderBody();
  }

  async function updateSelectedQuote() {
    if (!draft.marketSymbol || quoteLoading) return;
    quoteLoading = true;
    renderBody();

    try {
      const quote = await fetchMarketQuote({
        symbol: draft.marketSymbol,
        exchange: draft.marketExchange,
        micCode: draft.marketMicCode,
        provider: draft.marketProvider
      });
      draft.currentPrice = String(quote.currentPrice);
      draft.previousClose = quote.previousClose ?? draft.previousClose;
      draft.priceUpdatedAt = quote.priceUpdatedAt;
      draft.priceMarketOpen = quote.marketOpen;
      draft.marketSourceProvider = quote.sourceProvider || quote.provider || draft.marketProvider;
      marketLinkNote = "";
      error = "";
    } catch (quoteError) {
      error = quoteError instanceof Error ? quoteError.message : "The quote could not be updated.";
    } finally {
      quoteLoading = false;
      renderBody();
    }
  }

  function clearMarketLink() {
    draft.marketProvider = "";
    draft.marketSourceProvider = "";
    draft.marketSymbol = "";
    draft.marketExchange = "";
    draft.marketMicCode = "";
    draft.previousClose = null;
    draft.priceUpdatedAt = "";
    draft.priceMarketOpen = false;
    marketLinkNote = "";
  }

  function save() {
    // A ledger-managed holding keeps whatever the ledger derived; the form
    // cannot write a quantity the transactions do not support.
    const quantity = ledgerManaged ? holding.quantity : parsePositiveNumber(draft.quantity);
    const currentPrice = parsePositiveNumber(draft.currentPrice);
    const averageBuyPrice = ledgerManaged
      ? holding.averageBuyPrice
      : parsePositiveNumber(draft.averageBuyPrice);
    const exchangeRateToBase =
      draft.currency === currency ? 1 : parsePositiveNumber(draft.exchangeRateToBase);

    if (!draft.name.trim() || quantity <= 0 || currentPrice <= 0 || exchangeRateToBase <= 0) {
      error = "Name, quantity, current price and a valid base exchange rate are required.";
      renderBody();
      return;
    }

    if (draft.purchaseDate && draft.purchaseDate > todayISO()) {
      error = "A purchase date cannot be in the future.";
      renderBody();
      return;
    }

    if (draft.purchaseDate && averageBuyPrice <= 0) {
      error = draft.marketSymbol
        ? "A dated purchase needs a buy price. Enter it, or use the closing price on that date."
        : "A dated purchase needs the price you paid per unit.";
      renderBody();
      return;
    }

    const input = {
      assetType: draft.assetType,
      name: draft.name.trim(),
      ticker: draft.ticker.trim().toUpperCase(),
      quantity,
      averageBuyPrice,
      currentPrice,
      currency: draft.currency.trim().toUpperCase() || "EUR",
      exchangeRateToBase,
      region: draft.region,
      sector: draft.sector.trim(),
      marketProvider: draft.marketProvider,
      marketSourceProvider: draft.marketSourceProvider,
      marketSymbol: draft.marketSymbol,
      marketExchange: draft.marketExchange,
      marketMicCode: draft.marketMicCode,
      previousClose: draft.previousClose,
      priceUpdatedAt: draft.priceUpdatedAt,
      priceMarketOpen: draft.priceMarketOpen
    };

    try {
      if (isEdit) {
        updateHolding(holding.id, input);
        toast(`${input.name} updated.`);
        modal.close();
        return;
      }

      const created = addHolding(input);

      if (draft.purchaseDate) {
        // A dated buy at the price the reader entered, not a synthetic opening
        // lot: this is a real trade they are telling us about, so it carries a
        // real date and a real price into every return the ledger computes.
        addPortfolioTransaction(
          {
            holdingId: created.id,
            type: "buy",
            date: draft.purchaseDate,
            quantity,
            price: averageBuyPrice,
            fee: 0,
            note: ""
          },
          // This buy is the position's origin, so there is no earlier manual
          // holding to preserve as an opening lot.
          { seedOpeningPosition: false }
        );
        toast(`${input.name} added, bought ${formatPurchaseDate(draft.purchaseDate)}.`);
      } else {
        toast(`${input.name} added to your portfolio.`);
      }

      modal.close();
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : "The holding could not be saved.";
      renderBody();
    }
  }
}

function marketProviderLabel(provider) {
  return provider === "yahoo-finance" ? "Yahoo Finance" : "Twelve Data";
}

function isMarketLinked(holding) {
  return Boolean(
    ["twelve-data", "yahoo-finance"].includes(holding.marketProvider) && holding.marketSymbol
  );
}

async function fetchLivePriceUpdates(holdings) {
  const result = await fetchMarketQuotes(holdings);
  const holdingsById = new Map(holdings.map((holding) => [holding.id, holding]));
  const conversionRequests = new Map();
  const failures = [];

  const converted = await Promise.all(
    result.quotes.map(async (quote) => {
      const holding = holdingsById.get(quote.holdingId);
      const rawPrice = Number(quote.currentPrice);

      if (!holding || quote.error || !Number.isFinite(rawPrice) || rawPrice <= 0) {
        failures.push({
          id: quote.holdingId,
          error: quote.error || `No usable price was returned for ${holding?.name || "a holding"}.`
        });
        return null;
      }

      try {
        const quoteCurrency = String(
          quote.currency || holding.marketQuoteCurrency || holding.currency || ""
        )
          .trim()
          .toUpperCase();
        const holdingCurrency = String(holding.currency ?? "").trim().toUpperCase();
        let conversion = 1;

        if (quoteCurrency && holdingCurrency && quoteCurrency !== holdingCurrency) {
          const pair = `${quoteCurrency}/${holdingCurrency}`;
          if (!conversionRequests.has(pair)) {
            conversionRequests.set(pair, fetchExchangeRate(quoteCurrency, holdingCurrency));
          }
          conversion = Number((await conversionRequests.get(pair)).rate);
        }

        if (!Number.isFinite(conversion) || conversion <= 0) {
          throw new Error("The quote currency could not be converted.");
        }

        return {
          id: quote.holdingId,
          currentPrice: rawPrice * conversion,
          previousClose: Number.isFinite(Number(quote.previousClose))
            ? Number(quote.previousClose) * conversion
            : null,
          priceUpdatedAt: quote.priceUpdatedAt || new Date().toISOString(),
          priceMarketOpen: Boolean(quote.marketOpen),
          marketSourceProvider: quote.sourceProvider || quote.provider,
          marketQuoteCurrency: quoteCurrency
        };
      } catch (error) {
        failures.push({
          id: quote.holdingId,
          error: error instanceof Error ? error.message : "The quote currency could not be converted."
        });
        return null;
      }
    })
  );

  return {
    updates: converted.filter(Boolean),
    failures
  };
}

export async function refreshPortfolioPrices(holdings, baseCurrency) {
  if (pricesRefreshing) return;
  pricesRefreshing = true;
  lastMarketRefreshAt = Date.now();
  requestRerender();

  try {
    // Rates first: a price in USD is only worth something in the base currency
    // once the rate behind it is current too.
    const rateResult = await refreshExchangeRates(holdings, baseCurrency);
    const result = await fetchLivePriceUpdates(holdings);

    if (result.updates.length === 0) {
      throw new Error(result.failures[0]?.error || "No prices could be refreshed.");
    }

    updateHoldingPrices(result.updates);

    const failed = result.failures.length;
    const extra = [
      rateResult.updated > 0
        ? `${rateResult.updated} ${rateResult.updated === 1 ? "rate" : "rates"} updated`
        : "",
      failed > 0 ? `${failed} failed` : ""
    ]
      .filter(Boolean)
      .join(" · ");
    toast(`${result.updates.length} ${result.updates.length === 1 ? "price" : "prices"} refreshed${extra ? ` · ${extra}` : ""}.`, {
      level: failed > 0 ? "info" : "success"
    });
  } catch (refreshError) {
    toast(refreshError instanceof Error ? refreshError.message : "Prices could not be refreshed.", {
      level: "error"
    });
  } finally {
    pricesRefreshing = false;
    requestRerender();
  }
}

/**
 * Quotes go stale while the page sits open, so a visit with stale prices
 * refreshes once in the background rather than showing yesterday's value.
 */
/**
 * Refreshes the base-currency rate of every foreign holding, market-linked or
 * not: a manually priced US stock converts through the same rate. A failure
 * here is reported but never blocks the price refresh that follows.
 */
async function refreshExchangeRates(holdings, baseCurrency) {
  if (!baseCurrency) {
    return { updated: 0, failed: [] };
  }

  try {
    const { rates, failed } = await fetchExchangeRatesForHoldings(holdings, baseCurrency);
    const updated = Object.keys(rates).length === 0 ? 0 : updateHoldingExchangeRates(rates);
    return { updated, failed };
  } catch {
    return { updated: 0, failed: [] };
  }
}

export function scheduleAutoRefresh(linkedHoldings, allHoldings, baseCurrency) {
  if (pricesRefreshing || linkedHoldings.length === 0) return;

  const now = Date.now();
  const hasStaleQuote = linkedHoldings.some((holding) => {
    const updatedAt = Date.parse(holding.priceUpdatedAt ?? "") || 0;
    return now - updatedAt >= AUTO_REFRESH_AFTER_MS;
  });

  if (!hasStaleQuote || now - lastMarketRefreshAt < AUTO_REFRESH_AFTER_MS) return;
  lastMarketRefreshAt = now;
  window.setTimeout(() => refreshPortfolioPrices(allHoldings, baseCurrency), 0);
}
