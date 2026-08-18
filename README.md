# FirePath Web

The FirePath FIRE planner as a static, local-first web app. It mirrors the
features and terminology of the FirePath mobile app: onboarding, dashboard,
FIRE planner, portfolio, learn library and settings.

The planning data runs local-first in the browser with no account. An optional
market-data proxy can add real instrument search and latest prices while the
portfolio itself remains stored in `localStorage` on the visitor's device.

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
  views/          One module per screen (portfolio.js owns its five sub-pages)
worker/            Optional Cloudflare Worker market-data proxy
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

## Optional market data

FirePath uses a small Cloudflare Worker so the Twelve Data API key is never
shipped to browsers or committed to the repository. US instruments and exchange
rates use Twelve Data first and retry through Yahoo Finance when the Basic quota
is full or the provider returns no usable data. European and Borsa Istanbul
search, quotes and daily history go directly to Yahoo Finance through the same
Worker. Manual holdings continue to work without this service.

The web app is preconfigured to use:

```text
https://firepath-market-data.sakkarakaya-firepath.workers.dev
```

Users can test, replace or disconnect this endpoint from Settings → Market data.

1. Create a free Twelve Data API key.
2. In `worker/wrangler.toml`, add the production FirePath URL to
   `ALLOWED_ORIGINS` (comma-separated, without a trailing slash).
3. From the `worker` directory, authenticate Wrangler and save the secret:

   ```bash
   npx wrangler login
   npx wrangler secret put TWELVE_DATA_API_KEY
   ```

4. Deploy the proxy and copy the returned `workers.dev` URL:

   ```bash
   npx wrangler deploy
   ```

5. In FirePath, open Settings → Market data, paste the Worker URL, save and test
   the connection.

For local Worker development, copy `worker/.dev.vars.example` to
`worker/.dev.vars`, add the key, and run `npx wrangler dev` from `worker/`.
The real `.dev.vars` file is ignored by git.

The current Twelve Data Basic tier advertises 8 API credits per minute, 800 per
day, with real-time US equities/ETFs, forex and crypto. European and Borsa
Istanbul listings are mapped from their MIC to Yahoo suffixes such as `ASML.AS`
and `THYAO.IS`; they do not consume a Twelve Data quote credit. Yahoo Finance
does not offer this as a supported public developer API, so its endpoints can
change without notice. Before publishing quotes to other users, confirm each
provider's display/redistribution rights or choose an appropriate commercial
plan.

## Data

Stored under the `firepath.v2.*` keys: `profile`, `holdings`, `transactions`,
`scenarios`, `articles`, `marketData`, `portfolioHistory`, `portfolioTransactions`,
`priceSeries` and `meta`.

`portfolioHistory` is one snapshot per day of tracked value and invested amount,
written while the portfolio screens render — there is no broker connection, so
the value charts are built from what this browser has seen.

`priceSeries` caches daily closing bars per instrument as `[date, close]` tuples,
bounded to 32 instruments and roughly six years each. The history screen rebuilds
the portfolio's value backwards from the ledger and these bars, which is what
makes a time-weighted return and a benchmark comparison possible at all.

`portfolioTransactions` is the buy/sell/dividend ledger behind a holding. Lots
are matched first-in-first-out, and a holding's `quantity` and `averageBuyPrice`
are recomputed from its ledger on every change and reconciled again on boot, so
those two fields stay the single thing the rest of the app reads. Holdings
without a ledger keep being entered by hand. Data written by the earlier single-page
version (`firepath-web-state-v1`, `firepath-web-holdings-v1`) is migrated
automatically on first load and then removed.

Clearing site data in the browser resets the app; Settings → Export and reset
does the same from inside it, and can export a CSV or PDF summary first.

When market data is enabled, FirePath sends only instrument search text,
ticker/exchange identifiers and requested currency pairs to the configured
proxy. Quantities, purchase prices, portfolio totals and profile inputs are not
included in market-data requests.

## Disclaimer

FirePath provides educational information and financial calculations only. It
does not provide investment, tax, legal, or financial advice. Always do your own
research or consult a qualified professional.
