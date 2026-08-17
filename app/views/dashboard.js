import {
  buildDashboardInsight,
  buildGreeting,
  buildMonthSnapshot,
  buildStatusLine,
  describeEmergencyFund,
  describePlanScore,
  describeSavingsRate,
  estimateFireYear,
  findPlanGaps,
  routeForScoreComponent
} from "../domain/dashboard.js";
import { calculateFireScore } from "../domain/fireCalculations.js";
import { formatCurrency, formatPercent, formatYears } from "../domain/formatters.js";
import { describePortfolioSource } from "../domain/portfolioCalculations.js";
import { getState, selectFireMetrics } from "../store/store.js";
import {
  Button,
  Card,
  EmptyState,
  MetricCard,
  ProgressBar,
  ProgressRing,
  SectionHeader,
  StatusChip
} from "../ui/components.js";
import { h } from "../ui/dom.js";
import { href } from "../router.js";

/**
 * Dashboard — the command centre.
 *
 * Reading order is deliberate: where you stand (hero), what the plan scores,
 * what is missing, this month, then the single highest-impact change. Every
 * number that needs an input the user has not given links to the screen that
 * fixes it rather than quietly showing a zero.
 */
export function DashboardView() {
  const { profile, holdings, transactions } = getState();
  const metrics = selectFireMetrics();
  const currency = profile?.currency ?? "EUR";

  if (!profile) {
    return h("div", { class: "view" }, [
      Card({}, [
        EmptyState({
          icon: "◈",
          title: "No plan yet",
          description:
            "Answer four short steps and FirePath will project your FIRE number, timeline and plan health from your own numbers.",
          action: Button({ to: "/onboarding", variant: "primary" }, "Start planning")
        })
      ])
    ]);
  }

  const gaps = findPlanGaps(profile);
  const snapshot = buildMonthSnapshot({ profile, transactions });
  const insight = buildDashboardInsight({ profile, metrics });
  const score = calculateFireScore({
    savingsRate: metrics.savingsRate,
    emergencyFundMonths: metrics.emergencyFundMonths,
    debts: profile.debts,
    currentCash: profile.currentCash,
    currentInvestments: profile.currentInvestments,
    monthlyInvestment: profile.monthlyInvestment,
    monthlySavings: metrics.monthlySavings,
    fireProgress: metrics.fireProgress
  });
  const scoreStatus = describePlanScore(score.score, score.maxScore);
  const fireYear = estimateFireYear(metrics.yearsToFire);

  return h("div", { class: "view" }, [
    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: buildGreeting() }),
        h("h1", { class: "page-header__title", text: "Your plan today" }),
        h("p", { class: "page-header__description", text: buildStatusLine(metrics) })
      ]),
      h("div", { class: "page-header__actions" }, [
        Button({ to: "/settings/monthly-update", variant: "ghost" }, "Log this month"),
        Button({ to: "/fire", variant: "primary" }, "Open FIRE planner")
      ])
    ]),

    NetWorthHero({ metrics, currency, holdingCount: holdings.length, fireYear }),

    h("div", { class: "grid grid--4" }, [
      MetricCard({
        label: "FIRE number",
        value: formatCurrency(metrics.fireNumber, currency),
        hint: `${formatCurrency(metrics.annualExpenses, currency)} a year at ${formatPercent(
          profile.withdrawalRate,
          1
        )}`
      }),
      MetricCard({
        label: "Savings rate",
        value: formatPercent(metrics.savingsRate),
        status: describeSavingsRate(metrics.savingsRate),
        hint: `${formatCurrency(metrics.monthlySavings, currency)} a month`
      }),
      MetricCard({
        label: "Years to FIRE",
        value: formatYears(metrics.yearsToFire),
        hint: fireYear === null ? "Needs a monthly investment" : `On track for ${fireYear}`
      }),
      MetricCard({
        label: "Emergency fund",
        value: `${metrics.emergencyFundMonths.toFixed(1)} mo`,
        status: describeEmergencyFund(metrics.emergencyFundMonths),
        hint: `${formatCurrency(profile.emergencyFund, currency)} set aside`
      })
    ]),

    h("div", { class: "grid grid--sidebar" }, [
      h("div", { class: "stack" }, [
        insight && InsightCard({ insight }),
        MonthSnapshotCard({ snapshot, currency })
      ]),
      h("div", { class: "stack" }, [
        PlanHealthCard({ score, scoreStatus }),
        gaps.length > 0 ? SetupGapsCard({ gaps }) : null
      ])
    ])
  ]);
}

function NetWorthHero({ metrics, currency, holdingCount, fireYear }) {
  return Card({}, [
    h("div", { class: "hero" }, [
      h("div", { class: "hero__copy" }, [
        h("p", { class: "eyebrow", text: "Net worth" }),
        h("strong", { class: "hero__value", text: formatCurrency(metrics.netWorth, currency) }),
        h("p", {
          class: "hero__caption",
          text: describePortfolioSource(metrics.portfolioCoverage, holdingCount, currency)
        }),
        // Always brand-coloured: being early in a decades-long plan is the
        // normal state, not a warning, so this bar measures distance rather
        // than health.
        ProgressBar({
          value: metrics.fireProgress,
          label: `Progress to ${formatCurrency(metrics.fireNumber, currency)}`,
          level: "good"
        })
      ]),
      ProgressRing({
        value: metrics.fireProgress,
        caption: fireYear === null ? "No date yet" : `FIRE ${fireYear}`,
        label: "FIRE progress"
      })
    ])
  ]);
}

/**
 * The one change worth making next. Upside and downside sit together so the
 * card never reads as a recommendation to act.
 */
function InsightCard({ insight }) {
  return Card({ tone: "accent" }, [
    h("div", { class: "stack stack--tight" }, [
      h("p", { class: "eyebrow", text: insight.eyebrow }),
      h("h2", { class: "section-header__title", text: insight.headline }),
      h("p", { class: "muted", text: insight.body }),
      insight.riskNote && h("p", { class: "inline-note inline-note--watch", text: insight.riskNote })
    ]),
    h("div", { class: "row" }, [Button({ to: insight.route, variant: "secondary" }, insight.actionLabel)])
  ]);
}

function MonthSnapshotCard({ snapshot, currency }) {
  return Card({}, [
    SectionHeader({
      eyebrow: "This month",
      title: snapshot.periodLabel,
      description: snapshot.isLogged
        ? "Calculated from the entries you logged this month."
        : "Showing your saved plan baseline — log this month to replace it.",
      action: Button({ to: "/settings/monthly-update", variant: "ghost", size: "sm" }, "Update")
    }),
    h("div", { class: "grid grid--2" }, [
      MetricCard({ label: "Income", value: formatCurrency(snapshot.income, currency) }),
      MetricCard({ label: "Expenses", value: formatCurrency(snapshot.expenses, currency) }),
      MetricCard({
        label: "Savings",
        value: formatCurrency(snapshot.savings, currency),
        hint: `${formatPercent(snapshot.savingsRate)} of income`
      }),
      MetricCard({
        label: "Passive income",
        value: formatCurrency(snapshot.passiveIncome, currency),
        hint: `Covers ${formatPercent(snapshot.passiveCoverage)} of expenses`
      })
    ])
  ]);
}

function PlanHealthCard({ score, scoreStatus }) {
  return Card({}, [
    SectionHeader({
      eyebrow: "Plan health",
      title: `${score.score} / ${score.maxScore}`,
      action: StatusChip(scoreStatus)
    }),
    h(
      "div",
      { class: "stack stack--tight" },
      score.components.map((component) =>
        ProgressBar({
          value: component.maxScore === 0 ? 0 : component.score / component.maxScore,
          label: component.label,
          level: componentLevel(component)
        })
      )
    ),
    h("p", {
      class: "muted",
      text: `Strongest: ${score.strongestComponent.label}. Most room to improve: ${score.improvementComponent.label}.`
    }),
    Button(
      { to: routeForScoreComponent(score.improvementComponent.key), variant: "ghost", size: "sm" },
      `Improve ${score.improvementComponent.label.toLowerCase()}`
    )
  ]);
}

function componentLevel(component) {
  const ratio = component.maxScore === 0 ? 0 : component.score / component.maxScore;
  if (ratio >= 0.6) {
    return "good";
  }
  if (ratio >= 0.3) {
    return "watch";
  }
  return "risk";
}

function SetupGapsCard({ gaps }) {
  return Card({ class: "card--flush" }, [
    h("div", { style: { padding: "1.25rem 1.25rem 0" } }, [
      SectionHeader({
        eyebrow: "Needs input",
        title: gaps.length === 1 ? "One input is missing" : `${gaps.length} inputs are missing`,
        description: "Each one makes at least one number on this screen incomplete."
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
