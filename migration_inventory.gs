/**
 * INVENTORY MIGRATION — Run these in order:
 * 1. deduplicateMP()         — find & remove duplicate product names
 * 2. migrateInventoryToMP()  — add inventory columns, migrate data from INVENTARIO_PRODUCTOS
 *
 * Safe to re-run. Won't destroy existing data.
 */

// ══════════════════════════════════════════
// 1. DEDUPLICATE MATERIA PRIMA
// ══════════════════════════════════════════
function deduplicateMP() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName('MATERIA PRIMA');
  if (!mp) throw new Error('MATERIA PRIMA tab not found');

  const data = mp.getDataRange().getValues();
  const nameMap = {}; // { lowercase_name: [row_indexes (0-based)] }

  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    if (!name || name.startsWith('►') || name.startsWith('▶')) continue;
    const key = name.toLowerCase();
    if (!nameMap[key]) nameMap[key] = [];
    nameMap[key].push(i);
  }

  // Find groups with duplicates
  const dupes = {};
  Object.keys(nameMap).forEach(key => {
    if (nameMap[key].length > 1) dupes[key] = nameMap[key];
  });

  if (Object.keys(dupes).length === 0) {
    Logger.log('✅ No duplicates found in MATERIA PRIMA');
    return { ok: true, removed: 0, message: 'No duplicates found' };
  }

  // For each group, keep the row with the most recent price date (col D = index 3)
  const rowsToDelete = [];
  const log = [];

  Object.keys(dupes).forEach(key => {
    const rows = dupes[key];
    let bestRow = rows[0];
    let bestDate = parseDate(data[rows[0]][3]);

    for (let j = 1; j < rows.length; j++) {
      const d = parseDate(data[rows[j]][3]);
      if (d > bestDate) {
        bestDate = d;
        bestRow = rows[j];
      }
    }

    rows.forEach(r => {
      if (r !== bestRow) {
        rowsToDelete.push(r + 1); // 1-indexed for Sheet
        log.push('DELETE row ' + (r + 1) + ': "' + data[r][0] + '" (keeping row ' + (bestRow + 1) + ')');
      }
    });
  });

  // Delete from bottom to top to avoid row shifting
  rowsToDelete.sort((a, b) => b - a);
  rowsToDelete.forEach(row => mp.deleteRow(row));

  log.forEach(l => Logger.log(l));
  Logger.log('✅ Removed ' + rowsToDelete.length + ' duplicate rows');

  return { ok: true, removed: rowsToDelete.length, details: log };
}

function parseDate(val) {
  if (val instanceof Date) return val.getTime();
  if (!val) return 0;
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}


// ══════════════════════════════════════════
// 2. MIGRATE INVENTORY DATA TO MATERIA PRIMA
// ══════════════════════════════════════════
function migrateInventoryToMP() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName('MATERIA PRIMA');
  if (!mp) throw new Error('MATERIA PRIMA tab not found');

  // ── Step 1: Rename B1 and add new column headers ──
  mp.getRange('B1').setValue('Proveedor');
  const newHeaders = ['Área', 'Ubicación', 'Inv_Max', 'Inv_Actual', 'Fecha_Conteo', 'Forma_Pedido', 'Activo'];
  mp.getRange(1, 14, 1, newHeaders.length).setValues([newHeaders]); // N1:T1
  Logger.log('✅ Headers set: B1=Proveedor, N-T=' + newHeaders.join(','));

  // ── Step 2: Read INVENTARIO_PRODUCTOS ──
  const invSheet = ss.getSheetByName('INVENTARIO_PRODUCTOS');
  const invMap = {}; // name(lowercase) → { area, ubicacion, max, forma, activo }

  if (invSheet) {
    const invData = invSheet.getDataRange().getValues();
    // INV headers: ID(0), Producto(1), Categoria(2), Ubicacion(3), Tienda(4), Unidad(5),
    //   Unidad_Compra(6), Forma_Pedido(7), Inv_Min(8), Inv_Max(9), Activo(10), Temporada(11), Tags(12), Variantes(13)
    for (let i = 1; i < invData.length; i++) {
      const name = String(invData[i][1] || '').trim();
      if (!name) continue;
      invMap[name.toLowerCase()] = {
        name: name,
        area: String(invData[i][2] || ''),
        ubicacion: String(invData[i][3] || ''),
        tienda: String(invData[i][4] || ''),
        unidad: String(invData[i][5] || ''),
        forma: String(invData[i][7] || 'Ir a tienda'),
        max: parseFloat(invData[i][9]) || 0,
        activo: invData[i][10] !== false && String(invData[i][10]).toLowerCase() !== 'false'
      };
    }
    Logger.log('📋 Loaded ' + Object.keys(invMap).length + ' products from INVENTARIO_PRODUCTOS');
  } else {
    Logger.log('⚠️ INVENTARIO_PRODUCTOS tab not found — will set defaults only');
  }

  // ── Step 3: Match MP rows to INVENTARIO_PRODUCTOS and write inventory fields ──
  const mpData = mp.getDataRange().getValues();
  let matched = 0, defaults = 0;
  const matchedKeys = new Set();

  for (let i = 1; i < mpData.length; i++) {
    const name = String(mpData[i][0] || '').trim();
    if (!name || name.startsWith('►') || name.startsWith('▶')) continue;

    const row = i + 1; // 1-indexed
    const key = name.toLowerCase();
    const inv = invMap[key];

    if (inv) {
      // Match found — write inventory fields
      const vals = [
        inv.area,           // N: Área
        inv.ubicacion,      // O: Ubicación
        inv.max,            // P: Inv_Max
        mpData[i][16] || 0, // Q: Inv_Actual (preserve if already set)
        mpData[i][17] || '', // R: Fecha_Conteo (preserve)
        inv.forma,          // S: Forma_Pedido
        inv.activo          // T: Activo
      ];
      mp.getRange(row, 14, 1, 7).setValues([vals]);
      matchedKeys.add(key);
      matched++;
    } else {
      // No match — set defaults (don't overwrite if already set)
      if (!mpData[i][19] && mpData[i][19] !== true && mpData[i][19] !== false) {
        mp.getRange(row, 19).setValue('Ir a tienda'); // S: Forma_Pedido
        mp.getRange(row, 20).setValue(true);           // T: Activo
      }
      defaults++;
    }
  }

  Logger.log('✅ Matched: ' + matched + ' | Defaults set: ' + defaults);

  // ── Step 4: Add products from INVENTARIO_PRODUCTOS that don't exist in MP ──
  let added = 0;
  Object.keys(invMap).forEach(key => {
    if (matchedKeys.has(key)) return; // already matched

    const inv = invMap[key];
    // These are non-food items (envases, cleaning, etc.) — add to MP
    const newRow = [
      inv.name,          // A: Ingrediente
      inv.tienda,        // B: Proveedor
      0,                 // C: CostoPaq
      '',                // D: Fecha
      '',                // E: UnidsCaja
      '',                // F: VolUnid
      inv.unidad,        // G: Unidad
      '', '', '', '', '', // H-L: formulas/empty
      inv.tienda,        // M: Proveedores
      inv.area,          // N: Área
      inv.ubicacion,     // O: Ubicación
      inv.max,           // P: Inv_Max
      0,                 // Q: Inv_Actual
      '',                // R: Fecha_Conteo
      inv.forma,         // S: Forma_Pedido
      inv.activo         // T: Activo
    ];
    mp.appendRow(newRow);
    added++;
  });

  Logger.log('✅ Added ' + added + ' non-food products to MATERIA PRIMA');

  SpreadsheetApp.flush();

  const summary = 'Migration complete: ' + matched + ' matched, ' + defaults + ' defaults, ' + added + ' added';
  Logger.log('🎉 ' + summary);
  return { ok: true, matched, defaults, added, message: summary };
}


// ══════════════════════════════════════════
// 3. VERIFY MIGRATION (optional — run after)
// ══════════════════════════════════════════
function verifyMigration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName('MATERIA PRIMA');
  const data = mp.getDataRange().getValues();

  let total = 0, withArea = 0, withUbicacion = 0, withMax = 0, active = 0, inactive = 0;
  let noLocation = [];

  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    if (!name || name.startsWith('►') || name.startsWith('▶')) continue;
    total++;

    if (data[i][13]) withArea++;
    if (data[i][14]) withUbicacion++;
    if (parseFloat(data[i][15]) > 0) withMax++;
    if (data[i][19] === true || data[i][19] === 'TRUE') active++;
    else inactive++;

    if (!data[i][14]) noLocation.push(name);
  }

  const report = {
    total,
    withArea,
    withUbicacion,
    withMax,
    active,
    inactive,
    missingLocation: noLocation.length,
    sampleMissing: noLocation.slice(0, 20)
  };

  Logger.log('📊 Verification: ' + JSON.stringify(report, null, 2));
  return report;
}
