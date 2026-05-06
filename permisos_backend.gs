/**
 * ═══════════════════════════════════════════════════════════════
 * NB · Permisos Backend — Sheet-based permiso request workflow
 * ═══════════════════════════════════════════════════════════════
 *
 * Replaces the Notion "Reporte de Permisos" workflow with a
 * Sheet + nb-app form so we don't have to give employees Notion DB
 * access (which would expose CURP/RFC/contracts).
 *
 * Phase 1 cutover policy (Louie's call · 2026-05-06):
 *   - NEW permisos are submitted to PERMISOS sheet via permisos.html
 *   - April + May Aprobado permisos are migrated from Notion → sheet
 *     via migrateAprilMayPermisosFromNotion() (run once)
 *   - Pre-April permisos stay in Notion as historical backup; engine
 *     no longer reads from Notion at all (sheet is the only source)
 *
 * Setup (one-time):
 *   1. Run setupPermisosSheet() once from the Apps Script editor
 *      → creates the PERMISOS tab in NB_Margenes_Dashboard with headers
 *   2. Wire the new doGet/doPost cases into gastos_script_DEPLOY_THIS.gs
 *      (already done in the patch alongside this file)
 *   3. Deploy a new version of the Web App
 *
 * Author: Claude + Louie · 2026-05-06
 */

// ─── Constants ────────────────────────────────────────────────────────────
const PERMISOS_TAB = 'PERMISOS';
const PERMISOS_HEADERS = [
  'ID',                  // PRM{timestamp}
  'Fecha_Solicitud',     // ISO datetime when form submitted
  'NumeroColab',         // number → maps to Colaboradores Activos
  'Nombre',              // string snapshot at submit
  'Email_Empleado',      // optional, for confirmations
  'Fecha_Permiso',       // YYYY-MM-DD day of absence
  'Horario_Ausente',     // e.g. "08:00 - 12:00" (built from time pickers)
  'Horas_Ausente',       // computed from time pickers, max 8
  'Asunto',              // Personal | Médico | Legal | Educativo (single)
  'Descripcion',         // brief description from form (now required)
  'Reponer',             // "Sí" | "No" | ""
  'Como_Reponer',        // comma-joined methods
  'Fecha_Final_Pagado',  // YYYY-MM-DD (auto-calc on form, editable by admin)
  'Comprobante_URL',     // Drive shareable URL — uploaded by admin AFTER decision
  'Respuesta',           // Pendiente | Aprobado | Rechazado | Cancelado
  'Aprobado_Por',        // admin email
  'Fecha_Decision',      // YYYY-MM-DD when status flipped
  'Notas_Admin',         // optional rejection/cancellation reason
  // ── Engine writeback (populated by recomputeSemanal) ──
  'Real_Ausente_Min',    // actual minutes ausente per checador
  'Repose_Status',       // pending | completo | shortfall | over_cap_no_repose | not_required
  'Repose_Detail',       // text breakdown e.g. "28 abr: pagó 30m de 30m ✓\n29 abr: ..."
  'Computed_At'          // timestamp of last engine writeback
];

const PERMISOS_FOLDER_NAME = 'NB_Comprobantes_Permisos';
const PERMISOS_CACHE_KEY_SHEET = 'asistencia_permisos_sheet_v1';
const PERMISOS_CACHE_TTL_SHEET = 300;  // 5 min — matches Notion cache

// ─── Sheet setup ──────────────────────────────────────────────────────────

/**
 * Idempotent. Creates PERMISOS tab if missing, ensures headers match.
 * Safe to run repeatedly — adds new columns without touching existing rows.
 * Run from Apps Script editor whenever the schema changes.
 */
function setupPermisosSheet() {
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);

  // Detect existing columns and add any missing ones (idempotent migration)
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (existing.length < PERMISOS_HEADERS.length || existing.some((h, i) => h !== PERMISOS_HEADERS[i])) {
    // Always overwrite the header row to match the canonical schema
    const range = sheet.getRange(1, 1, 1, PERMISOS_HEADERS.length);
    range.setValues([PERMISOS_HEADERS]);
    range.setFontWeight('bold');
    range.setBackground('#1a3a1a');
    range.setFontColor('white');
  }
  sheet.setFrozenRows(1);

  // Set reasonable column widths
  const widths = [140, 130, 60, 180, 200, 100, 130, 70, 90, 250, 60, 220, 110, 220, 100, 220, 110, 220, 110, 130, 320, 130];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  Logger.log('PERMISOS sheet ready · ' + PERMISOS_HEADERS.length + ' columns');
  return { ok: true, columns: PERMISOS_HEADERS.length, headers: PERMISOS_HEADERS };
}

// ─── Public: form submission ──────────────────────────────────────────────

/**
 * Public POST handler — no auth required.
 * Body: { permiso: { numeroColab, nombre, email?, fechaPermiso,
 *   horarioAusente, horasAusente, asunto, descripcion, reponer,
 *   comoReponer, fechaFinalPagado } }
 *
 * Note: comprobante is no longer collected at submission — admin uploads
 * it after the fact via uploadComprobanteToPermiso().
 */
function submitPermiso(body) {
  const p = body.permiso || {};
  if (!p.numeroColab || !p.nombre || !p.fechaPermiso) {
    return { error: 'Faltan campos requeridos: numeroColab, nombre, fechaPermiso' };
  }
  if (!p.descripcion || !String(p.descripcion).trim()) {
    return { error: 'La descripción es requerida.' };
  }

  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const id = 'PRM' + Date.now();
  const ahora = formatDateStr(new Date());

  const comoReponerStr = Array.isArray(p.comoReponer)
    ? p.comoReponer.join(', ')
    : String(p.comoReponer || '');

  // Build row in canonical PERMISOS_HEADERS order
  const row = buildPermisoRow_({
    ID: id,
    Fecha_Solicitud: ahora,
    NumeroColab: parseInt(p.numeroColab) || '',
    Nombre: String(p.nombre || '').trim(),
    Email_Empleado: String(p.email || '').trim().toLowerCase(),
    Fecha_Permiso: String(p.fechaPermiso || ''),
    Horario_Ausente: String(p.horarioAusente || ''),
    Horas_Ausente: parseFloat(p.horasAusente) || 0,
    Asunto: String(p.asunto || ''),
    Descripcion: String(p.descripcion || ''),
    Reponer: String(p.reponer || ''),
    Como_Reponer: comoReponerStr,
    Fecha_Final_Pagado: String(p.fechaFinalPagado || ''),
    Comprobante_URL: '',
    Respuesta: 'Pendiente',
    Aprobado_Por: '',
    Fecha_Decision: '',
    Notas_Admin: '',
    Real_Ausente_Min: '',
    Repose_Status: '',
    Repose_Detail: '',
    Computed_At: ''
  });
  sheet.appendRow(row);

  try { CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET); } catch (e) {}

  // Best-effort: send confirmation email to employee if provided
  if (p.email) {
    try {
      sendPermisoEmail_(p.email, 'submitted', {
        id: id, nombre: p.nombre, fechaPermiso: p.fechaPermiso,
        horario: p.horarioAusente, asunto: p.asunto, descripcion: p.descripcion
      });
    } catch (err) {
      Logger.log('PERMISO_EMAIL_ERROR (submit): ' + err.message);
    }
  }

  log('PERMISO_SUBMIT', id + ' · ' + p.nombre + ' · ' + p.fechaPermiso);
  return { ok: true, id: id };
}

/**
 * Helper — builds a PERMISOS row array in canonical header order from a
 * { ColumnName: value } object. Missing keys → ''.
 * Use this everywhere we write to the sheet so column order can change
 * without breaking inserts.
 */
function buildPermisoRow_(obj) {
  return PERMISOS_HEADERS.map(h => obj[h] != null ? obj[h] : '');
}

// ─── Public: roster for the dropdown (no PII) ────────────────────────────

/**
 * Returns [{numero, nombre}] of active colaboradores. Pulls from Notion
 * Colaboradores Activos but ONLY exposes numero + nombre — nothing private.
 * Cached 10 min to keep the public endpoint cheap.
 */
function listColaboradoresForPermiso() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('permisos_roster_v1');
  if (cached) {
    try { return { ok: true, roster: JSON.parse(cached) }; } catch (e) {}
  }

  // Reuse the engine's helper which is already cached + filtered by Activo
  const rules = getEmpleadoRulesFromNotion_();
  const roster = Object.keys(rules).map(numStr => ({
    numero: parseInt(numStr),
    nombre: rules[numStr].nombre
  }))
  .filter(r => r.numero && r.nombre)
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  cache.put('permisos_roster_v1', JSON.stringify(roster), 600);
  return { ok: true, roster: roster };
}

// ─── Admin: list permisos ─────────────────────────────────────────────────

/**
 * Admin GET handler. Filter by ?estado=Pendiente|Aprobado|Rechazado (or omit for all).
 * Returns [{ id, fechaSolicitud, numeroColab, nombre, ... }] sorted by Fecha_Solicitud DESC.
 */
function listPermisos(params) {
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, permisos: [] };

  const headers = data[0];
  const idx = (h) => headers.indexOf(h);
  const estadoFilter = params && params.estado ? String(params.estado) : null;

  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const respuesta = String(row[idx('Respuesta')] || '');
    if (estadoFilter && respuesta !== estadoFilter) continue;
    out.push({
      id:                row[idx('ID')],
      fechaSolicitud:    formatDateStr(row[idx('Fecha_Solicitud')]),
      numeroColab:       parseInt(row[idx('NumeroColab')]) || null,
      nombre:            String(row[idx('Nombre')] || ''),
      email:             String(row[idx('Email_Empleado')] || ''),
      fechaPermiso:      formatDateStr(row[idx('Fecha_Permiso')]),
      horarioAusente:    String(row[idx('Horario_Ausente')] || ''),
      horasAusente:      parseFloat(row[idx('Horas_Ausente')]) || 0,
      asunto:            String(row[idx('Asunto')] || ''),
      descripcion:       String(row[idx('Descripcion')] || ''),
      reponer:           String(row[idx('Reponer')] || ''),
      comoReponer:       String(row[idx('Como_Reponer')] || ''),
      fechaFinalPagado:  formatDateStr(row[idx('Fecha_Final_Pagado')]),
      comprobanteUrl:    String(row[idx('Comprobante_URL')] || ''),
      respuesta:         respuesta,
      aprobadoPor:       String(row[idx('Aprobado_Por')] || ''),
      fechaDecision:     formatDateStr(row[idx('Fecha_Decision')]),
      notasAdmin:        String(row[idx('Notas_Admin')] || ''),
      realAusenteMin:    parseFloat(row[idx('Real_Ausente_Min')]) || null,
      reposeStatus:      String(row[idx('Repose_Status')] || ''),
      reposeDetail:      String(row[idx('Repose_Detail')] || ''),
      computedAt:        formatDateStr(row[idx('Computed_At')]),
      _row:              r + 1
    });
  }
  // Sort by fechaPermiso DESC (most recent / upcoming permiso at top)
  out.sort((a, b) => String(b.fechaPermiso || '').localeCompare(String(a.fechaPermiso || '')));
  return { ok: true, permisos: out };
}

// ─── Admin: approve/reject ────────────────────────────────────────────────

/**
 * Admin POST handler. Body: {
 *   id, estado: 'Aprobado'|'Rechazado',
 *   email,   ← admin email (validated against canApprovePermisos_)
 *   fechaFinalPagado?, notasAdmin?
 * }
 */
function updatePermisoStatus(body) {
  if (!body.id || !body.estado || !body.email) {
    return { error: 'Faltan campos: id, estado, email' };
  }
  if (!canApprovePermisos_(body.email)) {
    return { error: 'Sin permisos para aprobar/rechazar (' + body.email + ')' };
  }
  if (body.estado !== 'Aprobado' && body.estado !== 'Rechazado') {
    return { error: 'Estado inválido. Use Aprobado o Rechazado.' };
  }

  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  const respCol = headers.indexOf('Respuesta');
  const aprCol = headers.indexOf('Aprobado_Por');
  const decCol = headers.indexOf('Fecha_Decision');
  const finCol = headers.indexOf('Fecha_Final_Pagado');
  const notCol = headers.indexOf('Notas_Admin');

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(body.id)) {
      const rowNum = r + 1;
      sheet.getRange(rowNum, respCol + 1).setValue(body.estado);
      sheet.getRange(rowNum, aprCol + 1).setValue(body.email);
      sheet.getRange(rowNum, decCol + 1).setValue(formatDateStr(new Date()));
      if (body.fechaFinalPagado != null) {
        sheet.getRange(rowNum, finCol + 1).setValue(String(body.fechaFinalPagado));
      }
      if (body.notasAdmin != null) {
        sheet.getRange(rowNum, notCol + 1).setValue(String(body.notasAdmin));
      }
      CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);

      // Best-effort decision email to employee
      const empEmail = String(data[r][headers.indexOf('Email_Empleado')] || '');
      if (empEmail) {
        try {
          sendPermisoEmail_(empEmail, body.estado === 'Aprobado' ? 'approved' : 'rejected', {
            id: body.id,
            nombre: String(data[r][headers.indexOf('Nombre')] || ''),
            fechaPermiso: formatDateStr(data[r][headers.indexOf('Fecha_Permiso')]),
            horario: String(data[r][headers.indexOf('Horario_Ausente')] || ''),
            asunto: String(data[r][headers.indexOf('Asunto')] || ''),
            notas: body.notasAdmin || ''
          });
        } catch (err) {
          Logger.log('PERMISO_EMAIL_ERROR (decision): ' + err.message);
        }
      }

      log('PERMISO_DECISION', body.id + ' · ' + body.estado + ' · ' + body.email);
      return { ok: true, id: body.id, estado: body.estado };
    }
  }
  return { error: 'Permiso no encontrado: ' + body.id };
}

// ─── Admin: cancel an approved permiso ───────────────────────────────────

/**
 * Body: { id, email, notasAdmin? }
 * Sets Respuesta=Cancelado. Engine treats Cancelado like not-approved.
 */
function cancelPermiso(body) {
  if (!body.id || !body.email) return { error: 'Faltan campos: id, email' };
  if (!canApprovePermisos_(body.email)) {
    return { error: 'Sin permisos para cancelar (' + body.email + ')' };
  }
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(body.id)) {
      const rowNum = r + 1;
      sheet.getRange(rowNum, headers.indexOf('Respuesta') + 1).setValue('Cancelado');
      sheet.getRange(rowNum, headers.indexOf('Aprobado_Por') + 1).setValue(body.email);
      sheet.getRange(rowNum, headers.indexOf('Fecha_Decision') + 1).setValue(formatDateStr(new Date()));
      if (body.notasAdmin) {
        sheet.getRange(rowNum, headers.indexOf('Notas_Admin') + 1).setValue(String(body.notasAdmin));
      }
      CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
      log('PERMISO_CANCEL', body.id + ' · ' + body.email);
      return { ok: true, id: body.id, estado: 'Cancelado' };
    }
  }
  return { error: 'Permiso no encontrado: ' + body.id };
}

// ─── Admin: delete a permiso row entirely ────────────────────────────────

/**
 * Body: { id, email }
 * Removes the row. Use for bad data (e.g. wrong year). Audit trail is lost.
 */
function deletePermiso(body) {
  if (!body.id || !body.email) return { error: 'Faltan campos: id, email' };
  if (!canApprovePermisos_(body.email)) {
    return { error: 'Sin permisos para borrar (' + body.email + ')' };
  }
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(body.id)) {
      sheet.deleteRow(r + 1);
      CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
      log('PERMISO_DELETE', body.id + ' · ' + body.email);
      return { ok: true, id: body.id };
    }
  }
  return { error: 'Permiso no encontrado: ' + body.id };
}

// ─── Admin: upload comprobante AFTER decision ────────────────────────────

/**
 * Body: { id, email, base64, filename }
 * Uploads file to Drive, sets Comprobante_URL on the permiso row.
 * Engine then auto-justifies any falta covered by an Aprobado permiso
 * with a comprobante (asunto Médico/Legal/Educativo).
 */
function uploadComprobanteToPermiso(body) {
  if (!body.id || !body.email || !body.base64) {
    return { error: 'Faltan campos: id, email, base64' };
  }
  if (!canApprovePermisos_(body.email)) {
    return { error: 'Sin permisos para subir comprobante (' + body.email + ')' };
  }
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(body.id)) {
      const rowNum = r + 1;
      const nombre = String(data[r][headers.indexOf('Nombre')] || '');
      const url = saveComprobantePermisoToDrive_(
        body.id, body.base64, body.filename || 'comprobante.pdf', nombre
      );
      sheet.getRange(rowNum, headers.indexOf('Comprobante_URL') + 1).setValue(url);
      CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
      log('PERMISO_COMPROBANTE', body.id + ' · ' + body.email);
      return { ok: true, id: body.id, url: url };
    }
  }
  return { error: 'Permiso no encontrado: ' + body.id };
}

// ─── Email helper ────────────────────────────────────────────────────────

/**
 * Sends a status email to the employee.
 * type: 'submitted' | 'approved' | 'rejected'
 * data: { id, nombre, fechaPermiso, horario, asunto, descripcion?, notas? }
 */
function sendPermisoEmail_(toEmail, type, data) {
  if (!toEmail) return;
  const subjects = {
    submitted: 'Permiso recibido — pendiente de revisión',
    approved:  '✓ Tu permiso fue aprobado',
    rejected:  '✗ Tu permiso fue rechazado'
  };
  const subject = subjects[type] || 'Actualización de tu permiso';

  const fmtDate = (s) => {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : s;
  };

  const colorBar = type === 'approved' ? '#2e7d32'
                : type === 'rejected'  ? '#c62828'
                : '#1565c0';

  let intro = '';
  if (type === 'submitted') intro = 'Recibimos tu solicitud de permiso. Pronto recibirás respuesta de Louie.';
  if (type === 'approved')  intro = '¡Tu permiso fue aprobado! Aquí están los detalles confirmados.';
  if (type === 'rejected')  intro = 'Tu permiso fue rechazado.' + (data.notas ? ' Razón: ' + data.notas : '');

  // Logo hosted on GitHub Pages alongside the apps
  const logoUrl = 'https://louieelizondo.github.io/nb-app/avocado-logo.png';

  // Comprobante urgency block — only for approved permisos with justifiable asunto
  const justifiable = /m[eé]dico|legal|educativo/i.test(String(data.asunto || ''));
  const showComprobanteBlock = type === 'approved' && justifiable;

  const comprobanteBlock = showComprobanteBlock ? `
    <div style="margin-top:20px;padding:16px 18px;background:#fff8e1;border-left:4px solid #f57f17;border-radius:8px;font-size:13px;line-height:1.5">
      <strong style="color:#bf360c;display:block;margin-bottom:6px">📎 Comprobante requerido — fecha límite miércoles EOD</strong>
      Es <strong>tu responsabilidad</strong> entregarle el comprobante (médico, legal o educativo) a Louie a más tardar el <strong>miércoles antes del cierre</strong>, para que pueda procesarse en la nómina del jueves por la mañana.
      <br><br>
      <span style="color:#bf360c"><strong>Sin comprobante = no se justifica la falta y no aplica el reposo del tiempo pagado.</strong></span>
    </div>
  ` : '';

  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#2d2319">
      <div style="background:linear-gradient(135deg,#1a3a1a 0%,#2e6b2e 100%);color:white;padding:28px 24px 24px;border-radius:14px 14px 0 0;text-align:center">
        <img src="${logoUrl}" alt="Natural Balance" style="width:72px;height:72px;display:block;margin:0 auto 10px;background:rgba(255,255,255,.95);padding:6px;border-radius:14px">
        <h2 style="margin:0;font-size:18px;font-weight:700">${subject}</h2>
      </div>
      <div style="background:white;padding:26px;border-left:4px solid ${colorBar};border-radius:0 0 14px 14px;box-shadow:0 4px 16px rgba(0,0,0,.05)">
        <p style="margin:0 0 16px;font-size:15px">Hola <strong>${data.nombre || ''}</strong>,</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.55">${intro}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px">
          <tr><td style="padding:7px 0;color:#998777;width:120px">Fecha permiso</td><td><strong>${fmtDate(data.fechaPermiso)}</strong></td></tr>
          <tr><td style="padding:7px 0;color:#998777">Horario</td><td>${data.horario || '—'}</td></tr>
          <tr><td style="padding:7px 0;color:#998777">Asunto</td><td>${data.asunto || '—'}</td></tr>
          ${data.descripcion ? `<tr><td style="padding:7px 0;color:#998777;vertical-align:top">Descripción</td><td>${data.descripcion}</td></tr>` : ''}
        </table>
        ${comprobanteBlock}
        <p style="margin:24px 0 0;font-size:11px;color:#bbb;border-top:1px solid #f0ebe4;padding-top:14px">Natural Balance Club · Sistema de Permisos<br>Ref: ${data.id || ''}</p>
      </div>
    </div>
  `;
  GmailApp.sendEmail(toEmail, subject, '', { htmlBody: html, name: 'NB Permisos' });
}

// ─── RBAC hook (Phase 1 stub, future-proof) ──────────────────────────────

/**
 * Returns true if the email is allowed to approve/reject permisos.
 * Phase 1: hardcoded to Louie. When the per-user permission system lands
 * (Phase 3), replace this with a sheet lookup like:
 *   const perms = getUserPermissions_(email);
 *   return perms.includes('approve_permisos');
 */
function canApprovePermisos_(email) {
  const allowed = ['le.nbclub@gmail.com'];
  return allowed.indexOf(String(email || '').toLowerCase()) >= 0;
}

// ─── Drive helper ─────────────────────────────────────────────────────────

function getPermisoComprobanteFolder_() {
  const folders = DriveApp.getFoldersByName(PERMISOS_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(PERMISOS_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function saveComprobantePermisoToDrive_(permisoId, base64Data, filename, nombre) {
  const folder = getPermisoComprobanteFolder_();
  const cleanName = String(nombre || 'colab').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const today = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyyMMdd');
  // Detect mime from filename extension
  const ext = (filename || 'pdf').split('.').pop().toLowerCase();
  let mime = 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
  else if (ext === 'png') mime = 'image/png';
  else if (ext === 'pdf') mime = 'application/pdf';
  else mime = 'application/octet-stream';
  const safeExt = ext.match(/^[a-z0-9]+$/) ? ext : 'bin';
  const finalName = permisoId + '_' + cleanName + '_' + today + '.' + safeExt;
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mime, finalName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

// ─── Engine bridge: read approved permisos from sheet ────────────────────

/**
 * Returns Aprobado permisos from the PERMISOS sheet, shaped to match the
 * Notion-derived list that asistencia_engine.gs expects. Cached 5 min.
 *
 * Output shape (must match getApprovedPermisos_() in asistencia_engine.gs):
 *   {
 *     id,                 // 'PRM<ts>'
 *     fechaPermiso,       // YYYY-MM-DD
 *     nombreCompleto,     // string
 *     colaboradorIds,     // [] — sheet stores numeroColab, not Notion page IDs
 *     numeroColab,        // ← sheet-only field, engine can match by this OR by name
 *     horasAusente,       // number
 *     horarioAusente,     // string
 *     asunto,             // [] (engine expects array; we wrap single-select)
 *     reponer,            // 'Si' | 'No' | null
 *     comoReponer,        // [] (engine expects array; split comma-joined)
 *     fechaFinalManual    // YYYY-MM-DD or null
 *   }
 */
function getApprovedPermisosFromSheet_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PERMISOS_CACHE_KEY_SHEET);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    cache.put(PERMISOS_CACHE_KEY_SHEET, '[]', PERMISOS_CACHE_TTL_SHEET);
    return [];
  }
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);

  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (String(row[idx('Respuesta')]) !== 'Aprobado') continue;
    const reponerRaw = String(row[idx('Reponer')] || '').trim();
    let reponerNorm = null;
    if (/^s[ií]$/i.test(reponerRaw)) reponerNorm = 'Si';
    else if (/^no$/i.test(reponerRaw)) reponerNorm = 'No';

    const comoReponerRaw = String(row[idx('Como_Reponer')] || '').trim();
    const comoReponer = comoReponerRaw
      ? comoReponerRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const asuntoRaw = String(row[idx('Asunto')] || '').trim();
    const asunto = asuntoRaw ? [asuntoRaw] : [];

    out.push({
      id:              String(row[idx('ID')]),
      fechaPermiso:    formatDateStr(row[idx('Fecha_Permiso')]),
      nombreCompleto:  String(row[idx('Nombre')] || '').trim(),
      colaboradorIds:  [],
      numeroColab:     parseInt(row[idx('NumeroColab')]) || null,
      horasAusente:    parseFloat(row[idx('Horas_Ausente')]) || 0,
      horarioAusente:  String(row[idx('Horario_Ausente')] || ''),
      asunto:          asunto,
      reponer:         reponerNorm,
      comoReponer:     comoReponer,
      fechaFinalManual: formatDateStr(row[idx('Fecha_Final_Pagado')]) || null,
      comprobanteUrl:  String(row[idx('Comprobante_URL')] || '').trim()
    });
  }
  out.sort((a, b) => String(a.fechaPermiso).localeCompare(String(b.fechaPermiso)));
  cache.put(PERMISOS_CACHE_KEY_SHEET, JSON.stringify(out), PERMISOS_CACHE_TTL_SHEET);
  return out;
}

/** Force-clear the sheet permisos cache. */
function refreshPermisosSheet() {
  CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
  const list = getApprovedPermisosFromSheet_();
  Logger.log('Refreshed ' + list.length + ' permisos aprobados (sheet)');
  return list;
}

// ─── One-time fix: shift mis-aligned migrated rows ───────────────────────

/**
 * The first migration ran under the 17-col schema. The v2 schema inserted
 * Email_Empleado as column E (5th), so old migrated rows have all their
 * data after Nombre shifted one column to the LEFT (i.e. Fecha_Permiso
 * value sits in Email_Empleado column).
 *
 * This function scans for that pattern (rows whose ID starts with "NOT"
 * and whose Email_Empleado matches a date format) and shifts those rows
 * right by 1 column starting at Email_Empleado. Idempotent — re-running
 * does nothing once rows are aligned.
 *
 * Run once from the editor:
 *   fixMigratedPermisoColumns()
 */
function fixMigratedPermisoColumns() {
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const lastCol = PERMISOS_HEADERS.length;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, fixed: 0 };

  const headers = data[0];
  const idCol = headers.indexOf('ID');
  const emailCol = headers.indexOf('Email_Empleado');  // index 4

  let fixed = 0;
  let scanned = 0;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const id = String(row[idCol] || '');
    // Target migrated rows (NOT*) but also handle any row where Email_Empleado
    // was filled with non-email data (Date object, dashes, anything else).
    if (!id.startsWith('NOT')) continue;
    scanned++;

    const cell = row[emailCol];
    // Empty cell → already aligned
    if (cell === '' || cell === null || cell === undefined) continue;
    // Looks like a real email → already aligned
    if (typeof cell === 'string' && cell.indexOf('@') >= 0) continue;
    // Anything else (Date, number, non-email string) → this row is shifted

    const newRow = row.slice();
    for (let c = lastCol - 1; c > emailCol; c--) {
      newRow[c] = row[c - 1];
    }
    newRow[emailCol] = '';

    sheet.getRange(r + 1, 1, 1, lastCol).setValues([newRow]);
    fixed++;
  }
  CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
  Logger.log('fixMigratedPermisoColumns: scanned=' + scanned + ' NOT* rows, fixed=' + fixed);
  return { ok: true, scanned: scanned, fixed: fixed };
}

// ─── Engine writeback ────────────────────────────────────────────────────

/**
 * Called by recomputeSemanal in asistencia_engine.gs after processing a week.
 * Writes per-permiso analysis (real ausente min, repose status, day-by-day
 * detail, computed timestamp) back to the PERMISOS sheet so the admin UI
 * can show what actually happened.
 *
 * Input: array of {
 *   permisoId, realAusenteMin, reposeStatus, reposeDetail
 * }
 */
function writeBackPermisoAnalysis_(analyses) {
  if (!analyses || !analyses.length) return;
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  const realCol = headers.indexOf('Real_Ausente_Min');
  const statusCol = headers.indexOf('Repose_Status');
  const detailCol = headers.indexOf('Repose_Detail');
  const computedCol = headers.indexOf('Computed_At');
  if (idCol < 0 || realCol < 0) return;  // sheet not yet upgraded — silently skip

  const byId = {};
  analyses.forEach(a => { byId[String(a.permisoId)] = a; });
  const now = formatDateStr(new Date());

  for (let r = 1; r < data.length; r++) {
    const id = String(data[r][idCol]);
    const a = byId[id];
    if (!a) continue;
    const rowNum = r + 1;
    sheet.getRange(rowNum, realCol + 1).setValue(a.realAusenteMin != null ? a.realAusenteMin : '');
    sheet.getRange(rowNum, statusCol + 1).setValue(a.reposeStatus || '');
    sheet.getRange(rowNum, detailCol + 1).setValue(a.reposeDetail || '');
    sheet.getRange(rowNum, computedCol + 1).setValue(now);
  }
  CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
}

// ─── One-time migration: April + May permisos from Notion → Sheet ────────

/**
 * Pulls all Aprobado permisos from the Notion Reporte de Permisos DB whose
 * Fecha de permiso falls in April or May (any year — but in practice 2026)
 * and inserts them into the PERMISOS sheet.
 *
 * Idempotent: skips rows whose ID already exists in the sheet (we use the
 * Notion page ID as the sheet ID for migrated rows so re-runs don't dupe).
 *
 * Run once from Apps Script editor:
 *   migrateAprilMayPermisosFromNotion()
 *
 * Returns { ok, migrated, skipped, total } for sanity check.
 */
function migrateAprilMayPermisosFromNotion() {
  // Reuse the engine helper to fetch all Aprobado permisos from Notion
  // (asistencia_engine.gs · getApprovedPermisos_ → calls notionQueryAll_)
  // We need the Notion-shape directly so we duplicate the fetch here:
  const filter = {
    and: [
      { property: 'Respuesta', select: { equals: 'Aprobado' } }
    ]
  };
  const pages = notionQueryAll_(NOTION_DS_PERMISOS, filter, [
    { property: 'Fecha de permiso', direction: 'ascending' }
  ]);

  // Build set of existing IDs in the sheet so we don't dupe on re-run
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const existing = sheet.getDataRange().getValues();
  const existingIds = new Set();
  for (let r = 1; r < existing.length; r++) existingIds.add(String(existing[r][0]));

  // Pull the Notion roster so we can resolve numeroColab from the relation
  const rules = getEmpleadoRulesFromNotion_();
  const numByPageId = {};
  Object.keys(rules).forEach(num => {
    if (rules[num].pageId) numByPageId[rules[num].pageId] = parseInt(num);
  });

  const rowsToAppend = [];
  let skipped = 0;
  let outOfRange = 0;

  pages.forEach(page => {
    const fecha = String(notionPropValue_(page, 'Fecha de permiso') || '');
    if (!fecha) return;
    // Match April (04) or May (05) of any year
    const m = fecha.match(/^\d{4}-(\d{2})-\d{2}/);
    if (!m) return;
    const month = m[1];
    if (month !== '04' && month !== '05') {
      outOfRange++;
      return;
    }

    // Use Notion page ID (no dashes) as sheet ID — guarantees idempotency
    const sheetId = 'NOT' + page.id.replace(/-/g, '');
    if (existingIds.has(sheetId)) { skipped++; return; }

    const nombreCompleto = String(notionPropValue_(page, 'Nombre Completo ') || '').trim();
    const colabIds = notionPropValue_(page, 'Colaborador') || [];

    // Resolve numero from colaborador relation; fallback to name match
    let numero = null;
    for (let i = 0; i < colabIds.length; i++) {
      const pid = String(colabIds[i]).replace(/-/g, '');
      if (numByPageId[pid]) { numero = numByPageId[pid]; break; }
    }
    if (numero == null) {
      // Fallback: match by name
      for (const numStr in rules) {
        if (rules[numStr].nombre.toLowerCase() === nombreCompleto.toLowerCase()) {
          numero = parseInt(numStr);
          break;
        }
      }
    }

    const horas = parseFloat(notionPropValue_(page, 'Tiempo total ausente (8 horas por día)')) || 0;
    const horario = String(notionPropValue_(page, 'HORARIO AUSENTE') || '');
    const asuntoArr = notionPropValue_(page, 'Asunto de permiso ') || [];
    const asuntoStr = Array.isArray(asuntoArr) ? asuntoArr.join(', ') : String(asuntoArr);
    const reponer = notionPropValue_(page, 'Vas a reponer el tiempo ausente?') || '';
    const comoReponerArr = notionPropValue_(page, '¿Cómo vas a reponer el tiempo?') || [];
    const comoReponerStr = Array.isArray(comoReponerArr) ? comoReponerArr.join(', ') : String(comoReponerArr);
    const fechaFinal = String(notionPropValue_(page, 'Fecha final de tiempo pagado') || '');

    rowsToAppend.push(buildPermisoRow_({
      ID: sheetId,
      Fecha_Solicitud: formatDateStr(new Date()),
      NumeroColab: numero || '',
      Nombre: nombreCompleto,
      Email_Empleado: '',
      Fecha_Permiso: fecha,
      Horario_Ausente: horario,
      Horas_Ausente: horas,
      Asunto: asuntoStr,
      Descripcion: '',
      Reponer: reponer,
      Como_Reponer: comoReponerStr,
      Fecha_Final_Pagado: fechaFinal,
      Comprobante_URL: '',
      Respuesta: 'Aprobado',
      Aprobado_Por: 'le.nbclub@gmail.com',
      Fecha_Decision: formatDateStr(new Date()),
      Notas_Admin: 'Migrado de Notion (' + page.id + ')'
    }));
  });

  if (rowsToAppend.length) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, PERMISOS_HEADERS.length).setValues(rowsToAppend);
  }

  // Bust caches
  CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);

  const summary = {
    ok: true,
    migrated: rowsToAppend.length,
    skipped: skipped,
    outOfRange: outOfRange,
    totalAprobadosInNotion: pages.length
  };
  Logger.log('Migration summary: ' + JSON.stringify(summary, null, 2));
  log('PERMISO_MIGRATE', JSON.stringify(summary));
  return summary;
}
