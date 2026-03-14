/**
 * INVENTORY BACKEND FUNCTIONS — Add these to Código.gs
 *
 * ROUTES TO ADD:
 *   doGet  → case 'list_inventory':         return jsonResp(listInventory());
 *   doPost → case 'save_inventory_counts':  return jsonResp(saveInventoryCounts(body));
 *   doPost → case 'update_inv_field':       return jsonResp(updateInvField(body));
 */

// ── Column indexes for MATERIA PRIMA inventory fields ──
// N(13)=Área, O(14)=Ubicación, P(15)=Inv_Max, Q(16)=Inv_Actual,
// R(17)=Fecha_Conteo, S(18)=Forma_Pedido, T(19)=Activo

// ══════════════════════════════════════════
// LIST INVENTORY — GET ?action=list_inventory
// ══════════════════════════════════════════
function listInventory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mp = ss.getSheetByName('MATERIA PRIMA');
  if (!mp) throw new Error('MATERIA PRIMA tab not found');

  var data = mp.getDataRange().getValues();
  var products = [];

  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0] || '').trim();
    // Skip empty rows and group headers (► Bachoco, etc.)
    if (!name || /^[►▶]/.test(name)) continue;

    // Skip inactive products
    var activo = data[i][19];
    if (activo === false || String(activo).toLowerCase() === 'false' || activo === 'No') continue;

    var fechaConteo = data[i][17];
    if (fechaConteo instanceof Date) {
      fechaConteo = Utilities.formatDate(fechaConteo, 'America/Mexico_City', 'yyyy-MM-dd');
    } else {
      fechaConteo = fechaConteo ? String(fechaConteo) : '';
    }

    products.push({
      row: i + 1,
      nombre: name,
      proveedor: String(data[i][1] || '').trim(),
      unidad: String(data[i][6] || '').trim(),
      area: String(data[i][13] || '').trim(),
      ubicacion: String(data[i][14] || '').trim(),
      max: parseFloat(data[i][15]) || 0,
      actual: parseFloat(data[i][16]) || 0,
      fecha_conteo: fechaConteo,
      forma: String(data[i][18] || '').trim()
    });
  }

  return { ok: true, products: products, count: products.length };
}


// ══════════════════════════════════════════
// SAVE INVENTORY COUNTS — POST { action: 'save_inventory_counts', items, quien, device }
// Writes Inv_Actual + Fecha_Conteo to MATERIA PRIMA, logs to INVENTARIO_LOG
// ══════════════════════════════════════════
function saveInventoryCounts(body) {
  var items = body.items || [];
  if (!items.length) return { ok: false, error: 'No items to save' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mp = ss.getSheetByName('MATERIA PRIMA');
  if (!mp) throw new Error('MATERIA PRIMA tab not found');

  var now = new Date();
  var quien = body.quien || 'App';
  var device = body.device || '';

  // Batch update MATERIA PRIMA — Q(17)=Inv_Actual, R(18)=Fecha_Conteo
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var row = parseInt(item.row);
    if (!row || row < 2) continue;

    mp.getRange(row, 17).setValue(parseFloat(item.cantidad) || 0); // Q: Inv_Actual
    mp.getRange(row, 18).setValue(now);                              // R: Fecha_Conteo

    // Also update Inv_Max if provided (inline editing during count)
    if (item.new_max !== undefined && item.new_max !== null) {
      mp.getRange(row, 16).setValue(parseFloat(item.new_max) || 0); // P: Inv_Max
    }
  }

  SpreadsheetApp.flush();

  // Log to INVENTARIO_LOG
  var logHeaders = ['Timestamp', 'Producto', 'Cantidad', 'Seccion', 'Categoria', 'Variante', 'Contó', 'Dispositivo'];
  var logSheet = getOrCreateTab('INVENTARIO_LOG', logHeaders);

  var logRows = [];
  for (var j = 0; j < items.length; j++) {
    logRows.push([
      now,
      items[j].nombre || '',
      parseFloat(items[j].cantidad) || 0,
      items[j].ubicacion || '',
      items[j].area || '',
      '',
      quien,
      device
    ]);
  }

  if (logRows.length > 0) {
    logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
  }

  // Trim INVENTARIO_LOG to 10K rows
  var logTotal = logSheet.getLastRow();
  if (logTotal > 10000) {
    logSheet.deleteRows(2, logTotal - 10000);
  }

  return { ok: true, saved: items.length, timestamp: now.toISOString() };
}


// ══════════════════════════════════════════
// UPDATE INVENTORY FIELD — POST { action: 'update_inv_field', row, field, value }
// For updating max, ubicacion, area, forma, activo from the app
// ══════════════════════════════════════════
function updateInvField(body) {
  var row = parseInt(body.row);
  if (!row || row < 2) return { ok: false, error: 'Invalid row' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mp = ss.getSheetByName('MATERIA PRIMA');
  if (!mp) throw new Error('MATERIA PRIMA tab not found');

  var field = String(body.field || '').trim();
  var value = body.value;

  // Map field names to column numbers
  var colMap = {
    'area': 14,       // N
    'ubicacion': 15,   // O
    'max': 16,         // P
    'actual': 17,      // Q
    'forma': 19,       // S
    'activo': 20       // T
  };

  var col = colMap[field];
  if (!col) return { ok: false, error: 'Unknown field: ' + field };

  // Type coercion
  if (field === 'max' || field === 'actual') value = parseFloat(value) || 0;
  if (field === 'activo') value = (value === true || value === 'true' || value === 'TRUE');

  mp.getRange(row, col).setValue(value);
  SpreadsheetApp.flush();

  return { ok: true, row: row, field: field, value: value };
}
