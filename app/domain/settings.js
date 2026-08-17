import { formatCurrency, formatPercent, getCurrencySymbol } from "./formatters.js";

/**
 * Settings logic. The view renders whatever this module lists, so the row copy,
 * the grouping and the "needs input" markers live in one place instead of being
 * spelled out in markup.
 */

const experienceLabels = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced"
};

/** The profile stores this lowercase; sentence case is what belongs on screen. */
export function describeExperience(level) {
  return experienceLabels[level] ?? level;
}

export function countEnabledReminders(profile) {
  return [profile.weeklySummaryEnabled, profile.monthlyReportEnabled, profile.progressAlertEnabled].filter(
    Boolean
  ).length;
}

export function buildReminderSummary(profile) {
  const enabled = countEnabledReminders(profile);
  return enabled === 0 ? "no reminders" : `${enabled} of 3 reminders`;
}

export function buildSettingsStatusLine(gapCount) {
  if (gapCount <= 0) {
    return "Everything the calculations need is filled in.";
  }

  return gapCount === 1
    ? "One input is still missing from your plan."
    : `${gapCount} inputs are still missing from your plan.`;
}

/** "Tracking since August 2026", or null when the stored timestamp is unusable. */
export function formatMemberSince(createdAt) {
  if (!createdAt) {
    return null;
  }

  const parsed = new Date(createdAt);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `Tracking since ${parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
}

/**
 * The settings list, grouped by what each row is for: the plan itself, the data
 * behind it, and the app around it.
 *
 * Gaps found for the dashboard are reused here to badge the exact row that
 * fixes them — settings is where those inputs are actually edited.
 */
export function buildSettingsSections({ profile, gaps, marketDataConfigured = false }) {
  const currency = profile.currency || "EUR";
  const needsInput = badgeForRoutes(gaps);

  return [
    {
      key: "plan",
      title: "Your plan",
      entries: [
        {
          key: "profile",
          title: "Profile",
          detail: `${profile.age} years old · ${profile.country}`,
          value: getCurrencySymbol(currency),
          route: "/settings/profile"
        },
        {
          key: "financialStatus",
          title: "Financial status",
          detail: `${formatCurrency(profile.currentCash, currency)} cash · ${formatCurrency(
            profile.currentInvestments,
            currency
          )} invested`,
          route: "/settings/financial-status",
          badge: needsInput("/settings/financial-status")
        },
        {
          key: "fireAssumptions",
          title: "FIRE assumptions",
          detail: `Target age ${profile.targetFireAge} · ${formatPercent(
            profile.withdrawalRate,
            1
          )} withdrawal`,
          route: "/settings/fire-assumptions",
          badge: needsInput("/settings/fire-assumptions")
        },
        {
          key: "preferences",
          title: "Risk and learning",
          detail: `${describeExperience(profile.investingExperience)} · ${
            profile.learningTopics.length
          } topics · ${buildReminderSummary(profile)}`,
          route: "/settings/preferences"
        }
      ]
    },
    {
      key: "data",
      title: "Your data",
      entries: [
        {
          key: "marketData",
          title: "Market data",
          detail: marketDataConfigured
            ? "Configured for instrument search and latest prices"
            : "Optional live ETF and stock prices",
          route: "/settings/market-data",
          badge: marketDataConfigured ? { label: "Configured", level: "good" } : undefined
        },
        {
          key: "monthlyUpdate",
          title: "Monthly update",
          detail: "Log this month's income, expenses and balances",
          route: "/settings/monthly-update"
        },
        {
          key: "csvImport",
          title: "CSV import",
          detail: "Bring in holdings or a net worth snapshot",
          route: "/settings/import"
        },
        {
          key: "data",
          title: "Export and reset",
          detail: "Export a report, or erase everything in this browser",
          route: "/settings/data"
        }
      ]
    },
    {
      key: "about",
      title: "About",
      entries: [
        {
          key: "legal",
          title: "Legal disclaimer",
          detail: "Educational calculations only, not financial advice",
          route: "/settings/legal"
        },
        {
          key: "privacy",
          title: "Privacy policy",
          detail: "Opens in a new tab",
          external: true,
          href: "privacy.html"
        },
        {
          key: "terms",
          title: "Terms of use",
          detail: "Opens in a new tab",
          external: true,
          href: "terms.html"
        },
        {
          key: "support",
          title: "Support",
          detail: "Help, contact and data guidance",
          external: true,
          href: "support.html"
        }
      ]
    }
  ];
}

/** Gap routes point at the screen that fixes them, which is exactly a row here. */
function badgeForRoutes(gaps) {
  const routes = new Set(gaps.map((gap) => gap.route));

  return (route) => (routes.has(route) ? { label: "Needs input", level: "watch" } : undefined);
}
