/**
 * ═══════════════════════════════════════════════════
 * NB · Apps Script Backend — Gastos & Price Updates
 * ═══════════════════════════════════════════════════
 *
 * SETUP (5 pasos):
 * 1. Abre tu Google Sheet (el mismo de MATERIA PRIMA)
 * 2. Extensions → Apps Script
 * 3. Pega todo este código (reemplaza el contenido)
 * 4. Click "Deploy" → "New deployment"
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the URL. Pégala en la app de captura y el portal.
 *
 * TABS que crea automáticamente:
 * - FACTURAS: registro de todas las facturas/gastos
 * - LOG: bitácora de operaciones
 */

// ══════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════
const FACTURAS_TAB = 'FACTURAS';
const MP_TAB       = 'MATERIA PRIMA';
const LOG_TAB      = 'LOG';

const FACTURAS_HEADERS = [
  'ID', 'Folio', 'Tipo_Documento', 'Proveedor', 'Proveedor_Raw',
  'Fecha_Compra', 'Monto_Factura', 'Ajustes', 'Monto_Pagar',
  'Forma_Pago', 'Categoria', 'Estado', 'Fecha_Pago', 'Credit_Days',
  'Comprobante', 'Fecha_Pago_Real', 'Created_At', 'Items_JSON', 'Foto_URL'
];

// Inventory Products
const INV_TAB = 'INVENTARIO_PRODUCTOS';
const INV_HEADERS = [
  'ID', 'Producto', 'Categoria', 'Ubicacion', 'Tienda', 'Unidad',
  'Forma_Pedido', 'Inventario_Min', 'Inventario_Max', 'Activo',
  'Temporada', 'Tags', 'Grupo', 'Presentacion'
];

const FOTO_FOLDER_NAME = 'NB_Fotos_Facturas';
const COMP_FOLDER_NAME = 'NB_Comprobantes';
const FOTO_MAX_AGE_DAYS = 90; // 3 months

// ══════════════════════════════════════════════
// WEB APP ENTRY POINTS
// ══════════════════════════════════════════════

function doGet(e) {
  const action = (e.parameter.action || 'list').toLowerCase();
  try {
    switch(action) {
      case 'list':          return jsonResp(listFacturas(e.parameter));
      case 'get':           return jsonResp(getFactura(e.parameter.id));
      case 'list_products': return jsonResp(listProducts());
      case 'health':        return jsonResp({ ok: true, ts: new Date().toISOString() });
      default:              return jsonResp({ error: 'Unknown action: ' + action }, 400);
    }
  } catch(err) {
    log('ERROR doGet', err.message);
    return jsonResp({ error: err.message }, 500);
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch(err) {
    return jsonResp({ error: 'Invalid JSON' }, 400);
  }

  const action = (body.action || 'create').toLowerCase();
  try {
    switch(action) {
      case 'create':        return jsonResp(createFactura(body));
      case 'update_status': return jsonResp(updateStatus(body));
      case 'update_date':   return jsonResp(updateDate(body));
      case 'delete':        return jsonResp(deleteFactura(body));
      case 'update_prices':    return jsonResp(updatePrices(body));
      case 'add_product':      return jsonResp(addProduct(body));
      case 'toggle_product':   return jsonResp(toggleProduct(body));
      case 'update_product':   return jsonResp(updateProduct(body));
      default:                 return jsonResp({ error: 'Unknown action: ' + action }, 400);
    }
  } catch(err) {
    log('ERROR doPost ' + action, err.message);
    return jsonResp({ error: err.message }, 500);
  }
}

// ══════════════════════════════════════════════
// FACTURAS CRUD
// ══════════════════════════════════════════════

function createFactura(body) {
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const g = body.gasto || body;
  const gastoId = g.id || 'G' + Date.now();

  // Save photo to Google Drive if provided
  let fotoUrl = '';
  if (g.foto) {
    try {
      fotoUrl = saveFotoToDrive(gastoId, g.foto, g.proveedor || 'unknown');
    } catch(err) {
      log('FOTO_ERROR', gastoId + ': ' + err.message);
    }
  }

  const row = [
    gastoId,
    g.folio || '',
    g.tipo_documento || '',
    g.proveedor || '',
    g.proveedor_raw || '',
    g.fecha_compra || '',
    g.monto_factura || 0,
    g.ajustes || 0,
    g.monto_pagar || 0,
    g.forma_pago || '',
    g.categoria || '',
    g.estado || 'Pendiente',
    g.fecha_pago || '',
    g.credit_days || 0,
    g.comprobante || '',
    '',
    g.created_at || new Date().toISOString(),
    g.items_json || '',
    fotoUrl
  ];

  sheet.appendRow(row);
  log('CREATE', gastoId + ' | ' + g.proveedor + ' | $' + g.monto_pagar + (fotoUrl ? ' | 📷' : ''));
  return { ok: true, id: row[0], foto_url: fotoUrl, message: 'Factura registrada' };
}

function listFacturas(params) {
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return { facturas: [] };

  const headers = data[0];
  let rows = data.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });

  // Filters
  if (params.estado)  rows = rows.filter(r => r.Estado === params.estado);
  if (params.year)    rows = rows.filter(r => String(r.Fecha_Compra).startsWith(params.year) || String(r.Fecha_Pago).startsWith(params.year));
  if (params.forma)   rows = rows.filter(r => r.Forma_Pago === params.forma);

  return { facturas: rows, total: rows.length };
}

function getFactura(id) {
  if (!id) throw new Error('Missing id');
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const obj = {};
      headers.forEach((h, j) => obj[h] = data[i][j]);
      return { factura: obj };
    }
  }
  throw new Error('Not found: ' + id);
}

function updateStatus(body) {
  const { id, estado, fecha_pago_real, comprobante, pdf_base64, proveedor } = body;
  if (!id || !estado) throw new Error('Missing id or estado');
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();

  // Save comprobante PDF to Drive if provided
  let compValue = comprobante || '';
  if (pdf_base64 && pdf_base64.length > 100) {
    try {
      compValue = saveComprobanteToDrive(id, pdf_base64, proveedor || 'pago');
    } catch(err) {
      log('COMP_PDF_ERROR', id + ': ' + err.message);
    }
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const estadoCol  = FACTURAS_HEADERS.indexOf('Estado') + 1;
      const realCol    = FACTURAS_HEADERS.indexOf('Fecha_Pago_Real') + 1;
      const compCol    = FACTURAS_HEADERS.indexOf('Comprobante') + 1;
      sheet.getRange(i + 1, estadoCol).setValue(estado);
      if (fecha_pago_real) sheet.getRange(i + 1, realCol).setValue(fecha_pago_real);
      if (compValue) sheet.getRange(i + 1, compCol).setValue(compValue);
      log('UPDATE_STATUS', id + ' → ' + estado + (pdf_base64 ? ' | 📎 PDF' : ''));
      return { ok: true, message: 'Status updated', comprobante_url: compValue };
    }
  }
  throw new Error('Not found: ' + id);
}

function updateDate(body) {
  const { id, fecha_pago, estado } = body;
  if (!id || !fecha_pago) throw new Error('Missing id or fecha_pago');
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const fpCol = FACTURAS_HEADERS.indexOf('Fecha_Pago') + 1;
      sheet.getRange(i + 1, fpCol).setValue(fecha_pago);
      if (estado) {
        const esCol = FACTURAS_HEADERS.indexOf('Estado') + 1;
        sheet.getRange(i + 1, esCol).setValue(estado);
      }
      log('UPDATE_DATE', id + ' → ' + fecha_pago);
      return { ok: true, message: 'Date updated' };
    }
  }
  throw new Error('Not found: ' + id);
}

function deleteFactura(body) {
  const { id } = body;
  if (!id) throw new Error('Missing id');
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      log('DELETE', id);
      return { ok: true, message: 'Deleted' };
    }
  }
  throw new Error('Not found: ' + id);
}

// ══════════════════════════════════════════════
// PRICE UPDATES → MATERIA PRIMA
// ══════════════════════════════════════════════

function updatePrices(body) {
  const items = body.items;
  if (!items || !items.length) throw new Error('No items to update');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName(MP_TAB);
  if (!mp) throw new Error('Tab "' + MP_TAB + '" not found');

  const data = mp.getDataRange().getValues();
  // Column A = ingredient name, Column B = cost/price
  // Find matching rows and update price
  let updated = 0;
  const nameCol = 0; // A
  const costCol = 1; // B

  items.forEach(item => {
    const bdName = (item.bd_name || '').trim().toLowerCase();
    const newPrice = item.precio_base || item.price;
    if (!bdName || !newPrice) return;

    for (let i = 1; i < data.length; i++) {
      const cellName = String(data[i][nameCol] || '').trim().toLowerCase();
      if (cellName === bdName) {
        mp.getRange(i + 1, costCol + 1).setValue(newPrice);
        updated++;
        break;
      }
    }
  });

  log('UPDATE_PRICES', updated + ' ingredients updated');
  return { ok: true, updated, message: updated + ' prices updated in MATERIA PRIMA' };
}

// ══════════════════════════════════════════════
// GOOGLE DRIVE PHOTO STORAGE
// ══════════════════════════════════════════════

/**
 * Get or create the NB_Fotos folder in Drive
 */
function getFotoFolder() {
  const folders = DriveApp.getFoldersByName(FOTO_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(FOTO_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

/**
 * Get or create NB_Comprobantes folder
 */
function getComprobanteFolder() {
  const folders = DriveApp.getFoldersByName(COMP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(COMP_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

/**
 * Save comprobante PDF to Drive, return shareable link
 */
function saveComprobanteToDrive(gastoId, base64Data, proveedor) {
  if (!base64Data || base64Data.length < 100) return '';
  const folder = getComprobanteFolder();
  const cleanProv = (proveedor || 'comp').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const today = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyyMMdd');
  const fileName = today + '_' + cleanProv + '_' + gastoId + '.pdf';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'application/pdf', fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  log('COMPROBANTE', gastoId + ' → ' + fileName);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

/**
 * Save base64 JPEG to Drive, return shareable thumbnail URL
 */
function saveFotoToDrive(gastoId, base64Data, proveedor) {
  if (!base64Data || base64Data.length < 100) return '';
  const folder = getFotoFolder();
  const cleanProv = (proveedor || 'foto').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const fileName = gastoId + '_' + cleanProv + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', fileName);
  const file = folder.createFile(blob);
  // Make viewable by anyone with link
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Return direct thumbnail URL (works in <img> tags without auth)
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

/**
 * Clean up photos older than 3 months.
 * Run this manually or set up a daily time-driven trigger:
 *   Triggers → Add Trigger → cleanupOldFotos → Time-driven → Day timer
 */
/**
 * One-time fix: Set all non-Transferencia invoices with Pendiente status to Pagado.
 * Run once manually to fix historical data.
 */
function fixNonTransferEstados() {
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const fpCol = FACTURAS_HEADERS.indexOf('Forma_Pago');
  const estCol = FACTURAS_HEADERS.indexOf('Estado') + 1;
  let fixed = 0;
  for (let i = 1; i < data.length; i++) {
    const fp = String(data[i][fpCol] || '').toLowerCase();
    const estado = String(data[i][estCol - 1] || '');
    if (!fp.includes('transferencia') && estado === 'Pendiente') {
      sheet.getRange(i + 1, estCol).setValue('Pagado');
      fixed++;
    }
  }
  log('FIX_ESTADOS', fixed + ' non-transfer invoices set to Pagado');
  return { ok: true, fixed };
}

function cleanupOldFotos() {
  const folder = getFotoFolder();
  const files = folder.getFiles();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FOTO_MAX_AGE_DAYS);
  let deleted = 0;

  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() < cutoff) {
      // Also clear the URL from the Sheet
      clearFotoUrlFromSheet(file.getName().split('_')[0]); // gastoId is before first underscore
      file.setTrashed(true);
      deleted++;
    }
  }
  log('CLEANUP_FOTOS', deleted + ' photos older than ' + FOTO_MAX_AGE_DAYS + ' days removed');
  return { ok: true, deleted };
}

/**
 * Clear Foto_URL in Sheet when photo is deleted
 */
function clearFotoUrlFromSheet(gastoId) {
  try {
    const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
    const data = sheet.getDataRange().getValues();
    const fotoCol = FACTURAS_HEADERS.indexOf('Foto_URL') + 1;
    if (fotoCol < 1) return;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(gastoId)) {
        sheet.getRange(i + 1, fotoCol).setValue('');
        break;
      }
    }
  } catch(e) { /* silent */ }
}

// ══════════════════════════════════════════════
// INVENTORY PRODUCTS CRUD
// ══════════════════════════════════════════════

function listProducts() {
  const sheet = getOrCreateTab(INV_TAB, INV_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { products: [], count: 0 };
  const headers = data[0].map(h => String(h).trim());
  const products = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, j) => { row[h] = data[i][j]; });
    // Normalize booleans
    row.Activo = String(row.Activo).toUpperCase() === 'TRUE' || row.Activo === true;
    row.Inventario_Min = parseFloat(row.Inventario_Min) || 0;
    row.Inventario_Max = parseFloat(row.Inventario_Max) || 0;
    products.push(row);
  }
  return { products, count: products.length };
}

function addProduct(body) {
  const sheet = getOrCreateTab(INV_TAB, INV_HEADERS);
  const p = body.product || body;
  const id = p.ID || 'P' + Date.now();
  const row = [
    id,
    p.Producto || '',
    p.Categoria || '',
    p.Ubicacion || '',
    p.Tienda || '',
    p.Unidad || '',
    p.Forma_Pedido || 'Ir a tienda',
    p.Inventario_Min || 0,
    p.Inventario_Max || 0,
    p.Activo !== undefined ? p.Activo : true,
    p.Temporada || 'Siempre',
    p.Tags || '',
    p.Grupo || '',
    p.Presentacion || ''
  ];
  sheet.appendRow(row);
  log('ADD_PRODUCT', id + ' | ' + p.Producto);
  return { ok: true, id, message: 'Producto agregado' };
}

function toggleProduct(body) {
  const { id, active } = body;
  if (!id) throw new Error('Missing product id');
  const sheet = getOrCreateTab(INV_TAB, INV_HEADERS);
  const data = sheet.getDataRange().getValues();
  const activoCol = INV_HEADERS.indexOf('Activo') + 1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, activoCol).setValue(active !== false);
      log('TOGGLE_PRODUCT', id + ' → ' + (active !== false ? 'ON' : 'OFF'));
      return { ok: true, message: 'Producto ' + (active !== false ? 'activado' : 'desactivado') };
    }
  }
  throw new Error('Product not found: ' + id);
}

function updateProduct(body) {
  const { id, fields } = body;
  if (!id || !fields) throw new Error('Missing id or fields');
  const sheet = getOrCreateTab(INV_TAB, INV_HEADERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      Object.keys(fields).forEach(key => {
        const col = INV_HEADERS.indexOf(key);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(fields[key]);
      });
      log('UPDATE_PRODUCT', id + ' | ' + Object.keys(fields).join(','));
      return { ok: true, message: 'Producto actualizado' };
    }
  }
  throw new Error('Product not found: ' + id);
}

/**
 * One-time: Seed INVENTARIO_PRODUCTOS from the hardcoded product list.
 * Run this once to populate the Sheet, then the app reads from Sheet.
 */
function seedProductsFromArray() {
  const sheet = getOrCreateTab(INV_TAB, INV_HEADERS);
  if (sheet.getLastRow() > 1) {
    log('SEED_SKIP', 'Products tab already has data (' + (sheet.getLastRow()-1) + ' rows)');
    return { ok: false, message: 'Tab already has data. Clear it first if you want to re-seed.' };
  }
  // This will be called from the inventory app with the full product array
  return { ok: true, message: 'Ready for seeding. Send products via add_product.' };
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function getOrCreateTab(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function log(action, detail) {
  try {
    const sheet = getOrCreateTab(LOG_TAB, ['Timestamp', 'Action', 'Detail']);
    sheet.appendRow([new Date().toISOString(), action, detail || '']);
    // Keep log trimmed to 500 rows
    const rows = sheet.getLastRow();
    if (rows > 501) sheet.deleteRows(2, rows - 501);
  } catch(e) { /* silent */ }
}

function jsonResp(data, code) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
