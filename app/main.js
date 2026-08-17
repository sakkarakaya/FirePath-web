import { defineRoute, getPath, href, setNotFound, startRouter } from "./router.js";
import { getState, initStore, subscribe } from "./store/store.js";
import { Button, Card, EmptyState } from "./ui/components.js";
import { clear, h, mount } from "./ui/dom.js";
import { DashboardView } from "./views/dashboard.js";
import { FireView } from "./views/fire.js";
import { ArticleView, LearnView } from "./views/learn.js";
import { OnboardingSummaryView, OnboardingView, WelcomeView } from "./views/onboarding.js";
import { PortfolioView } from "./views/portfolio.js";
import {
  DataSettingsView,
  FinancialStatusSettingsView,
  FireAssumptionsSettingsView,
  ImportSettingsView,
  LegalSettingsView,
  MarketDataSettingsView,
  MonthlyUpdateSettingsView,
  PreferencesSettingsView,
  ProfileSettingsView,
  SettingsView
} from "./views/settings.js";

/**
 * Application entry point.
 *
 * Owns the shell (navigation chrome) and the route table. Views are plain
 * functions returning DOM, re-invoked whenever the store changes — small enough
 * that a full subtree swap is cheaper than diffing, and it keeps every view
 * free of lifecycle bookkeeping.
 */

const NAV_ITEMS = [
  { route: "/dashboard", label: "Dashboard", icon: "◈" },
  { route: "/fire", label: "FIRE", icon: "◎" },
  { route: "/portfolio", label: "Portfolio", icon: "◫" },
  { route: "/learn", label: "Learn", icon: "◇" },
  { route: "/settings", label: "Settings", icon: "⚙" }
];

/** Routes that own the full viewport and hide the app chrome. */
const CHROMELESS = new Set(["/", "/onboarding", "/onboarding/summary"]);

let currentRender = null;

const root = document.getElementById("root");

function render() {
  if (!currentRender) {
    return;
  }

  const path = getPath();
  const view = currentRender();

  if (CHROMELESS.has(path)) {
    mount(root, view);
    return;
  }

  mount(root, Shell({ path, view }));
}

function Shell({ path, view }) {
  return h("div", { class: "app" }, [
    Sidebar({ path }),
    Topbar(),
    h("main", { class: "main", id: "main" }, [view]),
    Tabbar({ path })
  ]);
}

function Sidebar({ path }) {
  const { profile } = getState();

  return h("aside", { class: "sidebar" }, [
    h("a", { class: "brand", href: href("/dashboard"), "aria-label": "FirePath dashboard" }, [
      h("img", { src: "assets/icon.png", alt: "", width: "34", height: "34" }),
      h("span", { text: "FirePath" })
    ]),
    h(
      "nav",
      { class: "nav", "aria-label": "Primary" },
      NAV_ITEMS.map((item) => NavLink({ item, path }))
    ),
    h("div", { class: "sidebar__footer" }, [
      profile ? h("span", { text: `Base currency ${profile.currency}` }) : null,
      h("a", { href: "privacy.html", target: "_blank", rel: "noopener noreferrer", text: "Privacy policy" }),
      h("a", { href: "terms.html", target: "_blank", rel: "noopener noreferrer", text: "Terms of use" }),
      h("a", { href: "support.html", target: "_blank", rel: "noopener noreferrer", text: "Support" }),
      h("span", { text: "Educational calculations only. Not financial advice." })
    ])
  ]);
}

function NavLink({ item, path }) {
  const isActive = path === item.route || path.startsWith(`${item.route}/`);

  return h(
    "a",
    {
      class: `nav__link ${isActive ? "is-active" : ""}`.trim(),
      href: href(item.route),
      "aria-current": isActive ? "page" : null
    },
    [h("span", { class: "nav__icon", "aria-hidden": "true", text: item.icon }), h("span", { text: item.label })]
  );
}

function Topbar() {
  return h("header", { class: "topbar" }, [
    h("a", { class: "brand", href: href("/dashboard"), "aria-label": "FirePath dashboard" }, [
      h("img", { src: "assets/icon.png", alt: "", width: "30", height: "30" }),
      h("span", { text: "FirePath" })
    ])
  ]);
}

function Tabbar({ path }) {
  return h(
    "nav",
    { class: "tabbar", "aria-label": "Primary" },
    NAV_ITEMS.map((item) => {
      const isActive = path === item.route || path.startsWith(`${item.route}/`);

      return h(
        "a",
        {
          class: `tabbar__link ${isActive ? "is-active" : ""}`.trim(),
          href: href(item.route),
          "aria-current": isActive ? "page" : null
        },
        [
          h("span", { class: "tabbar__icon", "aria-hidden": "true", text: item.icon }),
          h("span", { text: item.label })
        ]
      );
    })
  );
}

/** Registers a route whose view is re-rendered on every store change. */
function route(pattern, viewFactory) {
  defineRoute(pattern, (context) => {
    currentRender = () => viewFactory(context);
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  });
}

/**
 * The landing route sends returning visitors straight to their dashboard, and
 * shows the welcome screen only when there is no saved plan.
 */
route("/", () => (getState().profile ? DashboardView() : WelcomeView()));
route("/onboarding", () => OnboardingView());
route("/onboarding/summary", () => OnboardingSummaryView());
route("/dashboard", () => DashboardView());
route("/fire", () => FireView());
route("/portfolio", () => PortfolioView());
route("/learn", () => LearnView());
route("/learn/:id", (context) => ArticleView(context));
route("/settings", () => SettingsView());
route("/settings/profile", () => ProfileSettingsView());
route("/settings/financial-status", () => FinancialStatusSettingsView());
route("/settings/fire-assumptions", () => FireAssumptionsSettingsView());
route("/settings/preferences", () => PreferencesSettingsView());
route("/settings/monthly-update", () => MonthlyUpdateSettingsView());
route("/settings/market-data", () => MarketDataSettingsView());
route("/settings/import", () => ImportSettingsView());
route("/settings/data", () => DataSettingsView());
route("/settings/legal", () => LegalSettingsView());

setNotFound(() => {
  currentRender = () =>
    h("div", { class: "view" }, [
      Card({}, [
        EmptyState({
          icon: "◇",
          title: "Page not found",
          description: "That link does not match any screen in FirePath.",
          action: Button({ to: "/dashboard", variant: "primary" }, "Back to dashboard")
        })
      ])
    ]);
  render();
});

// Views mutate module-level UI state (a filter, a sandbox draft) without
// touching the store, and ask for a repaint through this event.
window.addEventListener("firepath:rerender", render);

subscribe(render);

let bootFailed = false;

try {
  initStore();
} catch (error) {
  bootFailed = true;
  clear(root);
  root.appendChild(
    h("div", { class: "view" }, [
      Card({}, [
        EmptyState({
          icon: "⚠",
          title: "FirePath could not start",
          description:
            error instanceof Error
              ? error.message
              : "Stored data in this browser could not be read. Clearing site data will reset the app."
        })
      ])
    ])
  );
}

if (!bootFailed) {
  // A bare URL keeps the address bar honest about which screen is showing.
  if (!window.location.hash) {
    window.location.replace(getState().profile ? "#/dashboard" : "#/");
  }

  startRouter();
}
