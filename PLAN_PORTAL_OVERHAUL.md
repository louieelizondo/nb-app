# NB Portal Overhaul — 3-Phase Plan
**Date:** March 9, 2026
**Status:** Pending Louie's approval

---

## PHASE 1 — Captura de Facturas (nb_captura_facturas_v2.html + gastos_script.gs)
**Goal:** Fix bad data at the source. Make everything editable before sending.

### 1.1 Consolidate all editable fields at the TOP
**Current problem:** Proveedor, forma de pago, and categoría are below the products table. Fecha de compra and folio are buried in the Claude response and NOT editable. User can't catch bad dates before sending.

**Change:** After Claude analyzes, show a clean **"Datos de Factura"** header card at the top with ALL fields editable:
- Fecha de compra (date picker, pre-filled from Claude, **highlighted yellow if suspicious**)
- Proveedor (with existing fuzzy match + pencil rename)
- Folio / # Factura (text input)
- Tipo de documento (Factura / Remisión / Ticket / Recibo)
- Total factura (already editable from last session)
- Forma de pago (dropdown)
- Categoría (dropdown)

Remove the duplicate "Enviar a Portal" section below. Everything lives in one place above the products table.

### 1.2 Fix Claude's date extraction
**Current problem:** Claude read "2024" instead of "2026" on two La Cosecha remisiones.

**Changes:**
- Add to the Claude prompt: `"Hoy es {YYYY-MM-DD}. Las fechas deben ser recientes (últimos 60 días normalmente). Si el año no es claramente visible, usa {current_year}."`
- Add date sanity check after Claude responds: if fecha is >60 days old OR >30 days in the future, show a ⚠️ yellow warning: "¿Fecha correcta? Claude extrajo {date}" with the date field highlighted
- Photo tips: add a small "💡 Tips" collapsible section at the top: "Foto nítida, factura completa, buena luz, sin sombras"

### 1.3 Stop auto-assigning fecha_pago for Transferencia
**Current problem:** `enviarGasto()` always sets `fecha_pago = fecha_compra` (or + credit days). Your mom needs Transferencia invoices to arrive with NO fecha_pago so she can assign them.

**Change in `enviarGasto()`:**
```
if (forma is Transferencia) {
  if (creditDays > 0) → fecha_pago = fecha_compra + creditDays  // keep, she needs to know when it's due
  else → fecha_pago = ''  // NO date, she assigns it
} else {
  // Efectivo, tarjeta, etc. → already paid at purchase
  estado = 'Pagado'
  fecha_pago = fecha_compra
}
```

### 1.4 Fix duplicate proveedores at the source
**Current problem:** Claude extracts "La Cosecha Mafer" or "PROMAR DEL NORTE" and captura sends that as `proveedor` if no match found. Creates duplicates in the sheet.

**Changes:**
- After Claude response, fuzzy-match proveedor against `nb_proveedores_cache` AND against unique proveedores already in `allGastos` (from sheet)
- If match confidence > 70%, auto-select the existing proveedor name
- If no match, show the field highlighted with "⚠️ Nuevo proveedor" tag — user must confirm or pick existing
- The `proveedor_raw` field keeps Claude's original text for reference
- The `proveedor` field always uses the canonical/matched name

### 1.5 Remove history row limit in captura
**Current problem:** Today's invoice history panel only shows partial results.

**Change:** Remove any `.slice()` limit on the history panel. Show all of today's invoices. Add a "Ver todo" link if >10 to expand.

### 1.6 Backend (gastos_script.gs)
- `createFactura()`: Accept empty `fecha_pago` — don't default it to fecha_compra
- `claudeAnalyze()`: No changes needed (multi-image already done)

**Files modified:** `nb_captura_facturas_v2.html`, `gastos_script.gs`
**Estimated scope:** ~200 lines changed in captura, ~20 in GAS

---

## PHASE 2 — Portal de Pagos (nb_portal_pagos.html)
**Goal:** Fix all UI bugs, sync issues, and your mom's workflow.

### 2.1 Fix year filter after sync
**Current problem:** `buildYearFilter()` only runs once on page load, before sync. If synced data has different years, they don't appear in dropdown.

**Change:** Call `buildYearFilter()` inside `syncFromSheet()` after updating `allGastos`. Default to "Todos los años" instead of current year — your mom shouldn't have to think about this.

### 2.2 Fix "Sin fecha" filter for Transferencia
**Current problem:** The `sin_fecha` filter checks `fecha_pago !== fecha_compra`. After Phase 1, Transferencia invoices will have `fecha_pago = ''`, so the check needs updating.

**Change:** `sin_fecha` filter = Transferencia + (`!fecha_pago` OR `fecha_pago === fecha_compra`)

### 2.3 Fix click-to-edit not working (intermittent)
**Current problem:** On desktop, `rowClick()` guards against `button, a, .date-link, input, .badge`. If user clicks on the badge area or near a button, edit doesn't open. On mobile, tap toggles selection NOT edit.

**Changes:**
- Desktop: keep click-to-edit, reduce guard targets
- Mobile: single tap → open edit panel (not just toggle checkbox). Long press or checkbox tap → selection mode. This matches what your mom expects.
- Add a small "✏️" icon on each row as a visual hint that it's editable

### 2.4 Restore the "Pagar" button visibility
**Current problem:** The inline "💰 Pagar" button disappeared from the right side of each row.

**Analysis:** The button IS in the code (line 1034-1035) and shows for non-Pagado invoices. If invoices were incorrectly set to Pagado (from the old sync logic that forced non-transferencia to Pagado), the button would be replaced by "↩ Deshacer".

**Change:** After fixing the sync logic (2.5), this should self-resolve. But also: make the Pagar button more prominent — bigger, always visible for Pendiente/Vencido/Sin fecha.

### 2.5 Fix sync logic — stop forcing estado
**Current problem:** Line 1387-1389 forces `estado: 'Pagado'` for non-Transferencia during sync, overriding what's in the sheet.

**Change:** Trust the sheet's Estado value for ALL payment types:
```javascript
estado: g.Estado || g.estado || 'Pendiente'
```
The captura already sets the correct estado at creation time (Pagado for efectivo/tarjeta, Pendiente for transferencia).

### 2.6 Fix version conflict on date changes
**Current problem:** Mom assigns a date → pushes to sync queue → conflict because version is stale → change reverts on next sync.

**Changes:**
- On conflict: force a `syncFromSheet()` immediately, then show a modal: "Los datos se actualizaron desde otro dispositivo. Tu cambio fue: [description]. ¿Aplicar de nuevo?"
- After sync, if the user's intended change differs from the sheet value, offer to re-apply
- Simpler alternative: just re-sync silently and show "Datos actualizados" toast. If user's change was overwritten, they'll see the old value and can re-do it. Less code, less confusion.

**Recommendation:** Go with the simpler approach. Conflicts are rare (you and mom rarely edit the same invoice).

### 2.7 Add "Recién subidas" (Recently uploaded) chip filter
**Your mom's need:** See what invoices you uploaded yesterday or today so she can do her physical paper reconciliation.

**Change:** Add a new filter chip: "🆕 Recientes" — shows invoices from last 48 hours by `created_at`. Sorted newest first. This is the equivalent of your captura history panel but on her side.

### 2.8 Add editable fields in portal
**Current problem:** The edit row exists but not all fields are there or easy to use. Date of purchase needs to be editable (for when Claude gets it wrong and you already sent it).

**Change:** Make sure ALL fields are editable in the inline edit panel:
- Proveedor, Folio, Tipo doc, Fecha compra, Monto, Ajustes, Forma pago, Categoría, Días crédito, **Fecha pago**
- Push all changes to sheet via sync queue

**Files modified:** `nb_portal_pagos.html`
**Estimated scope:** ~150 lines changed

---

## PHASE 3 — System-wide improvements
**Goal:** Better search, cleanup, and cross-device reliability.

### 3.1 Enhanced search bar
**Current:** Only searches proveedor, folio, proveedor_raw, categoria.

**Add search across:**
- Total de compra (numeric match: type "1650" finds $1,650 invoices)
- Fecha de compra (type "2026-03-04" or "4 mar")
- Fecha de pago
- Número de folio
- Proveedor (already works)

**Implementation:** Parse search input — if it looks like a number, match against monto_pagar. If it looks like a date fragment, match against fecha fields. Otherwise fuzzy text match on all string fields.

### 3.2 Proveedor deduplication cleanup
**One-time fix:** Script to scan FACTURAS sheet, find duplicate proveedores (fuzzy match), and consolidate to canonical names. E.g.:
- "PROMAR DEL NORTE" → "Promar"
- "La Cosecha Mafer" / "La Cosecha (mera mera)" → "La Cosecha"
- "GASTRONORTE AA SA DE CV (Los Piolines)" → "Gastronorte"

**Ongoing fix:** Both captura and portal manual entry now force-match against existing proveedores before creating new ones (Phase 1, item 1.4).

### 3.3 Proveedor master list in Google Sheet
**New tab: PROVEEDORES** with columns: Nombre, RFC, Días_Crédito, Forma_Pago_Default, Activo

Both captura and portal read from this tab instead of localStorage cache. Eliminates the "different cache per device" problem. When you add a proveedor on your phone, it's immediately available on mom's laptop.

### 3.4 Cross-device sync reliability
**Current problem:** localStorage is per-device. Proveedores cache, mappings, preferred names — all local.

**Changes:**
- Proveedores: move to sheet (3.3)
- Invoice mappings (ingredient name → BD match): keep local (only relevant to captura)
- Preferred names: keep local (only relevant to captura)
- The FACTURAS sheet is already the single source of truth for invoices — just need to make sure both apps always sync from it

### 3.5 Portal — remisión to factura flow review
**Current flow:** Remisión has a "📄 CFDI" button → modal to enter UUID, folio fiscal, fecha. Marks `cfdi_recibido = true`.

**Improvements:**
- When CFDI is received, update `tipo_documento` from "Remisión" to "Factura" in the sheet
- Show a visual indicator in the list: "Remisión → ✅ Factura" timeline
- The "Remisiones" filter chip should only show unconverted remisiones

### 3.6 Captura — better photo tips
Add a dismissable info card at the top of captura:
> **📸 Para mejores resultados:**
> • Foto de frente, sin ángulo
> • Buena luz, sin sombras sobre números
> • Toda la factura visible (bordes incluidos)
> • Si son 2 hojas, usa el botón "Página 2"
> • Revisa la fecha antes de enviar — Claude a veces lee mal el año

---

## Execution Order

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| 🔴 | 1.1 Editable header card | High — prevents bad data | Medium |
| 🔴 | 1.2 Claude date fix | High — root cause of missing invoices | Small |
| 🔴 | 1.3 No auto fecha_pago | High — mom's workflow | Small |
| 🔴 | 2.1 Year filter fix | High — invoices invisible | Small |
| 🔴 | 2.5 Stop forcing estado | High — wrong status | Small |
| 🟡 | 2.3 Click-to-edit fix | Medium — UX confusion | Medium |
| 🟡 | 2.7 Recientes filter | Medium — mom's visibility | Small |
| 🟡 | 1.4 Proveedor matching | Medium — data quality | Medium |
| 🟡 | 2.6 Version conflict | Medium — reverted changes | Medium |
| 🟡 | 3.1 Enhanced search | Medium — findability | Small |
| 🟢 | 1.5 History limit | Low — cosmetic | Tiny |
| 🟢 | 2.4 Pagar button | Low — resolves with 2.5 | Tiny |
| 🟢 | 3.2 Proveedor cleanup | Low — one-time fix | Small |
| 🟢 | 3.3 Proveedores sheet tab | Low — future-proofing | Medium |
| 🟢 | 3.5 Remisión flow | Low — works OK now | Small |
| 🟢 | 3.6 Photo tips | Low — user education | Tiny |

---

**Approve this plan and I'll execute Phase 1 + Phase 2 tonight. Phase 3 we can tackle next session.**
