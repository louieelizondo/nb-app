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
  'Comprobante', 'Fecha_Pago_Real', 'Created_At', 'Items_JSON', 'Foto_URL',
  'Version'
];

// Inventory Products
const INV_TAB = 'INVENTARIO_PRODUCTOS';
const INV_HEADERS = [
  'ID', 'Producto', 'Categoria', 'Ubicacion', 'Tienda', 'Unidad',
  'Unidad_Compra',                              // pu: what you ORDER in (Caja 5kg, Bulto 10kg)
  'Forma_Pedido', 'Inventario_Min', 'Inventario_Max', 'Activo',
  'Temporada', 'Tags', 'Variantes'
];

// NEW: Inventory Count History
const INV_LOG_TAB = 'INVENTARIO_LOG';
const INV_LOG_HEADERS = [
  'Timestamp', 'Producto', 'Cantidad', 'Seccion', 'Categoria', 'Variante', 'Contó', 'Dispositivo'
];

// NEW: Orders tracking
const PEDIDOS_TAB = 'PEDIDOS_LOG';
const PEDIDOS_HEADERS = [
  'ID', 'Proveedor', 'Productos_JSON', 'Modo', 'Status',
  'Ordenado_por', 'Ordenado_at', 'Recibido_por', 'Recibido_at', 'Notas'
];

// NEW: Cross-app audit trail
const AUDIT_TAB = 'AUDIT_LOG';
const AUDIT_HEADERS = ['Timestamp', 'App', 'Action', 'User_Device', 'Details'];

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
      case 'list_orders':   return jsonResp(listOrders());
      case 'seed_from_mp':  return jsonResp(seedProductsFromMP());
      case 'health':        return jsonResp({ ok: true, ts: new Date().toISOString() });
      // Cortes & Ingresos
      case 'get_cortes_dia':       return jsonResp(getCortesDia(e.parameter));
      case 'get_corte_tienda':     return jsonResp(getCorteTienda(e.parameter));
      case 'get_arqueos':          return jsonResp(getArqueos(e.parameter));
      case 'get_transferencias':   return jsonResp(getTransferencias(e.parameter));
      case 'get_ingresos':         return jsonResp(getIngresos(e.parameter));
      case 'get_monthly_summary':  return jsonResp(getMonthlySummary(e.parameter));
      case 'get_dashboard_data':   return jsonResp(getDashboardData(e.parameter));
      case 'get_payment_trends':   return jsonResp(getPaymentTrends(e.parameter));
      case 'get_faltante_history': return jsonResp(getFaltanteHistory(e.parameter));
      case 'get_mesa_sales':       return jsonResp(getMesaSales(e.parameter));
      case 'get_config_cajas':     return jsonResp({ cajas: getConfigCajas() });
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
      case 'delete':           return jsonResp(deleteFactura(body));
      case 'update_factura':   return jsonResp(updateFactura(body));
      case 'claude_analyze':   return jsonResp(claudeAnalyze(body));
      case 'update_prices':    return jsonResp(updatePrices(body));
      case 'rename_ingredient': return jsonResp(renameIngredient(body));
      case 'add_product':      return jsonResp(addProduct(body));
      case 'toggle_product':   return jsonResp(toggleProduct(body));
      case 'update_product':   return jsonResp(updateProduct(body));
      case 'log_inventory':    return jsonResp(logInventoryCounts(body));
      case 'save_order':       return jsonResp(saveOrder(body));
      case 'update_order':     return jsonResp(updateOrder(body));
      case 'audit':            return jsonResp(writeAudit(body));
      case 'sync_batch':       return jsonResp(processSyncBatch(body));
      case 'add_ingredient':       return jsonResp(addIngredient(body));
      case 'add_proveedor':        return jsonResp(addProveedor(body));
      case 'save_shopping_list':   return jsonResp(saveShoppingList(body));
      // Cortes & Ingresos
      case 'save_corte_individual':   return jsonResp(saveCorteIndividual(body));
      case 'delete_corte_individual': return jsonResp(deleteCorteIndividual(body));
      case 'save_corte_tienda':       return jsonResp(saveCorteTienda(body));
      case 'save_arqueo':             return jsonResp(saveArqueo(body));
      case 'save_transferencia':      return jsonResp(saveTransferencia(body));
      case 'save_ingreso':            return jsonResp(saveIngreso(body));
      case 'update_sobre2':           return jsonResp(updateSobre2(body));
      case 'update_facturacion':      return jsonResp(updateFacturacion(body));
      case 'update_neto_mensual':     return jsonResp(updateNetoMensual(body));
      case 'sync_shopify':            return jsonResp(syncShopifyDaily(body));
      case 'update_config_cajas':     return jsonResp(updateConfigCajas(body));
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

  // Save photo to Google Drive if provided (prefer full-res over thumbnail)
  let fotoUrl = '';
  const fotoData = g.foto_full || g.foto;
  if (fotoData) {
    try {
      fotoUrl = saveFotoToDrive(gastoId, fotoData, g.proveedor || 'unknown', g.folio || '');
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
    fotoUrl,
    1  // Version starts at 1
  ];

  sheet.appendRow(row);
  log('CREATE', gastoId + ' | ' + g.proveedor + ' | $' + g.monto_pagar + (fotoUrl ? ' | 📷' : ''));
  return { ok: true, id: row[0], foto_url: fotoUrl, version: 1, message: 'Factura registrada' };
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

/**
 * Check version and bump it. Returns { ok, row, sheetVersion } or throws conflict.
 * If client sends no version, skip check (backwards compat for old clients).
 */
function checkVersionAndBump(sheet, rowIndex, clientVersion) {
  const vCol = FACTURAS_HEADERS.indexOf('Version') + 1;
  if (vCol < 1) return { ok: true }; // no version column yet
  const sheetVersion = parseInt(sheet.getRange(rowIndex, vCol).getValue()) || 0;
  if (clientVersion !== undefined && clientVersion !== null && clientVersion !== '') {
    const cv = parseInt(clientVersion);
    if (!isNaN(cv) && cv !== sheetVersion) {
      return {
        ok: false,
        conflict: true,
        sheetVersion,
        clientVersion: cv,
        message: 'Conflict: your version (' + cv + ') differs from current (' + sheetVersion + '). Please reload.'
      };
    }
  }
  // Bump version
  const newVersion = sheetVersion + 1;
  sheet.getRange(rowIndex, vCol).setValue(newVersion);
  return { ok: true, newVersion };
}

function updateStatus(body) {
  const { id, estado, fecha_pago_real, comprobante, pdf_base64, proveedor, version } = body;
  if (!id || !estado) throw new Error('Missing id or estado');
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();

  // Save comprobante PDF to Drive if provided
  let compValue = comprobante || '';

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      // Get folio from row for better filename
      const folioCol = FACTURAS_HEADERS.indexOf('Folio');
      const rowFolio = folioCol >= 0 ? String(data[i][folioCol] || '') : '';
      if (pdf_base64 && pdf_base64.length > 100) {
        try {
          compValue = saveComprobanteToDrive(id, pdf_base64, proveedor || 'pago', rowFolio);
        } catch(err) {
          log('COMP_PDF_ERROR', id + ': ' + err.message);
        }
      }
      // Version conflict check
      const vc = checkVersionAndBump(sheet, i + 1, version);
      if (!vc.ok) return vc; // returns conflict response, not throw

      const estadoCol  = FACTURAS_HEADERS.indexOf('Estado') + 1;
      const realCol    = FACTURAS_HEADERS.indexOf('Fecha_Pago_Real') + 1;
      const compCol    = FACTURAS_HEADERS.indexOf('Comprobante') + 1;
      sheet.getRange(i + 1, estadoCol).setValue(estado);
      if (fecha_pago_real) sheet.getRange(i + 1, realCol).setValue(fecha_pago_real);
      if (compValue) sheet.getRange(i + 1, compCol).setValue(compValue);
      log('UPDATE_STATUS', id + ' → ' + estado + (pdf_base64 ? ' | 📎 PDF' : '') + ' v' + (vc.newVersion||'?'));
      return { ok: true, message: 'Status updated', comprobante_url: compValue, version: vc.newVersion };
    }
  }
  throw new Error('Not found: ' + id);
}

function updateDate(body) {
  const { id, fecha_pago, estado, version } = body;
  if (!id || !fecha_pago) throw new Error('Missing id or fecha_pago');
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      // Version conflict check
      const vc = checkVersionAndBump(sheet, i + 1, version);
      if (!vc.ok) return vc;

      const fpCol = FACTURAS_HEADERS.indexOf('Fecha_Pago') + 1;
      sheet.getRange(i + 1, fpCol).setValue(fecha_pago);
      if (estado) {
        const esCol = FACTURAS_HEADERS.indexOf('Estado') + 1;
        sheet.getRange(i + 1, esCol).setValue(estado);
      }
      log('UPDATE_DATE', id + ' → ' + fecha_pago + ' v' + (vc.newVersion||'?'));
      return { ok: true, message: 'Date updated', version: vc.newVersion };
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

function updateFactura(body) {
  const { id, version } = body;
  if (!id) throw new Error('Missing id');
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();

  // Fields that can be updated via inline edit
  const editableFields = [
    'Proveedor', 'Folio', 'Tipo_Documento', 'Fecha_Compra',
    'Monto_Factura', 'Ajustes', 'Monto_Pagar',
    'Forma_Pago', 'Categoria', 'Credit_Days'
  ];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      // Version conflict check
      const vc = checkVersionAndBump(sheet, i + 1, version);
      if (!vc.ok) return vc;

      editableFields.forEach(field => {
        if (body[field] !== undefined) {
          const col = FACTURAS_HEADERS.indexOf(field) + 1;
          if (col > 0) sheet.getRange(i + 1, col).setValue(body[field]);
        }
      });
      log('UPDATE_FACTURA', id + ' | fields: ' + Object.keys(body).filter(k => editableFields.includes(k)).join(',') + ' v' + (vc.newVersion||'?'));
      return { ok: true, message: 'Factura updated', version: vc.newVersion };
    }
  }
  throw new Error('Not found: ' + id);
}

// ══════════════════════════════════════════════
// CLAUDE API PROXY — keeps API key server-side
// ══════════════════════════════════════════════

/**
 * Proxy Claude vision call. Client sends image + prompt, we call Claude
 * using the API key stored in Script Properties.
 *
 * SETUP: In Apps Script editor → Project Settings → Script Properties →
 *   Add: CLAUDE_API_KEY = sk-ant-api03-...
 */
function claudeAnalyze(body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in Script Properties. Go to Project Settings → Script Properties.');

  const imageBase64 = body.image_base64;
  const prompt = body.prompt;
  if (!imageBase64 || !prompt) throw new Error('Missing image_base64 or prompt');

  const payload = {
    model: body.model || 'claude-sonnet-4-6',
    max_tokens: body.max_tokens || 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: body.media_type || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: prompt }
      ]
    }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Retry logic: 3 attempts with exponential backoff
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
      const code = resp.getResponseCode();
      if (code === 429 || code === 529 || code >= 500) {
        Utilities.sleep(attempt * 3000);
        continue;
      }
      const result = JSON.parse(resp.getContentText());
      if (code !== 200) {
        throw new Error(result.error?.message || 'Claude API error ' + code);
      }
      log('CLAUDE_ANALYZE', 'ok | tokens: ' + (result.usage?.input_tokens || '?') + '/' + (result.usage?.output_tokens || '?'));
      return { ok: true, result };
    } catch(e) {
      lastErr = e;
      if (attempt < 3) Utilities.sleep(attempt * 2000);
    }
  }
  throw new Error('Claude API failed after 3 attempts: ' + (lastErr?.message || 'unknown'));
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
  // MATERIA PRIMA columns:
  // A(0)=Ingrediente, B(1)=Categoría, C(2)=CostoPaq, D(3)=Fecha,
  // E(4)=UnidsCaja, F(5)=VolUnid, G(6)=Unidad, H(7)=Costo/kg-L (formula)
  // Write whole-package price to Column C (CostoPaq)
  // Column H (Costo/kg or /L) is a formula derived from C — don't touch it
  let updated = 0;
  const nameCol = 0;     // A = ingredient name
  const costPaqCol = 2;  // C = whole-package cost (CostoPaq)
  const fechaCol = 3;    // D = last price date

  let renamed = 0;
  items.forEach(item => {
    const bdName = (item.bd_name || '').trim().toLowerCase();
    // Use precio_unitario (whole-package price from invoice), NOT precio_base (per-kg/L)
    const newPrice = item.precio_unitario || item.price;
    const invoiceName = (item.invoice_name || '').trim();
    if (!bdName || !newPrice) return;

    for (let i = 1; i < data.length; i++) {
      const cellName = String(data[i][nameCol] || '').trim().toLowerCase();
      if (cellName === bdName) {
        mp.getRange(i + 1, costPaqCol + 1).setValue(newPrice);  // Col C: Costo x Paquete
        mp.getRange(i + 1, fechaCol + 1).setValue(new Date());   // Col D: Fecha actualizada
        // Rename col A to formal invoice name if provided and different
        if (invoiceName && invoiceName.toLowerCase() !== cellName) {
          mp.getRange(i + 1, nameCol + 1).setValue(invoiceName); // Col A: nombre formal
          renamed++;
        }
        updated++;
        break;
      }
    }
  });

  log('UPDATE_PRICES', updated + ' updated, ' + renamed + ' renamed in MATERIA PRIMA');
  return { ok: true, updated, renamed, message: updated + ' prices updated, ' + renamed + ' renamed' };
}

/**
 * Rename an ingredient in MATERIA PRIMA col A.
 * Called when the user confirms a mapping — the invoice name becomes the new canonical name.
 * body: { old_name: "Aceite vegetal 20L", new_name: "ACEITE VEGETAL NUTRIOLI 20L" }
 */
function renameIngredient(body) {
  const oldName = (body.old_name || '').trim();
  const newName = (body.new_name || '').trim();
  if (!oldName || !newName) throw new Error('old_name and new_name required');
  if (oldName.toLowerCase() === newName.toLowerCase()) return { ok: true, renamed: false, message: 'Names already match' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName(MP_TAB);
  if (!mp) throw new Error('Tab "' + MP_TAB + '" not found');

  const data = mp.getDataRange().getValues();
  const nameCol = 0; // A = Ingrediente
  const oldLower = oldName.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameCol] || '').trim().toLowerCase() === oldLower) {
      mp.getRange(i + 1, nameCol + 1).setValue(newName);
      log('RENAME_INGREDIENT', '"' + oldName + '" → "' + newName + '"');
      return { ok: true, renamed: true, message: 'Renamed: ' + oldName + ' → ' + newName };
    }
  }
  return { ok: true, renamed: false, message: 'Ingredient not found: ' + oldName };
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
function saveComprobanteToDrive(gastoId, base64Data, proveedor, folio) {
  if (!base64Data || base64Data.length < 100) return '';
  const folder = getComprobanteFolder();
  const cleanProv = (proveedor || 'comp').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const cleanFolio = (folio || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const today = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyyMMdd');
  const fileName = (cleanFolio || gastoId) + '_' + cleanProv + '_' + today + '.pdf';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'application/pdf', fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  log('COMPROBANTE', gastoId + ' → ' + fileName);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

/**
 * Save base64 JPEG to Drive, return shareable thumbnail URL
 */
function saveFotoToDrive(gastoId, base64Data, proveedor, folio) {
  if (!base64Data || base64Data.length < 100) return '';
  const folder = getFotoFolder();
  const cleanProv = (proveedor || 'foto').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const cleanFolio = (folio || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const today = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyyMMdd');
  const fileName = (cleanFolio || gastoId) + '_' + cleanProv + '_' + today + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', fileName);
  const file = folder.createFile(blob);
  // Make viewable by anyone with link
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Return high-res thumbnail URL (2048px — readable for invoice details)
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w2048';
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
    p.Unidad_Compra || '',                // pu: purchase/order unit label
    p.Forma_Pedido || 'Ir a tienda',
    p.Inventario_Min || 0,
    p.Inventario_Max || 0,
    p.Activo !== undefined ? p.Activo : true,
    p.Temporada || 'Siempre',
    p.Tags || '',
    p.Variantes || ''
  ];
  sheet.appendRow(row);
  log('ADD_PRODUCT', id + ' | ' + p.Producto);

  // Cross-write to MATERIA PRIMA so recipes can reference it
  // addIngredient checks for duplicates, safe to call every time
  try {
    addIngredient({
      Nombre:    p.Producto   || '',
      Categoria: p.Categoria  || '',
      Unidad:    p.Unidad     || 'PZA',
      CostoPaq:  0
    });
  } catch(e) {
    log('ADD_PRODUCT_MP_WARN', 'Could not cross-write to MATERIA PRIMA: ' + e.message);
  }

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
// SEED INVENTARIO_PRODUCTOS FROM MATERIA PRIMA
// ══════════════════════════════════════════════

/**
 * One-time (or safe-to-repeat) sync: read every row from MATERIA PRIMA
 * and add any missing entries into INVENTARIO_PRODUCTOS.
 * Matches by product name (case-insensitive). Will never create duplicates.
 * Call via GET ?action=seed_from_mp
 */
function seedProductsFromMP() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName(MP_TAB);
  if (!mp) throw new Error('Tab "' + MP_TAB + '" no encontrado');

  const mpData = mp.getDataRange().getValues();
  if (mpData.length < 2) return { ok: true, seeded: 0, skipped: 0, message: 'MATERIA PRIMA está vacío' };

  // Build set of existing names in INVENTARIO_PRODUCTOS (col 1 = Producto)
  const invSheet = getOrCreateTab(INV_TAB, INV_HEADERS);
  const invData  = invSheet.getDataRange().getValues();
  const existing = new Set();
  for (let i = 1; i < invData.length; i++) {
    const n = String(invData[i][1] || '').trim().toLowerCase();
    if (n) existing.add(n);
  }

  // MP cols: A(0)=Ingrediente, B(1)=Categoría, G(6)=Unidad
  let seeded = 0, skipped = 0;
  for (let i = 1; i < mpData.length; i++) {
    const ingrediente = String(mpData[i][0] || '').trim();
    if (!ingrediente) continue;
    if (existing.has(ingrediente.toLowerCase())) { skipped++; continue; }

    const categoria = String(mpData[i][1] || '').trim();
    const unidad    = String(mpData[i][6] || 'PZA').trim();
    const safeId    = ingrediente.replace(/[^A-Za-z0-9]/g, '').substring(0, 12).toUpperCase();
    const id        = 'MP_' + safeId + '_' + i;

    invSheet.appendRow([
      id, ingrediente, categoria,
      '',            // Ubicacion
      '',            // Tienda
      unidad,        // Unidad (counting unit)
      '',            // Unidad_Compra (purchase unit — fill in manually)
      'Ir a tienda', // Forma_Pedido
      0,             // Inventario_Min
      0,             // Inventario_Max
      true,          // Activo
      'Siempre',     // Temporada
      '',            // Tags
      ''             // Variantes
    ]);
    existing.add(ingrediente.toLowerCase());
    seeded++;
  }

  log('SEED_FROM_MP', seeded + ' importados, ' + skipped + ' ya existían');
  return { ok: true, seeded, skipped, message: seeded + ' productos importados de MATERIA PRIMA, ' + skipped + ' ya existían' };
}

// ══════════════════════════════════════════════
// SHOPPING LIST → GOOGLE SHEETS
// ══════════════════════════════════════════════

const LISTA_TAB     = 'LISTA_COMPRAS';
const LISTA_HEADERS = ['Timestamp', 'Producto', 'Categoria', 'Qty_Pedido', 'Unidad', 'Forma_Pedido', 'Tienda', 'Guardado_Por'];

/**
 * Save the current shopping list to LISTA_COMPRAS tab (replaces previous list).
 * body: { items: [{producto, categoria, qty, unidad, forma_pedido, tienda}], quien: string }
 */
function saveShoppingList(body) {
  const items = body.items;
  if (!items || !items.length) throw new Error('No items en la lista');

  const sheet = getOrCreateTab(LISTA_TAB, LISTA_HEADERS);

  // Clear previous list (keep header row)
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }

  const ts    = new Date().toISOString();
  const quien = body.quien || 'App';

  const rows = items.map(it => [
    ts,
    it.producto    || it.n || '',
    it.categoria   || it.c || '',
    it.qty         || 0,
    it.unidad      || it.u || '',
    it.forma_pedido|| it.f || '',
    it.tienda      || it.s || '',
    quien
  ]);

  sheet.getRange(2, 1, rows.length, LISTA_HEADERS.length).setValues(rows);
  log('SAVE_SHOPPING_LIST', rows.length + ' items por ' + quien);
  return { ok: true, saved: rows.length, message: rows.length + ' productos guardados en LISTA_COMPRAS' };
}

// ══════════════════════════════════════════════
// INVENTORY COUNT HISTORY
// ══════════════════════════════════════════════

function logInventoryCounts(body) {
  const items = body.items;
  if (!items || !items.length) throw new Error('No items to log');
  const sheet = getOrCreateTab(INV_LOG_TAB, INV_LOG_HEADERS);
  const ts = new Date().toISOString();
  const quien = body.quien || 'Desconocido';
  const device = body.device || 'web';

  const rows = items.map(item => [
    ts,
    item.producto || '',
    item.cantidad,
    item.seccion || '',
    item.categoria || '',
    item.variante || '',
    quien,
    device
  ]);

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, INV_LOG_HEADERS.length).setValues(rows);
  }

  // Trim to last 10,000 rows to prevent Sheet bloat
  const totalRows = sheet.getLastRow();
  if (totalRows > 10001) {
    sheet.deleteRows(2, totalRows - 10001);
  }

  log('INV_COUNT', items.length + ' products counted by ' + quien);
  writeAuditInternal('Inventario', 'SECTION_COUNTED', device, items.length + ' products | ' + (items[0]?.seccion || ''));
  return { ok: true, logged: rows.length, message: items.length + ' conteos registrados' };
}

// ══════════════════════════════════════════════
// ORDERS TRACKING
// ══════════════════════════════════════════════

function saveOrder(body) {
  const sheet = getOrCreateTab(PEDIDOS_TAB, PEDIDOS_HEADERS);
  const o = body.order || body;
  const id = o.id || 'ORD' + Date.now();
  const row = [
    id,
    o.supplier || o.proveedor || '',
    JSON.stringify(o.items || []),
    o.mode || o.modo || '',
    o.status || 'ordered',
    o.ordered_by || '',
    o.ordered_at || new Date().toISOString(),
    '', '', ''
  ];
  sheet.appendRow(row);
  log('SAVE_ORDER', id + ' | ' + o.supplier);
  writeAuditInternal('Inventario', 'ORDER_PLACED', '', id + ' | ' + o.supplier + ' | ' + (o.items||[]).length + ' items');
  return { ok: true, id, message: 'Pedido registrado' };
}

function updateOrder(body) {
  const { id } = body;
  if (!id) throw new Error('Missing order id');
  const sheet = getOrCreateTab(PEDIDOS_TAB, PEDIDOS_HEADERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      if (body.status) {
        const col = PEDIDOS_HEADERS.indexOf('Status') + 1;
        sheet.getRange(i + 1, col).setValue(body.status);
      }
      if (body.received_by || body.recibido_por) {
        const col = PEDIDOS_HEADERS.indexOf('Recibido_por') + 1;
        sheet.getRange(i + 1, col).setValue(body.received_by || body.recibido_por);
      }
      if (body.received_at || body.recibido_at) {
        const col = PEDIDOS_HEADERS.indexOf('Recibido_at') + 1;
        sheet.getRange(i + 1, col).setValue(body.received_at || body.recibido_at);
      }
      if (body.notes || body.notas) {
        const col = PEDIDOS_HEADERS.indexOf('Notas') + 1;
        sheet.getRange(i + 1, col).setValue(body.notes || body.notas);
      }
      log('UPDATE_ORDER', id + ' → ' + (body.status || ''));
      writeAuditInternal('Inventario', 'ORDER_RECEIVED', body.received_by || '', id);
      return { ok: true, message: 'Pedido actualizado' };
    }
  }
  throw new Error('Order not found: ' + id);
}

function listOrders() {
  const sheet = getOrCreateTab(PEDIDOS_TAB, PEDIDOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { orders: [], count: 0 };
  const headers = data[0];
  const orders = data.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i]);
    try { obj.items = JSON.parse(obj.Productos_JSON || '[]'); } catch(e) { obj.items = []; }
    return obj;
  });
  return { orders, count: orders.length };
}

// ══════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════

function writeAudit(body) {
  writeAuditInternal(body.app || '', body.action_name || body.action_detail || '', body.user_device || '', body.details || '');
  return { ok: true };
}

function writeAuditInternal(app, actionName, userDevice, details) {
  try {
    const sheet = getOrCreateTab(AUDIT_TAB, AUDIT_HEADERS);
    sheet.appendRow([new Date().toISOString(), app, actionName, userDevice, details]);
    // Trim to 5,000 rows
    const rows = sheet.getLastRow();
    if (rows > 5001) sheet.deleteRows(2, rows - 5001);
  } catch(e) { /* silent */ }
}

// ══════════════════════════════════════════════
// SYNC BATCH — process multiple queued operations at once
// ══════════════════════════════════════════════

function processSyncBatch(body) {
  const ops = body.operations || [];
  if (!ops.length) return { ok: true, results: [], message: 'No operations' };

  const results = [];
  for (const op of ops) {
    try {
      let result;
      switch (op.action) {
        case 'create':         result = createFactura(op); break;
        case 'update_status':  result = updateStatus(op); break;
        case 'update_date':    result = updateDate(op); break;
        case 'update_factura': result = updateFactura(op); break;
        case 'log_inventory':  result = logInventoryCounts(op); break;
        case 'save_order':     result = saveOrder(op); break;
        case 'update_order':   result = updateOrder(op); break;
        case 'audit':          result = writeAudit(op); break;
        // Cortes & Ingresos (offline-sync support)
        case 'save_corte_individual': result = saveCorteIndividual(op); break;
        case 'save_corte_tienda':     result = saveCorteTienda(op); break;
        case 'save_arqueo':           result = saveArqueo(op); break;
        case 'save_transferencia':    result = saveTransferencia(op); break;
        case 'save_ingreso':          result = saveIngreso(op); break;
        default: result = { ok: false, error: 'Unknown action: ' + op.action };
      }
      // If the inner function returned a conflict, bubble it up as not-ok
      if (result && result.conflict) {
        results.push({ queue_id: op.queue_id || null, ok: false, result });
      } else {
        results.push({ queue_id: op.queue_id || null, ok: true, result });
      }
    } catch(err) {
      results.push({ queue_id: op.queue_id || null, ok: false, error: err.message });
    }
  }

  log('SYNC_BATCH', results.length + ' ops processed, ' + results.filter(r => r.ok).length + ' ok');
  return { ok: true, results, processed: results.length };
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
  } else if (headers) {
    // Auto-migrate: add any new header columns that are missing
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    headers.forEach(h => {
      if (!existing.includes(h)) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue(h).setFontWeight('bold');
        existing.push(h);
      }
    });
  }
  return sheet;
}

// ══════════════════════════════════════════════
// ADD INGREDIENT → MATERIA PRIMA
// ══════════════════════════════════════════════

/**
 * Append a new row to MATERIA PRIMA.
 * body: { ingredient: { Nombre, Unidad, CostoPaq, Categoria } }
 * MATERIA PRIMA cols: A=Ingrediente, B=Categoría, C=CostoPaq, D=Fecha, E=UnidsCaja, F=VolUnid, G=Unidad
 */
function addIngredient(body) {
  const ing = body.ingredient || body;
  const nombre = (ing.Nombre || '').trim();
  if (!nombre) throw new Error('Nombre requerido');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName(MP_TAB);
  if (!mp) throw new Error('Tab "' + MP_TAB + '" not found');

  // Check for duplicate (case-insensitive)
  const data = mp.getDataRange().getValues();
  const exists = data.slice(1).some(r => String(r[0] || '').trim().toLowerCase() === nombre.toLowerCase());
  if (exists) return { ok: false, message: 'Ingrediente ya existe: ' + nombre };

  const row = [
    nombre,
    ing.Categoria || '',
    parseFloat(ing.CostoPaq) || 0,
    new Date(),
    '',        // UnidsCaja — blank
    '',        // VolUnid — blank
    ing.Unidad || 'PZA'
  ];
  mp.appendRow(row);
  log('ADD_INGREDIENT', nombre + ' | ' + (ing.Unidad || 'PZA') + ' | $' + (ing.CostoPaq || 0));
  return { ok: true, message: 'Ingrediente agregado: ' + nombre };
}

// ══════════════════════════════════════════════
// ADD PROVEEDOR → PROVEEDORES sheet
// ══════════════════════════════════════════════

/**
 * Append a new row to the PROVEEDORES sheet.
 * body: { proveedor: { Nombre, RFC, DiasCredito, FormaPago } }
 * PROVEEDORES cols: 0=Proveedor, 1=ContactoVentas, 2=ContactoPagos, 3=TelCompras, 4=TelPagos,
 *   5=Email, 6=FormaPago, 7=DíasCrédito, 8=Banco, 9=CLABE, 10=Cuenta,
 *   11=RazónSocial(RFC), 12=VíaPedido, 13=LigaFacturación, 14=Facturas2026, 15=CatGasto, 16=Fuente
 */
function addProveedor(body) {
  const prov = body.proveedor || body;
  const nombre = (prov.Nombre || '').trim();
  if (!nombre) throw new Error('Nombre requerido');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('PROVEEDORES');
  if (!sheet) {
    sheet = ss.insertSheet('PROVEEDORES');
    sheet.appendRow(['Proveedor','ContactoVentas','ContactoPagos','TelCompras','TelPagos',
      'Email','FormaPago','DíasCrédito','Banco','CLABE','Cuenta',
      'RazónSocial','VíaPedido','LigaFacturación','Facturas2026','CatGasto','Fuente']);
    sheet.getRange(1, 1, 1, 17).setFontWeight('bold');
  }

  // Check for duplicate
  const data = sheet.getDataRange().getValues();
  const exists = data.slice(1).some(r => String(r[0] || '').trim().toLowerCase() === nombre.toLowerCase());
  if (exists) return { ok: false, message: 'Proveedor ya existe: ' + nombre };

  const row = new Array(17).fill('');
  row[0]  = nombre;
  row[6]  = prov.FormaPago || '';
  row[7]  = parseInt(prov.DiasCredito) || 0;
  row[11] = prov.RFC || '';
  row[16] = 'App';  // Fuente — marca que se creó desde la app
  sheet.appendRow(row);
  log('ADD_PROVEEDOR', nombre + ' | RFC:' + (prov.RFC || '—') + ' | ' + (prov.DiasCredito || 0) + 'd');
  return { ok: true, message: 'Proveedor agregado: ' + nombre };
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
