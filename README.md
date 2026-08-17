# FirePath Web

The FirePath FIRE planner as a static, local-first web app. It mirrors the
features and terminology of the FirePath mobile app: onboarding, dashboard,
FIRE planner, portfolio, learn library and settings.

Everything runs in the browser. There is no backend, no account and no external
finance API — all data is stored in `localStorage` on the visitor's own device.

## Structure

```text
index.html        App shell (single page, hash routed)
privacy.html      Standalone privacy policy
styles.css        Design system: tokens, layout, components, responsive rules
app/
  main.js         Entry point: app chrome + route table
  router.js       Hash router (GitHub Pages has no rewrite rules)
  data/           Static content: defaults, article library, shared copy
  domain/         Business logic, ported 1:1 from the mobile app's src/domain
  store/          localStorage persistence and the single app store
  ui/             DOM builder, shared components, toasts/modals
  views/          One module per screen
```

No build step and no dependencies: the browser loads `app/main.js` as an ES
module directly, so the site can be published straight from the branch.

## Local preview

ES modules are blocked over `file://`, so the site needs to be served over
HTTP — opening `index.html` from the filesystem will not work.

```bash
python3 -m http.server 4173
```

Then visit <http://localhost:4173>.

## Pages URL

Enable GitHub Pages from the repository settings and serve from the branch root.

```text
https://<github-username>.github.io/<repository-name>/
```

## Data

Stored under the `firepath.v2.*` keys: `profile`, `holdings`, `transactions`,
`scenarios`, `articles` and `meta`. Data written by the earlier single-page
version (`firepath-web-state-v1`, `firepath-web-holdings-v1`) is migrated
automatically on first load and then removed.

Clearing site data in the browser resets the app; Settings → Export and reset
does the same from inside it, and can export a CSV or PDF summary first.

## Disclaimer

FirePath provides educational information and financial calculations only. It
does not provide investment, tax, legal, or financial advice. Always do your own
research or consult a qualified professional.
