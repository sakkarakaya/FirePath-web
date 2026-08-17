import { assetTypes, currencyOptions, regions } from "../data/defaults.js";
import { formatCurrency, formatPercent, getCurrencySymbol } from "../domain/formatters.js";
import { parsePositiveNumber } from "../domain/numberInput.js";
import {
  fetchExchangeRate,
  fetchMarketQuote,
  fetchMarketQuotes,
  marketCountryToRegion,
  marketInstrumentTypeToAssetType,
  searchMarketInstruments
} from "../domain/marketData.js";
import {
  buildHoldingBreakdown,
  calculateAllocation,
  calculatePortfolioHealth,
  calculatePortfolioSummary,
  describePortfolioSource,
  describeUntrackedInvestments
} from "../domain/portfolioCalculations.js";
import { marketDataIsConfigured } from "../store/marketData.js";
import {
  addHolding,
  getState,
  removeHolding,
  selectFireMetrics,
  updateHolding,
  updateHoldingPrices
} from "../store/store.js";
import {
  AllocationBar,
  Button,
  Card,
  EmptyState,
  Field,
  MetricCard,
  SectionHeader,
  SegmentedControl,
  SelectField,
  StatusChip
} from "../ui/components.js";
import { h } from "../ui/dom.js";
import { confirmAction, openModal, toast } from "../ui/feedback.js";

/**
 * Portfolio.
 *
 * Holdings are a manually kept list, so this screen is explicit that its total
 * can differ from the invested figure saved on the profile — the dashboard
 * counts the larger of the two and this page says so rather than looking wrong.
 */

const allocationKeys = ["assetType", "region", "currency"];
const allocationLabels = { assetType: "Asset type", region: "Region", currency: "Currency" };
const AUTO_REFRESH_AFTER_MS = 5 * 60 * 1000;

let allocationKey = "assetType";
let pricesRefreshing = false;
let lastMarketRefreshAt = 0;

function requestRerender() {
  window.dispatchEvent(new CustomEvent("firepath:rerender"));
}

export function PortfolioView() {
  const { profile, holdings } = getState();
  const metrics = selectFireMetrics();
  const currency = profile?.currency ?? "EUR";

  const summary = calculatePortfolioSummary(holdings);
  const breakdown = buildHoldingBreakdown(holdings);
  const signals = calculatePortfolioHealth(holdings, currency);
  const untrackedNote = describeUntrackedInvestments(metrics.portfolioCoverage, currency);
  const gainLevel = summary.unrealizedGainLoss >= 0 ? "good" : "risk";
  const marketConnected = marketDataIsConfigured();
  const linkedHoldings = holdings.filter((holding) => holding.marketProvider && holding.marketSymbol);
  scheduleAutoRefresh(marketConnected ? linkedHoldings : []);

  return h("div", { class: "view" }, [
    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: "Portfolio" }),
        h("h1", { class: "page-header__title", text: "What you hold" }),
        h("p", {
          class: "page-header__description",
          text: describePortfolioSource(metrics.portfolioCoverage, holdings.length, currency)
        })
      ]),
      h("div", { class: "page-header__actions" }, [
        marketConnected && linkedHoldings.length > 0
          ? Button(
              {
                variant: "secondary",
                loading: pricesRefreshing,
                onclick: () => refreshPortfolioPrices(holdings)
              },
              "Refresh prices"
            )
          : null,
        Button({ to: "/settings/import", variant: "ghost" }, "Import CSV"),
        Button({ variant: "primary", onclick: () => openHoldingModal({ currency }) }, "Add holding")
      ])
    ]),

    Card({}, [
      h("div", { class: "hero" }, [
        h("div", { class: "hero__copy" }, [
          h("p", { class: "eyebrow", text: "Tracked value" }),
          h("strong", {
            class: "hero__value",
            text: formatCurrency(summary.totalPortfolioValue, currency)
          }),
          h("div", { class: "row" }, [
            StatusChip({
              label: `${summary.unrealizedGainLoss >= 0 ? "+" : ""}${formatCurrency(
                summary.unrealizedGainLoss,
                currency
              )}`,
              level: gainLevel
            }),
            StatusChip({ label: formatPercent(summary.gainLossPercentage, 1), level: gainLevel })
          ])
        ])
      ]),
      h("div", { class: "grid grid--3" }, [
        MetricCard({ label: "Invested", value: formatCurrency(summary.totalInvestedAmount, currency) }),
        MetricCard({ label: "Holdings", value: String(holdings.length) }),
        MetricCard({
          label: "Counted in FIRE",
          value: formatCurrency(metrics.portfolioCoverage.totalValue, currency),
          hint: "Larger of tracked holdings and your saved total"
        })
      ]),
      untrackedNote && h("p", { class: "inline-note inline-note--watch", text: untrackedNote }),
      linkedHoldings.length > 0
        ? h("p", {
            class: "inline-note inline-note--good",
            text: `${linkedHoldings.length} ${linkedHoldings.length === 1 ? "holding uses" : "holdings use"} market prices. Stale quotes refresh when you open this page; prices are not broker execution prices.`
          })
        : marketConnected
          ? h("p", {
              class: "inline-note",
              text: "Market data is configured. Search for a real ETF or stock when you add a holding."
            })
          : h("p", {
              class: "inline-note",
              text: "Live market data is optional. Connect it in Settings, or keep entering prices manually."
            })
    ]),

    h("div", { class: "grid grid--sidebar" }, [
      HoldingsCard({ breakdown, currency }),
      h("div", { class: "stack" }, [
        AllocationCard({ holdings, currency }),
        signals.length > 0 ? SignalsCard({ signals }) : null
      ])
    ])
  ]);
}

function HoldingsCard({ breakdown, currency }) {
  if (breakdown.length === 0) {
    return Card({}, [
      SectionHeader({ eyebrow: "Holdings", title: "Your positions" }),
      EmptyState({
        icon: "◫",
        title: "No holdings tracked yet",
        description:
          "Search for a market-listed instrument, add a position manually or import a CSV export. FirePath never connects to your broker.",
        action: Button({ variant: "primary", onclick: () => openHoldingModal({ currency }) }, "Add holding")
      })
    ]);
  }

  return Card({ class: "card--flush" }, [
    h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [
      SectionHeader({
        eyebrow: "Holdings",
        title: `${breakdown.length} ${breakdown.length === 1 ? "position" : "positions"}`,
        description: "Largest position first."
      })
    ]),
    h("div", { class: "table-scroll" }, [
      h("table", { class: "table" }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { scope: "col", text: "Holding" }),
            h("th", { scope: "col", text: "Value" }),
            h("th", { scope: "col", text: "Gain / loss" }),
            h("th", { scope: "col", text: "Share" }),
            // aria-label rather than a visually-hidden span: that span is
            // absolutely positioned, and inside a horizontally scrollable table
            // it escapes the scroll container and widens the whole document.
            h("th", { scope: "col", "aria-label": "Actions" })
          ])
        ]),
        h(
          "tbody",
          {},
          breakdown.map((entry) => HoldingRow({ entry, currency }))
        )
      ])
    ])
  ]);
}

function HoldingRow({ entry, currency }) {
  const { holding } = entry;
  const gainClass = entry.gainLoss >= 0 ? "value-up" : "value-down";
  const quoteLabel = holding.marketProvider
    ? holding.priceUpdatedAt
      ? `Quote ${formatQuoteTime(holding.priceUpdatedAt)}`
      : "Market linked"
    : "Manual price";
  const subtitle = [holding.assetType, holding.ticker, holding.region, quoteLabel].filter(Boolean).join(" · ");

  return h("tr", {}, [
    h("td", {}, [
      h("div", { class: "table__name" }, [
        h("strong", { text: holding.name }),
        h("span", { text: subtitle })
      ])
    ]),
    h("td", { text: formatCurrency(entry.value, currency) }),
    h("td", { class: gainClass }, [
      h("span", {
        text: `${entry.gainLoss >= 0 ? "+" : ""}${formatCurrency(entry.gainLoss, currency)}${
          entry.gainLossPercentage === null ? "" : ` (${formatPercent(entry.gainLossPercentage, 1)})`
        }`
      })
    ]),
    h("td", { text: formatPercent(entry.share) }),
    h("td", {}, [
      h("div", { class: "table__actions" }, [
        h("button", {
          type: "button",
          class: "icon-button",
          "aria-label": `Edit ${holding.name}`,
          title: "Edit",
          text: "✎",
          onclick: () => openHoldingModal({ currency, holding })
        }),
        h("button", {
          type: "button",
          class: "icon-button icon-button--danger",
          "aria-label": `Delete ${holding.name}`,
          title: "Delete",
          text: "×",
          onclick: async () => {
            const confirmed = await confirmAction({
              title: `Delete ${holding.name}?`,
              description: "This removes the holding from this browser. Your saved totals stay unchanged.",
              confirmLabel: "Delete holding"
            });

            if (confirmed) {
              removeHolding(holding.id);
              toast("Holding deleted.", { level: "info" });
            }
          }
        })
      ])
    ])
  ]);
}

function AllocationCard({ holdings, currency }) {
  const slices = calculateAllocation(holdings, allocationKey);

  return Card({}, [
    SectionHeader({ eyebrow: "Allocation", title: "How it splits" }),
    SegmentedControl({
      options: allocationKeys,
      value: allocationKey,
      getLabel: (key) => allocationLabels[key],
      label: "Group allocation by",
      onChange: (key) => {
        allocationKey = key;
        requestRerender();
      }
    }),
    slices.length === 0
      ? EmptyState({
          icon: "◔",
          title: "Nothing to split yet",
          description: "Allocation appears once you track at least one holding."
        })
      : AllocationBar({
          slices,
          formatValue: (slice) =>
            `${formatPercent(slice.percentage)} · ${formatCurrency(slice.value, currency)}`
        })
  ]);
}

/**
 * Neutral, descriptive signals. These say what the portfolio looks like so the
 * reader can compare it against their own plan — never whether to buy or sell.
 */
function SignalsCard({ signals }) {
  return Card({}, [
    SectionHeader({
      eyebrow: "Signals",
      title: "What this looks like",
      description: "Descriptive only. FirePath does not rate holdings or suggest trades."
    }),
    h(
      "div",
      { class: "stack" },
      signals.map((signal) =>
        h("article", { class: "stack stack--tight" }, [
          h("div", { class: "row row--between" }, [
            h("h3", { class: "section-header__title", text: signal.label }),
            StatusChip({
              label: formatPercent(signal.percentage),
              level: signal.emphasis === "notable" ? "watch" : "neutral"
            })
          ]),
          h("p", { class: "muted", text: signal.headline }),
          h("p", { class: "muted", text: signal.detail })
        ])
      )
    )
  ]);
}

/**
 * Add / edit holding.
 *
 * A modal keeps the user on the portfolio page so the list stays visible while
 * they type, which is the main advantage the web layout has over the mobile
 * push-screen equivalent.
 */
function openHoldingModal({ currency, holding = null }) {
  const isEdit = holding !== null;
  const marketConnected = marketDataIsConfigured();
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
    marketSymbol: holding?.marketSymbol ?? "",
    marketExchange: holding?.marketExchange ?? "",
    marketMicCode: holding?.marketMicCode ?? "",
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
          onInput: (value) => {
            draft.quantity = value;
          }
        }),
        Field({
          label: "Average buy price",
          value: draft.averageBuyPrice,
          inputMode: "decimal",
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
        })
      ]),
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
                  ? `Latest quote ${formatQuoteTime(draft.priceUpdatedAt)}`
                  : "Linked to Twelve Data"
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
          h("span", { class: "market-result__type", text: instrument.type || "Security" })
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

    try {
      const quote = await fetchMarketQuote(instrument);
      let exchangeRate = 1;
      if (quote.currency && quote.currency !== currency) {
        const conversion = await fetchExchangeRate(quote.currency, currency);
        exchangeRate = conversion.rate;
      }

      draft.assetType = marketInstrumentTypeToAssetType(quote.type || instrument.type);
      draft.name = quote.name || instrument.name;
      draft.ticker = quote.symbol || instrument.symbol;
      draft.currentPrice = String(quote.currentPrice);
      draft.currency = quote.currency || instrument.currency || currency;
      draft.exchangeRateToBase = String(exchangeRate);
      draft.region = marketCountryToRegion(instrument.country);
      draft.marketProvider = "twelve-data";
      draft.marketSymbol = quote.symbol || instrument.symbol;
      draft.marketExchange = quote.exchange || instrument.exchange || "";
      draft.marketMicCode = quote.micCode || instrument.micCode || "";
      draft.priceUpdatedAt = quote.priceUpdatedAt;
      draft.priceMarketOpen = quote.marketOpen;
      draft.searchQuery = "";
      searchResults = [];
      searchError = "";
      renderBody();
    } catch (quoteError) {
      searchError = quoteError instanceof Error ? quoteError.message : "The quote could not be loaded.";
      renderSearchResults(resultsHost);
    }
  }

  async function updateSelectedQuote() {
    if (!draft.marketSymbol || quoteLoading) return;
    quoteLoading = true;
    renderBody();

    try {
      const quote = await fetchMarketQuote({ symbol: draft.marketSymbol, exchange: draft.marketExchange });
      draft.currentPrice = String(quote.currentPrice);
      draft.priceUpdatedAt = quote.priceUpdatedAt;
      draft.priceMarketOpen = quote.marketOpen;
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
    draft.marketSymbol = "";
    draft.marketExchange = "";
    draft.marketMicCode = "";
    draft.priceUpdatedAt = "";
    draft.priceMarketOpen = false;
  }

  function save() {
    const quantity = parsePositiveNumber(draft.quantity);
    const currentPrice = parsePositiveNumber(draft.currentPrice);
    const averageBuyPrice = parsePositiveNumber(draft.averageBuyPrice);
    const exchangeRateToBase =
      draft.currency === currency ? 1 : parsePositiveNumber(draft.exchangeRateToBase);

    if (!draft.name.trim() || quantity <= 0 || currentPrice <= 0 || exchangeRateToBase <= 0) {
      error = "Name, quantity, current price and a valid base exchange rate are required.";
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
      marketSymbol: draft.marketSymbol,
      marketExchange: draft.marketExchange,
      marketMicCode: draft.marketMicCode,
      priceUpdatedAt: draft.priceUpdatedAt,
      priceMarketOpen: draft.priceMarketOpen
    };

    try {
      if (isEdit) {
        updateHolding(holding.id, input);
        toast(`${input.name} updated.`);
      } else {
        addHolding(input);
        toast(`${input.name} added to your portfolio.`);
      }
      modal.close();
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : "The holding could not be saved.";
      renderBody();
    }
  }
}

async function refreshPortfolioPrices(holdings) {
  if (pricesRefreshing) return;
  pricesRefreshing = true;
  lastMarketRefreshAt = Date.now();
  requestRerender();

  try {
    const result = await fetchMarketQuotes(holdings);
    const usable = result.quotes.filter(
      (quote) => quote.holdingId && !quote.error && Number.isFinite(Number(quote.currentPrice))
    );

    if (usable.length === 0) {
      throw new Error(result.quotes.find((quote) => quote.error)?.error || "No prices could be refreshed.");
    }

    updateHoldingPrices(
      usable.map((quote) => ({
        id: quote.holdingId,
        currentPrice: Number(quote.currentPrice),
        priceUpdatedAt: quote.priceUpdatedAt,
        priceMarketOpen: quote.marketOpen
      }))
    );

    const failed = result.quotes.length - usable.length;
    const extra = [
      failed > 0 ? `${failed} failed` : "",
      result.remaining > 0 ? `${result.remaining} queued for the next refresh` : ""
    ]
      .filter(Boolean)
      .join(" · ");
    toast(`${usable.length} ${usable.length === 1 ? "price" : "prices"} refreshed${extra ? ` · ${extra}` : ""}.`, {
      level: failed > 0 || result.remaining > 0 ? "info" : "success"
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

function scheduleAutoRefresh(linkedHoldings) {
  if (pricesRefreshing || linkedHoldings.length === 0) return;

  const now = Date.now();
  const hasStaleQuote = linkedHoldings.some((holding) => {
    const updatedAt = Date.parse(holding.priceUpdatedAt ?? "") || 0;
    return now - updatedAt >= AUTO_REFRESH_AFTER_MS;
  });

  if (!hasStaleQuote || now - lastMarketRefreshAt < AUTO_REFRESH_AFTER_MS) return;
  lastMarketRefreshAt = now;
  window.setTimeout(() => refreshPortfolioPrices(getState().holdings), 0);
}

function formatQuoteTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
