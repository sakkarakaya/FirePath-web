import { parseLocaleNumber } from "./numberInput.js";

/**
 * CSV import for holdings and net worth snapshots, ported from the mobile app.
 * Accepts the column aliases people actually export from spreadsheets and
 * brokers rather than demanding one exact header row.
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
  "Supported columns: asset_type, name, ticker, quantity, average_buy_price, current_price, currency, exchange_rate_to_base, region, sector.";
export const NET_WORTH_CSV_HELP =
  "Supported columns: current_cash, current_investments, debts, emergency_fund, monthly_income, monthly_expenses, monthly_investment.";

export function parsePortfolioHoldingsCsv(csv, defaultCurrency = "EUR") {
  const { rows, errors } = parseCsvRows(csv);
  const holdings = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = getCell(row, "name", "asset", "holding", "security");
    const quantity = parseAmount(getCell(row, "quantity", "shares", "units"));
    const currentPrice = parseAmount(
      getCell(row, "current_price", "currentprice", "price", "market_price", "marketprice")
    );
    const averageBuyPrice = parseAmount(
      getCell(row, "average_buy_price", "averagebuyprice", "buy_price", "buyprice", "cost_basis", "costbasis")
    );
    const exchangeRateToBase = parseAmount(
      getCell(row, "exchange_rate_to_base", "exchangeratetobase", "base_rate", "baserate")
    );

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
      currency: normalizeCurrency(getCell(row, "currency", "ccy") || defaultCurrency),
      exchangeRateToBase: exchangeRateToBase ?? 1,
      region: parseRegion(getCell(row, "region", "market")),
      sector: getCell(row, "sector", "industry")
    });
  });

  return { holdings, errors };
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

  const { rows, errors: rowErrors } = parseCsvRows(csv);
  errors.push(...rowErrors);

  if (rows.length === 0) {
    return { snapshot, errors: errors.length > 0 ? errors : ["CSV has no data row."] };
  }

  const row = rows[0];
  Object.entries(row).forEach(([header, value]) => {
    const field = netWorthFieldAliases[normalizeHeader(header)];
    if (!field || value.trim().length === 0) {
      return;
    }

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
  const parsed = parseCsv(csv);
  const [headerRecord, ...dataRecords] = parsed.records;

  if (!headerRecord) {
    return { rows: [], errors: parsed.errors.length > 0 ? parsed.errors : ["CSV has no header row."] };
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

  return { rows, errors: parsed.errors };
}

function parseCsv(csv) {
  const records = [];
  const errors = [];
  let record = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      record.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      record.push(cell);
      addRecord(records, record);
      record = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (inQuotes) {
    errors.push("CSV has an unclosed quoted value.");
  }

  record.push(cell);
  addRecord(records, record);

  return { records, errors };
}

function addRecord(records, record) {
  if (record.some((cell) => cell.trim().length > 0)) {
    records.push(record.map((cell) => cell.trim()));
  }
}

function getCell(row, ...keys) {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value !== undefined) {
      return value.trim();
    }
  }
  return "";
}

// Returns null (rather than 0) for blank/unparsable cells so callers can tell
// "column absent" apart from "column present with value 0".
function parseAmount(value) {
  if (!value.trim()) {
    return null;
  }

  const parsed = parseLocaleNumber(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function parseAssetType(value) {
  return assetTypeMap[toKey(value)] ?? "Other";
}

function parseRegion(value) {
  return regionMap[toKey(value)] ?? "Other";
}

function normalizeCurrency(value) {
  return value.trim().toUpperCase() || "EUR";
}

function normalizeHeader(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

function toKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstMatchingIndex(values, candidates) {
  for (const candidate of candidates) {
    const index = values.indexOf(candidate);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}
