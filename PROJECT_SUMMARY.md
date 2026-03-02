# NB System — Project Summary
## Natural Balance Club · Cash Flow Management Migration

**Owner:** Louie Elizondo
**Status:** Phase 3 — All apps live on GitHub Pages, responsive design complete
**Last Updated:** March 2, 2026

---

## The Big Picture

Migrating Natural Balance Club's entire cash flow system from Notion to Google Sheets + web apps (GitHub Pages). The goal: SAT-compliant invoicing, real-time cash tracking, denomination-level register reconciliation, and a dashboard that shows the financial pulse of the restaurant at a glance.

**Tech Stack:**
- **Backend:** Google Apps Script (deployed as web app)
- **Database:** Google Sheets (NB_Margenes_Dashboard)
- **Frontend:** Static HTML on GitHub Pages
- **Integrations:** Shopify POS (planned), Openpay (existing)

---

## Completed Projects ✅

### 1. Gastos (Supplier Expenses) System — FULLY OPERATIONAL
- **Captura de Facturas** web app — live on GitHub Pages
- **Portal de Pagos** web app — live on GitHub Pages
- 4,916 historical records imported from Notion into FACTURAS tab
- Full CRUD: create, list, get, update, delete supplier invoices
- Payment tracking, credit days, status management

### 2. Historical Data Migration — COMPLETE
- **Gastos:** 4,916 records from 2025-2026 Notion export → FACTURAS tab
- **Ingresos:** 357 records (310 from 2025 + 47 from 2026) → INGRESOS tab
- Python migration script handled: MXN number parsing, Spanish date formats, non-breaking spaces, deduplication
- Both import functions deployed and executed successfully

### 3. Backend Extension — DEPLOYED (Version 12)
- **cortes_ingresos.gs** — 7 new tabs, all CRUD operations (~900 lines)
- **11 new GET routes:** cortes_dia, corte_tienda, arqueos, transferencias, ingresos, monthly_summary, dashboard_data, payment_trends, faltante_history, mesa_sales, config_cajas
- **11 new POST routes:** save/delete corte_individual, save corte_tienda, save arqueo, save transferencia, save ingreso, update sobre2, update facturacion, update neto_mensual, sync shopify, update config_cajas
- StoreCredit consolidated with Cashback in INGRESOS context (kept in POS-level tabs)

### 4. Inventory & Orders System — OPERATIONAL
- Product catalog (MATERIA PRIMA tab)
- Order management
- Inventory counting/logging

---

## Built & Ready to Deploy 🔄

### 5. Corte de Caja Web App (`corte_caja.html`)
**Purpose:** Daily cash register reconciliation — the tool cashiers use at end of shift
- Individual register cuts with denomination counting (bills + coins)
- Auto-calculated Faltante/Sobrante (shortage/surplus)
- Consolidated store-level daily cut
- Shopify reconciliation fields
- History view with date range filtering
- Offline queue support

### 6. Registro de Ingresos Web App (`registro_ingresos.html`)
**Purpose:** Daily income recording — the master daily financial entry
- Payment breakdown: VentasDia, PagosRecibidos, Tarjeta, Transferencias, Cashback
- Sobre 2 auto-calculation (cash set aside for partners + payroll)
- Mesa/station sales breakdown (16 stations)
- Invoicing section (FactClientes, 6x FactGen, CFDI)
- Auto-calculated: DepositoBBVA, TotalFacturado, FaltaFactura
- Monthly summary with payment method breakdown
- Edit existing entries by date

### 7. Dashboard (`dashboard_nb.html`)
**Purpose:** Bird's-eye view of the restaurant's financial health
- KPI cards: Ingresos, Gastos, Neto, Falta Facturar, Promedio Diario
- Daily sales chart with 7-day moving average
- Payment methods donut chart
- 12-month comparison table
- Day-of-week analysis (busiest vs slowest days)
- Mesa/station sales breakdown
- Auto-refresh, print-friendly

---

## Recently Completed ✅

### 8. GitHub Pages Deployment — DONE
- All apps live on GitHub Pages: corte_caja, registro_ingresos, dashboard_nb, nb_inventario, nb_captura_facturas_v2, nb_portal_pagos
- Navigation bar linking Dashboard | Ingresos | Gastos | Cortes de Tienda

### 15. Responsive Design (Phase 1) — DONE (March 2, 2026)
- All 6 apps optimized for mobile (480px), tablet (768px), and desktop (1024px+)
- nb_inventario: Expanded from 500px mobile-only cap to fluid responsive with 2-col sections on desktop
- dashboard_nb: Payment grid stacking, enhanced chart areas, scroll indicators
- nb_portal_pagos: Table→card layout on mobile, 480px small phone breakpoint
- nb_captura_facturas_v2: Table→card layout on mobile, tablet/desktop width enhancements
- corte_caja + registro_ingresos: Added 480px small phone breakpoints

---

## Pending Projects ⏳

### 9. processSyncBatch Update (Offline Support)
- Add 5 new cases to processSyncBatch function in Código.gs
- Patch file ready: `sync_batch_patch.gs`
- Enables offline data entry that syncs when connection returns

### 10. Shopify POS Integration
- API key setup for daily sales sync
- Automatic reconciliation: Shopify totals vs manual register counts
- syncShopifyDaily function already built in backend

### 11. Arqueo de Caja Web App
- Petty cash reconciliation form
- Track cash on hand vs expected
- Backend ready (saveArqueo, getArqueos routes deployed)

### 12. Transferencias Log Web App
- Record bank transfers between accounts
- Track Concepto, De_Cuenta, A_Cuenta, Referencia
- Backend ready (saveTransferencia, getTransferencias routes deployed)

### 13. Neto Mensual Automation
- Monthly income-minus-expenses auto-calculation
- Could be triggered by scheduled function or manual button

### 14. Config Cajas Management
- UI for adding/removing/renaming cash registers
- Currently requires manual sheet editing

---

## Google Sheet Tabs

| Tab | Records | Purpose |
|-----|---------|---------|
| FACTURAS | ~4,920 | Supplier expense invoices |
| INGRESOS | 357 | Daily income + invoicing |
| CORTES_INDIVIDUALES | — | Per-register daily cuts (new) |
| CORTE_TIENDA | — | Consolidated daily store cut (new) |
| ARQUEO_CAJA | — | Petty cash reconciliation (new) |
| TRANSFERENCIAS_LOG | — | Bank transfer records (new) |
| NETO_MENSUAL | — | Monthly income - expenses (new) |
| CONFIG_CAJAS | — | Register configuration (new) |
| MATERIA PRIMA | existing | Product catalog |
| LOG | rolling | Operation audit trail |

---

## Files in nb-app/

| File | Type | Status |
|------|------|--------|
| `cortes_ingresos_extension.gs` | Apps Script | ✅ Deployed as cortes_ingresos.gs |
| `migration_import.gs` | Apps Script | ✅ Deployed as migration.gs |
| `doGet_doPost_patch.gs` | Reference | ✅ Applied to Código.gs |
| `sync_batch_patch.gs` | Reference | ⏳ Not yet applied |
| `corte_caja.html` | Web App | ✅ Live on GitHub Pages |
| `registro_ingresos.html` | Web App | ✅ Live on GitHub Pages |
| `dashboard_nb.html` | Web App | ✅ Live on GitHub Pages |
| `gastos_historicos_import.csv` | Data | ✅ Imported, can archive |
| `ingresos_historicos_import.csv` | Data | ✅ Imported, can archive |
| `MIGRATION_GUIDE.md` | Docs | ✅ Updated |
| `NB_Cortes_Ingresos_Architecture.md` | Docs | ✅ Reference |
| `PROJECT_SUMMARY.md` | Docs | ✅ This file |

---

## Key Business Logic

**Sobre 2** = Cash set aside daily for partner distributions (2ndoSocios) + payroll (2ndoNominas). This cash never hits the bank.

**DepositoBBVA** = PagosRecibidos - Sobre2 → What actually gets deposited.

**FaltaFactura** = TotalXFacturar - TotalFacturado → SAT compliance gap. Must trend toward zero.

**Faltante/Sobrante** = TotalEfectivo (counted) - Expected Cash → Register discrepancy. Tracked per cashier.

**Cashback** = What Shopify calls "store credit" / "crédito en tienda". Single column in INGRESOS, kept as StoreCredit in POS-level tabs (CORTES_IND, CORTE_TIENDA) since Shopify reports it separately.
