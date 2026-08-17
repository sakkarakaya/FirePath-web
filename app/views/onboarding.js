import {
  countryOptions,
  currencyOptions,
  drawdownResponseOptions,
  initialOnboardingValues,
  investingExperienceOptions,
  learningTopicOptions,
  onboardingMoneyExamples,
  onboardingMoneyFieldKeys,
  withdrawalRateOptions
} from "../data/defaults.js";
import { disclaimer } from "../data/copy.js";
import { percentToRate } from "../domain/fireCalculations.js";
import { formatCurrency, formatPercent, formatYears, getCurrencySymbol } from "../domain/formatters.js";
import { parseLocaleNumber, parseWholeNumber } from "../domain/numberInput.js";
import { getState, saveProfile, selectFireMetrics } from "../store/store.js";
import {
  Button,
  Card,
  ChipToggleGroup,
  Field,
  MetricCard,
  ProgressRing,
  SectionHeader,
  SegmentedControl,
  SelectField,
  StatusChip,
  SwitchRow
} from "../ui/components.js";
import { h } from "../ui/dom.js";
import { toast } from "../ui/feedback.js";
import { navigate } from "../router.js";

/**
 * Welcome and onboarding.
 *
 * Same four steps as the mobile app. Each step validates before it advances so
 * the user fixes one screen's worth of problems at a time rather than meeting a
 * wall of errors at the end.
 */

const stepTitles = ["Basic profile", "Current financial status", "FIRE goal", "Risk and experience"];

const experienceLabels = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

let step = 0;
let draft = { ...initialOnboardingValues };
let countryChoice = "Germany";
let withdrawalChoice = "3.5";
let customWithdrawalRate = "3.5";
let fieldErrors = {};
let submitError = "";
/** Fields the user has touched keep their value when the currency changes. */
let customizedFields = new Set();

function requestRerender() {
  window.dispatchEvent(new CustomEvent("firepath:rerender"));
}

export function resetOnboardingFlow() {
  step = 0;
  draft = { ...initialOnboardingValues, learningTopics: [...initialOnboardingValues.learningTopics] };
  countryChoice = "Germany";
  withdrawalChoice = "3.5";
  customWithdrawalRate = "3.5";
  fieldErrors = {};
  submitError = "";
  customizedFields = new Set();
}

export function WelcomeView() {
  return h("div", { class: "welcome" }, [
    h("div", { class: "welcome__inner" }, [
      h("img", {
        src: "assets/icon.png",
        alt: "",
        width: "64",
        height: "64",
        style: { borderRadius: "16px" }
      }),
      h("p", { class: "eyebrow", text: "Local-first FIRE planning" }),
      h("h1", { class: "welcome__title", text: "Plan your path. Build your freedom." }),
      h("p", {
        class: "welcome__lead",
        text: "Track income, expenses, portfolio and FIRE goals with clear calculations you control. Everything stays in your browser."
      }),
      h("div", { class: "welcome__actions" }, [
        Button(
          {
            variant: "primary",
            size: "lg",
            onclick: () => {
              resetOnboardingFlow();
              navigate("/onboarding");
            }
          },
          "Start planning"
        ),
        Button({ to: "/dashboard", variant: "ghost", size: "lg" }, "Open without setup")
      ]),
      h("p", { class: "disclaimer", text: disclaimer }),
      h("nav", { class: "welcome__legal", "aria-label": "Policies and support" }, [
        h("a", { href: "privacy.html", text: "Privacy Policy" }),
        h("a", { href: "terms.html", text: "Terms of Use" }),
        h("a", { href: "support.html", text: "Support" })
      ])
    ])
  ]);
}

export function OnboardingView() {
  const isLastStep = step === stepTitles.length - 1;

  return h("div", { class: "onboarding" }, [
    h("div", { class: "onboarding__panel" }, [
      h("div", { class: "stack stack--tight" }, [
        h(
          "div",
          {
            class: "steps",
            role: "progressbar",
            "aria-valuenow": step + 1,
            "aria-valuemin": 1,
            "aria-valuemax": stepTitles.length,
            "aria-label": `Step ${step + 1} of ${stepTitles.length}`
          },
          stepTitles.map((_, index) =>
            h("span", {
              class: `steps__item ${index < step ? "is-done" : ""} ${
                index === step ? "is-current" : ""
              }`.trim()
            })
          )
        ),
        h("p", { class: "eyebrow", text: `Step ${step + 1} of ${stepTitles.length}` }),
        h("h1", { class: "page-header__title", text: stepTitles[step] }),
        h("p", { class: "muted", text: "Your data stays in this browser — edit anything later in Settings." })
      ]),

      Card({}, [renderStep()]),

      submitError ? h("p", { class: "inline-error", role: "alert", text: submitError }) : null,

      h("div", { class: "onboarding__actions" }, [
        step > 0
          ? Button(
              {
                variant: "ghost",
                onclick: () => {
                  fieldErrors = {};
                  submitError = "";
                  step -= 1;
                  requestRerender();
                }
              },
              "Back"
            )
          : null,
        Button(
          { variant: "primary", onclick: isLastStep ? submit : next },
          isLastStep ? "View summary" : "Continue"
        )
      ])
    ])
  ]);
}

function renderStep() {
  if (step === 0) {
    return h("div", { class: "stack" }, [
      Field({
        label: "Age",
        value: draft.age,
        type: "number",
        min: "16",
        max: "100",
        error: fieldErrors.age,
        onInput: (value) => updateField("age", value)
      }),
      SelectField({
        label: "Country",
        value: countryChoice,
        options: countryOptions,
        onChange: (value) => {
          countryChoice = value;
          updateField("country", value === "Other" ? "" : value);
          requestRerender();
        }
      }),
      countryChoice === "Other"
        ? Field({
            label: "Your country",
            value: draft.country,
            error: fieldErrors.country,
            onInput: (value) => updateField("country", value)
          })
        : null,
      SegmentedControl({
        options: currencyOptions,
        value: draft.currency,
        label: "Currency",
        getLabel: (code) => `${code} ${getCurrencySymbol(code)}`,
        onChange: changeCurrency
      }),
      Field({
        label: "Monthly net income",
        value: draft.monthlyIncome,
        inputMode: "decimal",
        prefix: getCurrencySymbol(draft.currency),
        error: fieldErrors.monthlyIncome,
        onFocus: () => clearSuggestedValue("monthlyIncome"),
        onInput: (value) => updateField("monthlyIncome", value)
      }),
      Field({
        label: "Average monthly expenses",
        value: draft.monthlyExpenses,
        inputMode: "decimal",
        prefix: getCurrencySymbol(draft.currency),
        error: fieldErrors.monthlyExpenses,
        onFocus: () => clearSuggestedValue("monthlyExpenses"),
        onInput: (value) => updateField("monthlyExpenses", value)
      })
    ]);
  }

  if (step === 1) {
    const money = (key, label, hint) =>
      Field({
        label,
        value: draft[key],
        inputMode: "decimal",
        prefix: getCurrencySymbol(draft.currency),
        hint,
        error: fieldErrors[key],
        onFocus: () => clearSuggestedValue(key),
        onInput: (value) => updateField(key, value)
      });

    return h("div", { class: "stack" }, [
      money("currentCash", "Current cash", "Everything in current and savings accounts."),
      money("currentInvestments", "Current investments", "Total invested value, tracked or not."),
      money("debts", "Debts", "Enter 0 if none."),
      money("monthlyInvestment", "Monthly investment amount", "What you add to investments each month."),
      money("emergencyFund", "Emergency fund amount", "The part of your cash reserved for emergencies.")
    ]);
  }

  if (step === 2) {
    return h("div", { class: "stack" }, [
      Field({
        label: "Target FIRE age",
        value: draft.targetFireAge,
        type: "number",
        min: "16",
        max: "100",
        error: fieldErrors.targetFireAge,
        onFocus: () => clearSuggestedValue("targetFireAge"),
        onInput: (value) => updateField("targetFireAge", value)
      }),
      Field({
        label: "Desired monthly spending after FIRE",
        value: draft.desiredMonthlyFireSpending,
        inputMode: "decimal",
        prefix: getCurrencySymbol(draft.currency),
        error: fieldErrors.desiredMonthlyFireSpending,
        onFocus: () => clearSuggestedValue("desiredMonthlyFireSpending"),
        onInput: (value) => updateField("desiredMonthlyFireSpending", value)
      }),
      SegmentedControl({
        options: withdrawalRateOptions,
        value: withdrawalChoice,
        label: "Withdrawal rate",
        getLabel: (option) => (option === "Custom" ? "Custom" : `${option}%`),
        onChange: (value) => {
          withdrawalChoice = value;
          if (value !== "Custom") {
            updateField("withdrawalRate", value);
          }
          requestRerender();
        }
      }),
      withdrawalChoice === "Custom"
        ? Field({
            label: "Custom withdrawal rate (%)",
            value: customWithdrawalRate,
            inputMode: "decimal",
            suffix: "%",
            error: fieldErrors.withdrawalRate,
            onInput: (value) => {
              customWithdrawalRate = value;
              updateField("withdrawalRate", value);
            }
          })
        : null,
      Field({
        label: "Expected annual return (%)",
        value: draft.expectedReturn,
        inputMode: "decimal",
        suffix: "%",
        error: fieldErrors.expectedReturn,
        onFocus: () => clearSuggestedValue("expectedReturn"),
        onInput: (value) => updateField("expectedReturn", value)
      }),
      Field({
        label: "Expected inflation (%)",
        value: draft.expectedInflation,
        inputMode: "decimal",
        suffix: "%",
        error: fieldErrors.expectedInflation,
        onFocus: () => clearSuggestedValue("expectedInflation"),
        onInput: (value) => updateField("expectedInflation", value)
      })
    ]);
  }

  return h("div", { class: "stack" }, [
    SegmentedControl({
      options: investingExperienceOptions,
      value: draft.investingExperience,
      label: "Investing experience",
      getLabel: (value) => experienceLabels[value],
      onChange: (value) => {
        draft.investingExperience = value;
        requestRerender();
      }
    }),
    SegmentedControl({
      options: drawdownResponseOptions,
      value: draft.drawdownResponse,
      label: "What would you do if your portfolio drops 30%?",
      onChange: (value) => {
        draft.drawdownResponse = value;
        requestRerender();
      }
    }),
    ChipToggleGroup({
      label: "Preferred learning topics",
      options: learningTopicOptions,
      values: draft.learningTopics,
      onToggle: (topic) => {
        draft.learningTopics = draft.learningTopics.includes(topic)
          ? draft.learningTopics.filter((item) => item !== topic)
          : [...draft.learningTopics, topic];
        requestRerender();
      }
    }),
    h("div", { class: "stack stack--tight" }, [
      h("span", { class: "field__label", text: "Review preferences" }),
      h("p", {
        class: "muted",
        text: "Choose which progress check-ins FirePath should prepare for future reminders."
      }),
      SwitchRow({
        label: "Weekly summary",
        checked: draft.weeklySummaryEnabled,
        onChange: (value) => {
          draft.weeklySummaryEnabled = value;
          requestRerender();
        }
      }),
      SwitchRow({
        label: "Monthly report",
        checked: draft.monthlyReportEnabled,
        onChange: (value) => {
          draft.monthlyReportEnabled = value;
          requestRerender();
        }
      }),
      SwitchRow({
        label: "Progress alerts",
        checked: draft.progressAlertEnabled,
        onChange: (value) => {
          draft.progressAlertEnabled = value;
          requestRerender();
        }
      })
    ])
  ]);
}

function updateField(key, value) {
  draft[key] = value;
  customizedFields.add(key);
  fieldErrors[key] = undefined;
  submitError = "";
}

/**
 * Suggested amounts are a starting point, not a default to keep. Clearing on
 * first focus means the user types their own number instead of editing around
 * an example.
 */
function clearSuggestedValue(key) {
  if (customizedFields.has(key)) {
    return;
  }
  draft[key] = "";
  customizedFields.add(key);
  fieldErrors[key] = undefined;
  requestRerender();
}

/** Switching currency re-bases only the example amounts the user has not edited. */
function changeCurrency(currency) {
  const examples = onboardingMoneyExamples[currency] ?? onboardingMoneyExamples.EUR;

  draft.currency = currency;
  onboardingMoneyFieldKeys.forEach((key) => {
    if (!customizedFields.has(key)) {
      draft[key] = String(examples[key]);
    }
  });

  submitError = "";
  requestRerender();
}

function next() {
  if (!validateCurrentStep()) {
    requestRerender();
    return;
  }
  step = Math.min(stepTitles.length - 1, step + 1);
  fieldErrors = {};
  requestRerender();
}

function submit() {
  if (!validateCurrentStep()) {
    requestRerender();
    return;
  }

  try {
    saveProfile(buildProfileInput());
    navigate("/onboarding/summary");
  } catch (error) {
    submitError =
      error instanceof Error ? error.message : "Your profile could not be saved. Please try again.";
    requestRerender();
  }
}

function buildProfileInput() {
  return {
    age: parseWholeNumber(draft.age),
    country: countryChoice === "Other" ? draft.country.trim() : countryChoice,
    currency: draft.currency.trim().toUpperCase() || "EUR",
    monthlyIncome: parseMoney(draft.monthlyIncome),
    monthlyExpenses: parseMoney(draft.monthlyExpenses),
    currentCash: parseMoney(draft.currentCash),
    currentInvestments: parseMoney(draft.currentInvestments),
    debts: parseMoney(draft.debts),
    monthlyInvestment: parseMoney(draft.monthlyInvestment),
    emergencyFund: parseMoney(draft.emergencyFund),
    targetFireAge: parseWholeNumber(draft.targetFireAge),
    desiredMonthlyFireSpending: parseMoney(draft.desiredMonthlyFireSpending),
    withdrawalRate: percentToRate(parseMoney(getWithdrawalRateValue())),
    expectedReturn: percentToRate(parseSignedMoney(draft.expectedReturn)),
    expectedInflation: percentToRate(parseSignedMoney(draft.expectedInflation)),
    investingExperience: draft.investingExperience,
    drawdownResponse: draft.drawdownResponse,
    learningTopics: draft.learningTopics,
    weeklySummaryEnabled: draft.weeklySummaryEnabled,
    monthlyReportEnabled: draft.monthlyReportEnabled,
    progressAlertEnabled: draft.progressAlertEnabled
  };
}

function getWithdrawalRateValue() {
  return withdrawalChoice === "Custom" ? customWithdrawalRate : withdrawalChoice;
}

function validateCurrentStep() {
  const errors = {};

  if (step === 0) {
    const age = parseWholeNumber(draft.age);
    if (age < 16 || age > 100) {
      errors.age = "Enter an age between 16 and 100.";
    }
    if (countryChoice === "Other" && !draft.country.trim()) {
      errors.country = "Country is required.";
    }
    requirePositive("monthlyIncome", "Monthly net income", errors);
    requirePositive("monthlyExpenses", "Average monthly expenses", errors);
  } else if (step === 1) {
    requireNonNegative("currentCash", "Current cash", errors);
    requireNonNegative("currentInvestments", "Current investments", errors);
    requireNonNegative("debts", "Debts", errors);
    requireNonNegative("monthlyInvestment", "Monthly investment amount", errors);
    requireNonNegative("emergencyFund", "Emergency fund amount", errors);
  } else if (step === 2) {
    const targetAge = parseWholeNumber(draft.targetFireAge);
    if (!String(draft.targetFireAge).trim()) {
      errors.targetFireAge = "Target FIRE age is required.";
    } else if (targetAge <= parseWholeNumber(draft.age) || targetAge > 100) {
      errors.targetFireAge = "Enter an age above your current age and at most 100.";
    }

    requirePositive("desiredMonthlyFireSpending", "Desired monthly spending", errors);

    if (withdrawalChoice === "Custom") {
      const rate = parseSignedMoney(customWithdrawalRate);
      if (!customWithdrawalRate.trim()) {
        errors.withdrawalRate = "Withdrawal rate is required.";
      } else if (rate < 1 || rate > 10) {
        errors.withdrawalRate = "Enter a withdrawal rate between 1% and 10%.";
      }
    }

    requirePercentage("expectedReturn", "Expected annual return", -20, 30, errors);
    requirePercentage("expectedInflation", "Expected inflation", -5, 20, errors);
  }

  fieldErrors = errors;
  submitError = "";
  return Object.keys(errors).length === 0;
}

function requirePositive(key, label, errors) {
  const raw = String(draft[key]).trim();
  const parsed = parseLocaleNumber(raw);

  if (!raw) {
    errors[key] = `${label} is required.`;
  } else if (!Number.isFinite(parsed) || parsed <= 0) {
    errors[key] = `${label} must be greater than zero.`;
  }
}

function requireNonNegative(key, label, errors) {
  const raw = String(draft[key]).trim();
  const parsed = parseLocaleNumber(raw);

  if (!raw) {
    errors[key] = `${label} is required. Enter 0 if none.`;
  } else if (!Number.isFinite(parsed) || parsed < 0) {
    errors[key] = `${label} cannot be negative.`;
  }
}

function requirePercentage(key, label, min, max, errors) {
  const raw = String(draft[key]).trim();
  const parsed = parseLocaleNumber(raw);

  if (!raw) {
    errors[key] = `${label} is required.`;
  } else if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors[key] = `${label} must be between ${min}% and ${max}%.`;
  }
}

function parseMoney(value) {
  const parsed = parseLocaleNumber(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseSignedMoney(value) {
  const parsed = parseLocaleNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** First look at the plan the answers produced, before entering the app. */
export function OnboardingSummaryView() {
  const { profile } = getState();
  const metrics = selectFireMetrics();

  if (!profile) {
    navigate("/onboarding", { replace: true });
    return h("div", { class: "view" });
  }

  const currency = profile.currency;

  return h("div", { class: "onboarding" }, [
    h("div", { class: "onboarding__panel" }, [
      h("div", { class: "stack stack--tight" }, [
        h("p", { class: "eyebrow", text: "Setup complete" }),
        h("h1", { class: "page-header__title", text: "Here is your starting point" }),
        h("p", {
          class: "muted",
          text: "Everything below is calculated from the answers you just gave. You can change any of them in Settings."
        })
      ]),

      Card({}, [
        h("div", { class: "hero" }, [
          h("div", { class: "hero__copy" }, [
            h("p", { class: "eyebrow", text: "FIRE number" }),
            h("strong", { class: "hero__value", text: formatCurrency(metrics.fireNumber, currency) }),
            h("p", {
              class: "hero__caption",
              text: `${formatCurrency(metrics.annualExpenses, currency)} a year at a ${formatPercent(
                profile.withdrawalRate,
                1
              )} withdrawal rate.`
            })
          ]),
          ProgressRing({ value: metrics.fireProgress, caption: "of target", label: "FIRE progress" })
        ]),
        h("div", { class: "grid grid--3" }, [
          MetricCard({ label: "Net worth", value: formatCurrency(metrics.netWorth, currency) }),
          MetricCard({ label: "Savings rate", value: formatPercent(metrics.savingsRate) }),
          MetricCard({ label: "Years to FIRE", value: formatYears(metrics.yearsToFire) })
        ])
      ]),

      Card({}, [
        SectionHeader({ eyebrow: "Your answers", title: "Profile summary" }),
        h("div", { class: "row" }, [
          StatusChip({ label: `${profile.age} years old`, level: "neutral" }),
          StatusChip({ label: profile.country, level: "neutral" }),
          StatusChip({ label: `Target age ${profile.targetFireAge}`, level: "neutral" }),
          StatusChip({ label: experienceLabels[profile.investingExperience], level: "neutral" })
        ])
      ]),

      h("p", { class: "disclaimer", text: disclaimer }),

      h("div", { class: "onboarding__actions" }, [
        Button(
          {
            variant: "primary",
            onclick: () => {
              toast("Your plan is saved in this browser.");
              navigate("/dashboard");
            }
          },
          "Open dashboard"
        )
      ])
    ])
  ]);
}
