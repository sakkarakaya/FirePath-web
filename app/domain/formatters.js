/** Currency, percentage and duration formatting shared with the mobile app. */

const currencyLocales = {
  EUR: "de-DE",
  USD: "en-US",
  TRY: "tr-TR",
  GBP: "en-GB",
  CHF: "de-CH"
};

const currencySymbols = {
  EUR: "€",
  USD: "$",
  TRY: "₺",
  GBP: "£",
  CHF: "CHF"
};

export function formatCurrency(value, currency = "EUR", maximumFractionDigits = 0) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const currencyCode = normalizeCurrencyCode(currency);

  if (currencyCode === "TRY") {
    return `${formatNumber(safeValue, "tr-TR", maximumFractionDigits)} ${getCurrencySymbol(currencyCode)}`;
  }

  try {
    return new Intl.NumberFormat(currencyLocales[currencyCode] ?? "en-US", {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits
    }).format(safeValue);
  } catch {
    return formatCurrencyFallback(safeValue, currencyCode, maximumFractionDigits);
  }
}

export function getCurrencySymbol(currency = "EUR") {
  const currencyCode = normalizeCurrencyCode(currency);
  return currencySymbols[currencyCode] ?? currencyCode;
}

export function formatCurrencyOptionLabel(currency) {
  return getCurrencySymbol(currency);
}

export function formatPercent(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatYears(value) {
  if (value === null) {
    return "Not reachable";
  }
  if (value === 0) {
    return "Now";
  }
  return `${value.toFixed(1)} years`;
}

/** Human duration for projection deltas: sub-year values read better in months. */
export function formatDurationYears(years) {
  const safeYears = Number.isFinite(years) ? Math.abs(years) : 0;

  if (safeYears < 1) {
    const months = Math.max(1, Math.round(safeYears * 12));
    return `${months} ${months === 1 ? "month" : "months"}`;
  }

  return `${safeYears.toFixed(1)} years`;
}

/** Compact money for chart axes and dense tables ("€1.2M"). */
export function formatCompactCurrency(value, currency = "EUR") {
  const safeValue = Number.isFinite(value) ? value : 0;
  const symbol = getCurrencySymbol(currency);
  const abs = Math.abs(safeValue);
  const sign = safeValue < 0 ? "-" : "";

  if (abs >= 1000000) {
    return `${sign}${symbol}${Number((abs / 1000000).toFixed(1))}M`;
  }
  if (abs >= 1000) {
    return `${sign}${symbol}${Number((abs / 1000).toFixed(abs >= 100000 ? 0 : 1))}k`;
  }
  return `${sign}${symbol}${Math.round(abs)}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCurrencyCode(currency) {
  return (currency || "EUR").trim().toUpperCase();
}

function formatNumber(value, locale, maximumFractionDigits) {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
  } catch {
    return value.toFixed(maximumFractionDigits);
  }
}

function formatCurrencyFallback(value, currencyCode, maximumFractionDigits) {
  const amount = value.toFixed(maximumFractionDigits);
  const symbol = getCurrencySymbol(currencyCode);

  if (currencyCode === "EUR" || currencyCode === "TRY") {
    return `${amount} ${symbol}`;
  }

  if (currencyCode === "CHF") {
    return `${symbol} ${amount}`;
  }

  return `${symbol}${amount}`;
}
