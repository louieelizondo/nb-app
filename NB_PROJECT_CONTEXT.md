# NB Systems · Project Tracker

> **Status:** transition phase · `nb-app` (Sheets + Apps Script) is current production. `nb-platform` (Supabase + Postgres) begins development **2026-05-08**.

**Owner:** Louie Elizondo — `le.nbclub@gmail.com`
**Last updated:** 2026-05-09 (Saturday afternoon — first nb-platform migrations shipped)

---

## ⚡ TL;DR

Natural Balance Club runs two parallel systems while we transition:

| | `nb-app` (legacy) | `nb-platform` (successor) |
|---|---|---|
| Tech | Google Apps Script + Sheets + GitHub Pages | Supabase Postgres + auth + storage |
| URL | `louieelizondo.github.io/nb-app/` | `app.naturalbalance.club` (eventual) |
| Repo | `github.com/louieelizondo/nb-app` | `github.com/louieelizondo/nb-platform` |
| State | ✅ Production · Phase 3 complete | 🚧 Foundation laid, building toward V1 |
| Replaces | Notion finance workflow | Notion HR + relojchecador.com + Sheets |

When `nb-platform` reaches V1 (kiosk-ready), the apps in `nb-app` get **migrated**, **absorbed**, or **retired** as marked below. Until then, both run.

---

## 🎯 What `nb-platform` becomes (the destination)

A phone-first portal where every NB colaborador can:

- **Clock in/out** at a Chuwi tablet kiosk OR on their own phone (líderes only)
- **See pay maximization in real time** — every bono earned + still in play
- **Submit permisos and vacaciones** with comprobante upload
- **Take training courses** (NB School) that pay per-completion bonos
- **Get coached, not surveilled**

Same `employees` table powers RBAC for admin tools — kiosk auth, the empleado portal, and bono/nómina engines all run off one source of truth.

📖 Full spec: [`nb-platform/docs/PRODUCT_DESIGN.md`](https://github.com/louieelizondo/nb-platform/blob/main/docs/PRODUCT_DESIGN.md) — ~900 lines, 18 sections.

---

## 📦 nb-app · what each piece becomes

### Frontend apps (GitHub Pages · `louieelizondo.github.io/nb-app/`)

| App | What it does today | Future |
|---|---|---|
| `index.html` | Navigation hub with top bar | 🔄 **Absorbed** into nb-platform shell as the landing page (with adaptive home per tipo_empleado) |
| `dashboard_nb.html` | Monthly KPIs, charts, mesa sales, payment doughnut | 🔄 **Absorbed** — becomes Admin tab page in nb-platform |
| `nb_portal_pagos.html` | Supplier invoice management | 🔄 **Absorbed** — becomes "Pagos a Proveedores" admin page |
| `nb_captura_facturas_v2.html` | Camera capture + Claude AI vision invoice extraction | 🔄 **Absorbed** — high-value, keeps its current UI inside the new shell |
| `corte_caja.html` | Per-register denomination counts + store consolidation + Shopify sync | 🔄 **Absorbed** — becomes part of cashier_shifts flow (see [PRODUCT_DESIGN §6](https://github.com/louieelizondo/nb-platform/blob/main/docs/PRODUCT_DESIGN.md)) |
| `registro_ingresos.html` | Daily income, Sobre 2, mesa sales, invoicing | 🔄 **Absorbed** — Sobre 2 gets a template feature (see [PRODUCT_DESIGN §5](https://github.com/louieelizondo/nb-platform/blob/main/docs/PRODUCT_DESIGN.md)) |
| `nb_inventario.html` | Product catalog, section counting, supplier shopping list | 🔄 **Absorbed** — becomes Inventario tab |
| `portal_finanzas.html` | Financial overview portal | 🔄 **Absorbed** — merges with Dashboard |
| `nomina.html` | Cash denomination breakdown for printing nómina | 🔁 **Migrated** — same algorithm runs server-side in nb-platform Friday flow |
| `pagos_nomina.html` | Per-employee denomination breakdown + bank summary + tear-off slips | 🔁 **Migrated** — generated server-side as PDF, printed via admin UI (see [PRODUCT_DESIGN §14d](https://github.com/louieelizondo/nb-platform/blob/main/docs/PRODUCT_DESIGN.md)) |
| `bono_productividad.html` | Per-employee biweekly bonus calc with VENTAS_MESA matrix | 🔁 **Migrated** — engine becomes a Postgres function + edge function, UI rebuilt in shell |
| `reporte_semanal.html` | Pre-nómina + Final attendance per week from checador xlsx | 🔁 **Migrated** — eats `attendance_days` directly instead of xlsx upload |
| `permisos.html` | Employee permiso submission form | 🔁 **Migrated** — becomes Mi NB → Solicitudes tab. Gains comprobante upload + reposo tracker |
| `permisos-admin.html` | Admin approval queue with reposo verification | 🔁 **Migrated** — becomes Admin → Aprobaciones |
| `vacaciones.html` | Vacation balance + calendar + request | 🔁 **Migrated** — Mi NB → Solicitudes |
| `ausencias-calendario.html` | Team-wide calendar | 🔁 **Migrated** — Mi NB → Equipo (líderes) / Admin |

**Status legend:**
- 🔁 **Migrated** = replaced by Postgres-backed equivalent in nb-platform
- 🔄 **Absorbed** = moves into nb-platform admin tab, same UI, same logic, just lives at new URL
- ❌ **Retired** = not coming forward (none yet)

### Backend (Google Apps Script · single project)

| File | Responsibility | Future |
|---|---|---|
| `Código.gs` (`gastos_script.gs` / `codigo.gs`) | Main router — FACTURAS CRUD, Claude proxy, inventory, sync_batch | 🔁 Logic migrates to Supabase edge functions / Postgres functions |
| `cortes_ingresos.gs` | Cortes, ingresos, dashboard data, monthly summaries | 🔁 Migrates to Postgres views + recompute functions |
| `cortes_ingresos_extension.gs` | Extended backend routes | 🔁 Migrates |
| `notification_functions.gs` | Email triggers (Corte de Tienda, Sobre 2) | 🔁 Migrates to Supabase database webhooks + Resend / Gmail SMTP |
| `bono_productividad.gs` | Per-employee quincenal bonus engine, Notion roster sync | 🔁 Migrates to Postgres function `compute_bono_productividad(period_start, period_end)` |
| `asistencia_engine.gs` | xlsx parser → ASISTENCIA_RAW → ASISTENCIA_SEMANAL · NB rules | 🔁 The XLSX parser stays as a fallback, but `attendance_days` becomes the new source of truth fed by `punches` |
| `permisos_backend.gs` | Permisos sheet schema + repose engine | 🔁 Migrates to Postgres tables (migration `0008` upcoming) |
| `dias_festivos_backend.gs` | LFT + empresa holiday lookup | 🔁 Migrates to `dias_festivos` table |
| `colaboradores_backend.gs` | COLABORADORES sheet sync (Phase 2 transition) | ❌ **Retired** — replaced by `public.employees` |

### Google Sheets tabs (data layer)

| Tab | Purpose | Future |
|---|---|---|
| `FACTURAS` | Supplier invoices (~4,920 rows) | 🔁 Migrates to `public.invoices` (TBD migration) |
| `MATERIA PRIMA` | Ingredient costs, pricing, inventory | 🔁 Migrates to `public.ingredients` |
| `INGRESOS` | Daily income (357+ rows) | 🔁 Migrates to `public.daily_income` |
| `CORTES_INDIVIDUALES` | Per-register cuts | 🔁 Becomes `public.cashier_shifts` ([§6](https://github.com/louieelizondo/nb-platform/blob/main/docs/PRODUCT_DESIGN.md)) |
| `CORTE_TIENDA` | Daily store consolidation | 🔁 Becomes `public.daily_close` |
| `ARQUEO_CAJA` | Petty cash | 🔁 Migrates |
| `TRANSFERENCIAS_LOG` | Bank transfer records | 🔁 Migrates |
| `NETO_MENSUAL` | Monthly net | 🔁 Computed view |
| `CONFIG_CAJAS` | Register config | 🔁 Becomes `public.devices` (already in `0003`) |
| `INVENTARIO_*` | Product catalog + counting | 🔁 Migrates |
| `PEDIDOS_LOG` | Supplier orders | 🔁 Migrates |
| `AUDIT_LOG` | Cross-app audit trail | 🔁 Migrates to `public.audit_log` |
| `LOG` | Operation log | ❌ **Retired** (Postgres has its own logging) |
| `ASISTENCIA_RAW`, `ASISTENCIA_SEMANAL` | Attendance derivation | ❌ **Retired** — replaced by `public.punches` + `public.attendance_days` (already in `0003`/`0004`) |
| `BONO_PRODUCTIVIDAD`, `VENTAS_MESA`, `PORCENTAJES_MESA`, `PERMISOS`, `VACACIONES` | HR data | 🔁 All migrate to Postgres equivalents |

---

## 🛠 Tech stack — both systems

### `nb-app` (current production)
```
Frontend: Static HTML/JS/CSS · GitHub Pages
Backend:  Google Apps Script (Web App)
Database: Google Sheets (NB_Margenes_Dashboard)
Auth:     Google Sign-In (OAuth2) — approved emails
Photos:   Google Drive folders (NB_Fotos_Facturas, NB_Comprobantes)
```

### `nb-platform` (under construction)
```
Frontend: PWA (Next.js or vanilla React, TBD) · GitHub Pages or Vercel
Backend:  Supabase Edge Functions (Deno) + Postgres functions
Database: Supabase Postgres 15 · region us-west-2
Auth:     Supabase Auth (email + password for portal, separate PIN flow for kiosk)
Photos:   Supabase Storage (face-check photos, comprobantes, signed receipts)
RLS:      Auto-enabled on every new table
```

---

## 🔐 Access & credentials

### nb-app (Google Apps Script)
- **Web App URL:** `https://script.google.com/macros/s/AKfycbxQ7BzFITQnxyndvo2q7Xa1-Sc-yX5S8JGRc1mIbd4ye0rSpN2I2qx1zAjzRqbPXNeL/exec`
- **Editor:** [Open Apps Script project](https://script.google.com/u/0/home/projects/1AdENQ3QOvVjzyZ_BDgWEf3c7I-jZ4Z6BNemjsn1MPNCYb0mir9j8Tbv5/edit)
- **Deploy flow:** Implementar → Administrar implementaciones → Lápiz → Versión: Nueva versión → Implementar
- **Google OAuth Client ID:** `934893720921-82k6l5gbm5kt3oq1nti1njitlgennqdl.apps.googleusercontent.com`

### nb-app authorized users
| Email | Role |
|---|---|
| `le.nbclub@gmail.com` | Owner (Louie) |
| `facturacion.nbclub@gmail.com` | Store leader / facturación |
| `servicioalcliente.nbclub@gmail.com` | Customer service |
| `adelalvidrez@gmail.com` | Mom (Adela) |
| `ing.elizondocardenas@gmail.com` | Dad |

### nb-platform (Supabase)
- **Org:** `naturalbalance.club` · Free plan
- **Project ref:** `tntoamrzbjvpzyewjfig`
- **URL:** `https://tntoamrzbjvpzyewjfig.supabase.co`
- **Region:** us-west-2 (Oregon)
- **Repo:** `github.com/louieelizondo/nb-platform`
- **All keys + connection strings:** `workspace/.credentials/supabase-nb-platform.md`

### Notification triggers (nb-app)
- **Corte de Tienda saved** → emails Louie (`notifyOwner: true`)
- **Sobre 2 saved** → emails store leader (`notifyLeader: true`)

---

## 📊 Migrations applied (`nb-platform`)

| # | Name | What |
|---|---|---|
| 0001 | `employees_and_auth` | Foundation table · 50+ columns · RBAC bools · RLS |
| 0002 | `auth_linkage` | `auth.users` FK · helpers (`current_employee()`, `is_admin()`, `has_access()`) · `me` view · auto-link trigger |
| 0003 | `punches_and_devices` | `devices` (kiosks + phones with geofence) · `punches` (every clock event w/ photo + face score + geo) |
| 0004 | `attendance_days` | Daily aggregation · retardo menor (8:01-8:04) vs mayor (8:05+) classification · `recompute_attendance_day()` · auto-trigger on punch insert |
| 0005 | `add_socio_tipo` | Adds 'Socio' to `employee_tipo` enum · cooperativa partner classification |
| 0006 | `seed_louie_admin` | First real row · Luis Elizondo Alvidrez as numero_colab 100, full RBAC |

**Migrations roadmap (planned):** 0007 seed team · 0008 permisos · 0009 vacaciones · 0010 bonos_calc · 0011 payroll_periods · 0012 horas_ayuda + sobre2_templates · 0013 cashier_shifts · 0014 nb_school · 0015 records · 0016 nom035_and_denuncias · 0017 health_fields · 0018 actas_administrativas · 0019 overtime · 0020 onboarding_slots · 0021 employee_documents · 0022 onboarding_form_versions · 0023 employee_contracts · 0024 weekly_signed_receipts.

After 0024, `nb-platform` is feature-complete for V2.

---

## 🧱 nb-app key business logic (preserved during transition)

These rules are referenced by both systems and must stay consistent during the transition.

### Daily workflow
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

### Sobre 2 / DepositoBBVA / FaltaFactura
- **Sobre 2** = Cash set aside daily for partners (`2ndoSocios`) + payroll (`2ndoNominas`). Never hits the bank.
- **DepositoBBVA** = `PagosRecibidos − Sobre2` → what gets deposited.
- **FaltaFactura** = `TotalXFacturar − TotalFacturado` → SAT compliance gap. Must trend → zero.
- **Faltante/Sobrante** = `TotalEfectivo − Expected Cash` → register variance per cashier.
- **Cashback** = Shopify "store credit". Single column in INGRESOS; kept as `StoreCredit` in POS-level tabs.

### Mesa sales = employee station productivity
The columns `Cocina1/2/3`, `Casa1/2`, `Express`, `Granja`, etc. in INGRESOS are **sales per workstation**, not expenses. Each empleado works a specific mesa. This data feeds:
- **Bono Productividad Quincenal** (via VENTAS_MESA + PORCENTAJES_MESA matrix)
- **Reporte de Nómina Semanal** (attendance + bonos)
- **Bono Asistencia Mensual** (attendance reward)

In `nb-platform`, mesa data syncs from Shopify nightly, so bono productividad becomes live mid-quincena.

### Date handling — critical pattern
Google Sheets returns Date objects for date cells. `String(dateObj)` returns `"Fri Feb 27 2026..."` which **is wrong**. Always use:
```js
formatDateStr(val) // → Utilities.formatDate(val, 'America/Mexico_City', 'yyyy-MM-dd')
```
Same rule applies in nb-platform: every `event_at timestamptz` column has a derived `local_date date` set via trigger using `at time zone 'America/Mexico_City'`.

---

## 📋 Detailed schemas (nb-app)

### `FACTURAS` (expenses)
| Col | Type | Notes |
|---|---|---|
| `ID` | string | Unique identifier |
| `Folio` | string | Invoice/receipt number |
| `Proveedor` | string | Normalized supplier name |
| `Proveedor_Raw` | string | Original supplier name from import |
| `Fecha_Compra` | date | Purchase date (YYYY-MM-DD) |
| `Monto_Factura` | number | Original invoice amount (MXN) |
| `Monto_Pagar` | number | Amount to pay (after adjustments) |
| `Ajustes` | number | Deductions / notes applied |
| `Forma_Pago` | string | Transferencia / Tarjeta / Efectivo |
| `Categoria` | string | Expense category |
| `Estado` | string | Pagado / Pendiente |
| `Fecha_Pago` | date | For pending/credit items |
| `Comprobante` | string | CFDI receipt status |
| `Tipo_Documento` | string | Factura / Remisión / etc. |
| `Version` | int | Conflict detection (starts at 1) |

### `INGRESOS` (one row per day)
| Col | Type | Notes |
|---|---|---|
| `ID` | string | `ING{timestamp}` |
| `Fecha` | date | YYYY-MM-DD |
| `DiaSemana` | string | Lunes / Martes / ... |
| `VentasDia` | number | Total daily sales |
| `PagosRecibidos` | number | Total payments received |
| `Tarjeta`, `Transferencias`, `Cashback` | number | Payment method breakdown |
| `2ndoSocios`, `2ndoNominas`, `Sobre2` | number | Cash set-aside |
| `DepositoBBVA` | number | `PagosRecibidos − Sobre2` |
| `Cocina1/2/3`, `Casa1/2`, `Express`, `Granja`, `FrutasVerduras`, `Proveedor`, `MermasCanastas`, `Pedidos`, `Mixto`, `IvaAVenta` | number | Mesa sales |
| `FactClientes`, `FactGen1-6` | number | Invoice slots |
| `FacturasCFDI` | string | CFDI invoice references |
| `TotalFacturado`, `TotalXFacturar`, `FaltaFactura` | number | SAT compliance triad |
| `Mes`, `MesNumero` | string/int | Month name + number |

### `CORTES_INDIVIDUALES` (per-register cuts)
`ID` (`CI{ts}`), `Fecha`, `Colaborador`, `Caja`, `VentasCaja`, `Tarjeta`, `Transferencias`, `Cashback`, `StoreCredit`, `Retiros`, `D_1000..D_050`, `TotalEfectivo`, `FaltanteSobrante`.

### `CORTE_TIENDA` (daily store cut)
Adds `Shopify_*` columns auto-populated from API + `Discrepancia` + `Sobre2` + `DepositoAjustado` + mesa sales.

### `ARQUEO_CAJA`, `TRANSFERENCIAS_LOG`, `CONFIG_CAJAS`
See full schema in commit history. CONFIG_CAJAS now has a `POS_ID` column mapping each register to a Shopify POS device_id.

### Denomination reference (used in CORTES_INDIVIDUALES, CORTE_TIENDA, ARQUEO_CAJA)
| Column | Value (MXN) |
|---|---|
| `D_1000` | $1,000 bill |
| `D_500` | $500 bill |
| `D_200` | $200 bill |
| `D_100` | $100 bill |
| `D_50` | $50 bill |
| `D_20` | $20 bill |
| `D_10` | $10 coin |
| `D_5` | $5 coin |
| `D_2` | $2 coin |
| `D_1` | $1 coin |
| `D_050` | $0.50 coin |

`TotalEfectivo = (D_1000 × 1000) + (D_500 × 500) + ... + (D_050 × 0.50)`

---

## 🛒 Shopify POS integration

**Status:** ✅ Live — integrated in Corte de Tienda

### Setup
- `SHOPIFY_TOKEN` and `SHOPIFY_STORE` set in Apps Script Properties
- API: `https://{store}.myshopify.com/admin/api/2025-01/graphql.json`
- Frontend calls `sync_shopify` action → routes to `syncShopifyDaily()` in `cortes_ingresos.gs`

### Payment gateway mapping
| Shopify Gateway | NB Category |
|---|---|
| `cash` | Efectivo |
| `card`, `tarjeta`, `stripe`, `shopify_payments` | Tarjeta |
| `transfer`, `bank` | Transferencias |
| `cashback` | Cashback |
| `store_credit`, `gift_card` | StoreCredit |

### Sync modes
- **Store-wide** (`syncShopifyDaily`): returns `pagosRecibidos` (net: SALE − REFUND) + `breakdown`. Populates `Shopify_*` columns in CORTE_TIENDA.
- **Per-register** (`syncShopifyByRegister`): GraphQL transactions + REST `device_id`. Groups orders by POS device, matched via `CONFIG_CAJAS.POS_ID`.

### Future in nb-platform
Daily 11:30 PM sync feeds `mesa_sales_daily` table. Mid-quincena bono productividad becomes live for empleados.

---

## 📨 Notification system (nb-app)

**File:** `notification_functions.gs` — uses `GmailApp.sendEmail()` with HTML body (green NB branding).

| Event | Function | Recipient |
|---|---|---|
| Corte de Tienda saved | `notifyOwnerCorteReady()` | Owner (Louie) |
| Sobre 2 saved | `notifyLeaderSobre2Ready()` | Store leader |

In `nb-platform`: replaced by Supabase database webhooks + edge functions. Same triggers, same recipients, more flexible (push notifs, WhatsApp Business API later).

---

## 🪪 SAT compliance: invoice formula

```
FOR each month:
  1. SUM(PagosRecibidos)         = Total payments received
  2. SUM(Sobre2)                 = Total cash withdrawn (Socios + Nóminas)
  3. TotalXFacturar              = (1) − (2)
  4. SUM(FactClientes)           = Client-specific invoices issued
  5. SUM(FactGen1..6)            = General invoices issued (up to 6)
  6. TotalFacturado              = (4) + (5)
  7. FaltaFactura                = (3) − (6)  →  must reach $0
```

End of month: Louie creates up to 6 general invoices (`FactGen1-6`) to cover `FaltaFactura`. Each has a CFDI tracked in `FacturasCFDI`.

---

## 🎉 Completed milestones

### nb-app (Phase 1-3)
1. ✅ Gastos system (Captura + Portal de Pagos) operational
2. ✅ Historical data migration (4,916 gastos + 357 ingresos from Notion)
3. ✅ Backend extension — `cortes_ingresos.gs` with 22 new routes
4. ✅ Inventory system — catalog, counting, orders
5. ✅ Corte de Caja — denomination counting, store consolidation
6. ✅ Registro de Ingresos — daily income, Sobre 2, invoicing, mesa sales
7. ✅ Dashboard — KPIs, charts, optimized to 2 API calls
8. ✅ GitHub Pages deployment — all apps live with shared nav
9. ✅ Notification system — email triggers for Corte de Tienda + Sobre 2
10. ✅ Responsive design — mobile/tablet/desktop on all 6 apps
11. ✅ Shopify POS integration — live in Corte de Tienda
12. ✅ Arqueo de Caja frontend — petty cash reconciliation
13. ✅ CONFIG_CAJAS simplified — presence-based, POS_ID mapping
14. ✅ Denomination input UX polished
15. ✅ Bono Productividad per-employee engine + Notion sync
16. ✅ Asistencia engine — xlsx parser + NB rules + permiso/repose
17. ✅ Permisos + Vacaciones flows + admin approval
18. ✅ Reporte Semanal de Asistencia with manual override + XLSX export

### nb-platform (Phase 4 — May 8, 2026 kickoff)
1. ✅ Supabase org `naturalbalance.club` created · Free tier
2. ✅ Project `nb-platform` provisioned · us-west-2 · IPv4 pooler configured
3. ✅ Supabase CLI installed + linked + auth tokens stored
4. ✅ GitHub repo `nb-platform` created · private · 4 commits pushed
5. ✅ Migration 0001-0006 applied to live database
6. ✅ Empleado portal home screen mockup (rendered + reviewed)
7. ✅ Kiosk clock-in screen mockup (rendered + reviewed)
8. ✅ Product design spec written (~900 lines · 18 sections)
9. ✅ README published
10. ✅ Louie seeded as first real row (numero_colab 100)

---

## 🔥 Pending / next up

### Immediate (next session)
- [ ] Migration 0007 — seed remaining 16 colaboradores (Iris, Jazmin, Louicarlo, mom, dad, Salvador, 11 operativos)
- [ ] Migration 0008 — `permisos` table (mirrors current sheet schema, RLS protected)
- [ ] Migration 0009 — `vacaciones` table
- [ ] Rotate Supabase DB password + secret key (chat hygiene from Fri 8 may session)
- [ ] Add Louicarlo as Supabase org member (read-only initially)
- [ ] Install Supabase Agent Skills (`npx skills add supabase/agent-skills`)

### Short-term (weeks 1-4)
- [ ] Migration 0010 — bonos calc tables (productividad, asistencia mensual, capacitación)
- [ ] Migration 0011 — payroll_periods + approval flow + XLSX export
- [ ] Kiosk PWA shell — login flow, PIN pad, identity confirm, clock-in flow
- [ ] Empleado portal shell — auth, home page (per the mockup), Solicitudes tab
- [ ] First end-to-end test: Iris clocks in on a Chuwi tablet, attendance_day computed, empleado portal shows it
- [ ] Wed + Thu 8:30am pre-nómina email cron

### Medium-term (weeks 4-8 — kicks off V1 milestone)
- [ ] Migrate all 17 colaboradores from Notion
- [ ] Configure geofences per device
- [ ] Pre-nómina XLSX export matches Salvador's template
- [ ] Parallel-run a full nómina week (validation)
- [ ] Sign-off → cancel relojchecador.com

### nb-app maintenance during transition
- [ ] Responsive Phase 2 — visual QA on real devices
- [ ] Corte de Caja editability (saved cortes editable?)
- [ ] Notification test — first trigger prompts for Gmail permissions
- [ ] `CLAUDE_API_KEY` in Script Properties for invoice photo analysis
- [ ] `sync_batch_patch` — offline support for cortes/ingresos (patch ready, not applied)
- [ ] Transferencias Log web app (backend ready)

---

## 🐛 Bugs fixed (recent)

1. **Gastos $0 on Dashboard** — `String(r.Fecha_Compra)` → `formatDateStr(r.Fecha_Compra)` in `getDashboardData` / `getMonthlySummary`
2. **March gastos ghost** — removed `Fecha_Pago` from `getMonthlySummary` filter (count by purchase date only)
3. **`charts-grid` dead code** — CSS existed but no HTML wrapper; wired Sections 4-5 into `.charts-grid` div
4. **VENTAS_MESA column reorder bug** — `saveVentasMesaSafe()` reads actual headers from sheet instead of writing positionally (fix in `bono_productividad.gs`)
5. **VENTAS_MESA upsert duplicates** — `String(dateObj) === 'YYYY-MM-DD'` always failed; switched to `formatDateStr()`. Cleanup helper `cleanupVentasMesaDuplicates()` added.

---

## 🔄 Offline sync (nb-app)

### Status: Patch ready, not yet applied

How it works:
1. Web app stores operations locally (localStorage)
2. When online, POSTs to `/doPost` normally
3. When offline, queues locally
4. On reconnect, calls `POST /doPost?action=sync_batch` with batch array
5. `processSyncBatch()` processes each operation server-side

Supported batch operations: `save_corte_individual`, `save_corte_tienda`, `save_arqueo`, `save_transferencia`, `save_ingreso`.

---

## 🔧 Troubleshooting

### nb-app
- **API Route 404** — check case in doGet/doPost switch in `Código.gs`. Verify function exists in `cortes_ingresos.gs`. Test from Apps Script editor directly.
- **Shopify Sync returns 0 orders** — check `SHOPIFY_TOKEN` and `SHOPIFY_STORE` Script Properties. Verify token has `read_orders` scope. Check orders exist in Shopify for that date.
- **Date-related bugs** — ALWAYS use `formatDateStr()`, never `String()` on date objects. Timezone: `America/Mexico_City`.
- **Offline Sync fails** — check `processSyncBatch` cases in `Código.gs` (patch not applied yet).

### nb-platform
- **Migration push fails** — check `supabase/.temp/linked-project.json` has correct project ref. Re-run `supabase link --project-ref tntoamrzbjvpzyewjfig`.
- **Connection IPv6 error from Mexico** — use the pooler URL (`aws-1-us-west-2.pooler.supabase.com`), not the direct one (`db.tntoamrzbjvpzyewjfig.supabase.co`).
- **RLS policy blocks query** — check policy with `select * from pg_policies where tablename = 'X'`. Test as admin via service_role first to isolate auth issue.

---

## 🌎 Recent git history (nb-platform · main)

```
ab5b9e2  feat: 0005 add Socio tipo · 0006 seed Louie as first admin · README   2026-05-08
f46b2e4  docs: design spec — onboarding, contracts, signed receipts, V2 roadmap 2026-05-08
39611ed  feat: 0002-0004 auth linkage, punches+devices, attendance_days        2026-05-08
d389923  chore: gitignore supabase cache + secrets                              2026-05-08
64fd89a  feat: 0001 employees + auth foundation                                  2026-05-08
```

---

## 🥑 Cultural principles guiding both systems

1. **Coach, don't surveil.** Every screen tells colaboradores how to win, not how they screwed up.
2. **Real-time over reactive.** Clock-in feedback before the retardo, not the bono email after.
3. **Cash-neutral wherever possible.** Horas Ayuda redistributes, doesn't cost extra.
4. **Transparency builds trust.** Empleado sees their own data, the calculation, the rules.
5. **Líderes with leverage.** Iris and Jazmin get tools to reward, recognize, coach.
6. **Compañerismo in software.** Records, leaderboards, gratitude moments — visible to peers.
7. **Compliance as a feature.** NOM-035, denuncias, capacitación tracking — Mexican labor law becomes a benefit.
8. **Buenos hábitos pay off.** Streaks, bonos por capacitación, faltante-free turnos — accountable behavior earns visible reward.
9. **Build for 3 locations and 50 empleados.** Schema scales. Multi-tenant ready when needed.

---

> When in doubt, optimize for the empleado's experience first. Admin tools come second. Compliance comes third. Done well, all three reinforce each other.
