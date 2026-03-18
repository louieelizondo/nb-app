/**
 * ═══════════════════════════════════════════════════════════════
 * MIGRATION: Bulk import historical Gastos into FACTURAS tab
 * ═══════════════════════════════════════════════════════════════
 *
 * HOW TO USE:
 * 1. Import gastos_historicos_import.csv into a TEMP tab in Google Sheets:
 *    - File → Import → Upload → gastos_historicos_import.csv
 *    - Choose "Insert new sheet" (creates a temp tab)
 *    - Name the tab "IMPORT_TEMP"
 *
 * 2. Run the function importHistoricalGastos() from Apps Script editor
 *    - It reads from IMPORT_TEMP and appends to FACTURAS
 *    - Skips duplicate IDs (safe to re-run)
 *
 * 3. Delete the IMPORT_TEMP tab when done
 *
 * NOTE: All amounts are in MXN Pesos (standard decimal format).
 */

function importHistoricalGastos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const importSheet = ss.getSheetByName('IMPORT_TEMP');
  if (!importSheet) throw new Error('Tab "IMPORT_TEMP" not found. Import the CSV first.');

  const facturasSheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);

  // Get existing IDs to avoid duplicates
  const existingData = facturasSheet.getDataRange().getValues();
  const existingIds = new Set();
  for (let i = 1; i < existingData.length; i++) {
    existingIds.add(String(existingData[i][0]));
  }

  // Read import data
  const importData = importSheet.getDataRange().getValues();
  const importHeaders = importData[0].map(h => String(h).trim());

  // Map import headers to FACTURAS_HEADERS positions
  const headerMap = {};
  FACTURAS_HEADERS.forEach((h, i) => {
    const importIdx = importHeaders.indexOf(h);
    headerMap[i] = importIdx;
  });

  let imported = 0;
  let skipped = 0;
  const batchRows = [];

  for (let i = 1; i < importData.length; i++) {
    const importRow = importData[i];
    const id = String(importRow[headerMap[0]] || '').trim();

    if (!id || existingIds.has(id)) {
      skipped++;
      continue;
    }

    // Build row in FACTURAS_HEADERS order
    const row = FACTURAS_HEADERS.map((h, j) => {
      const srcIdx = headerMap[j];
      if (srcIdx === undefined || srcIdx < 0) return '';
      const val = importRow[srcIdx];
      // Ensure numeric fields are numbers
      if (['Monto_Factura', 'Ajustes', 'Monto_Pagar', 'Credit_Days', 'Version'].includes(h)) {
        return parseFloat(val) || 0;
      }
      return val || '';
    });

    batchRows.push(row);
    existingIds.add(id); // Track to prevent dupes within batch
    imported++;
  }

  // Batch write for performance
  if (batchRows.length > 0) {
    const startRow = facturasSheet.getLastRow() + 1;
    facturasSheet.getRange(startRow, 1, batchRows.length, FACTURAS_HEADERS.length).setValues(batchRows);
  }

  const msg = 'Import complete: ' + imported + ' records added, ' + skipped + ' skipped (dupes/empty)';
  log('IMPORT_HISTORICAL', msg);
  Logger.log(msg);
  return { ok: true, imported, skipped, message: msg };
}

/**
 * Alternative: Direct paste import (no IMPORT_TEMP tab needed)
 * Reads the CSV content from Script Properties and imports directly.
 *
 * Usage:
 * 1. Set Script Property 'IMPORT_CSV' with the CSV content
 * 2. Run importFromProperty()
 *
 * For large files, use the IMPORT_TEMP tab approach instead.
 */
function importFromProperty() {
  const csvContent = PropertiesService.getScriptProperties().getProperty('IMPORT_CSV');
  if (!csvContent) throw new Error('No IMPORT_CSV property found');

  const lines = csvContent.split('\n');
  const headers = lines[0].split(',');

  const facturasSheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const existingData = facturasSheet.getDataRange().getValues();
  const existingIds = new Set();
  for (let i = 1; i < existingData.length; i++) {
    existingIds.add(String(existingData[i][0]));
  }

  let imported = 0;
  const batchRows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    // Simple CSV parse (doesn't handle quoted commas — use IMPORT_TEMP for complex data)
    const vals = lines[i].split(',');
    const id = vals[0].trim();
    if (!id || existingIds.has(id)) continue;

    batchRows.push(vals.map((v, j) => {
      const h = FACTURAS_HEADERS[j];
      if (['Monto_Factura', 'Ajustes', 'Monto_Pagar', 'Credit_Days', 'Version'].includes(h)) {
        return parseFloat(v) || 0;
      }
      return v || '';
    }));
    existingIds.add(id);
    imported++;
  }

  if (batchRows.length > 0) {
    const startRow = facturasSheet.getLastRow() + 1;
    facturasSheet.getRange(startRow, 1, batchRows.length, FACTURAS_HEADERS.length).setValues(batchRows);
  }

  log('IMPORT_FROM_PROP', imported + ' records imported');
  // Clean up property
  PropertiesService.getScriptProperties().deleteProperty('IMPORT_CSV');
  return { ok: true, imported };
}

/**
 * ═══════════════════════════════════════════════════════════════
 * MIGRATION: Bulk import historical Ingresos into INGRESOS tab
 * ═══════════════════════════════════════════════════════════════
 *
 * HOW TO USE:
 * 1. Import ingresos_historicos_import.csv into a TEMP tab:
 *    - File → Import → Upload → ingresos_historicos_import.csv
 *    - Choose "Insert new sheet"
 *    - Name the tab "INGRESOS_IMPORT_TEMP"
 *
 * 2. Run importHistoricalIngresos() from Apps Script editor
 *    - Reads from INGRESOS_IMPORT_TEMP and appends to INGRESOS
 *    - Skips duplicate dates (safe to re-run)
 *
 * 3. Delete the INGRESOS_IMPORT_TEMP tab when done
 */

function importHistoricalIngresos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const importSheet = ss.getSheetByName('INGRESOS_IMPORT_TEMP');
  if (!importSheet) throw new Error('Tab "INGRESOS_IMPORT_TEMP" not found. Import the CSV first.');

  const ingresosSheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);

  // Get existing dates to avoid duplicates (date is the natural key for ingresos)
  const existingData = ingresosSheet.getDataRange().getValues();
  const fechaCol = INGRESOS_HEADERS.indexOf('Fecha');
  const existingDates = new Set();
  for (let i = 1; i < existingData.length; i++) {
    existingDates.add(String(existingData[i][fechaCol]).trim());
  }

  // Read import data
  const importData = importSheet.getDataRange().getValues();
  const importHeaders = importData[0].map(h => String(h).trim());

  // Map import headers to INGRESOS_HEADERS positions
  const headerMap = {};
  INGRESOS_HEADERS.forEach((h, i) => {
    const importIdx = importHeaders.indexOf(h);
    headerMap[i] = importIdx;
  });

  // Numeric fields in INGRESOS
  const numericFields = new Set([
    'VentasDia', 'PagosRecibidos', 'Tarjeta', 'Transferencias', 'Cashback',
    '2ndoSocios', '2ndoNominas', 'Sobre2',
    'Cocina1', 'Cocina2', 'Cocina3', 'Produccion1', 'Produccion2', 'Produccion3',
    'Casa1', 'Casa2', 'Express', 'Granja', 'FrutasVerduras', 'ProveedorVentas',
    'MermasCanastas', 'Pedidos', 'Mixto', 'IvaAVenta', 'DepositoBBVA',
    'FactClientes', 'FactGen1', 'FactGen2', 'FactGen3', 'FactGen4', 'FactGen5', 'FactGen6',
    'TotalFacturado', 'TotalXFacturar', 'FaltaFactura', 'MesNumero'
  ]);

  let imported = 0;
  let skipped = 0;
  const batchRows = [];

  for (let i = 1; i < importData.length; i++) {
    const importRow = importData[i];
    const fecha = String(importRow[headerMap[fechaCol]] || '').trim();

    if (!fecha || existingDates.has(fecha)) {
      skipped++;
      continue;
    }

    const row = INGRESOS_HEADERS.map((h, j) => {
      const srcIdx = headerMap[j];
      if (srcIdx === undefined || srcIdx < 0) return '';
      const val = importRow[srcIdx];
      if (numericFields.has(h)) {
        return parseFloat(val) || 0;
      }
      return val || '';
    });

    batchRows.push(row);
    existingDates.add(fecha);
    imported++;
  }

  // Batch write
  if (batchRows.length > 0) {
    const startRow = ingresosSheet.getLastRow() + 1;
    ingresosSheet.getRange(startRow, 1, batchRows.length, INGRESOS_HEADERS.length).setValues(batchRows);
  }

  const msg = 'Ingresos import complete: ' + imported + ' records added, ' + skipped + ' skipped (dupes/empty)';
  log('IMPORT_INGRESOS', msg);
  Logger.log(msg);
  return { ok: true, imported, skipped, message: msg };
}


/**
 * Utility: Count ingresos by year+month
 */
function countIngresosByMonth() {
  const sheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const counts = {};
  const fechaCol = INGRESOS_HEADERS.indexOf('Fecha');
  let totalVentas = 0;
  const ventasCol = INGRESOS_HEADERS.indexOf('VentasDia');

  for (let i = 1; i < data.length; i++) {
    const fecha = String(data[i][fechaCol] || '');
    const yearMonth = fecha.slice(0, 7) || 'unknown';
    counts[yearMonth] = (counts[yearMonth] || 0) + 1;
    totalVentas += parseFloat(data[i][ventasCol]) || 0;
  }

  Logger.log('INGRESOS by month: ' + JSON.stringify(counts));
  Logger.log('Total Ventas: $' + totalVentas.toLocaleString('es-MX'));
  return counts;
}


/**
 * Utility: Count records by year in FACTURAS tab
 */
function countFacturasByYear() {
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const counts = {};
  const fechaCol = FACTURAS_HEADERS.indexOf('Fecha_Compra');

  for (let i = 1; i < data.length; i++) {
    const fecha = String(data[i][fechaCol] || '');
    const year = fecha.slice(0, 4) || 'unknown';
    counts[year] = (counts[year] || 0) + 1;
  }

  Logger.log('FACTURAS by year: ' + JSON.stringify(counts));
  return counts;
}
