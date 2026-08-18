/**
 * Portfolio value history.
 *
 * FirePath never talks to a broker, so there is no server-side history to pull.
 * Instead every visit records one snapshot a day of the tracked value and the
 * invested amount, which turns the portfolio screens into a real time series
 * that grows from the day tracking starts. Snapshots are local, like the rest
 * of the data, and a day is stored once — reopening the app the same day
 * overwrites that day rather than stacking points.
 */

/** ~6 years of daily points, enough to support a complete 5Y view. */
const MAX_SNAPSHOTS = 2192;

/** Sub-cent movement is storage churn, not a change worth recording. */
const VALUE_EPSILON = 0.005;

export const HISTORY_RANGES = [
  { key: "1D", label: "1D", days: 1 },
  { key: "1W", label: "1W", days: 7 },
  { key: "1M", label: "1M", months: 1 },
  { key: "YTD", label: "YTD", yearToDate: true },
  { key: "1Y", label: "1Y", years: 1 },
  { key: "5Y", label: "5Y", years: 5 }
];

export function toSnapshotDate(date = new Date()) {
  const local = new Date(date);
  if (Number.isNaN(local.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  // Local calendar day, so "today" matches what the reader sees on their clock.
  const offset = local.getTimezoneOffset() * 60 * 1000;
  return new Date(local.getTime() - offset).toISOString().slice(0, 10);
}

export function normalizeSnapshots(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const byDate = new Map();

  rows.forEach((row) => {
    const date = String(row?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }

    const value = Number(row.value);
    const invested = Number(row.invested);
    byDate.set(date, {
      date,
      value: Number.isFinite(value) ? Math.max(0, value) : 0,
      invested: Number.isFinite(invested) ? Math.max(0, invested) : 0,
      positions: Number.isFinite(Number(row.positions)) ? Math.max(0, Math.trunc(Number(row.positions))) : 0
    });
  });

  return Array.from(byDate.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_SNAPSHOTS);
}

/**
 * Builds the sparse history that a dated transaction CSV can prove on its own.
 *
 * A broker export normally contains a price only on trade days. On every such
 * day we apply all buys and sells, value each open position at its latest known
 * trade price, and carry that price until the next trade. This is deliberately
 * separate from the daily market-price rebuild: it makes imported dates useful
 * immediately without pretending the CSV contains closes it did not provide.
 */
export function buildTransactionSnapshots(
  holdings,
  transactions,
  { seriesByKey = null, baseCurrency = "EUR" } = {}
) {
  if (!Array.isArray(holdings) || !Array.isArray(transactions) || transactions.length === 0) {
    return [];
  }

  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  const rowsByDate = new Map();

  transactions.forEach((transaction) => {
    const date = String(transaction?.date ?? "").slice(0, 10);
    if (!holdingById.has(transaction?.holdingId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }

    const rows = rowsByDate.get(date) ?? [];
    rows.push(transaction);
    rowsByDate.set(date, rows);
  });

  const quantities = new Map();
  const prices = new Map();
  const investedByHolding = new Map();
  const excludedHoldingIds = new Set();
  const snapshots = [];
  let started = false;

  [...rowsByDate.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([date, rows]) => {
      rows.forEach((transaction) => {
        const holdingId = transaction.holdingId;
        const holding = holdingById.get(holdingId);
        const type = transaction.type;
        const quantity = Math.max(0, Number(transaction.quantity) || 0);
        const price = Math.max(0, Number(transaction.price) || 0);
        const fee = Math.max(0, Number(transaction.fee) || 0);
        const amount =
          type === "dividend"
            ? Math.max(0, Number(transaction.amount) || 0)
            : quantity * price;
        const rate = rateForDate(holding, date, seriesByKey, baseCurrency);

        if (rate === null) {
          // Without the rate from the transaction date, later base-currency
          // invested totals would be invented. Keep the holding out until its
          // historical FX series is available.
          excludedHoldingIds.add(holdingId);
        }

        if ((type === "buy" || type === "sell") && price > 0) {
          prices.set(holdingId, price);
        }

        if (type === "buy") {
          quantities.set(holdingId, (quantities.get(holdingId) ?? 0) + quantity);
          investedByHolding.set(
            holdingId,
            (investedByHolding.get(holdingId) ?? 0) + (rate === null ? 0 : (amount + fee) * rate)
          );
          started = started || quantity > 0;
        } else if (type === "sell") {
          quantities.set(holdingId, Math.max(0, (quantities.get(holdingId) ?? 0) - quantity));
          investedByHolding.set(
            holdingId,
            (investedByHolding.get(holdingId) ?? 0) - (rate === null ? 0 : (amount - fee) * rate)
          );
        } else if (type === "dividend") {
          investedByHolding.set(
            holdingId,
            (investedByHolding.get(holdingId) ?? 0) - (rate === null ? 0 : (amount - fee) * rate)
          );
        }
      });

      if (!started) return;

      let value = 0;
      let invested = 0;
      let positions = 0;

      holdings.forEach((holding) => {
        if (excludedHoldingIds.has(holding.id)) return;
        const quantity = Math.max(0, quantities.get(holding.id) ?? 0);
        const price = Math.max(0, prices.get(holding.id) ?? 0);
        const rate = rateForDate(holding, date, seriesByKey, baseCurrency);

        if (rate === null) return;

        if (quantity > 1e-9) positions += 1;
        value += quantity * price * rate;
        invested += Math.max(0, investedByHolding.get(holding.id) ?? 0);
      });

      if (positions > 0) snapshots.push({ date, value, invested, positions });
    });

  return normalizeSnapshots(snapshots);
}

function rateForDate(holding, date, seriesByKey, baseCurrency) {
  if (seriesByKey === null) {
    const rate = Number(holding?.exchangeRateToBase);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  const from = String(holding?.currency ?? baseCurrency).trim().toUpperCase();
  const to = String(baseCurrency ?? "EUR").trim().toUpperCase();
  if (from === to) return 1;

  const bars = seriesByKey[`${from}/${to}`]?.bars;
  if (!Array.isArray(bars)) return null;

  let rate = null;
  for (const bar of bars) {
    if (bar.date > date) break;
    if (Number.isFinite(Number(bar.close)) && Number(bar.close) > 0) rate = Number(bar.close);
  }
  return rate;
}

/** Recorded browser snapshots override CSV estimates when both cover a date. */
export function mergeSnapshotSeries(estimated, recorded) {
  return normalizeSnapshots([
    ...(Array.isArray(estimated) ? estimated : []),
    ...(Array.isArray(recorded) ? recorded : [])
  ]);
}

/**
 * Upserts today's snapshot. Returns the same array reference when nothing
 * meaningful changed, so callers can skip a pointless write to localStorage.
 */
export function appendSnapshot(snapshots, entry) {
  const date = entry.date ?? toSnapshotDate();
  const value = Math.max(0, Number(entry.value) || 0);
  const invested = Math.max(0, Number(entry.invested) || 0);
  const positions = Math.max(0, Math.trunc(Number(entry.positions) || 0));
  const existing = snapshots[snapshots.length - 1];

  if (
    existing &&
    existing.date === date &&
    Math.abs(existing.value - value) < VALUE_EPSILON &&
    Math.abs(existing.invested - invested) < VALUE_EPSILON &&
    existing.positions === positions
  ) {
    return snapshots;
  }

  const kept = snapshots.filter((snapshot) => snapshot.date !== date);
  return [...kept, { date, value, invested, positions }].slice(-MAX_SNAPSHOTS);
}

export function selectHistoryRange(snapshots, rangeKey) {
  return selectSeriesRange(snapshots, rangeKey, { dateKey: "date" });
}

/**
 * Selects a display range from any dated series. The cutoff is anchored to the
 * newest point, not the wall clock, so a cached series still renders correctly
 * when markets are closed or the browser has been offline.
 */
export function selectSeriesRange(points, rangeKey, { dateKey = "label" } = {}) {
  const range = HISTORY_RANGES.find((candidate) => candidate.key === rangeKey);

  if (!range || points.length === 0) {
    return points;
  }

  const lastDate = String(points[points.length - 1]?.[dateKey] ?? "").slice(0, 10);
  const last = new Date(`${lastDate}T00:00:00`);
  if (Number.isNaN(last.getTime())) {
    return points;
  }

  let cutoffDate;
  if (range.yearToDate) {
    cutoffDate = `${last.getFullYear()}-01-01`;
  } else {
    const cutoff = new Date(last);
    if (range.years) {
      cutoff.setFullYear(cutoff.getFullYear() - range.years);
    } else if (range.months) {
      cutoff.setMonth(cutoff.getMonth() - range.months);
    } else {
      cutoff.setDate(cutoff.getDate() - range.days);
    }
    cutoffDate = toSnapshotDate(cutoff);
  }

  const inRange = points.filter((point) => String(point?.[dateKey] ?? "").slice(0, 10) >= cutoffDate);

  // Do not pull an old point into a short range merely to draw a line. If the
  // browser was not opened during the selected period, one point is the honest
  // answer and the view explains that no change can be measured yet.
  return inRange;
}

/**
 * Descriptive statistics for a series of snapshots. Everything here is
 * observed history, never a projection.
 */
export function summarizeHistory(snapshots) {
  if (snapshots.length === 0) {
    return {
      isEmpty: true,
      pointCount: 0,
      trackedDays: 0,
      first: null,
      last: null,
      change: 0,
      changePercentage: null,
      high: null,
      low: null,
      maxDrawdown: 0,
      bestDay: null,
      worstDay: null,
      contributionChange: 0
    };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const change = last.value - first.value;
  const changePercentage = first.value === 0 ? null : change / first.value;

  let high = snapshots[0];
  let low = snapshots[0];
  let peak = snapshots[0].value;
  let maxDrawdown = 0;
  let bestDay = null;
  let worstDay = null;

  snapshots.forEach((snapshot, index) => {
    if (snapshot.value > high.value) high = snapshot;
    if (snapshot.value < low.value) low = snapshot;

    peak = Math.max(peak, snapshot.value);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - snapshot.value) / peak);
    }

    if (index === 0) return;
    const previous = snapshots[index - 1];
    const delta = snapshot.value - previous.value;
    const move = {
      date: snapshot.date,
      change: delta,
      percentage: previous.value === 0 ? null : delta / previous.value
    };

    if (bestDay === null || delta > bestDay.change) bestDay = move;
    if (worstDay === null || delta < worstDay.change) worstDay = move;
  });

  return {
    isEmpty: false,
    pointCount: snapshots.length,
    trackedDays: daysBetween(first.date, last.date),
    first,
    last,
    change,
    changePercentage,
    high,
    low,
    maxDrawdown,
    bestDay,
    worstDay,
    // Value can move because money was added, not only because prices moved.
    // Separating the invested delta keeps the value change honest.
    contributionChange: last.invested - first.invested
  };
}

/** Change between the newest snapshot and the closest one N days earlier. */
export function changeOverDays(snapshots, days) {
  if (snapshots.length < 2) {
    return null;
  }

  const last = snapshots[snapshots.length - 1];
  const cutoff = new Date(`${last.date}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDate = toSnapshotDate(cutoff);

  const reference =
    [...snapshots].reverse().find((snapshot) => snapshot.date <= cutoffDate) ?? snapshots[0];

  if (reference.date === last.date) {
    return null;
  }

  const change = last.value - reference.value;

  return {
    from: reference,
    to: last,
    change,
    percentage: reference.value === 0 ? null : change / reference.value
  };
}

export function describeHistoryCoverage(snapshots) {
  if (snapshots.length === 0) {
    return "History starts the first time you open the portfolio with a holding tracked.";
  }

  if (snapshots.length === 1) {
    return "One day recorded so far. A point is added each day you open FirePath.";
  }

  const days = daysBetween(snapshots[0].date, snapshots[snapshots.length - 1].date) + 1;
  return `${snapshots.length} snapshots across ${days} ${days === 1 ? "day" : "days"}, recorded in this browser.`;
}

function daysBetween(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00`);
  const end = Date.parse(`${endDate}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 86_400_000));
}
