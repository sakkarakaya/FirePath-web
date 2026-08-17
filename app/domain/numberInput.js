/**
 * Locale-tolerant parsing for money and percentage text fields.
 *
 * Users type amounts in their own convention ("1.234,56" in de/tr, "1,234.56" in
 * en). Naive `value.replace(",", ".")` silently corrupts both of those into
 * 1.234, so every numeric field in the app must go through these helpers.
 *
 * Disambiguation rules, in order:
 *  1. Both separators present -> the right-most one is the decimal separator.
 *  2. One separator type, repeated ("1.234.567") -> it is a grouping separator.
 *  3. A single separator ("1,5" / "1.5") -> it is the decimal separator.
 */

const NON_NUMERIC = /[^0-9.,\-]/g;

export function parseLocaleNumber(value) {
  const compact = String(value ?? "")
    .trim()
    .replace(NON_NUMERIC, "");
  if (!compact) {
    return Number.NaN;
  }

  const negative = compact.startsWith("-");
  const digits = compact.replace(/-/g, "");
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");

  let normalized;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = digits.split(groupingSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = countOccurrences(digits, ",") > 1 ? digits.split(",").join("") : digits.replace(",", ".");
  } else if (lastDot >= 0) {
    normalized = countOccurrences(digits, ".") > 1 ? digits.split(".").join("") : digits;
  } else {
    normalized = digits;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }

  return negative ? -parsed : parsed;
}

/** Parses user input, clamping to >= 0. Invalid input becomes 0. */
export function parsePositiveNumber(value) {
  const parsed = parseLocaleNumber(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Parses user input allowing negatives. Invalid input becomes 0. */
export function parseSignedNumber(value) {
  const parsed = parseLocaleNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWholeNumber(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Renders a stored 0-1 rate as an editable percentage string ("0.035" -> "3.5"). */
export function formatRateForInput(rate) {
  if (!Number.isFinite(rate)) {
    return "0";
  }
  return Number((rate * 100).toFixed(2)).toString();
}

/** Renders a stored number for an editable text field without exponent notation. */
export function formatNumberForInput(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(Number(value.toFixed(6)));
}

function countOccurrences(value, character) {
  let count = 0;
  for (const entry of value) {
    if (entry === character) {
      count += 1;
    }
  }
  return count;
}
