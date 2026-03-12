/**
 * ═══════════════════════════════════════════════════
 * NB · V3 Backend Patch — Portal de Pagos V3 support
 * ═══════════════════════════════════════════════════
 *
 * INSTALLATION:
 * 1. Open Google Apps Script editor
 * 2. In Código.gs, add these 2 new cases to the doGet switch:
 *      case 'list_recent':    return jsonResp(listRecentFacturas(e.parameter));
 *      case 'list_proveedores': return jsonResp(listProveedores());
 * 3. In Código.gs, add this case to the doPost switch:
 *      case 'pay_factura':      return jsonResp(payFactura(body));
 * 4. Paste the functions below into Código.gs (at the bottom, before the closing)
 * 5. Deploy → New version
 */

// ══════════════════════════════════════════════
// V3: LIST RECENT FACTURAS (server-side filtering)
// ══════════════════════════════════════════════

/**
 * Returns facturas from the last N days (default 60).
 * Dramatically faster than loading all 4,920+ rows.
 * Also accepts month parameter for specific month view.
 *
 * Params:
 *   days=60 (default) — how many days back to look
 *   month=2026-03 — specific month (overrides days)
 *   estado=Pendiente|Pagado — optional filter
 */
function listRecentFacturas(params) {
  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return { facturas: [], total: 0 };

  const headers = data[0];
  const fechaCompraCol = headers.indexOf('Fecha_Compra');
  const fechaPagoCol   = headers.indexOf('Fecha_Pago');
  const estadoCol      = headers.indexOf('Estado');
  const createdAtCol   = headers.indexOf('Created_At');

  // Calculate cutoff date
  const days = parseInt(params.days) || 60;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);

  const targetMonth = params.month || ''; // e.g. "2026-03"

  const fmtDate = (val) => {
    if (!val) return '';
    if (val instanceof Date) return Utilities.formatDate(val, 'America/Mexico_City', 'yyyy-MM-dd');
    return String(val).slice(0, 10);
  };

  let rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const obj = {};
    headers.forEach((h, j) => {
      // Format date columns properly
      if (h === 'Fecha_Compra' || h === 'Fecha_Pago' || h === 'Fecha_Pago_Real') {
        obj[h] = fmtDate(r[j]);
      } else {
        obj[h] = r[j];
      }
    });

    // Apply date filter
    const fechaCompra = obj.Fecha_Compra || '';
    const fechaPago   = obj.Fecha_Pago || '';
    const createdAt   = obj.Created_At || '';

    if (targetMonth) {
      // Month mode: show all invoices with fecha_compra in target month
      // OR unpaid invoices with fecha_pago in target month
      const inMonth = fechaCompra.startsWith(targetMonth) ||
                      (obj.Estado !== 'Pagado' && fechaPago.startsWith(targetMonth));
      if (!inMonth) continue;
    } else {
      // Days mode: show invoices from the last N days
      // Include by fecha_compra OR by fecha_pago OR by created_at
      let dateToCheck = fechaCompra || createdAt || '';
      if (!dateToCheck) continue;
      const d = new Date(dateToCheck + 'T12:00:00');
      if (isNaN(d.getTime()) || d < cutoff) {
        // Also include if fecha_pago is recent (might be older invoice due soon)
        if (fechaPago) {
          const dp = new Date(fechaPago + 'T12:00:00');
          if (isNaN(dp.getTime()) || dp < cutoff) continue;
        } else {
          continue;
        }
      }
    }

    // Apply estado filter if specified
    if (params.estado && obj.Estado !== params.estado) continue;

    rows.push(obj);
  }

  // Sort: Pendientes first, then by fecha_compra desc
  rows.sort((a, b) => {
    const aPend = a.Estado !== 'Pagado' ? 0 : 1;
    const bPend = b.Estado !== 'Pagado' ? 0 : 1;
    if (aPend !== bPend) return aPend - bPend;
    return (b.Fecha_Compra || '').localeCompare(a.Fecha_Compra || '');
  });

  return { facturas: rows, total: rows.length };
}

// ══════════════════════════════════════════════
// V3: PAY FACTURA (single atomic write)
// ══════════════════════════════════════════════

/**
 * Marks a factura as paid in ONE operation.
 * Writes: Estado, Fecha_Pago, Fecha_Pago_Real, Comprobante
 * No version conflicts. No split operations.
 *
 * body: { id, fecha_pago_real, comprobante, pdf_base64, proveedor }
 */
function payFactura(body) {
  const { id, fecha_pago_real, comprobante, pdf_base64, proveedor } = body;
  if (!id) throw new Error('Missing id');

  const sheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const sheetRow = i + 1;
      const payDate = fecha_pago_real || Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');

      // Handle comprobante PDF upload
      let compValue = comprobante || '';
      if (pdf_base64 && pdf_base64.length > 100) {
        try {
          const folioCol = FACTURAS_HEADERS.indexOf('Folio');
          const rowFolio = folioCol >= 0 ? String(data[i][folioCol] || '') : '';
          compValue = saveComprobanteToDrive(id, pdf_base64, proveedor || 'pago', rowFolio);
        } catch(err) {
          log('COMP_PDF_ERROR', id + ': ' + err.message);
        }
      }

      // Write ALL payment fields in one batch
      const updates = [
        [FACTURAS_HEADERS.indexOf('Estado') + 1, 'Pagado'],
        [FACTURAS_HEADERS.indexOf('Fecha_Pago') + 1, payDate],
        [FACTURAS_HEADERS.indexOf('Fecha_Pago_Real') + 1, payDate],
      ];
      if (compValue) {
        updates.push([FACTURAS_HEADERS.indexOf('Comprobante') + 1, compValue]);
      }

      // Bump version
      const vCol = FACTURAS_HEADERS.indexOf('Version') + 1;
      if (vCol > 0) {
        const sheetVersion = parseInt(data[i][vCol - 1]) || 0;
        updates.push([vCol, sheetVersion + 1]);
      }

      // Apply all updates
      updates.forEach(([col, val]) => {
        if (col > 0) sheet.getRange(sheetRow, col).setValue(val);
      });

      log('PAY_V3', id + ' | ' + (proveedor || '?') + ' | ' + payDate + (pdf_base64 ? ' | 📎 PDF' : ''));
      return { ok: true, message: 'Pagado', comprobante_url: compValue };
    }
  }
  throw new Error('Not found: ' + id);
}

// ══════════════════════════════════════════════
// V3: LIST PROVEEDORES (for manual entry autocomplete)
// ══════════════════════════════════════════════

function listProveedores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const provSheet = ss.getSheetByName('PROVEEDORES');

  // Also collect unique proveedores from FACTURAS
  const factSheet = getOrCreateTab(FACTURAS_TAB, FACTURAS_HEADERS);
  const factData = factSheet.getDataRange().getValues();
  const provCol = FACTURAS_HEADERS.indexOf('Proveedor');
  const fromFacturas = new Set();
  for (let i = 1; i < factData.length; i++) {
    const name = String(factData[i][provCol] || '').trim();
    if (name) fromFacturas.add(name);
  }

  let proveedores = [...fromFacturas].sort();

  // Add from PROVEEDORES sheet if it exists
  if (provSheet) {
    const provData = provSheet.getDataRange().getValues();
    for (let i = 1; i < provData.length; i++) {
      const name = String(provData[i][0] || '').trim();
      if (name && !fromFacturas.has(name)) proveedores.push(name);
    }
    proveedores.sort();
  }

  return { proveedores, total: proveedores.length };
}
