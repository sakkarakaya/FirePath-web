import { parseLocaleNumber } from "./numberInput.js";

/**
 * Locale and broker tolerant CSV imports.
 *
 * CSV is a family of formats rather than one format: spreadsheet exports use
 * commas, semicolons, tabs or pipes and broker exports are usually transaction
 * ledgers instead of ready-made holding snapshots. This module detects both
 * the dialect and the portfolio shape before mapping it to FirePath data.
 */

const assetTypeMap = {
  bond: "Bond",
  bonds: "Bond",
  cash: "Cash",
  crypto: "Crypto",
  cryptocurrency: "Crypto",
  etf: "ETF",
  fund: "ETF",
  other: "Other",
  realestate: "Real Estate",
  realproperty: "Real Estate",
  stock: "Stock",
  stocks: "Stock"
};

const regionMap = {
  emerging: "Emerging Markets",
  emergingmarkets: "Emerging Markets",
  europe: "Europe",
  global: "Global",
  other: "Other",
  usa: "USA",
  us: "USA",
  unitedstates: "USA"
};

const netWorthFieldAliases = {
  cash: "currentCash",
  currentcash: "currentCash",
  current_cash: "currentCash",
  debt: "debts",
  debts: "debts",
  emergencyfund: "emergencyFund",
  emergency_fund: "emergencyFund",
  expenses: "monthlyExpenses",
  income: "monthlyIncome",
  investments: "currentInvestments",
  monthlyexpenses: "monthlyExpenses",
  monthly_expenses: "monthlyExpenses",
  monthlyincome: "monthlyIncome",
  monthly_income: "monthlyIncome",
  monthlyinvestment: "monthlyInvestment",
  monthly_investment: "monthlyInvestment",
  portfolio: "currentInvestments",
  currentinvestments: "currentInvestments",
  current_investments: "currentInvestments"
};

const transactionHeaderAliases = {
  date: ["date", "transaction_date", "trade_date", "booking_date", "value_date", "datum"],
  status: ["status", "state"],
  reference: ["reference", "reference_id", "transaction_id", "id", "order_id"],
  name: ["description", "name", "security", "instrument", "product", "asset"],
  assetType: ["asset_type", "assettype", "category", "instrument_type"],
  type: ["type", "transaction_type", "action", "activity", "operation"],
  ticker: ["isin", "ticker", "symbol", "security_id", "instrument_id"],
  quantity: ["shares", "quantity", "units", "pieces", "qty", "stuck", "stueck"],
  price: ["price", "unit_price", "share_price", "rate", "kurs"],
  amount: ["amount", "total", "value", "gross_amount", "transaction_amount"],
  fee: ["fee", "fees", "commission", "charges", "costs"],
  tax: ["tax", "taxes", "withholding_tax", "withholding", "steuer"],
  currency: ["currency", "ccy", "waehrung"]
};

const ignoredStatuses = new Set([
  "cancelled",
  "canceled",
  "rejected",
  "expired",
  "failed",
  "pending",
  "storniert",
  "abgelehnt"
]);

const buyTypes = new Set([
  "buy",
  "purchase",
  "kauf",
  "savingsplan",
  "savingplan",
  "sparplan",
  "reinvestmentdistribution",
  "dividendreinvestment",
  "reinvestment"
]);

const sellTypes = new Set(["sell", "sale", "verkauf"]);
const dividendTypes = new Set([
  "distribution",
  "dividend",
  "dividende",
  "ausschuttung",
  "cashdistribution"
]);

export const PORTFOLIO_CSV_SAMPLE = [
  "asset_type,name,ticker,quantity,average_buy_price,current_price,currency,region,sector",
  "ETF,World ETF,IWDA,10,80,100,EUR,Global,Broad market",
  "Cash,Emergency cash,,1,5000,5000,EUR,Europe,Cash"
].join("\n");

export const NET_WORTH_CSV_SAMPLE = [
  "current_cash,current_investments,debts,emergency_fund,monthly_income,monthly_expenses,monthly_investment",
  "12000,45000,1000,6000,4000,2200,800"
].join("\n");

export const PORTFOLIO_CSV_HELP =
  "Upload a holdings list or broker transaction export. Comma, semicolon, tab and pipe separators are detected automatically.";
export const NET_WORTH_CSV_HELP =
  "Supported columns: current_cash, current_investments, debts, emergency_fund, monthly_income, monthly_expenses, monthly_investment.";

/**
 * Detects whether the file contains holding snapshots or dated broker activity.
 * Broker imports return transactions linked to holdings with a temporary
 * `holdingKey`; the store replaces that key with its generated holding id.
 */
export function parsePortfolioImportCsv(csv, defaultCurrency = "EUR") {
  const parsed = parseCsvRows(csv);

  if (looksLikeTransactionExport(parsed.headers)) {
    return parsePortfolioTransactions(parsed, defaultCurrency);
  }

  const result = parsePortfolioHoldingRows(parsed, defaultCurrency);
  return {
    ...result,
    format: "holdings",
    transactions: [],
    skippedRows: 0,
    importedRows: result.holdings.length,
    delimiter: parsed.delimiter
  };
}

export function parsePortfolioHoldingsCsv(csv, defaultCurrency = "EUR") {
  return parsePortfolioHoldingRows(parseCsvRows(csv), defaultCurrency);
}

function parsePortfolioHoldingRows({ rows, errors: parseErrors }, defaultCurrency) {
  const errors = [...parseErrors];
  const holdings = [];
  const decimalSeparator = detectDecimalSeparator(rows);

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = getCell(row, "name", "asset", "holding", "security", "description");
    const quantity = parseAmount(getCell(row, "quantity", "shares", "units", "pieces"), decimalSeparator);
    const currentPrice = parseAmount(
      getCell(row, "current_price", "currentprice", "price", "market_price", "marketprice"),
      decimalSeparator
    );
    const averageBuyPrice = parseAmount(
      getCell(row, "average_buy_price", "averagebuyprice", "buy_price", "buyprice", "cost_basis", "costbasis"),
      decimalSeparator
    );
    const exchangeRateToBase = parseAmount(
      getCell(row, "exchange_rate_to_base", "exchangeratetobase", "base_rate", "baserate"),
      decimalSeparator
    );
    const holdingCurrency = normalizeCurrency(getCell(row, "currency", "ccy") || defaultCurrency);
    const baseCurrency = normalizeCurrency(defaultCurrency);

    if (!name) {
      errors.push(`Row ${rowNumber}: name is required.`);
      return;
    }
    if (quantity === null || quantity <= 0) {
      errors.push(`Row ${rowNumber}: quantity must be greater than zero.`);
      return;
    }
    if (currentPrice === null || currentPrice <= 0) {
      errors.push(`Row ${rowNumber}: current_price must be greater than zero.`);
      return;
    }

    holdings.push({
      assetType: parseAssetType(getCell(row, "asset_type", "assettype", "type")),
      name,
      ticker: getCell(row, "ticker", "symbol", "isin"),
      quantity,
      averageBuyPrice: averageBuyPrice ?? currentPrice,
      currentPrice,
      currency: holdingCurrency,
      // A missing foreign-currency rate must not silently become 1:1. The
      // import flow resolves it before saving, or stops with a readable error.
      exchangeRateToBase: exchangeRateToBase ?? (holdingCurrency === baseCurrency ? 1 : 0),
      region: parseRegion(getCell(row, "region", "market")),
      sector: getCell(row, "sector", "industry")
    });
  });

  return { holdings, errors };
}

function parsePortfolioTransactions({ rows, errors: parseErrors, delimiter }, defaultCurrency) {
  const errors = [...parseErrors];
  const transactions = [];
  const securities = new Map();
  const positionQuantities = new Map();
  const decimalSeparator = detectDecimalSeparator(rows);
  let skippedRows = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const status = toKey(getAliasedCell(row, transactionHeaderAliases.status));
    const rawType = getAliasedCell(row, transactionHeaderAliases.type);
    const typeKey = toKey(rawType);
    const assetTypeKey = toKey(getAliasedCell(row, transactionHeaderAliases.assetType));
    const name = getAliasedCell(row, transactionHeaderAliases.name);
    const ticker = getAliasedCell(row, transactionHeaderAliases.ticker).toUpperCase();

    if (ignoredStatuses.has(status) || (!name && !ticker) || isNonPortfolioActivity(typeKey, assetTypeKey)) {
      skippedRows += 1;
      return;
    }

    const date = parseDate(getAliasedCell(row, transactionHeaderAliases.date));
    const rawQuantity = parseSignedAmount(
      getAliasedCell(row, transactionHeaderAliases.quantity),
      decimalSeparator
    );
    const price = parseAmount(getAliasedCell(row, transactionHeaderAliases.price), decimalSeparator);
    const amount = parseSignedAmount(getAliasedCell(row, transactionHeaderAliases.amount), decimalSeparator);
    const fee = parseAbsoluteAmount(getAliasedCell(row, transactionHeaderAliases.fee), decimalSeparator) ?? 0;
    const tax = parseAbsoluteAmount(getAliasedCell(row, transactionHeaderAliases.tax), decimalSeparator) ?? 0;
    const currency = normalizeCurrency(
      getAliasedCell(row, transactionHeaderAliases.currency) || defaultCurrency
    );
    const reference = getAliasedCell(row, transactionHeaderAliases.reference);
    const transactionType = mapTransactionType(typeKey, rawQuantity);

    if (!transactionType) {
      skippedRows += 1;
      return;
    }
    if (!date) {
      errors.push(`Row ${rowNumber}: transaction date is not recognized.`);
      return;
    }
    if (transactionType === "dividend") {
      if (amount === null || amount === 0) {
        // Brokers often emit a zero-value cash companion row for an expired
        // derivative. The matching corporate-action row carries the position
        // change; importing the empty cash row would add noise to the ledger.
        skippedRows += 1;
        return;
      }
    } else if (rawQuantity === null || Math.abs(rawQuantity) <= 0 || price === null) {
      errors.push(`Row ${rowNumber}: transaction quantity and price must be numeric.`);
      return;
    }

    const holdingKey = ticker || `${currency}:${toKey(name)}`;
    const existing = securities.get(holdingKey);
    const positivePrice = price !== null && price > 0 ? price : null;
    const candidate = {
      importKey: holdingKey,
      assetType: inferAssetType(name, ticker),
      name: name || ticker || "Imported security",
      ticker,
      quantity: 0,
      averageBuyPrice: positivePrice ?? 0,
      currentPrice: positivePrice ?? existing?.currentPrice ?? 0,
      currency,
      exchangeRateToBase: currency === normalizeCurrency(defaultCurrency) ? 1 : 0,
      region: inferRegion(name),
      sector: ""
    };

    // Broker files are often newest-first, so compare dates instead of letting
    // the physical row order decide which trade price becomes the snapshot.
    if (!existing || (positivePrice && date > existing.latestPriceDate)) {
      securities.set(holdingKey, {
        ...candidate,
        latestPriceDate: positivePrice ? date : existing?.latestPriceDate ?? ""
      });
    } else if (!existing.currentPrice && positivePrice) {
      securities.set(holdingKey, { ...existing, currentPrice: positivePrice, latestPriceDate: date });
    }

    const noteParts = ["CSV import", rawType.trim(), reference.trim()].filter(Boolean);
    transactions.push({
      holdingKey,
      type: transactionType,
      date,
      quantity: transactionType === "dividend" ? 0 : Math.abs(rawQuantity ?? 0),
      price: transactionType === "dividend" ? 0 : Math.abs(price ?? 0),
      amount: transactionType === "dividend" ? Math.abs(amount ?? 0) : 0,
      // The ledger has one cost field. Including withholding tax here preserves
      // the net cash flow reported by the broker.
      fee: fee + tax,
      note: noteParts.join(" · ")
    });

    if (transactionType === "buy" || transactionType === "sell") {
      const direction = transactionType === "buy" ? 1 : -1;
      positionQuantities.set(
        holdingKey,
        (positionQuantities.get(holdingKey) ?? 0) + direction * Math.abs(rawQuantity ?? 0)
      );
    }
  });

  const holdings = Array.from(securities.values()).map(({ latestPriceDate, ...holding }) => ({
    ...holding,
    quantity: Math.max(0, positionQuantities.get(holding.importKey) ?? 0),
    currentPrice: holding.currentPrice > 0 ? holding.currentPrice : holding.averageBuyPrice
  }));

  transactions.sort((left, right) => left.date.localeCompare(right.date));

  if (holdings.length === 0 && errors.length === 0) {
    errors.push("No supported portfolio transactions were found.");
  }

  return {
    format: "transactions",
    holdings,
    transactions,
    errors,
    skippedRows,
    importedRows: transactions.length,
    delimiter
  };
}

export function parseNetWorthCsv(csv) {
  const parsed = parseCsv(csv);
  const errors = [...parsed.errors];
  const snapshot = {};

  if (parsed.records.length === 0) {
    return { snapshot, errors: errors.length > 0 ? errors : ["CSV has no rows."] };
  }

  const firstRow = parsed.records[0] ?? [];
  const headers = firstRow.map(normalizeHeader);
  const hasMetricValueShape =
    (headers.includes("metric") && headers.includes("value")) ||
    (headers.includes("field") && headers.includes("value")) ||
    (headers.includes("key") && headers.includes("value"));

  if (hasMetricValueShape) {
    const metricIndex = firstMatchingIndex(headers, ["metric", "field", "key"]);
    const valueIndex = headers.indexOf("value");

    parsed.records.slice(1).forEach((record, index) => {
      const field = netWorthFieldAliases[normalizeHeader(record[metricIndex] ?? "")];
      const value = parseAmount(record[valueIndex] ?? "");
      if (!field) {
        errors.push(`Row ${index + 2}: unknown net worth field.`);
        return;
      }
      if (value === null) {
        errors.push(`Row ${index + 2}: value must be numeric.`);
        return;
      }
      snapshot[field] = value;
    });
    return { snapshot, errors };
  }

  const parsedRows = rowsFromParsedCsv(parsed);
  errors.push(...parsedRows.errors);
  if (parsedRows.rows.length === 0) {
    return { snapshot, errors: errors.length > 0 ? errors : ["CSV has no data row."] };
  }

  const row = parsedRows.rows[0];
  Object.entries(row).forEach(([header, value]) => {
    const field = netWorthFieldAliases[normalizeHeader(header)];
    if (!field || value.trim().length === 0) return;
    const parsedValue = parseAmount(value);
    if (parsedValue === null) {
      errors.push(`${header}: value must be numeric.`);
      return;
    }
    snapshot[field] = parsedValue;
  });

  if (Object.keys(snapshot).length === 0 && errors.length === 0) {
    errors.push("No supported net worth columns found.");
  }
  return { snapshot, errors };
}

function parseCsvRows(csv) {
  return rowsFromParsedCsv(parseCsv(csv));
}

function rowsFromParsedCsv(parsed) {
  const [headerRecord, ...dataRecords] = parsed.records;
  if (!headerRecord) {
    return {
      rows: [],
      headers: [],
      delimiter: parsed.delimiter,
      errors: parsed.errors.length > 0 ? parsed.errors : ["CSV has no header row."]
    };
  }

  const headers = headerRecord.map(normalizeHeader);
  const rows = dataRecords
    .filter((record) => record.some((cell) => cell.trim().length > 0))
    .map((record) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = record[index]?.trim() ?? "";
      });
      return row;
    });
  return { rows, headers, delimiter: parsed.delimiter, errors: parsed.errors };
}

function parseCsv(csv) {
  let source = String(csv ?? "").replace(/^\uFEFF/, "");
  const separatorDirective = source.match(/^sep=(.)\s*(?:\r?\n|\r)/i);
  const delimiter = separatorDirective?.[1] ?? detectDelimiter(source);
  if (separatorDirective) source = source.slice(separatorDirective[0].length);

  const records = [];
  const errors = [];
  let record = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      record.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      record.push(cell);
      addRecord(records, record);
      record = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  if (inQuotes) errors.push("CSV has an unclosed quoted value.");
  record.push(cell);
  addRecord(records, record);
  return { records, errors, delimiter };
}

function detectDelimiter(source) {
  const firstLine = firstLogicalLine(source);
  const candidates = [",", ";", "\t", "|"];
  let winner = ",";
  let highScore = -1;
  candidates.forEach((candidate) => {
    const score = countOutsideQuotes(firstLine, candidate);
    if (score > highScore) {
      winner = candidate;
      highScore = score;
    }
  });
  return winner;
}

function firstLogicalLine(source) {
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '"') {
      if (inQuotes && source[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (source[index] === "\n" || source[index] === "\r")) {
      return source.slice(0, index);
    }
  }
  return source;
}

function countOutsideQuotes(value, character) {
  let inQuotes = false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') {
      if (inQuotes && value[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && value[index] === character) {
      count += 1;
    }
  }
  return count;
}

function addRecord(records, record) {
  if (record.some((cell) => cell.trim().length > 0)) {
    records.push(record.map((cell) => cell.trim()));
  }
}

function looksLikeTransactionExport(headers) {
  return (
    hasAnyHeader(headers, transactionHeaderAliases.date) &&
    hasAnyHeader(headers, transactionHeaderAliases.type) &&
    (hasAnyHeader(headers, transactionHeaderAliases.quantity) ||
      hasAnyHeader(headers, transactionHeaderAliases.amount))
  );
}

function hasAnyHeader(headers, aliases) {
  return aliases.some((alias) => headers.includes(normalizeHeader(alias)));
}

function getAliasedCell(row, aliases) {
  return getCell(row, ...aliases);
}

function getCell(row, ...keys) {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value !== undefined) return value.trim();
  }
  return "";
}

function parseAmount(value, decimalSeparator = null) {
  const parsed = parseSignedAmount(value, decimalSeparator);
  return parsed === null ? null : Math.max(0, parsed);
}

function parseAbsoluteAmount(value, decimalSeparator = null) {
  const parsed = parseSignedAmount(value, decimalSeparator);
  return parsed === null ? null : Math.abs(parsed);
}

function parseSignedAmount(value, decimalSeparator = null) {
  if (!String(value ?? "").trim()) return null;
  const parsed = decimalSeparator
    ? parseNumberWithDecimalSeparator(value, decimalSeparator)
    : parseLocaleNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberWithDecimalSeparator(value, decimalSeparator) {
  const compact = String(value ?? "").trim().replace(/[^0-9.,\-]/g, "");
  if (!compact) return Number.NaN;

  const groupingSeparator = decimalSeparator === "," ? "." : ",";
  const ungrouped = compact.split(groupingSeparator).join("");
  const parts = ungrouped.split(decimalSeparator);
  const normalized =
    parts.length > 1 ? `${parts.slice(0, -1).join("")}.${parts[parts.length - 1]}` : ungrouped;
  return Number(normalized);
}

/**
 * Finds the convention used by the file as a whole. Values with two decimal
 * digits are strong evidence; a three-digit suffix is deliberately weak
 * because `1.000` can mean either one or one thousand in isolation.
 */
function detectDecimalSeparator(rows) {
  let commaScore = 0;
  let dotScore = 0;

  rows.forEach((row) => {
    Object.values(row).forEach((rawValue) => {
      const source = String(rawValue ?? "").trim();
      if (!/^[+\-0-9.,\s€$£¥₺'’]*$/.test(source)) return;
      const value = source.replace(/[^0-9.,\-]/g, "");
      if (!/\d/.test(value)) return;

      const lastComma = value.lastIndexOf(",");
      const lastDot = value.lastIndexOf(".");
      if (lastComma >= 0 && lastDot >= 0) {
        if (lastComma > lastDot) commaScore += 4;
        else dotScore += 4;
        return;
      }

      const scoreSingle = (separatorIndex) => {
        const fractionLength = value.length - separatorIndex - 1;
        return fractionLength === 3 ? 0.25 : fractionLength > 0 ? 2 : 0;
      };
      if (lastComma >= 0) commaScore += scoreSingle(lastComma);
      if (lastDot >= 0) dotScore += scoreSingle(lastDot);
    });
  });

  if (commaScore > dotScore * 1.5) return ",";
  if (dotScore > commaScore * 1.5) return ".";
  return null;
}

function parseDate(value) {
  const input = String(value ?? "").trim().slice(0, 10);
  let parts;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(input)) {
    parts = input.split(/[-/.]/).map(Number);
  } else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(input)) {
    const [day, month, year] = input.split(/[-/.]/).map(Number);
    parts = [year, month, day];
  } else {
    return "";
  }

  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mapTransactionType(typeKey, quantity) {
  if (buyTypes.has(typeKey)) return "buy";
  if (sellTypes.has(typeKey)) return "sell";
  if (dividendTypes.has(typeKey)) return "dividend";
  if ((typeKey === "corporateaction" || typeKey === "positionadjustment") && quantity !== null) {
    return quantity < 0 ? "sell" : "buy";
  }
  return null;
}

function isNonPortfolioActivity(typeKey, assetTypeKey) {
  if (["deposit", "withdrawal", "interest", "taxes", "tax", "fee"].includes(typeKey)) return true;
  if (["securitytransfer", "transfer", "internaltransfer"].includes(typeKey)) return true;
  return assetTypeKey === "cash" && !dividendTypes.has(typeKey);
}

function inferAssetType(name, ticker) {
  const key = toKey(`${name} ${ticker}`);
  if (/bitcoin|ethereum|crypto/.test(key)) return "Crypto";
  if (/etf|ishares|vanguard|amundi|vaneck|fund|ucits/.test(key)) return "ETF";
  if (/bond|treasury|anleihe/.test(key)) return "Bond";
  return "Stock";
}

function inferRegion(name) {
  return /world|global|allcountry|allworld/i.test(name) ? "Global" : "Other";
}

function parseAssetType(value) {
  return assetTypeMap[toKey(value)] ?? "Other";
}

function parseRegion(value) {
  return regionMap[toKey(value)] ?? "Other";
}

function normalizeCurrency(value) {
  return String(value ?? "").trim().toUpperCase() || "EUR";
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function firstMatchingIndex(values, candidates) {
  for (const candidate of candidates) {
    const index = values.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}
