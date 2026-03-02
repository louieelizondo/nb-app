# NB System — Complete Project Summary
## Natural Balance Club · Cash Flow & Operations Management
**Last updated:** March 2, 2026

---

## 1. BIG PICTURE

The NB System is a suite of single-page web apps for **Natural Balance Club** (a food/retail store in Mexico) that replaced a Notion-based workflow. Everything is built on:

- **Frontend:** Static HTML/JS/CSS apps hosted on **GitHub Pages** (`louieelizondo.github.io/nb-app/`)
- **Backend:** Google Apps Script (Web App) attached to the `NB_Margenes_Dashboard` Google Spreadsheet
- **Database:** Google Sheets tabs (FACTURAS, INGRESOS, CORTE_TIENDA, CORTES_INDIVIDUALES, INVENTARIO_PRODUCTOS, etc.)
- **Auth:** Google Sign-In (OAuth2) — restricts access to approved emails
- **Photos:** Google Drive folders (`NB_Fotos_Facturas`, `NB_Comprobantes`)

---

## 2. ACCESS CREDENTIALS & URLS

### GitHub Repository
- **Repo:** `https://github.com/louieelizondo/nb-app`
- **GitHub Pages:** `https://louieelizondo.github.io/nb-app/`
- **GitHub PAT:** Stored locally (classic, no expiration, repo scope) — do not commit to repo
- **Push command:** `git push` with PAT auth (see local credentials)

### Google Apps Script (Backend)
- **Deployed Web App URL:** `https://script.google.com/macros/s/AKfycbxQ7BzFITQnxyndvo2q7Xa1-Sc-yX5S8JGRc1mIbd4ye0rSpN2I2qx1zAjzRqbPXNeL/exec`
- **Spreadsheet:** `NB_Margenes_Dashboard` (contains all tabs: FACTURAS, INGRESOS, CORTE_TIENDA, MATERIA PRIMA, INVENTARIO_PRODUCTOS, etc.)
- **Apps Script project files in the editor:**
  - `Código.gs` — main file (same content as `gastos_script.gs` in repo — FACTURAS CRUD, photo storage, inventory, Claude proxy, helpers)
  - `migration.gs` — one-time migration helpers
  - `cortes_ingresos.gs` — cortes, ingresos, dashboard data, monthly summaries, notifications hooks (same as `cortes_ingresos_extension.gs` in repo)
  - `notification_functions.gs` — email notification functions
- **Deploy process (Spanish UI):** Implementar → Administrar implementaciones → Lápiz (editar) → Versión: Nueva versión → Implementar
- **Apps Script editor URL:** `https://script.google.com/u/0/home/projects/1AdENQ3QOvVjzyZ_BDgWEf3c7I-jZ4Z6BNemjsn1MPNCYb0mir9j8Tbv5/edit`

### Google OAuth
- **Client ID:** `934893720921-82k6l5gbm5kt3oq1nti1njitlgennqdl.apps.googleusercontent.com`
- **Authorized origins:** `https://louieelizondo.github.io`, `http://localhost`

### Authorized Emails (can log in to apps)
- `le.nbclub@gmail.com` (Louie — owner)
- `facturacion.nbclub@gmail.com` (store leader / facturación)
- `servicioalcliente.nbclub@gmail.com`
- `adelalvidrez@gmail.com`
- `ing.elizondocardenas@gmail.com`

### Notification Emails
- **Owner (Louie):** `le.nbclub@gmail.com` — receives email when store leader saves Corte de Tienda
- **Store Leader:** `facturacion.nbclub@gmail.com` — receives email when Louie saves Sobre 2 in Registro de Ingresos

---

## 3. ALL WEB APPS (Frontend)

### 3.1 `index.html` — Landing Page / Finance Center
- Navigation hub linking to all apps
- Top nav bar: NB Finance → Dashboard | Ingresos | Gastos | Cortes de Tienda

### 3.2 `dashboard_nb.html` — Dashboard Gerencial
- **URL:** `louieelizondo.github.io/nb-app/dashboard_nb.html`
- Monthly KPIs: Ingresos, Gastos, Neto, Por Facturar, Promedio Diario
- Month rotator (◀ Marzo 2026 ▶) with clickable label → dropdown month picker
- Daily sales bar chart (Chart.js)
- Payment method breakdown (doughnut chart)
- Monthly comparison table with TOTAL row (all 12 months)
- Day-of-week average chart
- Mesa/station sales chart
- **Optimized:** 2 API calls (was 4) — `get_dashboard_data` + `get_payment_trends`
- KPIs derived from dashboard monthly data on frontend (no separate `get_monthly_summary`)
- Mesa sales included in `getDashboardData` response (no separate `get_mesa_sales`)

### 3.3 `nb_portal_pagos.html` — Portal de Pagos (Gastos/Facturas)
- **URL:** `louieelizondo.github.io/nb-app/nb_portal_pagos.html`
- View/filter all invoices from FACTURAS tab
- Month rotator with dropdown picker (earth tone theme)
- Filter chips: Pendientes → Sin fecha → Vencidos → Pagados → Todos (default: Pendientes)
- Inline edit, status changes, date scheduling
- Comprobante PDF upload to Google Drive

### 3.4 `nb_captura_facturas_v2.html` — Captura de Facturas
- **URL:** `louieelizondo.github.io/nb-app/nb_captura_facturas_v2.html`
- Camera capture → Claude AI vision analysis (via server-side proxy)
- Auto-extracts: proveedor, folio, monto, items, etc.
- Price sync to MATERIA PRIMA tab (column C = CostoPaq)
- Ingredient rename/mapping
- Photo upload to Google Drive (full-res + thumbnail)

### 3.5 `corte_caja.html` — Corte de Caja (Store Cash Cuts)
- **URL:** `louieelizondo.github.io/nb-app/corte_caja.html`
- Individual register cuts (denomination counting)
- Consolidated store cut (Corte de Tienda)
- Caja selector: 4 cajas + 2 repartidores (hardcoded DEFAULT_CAJAS fallback)
- Required field validation (fecha, colaborador, caja, ventas, efectivo > 0)
- Email notification to owner on save (notifyOwner flag)
- Faltante/Sobrante calculation

### 3.6 `registro_ingresos.html` — Registro de Ingresos
- **URL:** `louieelizondo.github.io/nb-app/registro_ingresos.html`
- Daily income registration (one row per day in INGRESOS tab)
- Sobre 2 breakdown (Socios + Nóminas)
- Deposit calculation (PagosRecibidos - Sobre2)
- Invoicing tracking (FactClientes, FactGen1-6, CFDI)
- Mesa/station sales for employee productivity
- Email notification to store leader on Sobre 2 save (notifyLeader flag)

### 3.7 `portal_finanzas.html` — Portal de Finanzas
- **URL:** `louieelizondo.github.io/nb-app/portal_finanzas.html`
- Financial overview/reporting portal

### 3.8 `nb_inventario.html` — Inventario
- **URL:** `louieelizondo.github.io/nb-app/nb_inventario.html`
- Product catalog from INVENTARIO_PRODUCTOS tab
- Section-by-section counting
- Count history logging (INVENTARIO_LOG tab, trimmed to 10K rows)
- Order tracking (PEDIDOS_LOG tab)
- Variantes support (optional, replaces old Grupo/Presentacion)

---

## 4. BACKEND (Apps Script) — Key Functions & Routing

### doGet actions (gastos_script.gs / Código.gs):
- `list` — list facturas with filters
- `get` — get single factura by ID
- `list_products` — inventory products
- `list_orders` — pedidos
- `health` — health check

### doPost actions (gastos_script.gs / Código.gs):
- `create` — create factura
- `update_status` — change factura estado + comprobante
- `update_date` — change fecha_pago
- `delete` — delete factura
- `update_factura` — inline edit fields
- `claude_analyze` — Claude vision proxy (API key in Script Properties)
- `update_prices` — sync prices to MATERIA PRIMA
- `rename_ingredient` — rename in MATERIA PRIMA
- `add_product` / `toggle_product` / `update_product` — inventory CRUD
- `log_inventory` — save inventory counts
- `save_order` / `update_order` — pedidos
- `audit` — cross-app audit trail
- `sync_batch` — process multiple queued operations

### doGet actions (patched via doGet_doPost_patch.gs):
- `get_cortes_dia` — individual register cuts for a date
- `get_corte_tienda` — consolidated store cut for a date
- `get_config_cajas` — register configuration
- `get_ingresos` — daily income records
- `get_monthly_summary` — monthly KPI summary
- `get_dashboard_data` — full dashboard data (monthly, daily, mesa, day-of-week)
- `get_payment_trends` — weekly payment trends
- `get_mesa_sales` — station sales breakdown
- `get_faltante_history` — employee accuracy history
- `get_arqueos` — petty cash records
- `get_transferencias` — transfer log

### doPost actions (patched):
- `save_corte_individual` — save register cut
- `delete_corte_individual` — delete register cut
- `save_corte_tienda` — save/update consolidated cut + notification
- `save_arqueo` — save petty cash reconciliation
- `save_transferencia` — log transfer
- `save_ingreso` — save/update daily income + notification
- `update_sobre2` — update Sobre 2 breakdown
- `update_facturacion` — update invoicing fields
- `update_neto_mensual` — update monthly summary
- `update_config_cajas` — update register config
- `sync_shopify_daily` — Shopify POS sync (requires SHOPIFY_TOKEN + SHOPIFY_STORE in Script Properties)

---

## 5. GOOGLE SHEETS TABS

| Tab | Purpose |
|-----|---------|
| FACTURAS | All invoices/expenses (gastos) |
| MATERIA PRIMA | Ingredient costs & pricing |
| INGRESOS | Daily income (one row per day) |
| CORTES_INDIVIDUALES | Per-register denomination counts |
| CORTE_TIENDA | Daily consolidated store cut |
| ARQUEO_CAJA | Petty cash reconciliation |
| TRANSFERENCIAS_LOG | Daily transfer records |
| NETO_MENSUAL | Monthly income - expenses summary |
| CONFIG_CAJAS | Dynamic register configuration |
| INVENTARIO_PRODUCTOS | Product catalog |
| INVENTARIO_LOG | Count history (trimmed to 10K rows) |
| PEDIDOS_LOG | Order tracking |
| AUDIT_LOG | Cross-app audit trail (trimmed to 5K rows) |
| LOG | Operation log (trimmed to 500 rows) |

---

## 6. KEY TECHNICAL PATTERNS

### Month Rotator (shared pattern across Dashboard + Portal de Pagos)
- State: `viewMonth` (0-based), `viewYear`, `pickerYear`
- Functions: `shiftMonth(dir)`, `goToday()`, `toggleMonthPicker()`, `pickerShiftYear(dir)`, `renderMonthGrid()`
- `getCurrentMonthYear()` reads from rotator state
- Dashboard: white-on-green theme. Portal de Pagos: earth tone theme

### Date Handling (critical bug area)
- Google Sheets returns Date objects for date cells
- `String(dateObj)` gives "Fri Feb 27 2026..." — NOT "2026-02-27"
- Always use `formatDateStr()` which handles both Date objects and strings
- `formatDateStr` uses `Utilities.formatDate(val, 'America/Mexico_City', 'yyyy-MM-dd')`

### Notification System
- `notifyOwnerCorteReady()` — emails Louie when store leader saves Corte de Tienda
- `notifyLeaderSobre2Ready()` — emails store leader when Louie saves Sobre 2
- Uses `GmailApp.sendEmail()` with HTML body (green NB branding)
- Triggered by `notifyOwner: true` / `notifyLeader: true` flags in POST body
- First time: Google will prompt for Gmail permissions in Apps Script

### Version Conflict Detection
- FACTURAS have a `Version` column (integer, starts at 1)
- `checkVersionAndBump()` compares client version vs sheet version
- Returns conflict response if versions don't match (prevents concurrent edit overwrites)

### Sync Queue
- Frontend has offline queue (localStorage) for when API is unreachable
- `sync_batch` action processes multiple queued operations at once
- Queue items have `queue_id` for tracking

### Auth Flow
- Google Sign-In button → OAuth → checks email against allowed list
- Token stored in sessionStorage
- All apps gate behind auth (except public landing page)

---

## 7. WHAT WE FIXED/BUILT IN THIS SESSION

1. **Month rotator** — replaced year/month dropdowns on Dashboard with ◀ Month ▶ rotator + clickable month picker dropdown
2. **Standardized Portal de Pagos** — added matching month picker dropdown
3. **Notification emails** — wired email triggers for Corte de Tienda → owner and Sobre 2 → leader
4. **Caja selector fix** — added DEFAULT_CAJAS fallback (4 cajas + 2 repartidores)
5. **Field validation** — required fields before saving Corte de Caja
6. **Totals row** — added to Dashboard monthly comparison table
7. **Filter chip reorder** — Portal de Pagos: Pendientes → Sin fecha → Vencidos → Pagados → Todos
8. **Gastos $0 fix** — `String(r.Fecha_Compra)` → `formatDateStr(r.Fecha_Compra)` in getDashboardData and getMonthlySummary
9. **March gastos ghost fix** — removed `Fecha_Pago` from getMonthlySummary filter (gastos count by purchase date only)
10. **Dashboard performance** — cut from 4 API calls to 2 (derive KPIs + mesa from getDashboardData)
11. **Responsive design (Phase 1)** — Added responsive CSS breakpoints to all 6 apps:
    - `nb_inventario.html`: Expanded from 500px mobile-only to full responsive (768px tablet, 1024px desktop, 1280px wide). 2-col section cards on desktop, 3-col route cards, wider product management.
    - `dashboard_nb.html`: Enhanced 480px small phone breakpoint, payment-grid stacking on tablet, desktop `charts-grid` class for side-by-side charts, scroll indicators on monthly table.
    - `nb_portal_pagos.html`: Added 480px small phone breakpoint (1-col summary cards, tighter spacing, full-width modal).
    - `nb_captura_facturas_v2.html`: Added tablet (641-1024px), desktop (1025px+) with wider containers/previews, and 420px small phone breakpoint.
    - `corte_caja.html`: Added 480px small phone breakpoint.
    - `registro_ingresos.html`: Added 480px small phone breakpoint.

---

## 8. KNOWN PENDING ITEMS

- [x] **Responsive design / mobile optimization** — Phase 1 complete (CSS breakpoints for all apps)
- [ ] **Responsive Phase 2** — Visual QA on real devices, fine-tune touch targets, test charts on mobile
- [ ] **Corte de Caja editability** — user asked if saved cortes should be editable (not yet implemented)
- [ ] **Notification test** — first notification trigger will prompt for Gmail permissions
- [ ] **Shopify POS integration** — code exists but needs SHOPIFY_TOKEN + SHOPIFY_STORE in Script Properties
- [ ] **CLAUDE_API_KEY** — needs to be set in Script Properties for invoice photo analysis
- [ ] **Portal de Finanzas** — exists but unclear current state/completeness
