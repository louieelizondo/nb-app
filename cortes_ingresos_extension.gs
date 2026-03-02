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
  'ID', 'Fecha', 'Colaborador',
  'Fondo1', 'Fondo2', 'Fondo3', 'FondoRepartidor', 'BolsitaCambio', 'GastosReponer',
  // Denominations
  'D_1000', 'D_500', 'D_200', 'D_100', 'D_50', 'D_20',
  'D_10', 'D_5', 'D_2', 'D_1', 'D_050',
  'TotalEfectivo', 'TotalCajaChica', 'FaltanteSobrante',
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
  const d = new Date(fechaStr);
  if (isNaN(d.getTime())) return { dia: '', mes: '', mesNum: 0, anio: 0 };
  return {
    dia: DIAS_SEMANA[d.getDay()],
    mes: MESES[d.getMonth() + 1],
    mesNum: d.getMonth() + 1,
    anio: d.getFullYear()
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

function formatDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'America/Mexico_City', 'yyyy-MM-dd');
  }
  // Already a string — normalize
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
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
    c.Fecha || formatDateStr(new Date()),
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
  const filtered = all.filter(r => formatDateStr(r.Fecha) === fecha);
  return { cortes: filtered, count: filtered.length, fecha };
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
  const expectedCash = pagosRecibidos - tarjeta - transferencias - storeCredit + cashback;
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
  const depositoAjustado = pagosRecibidos - sobre2;

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

  const totalEfectivo = calcTotalEfectivo(a);
  const fondo1 = parseFloat(a.Fondo1) || 0;
  const fondo2 = parseFloat(a.Fondo2) || 0;
  const fondo3 = parseFloat(a.Fondo3) || 0;
  const fondoRep = parseFloat(a.FondoRepartidor) || 0;
  const bolsita = parseFloat(a.BolsitaCambio) || 0;
  const gastosRep = parseFloat(a.GastosReponer) || 0;
  const totalCajaChica = fondo1 + fondo2 + fondo3 + fondoRep + bolsita + gastosRep;
  const faltanteSobrante = Math.round((totalEfectivo - totalCajaChica) * 100) / 100;

  const denoms = getDenomValues(a);
  const row = [
    id,
    a.Fecha || formatDateStr(new Date()),
    a.Colaborador || '',
    fondo1, fondo2, fondo3, fondoRep, bolsita, gastosRep,
    ...denoms,
    totalEfectivo, totalCajaChica, faltanteSobrante,
    new Date().toISOString(),
    a.Device || 'web'
  ];

  sheet.appendRow(row);
  log('ARQUEO', id + ' | $' + totalEfectivo + ' vs $' + totalCajaChica + ' | F/S: $' + faltanteSobrante);
  writeAuditInternal('Cortes', 'ARQUEO_CAJA', a.Device || '', a.Colaborador + ' | F/S: $' + faltanteSobrante);

  return { ok: true, id, totalEfectivo, totalCajaChica, faltanteSobrante, message: 'Arqueo registrado' };
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
  return { transferencias: filtered, count: filtered.length };
}

// ══════════════════════════════════════════════
// INGRESOS (The Brain — one row per day)
// ══════════════════════════════════════════════

function saveIngreso(body) {
  const sheet = getOrCreateTab(INGRESOS_TAB, INGRESOS_HEADERS);
  const ing = body.ingreso || body;
  const fecha = ing.Fecha || formatDateStr(new Date());

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
  const totalXFacturar = pagosRecibidos - sobre2;
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
  if (params.year) {
    filtered = filtered.filter(r => formatDateStr(r.Fecha).startsWith(params.year));
  }
  if (params.mes) {
    filtered = filtered.filter(r => String(r.Mes) === params.mes);
  }
  return { ingresos: filtered, count: filtered.length };
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
  const depositoBBVA = pagosRecibidos - sobre2;
  sheet.getRange(rowNum, headers.indexOf('DepositoBBVA') + 1).setValue(depositoBBVA);

  // Recalc TotalXFacturar and FaltaFactura
  const totalXFacturar = pagosRecibidos - sobre2;
  sheet.getRange(rowNum, headers.indexOf('TotalXFacturar') + 1).setValue(totalXFacturar);

  const totalFacturado = parseFloat(sheet.getRange(rowNum, headers.indexOf('TotalFacturado') + 1).getValue()) || 0;
  sheet.getRange(rowNum, headers.indexOf('FaltaFactura') + 1).setValue(totalXFacturar - totalFacturado);

  sheet.getRange(rowNum, headers.indexOf('Updated_At') + 1).setValue(new Date().toISOString());

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
    monthGastos = facturas.filter(r =>
      formatDateStr(r.Fecha_Compra).startsWith(month) || formatDateStr(r.Fecha_Pago).startsWith(month)
    );
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

  return {
    year,
    monthly,
    dailySales,
    dayOfWeekAvg,
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
