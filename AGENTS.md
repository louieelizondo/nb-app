# AGENTS.md

## Cursor Cloud specific instructions

This repo (`nb-app`) is a **static frontend + Google Apps Script** project — there is
**no build step, no package manager, no lockfile, and no test/lint tooling**. See
`README.md` and `NB_PROJECT_CONTEXT.md` for the product overview and architecture.

### Architecture (what runs where)
- **Frontend:** standalone `*.html` files plus `nb-brand.css` and `nb_auth.js`, served
  as-is from GitHub Pages (`louieelizondo.github.io/nb-app/`). No bundling/transpiling.
- **Backend:** a single Google Apps Script project (the `*.gs` files). It is cloud-only
  and **cannot run locally**; it is deployed by pasting file contents into the Apps Script
  editor (see `DEPLOY_INSTRUCTIONS.md`, `BONO_PRODUCTIVIDAD_DEPLOY.md`).
- **Database:** Google Sheets. **Auth:** Google OAuth2 (allow-list in `nb_auth.js`).

### Running locally (dev)
- The only locally runnable piece is the static frontend. Serve the repo root with any
  static server, e.g. `python3 -m http.server 8000`, then open
  `http://localhost:8000/<page>.html`. `python3` is pre-installed; nothing to install.
- Most pages call a **hardcoded production** Apps Script Web App URL and are gated by a
  Google Sign-In overlay (`nb_auth.js`) that only admits the allow-listed Gmail accounts.
  Without an allow-listed Google login you will see the auth overlay and data calls will
  not return. **Do not write to the production backend/Sheet during testing.**

### Self-contained pages (no auth, no backend — safe to test fully offline)
- `nomina.html` — payroll cash-denomination calculator. Pure client-side; great smoke
  test (enter salaries → "Calcular desglose" → bill/coin breakdown + totals).
- Other denomination/print views are largely client-side too, but several pages
  (dashboard, ingresos, gastos, cortes, inventario, permisos) require the live backend +
  Google login to show data.

### Lint / test / build
- None exist. There is no linter, no test suite, and no build/dev script in this repo.
- Deployment is manual (GitHub Pages for frontend; Apps Script editor for `*.gs`).

### Gotchas
- `*_merged.gs`, `*_PASTE_THIS.gs`, and the `codigo.gs` vs `gastos_script.gs` pairs are
  copy/paste deploy snapshots/variants — they are not separate modules; edit the file the
  deploy docs point at.
- `nb_auth.js` allows overriding the OAuth client id via `localStorage` key
  `nb_google_client_id`; some pages allow overriding the backend URL via `nb_script_url`.
