import { calculateFireTimeline, calculateInflationAdjustedReturn } from "../domain/fireCalculations.js";
import {
  buildFireVariants,
  buildPlannerStatusLine,
  calculateScenarioOutcome,
  compareScenarioWithPlan,
  draftFromProfile,
  draftFromScenario,
  estimateFireAge,
  findPlannerGaps,
  isDraftEqual,
  parseScenarioDraft,
  summarizeScenarios,
  validateScenarioDraft
} from "../domain/firePlanner.js";
import { formatCurrency, formatPercent, formatYears } from "../domain/formatters.js";
import { parsePositiveNumber } from "../domain/numberInput.js";
import { buildScenarioName } from "../domain/scenarioNaming.js";
import { addScenario, getState, removeScenario, selectFireMetrics } from "../store/store.js";
import {
  Button,
  Card,
  EmptyState,
  Field,
  MetricCard,
  MilestoneTimeline,
  ProgressBar,
  ProgressRing,
  SectionHeader,
  StatusChip
} from "../ui/components.js";
import { h } from "../ui/dom.js";
import { confirmAction, toast } from "../ui/feedback.js";
import { href } from "../router.js";

/**
 * FIRE planner.
 *
 * The saved plan sits at the top; everything below it is exploratory. The
 * what-if sandbox never writes to the profile — the only way a change becomes
 * permanent is saving it as a named scenario.
 */

/** Sandbox state lives outside the render so typing survives a store update. */
let sandboxDraft = null;
let sandboxBaseline = null;
let partTimeIncomeInput = "";

function requestRerender() {
  window.dispatchEvent(new CustomEvent("firepath:rerender"));
}

export function FireView() {
  const { profile, scenarios } = getState();
  const metrics = selectFireMetrics();
  const currency = profile?.currency ?? "EUR";

  if (!profile) {
    return h("div", { class: "view" }, [
      Card({}, [
        EmptyState({
          icon: "◎",
          title: "The planner needs your numbers",
          description: "Complete the short setup so FirePath can project a FIRE number and a timeline.",
          action: Button({ to: "/onboarding", variant: "primary" }, "Start planning")
        })
      ])
    ]);
  }

  // A saved profile change means the sandbox baseline is stale.
  if (sandboxDraft === null || sandboxBaseline !== profile.updatedAt) {
    sandboxDraft = draftFromProfile(profile);
    sandboxBaseline = profile.updatedAt;
  }

  const gaps = findPlannerGaps(profile);
  const partTimeAnnualIncome = parsePositiveNumber(partTimeIncomeInput) * 12;
  const variants = buildFireVariants({ profile, metrics, partTimeAnnualIncome, currency });
  const milestones = calculateFireTimeline({
    netWorth: metrics.netWorth,
    emergencyFund: profile.emergencyFund,
    monthlyExpenses: profile.monthlyExpenses,
    monthlySavings: metrics.monthlySavings,
    monthlyInvestment: profile.monthlyInvestment,
    fireNumber: metrics.fireNumber,
    annualReturn: calculateInflationAdjustedReturn(profile.expectedReturn, profile.expectedInflation)
  });
  const fireAge = estimateFireAge(profile.age, metrics.yearsToFire);

  return h("div", { class: "view" }, [
    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: "FIRE planner" }),
        h("h1", { class: "page-header__title", text: "Model your path" }),
        h("p", { class: "page-header__description", text: buildPlannerStatusLine(metrics) })
      ]),
      h("div", { class: "page-header__actions" }, [
        Button({ to: "/settings/fire-assumptions", variant: "ghost" }, "Edit assumptions")
      ])
    ]),

    gaps.length > 0 ? PlannerGaps({ gaps }) : null,

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
        ProgressRing({
          value: metrics.fireProgress,
          caption: fireAge === null ? "No date yet" : `Age ${fireAge}`,
          label: "Progress to FIRE number"
        })
      ]),
      h("div", { class: "grid grid--3" }, [
        MetricCard({ label: "Years to FIRE", value: formatYears(metrics.yearsToFire) }),
        MetricCard({
          label: "Still needed",
          value: formatCurrency(Math.max(0, metrics.fireNumber - metrics.netWorth), currency)
        }),
        MetricCard({
          label: "Real return",
          value: formatPercent(
            calculateInflationAdjustedReturn(profile.expectedReturn, profile.expectedInflation),
            1
          ),
          hint: "After expected inflation"
        })
      ])
    ]),

    h("div", { class: "grid grid--sidebar" }, [
      h("div", { class: "stack" }, [
        FireVariantsCard({ variants, currency }),
        SandboxCard({ profile, metrics, currency, scenarios })
      ]),
      h("div", { class: "stack" }, [
        Card({}, [
          SectionHeader({
            eyebrow: "Timeline",
            title: "Milestones ahead",
            description: "Projected from your saved plan at today's net worth."
          }),
          MilestoneTimeline({
            milestones,
            formatAmount: (amount) => formatCurrency(amount, currency)
          })
        ]),
        SavedScenariosCard({ scenarios, metrics, currency, profile })
      ])
    ])
  ]);
}

function PlannerGaps({ gaps }) {
  return Card({ tone: "accent", class: "card--flush" }, [
    h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [
      SectionHeader({
        eyebrow: "Needs input",
        title: "These projections are incomplete",
        description: "The planner cannot model a path without them."
      })
    ]),
    h(
      "div",
      { class: "list" },
      gaps.map((gap) =>
        h("a", { class: "list__row", href: href(gap.route) }, [
          h("span", { class: "list__row-copy" }, [
            h("span", { class: "list__row-title", text: gap.title }),
            h("span", { class: "list__row-detail", text: gap.description })
          ]),
          h("span", { class: "list__row-chevron", "aria-hidden": "true", text: "›" })
        ])
      )
    )
  ]);
}

/** Coast / Barista / Full side by side, all derived from the same FIRE number. */
function FireVariantsCard({ variants, currency }) {
  return Card({}, [
    SectionHeader({
      eyebrow: "FIRE styles",
      title: "Three ways to get there",
      description: "Same plan, different amounts of work income after you stop full-time."
    }),
    Field({
      label: "Expected part-time income (monthly)",
      value: partTimeIncomeInput,
      inputMode: "decimal",
      placeholder: "0",
      hint: "Used only for the Barista FIRE target.",
      onChange: (value) => {
        partTimeIncomeInput = value;
        requestRerender();
      }
    }),
    h(
      "div",
      { class: "stack" },
      variants.map((variant) =>
        h("article", { class: "stack stack--tight" }, [
          h("div", { class: "row row--between" }, [
            h("h3", { class: "section-header__title", text: variant.label }),
            StatusChip(variant.status)
          ]),
          h("p", { class: "muted", text: variant.description }),
          ProgressBar({
            value: variant.progress,
            label: formatCurrency(variant.targetAmount, currency),
            level: variant.status.level === "good" ? "good" : "watch"
          }),
          h("p", { class: "muted", text: variant.detail })
        ])
      )
    )
  ]);
}

/**
 * What-if sandbox.
 *
 * Only the outcome panel is re-rendered while typing, so the focused input
 * never loses its caret mid-keystroke.
 */
function SandboxCard({ profile, metrics, currency, scenarios }) {
  const outcomePanel = h("div", { class: "stack" });

  const renderOutcome = () => {
    const outcome = calculateScenarioOutcome(sandboxDraft, { netWorth: metrics.netWorth });
    const comparison = compareScenarioWithPlan({ outcome, metrics, currency });

    outcomePanel.replaceChildren(
      h("div", { class: `verdict verdict--${comparison.level}`, "aria-live": "polite" }, [
        h("strong", { class: "verdict__headline", text: comparison.headline }),
        h("p", { class: "verdict__detail", text: comparison.detail })
      ]),
      h("div", { class: "stat-row" }, [
        Stat("FIRE number", formatCurrency(outcome.fireNumber, currency)),
        Stat("Years to FIRE", formatYears(outcome.yearsToFire)),
        Stat("FIRE year", outcome.fireYear === null ? "—" : String(outcome.fireYear))
      ]),
      h("div", { class: "row row--between" }, [
        h("span", { class: "muted", text: "Return after inflation" }),
        StatusChip({
          label: formatPercent(outcome.realReturn, 1),
          level: outcome.realReturn > 0 ? "good" : "risk"
        })
      ])
    );
  };

  const update = (patch) => {
    sandboxDraft = { ...sandboxDraft, ...patch };
    renderOutcome();
  };

  renderOutcome();

  const isDirty = !isDraftEqual(sandboxDraft, draftFromProfile(profile));

  return Card({}, [
    SectionHeader({
      eyebrow: "What-if sandbox",
      title: "Test a change",
      description: "Nothing here touches your saved plan until you save it as a scenario.",
      action: Button(
        {
          variant: "ghost",
          size: "sm",
          disabled: !isDirty,
          onclick: () => {
            sandboxDraft = draftFromProfile(profile);
            requestRerender();
          }
        },
        "Reset"
      )
    }),
    outcomePanel,
    h("div", { class: "field-grid" }, [
      Field({
        label: "Monthly investment",
        value: sandboxDraft.monthlyInvestment,
        inputMode: "decimal",
        onInput: (value) => update({ monthlyInvestment: value })
      }),
      Field({
        label: "Monthly FIRE spending",
        value: sandboxDraft.monthlyExpenses,
        inputMode: "decimal",
        onInput: (value) => update({ monthlyExpenses: value })
      }),
      Field({
        label: "Expected return (%)",
        value: sandboxDraft.expectedReturn,
        inputMode: "decimal",
        onInput: (value) => update({ expectedReturn: value })
      }),
      Field({
        label: "Inflation (%)",
        value: sandboxDraft.inflation,
        inputMode: "decimal",
        onInput: (value) => update({ inflation: value })
      }),
      Field({
        label: "Withdrawal rate (%)",
        value: sandboxDraft.withdrawalRate,
        inputMode: "decimal",
        hint: "A lower rate means a larger target and a more cautious plan.",
        onInput: (value) => update({ withdrawalRate: value })
      })
    ]),
    Button(
      {
        variant: "secondary",
        onclick: () => {
          const error = validateScenarioDraft(sandboxDraft);

          if (error) {
            toast(error, { level: "error" });
            return;
          }

          const parsed = parseScenarioDraft(sandboxDraft);
          const scenario = addScenario({
            name: buildScenarioName(scenarios),
            monthlyInvestment: parsed.monthlyInvestment,
            monthlyExpenses: parsed.monthlyExpenses,
            withdrawalRate: parsed.withdrawalRate,
            expectedReturn: parsed.expectedReturn,
            expectedInflation: parsed.expectedInflation
          });

          toast(`${scenario.name} saved. Compare it below any time.`);
        }
      },
      "Save as scenario"
    )
  ]);
}

function Stat(label, value) {
  return h("div", { class: "stat" }, [
    h("span", { class: "stat__label", text: label }),
    h("strong", { class: "stat__value", text: value })
  ]);
}

/**
 * Saved scenarios are re-run against today's net worth rather than shown as
 * the raw inputs they store, so they stay comparable with each other.
 */
function SavedScenariosCard({ scenarios, metrics, currency, profile }) {
  const summaries = summarizeScenarios(scenarios, metrics);

  return Card({}, [
    SectionHeader({
      eyebrow: "Saved scenarios",
      title: `${scenarios.length} saved`,
      description: "Each one re-projected from your current net worth."
    }),
    summaries.length === 0
      ? EmptyState({
          icon: "◇",
          title: "No scenarios yet",
          description: "Adjust the sandbox and save it to compare plans side by side."
        })
      : h(
          "div",
          { class: "stack" },
          summaries.map((summary) =>
            h("article", { class: "stack stack--tight" }, [
              h("div", { class: "row row--between" }, [
                h("h3", { class: "section-header__title", text: summary.scenario.name }),
                StatusChip(summary.status)
              ]),
              h("p", {
                class: "muted",
                text: `${formatCurrency(summary.fireNumber, currency)} target · ${formatYears(
                  summary.yearsToFire
                )}`
              }),
              h("div", { class: "row" }, [
                Button(
                  {
                    variant: "ghost",
                    size: "sm",
                    onclick: () => {
                      sandboxDraft = draftFromScenario(summary.scenario, profile);
                      requestRerender();
                      toast(`${summary.scenario.name} loaded into the sandbox.`, { level: "info" });
                    }
                  },
                  "Load"
                ),
                Button(
                  {
                    variant: "ghost",
                    size: "sm",
                    onclick: async () => {
                      const confirmed = await confirmAction({
                        title: `Delete ${summary.scenario.name}?`,
                        description: "This removes the saved scenario from this browser.",
                        confirmLabel: "Delete scenario"
                      });

                      if (confirmed) {
                        removeScenario(summary.scenario.id);
                        toast("Scenario deleted.", { level: "info" });
                      }
                    }
                  },
                  "Delete"
                )
              ])
            ])
          )
        )
  ]);
}
