/**
 * ═══════════════════════════════════════════════════════════════
 * NB · Cortes, Ingresos & Facturación — Apps Script Extension
 * ═══════════════════════════════════════════════════════════════
 *
 * ADD THIS FILE to your existing Apps Script project
 * (Extensions → Apps Script → + → Script → name it "cortes_ingresos")
 *
 * Then patch doGet/doPost in gastos_script.gs with the cases below.
 *
 * NEW TABS created automatically on first use:
 * - CORTES_INDIVIDUALES: per-register denomination counts
 * - CORTE_TIENDA: daily consolidated store cut
 * - ARQUEO_CAJA: petty cash reconciliation
 * - TRANSFERENCIAS_LOG: daily transfer records
 * - INGRESOS: master daily income + invoicing (the brain)
 * - NETO_MENSUAL: monthly income - expenses summary
 * - CONFIG_CAJAS: dynamic register configuration
 * - PORCENTAJES_MESA: editable bonus percentage matrix
 * - VENTAS_MESA: biweekly mesa sales + calculated bonuses
 */

// ══════════════════════════════════════════════
// TAB CONSTANTS & HEADERS
// ══════════════════════════════════════════════

const CORTES_IND_TAB = 'CORTES_INDIVIDUALES';
const CORTES_IND_HEADERS = [
  'ID', 'Fecha', 'Colaborador', 'Caja',
  'VentasCaja', 'Tarjeta', 'Transferencias', 'Cashback', 'StoreCredit', 'Retiros',
  // Denominations (bills)
  'D_1000', 'D_500', 'D_200', 'D_100', 'D_50', 'D_20',
  // Coins
  'D_10', 'D_5', 'D_2', 'D_1', 'D_050',
  // Calculated
  'TotalEfectivo', 'FaltanteSobrante',
  'Created_At', 'Device'
];

const CORTE_TIENDA_TAB = 'CORTE_TIENDA';
const CORTE_TIENDA_HEADERS = [
  'ID', 'Fecha', 'Colaborador',
  'VentasTotales', 'PagosRecibidos',
  'Tarjeta', 'Transferencias', 'Cashback', 'StoreCredit',
  // Denominations
  'D_1000', 'D_500', 'D_200', 'D_100', 'D_50', 'D_20',
  'D_10', 'D_5', 'D_2', 'D_1', 'D_050',
  'TotalEfectivo', 'FaltanteSobrante',
  // Shopify comparison
  'Shopify_VentasTotales', 'Shopify_Tarjeta', 'Shopify_Transferencias',
  'Shopify_Cashback', 'Shopify_StoreCredit',
  'Discrepancia',
  // Louie adjustments
  'Sobre2', 'DepositoAjustado',
  // Mesa/station sales
  'Cocina1', 'Cocina2', 'Cocina3',
  'Produccion1', 'Produccion2', 'Produccion3',
  'Casa1', 'Casa2', 'Express', 'Granja',
  'FrutasVerduras', 'Proveedor', 'MermasCanastas', 'Pedidos', 'Mixto',
  'IvaAVenta',
  'Created_At', 'Device'
];

const ARQUEO_TAB = 'ARQUEO_CAJA';
const ARQUEO_HEADERS = [
  'ID', 'Fecha', 'Colaborador', 'Caja',
  'Fondo1', 'Fondo2', 'Fondo3', 'Fondo4', 'FondoRepartidor1', 'FondoRepartidor2', 'BolsitaCambio', 'GastosReponer',
  // Denominations
  'D_1000', 'D_500', 'D_200', 'D_100', 'D_50', 'D_20',
  'D_10', 'D_5', 'D_2', 'D_1', 'D_050',
  'TotalEfectivo', 'TotalGeneral', 'FaltanteSobrante',
  'Created_At', 'Device'
];

const TRANSF_LOG_TAB = 'TRANSFERENCIAS_LOG';
const TRANSF_LOG_HEADERS = [
  'ID', 'Fecha', 'Colaborador', 'Monto', 'Concepto',
  'De_Cuenta', 'A_Cuenta', 'Referencia',
  'Created_At'
];

const INGRESOS_TAB = 'INGRESOS';
const INGRESOS_HEADERS = [
  'ID', 'Fecha', 'DiaSemana',
  // Payment totals
  'VentasDia', 'PagosRecibidos',
  'Tarjeta', 'Transferencias', 'Cashback',
  // Sobre 2 breakdown
  '2ndoSocios', '2ndoNominas', 'Sobre2',
  // Mesa/station sales (employee productivity)
  'Cocina1', 'Cocina2', 'Cocina3',
  'Produccion1', 'Produccion2', 'Produccion3',
  'Casa1', 'Casa2', 'Express', 'Granja',
  'FrutasVerduras', 'ProveedorVentas', 'MermasCanastas', 'Pedidos', 'Mixto',
  'IvaAVenta',
  // Deposit
  'DepositoBBVA',
  // Invoicing
  'FactClientes', 'FactGen1', 'FactGen2', 'FactGen3', 'FactGen4', 'FactGen5', 'FactGen6',
  'FacturasCFDI',
  'TotalFacturado', 'TotalXFacturar', 'FaltaFactura',
  // Meta
  'Mes', 'MesNumero',
  'Created_At', 'Updated_At'
];

const NETO_TAB = 'NETO_MENSUAL';
const NETO_HEADERS = [
  'Mes', 'MesNumero', 'Anio',
  'TotalIngresos', 'TotalGastos', 'Neto',
  'TotalXFacturar', 'TotalFacturado', 'FaltaFacturar',
  'Updated_At'
];

const CONFIG_CAJAS_TAB = 'CONFIG_CAJAS';
const CONFIG_CAJAS_HEADERS = [
  'Caja', 'Tipo', 'Activa', 'Orden'
];

// Bonus mesas — the 9 production/station mesas that have percentage-based formulas
const BONUS_MESAS = [
  'Produccion1', 'Produccion2', 'Produccion3',
  'Casa1', 'Casa2', 'Cocina1', 'Cocina2', 'Cocina3', 'Express'
];
const BONUS_MESA_LABELS = {
  'Produccion1': 'Producción 1', 'Produccion2': 'Producción 2', 'Produccion3': 'Producción 3',
  'Casa1': 'Casa 1', 'Casa2': 'Casa 2',
  'Cocina1': 'Cocina 1', 'Cocina2': 'Cocina 2', 'Cocina3': 'Cocina 3',
  'Express': 'Express'
};

// Source mesas (rows in the percentage matrix) — where sales originate
const PCTJ_SOURCE_MESAS = [
  'Cocina1', 'Cocina2', 'Cocina3', 'Casa1', 'Casa2', 'Express',
  'Produccion1', 'Produccion2', 'Produccion3'
];

const PORCENTAJES_TAB = 'PORCENTAJES_MESA';
const VENTAS_MESA_TAB = 'VENTAS_MESA';
// Order matches Shopify "Ventas por Proveedor" report exactly
const ALL_MESAS = [
  'Casa1', 'Casa2', 'Cocina1', 'Cocina2', 'Cocina3',
  'Express', 'FrutasVerduras', 'Granja', 'MermasCanastas',
  'Produccion1', 'Produccion2', 'Produccion3', 'ProveedorVentas'
];

const VENTAS_MESA_HEADERS = [
  'ID', 'FechaInicio', 'FechaFin',
  // ALL mesa/vendor sales (matches Shopify "Ventas por Proveedor")
  'Casa1', 'Casa2', 'Cocina1', 'Cocina2', 'Cocina3',
  'Express', 'FrutasVerduras', 'Granja', 'MermasCanastas',
  'Produccion1', 'Produccion2', 'Produccion3', 'ProveedorVentas',
  // Aggregate for flat-rate bonuses
  'PagosRecibidos',
  // Calculated bonuses per mesa
  'Bono_Produccion1', 'Bono_Produccion2', 'Bono_Produccion3',
  'Bono_Casa1', 'Bono_Casa2',
  'Bono_Cocina1', 'Bono_Cocina2', 'Bono_Cocina3',
  'Bono_Express',
  // Flat-rate bonuses
  'Bono_AuxTienda', 'Bono_LiderTienda',
  // Grand totals
  'TotalBonos',
  'Created_At', 'Updated_At'
];

// Denomination multipliers for calculating TotalEfectivo
const DENOMINATION_VALUES = {
  'D_1000': 1000, 'D_500': 500, 'D_200': 200, 'D_100': 100,
  'D_50': 50, 'D_20': 20, 'D_10': 10, 'D_5': 5,
  'D_2': 2, 'D_1': 1, 'D_050': 0.50
};

const DENOM_KEYS = Object.keys(DENOMINATION_VALUES);

// Day-of-week names in Spanish
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Month names in Spanish
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ══════════════════════════════════════════════
// HELPER: Calculate total cash from denomination counts
// ══════════════════════════════════════════════

function calcTotalEfectivo(obj) {
  let total = 0;
  DENOM_KEYS.forEach(k => {
    total += (parseFloat(obj[k]) || 0) * DENOMINATION_VALUES[k];
  });
  return Math.round(total * 100) / 100;
}

// ══════════════════════════════════════════════
// HELPER: Get denomination array from object
// ══════════════════════════════════════════════

function getDenomValues(obj) {
  return DENOM_KEYS.map(k => parseFloat(obj[k]) || 0);
}

// ══════════════════════════════════════════════
// HELPER: Parse date string to month info
// ══════════════════════════════════════════════

function parseDateInfo(fechaStr) {
  // Parse date components directly to avoid UTC timezone offset
  // (new Date("2026-03-14") = midnight UTC = March 13 evening in Mexico → wrong day)
  const parts = String(fechaStr).split(/[-\/T]/);
  if (parts.length < 3) {
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return { dia: '', mes: '', mesNum: 0, anio: 0 };
    // Add 12 hours to avoid timezone boundary issues
    d.setHours(d.getHours() + 12);
    return {
      dia: DIAS_SEMANA[d.getDay()],
      mes: MESES[d.getMonth() + 1],
      mesNum: d.getMonth() + 1,
      anio: d.getFullYear()
    };
  }
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const day = parseInt(parts[2]);
  const d = new Date(year, month - 1, day, 12, 0, 0); // noon local time
  return {
    dia: DIAS_SEMANA[d.getDay()],
    mes: MESES[month],
    mesNum: month,
    anio: year
  };
}

// ══════════════════════════════════════════════
// HELPER: Find row by date in a sheet
// ══════════════════════════════════════════════

function findRowByDate(sheet, fecha) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf('Fecha');
  if (fechaCol < 0) return -1;

  for (let i = 1; i < data.length; i++) {
    const cellDate = formatDateStr(data[i][fechaCol]);
    if (cellDate === fecha) return i + 1; // 1-indexed row number
  }
  return -1;
}

// ══════════════════════════════════════════════
// HELPER: Normalize date to YYYY-MM-DD string
// ══════════════════════════════════════════════

// Cache spreadsheet timezone (avoids repeated lookups)
let _ssTz = null;
function getSheetTimezone() {
  if (!_ssTz) _ssTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return _ssTz;
}

function formatDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, getSheetTimezone(), 'yyyy-MM-dd');
  }
  // Already a string — normalize
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

// ══════════════════════════════════════════════
// HELPER: Remove duplicate rows for same date (keeps row with highest Sobre2)
// ══════════════════════════════════════════════

function cleanDuplicateRows(sheet, fecha) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  const headers = data[0];
  const fechaCol = headers.indexOf('Fecha');
  const sobre2Col = headers.indexOf('Sobre2');
  if (fechaCol < 0) return;

  // Find all rows matching this date
  const matches = [];
  for (let i = 1; i < data.length; i++) {
    if (formatDateStr(data[i][fechaCol]) === fecha) {
      matches.push({
        rowNum: i + 1,
        sobre2: sobre2Col >= 0 ? (parseFloat(data[i][sobre2Col]) || 0) : 0
      });
    }
  }

  if (matches.length <= 1) return; // No duplicates

  // Keep the row with highest Sobre2, delete the rest (from bottom up to preserve indices)
  matches.sort((a, b) => b.sobre2 - a.sobre2); // highest Sobre2 first
  const toDelete = matches.slice(1).map(m => m.rowNum).sort((a, b) => b - a); // bottom-up
  toDelete.forEach(rowNum => sheet.deleteRow(rowNum));
  log('DEDUP_INGRESOS', fecha + ' | removed ' + toDelete.length + ' duplicate(s)');
}

// ══════════════════════════════════════════════
// HELPER: Generic sheet-to-objects reader
// ══════════════════════════════════════════════

function sheetToObjects(tabName, headers) {
  const sheet = getOrCreateTab(tabName, headers);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const hdrs = data[0].map(String);
  return data.slice(1).map(row => {
    const obj = {};
    hdrs.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

// ══════════════════════════════════════════════
// CONFIG: Dynamic register list
// ══════════════════════════════════════════════

function getConfigCajas() {
  const sheet = getOrCreateTab(CONFIG_CAJAS_TAB, CONFIG_CAJAS_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    // Seed default registers
    const defaults = [
      ['Caja 1', 'Tienda', true, 1],
      ['Caja 2', 'Tienda', true, 2],
      ['Caja 3', 'Tienda', true, 3],
      ['Repartidor 1', 'Delivery', true, 4],
      ['Repartidor 2', 'Delivery', true, 5]
    ];
    defaults.forEach(r => sheet.appendRow(r));
    return defaults.map(r => ({ Caja: r[0], Tipo: r[1], Activa: r[2], Orden: r[3] }));
  }
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(c => c.Activa !== false && c.Activa !== 'FALSE');
}

function updateConfigCajas(body) {
  const cajas = body.cajas;
  if (!cajas || !Array.isArray(cajas)) throw new Error('Missing cajas array');
  const sheet = getOrCreateTab(CONFIG_CAJAS_TAB, CONFIG_CAJAS_HEADERS);
  // Clear and rewrite
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  cajas.forEach((c, i) => {
    sheet.appendRow([c.Caja || c.caja, c.Tipo || c.tipo || 'Tienda', c.Activa !== false, c.Orden || i + 1]);
  });
  log('UPDATE_CONFIG_CAJAS', cajas.length + ' registers configured');
  return { ok: true, count: cajas.length, message: 'Cajas actualizadas' };
}

// ══════════════════════════════════════════════
// CORTES INDIVIDUALES
// ══════════════════════════════════════════════

function saveCorteIndividual(body) {
  const sheet = getOrCreateTab(CORTES_IND_TAB, CORTES_IND_HEADERS);
  const c = body.corte || body;
  const id = c.id || 'CI' + Date.now();

  const totalEfectivo = calcTotalEfectivo(c);
  // FaltanteSobrante = TotalEfectivo - (VentasCaja - Tarjeta - Transferencias - StoreCredit + Cashback - Retiros)
  const ventasCaja = parseFloat(c.VentasCaja) || 0;
  const tarjeta = parseFloat(c.Tarjeta) || 0;
  const transferencias = parseFloat(c.Transferencias) || 0;
  const cashback = parseFloat(c.Cashback) || 0;
  const storeCredit = parseFloat(c.StoreCredit) || 0;
  const retiros = parseFloat(c.Retiros) || 0;
  const expectedCash = ventasCaja - tarjeta - transferencias - storeCredit + cashback - retiros;
  const faltanteSobrante = Math.round((totalEfectivo - expectedCash) * 100) / 100;

  const denoms = getDenomValues(c);
  const row = [
    id,
    // Store as noon-UTC Date so Sheets doesn't flip the day when converting UTC midnight → Mexico City TZ.
    c.Fecha ? new Date(c.Fecha + 'T12:00:00Z') : new Date(),
    c.Colaborador || '',
    c.Caja || '',
    ventasCaja, tarjeta, transferencias, cashback, storeCredit, retiros,
    ...denoms,
    totalEfectivo, faltanteSobrante,
    new Date().toISOString(),
    c.Device || 'web'
  ];

  sheet.appendRow(row);
  log('CORTE_IND', id + ' | ' + c.Colaborador + ' | ' + c.Caja + ' | $' + totalEfectivo + ' | F/S: $' + faltanteSobrante);
  writeAuditInternal('Cortes', 'CORTE_INDIVIDUAL', c.Device || '', c.Colaborador + ' | ' + c.Caja);

  return {
    ok: true, id,
    totalEfectivo, faltanteSobrante,
    message: 'Corte individual registrado'
  };
}

function getCortesDia(params) {
  const fecha = params.fecha;
  if (!fecha) throw new Error('Missing fecha parameter');
  const all = sheetToObjects(CORTES_IND_TAB, CORTES_IND_HEADERS);
  // Sheets can auto-convert "yyyy-MM-dd" strings to UTC-midnight Date objects.
  // Using formatDateStr (Mexico City TZ) on UTC midnight gives the PREVIOUS day → mismatch.
  // Fix: for Date objects, use the UTC date string (which is what the frontend sends).
  const filtered = all.filter(r => {
    const val = r.Fecha;
    if (!val) return false;
    if (val instanceof Date) return val.toISOString().slice(0, 10) === fecha;
    return String(val).slice(0, 10) === fecha;
  });
  return { cortes: filtered, count: filtered.length, fecha };
}

function updateCorteIndividual(body) {
  const c = body.corte || body;
  const { id } = c;
  if (!id) throw new Error("Missing corte id");
  const sheet = getOrCreateTab(CORTES_IND_TAB, CORTES_IND_HEADERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const totalEfectivo = calcTotalEfectivo(c);
      const ventasCaja = parseFloat(c.VentasCaja) || 0;
      const tarjeta = parseFloat(c.Tarjeta) || 0;
      const transferencias = parseFloat(c.Transferencias) || 0;
      const cashback = parseFloat(c.Cashback) || 0;
      const retiros = parseFloat(c.Retiros) || 0;
      const expectedCash = ventasCaja - tarjeta - transferencias + cashback - retiros;
      const faltanteSobrante = Math.round((totalEfectivo - expectedCash) * 100) / 100;
      const denoms = getDenomValues(c);
      const row = [
        id, c.Fecha || data[i][1], c.Colaborador || "", c.Caja || "",
        ventasCaja, tarjeta, transferencias, cashback, 0, retiros,
        ...denoms,
        totalEfectivo, faltanteSobrante,
        data[i][CORTES_IND_HEADERS.indexOf("Created_At")],
        c.Device || "web"
      ];
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      log("UPDATE_CORTE_IND", id + " | " + c.Colaborador + " | " + c.Caja);
      return { ok: true, id, totalEfectivo, faltanteSobrante, message: "Corte actualizado" };
    }
  }
  throw new Error("Corte not found: " + id);
}

function deleteCorteIndividual(body) {
  const { id } = body;
  if (!id) throw new Error('Missing corte id');
  const sheet = getOrCreateTab(CORTES_IND_TAB, CORTES_IND_HEADERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      log('DELETE_CORTE_IND', id);
      return { ok: true, message: 'Corte eliminado' };
    }
  }
  throw new Error('Corte not found: ' + id);
}

// ══════════════════════════════════════════════
// CORTE DE TIENDA (daily consolidated)
// ══════════════════════════════════════════════

function saveCorteTienda(body) {
  const sheet = getOrCreateTab(CORTE_TIENDA_TAB, CORTE_TIENDA_HEADERS);
  const c = body.corte || body;
  const fecha = c.Fecha || formatDateStr(new Date());
  const id = c.id || 'CT' + Date.now();

  // Check if a corte already exists for this date — update it
  const existingRow = findRowByDate(sheet, fecha);

  const totalEfectivo = calcTotalEfectivo(c);
  const pagosRecibidos = parseFloat(c.PagosRecibidos) || 0;
  const tarjeta = parseFloat(c.Tarjeta) || 0;
  const transferencias = parseFloat(c.Transferencias) || 0;
  const cashback = parseFloat(c.Cashback) || 0;
  const storeCredit = parseFloat(c.StoreCredit) || 0;
  const expectedCash = pagosRecibidos - tarjeta - transferencias - storeCredit - cashback;
  const faltanteSobrante = Math.round((totalEfectivo - expectedCash) * 100) / 100;

  // Shopify values (auto-populated or 0)
  const shopVentas = parseFloat(c.Shopify_VentasTotales) || 0;
  const shopTarjeta = parseFloat(c.Shopify_Tarjeta) || 0;
  const shopTransf = parseFloat(c.Shopify_Transferencias) || 0;
  const shopCashback = parseFloat(c.Shopify_Cashback) || 0;
  const shopStoreCredit = parseFloat(c.Shopify_StoreCredit) || 0;
  const discrepancia = pagosRecibidos - shopVentas;

  // Sobre2 & deposit
  const sobre2 = parseFloat(c.Sobre2) || 0;
  const depositoAjustado = pagosRecibidos - tarjeta - transferencias - cashback - sobre2;

  const denoms = getDenomValues(c);

  // Mesa sales
  const mesaFields = [
    'Cocina1', 'Cocina2', 'Cocina3',
    'Produccion1', 'Produccion2', 'Produccion3',
    'Casa1', 'Casa2', 'Express', 'Granja',
    'FrutasVerduras', 'Proveedor', 'MermasCanastas', 'Pedidos', 'Mixto',
    'IvaAVenta'
  ];
  const mesaValues = mesaFields.map(f => parseFloat(c[f]) || 0);

  const row = [
    existingRow > 0 ? sheet.getRange(existingRow, 1).getValue() : id,
    fecha,
    c.Colaborador || '',
    parseFloat(c.VentasTotales) || 0,
    pagosRecibidos,
    tarjeta, transferencias, cashback,
    0,   // StoreCredit — deprecated (consolidated into Cashback), kept for column alignment
    ...denoms,
    totalEfectivo, faltanteSobrante,
    shopVentas, shopTarjeta, shopTransf, shopCashback, shopStoreCredit,
    discrepancia,
    sobre2, depositoAjustado,
    ...mesaValues,
    new Date().toISOString(),
    c.Device || 'web'
  ];

  if (existingRow > 0) {
    // Update existing row
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    log('UPDATE_CORTE_TIENDA', fecha + ' | updated | $' + pagosRecibidos);
  } else {
    sheet.appendRow(row);
    log('CORTE_TIENDA', id + ' | ' + fecha + ' | $' + pagosRecibidos + ' | F/S: $' + faltanteSobrante);
  }

  writeAuditInternal('Cortes', 'CORTE_TIENDA', c.Device || '', fecha + ' | $' + pagosRecibidos);

  return {
    ok: true,
    id: existingRow > 0 ? sheet.getRange(existingRow, 1).getValue() : id,
    totalEfectivo, faltanteSobrante, discrepancia, depositoAjustado,
    updated: existingRow > 0,
    message: existingRow > 0 ? 'Corte de tienda actualizado' : 'Corte de tienda registrado'
  };
}

function getCorteTienda(params) {
  const fecha = params.fecha;
  if (!fecha) throw new Error('Missing fecha parameter');
  const all = sheetToObjects(CORTE_TIENDA_TAB, CORTE_TIENDA_HEADERS);
  const found = all.find(r => formatDateStr(r.Fecha) === fecha);
  return { corte: found || null, fecha };
}

// ══════════════════════════════════════════════
// ARQUEO DE CAJA CHICA
// ══════════════════════════════════════════════

function saveArqueo(body) {
  const sheet = getOrCreateTab(ARQUEO_TAB, ARQUEO_HEADERS);
  const a = body.arqueo || body;
  const id = a.id || 'AQ' + Date.now();

  const FONDO_ESPERADO = 12000;
  const totalEfectivo = calcTotalEfectivo(a);
  const fondo1    = parseFloat(a.Fondo1) || 0;
  const fondo2    = parseFloat(a.Fondo2) || 0;
  const fondo3    = parseFloat(a.Fondo3) || 0;
  const fondo4    = parseFloat(a.Fondo4) || 0;
  const fondoRep1 = parseFloat(a.FondoRepartidor1) || parseFloat(a.FondoRepartidor) || 0; // backward compat
  const fondoRep2 = parseFloat(a.FondoRepartidor2) || 0;
  const bolsita   = parseFloat(a.BolsitaCambio) || 0;
  const gastosRep = parseFloat(a.GastosReponer) || 0;
  const totalFondos  = fondo1 + fondo2 + fondo3 + fondo4 + fondoRep1 + fondoRep2 + bolsita + gastosRep;
  const totalGeneral = totalFondos + totalEfectivo;
  const faltanteSobrante = Math.round((totalGeneral - FONDO_ESPERADO) * 100) / 100;

  const denoms = getDenomValues(a);
  const row = [
    id,
    a.Fecha || formatDateStr(new Date()),
    a.Colaborador || '',
    a.Caja || '',
    fondo1, fondo2, fondo3, fondo4, fondoRep1, fondoRep2, bolsita, gastosRep,
    ...denoms,
    totalEfectivo, totalGeneral, faltanteSobrante,
    new Date().toISOString(),
    a.Device || 'web'
  ];

  sheet.appendRow(row);
  log('ARQUEO', id + ' | Efectivo: $' + totalEfectivo + ' | Total: $' + totalGeneral + ' / $' + FONDO_ESPERADO + ' | F/S: $' + faltanteSobrante);
  writeAuditInternal('Cortes', 'ARQUEO_CAJA', a.Device || '', a.Colaborador + ' | F/S: $' + faltanteSobrante);

  return { ok: true, id, totalEfectivo, totalGeneral, faltanteSobrante, message: 'Arqueo registrado' };
}

function getArqueos(params) {
  const all = sheetToObjects(ARQUEO_TAB, ARQUEO_HEADERS);
  let filtered = all;
  if (params.fecha) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) === params.fecha);
  }
  if (params.month) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha).startsWith(params.month));
  }
  if (params.startDate) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) >= params.startDate);
  }
  return { arqueos: filtered, count: filtered.length };
}

// ══════════════════════════════════════════════
// TRANSFERENCIAS LOG
// ══════════════════════════════════════════════

function saveTransferencia(body) {
  const sheet = getOrCreateTab(TRANSF_LOG_TAB, TRANSF_LOG_HEADERS);
  const t = body.transferencia || body;
  const id = t.id || 'TR' + Date.now();

  const row = [
    id,
    t.Fecha || formatDateStr(new Date()),
    t.Colaborador || '',
    parseFloat(t.Monto) || 0,
    t.Concepto || '',
    t.De_Cuenta || '',
    t.A_Cuenta || '',
    t.Referencia || '',
    new Date().toISOString()
  ];

  sheet.appendRow(row);
  log('TRANSFERENCIA', id + ' | $' + t.Monto + ' | ' + t.Concepto);
  return { ok: true, id, message: 'Transferencia registrada' };
}

function getTransferencias(params) {
  const all = sheetToObjects(TRANSF_LOG_TAB, TRANSF_LOG_HEADERS);
  let filtered = all;
  if (params.fecha) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) === params.fecha);
  }
  if (params.month) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha).startsWith(params.month));
  }
  if (params.startDate) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) >= params.startDate);
  }
  return { transferencias: filtered, count: filtered.length };
}

// ══════════════════════════════════════════════
// INGRESOS (The Brain — one row per day)
// ══════════════════════════════════════════════

function saveIngreso(body) {
  const sheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);
  const ing = body.ingreso || body;
  const fecha = ing.Fecha || formatDateStr(new Date());

  // Clean up duplicate rows for this date BEFORE saving
  cleanDuplicateRows(sheet, fecha);

  // Check if entry already exists for this date
  const existingRow = findRowByDate(sheet, fecha);

  const dateInfo = parseDateInfo(fecha);
  const id = existingRow > 0 ? sheet.getRange(existingRow, 1).getValue() : (ing.id || 'ING' + Date.now());

  // Parse all numeric fields
  const ventasDia = parseFloat(ing.VentasDia) || 0;
  const pagosRecibidos = parseFloat(ing.PagosRecibidos) || 0;
  const tarjeta = parseFloat(ing.Tarjeta) || 0;
  const transferencias = parseFloat(ing.Transferencias) || 0;
  const cashback = parseFloat(ing.Cashback) || 0;

  // Sobre 2
  const socios2 = parseFloat(ing['2ndoSocios']) || 0;
  const nominas2 = parseFloat(ing['2ndoNominas']) || 0;
  const sobre2 = socios2 + nominas2;

  // Mesa sales
  const mesaFields = [
    'Cocina1', 'Cocina2', 'Cocina3',
    'Produccion1', 'Produccion2', 'Produccion3',
    'Casa1', 'Casa2', 'Express', 'Granja',
    'FrutasVerduras', 'ProveedorVentas', 'MermasCanastas', 'Pedidos', 'Mixto',
    'IvaAVenta'
  ];
  const mesaValues = mesaFields.map(f => parseFloat(ing[f]) || 0);

  // Deposit
  const depositoBBVA = pagosRecibidos - sobre2;

  // Invoicing
  const factClientes = parseFloat(ing.FactClientes) || 0;
  const factGens = [];
  for (let g = 1; g <= 6; g++) {
    factGens.push(parseFloat(ing['FactGen' + g]) || 0);
  }
  const facturasCFDI = ing.FacturasCFDI || '';
  const totalFacturado = factClientes + factGens.reduce((s, v) => s + v, 0);
  const totalXFacturar = pagosRecibidos - sobre2 - cashback;
  const faltaFactura = totalXFacturar - totalFacturado;

  const now = new Date().toISOString();
  const row = [
    id, fecha, dateInfo.dia,
    ventasDia, pagosRecibidos,
    tarjeta, transferencias, cashback,
    socios2, nominas2, sobre2,
    ...mesaValues,
    depositoBBVA,
    factClientes, ...factGens, facturasCFDI,
    totalFacturado, totalXFacturar, faltaFactura,
    dateInfo.mes, dateInfo.mesNum,
    existingRow > 0 ? sheet.getRange(existingRow, INGRESOS_HEADERS.indexOf('Created_At') + 1).getValue() : now,
    now
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    log('UPDATE_INGRESO', fecha + ' | $' + pagosRecibidos + ' | Sobre2: $' + sobre2);
  } else {
    sheet.appendRow(row);
    log('SAVE_INGRESO', id + ' | ' + fecha + ' | $' + pagosRecibidos);
  }

  SpreadsheetApp.flush(); // Ensure writes are committed before any subsequent reads

  return {
    ok: true, id,
    sobre2, depositoBBVA, totalFacturado, totalXFacturar, faltaFactura,
    updated: existingRow > 0,
    message: existingRow > 0 ? 'Ingreso actualizado' : 'Ingreso registrado'
  };
}

function getIngresos(params) {
  const all = sheetToObjects(INGRESOS_TAB, INGRESOS_HEADERS);
  let filtered = all;
  if (params.fecha) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) === params.fecha);
  }
  if (params.month) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha).startsWith(params.month));
  }
  if (params.startDate) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) >= params.startDate);
  }
  if (params.year) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha).startsWith(params.year));
  }
  if (params.mes) {
    filtered = filtered.filter(r => String(r.Mes) === params.mes);
  }
  // Normalize dates and deduplicate by Fecha (keep row with highest Sobre2)
  const byDate = {};
  filtered.forEach(r => {
    const fecha = formatDateStr(r.Fecha);
    const copy = Object.assign({}, r);
    copy.Fecha = fecha;
    const existing = byDate[fecha];
    if (!existing || (parseFloat(copy.Sobre2) || 0) > (parseFloat(existing.Sobre2) || 0)) {
      byDate[fecha] = copy;
    }
  });
  const normalized = Object.values(byDate);
  return { ingresos: normalized, count: normalized.length };
}

// ══════════════════════════════════════════════
// PENDIENTES: Cross-reference CORTE_TIENDA vs INGRESOS
// ══════════════════════════════════════════════

function getPendientesSobre2(params) {
  const month = params.month || new Date().toISOString().slice(0, 7);
  const ssTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

  // Helper: normalize any date value to YYYY-MM-DD using the spreadsheet's own timezone
  function normDate(val) {
    if (!val) return '';
    if (val instanceof Date) {
      return Utilities.formatDate(val, ssTz, 'yyyy-MM-dd');
    }
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // Try parsing other formats
    const d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, ssTz, 'yyyy-MM-dd');
    return s;
  }

  // Get all Corte de Tienda entries for the month
  const cortes = sheetToObjects(CORTE_TIENDA_TAB, CORTE_TIENDA_HEADERS);
  const cortesMonth = cortes.filter(c => normDate(c.Fecha).startsWith(month));

  // Build a Set of ALL INGRESOS dates for the month (robust matching)
  const ingSheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);
  const ingData = ingSheet.getDataRange().getValues();
  const ingHeaders = ingData[0];
  const fechaCol = ingHeaders.indexOf('Fecha');
  const ingresosDates = new Set();

  if (fechaCol >= 0) {
    for (let i = 1; i < ingData.length; i++) {
      const raw = ingData[i][fechaCol];
      if (!raw) continue;
      const nd = normDate(raw);
      if (nd.startsWith(month)) ingresosDates.add(nd);
    }
  }

  // Find corte dates with no matching INGRESOS entry
  const pending = [];
  const seen = {};
  cortesMonth.forEach(c => {
    const fecha = normDate(c.Fecha);
    if (seen[fecha]) return;
    seen[fecha] = true;

    if (!ingresosDates.has(fecha)) {
      pending.push({
        Fecha: fecha,
        PagosRecibidos: parseFloat(c.PagosRecibidos) || 0,
        Tarjeta: parseFloat(c.Tarjeta) || 0,
        Transferencias: parseFloat(c.Transferencias) || 0,
        Cashback: parseFloat(c.Cashback) || 0,
        FaltanteSobrante: parseFloat(c.FaltanteSobrante) || 0,
        Sobre2: 0,
        hasIngreso: false
      });
    }
  });

  return { pendientes: pending, count: pending.length };
}

function updateSobre2(body) {
  const { fecha } = body;
  if (!fecha) throw new Error('Missing fecha');
  const sheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);
  const rowNum = findRowByDate(sheet, fecha);
  if (rowNum < 0) throw new Error('No ingreso found for date: ' + fecha);

  const socios2 = parseFloat(body['2ndoSocios']);
  const nominas2 = parseFloat(body['2ndoNominas']);
  const headers = INGRESOS_HEADERS;

  if (!isNaN(socios2)) {
    sheet.getRange(rowNum, headers.indexOf('2ndoSocios') + 1).setValue(socios2);
  }
  if (!isNaN(nominas2)) {
    sheet.getRange(rowNum, headers.indexOf('2ndoNominas') + 1).setValue(nominas2);
  }

  // Recalculate Sobre2 and dependent fields
  const s2 = (isNaN(socios2) ? parseFloat(sheet.getRange(rowNum, headers.indexOf('2ndoSocios') + 1).getValue()) || 0 : socios2);
  const n2 = (isNaN(nominas2) ? parseFloat(sheet.getRange(rowNum, headers.indexOf('2ndoNominas') + 1).getValue()) || 0 : nominas2);
  const sobre2 = s2 + n2;
  sheet.getRange(rowNum, headers.indexOf('Sobre2') + 1).setValue(sobre2);

  const pagosRecibidos = parseFloat(sheet.getRange(rowNum, headers.indexOf('PagosRecibidos') + 1).getValue()) || 0;
  const cashbackStored = parseFloat(sheet.getRange(rowNum, headers.indexOf('Cashback') + 1).getValue()) || 0;
  const depositoBBVA = pagosRecibidos - sobre2;
  sheet.getRange(rowNum, headers.indexOf('DepositoBBVA') + 1).setValue(depositoBBVA);

  // Recalc TotalXFacturar and FaltaFactura
  const totalXFacturar = pagosRecibidos - sobre2 - cashbackStored;
  sheet.getRange(rowNum, headers.indexOf('TotalXFacturar') + 1).setValue(totalXFacturar);

  const totalFacturado = parseFloat(sheet.getRange(rowNum, headers.indexOf('TotalFacturado') + 1).getValue()) || 0;
  sheet.getRange(rowNum, headers.indexOf('FaltaFactura') + 1).setValue(totalXFacturar - totalFacturado);

  sheet.getRange(rowNum, headers.indexOf('Updated_At') + 1).setValue(new Date().toISOString());

  SpreadsheetApp.flush(); // Ensure writes are committed before any subsequent reads
  log('UPDATE_SOBRE2', fecha + ' | Sobre2: $' + sobre2 + ' | Dep: $' + depositoBBVA);
  return { ok: true, sobre2, depositoBBVA, totalXFacturar, message: 'Sobre 2 actualizado' };
}

function updateFacturacion(body) {
  const { fecha } = body;
  if (!fecha) throw new Error('Missing fecha');
  const sheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);
  const rowNum = findRowByDate(sheet, fecha);
  if (rowNum < 0) throw new Error('No ingreso found for date: ' + fecha);

  const headers = INGRESOS_HEADERS;

  // Update invoice fields if provided
  const invoiceFields = ['FactClientes', 'FactGen1', 'FactGen2', 'FactGen3', 'FactGen4', 'FactGen5', 'FactGen6', 'FacturasCFDI'];
  invoiceFields.forEach(field => {
    if (body[field] !== undefined) {
      const col = headers.indexOf(field) + 1;
      if (col > 0) sheet.getRange(rowNum, col).setValue(body[field]);
    }
  });

  // Recalculate TotalFacturado
  let totalFacturado = parseFloat(sheet.getRange(rowNum, headers.indexOf('FactClientes') + 1).getValue()) || 0;
  for (let g = 1; g <= 6; g++) {
    totalFacturado += parseFloat(sheet.getRange(rowNum, headers.indexOf('FactGen' + g) + 1).getValue()) || 0;
  }
  sheet.getRange(rowNum, headers.indexOf('TotalFacturado') + 1).setValue(totalFacturado);

  const totalXFacturar = parseFloat(sheet.getRange(rowNum, headers.indexOf('TotalXFacturar') + 1).getValue()) || 0;
  const faltaFactura = totalXFacturar - totalFacturado;
  sheet.getRange(rowNum, headers.indexOf('FaltaFactura') + 1).setValue(faltaFactura);

  sheet.getRange(rowNum, headers.indexOf('Updated_At') + 1).setValue(new Date().toISOString());

  log('UPDATE_FACTURACION', fecha + ' | Facturado: $' + totalFacturado + ' | Falta: $' + faltaFactura);
  return { ok: true, totalFacturado, faltaFactura, message: 'Facturación actualizada' };
}

/**
 * Batch update facturación for multiple dates in ONE call.
 * body.changes = [ { fecha, FactClientes, FactGen1, ..., FacturasCFDI }, ... ]
 */
function batchUpdateFacturacion(body) {
  const changes = body.changes || [];
  if (!changes.length) throw new Error('No changes provided');

  const sheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const fechaCol = headers.indexOf('Fecha');
  const invoiceFields = ['FactClientes', 'FactGen1', 'FactGen2', 'FactGen3', 'FactGen4', 'FactGen5', 'FactGen6', 'FacturasCFDI'];

  // Build a date→row map for fast lookup
  const dateRowMap = {};
  for (let i = 1; i < data.length; i++) {
    const f = formatDateStr(data[i][fechaCol]);
    if (f) dateRowMap[f] = i + 1; // 1-indexed
  }

  let updated = 0;
  changes.forEach(c => {
    const fecha = c.fecha;
    if (!fecha) return;
    const rowNum = dateRowMap[fecha];
    if (!rowNum) return;

    // Update invoice fields
    invoiceFields.forEach(field => {
      if (c[field] !== undefined) {
        const col = headers.indexOf(field);
        if (col >= 0) sheet.getRange(rowNum, col + 1).setValue(c[field]);
      }
    });

    // Recalculate TotalFacturado
    let totalFacturado = 0;
    const fcCol = headers.indexOf('FactClientes');
    if (fcCol >= 0) totalFacturado += parseFloat(c.FactClientes !== undefined ? c.FactClientes : sheet.getRange(rowNum, fcCol + 1).getValue()) || 0;
    for (let g = 1; g <= 6; g++) {
      const gCol = headers.indexOf('FactGen' + g);
      if (gCol >= 0) totalFacturado += parseFloat(c['FactGen' + g] !== undefined ? c['FactGen' + g] : sheet.getRange(rowNum, gCol + 1).getValue()) || 0;
    }

    const tfCol = headers.indexOf('TotalFacturado');
    if (tfCol >= 0) sheet.getRange(rowNum, tfCol + 1).setValue(totalFacturado);

    const txfCol = headers.indexOf('TotalXFacturar');
    const ffCol = headers.indexOf('FaltaFactura');
    if (txfCol >= 0 && ffCol >= 0) {
      const totalXFacturar = parseFloat(sheet.getRange(rowNum, txfCol + 1).getValue()) || 0;
      sheet.getRange(rowNum, ffCol + 1).setValue(totalXFacturar - totalFacturado);
    }

    const uaCol = headers.indexOf('Updated_At');
    if (uaCol >= 0) sheet.getRange(rowNum, uaCol + 1).setValue(new Date().toISOString());

    updated++;
  });

  SpreadsheetApp.flush();
  log('BATCH_FACTURACION', updated + ' dates updated');
  return { ok: true, updated, message: updated + ' fechas actualizadas' };
}

// ══════════════════════════════════════════════
// NETO MENSUAL (monthly summary)
// ══════════════════════════════════════════════

function getMonthlySummary(params) {
  const month = params.month; // format: "2026-03" or mes name
  const anio = params.year || new Date().getFullYear();

  // Get ingresos for the month
  const ingresos = sheetToObjects(INGRESOS_TAB, INGRESOS_HEADERS);
  let monthIngresos;
  if (month && month.includes('-')) {
    monthIngresos = ingresos.filter(r => formatDateStr(r.Fecha).startsWith(month));
  } else if (month) {
    monthIngresos = ingresos.filter(r => r.Mes === month && (r.MesNumero ? true : true));
  } else {
    monthIngresos = ingresos;
  }

  // Aggregate
  let totalIngresos = 0, totalXFacturar = 0, totalFacturado = 0;
  let totalTarjeta = 0, totalTransf = 0, totalCashback = 0;
  let totalSobre2 = 0;

  monthIngresos.forEach(r => {
    totalIngresos += parseFloat(r.PagosRecibidos) || 0;
    totalXFacturar += parseFloat(r.TotalXFacturar) || 0;
    totalFacturado += parseFloat(r.TotalFacturado) || 0;
    totalTarjeta += parseFloat(r.Tarjeta) || 0;
    totalTransf += parseFloat(r.Transferencias) || 0;
    totalCashback += parseFloat(r.Cashback) || 0;
    totalSobre2 += parseFloat(r.Sobre2) || 0;
  });

  // Get gastos for the same period (from FACTURAS tab)
  const facturas = sheetToObjects(FACTURAS_TAB, FACTURAS_HEADERS);
  let monthGastos;
  if (month && month.includes('-')) {
    monthGastos = facturas.filter(r => formatDateStr(r.Fecha_Compra).startsWith(month));
  } else {
    monthGastos = facturas;
  }

  let totalGastos = 0;
  monthGastos.forEach(r => {
    totalGastos += parseFloat(r.Monto_Pagar) || 0;
  });

  const neto = totalIngresos - totalGastos;
  const faltaFacturar = totalXFacturar - totalFacturado;

  return {
    month: month || 'all',
    year: anio,
    days: monthIngresos.length,
    totalIngresos,
    totalGastos,
    neto,
    totalXFacturar,
    totalFacturado,
    faltaFacturar,
    totalSobre2,
    paymentBreakdown: {
      tarjeta: totalTarjeta,
      transferencias: totalTransf,
      cashback: totalCashback,
      efectivo: totalIngresos - totalTarjeta - totalTransf - totalCashback
    }
  };
}

function updateNetoMensual(body) {
  const sheet = getOrCreateTab(NETO_TAB, NETO_HEADERS);
  const mes = body.Mes || body.mes;
  const mesNum = body.MesNumero || body.mesNumero;
  const anio = body.Anio || body.anio || new Date().getFullYear();

  if (!mes) throw new Error('Missing Mes');

  // Check if row exists for this month+year
  const data = sheet.getDataRange().getValues();
  let existingRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === mes && String(data[i][2]) === String(anio)) {
      existingRow = i + 1;
      break;
    }
  }

  const row = [
    mes, mesNum || 0, anio,
    parseFloat(body.TotalIngresos) || 0,
    parseFloat(body.TotalGastos) || 0,
    (parseFloat(body.TotalIngresos) || 0) - (parseFloat(body.TotalGastos) || 0),
    parseFloat(body.TotalXFacturar) || 0,
    parseFloat(body.TotalFacturado) || 0,
    (parseFloat(body.TotalXFacturar) || 0) - (parseFloat(body.TotalFacturado) || 0),
    new Date().toISOString()
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  log('NETO_MENSUAL', mes + ' ' + anio + ' | Ingresos: $' + row[3] + ' | Gastos: $' + row[4] + ' | Neto: $' + row[5]);
  return { ok: true, message: 'Neto mensual actualizado' };
}

// ══════════════════════════════════════════════
// DASHBOARD DATA
// ══════════════════════════════════════════════

function getDashboardData(params) {
  const year = params.year || String(new Date().getFullYear());

  // Monthly ingresos
  const ingresos = sheetToObjects(INGRESOS_TAB, INGRESOS_HEADERS)
    .filter(r => formatDateStr(r.Fecha).startsWith(year));

  // Monthly gastos (use formatDateStr — Sheets returns Date objects, not strings)
  const facturas = sheetToObjects(FACTURAS_TAB, FACTURAS_HEADERS)
    .filter(r => formatDateStr(r.Fecha_Compra).startsWith(year));

  // Build monthly data
  const monthly = {};
  for (let m = 1; m <= 12; m++) {
    const prefix = year + '-' + String(m).padStart(2, '0');
    const mesName = MESES[m];
    const mIngresos = ingresos.filter(r => formatDateStr(r.Fecha).startsWith(prefix));
    const mGastos = facturas.filter(r => formatDateStr(r.Fecha_Compra).startsWith(prefix));

    let totalIng = 0, totalGas = 0, totalXFact = 0, totalFact = 0;
    let tarjeta = 0, transferencias = 0, cashback = 0;

    mIngresos.forEach(r => {
      totalIng += parseFloat(r.PagosRecibidos) || 0;
      totalXFact += parseFloat(r.TotalXFacturar) || 0;
      totalFact += parseFloat(r.TotalFacturado) || 0;
      tarjeta += parseFloat(r.Tarjeta) || 0;
      transferencias += parseFloat(r.Transferencias) || 0;
      cashback += parseFloat(r.Cashback) || 0;
    });

    mGastos.forEach(r => { totalGas += parseFloat(r.Monto_Pagar) || 0; });

    monthly[mesName] = {
      mesNum: m,
      days: mIngresos.length,
      ingresos: totalIng,
      gastos: totalGas,
      neto: totalIng - totalGas,
      xFacturar: totalXFact,
      facturado: totalFact,
      faltaFacturar: totalXFact - totalFact,
      paymentTypes: { tarjeta, transferencias, cashback, efectivo: totalIng - tarjeta - transferencias - cashback }
    };
  }

  // Daily sales for selected month (falls back to current month if not provided)
  const now = new Date();
  const selectedMonth = params.month ? params.month.padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
  const currentPrefix = year + '-' + selectedMonth;
  const dailySales = ingresos
    .filter(r => formatDateStr(r.Fecha).startsWith(currentPrefix))
    .map(r => ({
      fecha: formatDateStr(r.Fecha),
      dia: r.DiaSemana,
      ventas: parseFloat(r.VentasDia) || parseFloat(r.PagosRecibidos) || 0,
      pagosRecibidos: parseFloat(r.PagosRecibidos) || 0
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Day-of-week averages
  const dowTotals = {};
  const dowCounts = {};
  ingresos.forEach(r => {
    const dia = r.DiaSemana;
    if (!dia) return;
    if (!dowTotals[dia]) { dowTotals[dia] = 0; dowCounts[dia] = 0; }
    dowTotals[dia] += parseFloat(r.PagosRecibidos) || 0;
    dowCounts[dia]++;
  });
  const dayOfWeekAvg = {};
  Object.keys(dowTotals).forEach(dia => {
    dayOfWeekAvg[dia] = Math.round(dowTotals[dia] / dowCounts[dia]);
  });

  // Mesa sales for selected month (avoids a separate API call)
  const mesaFields = [
    'Cocina1', 'Cocina2', 'Cocina3',
    'Produccion1', 'Produccion2', 'Produccion3',
    'Casa1', 'Casa2', 'Express', 'Granja',
    'FrutasVerduras', 'ProveedorVentas', 'MermasCanastas', 'Pedidos', 'Mixto'
  ];
  const mesaSales = {};
  mesaFields.forEach(f => { mesaSales[f] = 0; });
  const monthIngresos = ingresos.filter(r => formatDateStr(r.Fecha).startsWith(currentPrefix));
  monthIngresos.forEach(r => {
    mesaFields.forEach(f => { mesaSales[f] += parseFloat(r[f]) || 0; });
  });

  return {
    year,
    monthly,
    dailySales,
    dayOfWeekAvg,
    mesaSales,
    totalDays: ingresos.length
  };
}

function getPaymentTrends(params) {
  const year = params.year || String(new Date().getFullYear());
  const ingresos = sheetToObjects(INGRESOS_TAB, INGRESOS_HEADERS)
    .filter(r => formatDateStr(r.Fecha).startsWith(year));

  const weekly = {};
  ingresos.forEach(r => {
    const fecha = formatDateStr(r.Fecha);
    // Group by week (ISO week number approximation)
    const d = new Date(fecha);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekKey = formatDateStr(weekStart);

    if (!weekly[weekKey]) {
      weekly[weekKey] = { efectivo: 0, tarjeta: 0, transferencias: 0, cashback: 0, total: 0 };
    }
    const w = weekly[weekKey];
    w.tarjeta += parseFloat(r.Tarjeta) || 0;
    w.transferencias += parseFloat(r.Transferencias) || 0;
    w.cashback += parseFloat(r.Cashback) || 0;
    w.total += parseFloat(r.PagosRecibidos) || 0;
    w.efectivo = w.total - w.tarjeta - w.transferencias - w.cashback;
  });

  return { year, weekly };
}

// ══════════════════════════════════════════════
// SHOPIFY POS INTEGRATION
// ══════════════════════════════════════════════

function syncShopifyDaily(body) {
  const token = PropertiesService.getScriptProperties().getProperty('SHOPIFY_TOKEN');
  const store = PropertiesService.getScriptProperties().getProperty('SHOPIFY_STORE');

  if (!token || !store) {
    return {
      ok: false,
      message: 'Shopify not configured. Set SHOPIFY_TOKEN and SHOPIFY_STORE in Script Properties.',
      setup_needed: true
    };
  }

  const fecha = body.fecha || formatDateStr(new Date());
  const apiVersion = '2025-01';
  const url = 'https://' + store + '.myshopify.com/admin/api/' + apiVersion + '/graphql.json';

  // GraphQL query for orders with transactions
  const query = `{
    orders(first: 250, query: "created_at:>='${fecha}T00:00:00' created_at:<='${fecha}T23:59:59'") {
      edges {
        node {
          name
          totalPriceSet { shopMoney { amount currencyCode } }
          transactions(first: 10) {
            gateway
            kind
            status
            amountSet { shopMoney { amount } }
          }
        }
      }
    }
  }`;

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': token },
    payload: JSON.stringify({ query }),
    muteHttpExceptions: true
  };

  try {
    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error('Shopify API error ' + code + ': ' + resp.getContentText().slice(0, 200));
    }

    const result = JSON.parse(resp.getContentText());
    const orders = result.data?.orders?.edges || [];

    // Aggregate by payment type
    let ventasTotales = 0;
    let tarjeta = 0, efectivo = 0, transferencias = 0, cashback = 0, storeCredit = 0;

    orders.forEach(({ node: order }) => {
      const total = parseFloat(order.totalPriceSet?.shopMoney?.amount) || 0;
      ventasTotales += total;

      (order.transactions || []).forEach(tx => {
        if (tx.kind !== 'SALE' && tx.kind !== 'sale') return;
        if (tx.status !== 'SUCCESS' && tx.status !== 'success') return;
        const amount = parseFloat(tx.amountSet?.shopMoney?.amount) || 0;
        const gateway = (tx.gateway || '').toLowerCase();

        if (gateway.includes('cash') && !gateway.includes('back')) {
          efectivo += amount;
        } else if (gateway.includes('card') || gateway.includes('tarjeta') || gateway.includes('stripe') || gateway.includes('shopify_payments')) {
          tarjeta += amount;
        } else if (gateway.includes('transfer') || gateway.includes('bank')) {
          transferencias += amount;
        } else if (gateway.includes('cashback')) {
          cashback += amount;
        } else if (gateway.includes('store_credit') || gateway.includes('gift_card')) {
          storeCredit += amount;
        } else {
          // Unknown gateway — log it, default to cash
          log('SHOPIFY_UNKNOWN_GATEWAY', gateway + ' | $' + amount);
          efectivo += amount;
        }
      });
    });

    // Auto-populate CORTE_TIENDA Shopify columns for this date
    const corteTiendaSheet = getOrCreateTab(CORTE_TIENDA_TAB, CORTE_TIENDA_HEADERS);
    const corteTiendaRow = findRowByDate(corteTiendaSheet, fecha);
    if (corteTiendaRow > 0) {
      const h = CORTE_TIENDA_HEADERS;
      corteTiendaSheet.getRange(corteTiendaRow, h.indexOf('Shopify_VentasTotales') + 1).setValue(ventasTotales);
      corteTiendaSheet.getRange(corteTiendaRow, h.indexOf('Shopify_Tarjeta') + 1).setValue(tarjeta);
      corteTiendaSheet.getRange(corteTiendaRow, h.indexOf('Shopify_Transferencias') + 1).setValue(transferencias);
      corteTiendaSheet.getRange(corteTiendaRow, h.indexOf('Shopify_Cashback') + 1).setValue(cashback);
      corteTiendaSheet.getRange(corteTiendaRow, h.indexOf('Shopify_StoreCredit') + 1).setValue(storeCredit);
      corteTiendaSheet.getRange(corteTiendaRow, h.indexOf('Discrepancia') + 1).setValue(
        parseFloat(corteTiendaSheet.getRange(corteTiendaRow, h.indexOf('PagosRecibidos') + 1).getValue()) - ventasTotales
      );
    }

    log('SHOPIFY_SYNC', fecha + ' | Orders: ' + orders.length + ' | Total: $' + ventasTotales);

    return {
      ok: true,
      fecha,
      orderCount: orders.length,
      ventasTotales,
      breakdown: { efectivo, tarjeta, transferencias, cashback, storeCredit },
      corteTiendaUpdated: corteTiendaRow > 0,
      message: 'Shopify sync complete: ' + orders.length + ' orders, $' + ventasTotales
    };

  } catch (err) {
    log('SHOPIFY_ERROR', fecha + ': ' + err.message);
    return { ok: false, error: err.message };
  }
}

// ══════════════════════════════════════════════
// SHOPIFY API — REUSABLE HELPERS & EXTENDED ROUTES
// ══════════════════════════════════════════════

/**
 * Reusable Shopify GraphQL fetch. Returns parsed JSON or throws.
 */
function shopifyFetch(query) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SHOPIFY_TOKEN');
  const store = props.getProperty('SHOPIFY_STORE');

  if (!token || !store) {
    throw new Error('Shopify not configured. Set SHOPIFY_TOKEN and SHOPIFY_STORE in Script Properties.');
  }

  const apiVersion = '2025-01';
  const url = 'https://' + store + '.myshopify.com/admin/api/' + apiVersion + '/graphql.json';

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': token },
    payload: JSON.stringify({ query }),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Shopify API error ' + code + ': ' + resp.getContentText().slice(0, 300));
  }

  const result = JSON.parse(resp.getContentText());
  if (result.errors) {
    throw new Error('Shopify GraphQL error: ' + JSON.stringify(result.errors).slice(0, 300));
  }
  return result;
}

/**
 * Map Shopify payment gateway string to NB category.
 */
function mapShopifyGateway(gateway) {
  const g = (gateway || '').toLowerCase();
  if (g.includes('cash') && !g.includes('back')) return 'efectivo';
  if (g.includes('card') || g.includes('tarjeta') || g.includes('stripe') || g.includes('shopify_payments')) return 'tarjeta';
  if (g.includes('transfer') || g.includes('bank')) return 'transferencias';
  if (g.includes('cashback')) return 'cashback';
  if (g.includes('store_credit') || g.includes('gift_card')) return 'storeCredit';
  return 'efectivo'; // unknown → default cash
}

/**
 * GET: Aggregated Shopify daily summary.
 * Params: fecha (single day) OR month + year (full month aggregate)
 * Returns: totals, payment breakdown, order count, avg order, channel split, top products
 */
function getShopifyDailySummary(params) {
  const fecha = params.fecha;
  const month = parseInt(params.month);
  const year = parseInt(params.year);

  // Build date filter
  let dateFilter;
  if (fecha) {
    dateFilter = "created_at:>='" + fecha + "T00:00:00' created_at:<='" + fecha + "T23:59:59'";
  } else if (month && year) {
    const startDate = year + '-' + String(month).padStart(2, '0') + '-01';
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
    dateFilter = "created_at:>='" + startDate + "T00:00:00' created_at:<='" + endDate + "T23:59:59'";
  } else {
    // Default: today
    const today = formatDateStr(new Date());
    dateFilter = "created_at:>='" + today + "T00:00:00' created_at:<='" + today + "T23:59:59'";
  }

  // Fetch orders with pagination (up to 750 orders = 3 pages)
  let allOrders = [];
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    const afterClause = cursor ? ', after: "' + cursor + '"' : '';
    const query = `{
      orders(first: 250, query: "${dateFilter}"${afterClause}) {
        edges {
          cursor
          node {
            name
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            channelInformation { channelDefinition { handle } }
            transactions(first: 10) {
              gateway
              kind
              status
              amountSet { shopMoney { amount } }
            }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  originalTotalSet { shopMoney { amount } }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`;

    const result = shopifyFetch(query);
    const edges = result.data?.orders?.edges || [];
    allOrders = allOrders.concat(edges);

    if (!result.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1].cursor;
  }

  // Aggregate
  let totalSales = 0;
  let payments = { efectivo: 0, tarjeta: 0, transferencias: 0, cashback: 0, storeCredit: 0 };
  let channels = { online: 0, pos: 0 };
  let productMap = {}; // title → { qty, revenue }
  let dailyMap = {};   // YYYY-MM-DD → totalSales

  allOrders.forEach(({ node: order }) => {
    const total = parseFloat(order.totalPriceSet?.shopMoney?.amount) || 0;
    totalSales += total;

    // Channel split
    const channel = (order.channelInformation?.channelDefinition?.handle || '').toLowerCase();
    if (channel.includes('point_of_sale') || channel.includes('pos')) {
      channels.pos += total;
    } else {
      channels.online += total;
    }

    // Daily breakdown (for monthly queries)
    const orderDate = (order.createdAt || '').slice(0, 10);
    if (orderDate) {
      dailyMap[orderDate] = (dailyMap[orderDate] || 0) + total;
    }

    // Payment breakdown from transactions
    (order.transactions || []).forEach(tx => {
      if (tx.kind !== 'SALE' && tx.kind !== 'sale') return;
      if (tx.status !== 'SUCCESS' && tx.status !== 'success') return;
      const amount = parseFloat(tx.amountSet?.shopMoney?.amount) || 0;
      const category = mapShopifyGateway(tx.gateway);
      payments[category] = (payments[category] || 0) + amount;
    });

    // Product aggregation
    (order.lineItems?.edges || []).forEach(({ node: item }) => {
      const title = item.title || 'Sin nombre';
      if (!productMap[title]) productMap[title] = { qty: 0, revenue: 0 };
      productMap[title].qty += item.quantity || 0;
      productMap[title].revenue += parseFloat(item.originalTotalSet?.shopMoney?.amount) || 0;
    });
  });

  // Top 5 products by revenue
  const topProducts = Object.entries(productMap)
    .map(([title, data]) => ({ title, qty: data.qty, revenue: Math.round(data.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Daily breakdown array (sorted)
  const dailyBreakdown = Object.entries(dailyMap)
    .map(([date, sales]) => ({ date, sales: Math.round(sales * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    ok: true,
    orderCount: allOrders.length,
    totalSales: Math.round(totalSales * 100) / 100,
    avgOrderValue: allOrders.length > 0 ? Math.round((totalSales / allOrders.length) * 100) / 100 : 0,
    payments: {
      efectivo: Math.round(payments.efectivo * 100) / 100,
      tarjeta: Math.round(payments.tarjeta * 100) / 100,
      transferencias: Math.round(payments.transferencias * 100) / 100,
      cashback: Math.round(payments.cashback * 100) / 100,
      storeCredit: Math.round(payments.storeCredit * 100) / 100
    },
    channels: {
      online: Math.round(channels.online * 100) / 100,
      pos: Math.round(channels.pos * 100) / 100
    },
    topProducts,
    dailyBreakdown,
    fecha: fecha || (year + '-' + String(month).padStart(2, '0'))
  };
}

/**
 * GET: Shopify product catalog with inventory quantities.
 * Returns all active products with variants, prices, SKUs.
 */
function getShopifyProducts(params) {
  let allProducts = [];
  let cursor = null;

  for (let page = 0; page < 4; page++) { // up to 1000 products
    const afterClause = cursor ? ', after: "' + cursor + '"' : '';
    const query = `{
      products(first: 250, query: "status:active"${afterClause}) {
        edges {
          cursor
          node {
            id
            title
            productType
            status
            totalInventory
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryQuantity
                  inventoryItem { id }
                }
              }
            }
            images(first: 1) {
              edges { node { url } }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`;

    const result = shopifyFetch(query);
    const edges = result.data?.products?.edges || [];
    allProducts = allProducts.concat(edges);

    if (!result.data?.products?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1].cursor;
  }

  const products = allProducts.map(({ node: p }) => ({
    id: p.id,
    title: p.title,
    productType: p.productType,
    totalInventory: p.totalInventory,
    imageUrl: p.images?.edges?.[0]?.node?.url || '',
    variants: (p.variants?.edges || []).map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: parseFloat(v.price) || 0,
      inventoryQuantity: v.inventoryQuantity || 0,
      inventoryItemId: v.inventoryItem?.id || ''
    }))
  }));

  return { ok: true, products, count: products.length };
}

/**
 * GET: Shopify inventory levels per location.
 * Returns stock per product/variant per location.
 */
function getShopifyInventory(params) {
  // First get locations
  const locQuery = `{ locations(first: 10) { edges { node { id name } } } }`;
  const locResult = shopifyFetch(locQuery);
  const locations = (locResult.data?.locations?.edges || []).map(({ node }) => ({
    id: node.id,
    name: node.name
  }));

  // Then get inventory levels for each location
  const inventoryByLocation = [];

  for (const loc of locations) {
    // Extract numeric ID from gid
    const locGid = loc.id;
    const query = `{
      location(id: "${locGid}") {
        inventoryLevels(first: 250) {
          edges {
            node {
              available
              item {
                id
                variant {
                  id
                  title
                  sku
                  product { id title }
                }
              }
            }
          }
        }
      }
    }`;

    try {
      const result = shopifyFetch(query);
      const levels = (result.data?.location?.inventoryLevels?.edges || []).map(({ node }) => ({
        locationId: locGid,
        locationName: loc.name,
        available: node.available,
        inventoryItemId: node.item?.id || '',
        variantId: node.item?.variant?.id || '',
        variantTitle: node.item?.variant?.title || '',
        sku: node.item?.variant?.sku || '',
        productId: node.item?.variant?.product?.id || '',
        productTitle: node.item?.variant?.product?.title || ''
      }));
      inventoryByLocation.push(...levels);
    } catch (e) {
      log('SHOPIFY_INVENTORY_ERROR', loc.name + ': ' + e.message);
    }
  }

  return {
    ok: true,
    locations,
    inventory: inventoryByLocation,
    count: inventoryByLocation.length
  };
}

/**
 * GET: Quick Shopify health check — verifies token works.
 */
function shopifyHealthCheck() {
  try {
    const result = shopifyFetch('{ shop { name myshopifyDomain } }');
    return {
      ok: true,
      shop: result.data?.shop?.name,
      domain: result.data?.shop?.myshopifyDomain,
      message: 'Shopify connection verified'
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Auto daily sync wrapper — for time-driven trigger.
 * Call this at 11:30 PM to auto-populate Corte de Tienda Shopify columns.
 */
function autoSyncShopifyDaily() {
  const today = formatDateStr(new Date());
  const result = syncShopifyDaily({ fecha: today });
  log('AUTO_SHOPIFY_SYNC', today + ' | ' + JSON.stringify(result).slice(0, 200));
  return result;
}

// ══════════════════════════════════════════════
// EMPLOYEE ACCURACY / FALTANTE-SOBRANTE HISTORY
// ══════════════════════════════════════════════

function getFaltanteHistory(params) {
  const cortes = sheetToObjects(CORTES_IND_TAB, CORTES_IND_HEADERS);
  let filtered = cortes;

  if (params.colaborador) {
    filtered = filtered.filter(r => String(r.Colaborador).toLowerCase().includes(params.colaborador.toLowerCase()));
  }
  if (params.month) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha).startsWith(params.month));
  }
  if (params.startDate) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) >= params.startDate);
  }

  // Aggregate by employee
  const byEmployee = {};
  filtered.forEach(r => {
    const name = r.Colaborador || 'Desconocido';
    if (!byEmployee[name]) {
      byEmployee[name] = { count: 0, totalFS: 0, faltantes: 0, sobrantes: 0, exactos: 0 };
    }
    const fs = parseFloat(r.FaltanteSobrante) || 0;
    byEmployee[name].count++;
    byEmployee[name].totalFS += fs;
    if (fs < -1) byEmployee[name].faltantes++;
    else if (fs > 1) byEmployee[name].sobrantes++;
    else byEmployee[name].exactos++;
  });

  // Calculate accuracy score
  Object.keys(byEmployee).forEach(name => {
    const e = byEmployee[name];
    e.avgFS = Math.round((e.totalFS / e.count) * 100) / 100;
    e.accuracy = Math.round((e.exactos / e.count) * 100);
  });

  return { employees: byEmployee, totalCortes: filtered.length };
}

// ══════════════════════════════════════════════
// MESA SALES SUMMARY (for productivity bonuses)
// ══════════════════════════════════════════════

function getMesaSales(params) {
  const ingresos = sheetToObjects(INGRESOS_TAB, INGRESOS_HEADERS);
  let filtered = ingresos;

  if (params.from && params.to) {
    filtered = filtered.filter(r => {
      const f = formatDateStr(r.Fecha);
      return f >= params.from && f <= params.to;
    });
  } else if (params.month) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha).startsWith(params.month));
  }
  if (params.startDate) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha) >= params.startDate);
  }

  const mesaFields = [
    'Cocina1', 'Cocina2', 'Cocina3',
    'Produccion1', 'Produccion2', 'Produccion3',
    'Casa1', 'Casa2', 'Express', 'Granja',
    'FrutasVerduras', 'ProveedorVentas', 'MermasCanastas', 'Pedidos', 'Mixto'
  ];

  const totals = {};
  mesaFields.forEach(f => { totals[f] = 0; });

  filtered.forEach(r => {
    mesaFields.forEach(f => {
      totals[f] += parseFloat(r[f]) || 0;
    });
  });

  return {
    period: params.from && params.to ? params.from + ' to ' + params.to : (params.month || 'all'),
    days: filtered.length,
    mesaSales: totals,
    grandTotal: Object.values(totals).reduce((s, v) => s + v, 0)
  };
}


// ══════════════════════════════════════════════════════════════
// PORCENTAJES MESA — Editable bonus percentage matrix
// ══════════════════════════════════════════════════════════════

/**
 * Seeds the PORCENTAJES_MESA tab with default data if empty.
 * Layout:
 *   Row 1: Header row — blank, then each BONUS_MESA key
 *   Rows 2-11: Source mesas (PCTJ_SOURCE_MESAS) with percentage values
 *   Row 12: blank separator
 *   Row 13: "TasaBono" — multiplier per destination mesa (0.005, 0.006, 0.007)
 *   Row 14: "TasaPagosRecibidos" — flat % of PagosRecibidos per destination mesa
 *   Row 15: blank separator
 *   Row 16: "AuxTienda_Tasa" — flat rate label + value in col B
 *   Row 17: "LiderTienda_Tasa" — flat rate label + value in col B
 */
function seedPorcentajesMesa() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PORCENTAJES_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(PORCENTAJES_TAB);
  }

  // Check if already has data
  if (sheet.getLastRow() > 1) return sheet;

  // Header row: blank + destination mesa labels
  const header = ['Mesa / Fuente'];
  BONUS_MESAS.forEach(m => header.push(BONUS_MESA_LABELS[m] || m));
  sheet.getRange(1, 1, 1, header.length).setValues([header]);

  // Default percentage matrix — rows = source, cols = destination (BONUS_MESAS order)
  // Destination order: Prod1, Prod2, Prod3, Casa1, Casa2, Cocina1, Cocina2, Cocina3, Express
  const matrix = {
    'Cocina1':      [0.05,  0.20,  0.05,  0,     0,     0.60,  0.10,  0,     0    ],
    'Cocina2':      [0.40,  0,     0,     0,     0,     0,     0.60,  0,     0    ],
    'Cocina3':      [0,     0.15,  0,     0,     0,     0,     0,     0.85,  0    ],
    'Casa1':        [0.05,  0,     0,     0.95,  0,     0,     0,     0,     0    ],
    'Casa2':        [0.05,  0.175, 0.175, 0,     0.60,  0,     0,     0,     0    ],
    'Express':      [0.08,  0.11,  0.11,  0,     0.25,  0,     0,     0.05,  0.40 ],
    'Produccion1':  [1.00,  0,     0,     0,     0,     0,     0,     0,     0    ],
    'Produccion2':  [0,     1.00,  0,     0,     0,     0,     0,     0,     0    ],
    'Produccion3':  [0.08,  0,     0.92,  0,     0,     0,     0,     0,     0    ]
  };

  const sourceLabels = {
    'Cocina1': 'Cocina 1', 'Cocina2': 'Cocina 2', 'Cocina3': 'Cocina 3',
    'Casa1': 'Casa 1', 'Casa2': 'Casa 2', 'Express': 'Express',
    'Produccion1': 'Producción 1', 'Produccion2': 'Producción 2', 'Produccion3': 'Producción 3'
  };

  // Write source rows
  PCTJ_SOURCE_MESAS.forEach((src, i) => {
    const row = [sourceLabels[src] || src, ...matrix[src]];
    sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
  });

  // Blank row 12
  const blankRow = PCTJ_SOURCE_MESAS.length + 2; // row 12

  // TasaBono row (row 13)
  // Order: Prod1, Prod2, Prod3, Casa1, Casa2, Cocina1, Cocina2, Cocina3, Express
  const tasaBono = ['Tasa Bono', 0.005, 0.006, 0.006, 0.007, 0.006, 0.007, 0.007, 0.006, 0.007];
  sheet.getRange(blankRow + 1, 1, 1, tasaBono.length).setValues([tasaBono]);

  // TasaPagosRecibidos row (row 14)
  // Only Prod3, Casa1 have flat PagosRecibidos rates among mesa bonuses
  const tasaPR = ['Tasa PagosRecibidos', 0, 0, 0.00015, 0.0003, 0, 0, 0, 0, 0];
  sheet.getRange(blankRow + 2, 1, 1, tasaPR.length).setValues([tasaPR]);

  // Blank row 15, then flat-rate roles
  const flatRow = blankRow + 4; // row 16
  sheet.getRange(flatRow, 1, 1, 2).setValues([['Aux Tienda (tasa PR)', 0.0006]]);
  sheet.getRange(flatRow + 1, 1, 1, 2).setValues([['Líder Tienda (tasa PR)', 0.0008]]);
  sheet.getRange(flatRow + 2, 1, 1, 2).setValues([['Cantidad Aux Tienda', 4]]);

  // Format: bold header row, percentage format for matrix
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sheet.getRange(blankRow + 1, 1, 1, 1).setFontWeight('bold');
  sheet.getRange(blankRow + 2, 1, 1, 1).setFontWeight('bold');
  sheet.getRange(flatRow, 1, 2, 1).setFontWeight('bold');

  // Auto-resize columns
  for (let c = 1; c <= header.length; c++) {
    sheet.autoResizeColumn(c);
  }

  log('SEED_PORCENTAJES', 'Created PORCENTAJES_MESA tab with default values');
  return sheet;
}

/**
 * Reads the percentage matrix, rates, and flat-rate roles from PORCENTAJES_MESA.
 * Returns a structured object the frontend and calcBonos can use.
 */
function getPercentageMatrix() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PORCENTAJES_TAB);
  if (!sheet || sheet.getLastRow() < 2) {
    sheet = seedPorcentajesMesa();
  }

  const data = sheet.getDataRange().getValues();
  const destMesas = BONUS_MESAS; // column order

  // Parse percentage matrix (rows 2 through PCTJ_SOURCE_MESAS.length + 1)
  const matrix = {};
  for (let i = 1; i <= PCTJ_SOURCE_MESAS.length && i < data.length; i++) {
    const sourceKey = PCTJ_SOURCE_MESAS[i - 1];
    const row = data[i];
    const pcts = {};
    destMesas.forEach((dest, j) => {
      pcts[dest] = parseFloat(row[j + 1]) || 0;
    });
    matrix[sourceKey] = pcts;
  }

  // Parse TasaBono row (after source rows + blank)
  const tasaBonoRow = PCTJ_SOURCE_MESAS.length + 2; // 0-indexed in data array
  const tasaBono = {};
  if (tasaBonoRow < data.length) {
    destMesas.forEach((dest, j) => {
      tasaBono[dest] = parseFloat(data[tasaBonoRow][j + 1]) || 0;
    });
  }

  // Parse TasaPagosRecibidos row
  const tasaPRRow = tasaBonoRow + 1;
  const tasaPR = {};
  if (tasaPRRow < data.length) {
    destMesas.forEach((dest, j) => {
      tasaPR[dest] = parseFloat(data[tasaPRRow][j + 1]) || 0;
    });
  }

  // Parse flat-rate roles
  const flatRow = tasaBonoRow + 3; // skip blank row
  const auxTasa = (flatRow < data.length) ? (parseFloat(data[flatRow][1]) || 0) : 0.0006;
  const liderTasa = (flatRow + 1 < data.length) ? (parseFloat(data[flatRow + 1][1]) || 0) : 0.0008;
  const auxCount = (flatRow + 2 < data.length) ? (parseInt(data[flatRow + 2][1]) || 4) : 4;

  return {
    ok: true,
    destMesas,
    sourceMesas: PCTJ_SOURCE_MESAS,
    matrix,
    tasaBono,
    tasaPagosRecibidos: tasaPR,
    flatRates: {
      auxTienda: auxTasa,
      liderTienda: liderTasa,
      auxCount: auxCount
    },
    destLabels: BONUS_MESA_LABELS
  };
}


// ══════════════════════════════════════════════════════════════
// VENTAS MESA — Biweekly mesa sales + bonus calculation
// ══════════════════════════════════════════════════════════════

/**
 * Calculates bonuses for all mesas given sales data and PagosRecibidos.
 * Reads the percentage matrix from PORCENTAJES_MESA (fully dynamic — edit the sheet, bonuses change).
 */
function calcBonos(params) {
  // Handle sales as JSON string (GET request) or object (POST request)
  let sales = params.sales || {};
  if (typeof sales === 'string') {
    try { sales = JSON.parse(sales); } catch(e) { sales = {}; }
  }
  const pagosRecibidos = parseFloat(params.pagosRecibidos) || 0;

  // Read the editable matrix
  const pm = getPercentageMatrix();
  const bonos = {};

  // For each destination mesa, calculate its weighted sales total then multiply by its rate
  pm.destMesas.forEach(dest => {
    let weightedTotal = 0;

    // Sum: for each source mesa, sales[source] × matrix[source][dest]
    pm.sourceMesas.forEach(src => {
      const pct = (pm.matrix[src] && pm.matrix[src][dest]) ? pm.matrix[src][dest] : 0;
      const srcSales = parseFloat(sales[src]) || 0;
      weightedTotal += srcSales * pct;
    });

    // Apply the mesa's bonus rate
    const rate = pm.tasaBono[dest] || 0;
    let bono = weightedTotal * rate;

    // Add flat PagosRecibidos component if applicable
    const prRate = pm.tasaPagosRecibidos[dest] || 0;
    if (prRate > 0) {
      bono += pagosRecibidos * prRate;
    }

    bonos[dest] = Math.round(bono * 100) / 100;
  });

  // Flat-rate roles (not mesa-based, just PagosRecibidos × rate)
  const auxPerPerson = Math.round(pagosRecibidos * pm.flatRates.auxTienda * 100) / 100;
  const auxCount = pm.flatRates.auxCount || 4;
  bonos['AuxTienda'] = auxPerPerson;
  bonos['AuxTienda_Total'] = Math.round(auxPerPerson * auxCount * 100) / 100;
  bonos['AuxTienda_Count'] = auxCount;
  bonos['LiderTienda'] = Math.round(pagosRecibidos * pm.flatRates.liderTienda * 100) / 100;

  // Total: sum of 9 mesa bonuses + (aux per person × count) + líder
  let total = 0;
  pm.destMesas.forEach(d => total += bonos[d] || 0);
  total += bonos['AuxTienda_Total'] + bonos['LiderTienda'];

  return {
    ok: true,
    bonos,
    totalBonos: Math.round(total * 100) / 100,
    pagosRecibidos,
    salesUsed: sales
  };
}

/**
 * Saves biweekly mesa sales to VENTAS_MESA tab and calculates bonuses.
 * Also auto-sums PagosRecibidos from INGRESOS for the date range.
 */
function saveVentasMesa(body) {
  const sheet = getOrCreateTab(VENTAS_MESA_TAB, VENTAS_MESA_HEADERS);
  const vm = body.ventasMesa || body;
  const fechaInicio = vm.FechaInicio;
  const fechaFin = vm.FechaFin;

  if (!fechaInicio || !fechaFin) {
    throw new Error('FechaInicio y FechaFin son requeridas');
  }

  // Auto-sum PagosRecibidos from INGRESOS for the date range
  const ssTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const ingresos = sheetToObjects(INGRESOS_TAB, INGRESOS_HEADERS);
  let totalPR = 0;
  ingresos.forEach(r => {
    const fecha = formatDateStr(r.Fecha);
    if (fecha >= fechaInicio && fecha <= fechaFin) {
      totalPR += parseFloat(r.PagosRecibidos) || 0;
    }
  });

  // Use provided PagosRecibidos if given, otherwise auto-sum
  const pagosRecibidos = vm.PagosRecibidos !== undefined ? parseFloat(vm.PagosRecibidos) : totalPR;

  // Collect ALL mesa sales (matches Shopify vendor categories)
  const sales = {};
  ALL_MESAS.forEach(m => {
    sales[m] = parseFloat(vm[m]) || 0;
  });

  // Calculate bonuses (only uses the 9 BONUS_MESAS internally)
  const bonoResult = calcBonos({ sales, pagosRecibidos });
  const bonos = bonoResult.bonos;

  // Check for existing period (upsert)
  const data = sheet.getDataRange().getValues();
  let existingRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === fechaInicio && String(data[i][2]) === fechaFin) {
      existingRow = i + 1;
      break;
    }
  }

  const id = existingRow > 0 ? data[existingRow - 1][0] : 'VM' + Date.now();
  const now = new Date().toISOString();

  // Row includes ALL mesa sales + bonuses (order must match VENTAS_MESA_HEADERS)
  const mesaSalesValues = ALL_MESAS.map(m => sales[m] || 0);
  const row = [
    id, fechaInicio, fechaFin,
    ...mesaSalesValues,
    pagosRecibidos,
    bonos.Produccion1, bonos.Produccion2, bonos.Produccion3,
    bonos.Casa1, bonos.Casa2,
    bonos.Cocina1, bonos.Cocina2, bonos.Cocina3,
    bonos.Express,
    bonos.AuxTienda, bonos.LiderTienda,
    bonoResult.totalBonos,
    existingRow > 0 ? data[existingRow - 1][VENTAS_MESA_HEADERS.indexOf('Created_At')] : now,
    now
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    log('UPDATE_VENTAS_MESA', fechaInicio + ' to ' + fechaFin + ' | Total bonos: $' + bonoResult.totalBonos);
  } else {
    sheet.appendRow(row);
    log('SAVE_VENTAS_MESA', id + ' | ' + fechaInicio + ' to ' + fechaFin + ' | Total bonos: $' + bonoResult.totalBonos);
  }

  SpreadsheetApp.flush();

  return {
    ok: true,
    id,
    bonos,
    totalBonos: bonoResult.totalBonos,
    pagosRecibidos,
    sales,
    updated: existingRow > 0,
    message: existingRow > 0 ? 'Ventas por mesa actualizadas' : 'Ventas por mesa guardadas'
  };
}

/**
 * Gets saved ventas mesa periods (for history / listing).
 */
function getVentasMesa(params) {
  const all = sheetToObjects(VENTAS_MESA_TAB, VENTAS_MESA_HEADERS);
  let filtered = all;

  if (params.fechaInicio && params.fechaFin) {
    filtered = filtered.filter(r =>
      String(r.FechaInicio) === params.fechaInicio &&
      String(r.FechaFin) === params.fechaFin
    );
  }

  return { ok: true, periodos: filtered, count: filtered.length };
}
