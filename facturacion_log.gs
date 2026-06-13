/**
 * facturacion_log.gs — Append-only log of generated facturas (Task B2).
 *
 * Records every factura generated (global or per-cliente) into a dedicated tab
 * "FACTURACION_LOG", and reads it back per month with per-day + monthly totals.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HUMAN DEPLOY STEPS (do this once, by hand):
 *
 *   1. Open the Apps Script project bound to the NB Finance spreadsheet
 *      (Extensions ▸ Apps Script, or script.google.com).
 *   2. Create a new script file named  facturacion_log.gs  and paste THIS file
 *      (or upload it). All helpers it calls — getOrCreateTab, sheetToObjects,
 *      jsonResp, log, formatDateStr — are global across .gs files, so nothing
 *      else needs importing.
 *   3. Open codigo.gs and add ONE line to each switch:
 *
 *      In doGet(e)'s  switch(action)  — just BEFORE the `default:` (~line 120):
 *
 *          case 'get_facturacion_log':    return jsonResp(getFacturacionLog(e.parameter));
 *
 *      In doPost(e)'s  switch(action)  — just BEFORE the `default:` (~line 190):
 *
 *          case 'log_factura':            return jsonResp(logFactura(body));
 *          case 'append_facturacion_log': return jsonResp(appendFacturacionLog(body));
 *
 *      ('log_factura' = single factura from the browser beacon;
 *       'append_facturacion_log' = batch; 'get_facturacion_log' = read.)
 *   4. Deploy ▸ Manage deployments ▸ edit the existing Web App deployment ▸
 *      New version ▸ Deploy. (Keep the SAME deployment so the /exec URL is
 *      unchanged.) Execute as "Me", access "Anyone".
 *   5. The "FACTURACION_LOG" tab is created automatically on first call.
 *
 * No other edits to codigo.gs are required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const FACTURACION_LOG_TAB = 'FACTURACION_LOG';
const FACTURACION_LOG_HEADERS = [
  'ID', 'Fecha', 'Tipo', 'Folio', 'UUID',
  'Cliente', 'Monto', 'Mes', 'Origen', 'Created_At'
];

/**
 * Append a SINGLE factura. body = {fecha, tipo, folio, monto, mes, uuid, cliente, origen}
 * Used by the browser fire-and-forget beacon (POST action=log_factura).
 */
function logFactura(body) {
  return appendFacturacionLog({ facturas: [body], origen: body.origen });
}

/**
 * Append one or more facturas.
 * body.facturas = [{fecha, tipo:'global'|'cliente', folio, monto, mes, uuid, cliente}, ...]
 * body.origen   = optional default origen string for all rows.
 */
function appendFacturacionLog(body) {
  const sheet = getOrCreateTab(FACTURACION_LOG_TAB, FACTURACION_LOG_HEADERS);
  const list = (body && body.facturas) || [];
  const now = new Date();
  const rows = list.map(function (f) {
    const fecha = formatDateStr(f.fecha);
    const mes = f.mes || (fecha ? fecha.slice(0, 7) : '');
    const monto = Number(f.monto) || 0;
    const id = 'FL-' + now.getTime() + '-' + Math.floor(Math.random() * 1e6);
    return [
      id,
      fecha,
      f.tipo || 'global',
      f.folio || '',
      f.uuid || '',
      f.cliente || '',
      monto,
      mes,
      f.origen || body.origen || 'factura-selector',
      now
    ];
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, FACTURACION_LOG_HEADERS.length)
      .setValues(rows);
  }
  log('FACTURACION_LOG_APPEND', rows.length + ' facturas');
  return { ok: true, appended: rows.length };
}

/**
 * Read the log for a month. params = {month:'YYYY-MM'} (optional; default = all).
 * Returns { ok, facturas, byDay:{date:total}, total, count }.
 */
function getFacturacionLog(params) {
  let rows = sheetToObjects(FACTURACION_LOG_TAB, FACTURACION_LOG_HEADERS);
  const month = params && params.month;
  if (month) {
    rows = rows.filter(function (r) {
      const fecha = formatDateStr(r.Fecha);
      return fecha.indexOf(month) === 0 || String(r.Mes).indexOf(month) === 0;
    });
  }

  const byDay = {};
  let total = 0;
  const facturas = rows.map(function (r) {
    const fecha = formatDateStr(r.Fecha);
    const monto = Number(r.Monto) || 0;
    byDay[fecha] = (byDay[fecha] || 0) + monto;
    total += monto;
    return {
      id: r.ID, fecha: fecha, tipo: r.Tipo, folio: r.Folio, uuid: r.UUID,
      cliente: r.Cliente, monto: monto, mes: r.Mes, origen: r.Origen
    };
  });

  return { ok: true, facturas: facturas, byDay: byDay, total: total, count: facturas.length };
}
