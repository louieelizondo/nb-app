/**
 * Bono Productividad — per-employee biweekly bonus engine.
 *
 * Wraps existing calcBonos() (per-mesa) and adds:
 *   - Mapping mesa → colaborador via Notion Colaboradores Activos
 *   - Attendance multiplier from Notion Reporte de Nómina semanal (faltas + retardos del período)
 *   - Round up to nearest $10
 *   - Manual ajuste +/-
 *   - Persistent storage in BONO_PRODUCTIVIDAD tab
 *
 * Setup required (one-time, in Apps Script Project Settings → Script Properties):
 *   NOTION_TOKEN = secret_xxx (internal integration token, share databases below with this integration)
 *
 * Author: Claude + Louie · 2026-05-04
 */

// ─── Constants ────────────────────────────────────────────────────────────
const BONO_PRODUCTIVIDAD_TAB = 'BONO_PRODUCTIVIDAD';
const BONO_PRODUCTIVIDAD_HEADERS = [
  'ID', 'QuincenaInicio', 'QuincenaFin',
  'NumeroColab', 'Colaborador', 'Mesa', 'TipoCalc',
  'BonoBase', 'Faltas', 'Retardos', 'Multiplicador',
  'SubBono', 'BonoRedondeado', 'Ajuste', 'BonoFinal',
  'Notas', 'FechaGuardado', 'Updated_At'
];

// Notion config
// Using API version 2025-09-03 + /data_sources endpoint (required for DBs with multiple data sources).
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_API_VERSION = '2025-09-03';
// Data source IDs (NOT database IDs). Get them from `<data-source url="collection://...">` in fetch responses.
const NOTION_DS_COLABORADORES_ACTIVOS = '53bf0b9f-50fb-4c27-ae7e-cd2696df0c8f';
const NOTION_DS_REPORTE_NOMINA_SEMANAL = '1763b368-f496-81ff-8806-000b6936b724';

// Excluded from bono productividad (they have other compensation):
//   #48 Louicarlos (Marketing — has own monthly bono)
//   #65 Enrique González Pando (Granja — no bono)
const BONO_PROD_EXCLUDED_NUMEROS = [48, 65];


// ─── Notion API helpers ────────────────────────────────────────────────────

function notionToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('NOTION_TOKEN no está configurado en Script Properties.');
  return t;
}

/**
 * Calls Notion API. Returns parsed JSON. Throws on non-200.
 * Optional retry for rate limits / transient errors.
 */
function notionFetch_(method, path, body) {
  const url = NOTION_API_BASE + path;
  const opts = {
    method: method.toLowerCase(),
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + notionToken_(),
      'Notion-Version': NOTION_API_VERSION
    },
    muteHttpExceptions: true
  };
  if (body) opts.payload = JSON.stringify(body);

  const resp = UrlFetchApp.fetch(url, opts);
  const code = resp.getResponseCode();
  const text = resp.getContentText();

  if (code === 429) {
    Utilities.sleep(1000);
    return notionFetch_(method, path, body);  // retry once on rate limit
  }
  if (code < 200 || code >= 300) {
    throw new Error('Notion API ' + code + ': ' + text.substring(0, 500));
  }
  return JSON.parse(text);
}

/**
 * Query a Notion data source, paginating through all results.
 * Uses /v1/data_sources/{id}/query (Notion-Version 2025-09-03+) which supports
 * databases with multiple data sources. The legacy /v1/databases/{id}/query
 * fails with 400 on multi-source databases.
 */
function notionQueryAll_(dataSourceId, filter, sorts) {
  const results = [];
  let cursor = null;
  do {
    const body = {
      filter: filter || undefined,
      sorts: sorts || undefined,
      start_cursor: cursor || undefined,
      page_size: 100
    };
    const resp = notionFetch_('POST', '/data_sources/' + dataSourceId + '/query', body);
    results.push.apply(results, resp.results || []);
    cursor = resp.has_more ? resp.next_cursor : null;
  } while (cursor);
  return results;
}

/** Extract a property value from a Notion page object, handling type variations. */
function notionPropValue_(page, propName) {
  const prop = page.properties && page.properties[propName];
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return (prop.title || []).map(t => t.plain_text).join('').trim();
    case 'rich_text':
      return (prop.rich_text || []).map(t => t.plain_text).join('').trim();
    case 'number':
      return prop.number;
    case 'select':
      return prop.select ? prop.select.name : null;
    case 'multi_select':
      return (prop.multi_select || []).map(o => o.name);
    case 'checkbox':
      return prop.checkbox === true;
    case 'date':
      return prop.date ? prop.date.start : null;
    case 'formula':
      const f = prop.formula || {};
      return f.number !== undefined ? f.number : (f.string !== undefined ? f.string : (f.boolean !== undefined ? f.boolean : null));
    default:
      return null;
  }
}


// ─── Employee roster (from Notion Colaboradores Activos) ───────────────────

/**
 * Returns list of active colaboradores with their mesa assignment.
 * Filters: Estado = "Activo", excludes those in BONO_PROD_EXCLUDED_NUMEROS.
 *
 * Each entry: {numero, nombre, mesa, areaTrabajo, tipoCalc}
 *   tipoCalc = 'Mesa' | 'AuxTienda' | 'LiderTienda' | 'LiderCEDIS' | 'NoBono'
 */
function getBonoEmployeeRoster() {
  const filter = {
    property: 'Estado ',
    select: { equals: 'Activo' }
  };
  const pages = notionQueryAll_(NOTION_DS_COLABORADORES_ACTIVOS, filter, [
    { property: 'Número Colab.', direction: 'ascending' }
  ]);

  const roster = [];
  pages.forEach(page => {
    const numero = notionPropValue_(page, 'Número Colab.');
    if (numero == null || BONO_PROD_EXCLUDED_NUMEROS.indexOf(numero) >= 0) return;

    const nombre = notionPropValue_(page, 'Nombre') || '';
    const mesaArr = notionPropValue_(page, 'Mesa / Puesto ') || [];
    const mesaPrimary = Array.isArray(mesaArr) ? mesaArr[0] : mesaArr;
    if (!mesaPrimary) return;

    roster.push({
      numero: numero,
      nombre: nombre,
      mesa: mesaPrimary,
      mesaAll: mesaArr,
      tipoCalc: classifyMesa_(mesaPrimary)
    });
  });

  return roster;
}

function classifyMesa_(mesa) {
  if (!mesa) return 'NoBono';
  const m = String(mesa).toLowerCase();
  if (m.indexOf('líder tienda') >= 0 || m.indexOf('lider tienda') >= 0) return 'LiderTienda';
  if (m.indexOf('aux mixto') >= 0 || m.indexOf('repartidor') >= 0 || m.indexOf('compras') >= 0) return 'AuxTienda';
  if (m.indexOf('cocina') >= 0 || m.indexOf('casa') >= 0 || m.indexOf('producción') >= 0 || m.indexOf('produccion') >= 0 || m.indexOf('express') >= 0) return 'Mesa';
  return 'NoBono';  // Marketing, Granja, etc. shouldn't get here (excluded above)
}


// ─── Attendance for period (from Notion Reporte de Nómina semanal) ─────────

/**
 * Sums faltas + retardos per colaborador from Notion Reporte de Nómina semanal,
 * for all weekly rows whose Date falls within [start, end].
 *
 * Returns: { 'NombreNormalizado': { faltas: N, retardos: N } }
 */
function getAttendanceForPeriod(startDate, endDate) {
  const filter = {
    and: [
      { property: 'Date', date: { on_or_after: startDate } },
      { property: 'Date', date: { on_or_before: endDate } }
    ]
  };
  const pages = notionQueryAll_(NOTION_DS_REPORTE_NOMINA_SEMANAL, filter);

  const map = {};
  pages.forEach(page => {
    const nombre = notionPropValue_(page, 'Colaborador') || '';
    const faltas = notionPropValue_(page, 'Faltas') || 0;
    const retardos = notionPropValue_(page, 'Retardos ') || 0;
    const key = normalizeName_(nombre);
    if (!map[key]) map[key] = { faltas: 0, retardos: 0 };
    map[key].faltas += parseFloat(faltas) || 0;
    map[key].retardos += parseFloat(retardos) || 0;
  });
  return map;
}

function normalizeName_(name) {
  return String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
}


// ─── Bono multiplier rules ─────────────────────────────────────────────────

/**
 * Bono Productividad rules (faltas + retardos suman):
 *   2+ Faltas         → 0%
 *   1 Falta + 4+ R    → 0% (suman ≥ 5+)
 *   1 Falta + ≤3 R    → 50%
 *   6+ Retardos       → 0%
 *   4-5 Retardos      → 50%
 *   ≤3 Retardos, 0 F  → 100%
 */
function computeBonoMultiplier(faltas, retardos) {
  const f = parseInt(faltas) || 0;
  const r = parseInt(retardos) || 0;

  if (f >= 2) return 0;
  if (f === 1) {
    if (r >= 4) return 0;   // suman ≥ 5
    return 0.5;
  }
  // f === 0
  if (r >= 6) return 0;
  if (r >= 4) return 0.5;
  return 1.0;
}

function roundUpToTen_(amount) {
  if (amount <= 0) return 0;
  return Math.ceil(amount / 10) * 10;
}


// ─── Main engine: calculate bono productividad for a period ────────────────

/**
 * Builds the bono table for a quincena.
 * Steps:
 *   1. Read VENTAS_MESA row for [start, end] → has per-mesa bonos already (calcBonos result is stored)
 *   2. If no row exists, fall back to live calcBonos() with whatever sales are passed in (or zeros)
 *   3. Get employee roster from Notion (mesa assignment)
 *   4. Get attendance from Notion Reporte de Nómina semanal
 *   5. For each colaborador: compute base, multiplier, sub, round, final (ajuste = 0 default)
 *   6. Read existing saved BONO_PRODUCTIVIDAD rows for this period to preserve manual ajustes/notas
 *
 * Returns: { ok, period, ventas, pagosRecibidos, bonosPorMesa, rows: [{...per employee}] }
 */
function getBonoProductividadData(params) {
  const start = params.start || params.fechaInicio;
  const end = params.end || params.fechaFin;
  if (!start || !end) throw new Error('start y end (YYYY-MM-DD) son requeridos');

  // Step 1: load VENTAS_MESA for period (get per-mesa bonos)
  const vmRow = findVentasMesaRow_(start, end);
  let bonosPorMesa = null;
  let pagosRecibidos = 0;
  let ventasPorMesa = {};

  if (vmRow) {
    bonosPorMesa = {
      Cocina1: vmRow.Bono_Cocina1 || 0,
      Cocina2: vmRow.Bono_Cocina2 || 0,
      Cocina3: vmRow.Bono_Cocina3 || 0,
      Casa1: vmRow.Bono_Casa1 || 0,
      Casa2: vmRow.Bono_Casa2 || 0,
      Express: vmRow.Bono_Express || 0,
      Produccion1: vmRow.Bono_Produccion1 || 0,
      Produccion2: vmRow.Bono_Produccion2 || 0,
      Produccion3: vmRow.Bono_Produccion3 || 0,
      AuxTienda: vmRow.Bono_AuxTienda || 0,         // per person
      LiderTienda: vmRow.Bono_LiderTienda || 0
    };
    pagosRecibidos = vmRow.PagosRecibidos || 0;
    ventasPorMesa = {
      Cocina1: vmRow.Cocina1, Cocina2: vmRow.Cocina2, Cocina3: vmRow.Cocina3,
      Casa1: vmRow.Casa1, Casa2: vmRow.Casa2, Express: vmRow.Express,
      Produccion1: vmRow.Produccion1, Produccion2: vmRow.Produccion2, Produccion3: vmRow.Produccion3,
      Granja: vmRow.Granja, FrutasVerduras: vmRow.FrutasVerduras,
      MermasCanastas: vmRow.MermasCanastas, ProveedorVentas: vmRow.ProveedorVentas
    };
  }
  // If no VENTAS_MESA row, leave bonos null — frontend will need to capture sales first

  // Step 2: roster + attendance
  const roster = getBonoEmployeeRoster();
  const attendance = getAttendanceForPeriod(start, end);

  // Step 3: existing saved rows (to preserve ajustes/notas)
  const savedRows = loadSavedBonoRows_(start, end);

  // Step 4: build per-employee rows
  const rows = roster.map(emp => {
    const base = computeBonoBaseForEmployee_(emp, bonosPorMesa);
    const att = attendance[normalizeName_(emp.nombre)] || { faltas: 0, retardos: 0 };
    const multiplier = computeBonoMultiplier(att.faltas, att.retardos);
    const subBono = base * multiplier;
    const bonoRedondeado = roundUpToTen_(subBono);

    // Preserve manual fields if already saved
    const saved = savedRows[String(emp.numero)] || {};
    const ajuste = saved.Ajuste != null ? parseFloat(saved.Ajuste) : 0;
    const notas = saved.Notas || '';
    const multiplicadorOverride = saved.Multiplicador != null ? parseFloat(saved.Multiplicador) : null;
    const finalMult = multiplicadorOverride != null ? multiplicadorOverride : multiplier;
    const finalSub = base * finalMult;
    const finalRedondeo = roundUpToTen_(finalSub);
    const bonoFinal = Math.max(0, finalRedondeo + ajuste);

    return {
      numero: emp.numero,
      nombre: emp.nombre,
      mesa: emp.mesa,
      tipoCalc: emp.tipoCalc,
      bonoBase: round2_(base),
      faltas: att.faltas,
      retardos: att.retardos,
      multiplicador: finalMult,
      multiplicadorAuto: multiplier,
      subBono: round2_(finalSub),
      bonoRedondeado: finalRedondeo,
      ajuste: ajuste,
      bonoFinal: bonoFinal,
      notas: notas,
      saved: !!saved.ID
    };
  });

  return {
    ok: true,
    period: { start: start, end: end },
    ventasPorMesa: ventasPorMesa,
    pagosRecibidos: pagosRecibidos,
    bonosPorMesa: bonosPorMesa,
    capturaPendiente: !vmRow,
    rows: rows,
    totalFinal: rows.reduce((s, r) => s + r.bonoFinal, 0)
  };
}

function computeBonoBaseForEmployee_(emp, bonosPorMesa) {
  if (!bonosPorMesa) return 0;
  switch (emp.tipoCalc) {
    case 'LiderTienda':
      return bonosPorMesa.LiderTienda || 0;
    case 'AuxTienda':
      return bonosPorMesa.AuxTienda || 0;  // per person rate
    case 'Mesa':
      return mesaToBonoKey_(emp.mesa, bonosPorMesa);
    default:
      return 0;
  }
}

function mesaToBonoKey_(mesa, bonosPorMesa) {
  const m = String(mesa).toLowerCase().replace(/\s+/g, '');
  if (m.indexOf('cocina1') >= 0) return bonosPorMesa.Cocina1 || 0;
  if (m.indexOf('cocina2') >= 0) return bonosPorMesa.Cocina2 || 0;
  if (m.indexOf('cocina3') >= 0) return bonosPorMesa.Cocina3 || 0;
  if (m.indexOf('casa1') >= 0) return bonosPorMesa.Casa1 || 0;
  if (m.indexOf('casa2') >= 0) return bonosPorMesa.Casa2 || 0;
  if (m.indexOf('express') >= 0) return bonosPorMesa.Express || 0;
  if (m.indexOf('producción1') >= 0 || m.indexOf('produccion1') >= 0) return bonosPorMesa.Produccion1 || 0;
  if (m.indexOf('producción2') >= 0 || m.indexOf('produccion2') >= 0) return bonosPorMesa.Produccion2 || 0;
  if (m.indexOf('producción3') >= 0 || m.indexOf('produccion3') >= 0) return bonosPorMesa.Produccion3 || 0;
  return 0;
}

function findVentasMesaRow_(start, end) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(VENTAS_MESA_TAB);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iIni = headers.indexOf('FechaInicio');
  const iFin = headers.indexOf('FechaFin');
  if (iIni < 0 || iFin < 0) return null;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const ini = formatDateStr(row[iIni]);
    const fin = formatDateStr(row[iFin]);
    if (ini === start && fin === end) {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    }
  }
  return null;
}

function loadSavedBonoRows_(start, end) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BONO_PRODUCTIVIDAD_TAB);
  if (!sheet) return {};
  if (sheet.getLastRow() < 2) return {};
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iIni = headers.indexOf('QuincenaInicio');
  const iFin = headers.indexOf('QuincenaFin');
  const iNum = headers.indexOf('NumeroColab');
  if (iIni < 0 || iFin < 0 || iNum < 0) return {};

  const map = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (formatDateStr(row[iIni]) !== start || formatDateStr(row[iFin]) !== end) continue;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    map[String(row[iNum])] = obj;
  }
  return map;
}

function round2_(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }


// ─── Save (upsert by quincena × numero colaborador) ────────────────────────

/**
 * Persists per-employee rows for a quincena. Upsert by (QuincenaInicio, QuincenaFin, NumeroColab).
 *
 * Body shape: { period: {start, end}, rows: [{numero, nombre, mesa, tipoCalc, bonoBase, faltas, retardos, multiplicador, subBono, bonoRedondeado, ajuste, bonoFinal, notas}, ...] }
 */
function saveBonoProductividad(body) {
  const period = body.period || {};
  const start = period.start || body.start;
  const end = period.end || body.end;
  const rows = body.rows || [];
  if (!start || !end) throw new Error('period.start y period.end son requeridos');
  if (!rows.length) throw new Error('rows[] no puede ir vacío');

  const sheet = getOrCreateTab(BONO_PRODUCTIVIDAD_TAB, BONO_PRODUCTIVIDAD_HEADERS);
  const now = new Date();
  const nowStr = formatDateStr(now);

  // Build index of existing rows for this period
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iIni = headers.indexOf('QuincenaInicio');
  const iFin = headers.indexOf('QuincenaFin');
  const iNum = headers.indexOf('NumeroColab');
  const iUpd = headers.indexOf('Updated_At');

  const existingRowByNum = {};
  for (let r = 1; r < data.length; r++) {
    if (formatDateStr(data[r][iIni]) === start && formatDateStr(data[r][iFin]) === end) {
      existingRowByNum[String(data[r][iNum])] = r + 1;  // 1-indexed sheet row
    }
  }

  let inserted = 0, updated = 0;
  rows.forEach(r => {
    const rowArr = BONO_PRODUCTIVIDAD_HEADERS.map(h => {
      switch (h) {
        case 'ID': return r.id || ('BP' + Date.now() + Math.floor(Math.random() * 1000));
        case 'QuincenaInicio': return start;
        case 'QuincenaFin': return end;
        case 'NumeroColab': return r.numero || '';
        case 'Colaborador': return r.nombre || '';
        case 'Mesa': return r.mesa || '';
        case 'TipoCalc': return r.tipoCalc || '';
        case 'BonoBase': return parseFloat(r.bonoBase) || 0;
        case 'Faltas': return parseInt(r.faltas) || 0;
        case 'Retardos': return parseInt(r.retardos) || 0;
        case 'Multiplicador': return parseFloat(r.multiplicador) || 0;
        case 'SubBono': return parseFloat(r.subBono) || 0;
        case 'BonoRedondeado': return parseFloat(r.bonoRedondeado) || 0;
        case 'Ajuste': return parseFloat(r.ajuste) || 0;
        case 'BonoFinal': return parseFloat(r.bonoFinal) || 0;
        case 'Notas': return r.notas || '';
        case 'FechaGuardado': return nowStr;
        case 'Updated_At': return now;
        default: return '';
      }
    });

    const existing = existingRowByNum[String(r.numero)];
    if (existing) {
      sheet.getRange(existing, 1, 1, rowArr.length).setValues([rowArr]);
      updated++;
    } else {
      sheet.appendRow(rowArr);
      inserted++;
    }
  });

  return { ok: true, inserted: inserted, updated: updated, period: { start, end } };
}


// ─── History lookup ────────────────────────────────────────────────────────

/**
 * Returns bono history filtered.
 * Filter modes:
 *   { tipo: 'colaborador', value: 'Iris' }
 *   { tipo: 'periodo', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 *   {} → all (capped to most recent 200 rows)
 */
function getBonoHistory(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BONO_PRODUCTIVIDAD_TAB);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, rows: [] };

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = data[r][i]; });
    obj.QuincenaInicio = formatDateStr(obj.QuincenaInicio);
    obj.QuincenaFin = formatDateStr(obj.QuincenaFin);
    out.push(obj);
  }

  const tipo = params.tipo || '';
  let filtered = out;
  if (tipo === 'colaborador' && params.value) {
    const needle = String(params.value).toLowerCase();
    filtered = out.filter(o => String(o.Colaborador || '').toLowerCase().indexOf(needle) >= 0);
  } else if (tipo === 'periodo' && params.start && params.end) {
    filtered = out.filter(o => o.QuincenaInicio === params.start && o.QuincenaFin === params.end);
  }
  // Sort by QuincenaInicio desc
  filtered.sort((a, b) => String(b.QuincenaInicio).localeCompare(String(a.QuincenaInicio)));
  return { ok: true, rows: filtered.slice(0, 200) };
}


// ─── One-time cleanup: dedupe VENTAS_MESA ──────────────────────────────────

/**
 * Removes duplicate rows in VENTAS_MESA (same FechaInicio + FechaFin).
 * Keeps the LAST occurrence (most recent Updated_At).
 * Run once from the Apps Script editor: cleanupVentasMesaDuplicates()
 */
function cleanupVentasMesaDuplicates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(VENTAS_MESA_TAB);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, removed: 0 };

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const iIni = headers.indexOf('FechaInicio');
  const iFin = headers.indexOf('FechaFin');
  const iUpd = headers.indexOf('Updated_At');

  // Walk from bottom up so deletes don't shift indices
  const seen = {};
  const toDelete = [];
  for (let r = data.length - 1; r >= 1; r--) {
    const key = formatDateStr(data[r][iIni]) + '|' + formatDateStr(data[r][iFin]);
    if (seen[key]) {
      toDelete.push(r + 1);  // 1-indexed
    } else {
      seen[key] = true;
    }
  }
  toDelete.forEach(rowNum => sheet.deleteRow(rowNum));
  return { ok: true, removed: toDelete.length, kept: Object.keys(seen).length };
}
