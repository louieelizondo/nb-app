# NB Finance Portal — Post-Deployment Bug Fix Summary
**Date:** March 10, 2026
**Phase:** Post Phase 1+2 Deployment Bug Fixes
**Status:** Mostly resolved — pending final verification

---

## What Happened

After deploying Phase 1 (Captura overhaul) and Phase 2 (Portal de Pagos overhaul), several bugs surfaced during real-world usage by Louie (phone/captura) and his mom (laptop/portal).

## Bugs Found & Fixed

### 1. Sync Queue Congestion (144 pending on Louie, 88 on mom)
**Root cause:** `processSyncBatch()` in GAS read the ENTIRE Facturas sheet for EVERY operation in a batch. 10 operations = 10 full sheet reads → GAS timeouts → "Failed to fetch."

**Fix (gastos_script.gs):**
- Read sheet ONCE, build a `rowMap` (ID → row index), process all FACTURAS operations against cached data
- Non-FACTURAS ops processed normally

**Fix (nb_portal_pagos.html):**
- Batch size: 10 → 25
- Added AbortController with 45-second timeout
- Added `_syncProcessing` guard to prevent overlapping batches

**Commit:** `9495509`

### 2. Folio Type Error: `(g.folio || "").replace is not a function`
**Root cause:** Google Sheets returns numeric folio values (e.g., 95696) as numbers, not strings. `.replace()` doesn't exist on numbers.

**Fix:** Wrapped with `String()` in two places — edit panel template (line ~1157) and sync normalization (line ~1460).

**Commit:** `44bb136`

### 3. Paid Status Not Persisting (50 invoices reverting to Pendiente)
**Root cause (triple whammy):**
1. **Race condition:** `syncFromSheet()` runs while queue still has pending items, overwriting local "Pagado" with sheet's stale "Pendiente"
2. **Version conflicts:** Conflict handler silently discards status changes without applying them
3. **Stale sheet data:** 50 Tarjeta invoices had Estado literally set to "Pendiente" in the sheet (written during the buggy period before the inference fix). The `g.Estado` value takes priority over the inference fallback.

**Fix (gastos_script.gs):**
- Skip version check for `update_status` operations (idempotent — safe to force through)

**Fix (nb_portal_pagos.html):**
- Block `syncFromSheet()` while queue has pending items
- Auto-sync only AFTER queue fully drains
- Conflict handler no longer triggers mid-queue sync

**Fix for stale data:**
- `fixNonTransferEstados()` function in GAS — sets all non-Transferencia invoices with Estado="Pendiente" to "Pagado"
- Must be run manually from Apps Script editor (one-time fix)

**Commit:** `462b424`

### 4. 5,042 Invoices on Mom's Laptop (localStorage Bloat)
**Root cause:** Duplicate entries accumulating across syncs — no deduplication on merge.

**Fix (nb_portal_pagos.html):**
- Added deduplication by ID after merge in `syncFromSheet()`
- Added sync queue management menu (click ⏳ indicator):
  - Option 1: Retry pending operations
  - Option 2: Purge queue
  - Option 3: **Force resync** — wipes localStorage + reloads from sheet

**Commit:** `462b424`

---

## Files Modified

| File | Key Changes |
|------|-------------|
| `gastos_script.gs` | Optimized `processSyncBatch()` (single sheet read), skip version check for `update_status`, optional `fecha_pago` in `updateDate()`, added `fixNonTransferEstados()` |
| `nb_portal_pagos.html` | Batch size 25, AbortController timeout, sync blocking during queue, deduplication, force resync UI, queue management menu, folio String() fix |

## Git Commits (This Session)

```
462b424 Fix paid-not-sticking + localStorage bloat + force resync
44bb136 Fix: cast folio to String (sheet returns numbers)
9495509 Fix sync queue congestion: optimized batch processing + queue management
```

---

## ⚠️ Pending Verification

### 1. Redeploy Latest GAS Code
The LOG screenshot showed batch size 10 (old code), not 25 (new code). This means the latest `gastos_script.gs` with the optimized `processSyncBatch` and skip-version-check **may not be deployed yet**.

**Action:** Copy the full `gastos_script.gs` from the repo, paste into Apps Script editor, and do a **New Deployment** (or overwrite existing).

### 2. Run `fixNonTransferEstados()` (if not done)
The LOG showed UPDATE_STATUS entries running, but some SYNC_BATCH entries showed "0 ok" — possibly because the old GAS code was deployed when those batches ran.

**Action:** After deploying latest GAS code, run `fixNonTransferEstados()` from the Apps Script editor. Then do a full resync on both devices.

### 3. Mom's Laptop — Force Resync
**Action:** On mom's laptop, click the sync indicator → Option 3 (Full Resync) to clear the 5,042 duplicates.

### 4. Confirm Everything Sticks
After all three actions above, mark a few Tarjeta invoices as Pagado on the portal. Wait for sync. Refresh. Verify they stay Pagado.

---

## Architecture Notes (for future reference)

- **GAS Web App URL:** `https://script.google.com/macros/s/AKfycbxQ7BzFITQnxyndvo2q7Xa1-Sc-yX5S8JGRc1mIbd4ye0rSpN2I2qx1zAjzRqbPXNeL/exec`
- **Spreadsheet:** NB_Margenes_Dashboard
- **FACTURAS columns:** ID, Folio, Tipo_Documento, Proveedor, Proveedor_Raw, Fecha_Compra, Monto_Factura, Ajustes, Monto_Pagar, Forma_Pago, Categoria, Estado, Fecha_Pago, Credit_Days, Comprobante, Fecha_Pago_Real, Created_At, Items_JSON, Foto_URL, Version
- **Estado inference logic:** If Estado is empty → infer from Forma_Pago (Transferencia = Pendiente, everything else = Pagado)
- **Sync flow:** Client enqueues operations → `processSyncQueue()` sends batches to GAS → GAS processes against sheet → Client auto-syncs after queue drains
