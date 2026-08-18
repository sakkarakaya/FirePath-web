import {
  calculateHoldingInvestedAmountInBaseCurrency,
  calculateHoldingValueInBaseCurrency
} from "./portfolioCalculations.js";

/**
 * Portfolio statistics.
 *
 * Everything in here is descriptive: it measures what the tracked holdings
 * currently are, never what they should be. Concentration, diversification and
 * performance figures are the ones a portfolio tracker is expected to show, so
 * they live in the domain layer and the views only format them.
 */

const BROAD_FUND_TYPES = new Set(["ETF", "Bond"]);

export const POSITION_MAP_RANGES = [
  { key: "1D", label: "Daily" },
  { key: "1W", label: "Weekly" },
  { key: "1M", label: "Monthly" },
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "Yearly" },
  { key: "ALL", label: "All time" }
];

export function buildPortfolioStatistics(holdings, baseCurrency = "EUR") {
  const rows = buildRows(holdings);
  const totalValue = sum(rows.map((row) => row.value));
  const totalInvested = sum(rows.map((row) => row.invested));
  const unrealizedGainLoss = totalValue - totalInvested;
  const normalizedBase = (baseCurrency || "EUR").trim().toUpperCase();

  const sortedByValue = [...rows].sort((left, right) => right.value - left.value);
  const withReturn = rows.filter((row) => row.gainLossPercentage !== null);
  const ranked = [...withReturn].sort((left, right) => right.gainLossPercentage - left.gainLossPercentage);

  const shares = rows.map((row) => (totalValue === 0 ? 0 : row.value / totalValue));
  const herfindahl = sum(shares.map((share) => share * share));

  return {
    positionCount: rows.length,
    totalValue,
    totalInvested,
    unrealizedGainLoss,
    gainLossPercentage: totalInvested === 0 ? null : unrealizedGainLoss / totalInvested,

    dayChange: buildDayChange(rows, totalValue),

    winners: rows.filter((row) => row.gainLoss > 0).length,
    losers: rows.filter((row) => row.gainLoss < 0).length,
    flat: rows.filter((row) => row.gainLoss === 0).length,
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,

    largest: sortedByValue[0] ?? null,
    largestShare: totalValue === 0 ? 0 : (sortedByValue[0]?.value ?? 0) / totalValue,
    topThreeShare:
      totalValue === 0 ? 0 : sum(sortedByValue.slice(0, 3).map((row) => row.value)) / totalValue,
    herfindahl,
    // Effective number of positions: how many equally sized holdings would give
    // the same concentration. Two positions at 90/10 behave like ~1.2, not 2.
    effectivePositions: herfindahl === 0 ? 0 : 1 / herfindahl,
    averagePosition: rows.length === 0 ? 0 : totalValue / rows.length,
    medianPosition: median(sortedByValue.map((row) => row.value)),

    assetClassCount: distinctCount(rows, (row) => row.holding.assetType),
    regionCount: distinctCount(rows, (row) => row.holding.region),
    currencyCount: distinctCount(rows, (row) => row.holding.currency),
    sectorCount: distinctCount(rows, (row) => row.holding.sector),

    cashShare: shareWhere(rows, totalValue, (row) => row.holding.assetType === "Cash"),
    broadFundShare: shareWhere(rows, totalValue, (row) => BROAD_FUND_TYPES.has(row.holding.assetType)),
    foreignCurrencyShare: shareWhere(
      rows,
      totalValue,
      (row) => normalizeCurrency(row.holding.currency) !== normalizedBase
    ),
    marketLinkedShare: shareWhere(rows, totalValue, (row) => Boolean(row.holding.marketSymbol)),

    diversification: buildDiversificationScore({
      positionCount: rows.length,
      herfindahl,
      assetClassCount: distinctCount(rows, (row) => row.holding.assetType),
      regionCount: distinctCount(rows, (row) => row.holding.region)
    })
  };
}

/**
 * Per-holding performance, ordered by how much each position moved the whole
 * portfolio rather than by its own percentage — a 60% gain on a tiny position
 * matters less than a 5% gain on the largest one.
 */
export function buildPerformanceRanking(holdings) {
  const rows = buildRows(holdings);
  const totalInvested = sum(rows.map((row) => row.invested));
  const totalValue = sum(rows.map((row) => row.value));

  return rows
    .map((row) => ({
      ...row,
      share: totalValue === 0 ? 0 : row.value / totalValue,
      // Percentage points of the total return this holding is responsible for.
      contribution: totalInvested === 0 ? 0 : row.gainLoss / totalInvested
    }))
    .sort((left, right) => right.gainLoss - left.gainLoss);
}

/** Holdings whose quote carries a previous close, newest movement first. */
export function buildDayMovers(holdings) {
  return buildRows(holdings)
    .filter((row) => row.dayChange !== null)
    .sort((left, right) => Math.abs(right.dayChange) - Math.abs(left.dayChange));
}

export function buildAllocation(holdings, key) {
  const rows = buildRows(holdings);
  const total = sum(rows.map((row) => row.value));
  const buckets = new Map();

  rows.forEach((row, index) => {
    const label = bucketLabel(row.holding, key);
    // A holding allocation is deliberately one slice per saved position. Use
    // its id as the bucket key so two instruments with the same display name
    // never collapse into a single slice.
    const bucketKey = key === "holding" ? `holding:${row.holding.id ?? index}` : label;
    const bucket = buckets.get(bucketKey) ?? { label, value: 0, invested: 0, count: 0 };
    bucket.value += row.value;
    bucket.invested += row.invested;
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
  });

  return Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      percentage: total === 0 ? 0 : bucket.value / total,
      gainLoss: bucket.value - bucket.invested,
      gainLossPercentage: bucket.invested === 0 ? null : (bucket.value - bucket.invested) / bucket.invested
    }))
    .sort((left, right) => right.value - left.value);
}

export function buildCurrencyExposure(holdings, baseCurrency = "EUR") {
  const normalizedBase = normalizeCurrency(baseCurrency);

  return buildAllocation(holdings, "currency").map((bucket) => ({
    ...bucket,
    isBase: normalizeCurrency(bucket.label) === normalizedBase
  }));
}

/**
 * Position map input: value drives the area, return drives the colour, so the
 * shape of the portfolio and how it is doing read in one picture.
 */
export function buildPositionMap(
  holdings,
  {
    rangeKey = "ALL",
    priceSeries = {},
    transactions = [],
    keyForHolding = (holding) => holding.marketSymbol || holding.ticker || String(holding.id ?? ""),
    now = new Date()
  } = {}
) {
  const rows = buildRows(holdings);
  const total = sum(rows.map((row) => row.value));

  return rows
    .filter((row) => row.value > 0)
    .map((row) => {
      const periodReturn = calculatePositionMapReturn(row.holding, {
        rangeKey,
        series: priceSeries[keyForHolding(row.holding)] ?? null,
        transactions,
        now
      });

      return {
        label: row.holding.name || row.holding.ticker,
        title: row.holding.name,
        value: row.value,
        weight: total === 0 ? 0 : row.value / total,
        gainLossPercentage: periodReturn.percentage,
        gainLoss: periodReturn.gainLoss,
        returnSource: periodReturn.source,
        returnFrom: periodReturn.from
      };
    })
    .sort((left, right) => right.value - left.value);
}

/**
 * Price return for one heat-map tile. Position size always uses today's value;
 * only the colour changes with the selected period. When a position was opened
 * inside the period its first buy is the honest starting point: showing market
 * movement from before the user owned it would not describe their position.
 */
function calculatePositionMapReturn(holding, { rangeKey, series, transactions, now }) {
  const currentPrice = Number(holding.currentPrice);
  const quantity = Math.max(0, Number(holding.quantity) || 0);
  const rate = Math.max(0, Number(holding.exchangeRateToBase) || 0);
  const firstBuy = firstBuyForHolding(transactions, holding.id);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return unavailablePositionReturn();
  }

  if (rangeKey === "ALL") {
    const firstBuyPrice = Number(firstBuy?.price);
    const averageBuyPrice = Number(holding.averageBuyPrice);
    const referencePrice =
      Number.isFinite(firstBuyPrice) && firstBuyPrice > 0
        ? firstBuyPrice
        : Number.isFinite(averageBuyPrice) && averageBuyPrice > 0
          ? averageBuyPrice
          : null;

    return positionReturnFromPrice({
      currentPrice,
      referencePrice,
      quantity,
      rate,
      from: firstBuy?.date ?? null,
      source: firstBuy ? "first-buy" : referencePrice === null ? null : "cost-basis"
    });
  }

  const cutoff = positionMapCutoff(rangeKey, now);
  if (cutoff === null) {
    return unavailablePositionReturn();
  }

  // A buy made after the range began is the position's real inception point.
  if (firstBuy?.date && firstBuy.date > cutoff) {
    return positionReturnFromPrice({
      currentPrice,
      referencePrice: Number(firstBuy.price),
      quantity,
      rate,
      from: firstBuy.date,
      source: "first-buy"
    });
  }

  if (rangeKey === "1D") {
    if (holding.marketSourceProvider === "manual") {
      return unavailablePositionReturn();
    }

    const previousClose = Number(holding.previousClose);
    if (Number.isFinite(previousClose) && previousClose > 0) {
      return positionReturnFromPrice({
        currentPrice,
        referencePrice: previousClose,
        quantity,
        rate,
        from: cutoff,
        source: "previous-close"
      });
    }
  }

  const reference = closeOnOrBefore(series?.bars ?? [], cutoff);
  return positionReturnFromPrice({
    currentPrice,
    referencePrice: reference?.close ?? null,
    quantity,
    rate,
    from: reference?.date ?? null,
    source: reference ? "price-history" : null
  });
}

function positionReturnFromPrice({ currentPrice, referencePrice, quantity, rate, from, source }) {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || source === null) {
    return unavailablePositionReturn();
  }

  const percentage = currentPrice / referencePrice - 1;
  return {
    percentage,
    gainLoss: (currentPrice - referencePrice) * quantity * rate,
    from,
    source
  };
}

function unavailablePositionReturn() {
  return { percentage: null, gainLoss: null, from: null, source: null };
}

function firstBuyForHolding(transactions, holdingId) {
  return transactions
    .filter(
      (transaction) =>
        transaction.type === "buy" && String(transaction.holdingId) === String(holdingId)
    )
    .sort((left, right) => String(left.date ?? "").localeCompare(String(right.date ?? "")))[0] ?? null;
}

function closeOnOrBefore(bars, date) {
  let found = null;

  bars.forEach((bar) => {
    if (String(bar?.date ?? "") <= date && Number.isFinite(Number(bar?.close)) && Number(bar.close) > 0) {
      if (found === null || String(bar.date) > String(found.date)) {
        found = { date: String(bar.date), close: Number(bar.close) };
      }
    }
  });

  return found;
}

function positionMapCutoff(rangeKey, now) {
  const end = new Date(now);
  if (Number.isNaN(end.getTime())) return null;

  const cutoff = new Date(end);
  if (rangeKey === "YTD") {
    cutoff.setMonth(0, 0);
  } else if (rangeKey === "1Y") {
    cutoff.setFullYear(cutoff.getFullYear() - 1);
  } else if (rangeKey === "1M") {
    cutoff.setMonth(cutoff.getMonth() - 1);
  } else if (rangeKey === "1W") {
    cutoff.setDate(cutoff.getDate() - 7);
  } else if (rangeKey === "1D") {
    cutoff.setDate(cutoff.getDate() - 1);
  } else {
    return null;
  }

  return localDateKey(cutoff);
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

/**
 * A 0-100 spread score built from position count, concentration and how many
 * asset classes and regions are represented. It rates spread only — a wide
 * spread is not automatically the right portfolio for a given plan, so views
 * present this next to that caveat.
 */
export function buildDiversificationScore({ positionCount, herfindahl, assetClassCount, regionCount }) {
  if (positionCount === 0) {
    return { score: 0, level: "risk", label: "Nothing tracked", components: [] };
  }

  const effectivePositions = herfindahl === 0 ? 0 : 1 / herfindahl;
  const components = [
    { key: "positions", label: "Position count", score: Math.min(1, positionCount / 12), weight: 25 },
    { key: "concentration", label: "Even weighting", score: Math.min(1, effectivePositions / 8), weight: 40 },
    { key: "assetClasses", label: "Asset classes", score: Math.min(1, assetClassCount / 4), weight: 20 },
    { key: "regions", label: "Regions", score: Math.min(1, regionCount / 3), weight: 15 }
  ];

  const score = Math.round(sum(components.map((component) => component.score * component.weight)));

  return {
    score,
    level: score >= 70 ? "good" : score >= 40 ? "watch" : "risk",
    label: score >= 70 ? "Widely spread" : score >= 40 ? "Moderately spread" : "Concentrated",
    components: components.map((component) => ({
      ...component,
      points: Math.round(component.score * component.weight)
    }))
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function buildRows(holdings) {
  return holdings.flatMap((holding) => {
    const value = calculateHoldingValueInBaseCurrency(holding);
    if (value <= 0) return [];

    const invested = calculateHoldingInvestedAmountInBaseCurrency(holding);
    const gainLoss = value - invested;

    return [{
      holding,
      value,
      invested,
      gainLoss,
      gainLossPercentage: invested === 0 ? null : gainLoss / invested,
      dayChange: calculateDayChange(holding),
      dayChangePercentage: calculateDayChangePercentage(holding)
    }];
  });
}

/**
 * Movement since the previous close, in base currency. Only quotes that carried
 * a previous close can answer this, so a manually priced holding returns null
 * rather than pretending it did not move.
 */
function calculateDayChange(holding) {
  if (holding.marketSourceProvider === "manual") {
    return null;
  }

  const previousClose = Number(holding.previousClose);
  const currentPrice = Number(holding.currentPrice);

  if (!Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(currentPrice)) {
    return null;
  }

  return (
    (currentPrice - previousClose) * Math.max(0, holding.quantity) * Math.max(0, holding.exchangeRateToBase)
  );
}

function calculateDayChangePercentage(holding) {
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

function buildDayChange(rows, totalValue) {
  const covered = rows.filter((row) => row.dayChange !== null);

  if (covered.length === 0) {
    return null;
  }

  const change = sum(covered.map((row) => row.dayChange));
  const coveredValue = sum(covered.map((row) => row.value));
  const previousValue = coveredValue - change;

  return {
    value: change,
    percentage: previousValue <= 0 ? null : change / previousValue,
    coveredPositions: covered.length,
    coverage: totalValue === 0 ? 0 : coveredValue / totalValue
  };
}

function bucketLabel(holding, key) {
  if (key === "holding") {
    return String(holding.name ?? holding.ticker ?? "").trim() || "Unnamed holding";
  }
  if (key === "currency") {
    return normalizeCurrency(holding.currency) || "Other";
  }
  return String(holding[key] ?? "").trim() || "Unassigned";
}

function shareWhere(rows, total, predicate) {
  if (total === 0) return 0;
  return sum(rows.filter(predicate).map((row) => row.value)) / total;
}

function distinctCount(rows, pick) {
  return new Set(
    rows.map((row) => String(pick(row) ?? "").trim()).filter((value) => value.length > 0)
  ).size;
}

function normalizeCurrency(value) {
  return String(value ?? "").trim().toUpperCase();
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

/* -------------------------------------------------------------------------- */
/* Target allocation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Compares the current split against the target the user set for themselves.
 *
 * Drift is reported, never acted on: FirePath does not tell anyone to sell. The
 * companion `planContribution` only ever distributes new money, which is how a
 * savings plan is rebalanced without a single sell order.
 */
export function buildAllocationDrift(holdings, targets, key = "assetType") {
  const actual = buildAllocation(holdings, key);
  const totalValue = actual.reduce((sum, bucket) => sum + bucket.value, 0);
  const byLabel = new Map(actual.map((bucket) => [bucket.label, bucket]));

  const labels = [
    ...new Set([
      ...Object.entries(targets ?? {})
        .filter(([, share]) => Number(share) > 0)
        .map(([label]) => label),
      ...actual.map((bucket) => bucket.label)
    ])
  ];

  const rows = labels
    .map((label) => {
      const bucket = byLabel.get(label);
      const actualValue = bucket?.value ?? 0;
      const actualPercentage = totalValue === 0 ? 0 : actualValue / totalValue;
      const targetPercentage = Math.max(0, Number(targets?.[label]) || 0);

      return {
        label,
        actualValue,
        actualPercentage,
        targetPercentage,
        drift: actualPercentage - targetPercentage,
        // What moving to target would take, as an amount rather than a share.
        difference: targetPercentage * totalValue - actualValue
      };
    })
    .sort((left, right) => right.targetPercentage - left.targetPercentage || right.actualValue - left.actualValue);

  const targetTotal = rows.reduce((sum, row) => sum + row.targetPercentage, 0);

  return {
    rows,
    totalValue,
    targetTotal,
    hasTargets: targetTotal > 0,
    // Targets that do not add up to 100% make every drift figure misleading,
    // so the views say so instead of quietly normalising them.
    isBalanced: Math.abs(targetTotal - 1) < 0.005,
    largestDrift: rows.reduce(
      (worst, row) => (worst === null || Math.abs(row.drift) > Math.abs(worst.drift) ? row : worst),
      null
    )
  };
}

/**
 * Splits an incoming contribution across the buckets that are furthest below
 * their target. Nothing is ever taken out of a bucket that is above target.
 */
export function planContribution(drift, amount) {
  const contribution = Math.max(0, Number(amount) || 0);

  if (contribution === 0 || !drift.hasTargets) {
    return [];
  }

  const projectedTotal = drift.totalValue + contribution;
  const needs = drift.rows.map((row) => ({
    ...row,
    need: Math.max(0, row.targetPercentage * projectedTotal - row.actualValue)
  }));

  const totalNeed = needs.reduce((sum, row) => sum + row.need, 0);

  if (totalNeed === 0) {
    return [];
  }

  return needs
    .map((row) => ({
      label: row.label,
      amount: (row.need / totalNeed) * contribution,
      share: row.need / totalNeed,
      targetPercentage: row.targetPercentage,
      actualPercentage: row.actualPercentage
    }))
    .filter((row) => row.amount > 1e-9)
    .sort((left, right) => right.amount - left.amount);
}
