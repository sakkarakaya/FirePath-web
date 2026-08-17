import { appVersion, disclaimer, privacyPolicyUrl, supportUrl, termsOfUseUrl } from "../data/copy.js";
import {
  countryOptions,
  currencyOptions,
  drawdownResponseOptions,
  investingExperienceOptions,
  learningTopicOptions
} from "../data/defaults.js";
import { findPlanGaps } from "../domain/dashboard.js";
import { checkMarketDataConnection } from "../domain/marketData.js";
import {
  NET_WORTH_CSV_HELP,
  NET_WORTH_CSV_SAMPLE,
  PORTFOLIO_CSV_HELP,
  PORTFOLIO_CSV_SAMPLE,
  parseNetWorthCsv,
  parsePortfolioHoldingsCsv
} from "../domain/csvImport.js";
import { getMonthRange, isIsoDate } from "../domain/dateRange.js";
import { percentToRate } from "../domain/fireCalculations.js";
import { formatCurrency, formatPercent, getCurrencySymbol, todayISO } from "../domain/formatters.js";
import { calculateTransactionTotals } from "../domain/moneyCalculations.js";
import {
  formatNumberForInput,
  formatRateForInput,
  parsePositiveNumber,
  parseSignedNumber,
  parseWholeNumber
} from "../domain/numberInput.js";
import { calculateHoldingValueInBaseCurrency } from "../domain/portfolioCalculations.js";
import { profileToInput } from "../domain/profileValidation.js";
import {
  buildFinancialSummaryCsv,
  buildFinancialSummaryPdf,
  buildMonthlyReport
} from "../domain/reporting.js";
import {
  buildSettingsSections,
  buildSettingsStatusLine,
  describeExperience,
  formatMemberSince
} from "../domain/settings.js";
import {
  addHoldings,
  getState,
  patchProfile,
  replaceTransactions,
  resetOnboarding,
  resetUserData,
  selectFireMetrics,
  storageIsPersistent
} from "../store/store.js";
import {
  getMarketDataSettings,
  marketDataIsConfigured,
  saveMarketDataSettings
} from "../store/marketData.js";
import {
  Button,
  Card,
  ChipToggleGroup,
  EmptyState,
  Field,
  MetricCard,
  SectionHeader,
  SegmentedControl,
  SelectField,
  StatusChip,
  SwitchRow
} from "../ui/components.js";
import { h } from "../ui/dom.js";
import { confirmAction, downloadFile, toast } from "../ui/feedback.js";
import { href, navigate } from "../router.js";
import { resetOnboardingFlow } from "./onboarding.js";

/**
 * Settings.
 *
 * On mobile these are pushed screens; on the web they are sub-routes so each
 * one is linkable and the browser Back button behaves as expected. Sub-pages
 * edit a copy of the profile and only write on save.
 */

const MONTHLY_UPDATE_NOTE_PREFIX = "Monthly update:";

function requestRerender() {
  window.dispatchEvent(new CustomEvent("firepath:rerender"));
}

function NoProfile(context) {
  return h("div", { class: "view" }, [
    Card({}, [
      EmptyState({
        icon: "◈",
        title: "No plan yet",
        description: `Complete the short setup before opening ${context}.`,
        action: Button({ to: "/onboarding", variant: "primary" }, "Start planning")
      })
    ])
  ]);
}

function SettingsPage({ title, eyebrow, description, children, actions }) {
  return h("div", { class: "view" }, [
    h("div", { class: "row" }, [Button({ to: "/settings", variant: "ghost", size: "sm" }, "← Settings")]),
    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: eyebrow }),
        h("h1", { class: "page-header__title", text: title }),
        description && h("p", { class: "page-header__description", text: description })
      ]),
      actions && h("div", { class: "page-header__actions" }, actions)
    ]),
    ...(Array.isArray(children) ? children : [children])
  ]);
}

/* -------------------------------------------------------------------------- */
/* Settings index                                                             */
/* -------------------------------------------------------------------------- */

export function SettingsView() {
  const { profile } = getState();

  if (!profile) {
    return NoProfile("settings");
  }

  const gaps = findPlanGaps(profile);
  const sections = buildSettingsSections({ profile, gaps, marketDataConfigured: marketDataIsConfigured() });
  const memberSince = formatMemberSince(profile.createdAt);

  return h("div", { class: "view" }, [
    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: "Settings" }),
        h("h1", { class: "page-header__title", text: "Your plan and data" }),
        h("p", { class: "page-header__description", text: buildSettingsStatusLine(gaps.length) })
      ])
    ]),

    Card({}, [
      h("div", { class: "row row--between" }, [
        h("div", { class: "stack stack--tight" }, [
          h("h2", { class: "section-header__title", text: `${profile.age} years old · ${profile.country}` }),
          h("p", {
            class: "muted",
            text: `${describeExperience(profile.investingExperience)} investor · ${
              profile.learningTopics.length
            } learning topics`
          }),
          memberSince && h("p", { class: "muted", text: memberSince })
        ]),
        StatusChip({ label: getCurrencySymbol(profile.currency), level: "neutral" })
      ]),
      !storageIsPersistent()
        ? h("p", {
            class: "inline-note inline-note--risk",
            text: "This browser is blocking local storage, so changes will be lost when you close the tab."
          })
        : null
    ]),

    ...sections.map((section) =>
      Card({ class: "card--flush" }, [
        h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [SectionHeader({ title: section.title })]),
        h(
          "div",
          { class: "list" },
          section.entries.map((entry) => SettingsRow({ entry }))
        )
      ])
    ),

    h("p", { class: "disclaimer", text: disclaimer }),
    h("p", { class: "muted", text: `FirePath for web · Version ${appVersion}` })
  ]);
}

function SettingsRow({ entry }) {
  const children = [
    h("span", { class: "list__row-copy" }, [
      h("span", { class: "list__row-title", text: entry.title }),
      h("span", { class: "list__row-detail", text: entry.detail })
    ]),
    entry.badge ? StatusChip({ ...entry.badge, size: "sm" }) : null,
    entry.value ? h("span", { class: "list__row-value", text: entry.value }) : null,
    h("span", { class: "list__row-chevron", "aria-hidden": "true", text: entry.external ? "↗" : "›" })
  ];

  if (entry.external) {
    return h(
      "a",
      {
        class: "list__row",
        href: entry.href ?? privacyPolicyUrl,
        target: "_blank",
        rel: "noopener noreferrer"
      },
      children
    );
  }

  return h("a", { class: "list__row", href: href(entry.route) }, children);
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export function ProfileSettingsView() {
  const { profile } = getState();

  if (!profile) {
    return NoProfile("your profile");
  }

  const draft = {
    age: String(profile.age),
    country: profile.country,
    currency: profile.currency
  };
  let error = "";

  const form = h("div", { class: "stack" });

  const render = () => {
    const isKnownCountry = countryOptions.includes(draft.country);

    form.replaceChildren(
      Field({
        label: "Age",
        value: draft.age,
        type: "number",
        min: "16",
        max: "100",
        onInput: (value) => {
          draft.age = value;
        }
      }),
      SelectField({
        label: "Country",
        value: isKnownCountry ? draft.country : "Other",
        options: countryOptions,
        onChange: (value) => {
          draft.country = value === "Other" ? "" : value;
          render();
        }
      }),
      isKnownCountry
        ? null
        : Field({
            label: "Your country",
            value: draft.country,
            onInput: (value) => {
              draft.country = value;
            }
          }),
      SegmentedControl({
        options: currencyOptions,
        value: draft.currency,
        label: "Base currency",
        getLabel: (code) => `${code} ${getCurrencySymbol(code)}`,
        onChange: (value) => {
          draft.currency = value;
          render();
        }
      }),
      h("p", {
        class: "muted",
        text: "Changing the base currency re-labels your saved amounts. It does not convert them."
      }),
      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null,
      Button(
        {
          variant: "primary",
          onclick: () => {
            const age = parseWholeNumber(draft.age);

            if (age < 16 || age > 100) {
              error = "Age must be between 16 and 100.";
              render();
              return;
            }

            if (!draft.country.trim()) {
              error = "Country is required.";
              render();
              return;
            }

            try {
              patchProfile({
                age,
                country: draft.country.trim(),
                currency: draft.currency.trim().toUpperCase()
              });
              toast("Profile updated.");
              navigate("/settings");
            } catch (saveError) {
              error = saveError instanceof Error ? saveError.message : "Could not save.";
              render();
            }
          }
        },
        "Save profile"
      )
    );
  };

  render();

  return SettingsPage({
    eyebrow: "Your plan",
    title: "Profile",
    description: "Who the plan is for and which currency it is measured in.",
    children: Card({}, [form])
  });
}

/* -------------------------------------------------------------------------- */
/* Financial status                                                           */
/* -------------------------------------------------------------------------- */

export function FinancialStatusSettingsView() {
  const { profile } = getState();

  if (!profile) {
    return NoProfile("your financial status");
  }

  const currency = profile.currency;
  const draft = {
    currentCash: formatNumberForInput(profile.currentCash),
    currentInvestments: formatNumberForInput(profile.currentInvestments),
    debts: formatNumberForInput(profile.debts),
    emergencyFund: formatNumberForInput(profile.emergencyFund)
  };
  let error = "";

  const form = h("div", { class: "stack" });

  const render = () => {
    const money = (key, label, hint) =>
      Field({
        label,
        value: draft[key],
        inputMode: "decimal",
        prefix: getCurrencySymbol(currency),
        hint,
        onInput: (value) => {
          draft[key] = value;
        }
      });

    form.replaceChildren(
      money("currentCash", "Current cash", "Current and savings accounts."),
      money(
        "currentInvestments",
        "Current investments",
        "Your total invested value. FIRE progress counts the larger of this and your tracked holdings."
      ),
      money("debts", "Debts", "Subtracted from net worth."),
      money("emergencyFund", "Emergency fund", "Drives the months-of-cover figure on the dashboard."),
      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null,
      Button(
        {
          variant: "primary",
          onclick: () => {
            try {
              patchProfile({
                currentCash: parsePositiveNumber(draft.currentCash),
                currentInvestments: parsePositiveNumber(draft.currentInvestments),
                debts: parsePositiveNumber(draft.debts),
                emergencyFund: parsePositiveNumber(draft.emergencyFund)
              });
              toast("Financial status updated.");
              navigate("/settings");
            } catch (saveError) {
              error = saveError instanceof Error ? saveError.message : "Could not save.";
              render();
            }
          }
        },
        "Save financial status"
      )
    );
  };

  render();

  return SettingsPage({
    eyebrow: "Your plan",
    title: "Financial status",
    description: "What you own and owe right now.",
    children: Card({}, [form])
  });
}

/* -------------------------------------------------------------------------- */
/* FIRE assumptions                                                           */
/* -------------------------------------------------------------------------- */

export function FireAssumptionsSettingsView() {
  const { profile } = getState();

  if (!profile) {
    return NoProfile("your FIRE assumptions");
  }

  const currency = profile.currency;
  const draft = {
    monthlyIncome: formatNumberForInput(profile.monthlyIncome),
    monthlyExpenses: formatNumberForInput(profile.monthlyExpenses),
    monthlyInvestment: formatNumberForInput(profile.monthlyInvestment),
    desiredMonthlyFireSpending: formatNumberForInput(profile.desiredMonthlyFireSpending),
    targetFireAge: String(profile.targetFireAge),
    withdrawalRate: formatRateForInput(profile.withdrawalRate),
    expectedReturn: formatRateForInput(profile.expectedReturn),
    expectedInflation: formatRateForInput(profile.expectedInflation)
  };
  let error = "";

  const form = h("div", { class: "stack" });

  const render = () => {
    form.replaceChildren(
      h("div", { class: "field-grid" }, [
        Field({
          label: "Monthly net income",
          value: draft.monthlyIncome,
          inputMode: "decimal",
          prefix: getCurrencySymbol(currency),
          onInput: (value) => {
            draft.monthlyIncome = value;
          }
        }),
        Field({
          label: "Monthly expenses",
          value: draft.monthlyExpenses,
          inputMode: "decimal",
          prefix: getCurrencySymbol(currency),
          onInput: (value) => {
            draft.monthlyExpenses = value;
          }
        }),
        Field({
          label: "Monthly investment",
          value: draft.monthlyInvestment,
          inputMode: "decimal",
          prefix: getCurrencySymbol(currency),
          onInput: (value) => {
            draft.monthlyInvestment = value;
          }
        }),
        Field({
          label: "Desired monthly FIRE spending",
          value: draft.desiredMonthlyFireSpending,
          inputMode: "decimal",
          prefix: getCurrencySymbol(currency),
          onInput: (value) => {
            draft.desiredMonthlyFireSpending = value;
          }
        }),
        Field({
          label: "Target FIRE age",
          value: draft.targetFireAge,
          type: "number",
          min: "16",
          max: "100",
          onInput: (value) => {
            draft.targetFireAge = value;
          }
        }),
        Field({
          label: "Withdrawal rate (%)",
          value: draft.withdrawalRate,
          inputMode: "decimal",
          suffix: "%",
          hint: "A lower rate means a larger target.",
          onInput: (value) => {
            draft.withdrawalRate = value;
          }
        }),
        Field({
          label: "Expected annual return (%)",
          value: draft.expectedReturn,
          inputMode: "decimal",
          suffix: "%",
          onInput: (value) => {
            draft.expectedReturn = value;
          }
        }),
        Field({
          label: "Expected inflation (%)",
          value: draft.expectedInflation,
          inputMode: "decimal",
          suffix: "%",
          onInput: (value) => {
            draft.expectedInflation = value;
          }
        })
      ]),
      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null,
      Button(
        {
          variant: "primary",
          onclick: () => {
            const targetFireAge = parseWholeNumber(draft.targetFireAge);

            if (targetFireAge <= profile.age || targetFireAge > 100) {
              error = "Target FIRE age must be above your current age and at most 100.";
              render();
              return;
            }

            try {
              patchProfile({
                monthlyIncome: parsePositiveNumber(draft.monthlyIncome),
                monthlyExpenses: parsePositiveNumber(draft.monthlyExpenses),
                monthlyInvestment: parsePositiveNumber(draft.monthlyInvestment),
                desiredMonthlyFireSpending: parsePositiveNumber(draft.desiredMonthlyFireSpending),
                targetFireAge,
                withdrawalRate: percentToRate(parsePositiveNumber(draft.withdrawalRate)),
                expectedReturn: percentToRate(parseSignedNumber(draft.expectedReturn)),
                expectedInflation: percentToRate(parseSignedNumber(draft.expectedInflation))
              });
              toast("FIRE assumptions updated.");
              navigate("/settings");
            } catch (saveError) {
              error = saveError instanceof Error ? saveError.message : "Could not save.";
              render();
            }
          }
        },
        "Save assumptions"
      )
    );
  };

  render();

  return SettingsPage({
    eyebrow: "Your plan",
    title: "FIRE assumptions",
    description: "The inputs every projection in FirePath is built from.",
    children: Card({}, [form])
  });
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

export function PreferencesSettingsView() {
  const { profile } = getState();

  if (!profile) {
    return NoProfile("your preferences");
  }

  const draft = {
    investingExperience: profile.investingExperience,
    drawdownResponse: profile.drawdownResponse,
    learningTopics: [...profile.learningTopics],
    weeklySummaryEnabled: profile.weeklySummaryEnabled,
    monthlyReportEnabled: profile.monthlyReportEnabled,
    progressAlertEnabled: profile.progressAlertEnabled
  };

  const form = h("div", { class: "stack" });

  const render = () => {
    form.replaceChildren(
      SegmentedControl({
        options: investingExperienceOptions,
        value: draft.investingExperience,
        label: "Investing experience",
        getLabel: (value) => describeExperience(value),
        onChange: (value) => {
          draft.investingExperience = value;
          render();
        }
      }),
      SegmentedControl({
        options: drawdownResponseOptions,
        value: draft.drawdownResponse,
        label: "If your portfolio drops 30%",
        onChange: (value) => {
          draft.drawdownResponse = value;
          render();
        }
      }),
      ChipToggleGroup({
        label: "Learning topics",
        options: learningTopicOptions,
        values: draft.learningTopics,
        onToggle: (topic) => {
          draft.learningTopics = draft.learningTopics.includes(topic)
            ? draft.learningTopics.filter((item) => item !== topic)
            : [...draft.learningTopics, topic];
          render();
        }
      }),
      h("div", { class: "stack stack--tight" }, [
        h("span", { class: "field__label", text: "Review preferences" }),
        SwitchRow({
          label: "Weekly summary",
          description: "Prepare a weekly progress check-in.",
          checked: draft.weeklySummaryEnabled,
          onChange: (value) => {
            draft.weeklySummaryEnabled = value;
            render();
          }
        }),
        SwitchRow({
          label: "Monthly report",
          description: "Prepare the monthly FIRE report.",
          checked: draft.monthlyReportEnabled,
          onChange: (value) => {
            draft.monthlyReportEnabled = value;
            render();
          }
        }),
        SwitchRow({
          label: "Progress alerts",
          description: "Flag milestones as they are reached.",
          checked: draft.progressAlertEnabled,
          onChange: (value) => {
            draft.progressAlertEnabled = value;
            render();
          }
        })
      ]),
      Button(
        {
          variant: "primary",
          onclick: () => {
            patchProfile({ ...draft });
            toast("Preferences updated.");
            navigate("/settings");
          }
        },
        "Save preferences"
      )
    );
  };

  render();

  return SettingsPage({
    eyebrow: "Your plan",
    title: "Risk and learning",
    description: "How the Learn tab is ordered and which check-ins FirePath prepares.",
    children: Card({}, [form])
  });
}

/* -------------------------------------------------------------------------- */
/* Monthly update                                                             */
/* -------------------------------------------------------------------------- */

export function MonthlyUpdateSettingsView() {
  const { profile, transactions } = getState();

  if (!profile) {
    return NoProfile("the monthly update");
  }

  const currency = profile.currency;
  const monthRange = getMonthRange(new Date());
  const monthlyTransactions = transactions.filter(
    (transaction) => transaction.date >= monthRange.startDate && transaction.date <= monthRange.endDate
  );
  const ownTransactions = monthlyTransactions.filter((transaction) =>
    transaction.note.startsWith(MONTHLY_UPDATE_NOTE_PREFIX)
  );
  const totals = calculateTransactionTotals(monthlyTransactions);

  const sumOf = (predicate) =>
    ownTransactions.filter(predicate).reduce((sum, transaction) => sum + transaction.amount, 0);

  const savedIncome = sumOf((entry) => entry.type === "income" && entry.category !== "Dividend");
  const savedExpenses = sumOf((entry) => entry.type === "expense");
  const savedPassive = sumOf((entry) => entry.type === "income" && entry.category === "Dividend");

  const draft = {
    income: savedIncome > 0 ? String(savedIncome) : "",
    expenses: savedExpenses > 0 ? String(savedExpenses) : "",
    passiveIncome: savedPassive > 0 ? String(savedPassive) : "",
    date: todayISO()
  };
  let error = "";

  const form = h("div", { class: "stack" });

  const render = () => {
    form.replaceChildren(
      Field({
        label: "Income excluding passive income",
        value: draft.income,
        inputMode: "decimal",
        prefix: getCurrencySymbol(currency),
        onInput: (value) => {
          draft.income = value;
        }
      }),
      Field({
        label: "Total expenses this month",
        value: draft.expenses,
        inputMode: "decimal",
        prefix: getCurrencySymbol(currency),
        onInput: (value) => {
          draft.expenses = value;
        }
      }),
      Field({
        label: "Passive income this month",
        value: draft.passiveIncome,
        inputMode: "decimal",
        prefix: getCurrencySymbol(currency),
        hint: "Dividends and interest, used for passive income coverage.",
        onInput: (value) => {
          draft.passiveIncome = value;
        }
      }),
      Field({
        label: "Update date",
        value: draft.date,
        type: "date",
        onInput: (value) => {
          draft.date = value;
        }
      }),
      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null,
      h("div", { class: "row" }, [
        Button({ variant: "primary", onclick: () => save() }, "Save monthly update"),
        ownTransactions.length > 0
          ? Button({ variant: "ghost", onclick: () => clearUpdate() }, "Clear this monthly update")
          : null
      ])
    );
  };

  function save() {
    const income = parsePositiveNumber(draft.income);
    const expenses = parsePositiveNumber(draft.expenses);
    const passiveIncome = parsePositiveNumber(draft.passiveIncome);

    if (!isIsoDate(draft.date)) {
      error = "Use a date in YYYY-MM-DD format.";
      render();
      return;
    }

    if (income === 0 && expenses === 0 && passiveIncome === 0) {
      error = "Enter at least one monthly total.";
      render();
      return;
    }

    const replacements = [];

    if (income > 0) {
      replacements.push({
        type: "income",
        amount: income,
        category: "Other",
        date: draft.date,
        note: `${MONTHLY_UPDATE_NOTE_PREFIX} income`
      });
    }
    if (expenses > 0) {
      replacements.push({
        type: "expense",
        amount: expenses,
        category: "Other",
        date: draft.date,
        note: `${MONTHLY_UPDATE_NOTE_PREFIX} expenses`
      });
    }
    if (passiveIncome > 0) {
      replacements.push({
        type: "income",
        amount: passiveIncome,
        category: "Dividend",
        date: draft.date,
        note: `${MONTHLY_UPDATE_NOTE_PREFIX} passive income`
      });
    }

    try {
      replaceTransactions(
        monthRange.startDate,
        monthRange.endDate,
        MONTHLY_UPDATE_NOTE_PREFIX,
        replacements
      );
      toast("Monthly update saved. Your dashboard now uses these totals.");
      navigate("/dashboard");
    } catch {
      error = "The monthly update could not be saved. Existing data was kept.";
      render();
    }
  }

  function clearUpdate() {
    try {
      replaceTransactions(monthRange.startDate, monthRange.endDate, MONTHLY_UPDATE_NOTE_PREFIX, []);
      toast("Monthly update cleared.", { level: "info" });
      requestRerender();
    } catch {
      error = "The monthly update could not be cleared. Existing data was kept.";
      render();
    }
  }

  render();

  return SettingsPage({
    eyebrow: "Your data",
    title: "Monthly update",
    description: `One broad progress update for ${monthRange.periodLabel}. Keep passive income separate so dividends are not counted twice.`,
    children: [
      h("div", { class: "grid grid--4" }, [
        MetricCard({ label: "Income", value: formatCurrency(totals.totalIncome, currency) }),
        MetricCard({ label: "Expenses", value: formatCurrency(totals.totalExpenses, currency) }),
        MetricCard({ label: "Savings", value: formatCurrency(totals.savingsAmount, currency) }),
        MetricCard({ label: "Savings rate", value: formatPercent(totals.savingsRate) })
      ]),
      Card({}, [SectionHeader({ title: "Update monthly totals" }), form])
    ]
  });
}

/* -------------------------------------------------------------------------- */
/* CSV import                                                                 */
/* -------------------------------------------------------------------------- */

export function ImportSettingsView() {
  const { profile } = getState();
  const currency = profile?.currency ?? "EUR";

  let mode = "portfolio";
  let csv = "";

  const container = h("div", { class: "stack" });

  const render = () => {
    const portfolioPreview =
      mode === "portfolio" && csv.trim() ? parsePortfolioHoldingsCsv(csv, currency) : null;
    const netWorthPreview = mode === "netWorth" && csv.trim() ? parseNetWorthCsv(csv) : null;

    container.replaceChildren(
      Card({}, [
        SectionHeader({
          title: "Import type",
          description:
            "CSV import covers occasional portfolio or net worth updates. FirePath never connects to a broker or bank."
        }),
        SegmentedControl({
          options: ["portfolio", "netWorth"],
          value: mode,
          label: "What are you importing",
          getLabel: (value) => (value === "portfolio" ? "Portfolio holdings" : "Net worth snapshot"),
          onChange: (value) => {
            mode = value;
            csv = "";
            render();
          }
        })
      ]),
      Card({}, [
        SectionHeader({
          title: "CSV content",
          description: mode === "portfolio" ? PORTFOLIO_CSV_HELP : NET_WORTH_CSV_HELP,
          action: Button(
            {
              variant: "secondary",
              size: "sm",
              onclick: () => {
                csv = mode === "portfolio" ? PORTFOLIO_CSV_SAMPLE : NET_WORTH_CSV_SAMPLE;
                render();
              }
            },
            "Use sample"
          )
        }),
        Field({
          label: "Paste CSV",
          value: csv,
          multiline: true,
          rows: 10,
          onInput: (value) => {
            csv = value;
          },
          onChange: () => render()
        }),
        Button({ variant: "primary", onclick: () => runImport() }, "Import CSV")
      ]),
      portfolioPreview ? PortfolioPreview(portfolioPreview, currency) : null,
      netWorthPreview ? NetWorthPreview(netWorthPreview, currency) : null
    );
  };

  function runImport() {
    if (!csv.trim()) {
      toast("Paste CSV content before importing.", { level: "error" });
      return;
    }

    try {
      if (mode === "portfolio") {
        const result = parsePortfolioHoldingsCsv(csv, currency);

        if (result.holdings.length === 0) {
          toast(result.errors[0] ?? "No valid holdings were found.", { level: "error" });
          return;
        }

        addHoldings(result.holdings);
        toast(`${result.holdings.length} holdings imported.`);
        navigate("/portfolio");
        return;
      }

      if (!profile) {
        toast("Complete onboarding before importing a net worth snapshot.", { level: "error" });
        return;
      }

      const result = parseNetWorthCsv(csv);

      if (Object.keys(result.snapshot).length === 0) {
        toast(result.errors[0] ?? "No supported net worth fields were found.", { level: "error" });
        return;
      }

      patchProfile({ ...profileToInput(profile), ...result.snapshot });
      toast("Net worth snapshot imported.");
      navigate("/dashboard");
    } catch (importError) {
      toast(
        importError instanceof Error
          ? importError.message
          : "The CSV could not be imported. Existing data was kept.",
        { level: "error" }
      );
    }
  }

  render();

  return SettingsPage({
    eyebrow: "Your data",
    title: "CSV import",
    description: "Paste an export from a spreadsheet. Nothing leaves this browser.",
    children: container
  });
}

function PortfolioPreview(result, currency) {
  const totalValue = result.holdings.reduce(
    (sum, holding) => sum + calculateHoldingValueInBaseCurrency(holding),
    0
  );

  return Card({}, [
    SectionHeader({ title: "Preview" }),
    h("div", { class: "grid grid--3" }, [
      MetricCard({ label: "Valid holdings", value: String(result.holdings.length) }),
      MetricCard({ label: "Imported value", value: formatCurrency(totalValue, currency) }),
      MetricCard({ label: "Rows to review", value: String(result.errors.length) })
    ]),
    ImportErrors(result.errors)
  ]);
}

function NetWorthPreview(result, currency) {
  const fields = Object.entries(result.snapshot);

  return Card({}, [
    SectionHeader({ title: "Preview" }),
    fields.length === 0
      ? h("p", { class: "muted", text: "No supported fields found yet." })
      : h(
          "div",
          { class: "stack stack--tight" },
          fields.map(([key, value]) =>
            h("div", { class: "row row--between" }, [
              h("span", { class: "muted", text: formatFieldName(key) }),
              h("strong", { text: formatCurrency(Number(value), currency) })
            ])
          )
        ),
    ImportErrors(result.errors)
  ]);
}

function ImportErrors(errors) {
  if (errors.length === 0) {
    return null;
  }

  return h("div", { class: "stack stack--tight" }, [
    ...errors.slice(0, 5).map((error) => h("p", { class: "inline-error", text: error })),
    errors.length > 5
      ? h("p", { class: "inline-error", text: `Plus ${errors.length - 5} more rows.` })
      : null
  ]);
}

function formatFieldName(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* Market data                                                                */
/* -------------------------------------------------------------------------- */

export function MarketDataSettingsView() {
  const { profile } = getState();
  if (!profile) {
    return NoProfile("market data settings");
  }

  const saved = getMarketDataSettings();
  const draft = { apiBaseUrl: saved.apiBaseUrl };
  let error = "";
  let connectionStatus = saved.apiBaseUrl ? "saved" : "disconnected";
  let testing = false;

  const form = h("div", { class: "stack" });

  const render = () => {
    form.replaceChildren(...[
      Field({
        label: "Market data service URL",
        value: draft.apiBaseUrl,
        type: "url",
        placeholder: "https://firepath-market-data.your-account.workers.dev",
        hint: "Use your Worker URL. Never paste a Twelve Data API key here.",
        onInput: (value) => {
          draft.apiBaseUrl = value;
        }
      }),
      h("div", { class: "row" }, [
        Button(
          {
            variant: "primary",
            onclick: () => {
              try {
                saveMarketDataSettings(draft);
                connectionStatus = draft.apiBaseUrl.trim() ? "saved" : "disconnected";
                error = "";
                toast(draft.apiBaseUrl.trim() ? "Market data URL saved." : "Market data disconnected.", {
                  level: draft.apiBaseUrl.trim() ? "success" : "info"
                });
                render();
              } catch (saveError) {
                error = saveError instanceof Error ? saveError.message : "The URL could not be saved.";
                render();
              }
            }
          },
          saved.apiBaseUrl && !draft.apiBaseUrl.trim() ? "Disconnect" : "Save connection"
        ),
        draft.apiBaseUrl.trim()
          ? Button(
              {
                variant: "secondary",
                loading: testing,
                onclick: async () => {
                  testing = true;
                  error = "";
                  render();
                  try {
                    saveMarketDataSettings(draft);
                    await checkMarketDataConnection();
                    connectionStatus = "connected";
                    toast("Market data connection works.");
                  } catch (testError) {
                    connectionStatus = "error";
                    error = testError instanceof Error ? testError.message : "Connection test failed.";
                  } finally {
                    testing = false;
                    render();
                  }
                }
              },
              "Test connection"
            )
          : null,
        StatusChip({
          label:
            connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "error"
                ? "Needs attention"
                : connectionStatus === "saved"
                  ? "URL saved"
                  : "Not connected",
          level: connectionStatus === "connected" ? "good" : connectionStatus === "error" ? "risk" : "neutral"
        })
      ]),
      error ? h("p", { class: "inline-error", role: "alert", text: error }) : null
    ].filter(Boolean));
  };

  render();

  return SettingsPage({
    eyebrow: "Portfolio",
    title: "Market data",
    description: "Connect real instrument search and the latest available ETF and stock prices.",
    children: [
      Card({}, [
        SectionHeader({
          eyebrow: "Connection",
          title: "FirePath market data proxy",
          description: "The proxy keeps the provider API key out of browser code and your public repository."
        }),
        form
      ]),
      Card({}, [
        SectionHeader({
          eyebrow: "Free setup",
          title: "Twelve Data + Cloudflare Worker",
          description: "Designed as a private prototype; provider quotas, licensing and market coverage apply."
        }),
        h("ol", { class: "prose-list" }, [
          h("li", { text: "Create a free Twelve Data account and API key." }),
          h("li", { text: "Deploy the Worker in this repository and store the key as its encrypted secret." }),
          h("li", { text: "Add your FirePath site to ALLOWED_ORIGINS, then paste the Worker URL above." })
        ]),
        h("p", { class: "inline-note inline-note--watch", text: "Free data is not universal. Twelve Data Basic currently covers real-time US equities and ETFs, forex and crypto, but is for private personal use and lists non-display usage. A public product must confirm display/redistribution rights or use an appropriate commercial plan. Many European listings also require a paid plan or may only be available as trial/end-of-day data." }),
        h("div", { class: "row" }, [
          h("a", {
            class: "button button--secondary",
            href: "https://twelvedata.com/pricing",
            target: "_blank",
            rel: "noopener noreferrer",
            text: "View provider limits ↗"
          }),
          h("a", {
            class: "button button--ghost",
            href: "https://developers.cloudflare.com/workers/configuration/secrets/",
            target: "_blank",
            rel: "noopener noreferrer",
            text: "Worker secret guide ↗"
          })
        ])
      ]),
      Card({}, [
        SectionHeader({ eyebrow: "Privacy", title: "What leaves this browser" }),
        h("p", {
          class: "muted",
          text: "Only instrument search text, ticker/exchange identifiers and requested currency pairs are sent to the configured market data service. Quantities, purchase prices, portfolio totals and profile data remain in local storage."
        })
      ])
    ]
  });
}

/* -------------------------------------------------------------------------- */
/* Export and reset                                                           */
/* -------------------------------------------------------------------------- */

export function DataSettingsView() {
  const { profile, transactions, holdings } = getState();
  const metrics = selectFireMetrics();
  const currency = profile?.currency ?? "EUR";

  const report = buildMonthlyReport({ profile, transactions, holdings, metrics });
  const fileStem = `firepath-summary-${report.startDate.slice(0, 7)}`;

  return SettingsPage({
    eyebrow: "Your data",
    title: "Export and reset",
    description: "Everything FirePath knows lives in this browser. Take it with you or erase it.",
    children: [
      Card({}, [
        SectionHeader({
          eyebrow: "Monthly report",
          title: report.periodLabel,
          description: "Calculated from your saved profile, logged entries and tracked holdings."
        }),
        h("div", { class: "grid grid--3" }, [
          MetricCard({ label: "Income", value: formatCurrency(report.income, currency) }),
          MetricCard({ label: "Expenses", value: formatCurrency(report.expenses, currency) }),
          MetricCard({
            label: "Planned investment",
            value: formatCurrency(report.plannedInvestment, currency)
          }),
          MetricCard({ label: "Net worth", value: formatCurrency(report.netWorth, currency) }),
          MetricCard({ label: "Portfolio value", value: formatCurrency(report.portfolioValue, currency) }),
          MetricCard({ label: "FIRE progress", value: formatPercent(report.fireProgress) })
        ])
      ]),

      Card({}, [
        SectionHeader({
          eyebrow: "Export",
          title: "Download your summary",
          description: "The same educational summary in either format."
        }),
        h("div", { class: "row" }, [
          Button(
            {
              variant: "primary",
              onclick: () => {
                downloadFile(
                  `${fileStem}.csv`,
                  buildFinancialSummaryCsv(report, currency),
                  "text/csv;charset=utf-8"
                );
                toast("CSV summary downloaded.");
              }
            },
            "Export CSV summary"
          ),
          Button(
            {
              variant: "secondary",
              onclick: () => {
                downloadFile(
                  `${fileStem}.pdf`,
                  buildFinancialSummaryPdf(report, currency),
                  "application/pdf"
                );
                toast("PDF summary downloaded.");
              }
            },
            "Export PDF summary"
          )
        ])
      ]),

      Card({}, [
        SectionHeader({
          eyebrow: "Import",
          title: "Bring data in",
          description: "Paste holdings or a net worth snapshot from a spreadsheet."
        }),
        Button({ to: "/settings/import", variant: "secondary" }, "Open CSV import")
      ]),

      Card({}, [
        SectionHeader({
          eyebrow: "Reset",
          title: "Start over",
          description: "Resetting onboarding keeps your entries. Erasing removes everything."
        }),
        h("div", { class: "row" }, [
          Button(
            {
              variant: "ghost",
              onclick: async () => {
                const confirmed = await confirmAction({
                  title: "Reset onboarding?",
                  description:
                    "This clears your saved profile so the setup flow opens again. Holdings and logged entries stay.",
                  confirmLabel: "Reset onboarding",
                  destructive: false
                });

                if (confirmed) {
                  resetOnboarding();
                  resetOnboardingFlow();
                  toast("Onboarding reset.", { level: "info" });
                  navigate("/onboarding");
                }
              }
            },
            "Reset onboarding"
          ),
          Button(
            {
              variant: "danger",
              onclick: async () => {
                const confirmed = await confirmAction({
                  title: "Erase all local data?",
                  description:
                    "This removes your profile, holdings, logged entries and saved scenarios from this browser. Lessons stay installed. This cannot be undone.",
                  confirmLabel: "Erase everything"
                });

                if (confirmed) {
                  resetUserData();
                  resetOnboardingFlow();
                  toast("All local data erased.", { level: "info" });
                  navigate("/");
                }
              }
            },
            "Erase all local data"
          )
        ])
      ])
    ]
  });
}

/* -------------------------------------------------------------------------- */
/* Legal                                                                      */
/* -------------------------------------------------------------------------- */

export function LegalSettingsView() {
  return SettingsPage({
    eyebrow: "About",
    title: "Legal disclaimer",
    description: "What FirePath is, and what it is not.",
    children: [
      Card({}, [
        h("div", { class: "prose" }, [
          h("p", { text: disclaimer }),
          h("p", {
            text: "FirePath is an educational planning tool. Every figure it shows is the result of arithmetic applied to numbers you entered, using assumptions you chose. Projections are models, not forecasts, and real returns, inflation, taxes and life events will differ."
          }),
          h("p", {
            text: "FirePath does not recommend buying or selling any asset, does not rate holdings, and never connects to a broker or bank. Optional market quotes come from a third-party data provider and may be delayed or unavailable."
          })
        ])
      ]),
      Card({}, [
        SectionHeader({ title: "Policies and support" }),
        h("p", {
          class: "muted",
          text: "Your inputs are stored in this browser's local storage. When optional market data is enabled, only search text and instrument identifiers are sent to the configured proxy."
        }),
        h("div", { class: "button-row" }, [
          h(
            "a",
            {
              class: "button button--secondary",
              href: privacyPolicyUrl,
              target: "_blank",
              rel: "noopener noreferrer"
            },
            "Privacy policy"
          ),
          h(
            "a",
            {
              class: "button button--secondary",
              href: termsOfUseUrl,
              target: "_blank",
              rel: "noopener noreferrer"
            },
            "Terms of use"
          ),
          h(
            "a",
            {
              class: "button button--secondary",
              href: supportUrl,
              target: "_blank",
              rel: "noopener noreferrer"
            },
            "Support"
          )
        ])
      ])
    ]
  });
}
