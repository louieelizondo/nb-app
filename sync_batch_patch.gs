/**
 * ═══════════════════════════════════════════════════════════════
 * PATCH: Update processSyncBatch for Offline Sync Support
 * ═══════════════════════════════════════════════════════════════
 *
 * FILE: cortes_ingresos.gs (where all these functions are defined)
 * LOCATION: In your existing gastos_script.gs, find the processSyncBatch function
 *
 * ADD these cases to the switch(op.action) statement INSIDE processSyncBatch:
 *
 * ═══════════════════════════════════════════════════════════════
 */

// FIND THIS FUNCTION in gastos_script.gs:
function processSyncBatch(operations) {
  const results = [];
  
  operations.forEach(op => {
    let result = {};
    
    try {
      switch(op.action) {
        // ... existing cases ...
        
        // ▼ ADD THESE 5 CASES BELOW ▼
        
        case 'save_corte_individual':  result = saveCorteIndividual(op); break;
        case 'save_corte_tienda':      result = saveCorteTienda(op); break;
        case 'save_arqueo':            result = saveArqueo(op); break;
        case 'save_transferencia':     result = saveTransferencia(op); break;
        case 'save_ingreso':           result = saveIngreso(op); break;
        
        // ▲ ADD THESE 5 CASES ABOVE ▲
        
        // ... rest of existing cases ...
        default:
          result = { ok: false, error: 'Unknown action: ' + op.action };
      }
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    
    results.push(result);
  });
  
  return { ok: true, batch_processed: operations.length, results };
}

/**
 * ═══════════════════════════════════════════════════════════════
 * DETAILED LOCATION INSTRUCTIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. Open your Apps Script project (Extensions → Apps Script)
 * 2. Open gastos_script.gs
 * 3. Find the processSyncBatch function (Ctrl+F → "function processSyncBatch")
 * 4. Inside the switch(op.action) block, locate the last existing case
 * 5. After the last case's break statement, PASTE the 5 new cases above
 * 6. Make sure they're BEFORE the 'default:' case
 * 7. Save and Deploy
 *
 * ═══════════════════════════════════════════════════════════════
 * WHY THIS MATTERS
 * ═══════════════════════════════════════════════════════════════
 *
 * processSyncBatch is called by offline web apps to sync queued operations
 * when the device reconnects to the internet. Without these cases, offline
 * saves (cortes, arqueos, ingresos, transfers) won't sync back to Sheets.
 *
 * Each case routes the operation to the corresponding function defined in
 * cortes_ingresos.gs, which handles validation and saving to the appropriate tab.
 *
 * ═══════════════════════════════════════════════════════════════
 */
