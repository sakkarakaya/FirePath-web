import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNetWorthCsv,
  parsePortfolioHoldingsCsv,
  parsePortfolioImportCsv
} from "../app/domain/csvImport.js";

test("imports a semicolon-delimited broker ledger with European numbers", () => {
  const csv = [
    "date;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency",
    '2025-10-02;Executed;buy-1;"Example Call";Security;Buy;DE000TEST001;1.000;0,246;-246,00;0,99;0,00;EUR',
    '2025-12-01;Executed;div-1;"Example Call";Cash;Distribution;DE000TEST001;;;10,00;0,00;2,50;EUR',
    '2025-12-02;Cancelled;cancel-1;"Example Call";Security;Sell;DE000TEST001;500;0,30;150,00;0,99;0,00;EUR',
    "2025-12-03;Executed;deposit-1;Broker;Cash;Deposit;;;;100,00;0,00;;EUR"
  ].join("\n");

  const result = parsePortfolioImportCsv(csv);

  assert.equal(result.format, "transactions");
  assert.equal(result.holdings.length, 1);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.skippedRows, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].quantity, 1000);
  assert.equal(result.transactions[0].price, 0.246);
  assert.equal(result.holdings[0].quantity, 1000);
  assert.equal(result.transactions[1].type, "dividend");
  assert.equal(result.transactions[1].amount, 10);
  assert.equal(result.transactions[1].fee, 2.5);
});

test("preserves broker fees and withholding exported as negative amounts", () => {
  const result = parsePortfolioImportCsv(
    "date,type,name,ticker,quantity,price,fee,tax,currency\n2026-01-02,buy,Asset,TEST,2,100,-1.50,-0.50,EUR"
  );

  assert.equal(result.transactions[0].fee, 2);
});

test("does not assume a missing foreign exchange rate is one-to-one", () => {
  const result = parsePortfolioHoldingsCsv(
    "name,quantity,current_price,currency\nUS asset,2,100,USD",
    "EUR"
  );

  assert.equal(result.holdings[0].exchangeRateToBase, 0);
});

test("detects common holding CSV delimiters and preserves quoted separators", () => {
  const cases = [
    'name,quantity,current_price\n"World, Inc",2,100',
    "name\tquantity\tcurrent_price\nWorld ETF\t2\t100",
    "name|quantity|current_price\nWorld ETF|2|100",
    "sep=;\nname;quantity;current_price\nWorld ETF;2;100"
  ];

  cases.forEach((csv) => {
    const result = parsePortfolioHoldingsCsv(csv);
    assert.equal(result.holdings.length, 1);
    assert.deepEqual(result.errors, []);
  });
  assert.equal(parsePortfolioHoldingsCsv(cases[0]).holdings[0].name, "World, Inc");
});

test("supports US decimals in semicolon files and European grouping when detected", () => {
  const us = parsePortfolioHoldingsCsv("name;quantity;current_price\nAsset;1.5;100.25");
  const european = parsePortfolioHoldingsCsv("name;quantity;current_price\nAsset;1.000;1.389,40");

  assert.equal(us.holdings[0].quantity, 1.5);
  assert.equal(us.holdings[0].currentPrice, 100.25);
  assert.equal(european.holdings[0].quantity, 1000);
  assert.equal(european.holdings[0].currentPrice, 1389.4);
});

test("imports semicolon-delimited net worth snapshots", () => {
  const result = parseNetWorthCsv(
    "current_cash;current_investments;monthly_expenses\n1.234,56;7.890,12;2.000,00"
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.snapshot, {
    currentCash: 1234.56,
    currentInvestments: 7890.12,
    monthlyExpenses: 2000
  });
});
