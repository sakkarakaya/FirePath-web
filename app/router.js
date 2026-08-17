/**
 * Hash router.
 *
 * GitHub Pages serves static files with no rewrite rules, so a history-API
 * router would 404 on refresh or on a shared deep link. Hash routes keep every
 * screen linkable and bookmarkable without server configuration.
 */

const routes = [];
let notFoundHandler = null;
let currentPath = null;

export function defineRoute(pattern, handler) {
  routes.push({ pattern, matcher: buildMatcher(pattern), handler });
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

/** Turns "/learn/:id" into a regex plus the parameter names it captures. */
function buildMatcher(pattern) {
  const names = [];
  const source = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return { regex: new RegExp(`^/${source}/?$`), names };
}

export function getPath() {
  const hash = window.location.hash.slice(1);
  const path = hash.split("?")[0];
  return path.startsWith("/") ? path : `/${path}`;
}

export function getQuery() {
  const hash = window.location.hash.slice(1);
  const queryString = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(queryString);
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;

  if (window.location.hash === target) {
    resolve();
    return;
  }

  if (replace) {
    window.location.replace(target);
  } else {
    window.location.hash = target;
  }
}

/** Href for anchors, so links stay real links and open in a new tab correctly. */
export function href(path) {
  return `#${path}`;
}

export function startRouter() {
  window.addEventListener("hashchange", resolve);
  resolve();
}

export function currentRoute() {
  return currentPath;
}

function resolve() {
  const path = getPath();
  currentPath = path;

  for (const route of routes) {
    const match = path.match(route.matcher.regex);

    if (match) {
      const params = {};
      route.matcher.names.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });

      route.handler({ params, query: getQuery(), path });
      return;
    }
  }

  if (notFoundHandler) {
    notFoundHandler({ params: {}, query: getQuery(), path });
  }
}
