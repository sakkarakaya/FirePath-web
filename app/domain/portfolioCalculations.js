import { toNonNegativeNumber } from "./fireCalculations.js";
import { formatCurrency } from "./formatters.js";

export function calculateHoldingValue(holding) {
  return Math.max(0, holding.quantity) * Math.max(0, holding.currentPrice);
}

export function calculateHoldingInvestedAmount(holding) {
  return Math.max(0, holding.quantity) * Math.max(0, holding.averageBuyPrice);
}

export function calculateHoldingValueInBaseCurrency(holding) {
  return calculateHoldingValue(holding) * Math.max(0, holding.exchangeRateToBase);
}

export function calculateHoldingInvestedAmountInBaseCurrency(holding) {
  return calculateHoldingInvestedAmount(holding) * Math.max(0, holding.exchangeRateToBase);
}

export function calculatePortfolioSummary(holdings) {
  const totalPortfolioValue = holdings.reduce(
    (sum, holding) => sum + calculateHoldingValueInBaseCurrency(holding),
    0
  );
  const totalInvestedAmount = holdings.reduce(
    (sum, holding) => sum + calculateHoldingInvestedAmountInBaseCurrency(holding),
    0
  );
  const unrealizedGainLoss = totalPortfolioValue - totalInvestedAmount;
  const gainLossPercentage = totalInvestedAmount === 0 ? 0 : unrealizedGainLoss / totalInvestedAmount;

  return { totalPortfolioValue, totalInvestedAmount, unrealizedGainLoss, gainLossPercentage };
}

/**
 * How much of the invested total the tracked holdings actually account for.
 *
 * Holdings are a manually kept list, so they can lag behind the investment total
 * saved on the profile. The FIRE calculations use the larger of the two, which
 * means the portfolio figure on the dashboard and the holdings list on the
 * portfolio page can legitimately differ — this keeps that difference explicit
 * so both screens can say where their number comes from.
 */
export function calculatePortfolioCoverage({ trackedValue, snapshotValue }) {
  const tracked = toNonNegativeNumber(trackedValue);
  const snapshot = toNonNegativeNumber(snapshotValue);

  return {
    trackedValue: tracked,
    snapshotValue: snapshot,
    untrackedValue: Math.max(0, snapshot - tracked),
    totalValue: Math.max(tracked, snapshot)
  };
}

/** Rounding noise is not a gap worth explaining to the reader. */
const UNTRACKED_VISIBILITY_THRESHOLD = 1;

export function hasUntrackedInvestments(coverage) {
  return coverage.untrackedValue >= UNTRACKED_VISIBILITY_THRESHOLD;
}

/**
 * Says what the portfolio figure is made of, so a value that exceeds the tracked
 * holdings never looks like a counting error.
 */
export function describePortfolioSource(coverage, holdingCount, currency) {
  const holdingsLabel = `${holdingCount} ${holdingCount === 1 ? "holding" : "holdings"} tracked`;

  if (!hasUntrackedInvestments(coverage)) {
    return holdingCount === 0 ? "No holdings tracked yet" : holdingsLabel;
  }

  const untracked = formatCurrency(coverage.untrackedValue, currency);

  return holdingCount === 0
    ? `${untracked} from your saved total, no holdings tracked yet`
    : `${holdingsLabel} · ${untracked} from your saved total`;
}

/** Reconciles the holdings list with the saved total, or null when they agree. */
export function describeUntrackedInvestments(coverage, currency) {
  if (!hasUntrackedInvestments(coverage)) {
    return null;
  }

  return `Your profile saves ${formatCurrency(
    coverage.snapshotValue,
    currency
  )} as invested, and ${formatCurrency(
    coverage.untrackedValue,
    currency
  )} of it is not tracked as a holding yet. Your FIRE progress counts the saved total; this screen only shows what you track here.`;
}

/**
 * Per-holding view of the portfolio, largest position first. The list is the
 * primary content of the portfolio screen, so ordering by weight puts what
 * matters most on top instead of by insertion order.
 */
export function buildHoldingBreakdown(holdings) {
  const total = holdings.reduce((sum, holding) => sum + calculateHoldingValueInBaseCurrency(holding), 0);

  return holdings
    .map((holding) => {
      const value = calculateHoldingValueInBaseCurrency(holding);
      const investedAmount = calculateHoldingInvestedAmountInBaseCurrency(holding);
      const gainLoss = value - investedAmount;

      return {
        holding,
        value,
        investedAmount,
        gainLoss,
        gainLossPercentage: investedAmount === 0 ? null : gainLoss / investedAmount,
        share: total === 0 ? 0 : value / total
      };
    })
    .sort((a, b) => b.value - a.value);
}

export function calculateAllocation(holdings, key) {
  const total = holdings.reduce((sum, holding) => sum + calculateHoldingValueInBaseCurrency(holding), 0);
  const map = new Map();

  holdings.forEach((holding) => {
    const label = String(holding[key] ?? "Other").trim() || "Other";
    map.set(label, (map.get(label) ?? 0) + calculateHoldingValueInBaseCurrency(holding));
  });

  return Array.from(map.entries())
    .map(([label, value]) => ({
      label,
      value,
      percentage: total === 0 ? 0 : value / total
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Neutral, descriptive portfolio signals.
 *
 * These describe what the portfolio currently looks like so the user can compare
 * it against their own plan. They are deliberately not scored as good/bad and
 * never imply that an asset should be bought or sold.
 */

const BROAD_FUND_TYPES = new Set(["ETF", "Bond"]);
const CONCENTRATION_NOTABLE_THRESHOLD = 0.4;
const CASH_NOTABLE_THRESHOLD = 0.3;
const FOREIGN_CURRENCY_NOTABLE_THRESHOLD = 0.5;

export function calculatePortfolioHealth(holdings, baseCurrency) {
  const total = holdings.reduce((sum, holding) => sum + calculateHoldingValueInBaseCurrency(holding), 0);

  if (holdings.length === 0 || total === 0) {
    return [];
  }

  const share = (value) => value / total;
  const normalizedBase = (baseCurrency || "EUR").trim().toUpperCase();

  const largest = holdings.reduce((selected, holding) =>
    calculateHoldingValueInBaseCurrency(holding) > calculateHoldingValueInBaseCurrency(selected) ? holding : selected
  );
  const largestShare = share(calculateHoldingValueInBaseCurrency(largest));

  const cashShare = share(sumWhere(holdings, (holding) => holding.assetType === "Cash"));
  const broadFundShare = share(sumWhere(holdings, (holding) => BROAD_FUND_TYPES.has(holding.assetType)));
  const foreignShare = share(
    sumWhere(holdings, (holding) => (holding.currency || "").trim().toUpperCase() !== normalizedBase)
  );

  return [
    {
      key: "concentration",
      label: "Largest position",
      percentage: largestShare,
      headline: largest.name,
      detail: "The biggest single holding as a share of tracked portfolio value.",
      emphasis: largestShare >= CONCENTRATION_NOTABLE_THRESHOLD ? "notable" : "neutral"
    },
    {
      key: "cashAllocation",
      label: "Cash allocation",
      percentage: cashShare,
      headline: cashShare === 0 ? "No cash tracked" : "Held as cash",
      detail: "Cash exposure is shown so you can compare it with your own liquidity plan.",
      emphasis: cashShare >= CASH_NOTABLE_THRESHOLD ? "notable" : "neutral"
    },
    {
      key: "fundBalance",
      label: "Broad funds vs single assets",
      percentage: broadFundShare,
      headline: `${formatShareLabel(broadFundShare)} in ETFs and bonds`,
      detail: "Broad funds and individual assets are separated for visibility only.",
      emphasis: "neutral"
    },
    {
      key: "currencyExposure",
      label: `Outside ${normalizedBase}`,
      percentage: foreignShare,
      headline: foreignShare === 0 ? `All in ${normalizedBase}` : "Held in other currencies",
      detail: "Currency mix is informational and does not imply suitability.",
      emphasis: foreignShare >= FOREIGN_CURRENCY_NOTABLE_THRESHOLD ? "notable" : "neutral"
    }
  ];
}

function sumWhere(holdings, predicate) {
  return holdings.filter(predicate).reduce((sum, holding) => sum + calculateHoldingValueInBaseCurrency(holding), 0);
}

function formatShareLabel(share) {
  return `${Math.round(share * 100)}%`;
}
