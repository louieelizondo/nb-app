# NB System — Full Project Context
## Natural Balance Club · Cash Flow & Operations Management
**Owner:** Louie Elizondo (`le.nbclub@gmail.com`)
**Last updated:** March 2, 2026
**Status:** Phase 3 — All apps live, responsive design complete, verified on desktop

---

## 1. WHAT THIS IS

A suite of single-page web apps for **Natural Balance Club** (food/retail store in Mexico) that replaced a Notion-based workflow. Manages daily cash flow, supplier expenses, inventory, invoicing, and financial reporting.

**Tech Stack:**
- **Frontend:** Static HTML/JS/CSS on **GitHub Pages** — all apps are single-file, no build process
- **Backend:** Google Apps Script (Web App)
- **Database:** Google Sheets (`NB_Margenes_Dashboard`)
- **Auth:** Google Sign-In (OAuth2) restricted to approved emails
- **Photos:** Google Drive folders (`NB_Fotos_Facturas`, `NB_Comprobantes`)

---

## 2. ACCESS & CREDENTIALS

### GitHub
- **Repo:** `https://github.com/louieelizondo/nb-app`
- **GitHub Pages:** `https://louieelizondo.github.io/nb-app/`
- **PAT:** Stored locally (classic, no expiration, repo scope) — NEVER commit to repo
- **Push:** `git push https://louieelizondo:<PAT>@github.com/louieelizondo/nb-app.git main`
- **⚠️ NEVER commit the PAT to the repo** — GitHub push protection will block it

### Google Apps Script (Backend)
- **Web App URL:** `https://script.google.com/macros/s/AKfycbxQ7BzFITQnxyndvo2q7Xa1-Sc-yX5S8JGRc1mIbd4ye0rSpN2I2qx1zAjzRqbPXNeL/exec`
- **Editor URL:** `https://script.google.com/u/0/home/projects/1AdENQ3QOvVjzyZ_BDgWEf3c7I-jZ4Z6BNemjsn1MPNCYb0mir9j8Tbv5/edit`
- **Files in editor (Spanish UI):**
  - `Código.gs` — main (FACTURAS CRUD, photo storage, inventory, Claude proxy, helpers)
  - `migration.gs` — one-time migration helpers
  - `cortes_ingresos.gs` — cortes, ingresos, dashboard data, monthly summaries, notification hooks
  - `notification_functions.gs` — email notification functions
- **Deploy (Spanish):** Implementar → Administrar implementaciones → Lápiz → Versión: Nueva versión → Implementar

### Google OAuth
- **Client ID:** `934893720921-82k6l5gbm5kt3oq1nti1njitlgennqdl.apps.googleusercontent.com`
- **Authorized origins:** `https://louieelizondo.github.io`, `http://localhost`

### Authorized Users
| Email | Role |
|-------|------|
| `le.nbclub@gmail.com` | Owner (Louie) |
| `facturacion.nbclub@gmail.com` | Store leader / facturación |
| `servicioalcliente.nbclub@gmail.com` | Customer service |
| `adelalvidrez@gmail.com` | Staff |
| `ing.elizondocardenas@gmail.com` | Staff |

### Notification Emails
- **Corte de Tienda saved** → emails owner (`le.nbclub@gmail.com`)
- **Sobre 2 saved** → emails store leader (`facturacion.nbclub@gmail.com`)

---

## 3. ALL WEB APPS

### 3.1 `index.html` — Landing Page / Finance Center
- Navigation hub with top bar: NB Finance → Dashboard | Ingresos | Gastos | Cortes de Tienda

### 3.2 `dashboard_nb.html` — Dashboard Gerencial
- **URL:** `louieelizondo.github.io/nb-app/dashboard_nb.html`
- Monthly KPIs: Ingresos, Gastos, Neto, Por Facturar, Promedio Diario
- Month rotator (◀ Marzo 2026 ▶) with clickable label → dropdown month picker
- Charts: Daily sales bar (Chart.js), payment method doughnut, day-of-week averages, mesa/station sales
- Sections 4-5 (Day of Week + Mesa) wrapped in `charts-grid` for side-by-side on 1200px+ desktop
- Monthly comparison table with TOTAL row
- **Optimized:** 2 API calls total — `get_dashboard_data` + `get_payment_trends`
- Print-friendly CSS

### 3.3 `nb_portal_pagos.html` — Portal de Pagos (Supplier Expenses)
- **URL:** `louieelizondo.github.io/nb-app/nb_portal_pagos.html`
- View/filter all invoices from FACTURAS tab
- Filter chips: Pendientes → Sin fecha → Vencidos → Pagados → Todos (default: Pendientes)
- Table→card layout on mobile
- Inline edit, status changes, comprobante PDF upload

### 3.4 `nb_captura_facturas_v2.html` — Captura de Facturas
- **URL:** `louieelizondo.github.io/nb-app/nb_captura_facturas_v2.html`
- Camera capture → Claude AI vision analysis (via server-side proxy)
- Auto-extracts: proveedor, folio, monto, items
- Price sync to MATERIA PRIMA (column C = CostoPaq)
- Photo upload to Google Drive (full-res + thumbnail)

### 3.5 `corte_caja.html` — Corte de Caja
- **URL:** `louieelizondo.github.io/nb-app/corte_caja.html`
- Individual register cuts with denomination counting (bills + coins)
- Consolidated store cut (Corte de Tienda)
- Caja selector: 4 cajas + 2 repartidores (DEFAULT_CAJAS fallback)
- Required field validation (fecha, colaborador, caja, ventas, efectivo > 0)
- Faltante/Sobrante calculation
- Email notification to owner on save

### 3.6 `registro_ingresos.html` — Registro de Ingresos
- **URL:** `louieelizondo.github.io/nb-app/registro_ingresos.html`
- Daily income registration (one row per day in INGRESOS)
- Payment breakdown: VentasDia, PagosRecibidos, Tarjeta, Transferencias, Cashback
- Sobre 2 = Socios + Nóminas (cash set aside, never hits bank)
- DepositoBBVA = PagosRecibidos - Sobre2
- Mesa/station sales (16 stations)
- Invoicing: FactClientes, FactGen1-6, CFDI
- Email notification to store leader on Sobre 2 save

### 3.7 `portal_finanzas.html` — Portal de Finanzas
- Financial overview portal (exists, unclear completeness)

### 3.8 `nb_inventario.html` — Inventario
- **URL:** `louieelizondo.github.io/nb-app/nb_inventario.html`
- Product catalog from **MATERIA PRIMA** tab (columns A-W)
- Section-by-section counting with stepper inputs + unit labels (Unidad_Conteo)
- Full product names (no truncation), unit shown next to stepper
- Count history (INVENTARIO_LOG, trimmed to 10K rows)
- **Shopping list per supplier** — each supplier is a collapsible card with:
  - Editable quantities (tap to override)
  - WhatsApp send per supplier (not whole list)
  - "Comprado" per supplier (sets inventory to max, saves to sheet)
  - "Discard" per supplier (removes from view without saving)
- **Unit conversion**: Unidad_Conteo → Unidad_Compra via Factor_Conversion (col W)
  - Shopping list shows purchase units (e.g., "2 Cajas" instead of "24 Pza")
  - Factor default = 1 when units match or column is blank
- Order tracking (PEDIDOS_LOG)

---

## 4. BACKEND ROUTES

### doGet actions (Código.gs):
`list`, `get`, `list_products`, `list_orders`, `health`

### doPost actions (Código.gs):
`create`, `update_status`, `update_date`, `delete`, `update_factura`, `claude_analyze`, `update_prices`, `rename_ingredient`, `add_product`, `toggle_product`, `update_product`, `log_inventory`, `save_order`, `update_order`, `audit`, `sync_batch`

### doGet actions (cortes_ingresos.gs):
`get_cortes_dia`, `get_corte_tienda`, `get_config_cajas`, `get_ingresos`, `get_monthly_summary`, `get_dashboard_data`, `get_payment_trends`, `get_mesa_sales`, `get_faltante_history`, `get_arqueos`, `get_transferencias`

### doPost actions (cortes_ingresos.gs):
`save_corte_individual`, `delete_corte_individual`, `save_corte_tienda`, `save_arqueo`, `save_transferencia`, `save_ingreso`, `update_sobre2`, `update_facturacion`, `update_neto_mensual`, `update_config_cajas`, `sync_shopify_daily`

---

## 5. GOOGLE SHEETS TABS

| Tab | Purpose |
|-----|---------|
| FACTURAS | Supplier invoices/expenses (~4,920 rows) |
| MATERIA PRIMA | Ingredient costs, pricing & inventory (A-W: Ingrediente, Proveedor A/B, costs, units, margins, Área(N), Ubicación(O), Inv_Max(P), Unidad_Conteo(Q), Unidad_Compra(R), Inv_Actual(S), Fecha_Conteo(T), Forma_Pedido(U), Activo(V), Factor_Conversion(W)) |
| INGRESOS | Daily income (one row per day, 357+ rows) |
| CORTES_INDIVIDUALES | Per-register denomination counts |
| CORTE_TIENDA | Daily consolidated store cut |
| ARQUEO_CAJA | Petty cash reconciliation |
| TRANSFERENCIAS_LOG | Bank transfer records |
| NETO_MENSUAL | Monthly income - expenses |
| CONFIG_CAJAS | Dynamic register configuration |
| INVENTARIO_PRODUCTOS | Product catalog |
| INVENTARIO_LOG | Count history (trimmed 10K) |
| PEDIDOS_LOG | Order tracking |
| AUDIT_LOG | Cross-app audit trail (trimmed 5K) |
| LOG | Operation log (trimmed 500) |

---

## 6. KEY BUSINESS LOGIC

- **Sobre 2** = Cash set aside daily for partners (2ndoSocios) + payroll (2ndoNominas). Never hits the bank.
- **DepositoBBVA** = PagosRecibidos - Sobre2 → What gets deposited.
- **FaltaFactura** = TotalXFacturar - TotalFacturado → SAT compliance gap. Must trend → zero.
- **Faltante/Sobrante** = TotalEfectivo (counted) - Expected Cash → Register discrepancy per cashier.
- **Cashback** = Shopify "store credit" / "crédito en tienda". Single column in INGRESOS; kept as StoreCredit in POS-level tabs.

---

## 7. KEY TECHNICAL PATTERNS

### Date Handling (CRITICAL — past bug area)
- Google Sheets returns Date objects for date cells
- `String(dateObj)` → "Fri Feb 27 2026..." — WRONG
- Always use `formatDateStr()` → `Utilities.formatDate(val, 'America/Mexico_City', 'yyyy-MM-dd')`

### Month Rotator (shared: Dashboard + Portal de Pagos)
- State: `viewMonth` (0-based), `viewYear`, `pickerYear`
- Functions: `shiftMonth(dir)`, `goToday()`, `toggleMonthPicker()`, `pickerShiftYear(dir)`, `renderMonthGrid()`

### Version Conflict Detection (FACTURAS)
- `Version` column (integer, starts at 1)
- `checkVersionAndBump()` prevents concurrent edit overwrites

### Sync Queue (offline support)
- Frontend localStorage queue when API is unreachable
- `sync_batch` action processes multiple queued ops

### Auth Flow
- Google Sign-In → OAuth → email check against allowed list → sessionStorage token

### Responsive Design (completed March 2, 2026)
- Breakpoints: 480px (small phone), 768px (tablet), 1024px (desktop), 1280px (wide)
- `nb_inventario`: expanded from locked 500px to fluid responsive
- `dashboard_nb`: charts-grid (side-by-side on 1200px+), payment-grid stacking
- All 6 apps have mobile/tablet/desktop breakpoints

---

## 8. REPO FILES

| File | Type | Status |
|------|------|--------|
| `index.html` | Landing page | ✅ Live |
| `dashboard_nb.html` | Dashboard | ✅ Live |
| `nb_portal_pagos.html` | Supplier payments | ✅ Live |
| `nb_captura_facturas_v2.html` | Invoice capture | ✅ Live |
| `corte_caja.html` | Cash register cuts | ✅ Live |
| `registro_ingresos.html` | Daily income | ✅ Live |
| `nb_inventario.html` | Inventory | ✅ Live |
| `portal_finanzas.html` | Finance portal | ✅ Live |
| `nb_auth.js` | Shared auth module | ✅ Live |
| `gastos_script.gs` | Main backend (=Código.gs) | ✅ Deployed |
| `cortes_ingresos_extension.gs` | Extended backend | ✅ Deployed |
| `notification_functions.gs` | Email notifications | ✅ Deployed |
| `migration_import.gs` | Data migration | ✅ Done |
| `doGet_doPost_patch.gs` | Route patches reference | ✅ Applied |
| `sync_batch_patch.gs` | Offline sync patch | ⏳ Not applied |

---

## 9. COMPLETED MILESTONES

1. ✅ Gastos system (Captura + Portal de Pagos) — fully operational
2. ✅ Historical data migration (4,916 gastos + 357 ingresos from Notion)
3. ✅ Backend extension — cortes_ingresos.gs with 22 new routes
4. ✅ Inventory system — product catalog, counting, orders
5. ✅ Corte de Caja — denomination counting, store consolidation
6. ✅ Registro de Ingresos — daily income, Sobre 2, invoicing, mesa sales
7. ✅ Dashboard — KPIs, charts, monthly comparison, optimized to 2 API calls
8. ✅ GitHub Pages deployment — all apps live with shared nav
9. ✅ Notification system — email triggers for Corte de Tienda + Sobre 2
10. ✅ Responsive design — all 6 apps mobile/tablet/desktop optimized

---

## 10. PENDING / NEXT UP

- [ ] **Responsive Phase 2** — Visual QA on real devices, fine-tune touch targets, test charts on mobile
- [ ] **Corte de Caja editability** — user asked if saved cortes should be editable
- [ ] **Notification test** — first trigger will prompt for Gmail permissions in Apps Script
- [ ] **Shopify POS integration** — code exists, needs SHOPIFY_TOKEN + SHOPIFY_STORE in Script Properties
- [ ] **CLAUDE_API_KEY** — needs to be set in Script Properties for invoice photo analysis
- [ ] **Portal de Finanzas** — exists but unclear completeness
- [ ] **sync_batch_patch** — offline support for cortes/ingresos (patch file ready)
- [ ] **Arqueo de Caja** — petty cash web app (backend ready)
- [ ] **Transferencias Log** — bank transfers web app (backend ready)
- [ ] **Config Cajas UI** — manage registers without editing the sheet

---

## 11. RECENT GIT HISTORY

```
27439e0 Wire charts-grid class to HTML for side-by-side charts on wide desktop
4038321 Update project summaries: responsive design complete, deployment status current
bdd7935 Responsive design: mobile/tablet/desktop optimization for all apps
20191c9 perf: cut Dashboard from 4 API calls to 2 + fix March gastos bug
30fe5a1 fix: Gastos showing $0 — use formatDateStr instead of String for date filtering
38d697e fix: caja selector, field validation, totals row, filter reorder
f88a094 feat: wire notification emails for Corte de Tienda workflow
9fb5056 feat: standardized month rotator across Dashboard and Portal de Pagos
3ef2456 Reorder nav + rename tabs + fix daily sales chart
b6da48a Add Finance Center: nav bar, auth gates, landing page + new apps
```

---

## 12. BUGS FIXED (for context on past pitfalls)

1. **Gastos $0 on Dashboard** — `String(r.Fecha_Compra)` → `formatDateStr(r.Fecha_Compra)` in getDashboardData/getMonthlySummary
2. **March gastos ghost** — removed `Fecha_Pago` from getMonthlySummary filter (count by purchase date only)
3. **charts-grid dead code** — CSS existed but no HTML wrapper; wired Sections 4-5 into `.charts-grid` div

---

## 13. DETAILED COLUMN SCHEMAS

### FACTURAS Tab (Expenses)
| Column | Type | Notes |
|--------|------|-------|
| ID | String | Unique identifier |
| Folio | String | Invoice/receipt number |
| Proveedor | String | Normalized supplier name |
| Proveedor_Raw | String | Original supplier name from import |
| Fecha_Compra | Date | Purchase date (YYYY-MM-DD) |
| Monto_Factura | Number | Original invoice amount (MXN) |
| Monto_Pagar | Number | Amount to pay (after adjustments) |
| Ajustes | Number | Deductions/notes applied |
| Forma_Pago | String | Payment method (Transferencia, Tarjeta, Efectivo) |
| Categoria | String | Expense category |
| Estado | String | Payment status (Pagado, Pendiente) |
| Fecha_Pago | Date | Payment date (for pending/credit items) |
| Comprobante | String | CFDI receipt status |
| Tipo_Documento | String | Document type (Factura, Remisión, etc.) |
| Version | Number | Conflict detection (integer, starts at 1) |

### INGRESOS Tab (Daily Income — one row per day)
| Column | Type | Notes |
|--------|------|-------|
| ID | String | Format: ING{timestamp} |
| Fecha | Date | Entry date (YYYY-MM-DD) |
| DiaSemana | String | Day name (Lunes, Martes...) |
| VentasDia | Number | Total daily sales (MXN) |
| PagosRecibidos | Number | Total payments received |
| Tarjeta | Number | Card payments |
| Transferencias | Number | Bank transfers |
| Cashback | Number | Includes StoreCredit |
| 2ndoSocios | Number | Partner withdrawals |
| 2ndoNominas | Number | Payroll withdrawals |
| Sobre2 | Number | = 2ndoSocios + 2ndoNominas |
| DepositoBBVA | Number | = PagosRecibidos - Sobre2 |
| Mesa columns | Number | Cocina1/2/3, Casa1/2, Express, Granja, FrutasVerduras, Proveedor, MermasCanastas, Pedidos, Mixto, IvaAVenta |
| FactClientes | Number | Client invoices |
| FactGen1-6 | Number | General invoices (6 slots) |
| FacturasCFDI | String | CFDI invoice references |
| TotalFacturado | Number | Sum of all invoices |
| TotalXFacturar | Number | = DepositoBBVA |
| FaltaFactura | Number | = TotalXFacturar - TotalFacturado |
| Mes | String | Month name (Enero, Febrero...) |
| MesNumero | Number | 1-12 |

### CORTES_INDIVIDUALES Tab (Per-Register Cuts)
| Column | Type | Notes |
|--------|------|-------|
| ID | String | Format: CI{timestamp} |
| Fecha | Date | Cut date |
| Colaborador | String | Employee name |
| Caja | String | Register name (Caja 1, Caja 2, etc.) |
| VentasCaja | Number | Sales recorded in register |
| Tarjeta, Transferencias, Cashback, StoreCredit | Number | Payment breakdown |
| Retiros | Number | Employee withdrawals |
| D_1000...D_050 | Number | 11 denomination counts |
| TotalEfectivo | Number | Sum of (count × value) |
| FaltanteSobrante | Number | Variance from expected |

### CORTE_TIENDA Tab (Daily Store Cut)
| Column | Type | Notes |
|--------|------|-------|
| ID | String | Format: CT{timestamp} |
| Fecha | Date | Cut date |
| Colaborador | String | Manager name |
| VentasTotales | Number | Total across all registers |
| PagosRecibidos | Number | Total payments |
| Payment breakdown | Number | Tarjeta, Transferencias, Cashback |
| D_1000...D_050 | Number | Cash denomination counts |
| TotalEfectivo | Number | Calculated cash total |
| FaltanteSobrante | Number | Daily variance |
| Shopify_* columns | Number | Auto-populated from Shopify API |
| Discrepancia | Number | Manual vs Shopify difference |
| Sobre2 | Number | From INGRESOS |
| DepositoAjustado | Number | PagosRecibidos - Sobre2 |
| Mesa sales | Number | Per-station breakdown |

### ARQUEO_CAJA Tab (Petty Cash)
| Column | Type | Notes |
|--------|------|-------|
| ID | String | Format: AQ{timestamp} |
| Fecha | Date | Reconciliation date |
| Fondo1-3 | Number | Cash drawer funds |
| FondoRepartidor | Number | Delivery cash fund |
| BolsitaCambio | Number | Change bag |
| GastosReponer | Number | Expenses to replenish |
| D_1000...D_050 | Number | Denomination counts |
| TotalEfectivo | Number | Total counted |
| TotalCajaChica | Number | Sum of all funds |
| FaltanteSobrante | Number | Variance |

### TRANSFERENCIAS_LOG Tab
| Column | Type | Notes |
|--------|------|-------|
| ID | String | Format: TR{timestamp} |
| Fecha | Date | Transfer date |
| Monto | Number | Amount (MXN) |
| Concepto | String | Purpose |
| De_Cuenta | String | From account |
| A_Cuenta | String | To account |
| Referencia | String | Reference number |

### CONFIG_CAJAS Tab
| Column | Type | Notes |
|--------|------|-------|
| Caja | String | Register name |
| Tipo | String | Tienda or Delivery |
| Activa | Boolean | Is active? |
| Orden | Number | Display order |

---

## 14. DENOMINATION REFERENCE

Used in CORTES_INDIVIDUALES, CORTE_TIENDA, ARQUEO_CAJA:

| Column | Value (MXN) |
|--------|-------------|
| D_1000 | $1,000 bill |
| D_500 | $500 bill |
| D_200 | $200 bill |
| D_100 | $100 bill |
| D_50 | $50 bill |
| D_20 | $20 bill |
| D_10 | $10 coin |
| D_5 | $5 coin |
| D_2 | $2 coin |
| D_1 | $1 coin |
| D_050 | $0.50 coin |

**Formula:** TotalEfectivo = (D_1000 × 1000) + (D_500 × 500) + ... + (D_050 × 0.50)

---

## 15. INVOICING FORMULA (SAT Compliance)

```
FOR each month:
  1. SUM(PagosRecibidos)         = Total payments received
  2. SUM(Sobre2)                 = Total cash withdrawn (Socios + Nóminas)
  3. TotalXFacturar              = (1) - (2)
  4. SUM(FactClientes)           = Client-specific invoices issued
  5. SUM(FactGen1..6)            = General invoices issued (up to 6)
  6. TotalFacturado              = (4) + (5)
  7. FaltaFactura                = (3) - (6) → Must reach $0
```

At end of month, Louie creates up to 6 general invoices (FactGen1-6) to cover FaltaFactura. Each has a CFDI number tracked in FacturasCFDI column.

---

## 16. SHOPIFY POS INTEGRATION

### Status: Code built, credentials needed

### Setup Required
1. Shopify Admin → Settings → Apps → Develop apps → Create "NB Sync"
2. Scopes: `read_orders`, `read_locations`
3. Copy Admin API access token
4. In Apps Script Properties: set `SHOPIFY_TOKEN` and `SHOPIFY_STORE`
5. API endpoint: `https://{store}.myshopify.com/admin/api/2025-01/graphql.json`

### Payment Gateway Mapping
| Shopify Gateway | NB Category |
|----------------|-------------|
| `cash` | Efectivo |
| `card`, `tarjeta`, `stripe`, `shopify_payments` | Tarjeta |
| `transfer`, `bank` | Transferencias |
| `cashback` | Cashback |
| `store_credit`, `gift_card` | StoreCredit |

### Daily Sync
- Function: `syncShopifyDaily({fecha: 'YYYY-MM-DD'})`
- Populates Shopify_* columns in CORTE_TIENDA
- Can be triggered manually or via Google Cloud Scheduler (11:30 PM daily)

---

## 17. OFFLINE SYNC MECHANISM

### How It Works
1. Web app stores operations locally (localStorage/IndexedDB)
2. When online, POSTs to `/doPost` endpoint normally
3. When offline, queues the operation locally
4. On reconnect, calls `POST /doPost?action=sync_batch` with batch array
5. `processSyncBatch()` processes each operation server-side
6. Results returned for local cleanup

### Supported Batch Operations
`save_corte_individual`, `save_corte_tienda`, `save_arqueo`, `save_transferencia`, `save_ingreso`

### Status: Patch file ready (`sync_batch_patch.gs`), not yet applied to Código.gs

---

## 18. NOTIFICATION SYSTEM

### Architecture
- `notification_functions.gs` — separate file for modularity
- Uses `GmailApp.sendEmail()` with HTML body (green NB branding)
- First run prompts for Gmail permissions in Apps Script

### Triggers
| Event | Function | Recipient | Flag |
|-------|----------|-----------|------|
| Corte de Tienda saved | `notifyOwnerCorteReady()` | Owner (Louie) | `notifyOwner: true` |
| Sobre 2 saved | `notifyLeaderSobre2Ready()` | Store leader | `notifyLeader: true` |

### Email Content
- **Corte notification:** Total cash, faltante/sobrante (red/green), Shopify discrepancy
- **Sobre 2 notification:** Deposit amount, socios/nóminas breakdown, action items

---

## 19. DAILY WORKFLOW

```
[Employee] Corte Individual (per register, denomination count)
     ↓
[Store Leader] Corte de Tienda (consolidates all registers) → notifies Louie
     ↓
[Louie] Registro de Ingresos (reconcile, set Sobre 2, mesa sales, invoicing) → notifies leader
     ↓
[Store Leader] Prepares bank deposit + Sobre 2 envelope
     ↓
[End of Month] Louie creates general invoices to close FaltaFactura gap
```

### Mesa Sales = Employee Station Productivity
The columns Cocina1/2/3, Casa1/2, Express, Granja, etc. in INGRESOS are **sales per workstation**, NOT expenses. Each employee works a specific mesa. This data feeds into: Bono de Productividad Quincenal (biweekly bonus), Reporte de Nómina Semanal (payroll), Bono de Asistencia Mensual (attendance bonus).

---

## 20. FUTURE PHASES

### HR Integration (not yet built)
- **Bono Productividad Quincenal** — biweekly bonus: mesa sales × % = bono
- **Reporte de Nómina Semanal** — attendance + bonuses → payroll
- **Bono Asistencia Mensual** — monthly attendance bonus
- All currently in Notion, planned migration to Sheets + web apps

### Registers
- Currently: 3 in-store (Caja 1-3) + 2 delivery (Repartidor 1-2)
- Planning: add Caja 4, possibly Caja 5
- Config is dynamic via CONFIG_CAJAS tab

---

## 21. TROUBLESHOOTING

### API Route 404
- Check case exists in doGet/doPost switch in Código.gs
- Verify function is defined in cortes_ingresos.gs
- Test directly from Apps Script editor

### Shopify Sync Returns 0 Orders
- Check SHOPIFY_TOKEN and SHOPIFY_STORE in Script Properties
- Verify token has `read_orders` scope
- Check if orders exist in Shopify for that date

### Date-Related Bugs
- ALWAYS use `formatDateStr()` — never `String()` on date objects
- Timezone: `America/Mexico_City`

### Offline Sync Fails
- Check if processSyncBatch cases exist in Código.gs (patch not yet applied)
- Verify functions exist in cortes_ingresos.gs
