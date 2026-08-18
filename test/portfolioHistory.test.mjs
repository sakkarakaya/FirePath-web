import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORY_RANGES,
  buildTransactionSnapshots,
  mergeSnapshotSeries,
  normalizeSnapshots,
  selectHistoryRange,
  selectSeriesRange
} from "../app/domain/portfolioHistory.js";

const snapshots = [
  { date: "2020-01-02", value: 70, invested: 60 },
  { date: "2022-06-01", value: 80, invested: 70 },
  { date: "2025-12-31", value: 90, invested: 80 },
  { date: "2026-01-02", value: 92, invested: 80 },
  { date: "2026-07-18", value: 95, invested: 85 },
  { date: "2026-08-10", value: 97, invested: 85 },
  { date: "2026-08-11", value: 98, invested: 85 },
  { date: "2026-08-17", value: 99, invested: 85 },
  { date: "2026-08-18", value: 100, invested: 85 }
];

test("offers the six requested portfolio history ranges", () => {
  assert.deepEqual(
    HISTORY_RANGES.map((range) => range.key),
    ["1D", "1W", "1M", "YTD", "1Y", "5Y"]
  );
});

test("selects calendar ranges relative to the newest recorded point", () => {
  assert.deepEqual(
    selectHistoryRange(snapshots, "1D").map((point) => point.date),
    ["2026-08-17", "2026-08-18"]
  );
  assert.deepEqual(
    selectHistoryRange(snapshots, "1W").map((point) => point.date),
    ["2026-08-11", "2026-08-17", "2026-08-18"]
  );
  assert.deepEqual(
    selectHistoryRange(snapshots, "1M").map((point) => point.date),
    ["2026-07-18", "2026-08-10", "2026-08-11", "2026-08-17", "2026-08-18"]
  );
  assert.deepEqual(
    selectHistoryRange(snapshots, "YTD").map((point) => point.date),
    ["2026-01-02", "2026-07-18", "2026-08-10", "2026-08-11", "2026-08-17", "2026-08-18"]
  );
  assert.equal(selectHistoryRange(snapshots, "1Y")[0].date, "2025-12-31");
  assert.equal(selectHistoryRange(snapshots, "5Y")[0].date, "2022-06-01");
});

test("selects rebuilt chart points that use label as their date", () => {
  const rebuilt = snapshots.map(({ date, value }) => ({ label: date, value }));
  assert.deepEqual(
    selectSeriesRange(rebuilt, "1W").map((point) => point.label),
    ["2026-08-11", "2026-08-17", "2026-08-18"]
  );
});

test("does not label an old snapshot as a one-day comparison", () => {
  const sparse = [
    { date: "2026-01-01", value: 80, invested: 70 },
    { date: "2026-08-18", value: 100, invested: 90 }
  ];

  assert.deepEqual(
    selectHistoryRange(sparse, "1D").map((point) => point.date),
    ["2026-08-18"]
  );
});

test("retains enough recorded snapshots for a complete five-year chart", () => {
  const rows = Array.from({ length: 2195 }, (_, index) => {
    const date = new Date(2020, 0, 1 + index);
    const localDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    return { date: localDate, value: index, invested: index };
  });

  const normalized = normalizeSnapshots(rows);
  assert.equal(normalized.length, 2192);
  assert.equal(normalized.at(-1).date, rows.at(-1).date);
});

test("builds sparse value history from dated CSV transactions", () => {
  const holdings = [
    { id: 1, exchangeRateToBase: 1 },
    { id: 2, exchangeRateToBase: 2 }
  ];
  const transactions = [
    { holdingId: 1, type: "buy", date: "2024-01-10", quantity: 2, price: 100, fee: 2 },
    { holdingId: 2, type: "buy", date: "2024-02-10", quantity: 1, price: 50, fee: 0 },
    { holdingId: 1, type: "sell", date: "2024-03-10", quantity: 1, price: 120, fee: 1 },
    { holdingId: 2, type: "dividend", date: "2024-04-10", amount: 5, fee: 0 }
  ];

  assert.deepEqual(buildTransactionSnapshots(holdings, transactions), [
    { date: "2024-01-10", value: 200, invested: 202, positions: 1 },
    { date: "2024-02-10", value: 300, invested: 302, positions: 2 },
    { date: "2024-03-10", value: 220, invested: 183, positions: 2 },
    { date: "2024-04-10", value: 220, invested: 173, positions: 2 }
  ]);
});

test("uses dated FX for sparse foreign-currency transaction history", () => {
  const snapshots = buildTransactionSnapshots(
    [{ id: 1, currency: "USD", exchangeRateToBase: 0.5 }],
    [
      { holdingId: 1, type: "buy", date: "2024-01-10", quantity: 1, price: 100, fee: 0 },
      { holdingId: 1, type: "dividend", date: "2024-02-10", amount: 0, fee: 0 }
    ],
    {
      baseCurrency: "EUR",
      seriesByKey: {
        "USD/EUR": {
          bars: [
            { date: "2024-01-10", close: 0.8 },
            { date: "2024-02-10", close: 0.9 }
          ]
        }
      }
    }
  );

  assert.deepEqual(snapshots, [
    { date: "2024-01-10", value: 80, invested: 80, positions: 1 },
    { date: "2024-02-10", value: 90, invested: 80, positions: 1 }
  ]);
});

test("omits foreign sparse history until dated FX is available", () => {
  assert.deepEqual(
    buildTransactionSnapshots(
      [{ id: 1, currency: "USD", exchangeRateToBase: 0.9 }],
      [{ holdingId: 1, type: "buy", date: "2024-01-10", quantity: 1, price: 100, fee: 0 }],
      { baseCurrency: "EUR", seriesByKey: {} }
    ),
    []
  );
});

test("recorded snapshots override transaction estimates for the same date", () => {
  const estimated = [
    { date: "2024-01-10", value: 100, invested: 90, positions: 1 },
    { date: "2024-02-10", value: 110, invested: 90, positions: 1 }
  ];
  const recorded = [
    { date: "2024-02-10", value: 125, invested: 90, positions: 1 },
    { date: "2024-03-10", value: 130, invested: 90, positions: 1 }
  ];

  assert.deepEqual(mergeSnapshotSeries(estimated, recorded), [
    estimated[0],
    recorded[0],
    recorded[1]
  ]);
});
