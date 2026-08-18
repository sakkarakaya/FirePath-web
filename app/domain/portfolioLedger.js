/**
 * Transaction ledger.
 *
 * A holding on its own is a snapshot: quantity and one average buy price. That
 * cannot answer what was actually realized on a sale, how long a position has
 * been held, or what the money-weighted return is. The ledger records the buys,
 * sells and dividends behind a holding and derives those, with the snapshot
 * fields recomputed from it so every existing screen keeps working unchanged.
 *
 * Lots are matched first-in-first-out, which is the order German brokers report
 * and the order a reader comparing against a broker statement will expect.
 * Amounts stay in the holding's own currency. Callers that show a current
 * snapshot use the current rate; historical reports supply dated FX series.
 */

export const TRANSACTION_TYPES = ["buy", "sell", "dividend"];

export const TRANSACTION_LABELS = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend"
};

export const OPENING_NOTE = "Opening position";

/** Total in the holding's currency, before fees. */
export function transactionAmount(transaction) {
  if (transaction.type === "dividend") {
    return Math.max(0, Number(transaction.amount) || 0);
  }
  return Math.max(0, Number(transaction.quantity) || 0) * Math.max(0, Number(transaction.price) || 0);
}

/** Signed cash movement: negative when money leaves the wallet. */
export function transactionCashFlow(transaction) {
  const amount = transactionAmount(transaction);
  const fee = Math.max(0, Number(transaction.fee) || 0);

  if (transaction.type === "buy") return -(amount + fee);
  if (transaction.type === "sell") return amount - fee;
  return amount - fee;
}

export function sortTransactions(transactions) {
  return [...transactions].sort((left, right) => {
    const byDate = String(left.date).localeCompare(String(right.date));
    return byDate !== 0 ? byDate : (Number(left.id) || 0) - (Number(right.id) || 0);
  });
}

export function transactionsForHolding(transactions, holdingId) {
  return sortTransactions(transactions.filter((transaction) => transaction.holdingId === holdingId));
}

/**
 * Walks the ledger in date order and matches sales against the oldest open lot
 * first. Returns the lots still open plus one record per sale.
 */
export function buildLots(transactions) {
  const openLots = [];
  const sales = [];
  let unmatchedQuantity = 0;

  sortTransactions(transactions).forEach((transaction) => {
    const quantity = Math.max(0, Number(transaction.quantity) || 0);

    if (transaction.type === "buy") {
      if (quantity <= 0) return;
      const fee = Math.max(0, Number(transaction.fee) || 0);

      openLots.push({
        transactionId: transaction.id,
        date: transaction.date,
        quantity,
        // Fees are part of what the units cost, so they belong in the basis.
        unitCost: (quantity * Math.max(0, Number(transaction.price) || 0) + fee) / quantity
      });
      return;
    }

    if (transaction.type !== "sell" || quantity <= 0) {
      return;
    }

    const price = Math.max(0, Number(transaction.price) || 0);
    const fee = Math.max(0, Number(transaction.fee) || 0);
    let remaining = quantity;
    let cost = 0;

    while (remaining > 0 && openLots.length > 0) {
      const lot = openLots[0];
      const taken = Math.min(lot.quantity, remaining);
      cost += taken * lot.unitCost;
      lot.quantity -= taken;
      remaining -= taken;

      if (lot.quantity <= 1e-9) {
        openLots.shift();
      }
    }

    // Hand-edited or partially imported data can sell units the ledger never
    // bought. Record it rather than inventing a cost basis for them.
    unmatchedQuantity += remaining;

    const matched = quantity - remaining;
    const proceeds = quantity * price - fee;

    sales.push({
      transactionId: transaction.id,
      date: transaction.date,
      quantity,
      matchedQuantity: matched,
      proceeds,
      cost,
      gainLoss: proceeds - cost,
      gainLossPercentage: cost === 0 ? null : (proceeds - cost) / cost
    });
  });

  return { openLots, sales, unmatchedQuantity };
}

/**
 * Everything the ledger knows about one holding, in the holding's currency.
 * Returns null when there are no transactions, so callers can fall back to the
 * manually entered snapshot.
 */
export function summarizeHoldingLedger(transactions) {
  if (transactions.length === 0) {
    return null;
  }

  const sorted = sortTransactions(transactions);
  const { openLots, sales, unmatchedQuantity } = buildLots(sorted);

  const quantity = openLots.reduce((total, lot) => total + lot.quantity, 0);
  const costBasis = openLots.reduce((total, lot) => total + lot.quantity * lot.unitCost, 0);
  const dividends = sorted
    .filter((transaction) => transaction.type === "dividend")
    .reduce((total, transaction) => total + transactionAmount(transaction) - feeOf(transaction), 0);
  const fees = sorted.reduce((total, transaction) => total + feeOf(transaction), 0);
  const realizedGainLoss = sales.reduce((total, sale) => total + sale.gainLoss, 0);
  const buys = sorted.filter((transaction) => transaction.type === "buy");
  const firstBuy = buys[0] ?? null;

  return {
    quantity,
    costBasis,
    averageCost: quantity <= 0 ? 0 : costBasis / quantity,
    openLots,
    sales,
    unmatchedQuantity,
    realizedGainLoss,
    dividends,
    fees,
    transactionCount: sorted.length,
    buyCount: buys.length,
    sellCount: sales.length,
    firstBuyDate: firstBuy?.date ?? null,
    lastTransactionDate: sorted[sorted.length - 1]?.date ?? null,
    holdingPeriodDays: firstBuy ? daysSince(firstBuy.date) : null,
    // What is still tied up in the position after everything it has paid back.
    netInvested: sorted.reduce((total, transaction) => total - transactionCashFlow(transaction), 0)
  };
}

/**
 * The snapshot fields a holding keeps, recalculated from its ledger. Written
 * back on every ledger change so the rest of the app never has to know whether
 * a holding is ledger-managed.
 */
export function deriveHoldingSnapshot(transactions) {
  const summary = summarizeHoldingLedger(transactions);

  if (summary === null) {
    return null;
  }

  return {
    quantity: roundUnits(summary.quantity),
    averageBuyPrice: roundMoney(summary.averageCost)
  };
}

/** Portfolio-wide ledger totals, converted into the base currency. */
export function summarizeLedger(holdings, transactions) {
  const perHolding = holdings
    .map((holding) => {
      const rows = transactionsForHolding(transactions, holding.id);
      const summary = summarizeHoldingLedger(rows);
      return summary === null ? null : { holding, summary };
    })
    .filter(Boolean);

  if (perHolding.length === 0) {
    return {
      isEmpty: true,
      trackedHoldings: 0,
      realizedGainLoss: 0,
      dividends: 0,
      fees: 0,
      transactionCount: 0,
      sales: [],
      xirr: null,
      xirrCoverage: 0
    };
  }

  const rate = (holding) => Math.max(0, Number(holding.exchangeRateToBase) || 0);
  const valueOf = (holding) =>
    Math.max(0, Number(holding.quantity) || 0) * Math.max(0, Number(holding.currentPrice) || 0) * rate(holding);
  const totalValue = holdings.reduce((total, holding) => total + valueOf(holding), 0);
  const ledgerValue = perHolding.reduce((total, entry) => total + valueOf(entry.holding), 0);

  return {
    isEmpty: false,
    trackedHoldings: perHolding.length,
    realizedGainLoss: perHolding.reduce(
      (total, entry) => total + entry.summary.realizedGainLoss * rate(entry.holding),
      0
    ),
    dividends: perHolding.reduce(
      (total, entry) => total + entry.summary.dividends * rate(entry.holding),
      0
    ),
    fees: perHolding.reduce((total, entry) => total + entry.summary.fees * rate(entry.holding), 0),
    transactionCount: perHolding.reduce((total, entry) => total + entry.summary.transactionCount, 0),
    sales: perHolding
      .flatMap((entry) => entry.summary.sales.map((sale) => ({ ...sale, holding: entry.holding })))
      .sort((left, right) => String(right.date).localeCompare(String(left.date))),
    xirr: calculatePortfolioXirr(
      perHolding.map((entry) => entry.holding),
      transactions
    ),
    // A money-weighted return only covers the positions that have a ledger, so
    // the share of value it speaks for is reported next to it.
    xirrCoverage: totalValue === 0 ? 0 : ledgerValue / totalValue
  };
}

/**
 * Amount shown by portfolio history as net money still paid into the tracked
 * portfolio. Ledger positions use their actual cash flows; manual positions
 * fall back to their open cost because no earlier cash-flow history exists.
 */
export function calculatePortfolioNetInvested(holdings, transactions) {
  return holdings.reduce((total, holding) => {
    const rate = Math.max(0, Number(holding.exchangeRateToBase) || 0);
    const rows = transactionsForHolding(transactions, holding.id);

    if (rows.length === 0) {
      const quantity = Math.max(0, Number(holding.quantity) || 0);
      const averageCost = Math.max(0, Number(holding.averageBuyPrice) || 0);
      return total + quantity * averageCost * rate;
    }

    const summary = summarizeHoldingLedger(rows);
    return total + Math.max(0, summary?.netInvested ?? 0) * rate;
  }, 0);
}

/**
 * Money-weighted return: the annual rate that discounts every cash flow, plus
 * today's value, back to zero. Unlike a simple gain percentage it accounts for
 * when money went in, which is what makes a monthly savings plan comparable to
 * a lump sum.
 */
export function calculateXirr(flows, { maxIterations = 80, tolerance = 1e-7 } = {}) {
  const usable = flows
    .map((flow) => ({ time: Date.parse(`${String(flow.date).slice(0, 10)}T00:00:00`), amount: Number(flow.amount) }))
    .filter((flow) => Number.isFinite(flow.time) && Number.isFinite(flow.amount) && flow.amount !== 0)
    .sort((left, right) => left.time - right.time);

  const hasInflow = usable.some((flow) => flow.amount > 0);
  const hasOutflow = usable.some((flow) => flow.amount < 0);

  if (usable.length < 2 || !hasInflow || !hasOutflow) {
    return null;
  }

  const start = usable[0].time;
  const years = (flow) => (flow.time - start) / (365 * 86_400_000);
  const netPresentValue = (rate) =>
    usable.reduce((total, flow) => total + flow.amount / (1 + rate) ** years(flow), 0);

  // Newton converges in a handful of steps for well-behaved series; bisection
  // is the fallback for the ones where it oscillates or leaves the domain.
  let rate = 0.1;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const value = netPresentValue(rate);
    if (Math.abs(value) < tolerance) {
      return clampRate(rate);
    }

    const derivative = usable.reduce(
      (total, flow) => total - (years(flow) * flow.amount) / (1 + rate) ** (years(flow) + 1),
      0
    );

    if (!Number.isFinite(derivative) || derivative === 0) {
      break;
    }

    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.999999) {
      break;
    }
    if (Math.abs(next - rate) < tolerance) {
      return clampRate(next);
    }
    rate = next;
  }

  let low = -0.9999;
  let high = 10;
  if (netPresentValue(low) * netPresentValue(high) > 0) {
    return null;
  }

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    const value = netPresentValue(middle);

    if (Math.abs(value) < tolerance) {
      return clampRate(middle);
    }

    if (netPresentValue(low) * value < 0) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return clampRate((low + high) / 2);
}

/**
 * Cash flows for one holding, ending with today's market value as the closing
 * inflow. That closing value is what turns an open position into something a
 * return can be computed on.
 */
export function buildHoldingCashFlows(holding, transactions, { asOf = new Date() } = {}) {
  const rate = Math.max(0, Number(holding.exchangeRateToBase) || 0);
  const flows = sortTransactions(transactions).map((transaction) => ({
    date: transaction.date,
    amount: transactionCashFlow(transaction) * rate
  }));

  const currentValue =
    Math.max(0, Number(holding.quantity) || 0) * Math.max(0, Number(holding.currentPrice) || 0) * rate;

  if (currentValue > 0) {
    flows.push({ date: toDateKey(asOf), amount: currentValue });
  }

  return flows;
}

export function calculateHoldingXirr(holding, transactions, options) {
  if (transactions.length === 0) {
    return null;
  }
  return calculateXirr(buildHoldingCashFlows(holding, transactions, options));
}

/** Portfolio money-weighted return across every ledger-tracked holding. */
export function calculatePortfolioXirr(holdings, transactions, options) {
  const flows = holdings.flatMap((holding) => {
    const rows = transactionsForHolding(transactions, holding.id);
    return rows.length === 0 ? [] : buildHoldingCashFlows(holding, rows, options);
  });

  return flows.length === 0 ? null : calculateXirr(flows);
}

/** Income per calendar month, newest last, for the dividend chart. */
export function buildDividendTimeline(holdings, transactions, { months = 12, asOf = new Date() } = {}) {
  const byHolding = new Map(holdings.map((holding) => [holding.id, holding]));
  const buckets = new Map();

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(asOf.getFullYear(), asOf.getMonth() - offset, 1);
    buckets.set(monthKey(date), { key: monthKey(date), date, value: 0, count: 0 });
  }

  transactions
    .filter((transaction) => transaction.type === "dividend")
    .forEach((transaction) => {
      const bucket = buckets.get(String(transaction.date).slice(0, 7));
      const holding = byHolding.get(transaction.holdingId);
      if (!bucket || !holding) return;

      bucket.value +=
        (transactionAmount(transaction) - feeOf(transaction)) *
        Math.max(0, Number(holding.exchangeRateToBase) || 0);
      bucket.count += 1;
    });

  return Array.from(buckets.values());
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Rejects the entries that would make the ledger describe something that never
 * happened — most importantly selling more units than the ledger holds on that
 * date, which would otherwise silently produce a cost basis out of nothing.
 */
export function validateTransaction(input, { existing = [], editingId = null } = {}) {
  if (!TRANSACTION_TYPES.includes(input.type)) {
    return "Pick whether this is a buy, a sell or a dividend.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? ""))) {
    return "Enter a valid date.";
  }

  if (input.type === "dividend") {
    return Math.max(0, Number(input.amount) || 0) > 0 ? null : "Enter the dividend amount received.";
  }

  const quantity = Number(input.quantity);
  const price = Number(input.price);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return "Enter how many units were traded.";
  }

  if (!Number.isFinite(price) || price <= 0) {
    return "Enter the price per unit.";
  }

  if (input.type === "sell") {
    const others = existing.filter((transaction) => transaction.id !== editingId);
    const held = heldQuantityOn(others, input.date);

    if (quantity > held + 1e-9) {
      return held <= 0
        ? "There are no units held on that date to sell."
        : `Only ${formatUnits(held)} units are held on that date.`;
    }
  }

  return null;
}

/** Units the ledger holds on a given date, counting that day's entries. */
export function heldQuantityOn(transactions, date) {
  return sortTransactions(transactions)
    .filter((transaction) => String(transaction.date) <= String(date))
    .reduce((total, transaction) => {
      const quantity = Math.max(0, Number(transaction.quantity) || 0);
      if (transaction.type === "buy") return total + quantity;
      if (transaction.type === "sell") return total - quantity;
      return total;
    }, 0);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function feeOf(transaction) {
  return Math.max(0, Number(transaction.fee) || 0);
}

function daysSince(date) {
  const parsed = Date.parse(`${String(date).slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 86_400_000));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateKey(date) {
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function clampRate(rate) {
  return Number.isFinite(rate) ? Math.max(-0.9999, Math.min(100, rate)) : null;
}

function roundUnits(value) {
  return Math.round((Number(value) || 0) * 1e8) / 1e8;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

function formatUnits(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}
