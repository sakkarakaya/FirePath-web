import { formatCurrency, getCurrencySymbol, todayISO } from "../domain/formatters.js";
import { parsePositiveNumber } from "../domain/numberInput.js";
import {
  OPENING_NOTE,
  TRANSACTION_LABELS,
  TRANSACTION_TYPES,
  heldQuantityOn,
  transactionsForHolding,
  validateTransaction
} from "../domain/portfolioLedger.js";
import {
  addPortfolioTransaction,
  getState,
  hasLedger,
  removePortfolioTransaction,
  updatePortfolioTransaction
} from "../store/store.js";
import { Button, Field, SegmentedControl } from "../ui/components.js";
import { h } from "../ui/dom.js";
import { confirmAction, openModal, toast } from "../ui/feedback.js";

/**
 * Transaction editor.
 *
 * Amounts are entered in the holding's own currency, which is the currency on
 * the broker note the reader is copying from. The running summary under the
 * fields shows the cash movement and the resulting position so a typo is
 * visible before saving rather than after.
 */
export function openTransactionModal({ holding, transaction = null, onSaved } = {}) {
  const isEdit = transaction !== null;
  const currency = holding.currency ?? "EUR";
  const stored = transactionsForHolding(getState().portfolioTransactions, holding.id);
  const willSeedOpening = !isEdit && !hasLedger(holding.id) && holding.quantity > 0;

  const draft = {
    openingDate: (holding.createdAt ?? todayISO()).slice(0, 10),
    type: transaction?.type ?? "buy",
    date: transaction?.date ?? todayISO(),
    quantity: transaction ? String(transaction.quantity) : "",
    price: transaction ? String(transaction.price) : "",
    amount: transaction ? String(transaction.amount) : "",
    fee: transaction && transaction.fee ? String(transaction.fee) : "",
    note: transaction?.note ?? ""
  };

  let error = "";
  const body = h("div", { class: "stack" });

  /**
   * The opening lot is not saved yet, but validation and the preview have to
   * behave as if it were — otherwise entering a sale of units the holding
   * plainly owns would be rejected.
   */
  function ledgerSoFar() {
    if (!willSeedOpening) {
      return stored;
    }

    return [
      {
        id: 0,
        holdingId: holding.id,
        type: "buy",
        date: draft.openingDate,
        quantity: holding.quantity,
        price: holding.averageBuyPrice,
        fee: 0,
        note: OPENING_NOTE
      },
      ...stored
    ];
  }

  const modal = openModal({
    title: isEdit ? "Edit transaction" : `Add transaction · ${holding.name}`,
    description: `Amounts in ${currency}. Sales are matched against the oldest units first.`,
    content: body,
    actions: [
      Button({ variant: "ghost", onclick: () => modal.close() }, "Cancel"),
      Button({ variant: "primary", onclick: () => save() }, isEdit ? "Save changes" : "Add transaction")
    ]
  });

  render();

  function render() {
    const isDividend = draft.type === "dividend";
    const quantity = parsePositiveNumber(draft.quantity);
    const price = parsePositiveNumber(draft.price);
    const amount = parsePositiveNumber(draft.amount);
    const fee = parsePositiveNumber(draft.fee);
    const gross = isDividend ? amount : quantity * price;
    const cashFlow = draft.type === "buy" ? -(gross + fee) : gross - fee;
    const heldBefore = heldQuantityOn(
      ledgerSoFar().filter((row) => row.id !== transaction?.id),
      draft.date
    );
    const heldAfter =
      draft.type === "buy" ? heldBefore + quantity : draft.type === "sell" ? heldBefore - quantity : heldBefore;

    body.replaceChildren(...[
      willSeedOpening
        ? h("div", { class: "stack stack--tight" }, [
            h("p", {
              class: "inline-note inline-note--watch",
              text: `This holding was entered by hand. Its current ${formatUnits(
                holding.quantity
              )} units at ${formatCurrency(
                holding.averageBuyPrice,
                currency,
                2
              )} are recorded as an "${OPENING_NOTE}" first, so the ledger and the position agree.`
            }),
            Field({
              label: "Opening position acquired on",
              type: "date",
              value: draft.openingDate,
              hint: "Sales are matched oldest-first, so date this before any history you are about to enter.",
              onInput: (value) => {
                draft.openingDate = value;
                render();
              }
            })
          ])
        : null,

      SegmentedControl({
        options: TRANSACTION_TYPES,
        value: draft.type,
        getLabel: (type) => TRANSACTION_LABELS[type],
        label: "Transaction type",
        onChange: (value) => {
          draft.type = value;
          render();
        }
      }),

      h("div", { class: "field-grid" }, [
        Field({
          label: "Date",
          type: "date",
          value: draft.date,
          onInput: (value) => {
            draft.date = value;
            render();
          }
        }),
        isDividend
          ? Field({
              label: `Amount received (${getCurrencySymbol(currency)})`,
              value: draft.amount,
              inputMode: "decimal",
              hint: "Total payout for this holding, before withholding.",
              onInput: (value) => {
                draft.amount = value;
                render();
              }
            })
          : Field({
              label: "Quantity",
              value: draft.quantity,
              inputMode: "decimal",
              hint:
                draft.type === "sell"
                  ? `${formatUnits(heldBefore)} units held on that date`
                  : undefined,
              onInput: (value) => {
                draft.quantity = value;
                render();
              }
            }),
        isDividend
          ? null
          : Field({
              label: `Price per unit (${getCurrencySymbol(currency)})`,
              value: draft.price,
              inputMode: "decimal",
              onInput: (value) => {
                draft.price = value;
                render();
              }
            }),
        Field({
          label: isDividend ? `Withheld tax and fees (${getCurrencySymbol(currency)})` : `Fees (${getCurrencySymbol(currency)})`,
          value: draft.fee,
          inputMode: "decimal",
          hint: draft.type === "buy" ? "Counted into the cost basis." : undefined,
          onInput: (value) => {
            draft.fee = value;
            render();
          }
        })
      ]),

      Field({
        label: "Note",
        value: draft.note,
        placeholder: "Optional",
        onInput: (value) => {
          draft.note = value;
        }
      }),

      h("div", { class: "ledger-preview" }, [
        PreviewRow({
          label: draft.type === "buy" ? "Cash out" : "Cash in",
          value: formatCurrency(Math.abs(cashFlow), currency, 2),
          tone: cashFlow > 0 ? "up" : null
        }),
        isDividend
          ? null
          : PreviewRow({ label: "Units after", value: formatUnits(Math.max(0, heldAfter)) })
      ]),

      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null
    ].filter(Boolean));
  }

  function save() {
    const input = {
      holdingId: holding.id,
      type: draft.type,
      date: draft.date,
      quantity: parsePositiveNumber(draft.quantity),
      price: parsePositiveNumber(draft.price),
      amount: parsePositiveNumber(draft.amount),
      fee: parsePositiveNumber(draft.fee),
      note: draft.note
    };

    error =
      validateTransaction(input, {
        existing: ledgerSoFar(),
        editingId: transaction?.id ?? null
      }) ?? "";

    if (error) {
      render();
      return;
    }

    try {
      if (isEdit) {
        updatePortfolioTransaction(transaction.id, input);
        toast("Transaction updated.");
      } else {
        const result = addPortfolioTransaction(input, { openingDate: draft.openingDate });
        toast(
          result.openingTransaction
            ? `${TRANSACTION_LABELS[input.type]} added, with an opening position recorded before it.`
            : `${TRANSACTION_LABELS[input.type]} added.`
        );
      }
      modal.close();
      onSaved?.();
    } catch (saveError) {
      error = saveError instanceof Error ? saveError.message : "The transaction could not be saved.";
      render();
    }
  }
}

function PreviewRow({ label, value, tone }) {
  return h("div", { class: "ledger-preview__row" }, [
    h("span", { class: "ledger-preview__label", text: label }),
    h("strong", { class: `ledger-preview__value ${tone ? `value-${tone}` : ""}`.trim(), text: value })
  ]);
}

export async function confirmTransactionDelete(transaction, holdingName) {
  const confirmed = await confirmAction({
    title: "Delete this transaction?",
    description: `The ${TRANSACTION_LABELS[transaction.type].toLowerCase()} on ${
      transaction.date
    } is removed from ${holdingName} and its position is recalculated.`,
    confirmLabel: "Delete transaction"
  });

  if (confirmed) {
    removePortfolioTransaction(transaction.id);
    toast("Transaction deleted.", { level: "info" });
  }
}

function formatUnits(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
    Number.isFinite(value) ? value : 0
  );
}
