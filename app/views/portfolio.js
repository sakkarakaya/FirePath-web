import { assetTypes } from "../data/defaults.js";
import { formatCompactCurrency, formatCurrency, formatPercent } from "../domain/formatters.js";
import { parsePositiveNumber } from "../domain/numberInput.js";
import {
  buildAllocation,
  buildAllocationDrift,
  buildCurrencyExposure,
  buildDayMovers,
  buildPerformanceRanking,
  buildPortfolioStatistics,
  buildPositionMap,
  POSITION_MAP_RANGES,
  planContribution
} from "../domain/portfolioAnalytics.js";
import {
  TRANSACTION_LABELS,
  TRANSACTION_TYPES,
  buildDividendTimeline,
  calculateHoldingXirr,
  summarizeHoldingLedger,
  summarizeLedger,
  transactionCashFlow,
  transactionsForHolding
} from "../domain/portfolioLedger.js";
import {
  buildHoldingBreakdown,
  calculatePortfolioHealth,
  calculatePortfolioSummary,
  describePortfolioSource,
  describeUntrackedInvestments
} from "../domain/portfolioCalculations.js";
import {
  HISTORY_RANGES,
  buildTransactionSnapshots,
  describeHistoryCoverage,
  mergeSnapshotSeries,
  selectHistoryRange,
  selectSeriesRange,
  summarizeHistory
} from "../domain/portfolioHistory.js";
import {
  BENCHMARK_PRESETS,
  earliestLedgerDate,
  historyKeyForHolding,
  holdingsWithRebuildableHistory,
  readCachedSeries,
  refreshPriceHistory
} from "../domain/marketHistory.js";
import {
  alignBenchmark,
  buildYearlyPerformance,
  calculateRiskMetrics,
  calculateTimeWeightedReturn,
  reconstructPortfolioSeries
} from "../domain/portfolioReconstruction.js";
import {
  getMarketDataSettings,
  marketDataIsConfigured,
  saveBenchmarkSymbol
} from "../store/marketData.js";
import { seriesKey } from "../store/priceSeries.js";
import {
  clearPortfolioHistory,
  getState,
  patchProfile,
  recordPortfolioSnapshot,
  removeHolding,
  selectFireMetrics
} from "../store/store.js";
import {
  AreaChart,
  ChartLegend,
  DivergingBars,
  DonutChart,
  GroupedBars,
  PositionMap,
  Sparkline,
  WeightBars,
  chartColor
} from "../ui/charts.js";
import {
  Button,
  Card,
  EmptyState,
  Field,
  MetricCard,
  ProgressBar,
  SectionHeader,
  SegmentedControl,
  SelectField,
  StatusChip
} from "../ui/components.js";
import { h } from "../ui/dom.js";
import { confirmAction, openModal, toast } from "../ui/feedback.js";
import { href, navigate } from "../router.js";
import {
  formatQuoteTime,
  isRefreshingPrices,
  openHoldingModal,
  openPriceUpdateModal,
  refreshPortfolioPrices,
  scheduleAutoRefresh
} from "./portfolioHolding.js";
import { confirmTransactionDelete, openTransactionModal } from "./portfolioTransaction.js";

/**
 * Portfolio.
 *
 * Five linked screens rather than one long page: an overview, the position
 * list, allocation, performance and the recorded value history. They share one
 * header and a value strip so the total is always on screen, and every screen
 * repeats that the tracked list can differ from the invested figure saved on
 * the profile — the dashboard counts the larger of the two and this section
 * says so rather than looking wrong.
 */

export const PORTFOLIO_SECTIONS = [
  { route: "/portfolio", label: "Overview", title: "What you hold", icon: "◫" },
  { route: "/portfolio/holdings", label: "Holdings", title: "Every position", icon: "≣" },
  { route: "/portfolio/activity", label: "Activity", title: "Buys, sells and dividends", icon: "⇄" },
  { route: "/portfolio/allocation", label: "Allocation", title: "How it splits", icon: "◔" },
  { route: "/portfolio/performance", label: "Performance", title: "What moved it", icon: "◭" },
  { route: "/portfolio/history", label: "History", title: "Value over time", icon: "◷" }
];

const allocationKeys = ["holding", "assetType", "region", "currency", "sector"];
const allocationLabels = {
  holding: "Holdings",
  assetType: "Asset type",
  region: "Region",
  currency: "Currency",
  sector: "Sector"
};

/** View-local UI state. Kept outside render so a store update never resets it. */
let overviewAllocationKey = "holding";
let historyRange = "1M";
let holdingsQuery = "";
let holdingsTypeFilter = "All";
let holdingsSort = { key: "value", direction: "desc" };
let activityTypeFilter = "All";
let activityHoldingFilter = "all";
let positionMapRange = "ALL";
let historyRebuilding = false;
let historyRebuildNote = "";

function requestRerender() {
  window.dispatchEvent(new CustomEvent("firepath:rerender"));
}

/* -------------------------------------------------------------------------- */
/* Shared shell                                                               */
/* -------------------------------------------------------------------------- */

function usePortfolio() {
  // Rendering is the only moment the app knows today's prices, so this is where
  // the day's snapshot is written. It never notifies, so it cannot loop — and
  // it runs before the history is read so today's point is already in it.
  recordPortfolioSnapshot();

  const { profile, holdings, portfolioHistory, portfolioTransactions } = getState();
  const metrics = selectFireMetrics();
  const currency = profile?.currency ?? "EUR";
  const marketConnected = marketDataIsConfigured();
  const linkedHoldings = holdings.filter((holding) => holding.marketProvider && holding.marketSymbol);
  const transactionHistory = buildTransactionSnapshots(holdings, portfolioTransactions, {
    seriesByKey: readCachedSeries(),
    baseCurrency: currency
  });
  const valueHistory = mergeSnapshotSeries(transactionHistory, portfolioHistory);

  scheduleAutoRefresh(marketConnected ? linkedHoldings : [], holdings, currency);

  return {
    profile,
    holdings,
    history: portfolioHistory,
    valueHistory,
    hasTransactionHistory: transactionHistory.some(
      (point) => !portfolioHistory.some((snapshot) => snapshot.date === point.date)
    ),
    metrics,
    currency,
    marketConnected,
    linkedHoldings,
    transactions: portfolioTransactions,
    summary: calculatePortfolioSummary(holdings),
    stats: buildPortfolioStatistics(holdings, currency),
    ledger: summarizeLedger(holdings, portfolioTransactions)
  };
}

function PortfolioPage({ path, context, children, title, description, actions, back, showStrip = true }) {
  const { holdings, metrics, currency, marketConnected, linkedHoldings } = context;
  const section = PORTFOLIO_SECTIONS.find((candidate) => candidate.route === path) ?? PORTFOLIO_SECTIONS[0];

  return h("div", { class: "view" }, [
    back ? h("div", { class: "row" }, [Button({ to: back.route, variant: "ghost", size: "sm" }, back.label)]) : null,

    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: "Portfolio" }),
        h("h1", { class: "page-header__title", text: title ?? section.title }),
        h("p", {
          class: "page-header__description",
          text: description ?? describePortfolioSource(metrics.portfolioCoverage, holdings.length, currency)
        })
      ]),
      h(
        "div",
        { class: "page-header__actions" },
        actions ?? [
          marketConnected && linkedHoldings.length > 0
            ? Button(
                {
                  variant: "secondary",
                  loading: isRefreshingPrices(),
                  onclick: () => refreshPortfolioPrices(holdings, currency)
                },
                "Update prices"
              )
            : holdings.length > 0
              ? Button(
                  {
                    variant: "secondary",
                    onclick: () => openPriceUpdateModal({ holdings, baseCurrency: currency })
                  },
                  "Edit prices"
                )
            : null,
          Button({ to: "/settings/import", variant: "ghost" }, "Import CSV"),
          Button({ variant: "primary", onclick: () => openHoldingModal({ currency }) }, "Add holding")
        ]
      )
    ]),

    SubNav({ path }),
    showStrip && holdings.length > 0 ? SummaryStrip({ context }) : null,
    ...(Array.isArray(children) ? children : [children])
  ]);
}

/** Section switcher. The sidebar carries the same links on wide screens. */
function SubNav({ path }) {
  return h(
    "nav",
    { class: "subnav", "aria-label": "Portfolio sections" },
    PORTFOLIO_SECTIONS.map((section) =>
      h(
        "a",
        {
          class: `subnav__link ${section.route === path ? "is-active" : ""}`.trim(),
          href: href(section.route),
          "aria-current": section.route === path ? "page" : null
        },
        [
          h("span", { class: "subnav__icon", "aria-hidden": "true", text: section.icon }),
          h("span", { text: section.label })
        ]
      )
    )
  );
}

/** Compact value bar repeated on every portfolio screen. */
function SummaryStrip({ context }) {
  const { stats, currency, valueHistory } = context;
  const gainLevel = stats.unrealizedGainLoss >= 0 ? "good" : "risk";
  const sparkPoints = valueHistory.slice(-40).map((snapshot) => ({ value: snapshot.value }));

  return h("div", { class: "summary-strip" }, [
    h("div", { class: "summary-strip__primary" }, [
      h("span", { class: "summary-strip__label", text: "Tracked value" }),
      h("strong", { class: "summary-strip__value", text: formatCurrency(stats.totalValue, currency) }),
      h("div", { class: "row row--tight" }, [
        StatusChip({
          label: `${signPrefix(stats.unrealizedGainLoss)}${formatCurrency(stats.unrealizedGainLoss, currency)}`,
          level: gainLevel,
          size: "sm"
        }),
        stats.gainLossPercentage === null
          ? null
          : StatusChip({
              label: `${signPrefix(stats.gainLossPercentage)}${formatPercent(stats.gainLossPercentage, 1)}`,
              level: gainLevel,
              size: "sm"
            })
      ])
    ]),
    // Always rendered, even with too few points to draw: the wrapper holds the
    // grid column open so the stats never slide into the sparkline's place.
    h("div", { class: "summary-strip__spark" }, [
      Sparkline({ points: sparkPoints, tone: stats.unrealizedGainLoss >= 0 ? "primary" : "danger" })
    ]),
    h("div", { class: "summary-strip__stats" }, [
      StripStat({ label: "Invested", value: formatCurrency(stats.totalInvested, currency) }),
      StripStat({
        label: "Since previous close",
        value: stats.dayChange
          ? `${signPrefix(stats.dayChange.value)}${formatCurrency(stats.dayChange.value, currency)}`
          : "—",
        tone: stats.dayChange ? (stats.dayChange.value >= 0 ? "up" : "down") : null,
        hint: stats.dayChange
          ? `${stats.dayChange.coveredPositions} priced ${
              stats.dayChange.coveredPositions === 1 ? "position" : "positions"
            }`
          : "Needs live quotes"
      }),
      StripStat({ label: "Positions", value: String(stats.positionCount) }),
      StripStat({
        label: "Spread",
        value: `${stats.diversification.score}/100`,
        hint: stats.diversification.label
      })
    ])
  ]);
}

function StripStat({ label, value, hint, tone }) {
  return h("div", { class: "summary-strip__stat" }, [
    h("span", { class: "summary-strip__stat-label", text: label }),
    h("strong", {
      class: `summary-strip__stat-value ${tone ? `value-${tone}` : ""}`.trim(),
      text: value
    }),
    hint && h("span", { class: "summary-strip__stat-hint", text: hint })
  ]);
}

function EmptyPortfolio({ context, path }) {
  const { currency } = context;

  return PortfolioPage({
    path,
    context,
    children: Card({}, [
      EmptyState({
        icon: "◫",
        title: "No holdings tracked yet",
        description:
          "Search for a market-listed instrument, add a position manually or import a CSV export. FirePath never connects to your broker.",
        action: Button({ variant: "primary", onclick: () => openHoldingModal({ currency }) }, "Add holding")
      })
    ])
  });
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export function PortfolioView() {
  const context = usePortfolio();
  const { holdings, currency } = context;

  if (holdings.length === 0) {
    return EmptyPortfolio({ context, path: "/portfolio" });
  }

  const { stats, metrics, valueHistory, hasTransactionHistory, marketConnected, linkedHoldings } = context;
  const untrackedNote = describeUntrackedInvestments(metrics.portfolioCoverage, currency);
  const allocation = buildAllocation(holdings, overviewAllocationKey);
  const topPositions = buildHoldingBreakdown(holdings).slice(0, 6);
  const gainLevel = stats.unrealizedGainLoss >= 0 ? "good" : "risk";

  return PortfolioPage({
    path: "/portfolio",
    context,
    children: [
      h("div", { class: "grid grid--4" }, [
        MetricCard({
          label: "Total return",
          value:
            stats.gainLossPercentage === null
              ? "—"
              : `${signPrefix(stats.gainLossPercentage)}${formatPercent(stats.gainLossPercentage, 1)}`,
          status: { label: stats.unrealizedGainLoss >= 0 ? "Gain" : "Loss", level: gainLevel },
          hint: `${signPrefix(stats.unrealizedGainLoss)}${formatCurrency(
            stats.unrealizedGainLoss,
            currency
          )} unrealized`
        }),
        MetricCard({
          label: "Best performer",
          value: stats.best ? shortName(stats.best.holding) : "—",
          hint: stats.best
            ? `${signPrefix(stats.best.gainLossPercentage)}${formatPercent(stats.best.gainLossPercentage, 1)} · ${formatCurrency(
                stats.best.value,
                currency
              )}`
            : "Add a buy price to rank holdings"
        }),
        MetricCard({
          label: "Largest position",
          value: stats.largest ? formatPercent(stats.largestShare) : "—",
          hint: stats.largest ? shortName(stats.largest.holding) : "",
          status:
            stats.largestShare >= 0.4 ? { label: "Concentrated", level: "watch" } : null
        }),
        MetricCard({
          label: "Counted in FIRE",
          value: formatCurrency(metrics.portfolioCoverage.totalValue, currency),
          hint: "Larger of tracked holdings and your saved total"
        })
      ]),

      h("div", { class: "grid grid--sidebar" }, [
        HistoryCard({
          history: valueHistory,
          currency,
          compact: true,
          estimatedFromTransactions: hasTransactionHistory
        }),
        Card({}, [
          SectionHeader({ eyebrow: "Allocation", title: allocationLabels[overviewAllocationKey] }),
          SegmentedControl({
            options: allocationKeys,
            value: overviewAllocationKey,
            getLabel: (key) => allocationLabels[key],
            label: "Group allocation by",
            onChange: (key) => {
              overviewAllocationKey = key;
              requestRerender();
            }
          }),
          h("div", { class: "donut-block" }, [
            DonutChart({
              slices: allocation,
              centerValue: formatCompactCurrency(stats.totalValue, currency),
              centerLabel: `${allocation.length} ${allocation.length === 1 ? "group" : "groups"}`
            })
          ]),
          ChartLegend({
            slices: allocation.slice(0, 6),
            formatValue: (slice) => formatCurrency(slice.value, currency)
          }),
          Button({ to: "/portfolio/allocation", variant: "ghost", size: "sm" }, "Full allocation analysis")
        ])
      ]),

      h("div", { class: "grid grid--sidebar" }, [
        Card({}, [
          SectionHeader({
            eyebrow: "Weights",
            title: "Largest positions",
            description: "Share of tracked portfolio value.",
            action: Button({ to: "/portfolio/holdings", variant: "ghost", size: "sm" }, "All holdings")
          }),
          WeightBars({
            rows: topPositions.map((entry) => ({
              label: shortName(entry.holding),
              sublabel: `${entry.holding.assetType} · ${formatCurrency(entry.value, currency)}`,
              value: entry.share
            })),
            formatValue: (value) => formatPercent(value, 1)
          })
        ]),
        h("div", { class: "stack" }, [
          DiversificationCard({ stats }),
          MarketNoteCard({ marketConnected, linkedHoldings, untrackedNote })
        ])
      ])
    ]
  });
}

function DiversificationCard({ stats }) {
  const { diversification } = stats;

  return Card({}, [
    SectionHeader({
      eyebrow: "Spread",
      title: `${diversification.score} / 100`,
      description: "Measures how widely the tracked value is spread, not whether that suits your plan.",
      action: StatusChip({ label: diversification.label, level: diversification.level })
    }),
    h(
      "div",
      { class: "stack stack--tight" },
      diversification.components.map((component) =>
        ProgressBar({
          value: component.score,
          label: component.label,
          level: component.score >= 0.6 ? "good" : component.score >= 0.3 ? "watch" : "risk"
        })
      )
    ),
    h("p", {
      class: "muted",
      text: `${formatDecimal(stats.effectivePositions)} effective positions across ${
        stats.assetClassCount
      } asset ${stats.assetClassCount === 1 ? "class" : "classes"} and ${stats.regionCount} ${
        stats.regionCount === 1 ? "region" : "regions"
      }.`
    })
  ]);
}

function MarketNoteCard({ marketConnected, linkedHoldings, untrackedNote }) {
  return Card({}, [
    SectionHeader({ eyebrow: "Prices", title: "Where the numbers come from" }),
    untrackedNote ? h("p", { class: "inline-note inline-note--watch", text: untrackedNote }) : null,
    linkedHoldings.length > 0
      ? h("p", {
          class: "inline-note inline-note--good",
          text: `${linkedHoldings.length} ${
            linkedHoldings.length === 1 ? "holding uses" : "holdings use"
          } market prices. Stale quotes refresh when you open this page; prices are not broker execution prices.`
        })
      : marketConnected
        ? h("p", {
            class: "inline-note",
            text: "Market data is configured. Search for a real ETF or stock when you add a holding."
          })
        : h("p", {
            class: "inline-note",
            text: "Live market data is optional. Connect it in Settings, or keep entering prices manually."
          }),
    marketConnected
      ? null
      : Button({ to: "/settings/market-data", variant: "ghost", size: "sm" }, "Connect market data")
  ]);
}

/* -------------------------------------------------------------------------- */
/* Holdings                                                                   */
/* -------------------------------------------------------------------------- */

export function PortfolioHoldingsView() {
  const context = usePortfolio();
  const { holdings, currency } = context;

  if (holdings.length === 0) {
    return EmptyPortfolio({ context, path: "/portfolio/holdings" });
  }

  const rows = buildPerformanceRanking(holdings);
  const typeOptions = ["All", ...assetTypes.filter((type) => holdings.some((holding) => holding.assetType === type))];
  const filtered = sortRows(
    rows.filter((row) => matchesQuery(row, holdingsQuery) && matchesType(row, holdingsTypeFilter)),
    holdingsSort
  );

  const visibleValue = filtered.reduce((total, row) => total + row.value, 0);
  const visibleInvested = filtered.reduce((total, row) => total + row.invested, 0);

  return PortfolioPage({
    path: "/portfolio/holdings",
    context,
    children: [
      Card({ class: "card--flush" }, [
        h("div", { class: "table-toolbar" }, [
          h("div", { class: "table-toolbar__search" }, [
            Field({
              label: "Search holdings",
              value: holdingsQuery,
              placeholder: "Name, ticker or sector",
              autocomplete: "off",
              onInput: (value) => {
                holdingsQuery = value;
                requestRerender();
              }
            })
          ]),
          SegmentedControl({
            options: typeOptions,
            value: typeOptions.includes(holdingsTypeFilter) ? holdingsTypeFilter : "All",
            label: "Filter by asset type",
            onChange: (value) => {
              holdingsTypeFilter = value;
              requestRerender();
            }
          })
        ]),

        filtered.length === 0
          ? h("div", { style: { padding: "0 1.25rem 1.25rem" } }, [
              EmptyState({
                icon: "◇",
                title: "No holdings match",
                description: "Clear the search or pick another asset type."
              })
            ])
          : h("div", { class: "table-scroll" }, [
              h("table", { class: "table table--dense" }, [
                h("thead", {}, [
                  h("tr", {}, [
                    SortableHeader({ label: "Holding", sortKey: "name", align: "left" }),
                    SortableHeader({ label: "Quantity", sortKey: "quantity" }),
                    SortableHeader({ label: "Price", sortKey: "price" }),
                    SortableHeader({ label: "Day", sortKey: "day" }),
                    SortableHeader({ label: "Value", sortKey: "value" }),
                    SortableHeader({ label: "Invested", sortKey: "invested" }),
                    SortableHeader({ label: "Gain / loss", sortKey: "gain" }),
                    SortableHeader({ label: "Share", sortKey: "share" }),
                    h("th", { scope: "col", "aria-label": "Actions" })
                  ])
                ]),
                h(
                  "tbody",
                  {},
                  filtered.map((row) => HoldingRow({ row, currency }))
                ),
                h("tfoot", {}, [
                  h("tr", {}, [
                    h("td", { text: `${filtered.length} shown` }),
                    h("td", {}),
                    h("td", {}),
                    h("td", {}),
                    h("td", { text: formatCurrency(visibleValue, currency) }),
                    h("td", { text: formatCurrency(visibleInvested, currency) }),
                    h("td", {
                      class: visibleValue - visibleInvested >= 0 ? "value-up" : "value-down",
                      text: `${signPrefix(visibleValue - visibleInvested)}${formatCurrency(
                        visibleValue - visibleInvested,
                        currency
                      )}`
                    }),
                    h("td", {}),
                    h("td", {})
                  ])
                ])
              ])
            ])
      ])
    ]
  });
}

function SortableHeader({ label, sortKey, align = "right" }) {
  const isActive = holdingsSort.key === sortKey;

  return h("th", { scope: "col", class: align === "left" ? "" : "table__cell--numeric" }, [
    h("button", {
      type: "button",
      class: `table__sort ${isActive ? "is-active" : ""}`.trim(),
      "aria-label": `Sort by ${label}`,
      onclick: () => {
        holdingsSort = {
          key: sortKey,
          direction: isActive && holdingsSort.direction === "desc" ? "asc" : "desc"
        };
        requestRerender();
      }
    }, [
      h("span", { text: label }),
      h("span", {
        class: "table__sort-icon",
        "aria-hidden": "true",
        text: isActive ? (holdingsSort.direction === "desc" ? "▾" : "▴") : "⋅"
      })
    ])
  ]);
}

function HoldingRow({ row, currency }) {
  const { holding } = row;
  const gainClass = row.gainLoss >= 0 ? "value-up" : "value-down";
  const sourceLabel = marketSourceLabel(holding.marketSourceProvider || holding.marketProvider);
  const quoteLabel =
    holding.marketSourceProvider === "manual"
      ? holding.priceUpdatedAt
        ? `Manual price ${formatQuoteTime(holding.priceUpdatedAt)}`
        : "Manual price"
      : holding.marketProvider
        ? holding.priceUpdatedAt
          ? `${sourceLabel} quote ${formatQuoteTime(holding.priceUpdatedAt)}`
          : "Market linked"
        : "Manual price";
  const subtitle = [holding.assetType, holding.ticker, holding.region, quoteLabel].filter(Boolean).join(" · ");

  return h("tr", {}, [
    h("td", {}, [
      h("a", { class: "table__name table__name--link", href: href(`/portfolio/holdings/${holding.id}`) }, [
        h("strong", { text: holding.name }),
        h("span", { text: subtitle })
      ])
    ]),
    h("td", { class: "table__cell--numeric", text: formatQuantity(holding.quantity) }),
    h("td", { class: "table__cell--numeric" }, [
      h("button", {
        type: "button",
        class: "table__price-button",
        title: `Update ${holding.name} price`,
        "aria-label": `Update ${holding.name} price`,
        onclick: () => openPriceUpdateModal({ holdings: [holding], baseCurrency: currency })
      }, [
        h("strong", { text: formatCurrency(holding.currentPrice, holding.currency, 2) }),
        h("span", { text: `avg ${formatCurrency(holding.averageBuyPrice, holding.currency, 2)}` })
      ])
    ]),
    h("td", {
      class: `table__cell--numeric ${
        row.dayChangePercentage === null ? "" : row.dayChangePercentage >= 0 ? "value-up" : "value-down"
      }`.trim(),
      text:
        row.dayChangePercentage === null
          ? "—"
          : `${signPrefix(row.dayChangePercentage)}${formatPercent(row.dayChangePercentage, 2)}`
    }),
    h("td", { class: "table__cell--numeric", text: formatCurrency(row.value, currency) }),
    h("td", { class: "table__cell--numeric", text: formatCurrency(row.invested, currency) }),
    h("td", { class: `table__cell--numeric ${gainClass}` }, [
      h("div", { class: "table__stack" }, [
        h("strong", { text: `${signPrefix(row.gainLoss)}${formatCurrency(row.gainLoss, currency)}` }),
        h("span", {
          text:
            row.gainLossPercentage === null
              ? ""
              : `${signPrefix(row.gainLossPercentage)}${formatPercent(row.gainLossPercentage, 1)}`
        })
      ])
    ]),
    h("td", { class: "table__cell--numeric", text: formatPercent(row.share, 1) }),
    h("td", {}, [
      h("div", { class: "table__actions" }, [
        h("a", {
          class: "icon-button",
          "aria-label": `Open ${holding.name}`,
          title: "Open position",
          href: href(`/portfolio/holdings/${holding.id}`),
          text: "›"
        }),
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

function matchesQuery(row, query) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  return [row.holding.name, row.holding.ticker, row.holding.sector, row.holding.region]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle));
}

function matchesType(row, type) {
  return type === "All" || row.holding.assetType === type;
}

function sortRows(rows, sort) {
  const pick = {
    name: (row) => row.holding.name.toLowerCase(),
    quantity: (row) => row.holding.quantity,
    price: (row) => row.holding.currentPrice,
    day: (row) => row.dayChangePercentage ?? Number.NEGATIVE_INFINITY,
    value: (row) => row.value,
    invested: (row) => row.invested,
    gain: (row) => row.gainLoss,
    share: (row) => row.share
  }[sort.key] ?? ((row) => row.value);

  const factor = sort.direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const a = pick(left);
    const b = pick(right);
    if (typeof a === "string" || typeof b === "string") {
      return String(a).localeCompare(String(b)) * factor;
    }
    return (a - b) * factor;
  });
}

/* -------------------------------------------------------------------------- */
/* Position detail                                                            */
/* -------------------------------------------------------------------------- */

export function PortfolioHoldingView({ params }) {
  const context = usePortfolio();
  const { holdings, currency, transactions } = context;
  const holding = holdings.find((candidate) => String(candidate.id) === String(params.id)) ?? null;

  if (holding === null) {
    return PortfolioPage({
      path: "/portfolio/holdings",
      context,
      title: "Position not found",
      description: "That holding is not tracked in this browser.",
      showStrip: false,
      back: { route: "/portfolio/holdings", label: "← Holdings" },
      children: Card({}, [
        EmptyState({
          icon: "◇",
          title: "Nothing to show",
          description: "The holding may have been deleted, or the link points at another browser's data.",
          action: Button({ to: "/portfolio/holdings", variant: "primary" }, "Back to holdings")
        })
      ])
    });
  }

  const rows = transactionsForHolding(transactions, holding.id);
  const ledger = summarizeHoldingLedger(rows);
  const rate = Math.max(0, Number(holding.exchangeRateToBase) || 0);
  const value = holding.quantity * holding.currentPrice * rate;
  const invested = holding.quantity * holding.averageBuyPrice * rate;
  const unrealized = value - invested;
  const unrealizedPercentage = invested === 0 ? null : unrealized / invested;
  const share = context.stats.totalValue === 0 ? 0 : value / context.stats.totalValue;
  const xirr = ledger ? calculateHoldingXirr(holding, rows) : null;
  const dayChangePercentage = dayChangeOf(holding);
  const gainLevel = unrealized >= 0 ? "good" : "risk";

  const realized = ledger ? ledger.realizedGainLoss * rate : 0;
  const dividends = ledger ? ledger.dividends * rate : 0;
  const totalReturn = unrealized + realized + dividends;

  return PortfolioPage({
    path: "/portfolio/holdings",
    context,
    title: holding.name,
    description: [holding.assetType, holding.ticker, holding.region, holding.sector]
      .filter(Boolean)
      .join(" · "),
    showStrip: false,
    back: { route: "/portfolio/holdings", label: "← Holdings" },
    actions: [
      Button({ variant: "ghost", onclick: () => openHoldingModal({ currency, holding }) }, "Edit holding"),
      Button(
        { variant: "primary", onclick: () => openTransactionModal({ holding }) },
        "Add transaction"
      )
    ],
    children: [
      Card({}, [
        h("div", { class: "hero" }, [
          h("div", { class: "hero__copy" }, [
            h("p", { class: "eyebrow", text: "Position value" }),
            h("strong", { class: "hero__value", text: formatCurrency(value, currency) }),
            h("div", { class: "row row--tight" }, [
              StatusChip({
                label: `${signPrefix(unrealized)}${formatCurrency(unrealized, currency)}`,
                level: gainLevel
              }),
              unrealizedPercentage === null
                ? null
                : StatusChip({
                    label: `${signPrefix(unrealizedPercentage)}${formatPercent(unrealizedPercentage, 1)}`,
                    level: gainLevel
                  }),
              dayChangePercentage === null
                ? null
                : StatusChip({
                    label: `Since close ${signPrefix(dayChangePercentage)}${formatPercent(
                      dayChangePercentage,
                      2
                    )}`,
                    level: dayChangePercentage >= 0 ? "good" : "risk"
                  })
            ]),
            h("p", {
              class: "hero__caption",
              text: `${formatQuantity(holding.quantity)} units at ${formatCurrency(
                holding.currentPrice,
                holding.currency,
                2
              )}${holding.currency === currency ? "" : ` · rate ${formatDecimal(rate, 4)}`}`
            })
          ])
        ]),
        h("div", { class: "grid grid--4" }, [
          MetricCard({
            label: "Average cost",
            value: formatCurrency(holding.averageBuyPrice, holding.currency, 2),
            hint: ledger ? "Derived from your transactions" : "Entered manually"
          }),
          MetricCard({ label: "Invested", value: formatCurrency(invested, currency) }),
          MetricCard({
            label: "Share of portfolio",
            value: formatPercent(share, 1),
            hint: `${formatCurrency(context.stats.totalValue, currency)} tracked in total`
          }),
          MetricCard({
            label: "Held for",
            value: ledger?.holdingPeriodDays === null || ledger === null ? "—" : formatHoldingPeriod(ledger.holdingPeriodDays),
            hint: ledger?.firstBuyDate ? `First buy ${formatDate(ledger.firstBuyDate)}` : "Add transactions to track this"
          })
        ])
      ]),

      ledger
        ? h("div", { class: "grid grid--4" }, [
            MetricCard({
              label: "Total return",
              value: `${signPrefix(totalReturn)}${formatCurrency(totalReturn, currency)}`,
              status: { label: totalReturn >= 0 ? "Gain" : "Loss", level: totalReturn >= 0 ? "good" : "risk" },
              hint: "Unrealized, realized and dividends together"
            }),
            MetricCard({
              label: "Realized",
              value: `${signPrefix(realized)}${formatCurrency(realized, currency)}`,
              hint: `${ledger.sellCount} ${ledger.sellCount === 1 ? "sale" : "sales"} matched oldest-first`
            }),
            MetricCard({
              label: "Dividends",
              value: formatCurrency(dividends, currency),
              hint: `Net of ${formatCurrency(ledger.fees * rate, currency)} fees and withholding`
            }),
            MetricCard({
              label: "Annualized return",
              value: xirr === null ? "—" : `${signPrefix(xirr)}${formatPercent(xirr, 1)}`,
              hint: xirr === null ? "Needs a buy and a current value" : "Money-weighted (XIRR)"
            })
          ])
        : null,

      InstrumentChartCard({ holding }),

      h("div", { class: "grid grid--sidebar" }, [
        TransactionsCard({ holding, rows, currency }),
        h("div", { class: "stack" }, [
          ledger && ledger.openLots.length > 0 ? OpenLotsCard({ holding, ledger }) : null,
          PositionNotesCard({ holding, currency, ledger })
        ])
      ])
    ]
  });
}

/** Cached price bars for this instrument, when the history has been rebuilt. */
function InstrumentChartCard({ holding }) {
  if (!holding.marketSymbol) {
    return null;
  }

  const series = readCachedSeries()[historyKeyForHolding(holding)];

  if (!series || series.bars.length < 2) {
    return null;
  }

  const points = series.bars.map((bar) => ({ label: bar.date, value: bar.close }));
  const change = points[points.length - 1].value / points[0].value - 1;

  return Card({}, [
    SectionHeader({
      eyebrow: "Price history",
      title: `${holding.marketSymbol} in ${holding.currency}`,
      description: `${points.length} daily closes cached in this browser, from ${formatDate(points[0].label)}.`,
      action: StatusChip({
        label: `${signPrefix(change)}${formatPercent(change, 1)}`,
        level: change >= 0 ? "good" : "risk"
      })
    }),
    AreaChart({
      points,
      height: 220,
      formatValue: (value) => formatCompactCurrency(value, holding.currency),
      formatLabel: (point) => formatDate(point.label),
      formatTooltip: (point) => formatCurrency(point.value, holding.currency, 2),
      ariaLabel: `${holding.marketSymbol} price history`,
      tone: change >= 0 ? "primary" : "accent"
    }),
    h("p", {
      class: "muted",
      text: "The instrument's own price, not your position — it ignores how many units you held when."
    })
  ]);
}

function TransactionsCard({ holding, rows, currency }) {
  if (rows.length === 0) {
    return Card({}, [
      SectionHeader({ eyebrow: "Ledger", title: "No transactions yet" }),
      EmptyState({
        icon: "⇄",
        title: "Record what actually happened",
        description:
          "Adding buys, sells and dividends turns the average price into a real cost basis, and unlocks realized gains and an annualized return for this position.",
        action: Button(
          { variant: "primary", onclick: () => openTransactionModal({ holding }) },
          "Add first transaction"
        )
      })
    ]);
  }

  return Card({ class: "card--flush" }, [
    h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [
      SectionHeader({
        eyebrow: "Ledger",
        title: `${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}`,
        description: "Newest first. Sales are matched against the oldest units held.",
        action: Button(
          { variant: "ghost", size: "sm", onclick: () => openTransactionModal({ holding }) },
          "Add"
        )
      })
    ]),
    h("div", { class: "table-scroll" }, [
      h("table", { class: "table table--dense" }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { scope: "col", text: "Date" }),
            h("th", { scope: "col", text: "Type" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Units" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Price" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Total" }),
            h("th", { scope: "col", "aria-label": "Actions" })
          ])
        ]),
        h(
          "tbody",
          {},
          [...rows].reverse().map((transaction) => TransactionRow({ transaction, holding }))
        )
      ])
    ])
  ]);
}

function TransactionRow({ transaction, holding }) {
  const cash = transactionCashFlow(transaction);
  const currency = holding.currency;

  return h("tr", {}, [
    h("td", {}, [
      h("div", { class: "table__stack" }, [
        h("strong", { text: formatDate(transaction.date) }),
        transaction.note ? h("span", { text: transaction.note }) : null
      ])
    ]),
    h("td", {}, [
      StatusChip({
        label: TRANSACTION_LABELS[transaction.type],
        level: transaction.type === "sell" ? "watch" : transaction.type === "dividend" ? "good" : "neutral",
        size: "sm"
      })
    ]),
    h("td", {
      class: "table__cell--numeric",
      text: transaction.type === "dividend" ? "—" : formatQuantity(transaction.quantity)
    }),
    h("td", {
      class: "table__cell--numeric",
      text: transaction.type === "dividend" ? "—" : formatCurrency(transaction.price, currency, 2)
    }),
    h("td", { class: `table__cell--numeric ${cash >= 0 ? "value-up" : ""}`.trim() }, [
      h("div", { class: "table__stack" }, [
        h("strong", { text: `${signPrefix(cash)}${formatCurrency(cash, currency, 2)}` }),
        transaction.fee > 0
          ? h("span", { text: `incl. ${formatCurrency(transaction.fee, currency, 2)} fees` })
          : null
      ])
    ]),
    h("td", {}, [
      h("div", { class: "table__actions" }, [
        h("button", {
          type: "button",
          class: "icon-button",
          "aria-label": `Edit transaction from ${transaction.date}`,
          title: "Edit",
          text: "✎",
          onclick: () => openTransactionModal({ holding, transaction })
        }),
        h("button", {
          type: "button",
          class: "icon-button icon-button--danger",
          "aria-label": `Delete transaction from ${transaction.date}`,
          title: "Delete",
          text: "×",
          onclick: () => confirmTransactionDelete(transaction, holding.name)
        })
      ])
    ])
  ]);
}

/** Open FIFO lots, so the reader can see which units a sale would consume. */
function OpenLotsCard({ holding, ledger }) {
  const currency = holding.currency;

  return Card({}, [
    SectionHeader({
      eyebrow: "Open lots",
      title: `${ledger.openLots.length} ${ledger.openLots.length === 1 ? "lot" : "lots"} still held`,
      description: "Oldest first — the order a sale consumes them in."
    }),
    h(
      "div",
      { class: "list" },
      ledger.openLots.map((lot) => {
        const gain = (holding.currentPrice - lot.unitCost) * lot.quantity;

        return h("div", { class: "list__row" }, [
          h("span", { class: "list__row-copy" }, [
            h("span", { class: "list__row-title", text: `${formatQuantity(lot.quantity)} units` }),
            h("span", {
              class: "list__row-detail",
              text: `Bought ${formatDate(lot.date)} at ${formatCurrency(lot.unitCost, currency, 2)}`
            })
          ]),
          h("span", {
            class: `list__row-value ${gain >= 0 ? "value-up" : "value-down"}`,
            text: `${signPrefix(gain)}${formatCurrency(gain, currency)}`
          })
        ]);
      })
    ),
    ledger.unmatchedQuantity > 0
      ? h("p", {
          class: "inline-note inline-note--watch",
          text: `${formatQuantity(
            ledger.unmatchedQuantity
          )} sold units have no matching buy in the ledger, so their cost basis is counted as zero. Add the missing buy to correct the realized figure.`
        })
      : null
  ]);
}

function PositionNotesCard({ holding, currency, ledger }) {
  return Card({}, [
    SectionHeader({ eyebrow: "This position", title: "Where the numbers come from" }),
    h("p", {
      class: "inline-note",
      text: holding.marketSourceProvider === "manual"
        ? `Price entered manually${
            holding.priceUpdatedAt ? ` ${formatQuoteTime(holding.priceUpdatedAt)}` : ""
          }. This position remains linked to ${holding.marketSymbol} for the next live update.`
        : holding.marketProvider
          ? `Priced from ${holding.marketSymbol} via ${marketSourceLabel(
              holding.marketSourceProvider || holding.marketProvider
            )}${
              holding.priceUpdatedAt ? `, quote ${formatQuoteTime(holding.priceUpdatedAt)}` : ""
            }.`
        : "Priced from the value you entered by hand."
    }),
    holding.currency === currency
      ? null
      : h("p", {
          class: "inline-note",
          text: `Held in ${holding.currency} and converted at ${formatDecimal(
            holding.exchangeRateToBase,
            4
          )}${
            holding.exchangeRateUpdatedAt
              ? `, updated ${formatQuoteTime(holding.exchangeRateUpdatedAt)}`
              : ". Update prices to refresh the rate."
          }`
        }),
    ledger
      ? h("p", {
          class: "inline-note inline-note--good",
          text: "Quantity and average cost are derived from the ledger below, so editing the holding cannot contradict its transactions."
        })
      : null,
    h("div", { class: "row" }, [
      Button(
        {
          variant: "ghost",
          size: "sm",
          onclick: async () => {
            const confirmed = await confirmAction({
              title: `Delete ${holding.name}?`,
              description:
                "This removes the holding and every transaction recorded against it from this browser. Your saved totals stay unchanged.",
              confirmLabel: "Delete holding"
            });

            if (confirmed) {
              removeHolding(holding.id);
              toast("Holding deleted.", { level: "info" });
              navigate("/portfolio/holdings");
            }
          }
        },
        "Delete position"
      )
    ])
  ]);
}

function marketSourceLabel(provider) {
  if (provider === "manual") return "Manual";
  return provider === "yahoo-finance" ? "Yahoo Finance" : "Twelve Data";
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                   */
/* -------------------------------------------------------------------------- */

export function PortfolioActivityView() {
  const context = usePortfolio();
  const { holdings, currency, transactions, ledger } = context;

  if (holdings.length === 0) {
    return EmptyPortfolio({ context, path: "/portfolio/activity" });
  }

  const byId = new Map(holdings.map((holding) => [holding.id, holding]));
  const all = [...transactions]
    .filter((transaction) => byId.has(transaction.holdingId))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)) || right.id - left.id);

  const filtered = all.filter(
    (transaction) =>
      (activityTypeFilter === "All" || transaction.type === activityTypeFilter) &&
      (activityHoldingFilter === "all" || String(transaction.holdingId) === activityHoldingFilter)
  );

  const dividendMonths = buildDividendTimeline(holdings, transactions);
  const dividendTotal = dividendMonths.reduce((total, month) => total + month.value, 0);

  return PortfolioPage({
    path: "/portfolio/activity",
    context,
    children: [
      h("div", { class: "grid grid--4" }, [
        MetricCard({
          label: "Transactions",
          value: String(all.length),
          hint: `${ledger.trackedHoldings} of ${holdings.length} positions have a ledger`
        }),
        MetricCard({
          label: "Realized result",
          value: `${signPrefix(ledger.realizedGainLoss)}${formatCurrency(ledger.realizedGainLoss, currency)}`,
          status:
            ledger.sales.length === 0
              ? null
              : { label: ledger.realizedGainLoss >= 0 ? "Gain" : "Loss", level: ledger.realizedGainLoss >= 0 ? "good" : "risk" },
          hint: `${ledger.sales.length} ${ledger.sales.length === 1 ? "sale" : "sales"} recorded`
        }),
        MetricCard({
          label: "Dividends (12 mo)",
          value: formatCurrency(dividendTotal, currency),
          hint: `${formatCurrency(ledger.dividends, currency)} recorded in total`
        }),
        MetricCard({
          label: "Fees and withholding",
          value: formatCurrency(ledger.fees, currency),
          hint: "Included in cost basis and net dividends"
        })
      ]),

      dividendTotal > 0
        ? Card({}, [
            SectionHeader({
              eyebrow: "Income",
              title: "Dividends by month",
              description: "Net of the fees and withholding you recorded."
            }),
            WeightBars({
              rows: dividendMonths
                .filter((month) => month.value > 0)
                .map((month) => ({
                  label: formatMonth(month.date),
                  value: month.value,
                  sublabel: `${month.count} ${month.count === 1 ? "payment" : "payments"}`,
                  // One series, one colour: a different hue per month would
                  // imply a category that isn't there.
                  color: chartColor(0)
                })),
              formatValue: (value) => formatCurrency(value, currency)
            })
          ])
        : null,

      Card({ class: "card--flush" }, [
        h("div", { class: "table-toolbar" }, [
          h("div", { class: "table-toolbar__search" }, [
            SelectField({
              label: "Holding",
              value: activityHoldingFilter,
              options: ["all", ...holdings.map((holding) => String(holding.id))],
              getLabel: (value) =>
                value === "all" ? "All holdings" : byId.get(Number(value))?.name ?? value,
              onChange: (value) => {
                activityHoldingFilter = value;
                requestRerender();
              }
            })
          ]),
          SegmentedControl({
            options: ["All", ...TRANSACTION_TYPES],
            value: activityTypeFilter,
            getLabel: (type) => TRANSACTION_LABELS[type] ?? type,
            label: "Filter by type",
            onChange: (value) => {
              activityTypeFilter = value;
              requestRerender();
            }
          })
        ]),

        filtered.length === 0
          ? h("div", { style: { padding: "0 1.25rem 1.25rem" } }, [
              EmptyState({
                icon: "⇄",
                title: all.length === 0 ? "No transactions recorded yet" : "Nothing matches this filter",
                description:
                  all.length === 0
                    ? "Open a position and add its buys, sells and dividends. Quantity and average cost are then derived from what you recorded, and realized gains and an annualized return become available."
                    : "Choose another holding or transaction type.",
                action:
                  all.length === 0
                    ? Button({ to: "/portfolio/holdings", variant: "primary" }, "Pick a position")
                    : null
              })
            ])
          : h("div", { class: "table-scroll" }, [
              h("table", { class: "table table--dense" }, [
                h("thead", {}, [
                  h("tr", {}, [
                    h("th", { scope: "col", text: "Date" }),
                    h("th", { scope: "col", text: "Holding" }),
                    h("th", { scope: "col", text: "Type" }),
                    h("th", { scope: "col", class: "table__cell--numeric", text: "Units" }),
                    h("th", { scope: "col", class: "table__cell--numeric", text: "Price" }),
                    h("th", { scope: "col", class: "table__cell--numeric", text: "Total" }),
                    h("th", { scope: "col", "aria-label": "Actions" })
                  ])
                ]),
                h(
                  "tbody",
                  {},
                  filtered.map((transaction) => {
                    const holding = byId.get(transaction.holdingId);
                    const cash = transactionCashFlow(transaction);

                    return h("tr", {}, [
                      h("td", { text: formatDate(transaction.date) }),
                      h("td", {}, [
                        h(
                          "a",
                          {
                            class: "table__name table__name--link",
                            href: href(`/portfolio/holdings/${holding.id}`)
                          },
                          [
                            h("strong", { text: holding.name }),
                            h("span", { text: transaction.note || holding.assetType })
                          ]
                        )
                      ]),
                      h("td", {}, [
                        StatusChip({
                          label: TRANSACTION_LABELS[transaction.type],
                          level:
                            transaction.type === "sell"
                              ? "watch"
                              : transaction.type === "dividend"
                                ? "good"
                                : "neutral",
                          size: "sm"
                        })
                      ]),
                      h("td", {
                        class: "table__cell--numeric",
                        text: transaction.type === "dividend" ? "—" : formatQuantity(transaction.quantity)
                      }),
                      h("td", {
                        class: "table__cell--numeric",
                        text:
                          transaction.type === "dividend"
                            ? "—"
                            : formatCurrency(transaction.price, holding.currency, 2)
                      }),
                      h("td", {
                        class: `table__cell--numeric ${cash >= 0 ? "value-up" : ""}`.trim(),
                        text: `${signPrefix(cash)}${formatCurrency(
                          Math.abs(cash),
                          holding.currency,
                          2
                        )}`
                      }),
                      h("td", {}, [
                        h("div", { class: "table__actions" }, [
                          h("button", {
                            type: "button",
                            class: "icon-button",
                            "aria-label": `Edit transaction from ${transaction.date}`,
                            title: "Edit",
                            text: "✎",
                            onclick: () => openTransactionModal({ holding, transaction })
                          }),
                          h("button", {
                            type: "button",
                            class: "icon-button icon-button--danger",
                            "aria-label": `Delete transaction from ${transaction.date}`,
                            title: "Delete",
                            text: "×",
                            onclick: () => confirmTransactionDelete(transaction, holding.name)
                          })
                        ])
                      ])
                    ]);
                  })
                )
              ])
            ])
      ]),

      ledger.sales.length > 0 ? RealizedCard({ ledger, currency }) : null
    ]
  });
}

function RealizedCard({ ledger, currency }) {
  return Card({ class: "card--flush" }, [
    h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [
      SectionHeader({
        eyebrow: "Realized",
        title: "Closed units",
        description:
          "Each sale against the cost of the oldest units it consumed. Fees are included; taxes are not modelled."
      })
    ]),
    h("div", { class: "table-scroll" }, [
      h("table", { class: "table table--dense" }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { scope: "col", text: "Date" }),
            h("th", { scope: "col", text: "Holding" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Units" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Cost" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Proceeds" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Result" })
          ])
        ]),
        h(
          "tbody",
          {},
          ledger.sales.map((sale) =>
            h("tr", {}, [
              h("td", { text: formatDate(sale.date) }),
              h("td", { text: sale.holding.name }),
              h("td", { class: "table__cell--numeric", text: formatQuantity(sale.quantity) }),
              h("td", {
                class: "table__cell--numeric",
                text: formatCurrency(sale.cost, sale.holding.currency, 2)
              }),
              h("td", {
                class: "table__cell--numeric",
                text: formatCurrency(sale.proceeds, sale.holding.currency, 2)
              }),
              h("td", { class: `table__cell--numeric ${sale.gainLoss >= 0 ? "value-up" : "value-down"}` }, [
                h("div", { class: "table__stack" }, [
                  h("strong", {
                    text: `${signPrefix(sale.gainLoss)}${formatCurrency(
                      sale.gainLoss,
                      sale.holding.currency,
                      2
                    )}`
                  }),
                  h("span", {
                    text:
                      sale.gainLossPercentage === null
                        ? ""
                        : `${signPrefix(sale.gainLossPercentage)}${formatPercent(sale.gainLossPercentage, 1)}`
                  })
                ])
              ])
            ])
          )
        )
      ])
    ])
  ]);
}

/* -------------------------------------------------------------------------- */
/* Allocation                                                                 */
/* -------------------------------------------------------------------------- */

export function PortfolioAllocationView() {
  const context = usePortfolio();
  const { holdings, currency, transactions } = context;

  if (holdings.length === 0) {
    return EmptyPortfolio({ context, path: "/portfolio/allocation" });
  }

  const { stats } = context;
  const signals = calculatePortfolioHealth(holdings, currency);
  const positions = buildPositionMap(holdings, {
    rangeKey: positionMapRange,
    priceSeries: readCachedSeries(),
    transactions,
    keyForHolding: historyKeyForHolding
  });
  const positionMapPeriod =
    POSITION_MAP_RANGES.find((range) => range.key === positionMapRange) ?? POSITION_MAP_RANGES.at(-1);
  const mappedReturns = positions.filter((position) => position.gainLossPercentage !== null).length;
  const exposure = buildCurrencyExposure(holdings, currency);

  return PortfolioPage({
    path: "/portfolio/allocation",
    context,
    children: [
      Card({ class: "position-map-card" }, [
        SectionHeader({
          eyebrow: "Position map",
          title: "Weight and return in one picture",
          description: `Tile size is today's share of tracked value; colour is ${
            positionMapRange === "ALL"
              ? "return since each position's first investment"
              : `${positionMapPeriod.label.toLowerCase()} price return`
          }.`
        }),
        SegmentedControl({
          options: POSITION_MAP_RANGES.map((range) => range.key),
          value: positionMapRange,
          getLabel: (key) => POSITION_MAP_RANGES.find((range) => range.key === key)?.label ?? key,
          label: "Position map period",
          onChange: (key) => {
            positionMapRange = key;
            requestRerender();
          }
        }),
        PositionMap({
          items: positions,
          formatTile: (item) =>
            `${item.title} · ${formatCurrency(item.value, currency)} · ${formatPercent(item.weight, 1)} · ${
              item.gainLossPercentage === null
                ? `${positionMapPeriod.label} return unavailable`
                : `${positionMapPeriod.label} ${signPrefix(item.gainLossPercentage)}${formatPercent(
                    item.gainLossPercentage,
                    1
                  )}${item.returnFrom ? ` since ${formatDate(item.returnFrom)}` : ""}`
            }`,
          ariaLabel: `${positionMapPeriod.label} position returns by current portfolio weight`
        }),
        h("div", { class: "map-legend" }, [
          h("span", { class: "map-legend__item map-legend__item--down-strong", text: "≤ -10%" }),
          h("span", { class: "map-legend__item map-legend__item--down", text: "-10 – 0%" }),
          h("span", { class: "map-legend__item map-legend__item--neutral", text: "Flat" }),
          h("span", { class: "map-legend__item map-legend__item--up", text: "0 – 10%" }),
          h("span", { class: "map-legend__item map-legend__item--up-strong", text: "≥ 10%" }),
          h("span", { class: "map-legend__item map-legend__item--unavailable", text: "No data" })
        ]),
        mappedReturns < positions.length
          ? h("div", { class: "position-map__coverage" }, [
              h("p", {
                class: "muted",
                text: `${mappedReturns} of ${positions.length} position returns are available for ${positionMapPeriod.label.toLowerCase()}. Historical periods need a market-linked holding with cached price history.`
              }),
              Button({ to: "/portfolio/history", variant: "ghost", size: "sm" }, "Load price history")
            ])
          : null
      ]),

      h(
        "div",
        { class: "grid grid--2" },
        allocationKeys.map((key) => AllocationCard({ holdings, currency, allocationKey: key }))
      ),

      TargetsCard({ context }),

      h("div", { class: "grid grid--sidebar" }, [
        Card({}, [
          SectionHeader({
            eyebrow: "Concentration",
            title: "How evenly it is spread",
            description: "Descriptive measures used by portfolio reports, not a rating of your holdings."
          }),
          h("div", { class: "grid grid--2" }, [
            MetricCard({
              label: "Largest position",
              value: formatPercent(stats.largestShare, 1),
              hint: stats.largest ? shortName(stats.largest.holding) : ""
            }),
            MetricCard({ label: "Top three", value: formatPercent(stats.topThreeShare, 1) }),
            MetricCard({
              label: "Effective positions",
              value: formatDecimal(stats.effectivePositions),
              hint: `Out of ${stats.positionCount} tracked`
            }),
            MetricCard({
              label: "Concentration index",
              value: formatDecimal(stats.herfindahl, 3),
              hint: "Herfindahl index: 1 is a single holding"
            }),
            MetricCard({
              label: "Cash share",
              value: formatPercent(stats.cashShare, 1),
              hint: "Tracked as Cash asset type"
            }),
            MetricCard({
              label: `Outside ${currency}`,
              value: formatPercent(stats.foreignCurrencyShare, 1),
              hint: `${stats.currencyCount} ${stats.currencyCount === 1 ? "currency" : "currencies"} tracked`
            })
          ])
        ]),
        h("div", { class: "stack" }, [
          Card({}, [
            SectionHeader({ eyebrow: "Currency", title: "Exposure by currency" }),
            h(
              "div",
              { class: "list" },
              exposure.map((bucket, index) =>
                h("div", { class: "list__row" }, [
                  h("span", { class: "list__row-copy" }, [
                    h("span", { class: "list__row-title" }, [
                      h("span", {
                        class: "chart-legend__dot",
                        "aria-hidden": "true",
                        style: { background: chartColor(index) }
                      }),
                      h("span", { text: `${bucket.label}${bucket.isBase ? " · base" : ""}` })
                    ]),
                    h("span", {
                      class: "list__row-detail",
                      text: `${bucket.count} ${bucket.count === 1 ? "position" : "positions"} · ${formatCurrency(
                        bucket.value,
                        currency
                      )}`
                    })
                  ]),
                  h("span", { class: "list__row-value", text: formatPercent(bucket.percentage, 1) })
                ])
              )
            )
          ]),
          signals.length > 0 ? SignalsCard({ signals }) : null
        ])
      ])
    ]
  });
}

/**
 * Target mix and drift.
 *
 * Drift is stated, not acted on — and the only plan offered is where to point
 * the next contribution, which moves a portfolio toward its target without a
 * single sell order. FirePath never tells anyone to sell.
 */
function TargetsCard({ context }) {
  const { holdings, currency, profile } = context;
  const targets = profile?.targetAllocation ?? {};
  const drift = buildAllocationDrift(holdings, targets);
  const contribution = profile?.monthlyInvestment ?? 0;
  const plan = planContribution(drift, contribution);

  if (!drift.hasTargets) {
    return Card({}, [
      SectionHeader({
        eyebrow: "Targets",
        title: "No target mix set",
        description: "Set the split you are aiming for and this screen shows how far the portfolio has drifted from it.",
        action: Button(
          { variant: "secondary", size: "sm", onclick: () => openTargetsModal({ profile, holdings }) },
          "Set targets"
        )
      })
    ]);
  }

  return Card({}, [
    SectionHeader({
      eyebrow: "Targets",
      title: "Target mix and drift",
      description: drift.isBalanced
        ? "Your target split against what the tracked holdings currently are."
        : `Your targets add up to ${formatPercent(drift.targetTotal, 0)}. Drift is measured against them as entered.`,
      action: Button(
        { variant: "ghost", size: "sm", onclick: () => openTargetsModal({ profile, holdings }) },
        "Edit targets"
      )
    }),

    h("div", { class: "table-scroll" }, [
      h("table", { class: "table table--dense" }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { scope: "col", text: "Group" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Target" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Actual" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Drift" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Difference" })
          ])
        ]),
        h(
          "tbody",
          {},
          drift.rows.map((row) =>
            h("tr", {}, [
              h("td", { text: row.label }),
              h("td", { class: "table__cell--numeric", text: formatPercent(row.targetPercentage, 1) }),
              h("td", { class: "table__cell--numeric", text: formatPercent(row.actualPercentage, 1) }),
              h("td", {
                class: `table__cell--numeric ${Math.abs(row.drift) >= 0.05 ? "value-down" : ""}`.trim(),
                text: `${signPrefix(row.drift)}${formatPercent(row.drift, 1)}`
              }),
              h("td", {
                class: "table__cell--numeric",
                text: `${signPrefix(row.difference)}${formatCurrency(row.difference, currency)}`
              })
            ])
          )
        )
      ])
    ]),

    plan.length > 0
      ? h("div", { class: "stack stack--tight" }, [
          h("p", {
            class: "inline-note inline-note--good",
            text: `Pointing your next ${formatCurrency(
              contribution,
              currency
            )} contribution at the groups below moves the mix toward your target without selling anything.`
          }),
          WeightBars({
            rows: plan.map((row) => ({
              label: row.label,
              sublabel: `${formatPercent(row.actualPercentage, 1)} now, target ${formatPercent(
                row.targetPercentage,
                0
              )}`,
              value: row.amount
            })),
            formatValue: (value) => formatCurrency(value, currency)
          })
        ])
      : contribution > 0
        ? h("p", {
            class: "inline-note",
            text: "Every group is at or above its target, so a contribution split cannot be suggested without selling — which FirePath does not do."
          })
        : h("p", {
            class: "inline-note",
            text: "Add a monthly investment amount in your plan settings to see where the next contribution would go."
          })
  ]);
}

function openTargetsModal({ profile, holdings }) {
  const present = [...new Set(holdings.map((holding) => holding.assetType))];
  const existing = profile?.targetAllocation ?? {};
  const options = [...new Set([...assetTypes, ...present, ...Object.keys(existing)])];
  const draft = Object.fromEntries(
    options.map((type) => [type, existing[type] ? String(Math.round(existing[type] * 1000) / 10) : ""])
  );

  let error = "";
  const body = h("div", { class: "stack" });

  const modal = openModal({
    title: "Target allocation",
    description: "The asset-type split you are aiming for. Leave a row empty to exclude it.",
    content: body,
    actions: [
      Button({ variant: "ghost", onclick: () => modal.close() }, "Cancel"),
      Button({ variant: "primary", onclick: () => save() }, "Save targets")
    ]
  });

  render();

  function total() {
    return options.reduce((sum, type) => sum + (parsePositiveNumber(draft[type]) || 0), 0);
  }

  function render() {
    const sum = total();

    body.replaceChildren(...[
      h("div", { class: "field-grid" },
        options.map((type) =>
          Field({
            label: `${type} (%)`,
            value: draft[type],
            inputMode: "decimal",
            onInput: (value) => {
              draft[type] = value;
              renderTotal();
            }
          })
        )
      ),
      h("div", { class: "ledger-preview" }, [
        h("div", { class: "ledger-preview__row" }, [
          h("span", { class: "ledger-preview__label", text: "Total" }),
          h("strong", {
            class: `ledger-preview__value ${Math.abs(sum - 100) < 0.5 ? "value-up" : "value-down"}`,
            text: `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(sum)}%`
          })
        ])
      ]),
      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null
    ].filter(Boolean));
  }

  function renderTotal() {
    const value = body.querySelector(".ledger-preview__value");
    if (!value) return;
    const sum = total();
    value.textContent = `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(sum)}%`;
    value.className = `ledger-preview__value ${Math.abs(sum - 100) < 0.5 ? "value-up" : "value-down"}`;
  }

  function save() {
    const sum = total();

    if (sum === 0) {
      // Clearing every row is a deliberate way to switch targets off again.
      patchProfile({ targetAllocation: {} });
      toast("Target allocation cleared.", { level: "info" });
      modal.close();
      requestRerender();
      return;
    }

    if (Math.abs(sum - 100) > 0.5) {
      error = `Targets add up to ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
        sum
      )}%. Adjust them to 100% before saving.`;
      render();
      return;
    }

    const targetAllocation = Object.fromEntries(
      options
        .map((type) => [type, parsePositiveNumber(draft[type]) / 100])
        .filter(([, share]) => share > 0)
    );

    patchProfile({ targetAllocation });
    toast("Target allocation saved.");
    modal.close();
    requestRerender();
  }
}

function AllocationCard({ holdings, currency, allocationKey }) {
  const slices = buildAllocation(holdings, allocationKey);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return Card({}, [
    SectionHeader({
      eyebrow: "Allocation",
      title: allocationLabels[allocationKey],
      description: `${slices.length} ${slices.length === 1 ? "group" : "groups"}`
    }),
    h("div", { class: "donut-block" }, [
      DonutChart({
        slices,
        size: 176,
        thickness: 20,
        centerValue: formatCompactCurrency(total, currency),
        centerLabel: allocationLabels[allocationKey],
        ariaLabel: `${allocationLabels[allocationKey]} allocation`
      })
    ]),
    ChartLegend({
      slices,
      formatValue: (slice) => formatCurrency(slice.value, currency)
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

/* -------------------------------------------------------------------------- */
/* Performance                                                                */
/* -------------------------------------------------------------------------- */

export function PortfolioPerformanceView() {
  const context = usePortfolio();
  const { holdings, currency } = context;

  if (holdings.length === 0) {
    return EmptyPortfolio({ context, path: "/portfolio/performance" });
  }

  const { stats, ledger } = context;
  const ranking = buildPerformanceRanking(holdings);
  const movers = buildDayMovers(holdings);
  const gainLevel = stats.unrealizedGainLoss >= 0 ? "good" : "risk";
  const totalReturn = stats.unrealizedGainLoss + ledger.realizedGainLoss + ledger.dividends;

  return PortfolioPage({
    path: "/portfolio/performance",
    context,
    children: [
      h("div", { class: "grid grid--4" }, [
        MetricCard({
          label: "Unrealized result",
          value: `${signPrefix(stats.unrealizedGainLoss)}${formatCurrency(stats.unrealizedGainLoss, currency)}`,
          status: { label: stats.unrealizedGainLoss >= 0 ? "Gain" : "Loss", level: gainLevel },
          hint:
            stats.gainLossPercentage === null
              ? "Add buy prices to compute a return"
              : `${signPrefix(stats.gainLossPercentage)}${formatPercent(
                  stats.gainLossPercentage,
                  1
                )} against ${formatCurrency(stats.totalInvested, currency)} invested`
        }),
        MetricCard({
          label: "Winners vs losers",
          value: `${stats.winners} / ${stats.losers}`,
          hint: `${stats.flat} unchanged`
        }),
        MetricCard({
          label: "Best performer",
          value: stats.best
            ? `${signPrefix(stats.best.gainLossPercentage)}${formatPercent(stats.best.gainLossPercentage, 1)}`
            : "—",
          hint: stats.best ? shortName(stats.best.holding) : ""
        }),
        MetricCard({
          label: "Weakest performer",
          value: stats.worst
            ? `${signPrefix(stats.worst.gainLossPercentage)}${formatPercent(stats.worst.gainLossPercentage, 1)}`
            : "—",
          hint: stats.worst ? shortName(stats.worst.holding) : ""
        })
      ]),

      ledger.isEmpty
        ? Card({ tone: "accent" }, [
            h("div", { class: "stack stack--tight" }, [
              h("p", { class: "eyebrow", text: "Unlock the real return" }),
              h("h2", {
                class: "section-header__title",
                text: "These figures compare prices, not your actual money"
              }),
              h("p", {
                class: "muted",
                text: "Without transactions, a return is only today's price against one average buy price — it cannot tell a lump sum apart from years of monthly buys, and it knows nothing about what you already sold or received as dividends."
              })
            ]),
            h("div", { class: "row" }, [
              Button({ to: "/portfolio/activity", variant: "secondary" }, "Start a transaction ledger")
            ])
          ])
        : h("div", { class: "grid grid--4" }, [
            MetricCard({
              label: "Total return",
              value: `${signPrefix(totalReturn)}${formatCurrency(totalReturn, currency)}`,
              status: { label: totalReturn >= 0 ? "Gain" : "Loss", level: totalReturn >= 0 ? "good" : "risk" },
              hint: "Unrealized, realized and dividends together"
            }),
            MetricCard({
              label: "Realized",
              value: `${signPrefix(ledger.realizedGainLoss)}${formatCurrency(ledger.realizedGainLoss, currency)}`,
              hint: `${ledger.sales.length} ${ledger.sales.length === 1 ? "sale" : "sales"} recorded`
            }),
            MetricCard({
              label: "Dividends",
              value: formatCurrency(ledger.dividends, currency),
              hint: `Net of ${formatCurrency(ledger.fees, currency)} fees and withholding`
            }),
            MetricCard({
              label: "Annualized return",
              value: ledger.xirr === null ? "—" : `${signPrefix(ledger.xirr)}${formatPercent(ledger.xirr, 1)}`,
              hint:
                ledger.xirr === null
                  ? "Needs at least one buy and a current value"
                  : `Money-weighted, covering ${formatPercent(ledger.xirrCoverage, 0)} of value`
            })
          ]),

      ReturnComparisonCard({ context }),
      YearlyPerformanceCard({ context }),

      Card({}, [
        SectionHeader({
          eyebrow: "Contribution",
          title: "What moved the portfolio",
          description: "Unrealized gain or loss per position, largest first."
        }),
        DivergingBars({
          rows: ranking.map((row) => ({
            label: shortName(row.holding),
            sublabel: `${formatPercent(row.share, 1)} of portfolio · ${
              row.gainLossPercentage === null
                ? "no buy price"
                : `${signPrefix(row.gainLossPercentage)}${formatPercent(row.gainLossPercentage, 1)}`
            }`,
            value: row.gainLoss
          })),
          formatValue: (value) => `${signPrefix(value)}${formatCurrency(value, currency)}`
        })
      ]),

      h("div", { class: "grid grid--sidebar" }, [
        Card({ class: "card--flush" }, [
          h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [
            SectionHeader({
              eyebrow: "Detail",
              title: "Return by position",
              description:
                "Simple return against your average buy price. It excludes dividends, fees, taxes and the timing of each purchase."
            })
          ]),
          h("div", { class: "table-scroll" }, [
            h("table", { class: "table table--dense" }, [
              h("thead", {}, [
                h("tr", {}, [
                  h("th", { scope: "col", text: "Holding" }),
                  h("th", { scope: "col", class: "table__cell--numeric", text: "Invested" }),
                  h("th", { scope: "col", class: "table__cell--numeric", text: "Value" }),
                  h("th", { scope: "col", class: "table__cell--numeric", text: "Return" }),
                  h("th", { scope: "col", class: "table__cell--numeric", text: "Contribution" })
                ])
              ]),
              h(
                "tbody",
                {},
                ranking.map((row) =>
                  h("tr", {}, [
                    h("td", {}, [
                      h("div", { class: "table__name" }, [
                        h("strong", { text: row.holding.name }),
                        h("span", { text: [row.holding.assetType, row.holding.ticker].filter(Boolean).join(" · ") })
                      ])
                    ]),
                    h("td", { class: "table__cell--numeric", text: formatCurrency(row.invested, currency) }),
                    h("td", { class: "table__cell--numeric", text: formatCurrency(row.value, currency) }),
                    h("td", {
                      class: `table__cell--numeric ${row.gainLoss >= 0 ? "value-up" : "value-down"}`,
                      text:
                        row.gainLossPercentage === null
                          ? "—"
                          : `${signPrefix(row.gainLossPercentage)}${formatPercent(row.gainLossPercentage, 1)}`
                    }),
                    h("td", {
                      class: `table__cell--numeric ${row.contribution >= 0 ? "value-up" : "value-down"}`,
                      text: `${signPrefix(row.contribution)}${formatPercent(row.contribution, 2)}`
                    })
                  ])
                )
              )
            ])
          ])
        ]),
        h("div", { class: "stack" }, [
          DayMoversCard({ movers, currency, stats }),
          Card({}, [
            SectionHeader({ eyebrow: "Position sizes", title: "Spread of your positions" }),
            h("div", { class: "grid grid--2" }, [
              MetricCard({ label: "Average", value: formatCurrency(stats.averagePosition, currency) }),
              MetricCard({ label: "Median", value: formatCurrency(stats.medianPosition, currency) }),
              MetricCard({
                label: "Priced live",
                value: formatPercent(stats.marketLinkedShare, 0),
                hint: "Share of value on market quotes"
              }),
              MetricCard({
                label: "Asset classes",
                value: String(stats.assetClassCount),
                hint: `${stats.sectorCount} ${stats.sectorCount === 1 ? "sector" : "sectors"} tagged`
              })
            ])
          ])
        ])
      ])
    ]
  });
}

/**
 * The two returns side by side.
 *
 * They answer different questions and disagreeing is normal: XIRR measures what
 * your money earned given when you paid it in, TWR measures the portfolio
 * itself. Only the second can be compared against an index.
 */
function ReturnComparisonCard({ context }) {
  const { ledger } = context;
  const rebuild = buildReconstruction(context);

  if (!rebuild.available && ledger.xirr === null) {
    return null;
  }

  const twr = rebuild.available ? rebuild.twr : null;
  const gap = twr && ledger.xirr !== null && twr.annualized !== null ? ledger.xirr - twr.annualized : null;

  return Card({}, [
    SectionHeader({
      eyebrow: "Return",
      title: "Two honest answers",
      description: "A portfolio has more than one return, and which one is right depends on the question."
    }),
    h("div", { class: "grid grid--2" }, [
      MetricCard({
        label: "Your money's return (XIRR)",
        value: ledger.xirr === null ? "—" : `${signPrefix(ledger.xirr)}${formatPercent(ledger.xirr, 1)}`,
        hint: "Annualized, weighted by when you paid in"
      }),
      MetricCard({
        label: "The portfolio's return (TWR)",
        value:
          twr === null || twr.annualized === null
            ? "—"
            : `${signPrefix(twr.annualized)}${formatPercent(twr.annualized, 1)}`,
        hint:
          twr === null
            ? "Rebuild price history to compute this"
            : "Annualized, unaffected by contributions"
      })
    ]),
    gap === null
      ? h("p", {
          class: "muted",
          text: "Rebuild your price history on the History screen to see both side by side."
        })
      : h("p", {
          class: "muted",
          text:
            Math.abs(gap) < 0.005
              ? "The two agree, which means the timing of your contributions has made little difference so far."
              : gap > 0
                ? `Your money earned ${formatPercent(
                    Math.abs(gap),
                    1
                  )} a year more than the portfolio itself — your contributions landed at good moments.`
                : `Your money earned ${formatPercent(
                    Math.abs(gap),
                    1
                  )} a year less than the portfolio itself — more of your money arrived after the gains than before them.`
        }),
    Button({ to: "/portfolio/history", variant: "ghost", size: "sm" }, "History and benchmark")
  ]);
}

/**
 * Calendar-year breakdown.
 *
 * Returns are time-weighted, so a year that received a large contribution is
 * not credited for it — the point of comparing years is to see how the holdings
 * behaved, not how much was paid in.
 */
function YearlyPerformanceCard({ context }) {
  const { currency } = context;
  const rebuild = buildReconstruction(context);

  if (!rebuild.available || rebuild.yearly.length === 0) {
    return Card({}, [
      SectionHeader({
        eyebrow: "Year by year",
        title: "Yearly returns need price history",
        description:
          "A year's return can only be measured from what the portfolio was worth at each year end. Rebuild the price history and this fills in for every year your ledger covers."
      }),
      Button({ to: "/portfolio/history", variant: "secondary", size: "sm" }, "Rebuild price history")
    ]);
  }

  const years = [...rebuild.yearly].reverse();
  const complete = rebuild.yearly.filter((year) => !year.isPartial && year.twr !== null);
  const best = complete.reduce((selected, year) => (!selected || year.twr > selected.twr ? year : selected), null);
  const worst = complete.reduce((selected, year) => (!selected || year.twr < selected.twr ? year : selected), null);
  const benchmarkSymbol = rebuild.benchmarkSymbol;
  const hasBenchmark = years.some((year) => year.benchmarkReturn !== null);

  return Card({}, [
    SectionHeader({
      eyebrow: "Year by year",
      title: `${complete.length} full ${complete.length === 1 ? "year" : "years"} on record`,
      description: `Time-weighted, so contributions never count as performance. Covers ${formatPercent(
        rebuild.series.coverage,
        0
      )} of tracked value.`,
      action:
        best && worst && best.year !== worst.year
          ? StatusChip({
              label: `Best ${best.year} · Weakest ${worst.year}`,
              level: "neutral"
            })
          : null
    }),

    GroupedBars({
      rows: years.map((year) => ({
        label: year.isPartial ? `${year.year} YTD` : String(year.year),
        sublabel: `${signPrefix(year.contributions)}${formatCompactCurrency(year.contributions, currency)} paid in`,
        values: hasBenchmark
          ? [
              { label: "Portfolio", value: year.twr },
              { label: benchmarkSymbol, value: year.benchmarkReturn }
            ]
          : [{ label: "Portfolio", value: year.twr }]
      })),
      formatValue: (value) => `${signPrefix(value)}${formatPercent(value, 1)}`,
      legend: hasBenchmark ? [{ label: "Your portfolio" }, { label: benchmarkSymbol }] : []
    }),

    h("div", { class: "table-scroll" }, [
      h("table", { class: "table table--dense" }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { scope: "col", text: "Year" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Start" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "End" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Paid in" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Return" }),
            hasBenchmark
              ? h("th", { scope: "col", class: "table__cell--numeric", text: `vs ${benchmarkSymbol}` })
              : null,
            h("th", { scope: "col", class: "table__cell--numeric", text: "Realized" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Dividends" })
          ].filter(Boolean))
        ]),
        h(
          "tbody",
          {},
          years.map((year) =>
            h("tr", {}, [
              h("td", {}, [
                h("div", { class: "table__name" }, [
                  h("strong", { text: String(year.year) }),
                  h("span", {
                    text: year.isPartial
                      ? "Year to date"
                      : `${year.trades} ${year.trades === 1 ? "trade" : "trades"}`
                  })
                ])
              ]),
              h("td", { class: "table__cell--numeric", text: formatCurrency(year.startValue, currency) }),
              h("td", { class: "table__cell--numeric", text: formatCurrency(year.endValue, currency) }),
              h("td", { class: "table__cell--numeric", text: formatCurrency(year.contributions, currency) }),
              h("td", {
                class: `table__cell--numeric ${
                  year.twr === null ? "" : year.twr >= 0 ? "value-up" : "value-down"
                }`.trim(),
                text: year.twr === null ? "—" : `${signPrefix(year.twr)}${formatPercent(year.twr, 1)}`
              }),
              hasBenchmark
                ? h("td", {
                    class: `table__cell--numeric ${
                      year.difference === null ? "" : year.difference >= 0 ? "value-up" : "value-down"
                    }`.trim(),
                    text:
                      year.difference === null
                        ? "—"
                        : `${signPrefix(year.difference)}${formatPercent(year.difference, 1)}`
                  })
                : null,
              h("td", {
                class: `table__cell--numeric ${
                  year.realized === 0 ? "" : year.realized > 0 ? "value-up" : "value-down"
                }`.trim(),
                text:
                  year.realized === 0
                    ? "—"
                    : `${signPrefix(year.realized)}${formatCurrency(year.realized, currency)}`
              }),
              h("td", {
                class: "table__cell--numeric",
                text: year.dividends === 0 ? "—" : formatCurrency(year.dividends, currency)
              })
            ].filter(Boolean))
          )
        )
      ])
    ]),

    h("p", {
      class: "muted",
      text: `Each year is measured from the last valuation of the year before, so the years chain together into the total.${
        hasBenchmark
          ? ` ${benchmarkSymbol} is measured in its own currency, so part of every gap is exchange-rate movement.`
          : ""
      }`
    })
  ]);
}

function DayMoversCard({ movers, currency, stats }) {
  if (movers.length === 0) {
    return Card({}, [
      SectionHeader({ eyebrow: "Latest session", title: "No live quotes yet" }),
      h("p", {
        class: "muted",
        text: "Day movement needs a previous close, which comes with market-linked holdings. Connect market data or refresh prices to fill this in."
      }),
      Button({ to: "/settings/market-data", variant: "ghost", size: "sm" }, "Market data settings")
    ]);
  }

  return Card({}, [
    SectionHeader({
      eyebrow: "Latest session",
      title: stats.dayChange
        ? `${signPrefix(stats.dayChange.value)}${formatCurrency(stats.dayChange.value, currency)}`
        : "—",
      description: stats.dayChange
        ? `Since the previous close, covering ${formatPercent(stats.dayChange.coverage, 0)} of tracked value.`
        : "",
      action:
        stats.dayChange && stats.dayChange.percentage !== null
          ? StatusChip({
              label: `${signPrefix(stats.dayChange.percentage)}${formatPercent(stats.dayChange.percentage, 2)}`,
              level: stats.dayChange.value >= 0 ? "good" : "risk"
            })
          : null
    }),
    DivergingBars({
      rows: movers.slice(0, 6).map((row) => ({
        label: shortName(row.holding),
        sublabel:
          row.dayChangePercentage === null
            ? ""
            : `${signPrefix(row.dayChangePercentage)}${formatPercent(row.dayChangePercentage, 2)}`,
        value: row.dayChange
      })),
      formatValue: (value) => `${signPrefix(value)}${formatCurrency(value, currency)}`
    })
  ]);
}

/* -------------------------------------------------------------------------- */
/* History                                                                    */
/* -------------------------------------------------------------------------- */

export function PortfolioHistoryView() {
  const context = usePortfolio();
  const { holdings, currency, history, valueHistory, hasTransactionHistory, transactions } = context;

  if (holdings.length === 0) {
    return EmptyPortfolio({ context, path: "/portfolio/history" });
  }

  const rebuild = buildReconstruction(context);
  const ranged = selectHistoryRange(valueHistory, historyRange);
  const summary = summarizeHistory(ranged);
  const periods = HISTORY_RANGES.map((range) => {
    const points = selectHistoryRange(valueHistory, range.key);
    return { ...range, points, summary: points.length >= 2 ? summarizeHistory(points) : null };
  });

  return PortfolioPage({
    path: "/portfolio/history",
    context,
    children: [
      rebuild.available
        ? RebuiltHistoryCard({ rebuild, context })
        : HistoryCard({
            history: valueHistory,
            currency,
            estimatedFromTransactions: hasTransactionHistory
          }),
      rebuild.available ? BenchmarkCard({ rebuild, context }) : null,
      rebuild.available ? DrawdownCard({ rebuild, currency }) : null,
      RebuildStatusCard({ rebuild, context }),

      valueHistory.length < 2 && !rebuild.available
        ? Card({}, [
            EmptyState({
              icon: "◷",
              title: "History is still being recorded",
              description:
                "FirePath has no broker connection. Until price history is rebuilt from your ledger, the chart is built from the days this browser has seen — open the portfolio on another day and it fills in."
            })
          ])
        : h("div", { class: "grid grid--sidebar" }, [
            h("div", { class: "stack" }, [
              valueHistory.length >= 2
                ? Card({}, [
                    SectionHeader({
                      eyebrow: hasTransactionHistory ? "Imported range" : "Recorded range",
                      title: `${formatPercent(summary.changePercentage ?? 0, 1)} over ${
                        HISTORY_RANGES.find((range) => range.key === historyRange)?.label ?? "the range"
                      }`,
                      description: hasTransactionHistory
                        ? describeTransactionHistoryCoverage(valueHistory)
                        : describeHistoryCoverage(history)
                    }),
                    h("div", { class: "grid grid--2" }, [
                      MetricCard({
                        label: "Change",
                        value: `${signPrefix(summary.change)}${formatCurrency(summary.change, currency)}`,
                        hint: `Of which ${signPrefix(summary.contributionChange)}${formatCurrency(
                          summary.contributionChange,
                          currency
                        )} is money added`
                      }),
                      MetricCard({
                        label: "Highest",
                        value: summary.high ? formatCurrency(summary.high.value, currency) : "—",
                        hint: summary.high ? formatDate(summary.high.date) : ""
                      }),
                      MetricCard({
                        label: "Lowest",
                        value: summary.low ? formatCurrency(summary.low.value, currency) : "—",
                        hint: summary.low ? formatDate(summary.low.date) : ""
                      }),
                      MetricCard({
                        label: "Largest drop from a peak",
                        value: formatPercent(summary.maxDrawdown, 1),
                        hint: "Within the recorded range"
                      })
                    ])
                  ])
                : null,
              SnapshotsCard({ history, currency })
            ]),
            h("div", { class: "stack" }, [
              Card({}, [
                SectionHeader({ eyebrow: "Periods", title: "Change over time" }),
                h(
                  "div",
                  { class: "list" },
                  periods.map((period) =>
                    h("div", { class: "list__row" }, [
                      h("span", { class: "list__row-copy" }, [
                        h("span", { class: "list__row-title", text: period.label }),
                        h("span", {
                          class: "list__row-detail",
                          text: period.summary
                            ? `From ${formatCurrency(period.summary.first.value, currency)} on ${formatDate(
                                period.summary.first.date
                              )}`
                            : "Not enough history recorded yet"
                        })
                      ]),
                      h("span", {
                        class: `list__row-value ${
                          period.summary ? (period.summary.change >= 0 ? "value-up" : "value-down") : ""
                        }`.trim(),
                        text: period.summary
                          ? `${signPrefix(period.summary.change)}${formatCurrency(period.summary.change, currency)}`
                          : "—"
                      })
                    ])
                  )
                )
              ]),
              Card({}, [
                SectionHeader({ eyebrow: "Extremes", title: "Biggest recorded moves" }),
                h("div", { class: "grid grid--2" }, [
                  MetricCard({
                    label: "Best day",
                    value: summary.bestDay
                      ? `${signPrefix(summary.bestDay.change)}${formatCurrency(summary.bestDay.change, currency)}`
                      : "—",
                    hint: summary.bestDay ? `Ending ${formatDate(summary.bestDay.date)}` : ""
                  }),
                  MetricCard({
                    label: "Worst day",
                    value: summary.worstDay
                      ? `${signPrefix(summary.worstDay.change)}${formatCurrency(summary.worstDay.change, currency)}`
                      : "—",
                    hint: summary.worstDay ? `Ending ${formatDate(summary.worstDay.date)}` : ""
                  })
                ]),
                h("p", {
                  class: "muted",
                  text: hasTransactionHistory
                    ? "Imported points use the latest trade price known on each transaction date; browser snapshots use the observed portfolio value."
                    : "A day is only recorded when you open FirePath, so gaps are days you did not visit."
                }),
                Button(
                  {
                    variant: "ghost",
                    size: "sm",
                    onclick: async () => {
                      const confirmed = await confirmAction({
                        title: "Clear recorded history?",
                        description:
                          "This deletes the saved daily snapshots from this browser. Holdings and totals stay. Recording starts again from today.",
                        confirmLabel: "Clear history"
                      });

                      if (confirmed) {
                        clearPortfolioHistory();
                        toast("Portfolio history cleared.", { level: "info" });
                      }
                    }
                  },
                  "Clear recorded history"
                )
              ])
            ])
          ])
    ]
  });
}

/**
 * Rebuilds the value history from the ledger and cached price bars, and derives
 * the returns that only a real time series can answer.
 */
function buildReconstruction(context) {
  const { holdings, transactions, currency } = context;
  const rebuildable = holdingsWithRebuildableHistory(holdings, transactions);
  const cached = readCachedSeries();
  const benchmarkSymbol = getMarketDataSettings().benchmarkSymbol;
  const fxInstruments = historyFxInstruments(rebuildable, cached, currency);

  const missing = rebuildable.filter((holding) => !cached[historyKeyForHolding(holding)]);
  const missingFx = fxInstruments.filter((instrument) => !cached[seriesKey(instrument.symbol, "")]);
  const series = reconstructPortfolioSeries({
    holdings: rebuildable,
    allHoldings: holdings,
    transactions,
    seriesByKey: cached,
    keyForHolding: historyKeyForHolding,
    baseCurrency: currency
  });

  if (series.isEmpty || series.points.length < 2) {
    return {
      available: false,
      rebuildable,
      missing,
      missingFx,
      benchmarkSymbol,
      benchmarkCached: Boolean(cached[seriesKey(benchmarkSymbol, "")]),
      currency
    };
  }

  const twr = calculateTimeWeightedReturn(series.points, series.cashFlows);
  const risk = calculateRiskMetrics(series.points, twr.dailyReturns, {
    drawdownPoints: twr.indexSeries
  });
  const benchmarkBars = cached[seriesKey(benchmarkSymbol, "")]?.bars ?? [];
  const comparison =
    benchmarkBars.length > 0
      ? alignBenchmark(series.points, benchmarkBars, { portfolioIndex: twr.indexSeries })
      : null;

  return {
    available: true,
    series,
    twr,
    risk,
    comparison,
    benchmarkBars,
    yearly: buildYearlyPerformance({
      points: series.points,
      indexSeries: twr.indexSeries,
      cashFlows: series.cashFlows,
      holdings: rebuildable,
      transactions,
      seriesByKey: cached,
      baseCurrency: currency,
      benchmarkBars
    }),
    benchmarkSymbol,
    benchmarkCached: benchmarkBars.length > 0,
    rebuildable,
    missing,
    missingFx,
    currency
  };
}

function RebuiltHistoryCard({ rebuild, context }) {
  const { currency } = context;
  const { series, twr, risk } = rebuild;
  const rangedPoints = selectSeriesRange(series.points, historyRange);
  const first = rangedPoints[0];
  const last = rangedPoints[rangedPoints.length - 1];
  const investedByDate = new Map(series.invested.map((point) => [point.label, point.value]));
  const rangeSummary = summarizeHistory(
    rangedPoints.map((point) => ({
      date: point.label,
      value: point.value,
      invested: investedByDate.get(point.label) ?? 0,
      positions: 0
    }))
  );
  const rangedInvested = rangedPoints.map((point) => ({
    label: point.label,
    value: investedByDate.get(point.label) ?? 0
  }));
  const level = rangeSummary.change >= 0 ? "good" : "risk";
  const rangeLabel = HISTORY_RANGES.find((range) => range.key === historyRange)?.label ?? historyRange;

  return Card({}, [
    SectionHeader({
      eyebrow: "Rebuilt from your ledger",
      title: formatCurrency(last.value, currency),
      description: `${signPrefix(rangeSummary.change)}${formatCurrency(
        rangeSummary.change,
        currency
      )} across ${rangeLabel}, from ${formatDate(first.label)} · ${rangedPoints.length} daily points.`,
      action: StatusChip({
        label: `${signPrefix(rangeSummary.changePercentage ?? 0)}${formatPercent(
          rangeSummary.changePercentage ?? 0,
          1
        )}`,
        level
      })
    }),
    HistoryRangeControl(),
    AreaChart({
      points: rangedPoints,
      comparison: rangedInvested,
      comparisonLabel: "Dashed line: net money invested",
      height: 300,
      formatValue: (value) => formatCompactCurrency(value, currency),
      formatLabel: (point) => formatDate(point.label),
      formatTooltip: (point) => formatCurrency(point.value, currency),
      ariaLabel: "Rebuilt portfolio value",
      tone: rangeSummary.change >= 0 ? "primary" : "accent"
    }),
    RangeDetailMetrics({ summary: rangeSummary, currency }),
    SectionHeader({
      eyebrow: "Full rebuilt history",
      title: "Return and risk",
      description: "These measures use the complete rebuilt series, independent of the chart range above."
    }),
    h("div", { class: "grid grid--4" }, [
      MetricCard({
        label: "Time-weighted (TWR)",
        value: `${signPrefix(twr.total)}${formatPercent(twr.total, 1)}`,
        hint:
          twr.annualized === null
            ? "Over the rebuilt period; comparable to an index"
            : `${signPrefix(twr.annualized)}${formatPercent(
                twr.annualized,
                1
              )} a year; comparable to an index`
      }),
      MetricCard({
        label: "Volatility",
        value: risk.volatility === null ? "—" : formatPercent(risk.volatility, 1),
        hint: "Annualized from daily moves"
      }),
      MetricCard({
        label: "Largest drawdown",
        value: formatPercent(risk.maxDrawdown, 1),
        hint: "Deepest fall from a peak"
      }),
      MetricCard({
        label: "Best / worst move",
        value:
          risk.bestDay === null
            ? "—"
            : `${signPrefix(risk.bestDay)}${formatPercent(risk.bestDay, 1)} / ${formatPercent(risk.worstDay, 1)}`,
        hint: "Single-day extremes"
      })
    ]),
    h("p", {
      class: "inline-note",
      text: `Rebuilt from ${rebuild.rebuildable.length} of ${
        rebuild.rebuildable.length + series.excludedHoldings.length
      } positions, covering ${formatPercent(series.coverage, 0)} of tracked value — so this line is not your whole portfolio.${
        series.excludedHoldings.length > 0
          ? ` Not included: ${series.excludedHoldings.join(", ")}. Each needs a market symbol and a transaction ledger.`
          : ""
      }`
    })
  ]);
}

/**
 * Portfolio against an index.
 *
 * The portfolio line is its time-weighted growth, not its value, so money paid
 * in never shows up as outperformance.
 */
function BenchmarkCard({ rebuild, context }) {
  const { comparison, benchmarkSymbol, twr } = rebuild;

  if (comparison === null || comparison.benchmark.length < 2) {
    return Card({}, [
      SectionHeader({
        eyebrow: "Benchmark",
        title: benchmarkSymbol ? `${benchmarkSymbol} history not loaded yet` : "No benchmark selected",
        description: benchmarkSymbol
          ? "Rebuild history to fetch the index and compare your return against it."
          : "Pick an index to compare your time-weighted return against."
      }),
      BenchmarkPicker({ benchmarkSymbol })
    ]);
  }

  const difference = twr.total - comparison.benchmarkReturn;

  return Card({}, [
    SectionHeader({
      eyebrow: "Benchmark",
      title: `You ${difference >= 0 ? "outpaced" : "trailed"} ${benchmarkSymbol} by ${formatPercent(
        Math.abs(difference),
        1
      )}`,
      description: "Both rebased to 100 at the start of the rebuilt period.",
      action: StatusChip({
        label: `${signPrefix(comparison.benchmarkReturn)}${formatPercent(comparison.benchmarkReturn, 1)} index`,
        level: "neutral"
      })
    }),
    AreaChart({
      points: comparison.portfolio,
      comparison: comparison.benchmark,
      comparisonLabel: `Dashed line: ${benchmarkSymbol}`,
      height: 260,
      formatValue: (value) => value.toFixed(0),
      formatLabel: (point) => formatDate(point.label),
      formatTooltip: (point) => `Your return index ${point.value.toFixed(1)}`,
      ariaLabel: `Portfolio against ${benchmarkSymbol}`,
      tone: difference >= 0 ? "primary" : "accent"
    }),
    h("p", {
      class: "inline-note inline-note--watch",
      text: `The index is measured in its own currency, so part of any gap is exchange-rate movement rather than performance. Past index behaviour says nothing about what either will do next.`
    }),
    BenchmarkPicker({ benchmarkSymbol })
  ]);
}

function BenchmarkPicker({ benchmarkSymbol }) {
  return SegmentedControl({
    options: BENCHMARK_PRESETS.map((preset) => preset.symbol),
    value: benchmarkSymbol,
    getLabel: (symbol) => BENCHMARK_PRESETS.find((preset) => preset.symbol === symbol)?.label ?? symbol,
    label: "Compare against",
    onChange: (symbol) => {
      saveBenchmarkSymbol(symbol);
      toast(`Benchmark set to ${symbol}. Rebuild history to load it.`, { level: "info" });
      requestRerender();
    }
  });
}

/** How far below its own peak the portfolio has been, day by day. */
function DrawdownCard({ rebuild }) {
  return Card({}, [
    SectionHeader({
      eyebrow: "Drawdown",
      title: "Distance from the last peak",
      description: "Zero means a new high. Every dip below it is a fall you actually lived through."
    }),
    AreaChart({
      points: rebuild.risk.drawdownSeries,
      height: 200,
      formatValue: (value) => formatPercent(value, 0),
      formatLabel: (point) => formatDate(point.label),
      formatTooltip: (point) => formatPercent(point.value, 1),
      ariaLabel: "Drawdown from peak",
      tone: "accent"
    })
  ]);
}

/** Fetching state, credit budget and what is still missing. */
function RebuildStatusCard({ rebuild, context }) {
  const { holdings, transactions } = context;
  const connected = marketDataIsConfigured();
  const { rebuildable, missing, missingFx = [], benchmarkSymbol, benchmarkCached } = rebuild;
  const pending = missing.length + missingFx.length + (benchmarkSymbol && !benchmarkCached ? 1 : 0);

  return Card({}, [
    SectionHeader({
      eyebrow: "Price history",
      title: rebuild.available ? "Keep the rebuild current" : "Rebuild your value history",
      description: rebuild.available
        ? "Daily bars are cached in this browser and refreshed at most twice a day."
        : "With a transaction ledger and market prices, the value history can be rebuilt back to your first buy instead of starting today."
    }),

    rebuildable.length === 0
      ? h("p", {
          class: "inline-note inline-note--watch",
          text: "No position has both a market symbol and a transaction ledger yet. Link a holding to a real instrument and record its buys, and its history can be rebuilt."
        })
      : h("p", {
          class: "inline-note",
          text: `${rebuildable.length} ${
            rebuildable.length === 1 ? "position qualifies" : "positions qualify"
          }. ${
            pending === 0
              ? "All price history is cached."
              : `${pending} ${pending === 1 ? "series is" : "series are"} missing or stale.`
          }`
        }),

    historyRebuildNote ? h("p", { class: "inline-note inline-note--good", text: historyRebuildNote }) : null,

    connected && rebuildable.length > 0
      ? h("div", { class: "row" }, [
          Button(
            {
              variant: "primary",
              loading: historyRebuilding,
              onclick: () => rebuildHistory(rebuildable, transactions, benchmarkSymbol, context.currency)
            },
            rebuild.available ? "Refresh price history" : "Rebuild history"
          )
        ])
      : connected
        ? null
        : h("div", { class: "row" }, [
            Button({ to: "/settings/market-data", variant: "secondary" }, "Connect market data")
          ])
  ]);
}

/**
 * Pulls the daily bars a rebuild needs, a few instruments at a time so the
 * provider's per-minute credit allowance is never the reason it fails.
 */
async function rebuildHistory(rebuildable, transactions, benchmarkSymbol, baseCurrency) {
  if (historyRebuilding) return;
  historyRebuilding = true;
  historyRebuildNote = "";
  requestRerender();

  const instruments = [
    ...rebuildable.map((holding) => ({
      symbol: holding.marketSymbol,
      exchange: holding.marketExchange || "",
      micCode: holding.marketMicCode || "",
      provider: holding.marketProvider || ""
    })),
    ...historyFxInstruments(rebuildable, readCachedSeries(), baseCurrency),
    ...(benchmarkSymbol ? [{ symbol: benchmarkSymbol, exchange: "" }] : [])
  ];

  try {
    const result = await refreshPriceHistory(instruments, { start: earliestLedgerDate(transactions) });

    if (result.upToDate) {
      historyRebuildNote = "Every series was already up to date.";
      toast("Price history is already current.", { level: "info" });
    } else {
      historyRebuildNote =
        result.remaining > 0
          ? `${result.updated} loaded, ${result.remaining} still queued — run it again in a minute to stay inside the free quota.`
          : `${result.updated} ${result.updated === 1 ? "series" : "series"} loaded.`;

      toast(
        result.failed.length > 0
          ? `${result.updated} loaded, ${result.failed.length} failed: ${result.failed[0].error}`
          : historyRebuildNote,
        { level: result.failed.length > 0 ? "info" : "success" }
      );
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : "Price history could not be loaded.", {
      level: "error"
    });
  } finally {
    historyRebuilding = false;
    requestRerender();
  }
}

/** FX pairs required to express historical prices and ledger cash flows in base currency. */
function historyFxInstruments(holdings, cached, baseCurrency) {
  const base = String(baseCurrency ?? "EUR").trim().toUpperCase();
  const currencies = new Set();

  holdings.forEach((holding) => {
    const priceSeries = cached[historyKeyForHolding(holding)];
    [holding.currency, holding.marketQuoteCurrency, priceSeries?.currency].forEach((value) => {
      const currency = String(value ?? "").trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(currency) && currency !== base) currencies.add(currency);
    });
  });

  return [...currencies].map((currency) => ({
    symbol: `${currency}/${base}`,
    exchange: "",
    provider: "twelve-data"
  }));
}

function SnapshotsCard({ history, currency }) {
  if (history.length === 0) {
    return null;
  }

  return Card({ class: "card--flush" }, [
    h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [
      SectionHeader({
        eyebrow: "Snapshots",
        title: "Recorded days",
        description: "One row per day this browser saw the portfolio."
      })
    ]),
    h("div", { class: "table-scroll" }, [
      h("table", { class: "table table--dense" }, [
        h("thead", {}, [
          h("tr", {}, [
            h("th", { scope: "col", text: "Date" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Value" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Invested" }),
            h("th", { scope: "col", class: "table__cell--numeric", text: "Change" })
          ])
        ]),
        h(
          "tbody",
          {},
          [...history]
            .reverse()
            .slice(0, 30)
            .map((snapshot, index, rows) => {
              const previous = rows[index + 1];
              const change = previous ? snapshot.value - previous.value : null;

              return h("tr", {}, [
                h("td", { text: formatDate(snapshot.date) }),
                h("td", { class: "table__cell--numeric", text: formatCurrency(snapshot.value, currency) }),
                h("td", {
                  class: "table__cell--numeric",
                  text: formatCurrency(snapshot.invested, currency)
                }),
                h("td", {
                  class: `table__cell--numeric ${
                    change === null ? "" : change >= 0 ? "value-up" : "value-down"
                  }`.trim(),
                  text: change === null ? "—" : `${signPrefix(change)}${formatCurrency(change, currency)}`
                })
              ]);
            })
        )
      ])
    ])
  ]);
}

/** Value chart with a range switch, shared by the overview and history pages. */
function HistoryCard({ history, currency, compact = false, estimatedFromTransactions = false }) {
  const ranged = selectHistoryRange(history, historyRange);
  const summary = summarizeHistory(ranged);
  const points = ranged.map((snapshot) => ({ label: snapshot.date, value: snapshot.value }));
  const invested = ranged.map((snapshot) => ({ label: snapshot.date, value: snapshot.invested }));
  const level = summary.change >= 0 ? "good" : "risk";

  return Card({}, [
    SectionHeader({
      eyebrow: "Value over time",
      title: ranged.length > 1 ? formatCurrency(summary.last.value, currency) : "Recording started",
      description:
        ranged.length > 1
          ? `${signPrefix(summary.change)}${formatCurrency(summary.change, currency)} since ${formatDate(
              summary.first.date
            )}`
          : describeHistoryCoverage(history),
      action:
        ranged.length > 1 && summary.changePercentage !== null
          ? StatusChip({
              label: `${signPrefix(summary.changePercentage)}${formatPercent(summary.changePercentage, 1)}`,
              level
            })
          : null
    }),
    HistoryRangeControl(),
    points.length < 2
      ? h("p", {
          class: "inline-note",
          text: "One snapshot recorded so far. The chart draws a line once a second day is recorded."
        })
      : AreaChart({
          points,
          comparison: invested,
          comparisonLabel: "Dashed line: invested amount",
          height: compact ? 220 : 300,
          formatValue: (value) => formatCompactCurrency(value, currency),
          formatLabel: (point) => formatDate(point.label),
          formatTooltip: (point) => formatCurrency(point.value, currency),
          ariaLabel: "Tracked portfolio value",
          tone: summary.change >= 0 ? "primary" : "accent"
        }),
    estimatedFromTransactions && points.length >= 2
      ? h("p", {
          class: "inline-note",
          text: "Imported dates use each position's latest CSV trade price until another trade updates it."
        })
      : null,
    !compact && points.length >= 2 ? RangeDetailMetrics({ summary, currency }) : null,
    compact && points.length >= 2
      ? Button({ to: "/portfolio/history", variant: "ghost", size: "sm" }, "History and drawdowns")
      : null
  ]);
}

function describeTransactionHistoryCoverage(history) {
  if (history.length < 2) return describeHistoryCoverage(history);
  const first = formatDate(history[0].date);
  const last = formatDate(history[history.length - 1].date);
  return `${history.length} points from ${first} to ${last}, combining imported transaction dates with recorded browser snapshots.`;
}

function HistoryRangeControl() {
  return SegmentedControl({
    options: HISTORY_RANGES.map((range) => range.key),
    value: historyRange,
    getLabel: (key) => HISTORY_RANGES.find((range) => range.key === key)?.label ?? key,
    label: "Portfolio history range",
    onChange: (key) => {
      historyRange = key;
      requestRerender();
    }
  });
}

function RangeDetailMetrics({ summary, currency }) {
  const best = summary.bestDay;
  const worst = summary.worstDay;

  return h("div", { class: "grid grid--4 history-range-metrics" }, [
    MetricCard({
      label: "Range change",
      value: `${signPrefix(summary.change)}${formatCurrency(summary.change, currency)}`,
      hint:
        summary.changePercentage === null
          ? `Since ${formatDate(summary.first.date)}`
          : `${signPrefix(summary.changePercentage)}${formatPercent(summary.changePercentage, 2)} since ${formatDate(
              summary.first.date
            )}`
    }),
    MetricCard({
      label: "Net money added",
      value: `${signPrefix(summary.contributionChange)}${formatCurrency(summary.contributionChange, currency)}`,
      hint: "Separates deposits from market movement"
    }),
    MetricCard({
      label: "High / low",
      value: `${formatCompactCurrency(summary.high.value, currency)} / ${formatCompactCurrency(
        summary.low.value,
        currency
      )}`,
      hint: `${formatDate(summary.high.date)} / ${formatDate(summary.low.date)}`
    }),
    MetricCard({
      label: "Best / worst move",
      value:
        best && worst
          ? `${signPrefix(best.change)}${formatCompactCurrency(best.change, currency)} / ${signPrefix(
              worst.change
            )}${formatCompactCurrency(worst.change, currency)}`
          : "—",
      hint: best && worst ? `${formatDate(best.date)} / ${formatDate(worst.date)}` : "Needs two recorded points"
    })
  ]);
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                         */
/* -------------------------------------------------------------------------- */

function signPrefix(value) {
  return value >= 0 ? "+" : "";
}

function shortName(holding) {
  return holding.name || holding.ticker;
}

function formatQuantity(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
    Number.isFinite(value) ? value : 0
  );
}

function formatDecimal(value, digits = 1) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

/** Movement since the previous close, or null when the quote cannot say. */
function dayChangeOf(holding) {
  if (holding.marketSourceProvider === "manual") {
    return null;
  }

  const previousClose = Number(holding.previousClose);
  const currentPrice = Number(holding.currentPrice);

  if (!Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(currentPrice)) {
    return null;
  }

  return (currentPrice - previousClose) / previousClose;
}

function formatHoldingPeriod(days) {
  if (!Number.isFinite(days)) return "—";
  if (days < 31) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 365) {
    const months = Math.round(days / 30.4);
    return `${months} ${months === 1 ? "month" : "months"}`;
  }
  return `${(days / 365).toFixed(1)} years`;
}

function formatMonth(date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" }).format(date);
}

/** Day and month, with the year added whenever it is not the current one. */
function formatDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric"
  }).format(date);
}
