import { getMonthRange } from "./dateRange.js";
import { calculateTransactionTotals } from "./moneyCalculations.js";
import { disclaimer } from "../data/copy.js";

export function buildMonthlyReport({ profile, transactions, holdings, metrics, date = new Date() }) {
  const { startDate, endDate, periodLabel } = getMonthRange(date);
  const monthlyTransactions = transactions.filter(
    (transaction) => transaction.date >= startDate && transaction.date <= endDate
  );
  const totals = calculateTransactionTotals(monthlyTransactions);

  return {
    periodLabel,
    startDate,
    endDate,
    income: totals.totalIncome,
    expenses: totals.totalExpenses,
    savings: totals.savingsAmount,
    savingsRate: totals.savingsRate,
    plannedInvestment: profile?.monthlyInvestment ?? 0,
    netWorth: metrics.netWorth,
    portfolioValue: metrics.portfolioCoverage.totalValue,
    fireProgress: metrics.fireProgress,
    holdingCount: holdings.length
  };
}

export function buildFinancialSummaryCsv(report, currency) {
  const rows = [
    ["FirePath financial summary"],
    ["Period", report.periodLabel],
    ["Start date", report.startDate],
    ["End date", report.endDate],
    [],
    ["Metric", "Value", "Currency/Unit"],
    ["Income", report.income.toFixed(2), currency],
    ["Expenses", report.expenses.toFixed(2), currency],
    ["Savings", report.savings.toFixed(2), currency],
    ["Savings rate", (report.savingsRate * 100).toFixed(2), "%"],
    ["Planned monthly investment", report.plannedInvestment.toFixed(2), currency],
    ["Net worth", report.netWorth.toFixed(2), currency],
    ["Portfolio value", report.portfolioValue.toFixed(2), currency],
    ["FIRE progress", (report.fireProgress * 100).toFixed(2), "%"],
    ["Holdings", String(report.holdingCount), "count"],
    [],
    ["Disclaimer", disclaimer]
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function buildFinancialSummaryPdf(report, currency) {
  const summaryLines = [
    "FirePath Monthly FIRE Report",
    report.periodLabel,
    "",
    `Income: ${report.income.toFixed(2)} ${currency}`,
    `Expenses: ${report.expenses.toFixed(2)} ${currency}`,
    `Savings: ${report.savings.toFixed(2)} ${currency}`,
    `Savings rate: ${(report.savingsRate * 100).toFixed(2)}%`,
    `Planned monthly investment: ${report.plannedInvestment.toFixed(2)} ${currency}`,
    `Net worth: ${report.netWorth.toFixed(2)} ${currency}`,
    `Portfolio value: ${report.portfolioValue.toFixed(2)} ${currency}`,
    `FIRE progress: ${(report.fireProgress * 100).toFixed(2)}%`,
    `Holdings tracked: ${report.holdingCount}`,
    "",
    ...wrapText(disclaimer, 86)
  ];

  const content = [
    "BT",
    "/F1 18 Tf",
    "50 790 Td",
    ...summaryLines
      .flatMap((line, index) => [index === 0 ? "" : "0 -22 Td", `(${escapePdfText(line)}) Tj`])
      .filter(Boolean),
    "ET"
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function escapeCsvCell(value) {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapePdfText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(value, maxLength) {
  const words = value.split(" ");
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length > maxLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
