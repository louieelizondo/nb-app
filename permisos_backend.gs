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
  'Fecha_Permiso',       // YYYY-MM-DD day of absence
  'Horario_Ausente',     // free text e.g. "8:00 - 12:00"
  'Horas_Ausente',       // self-reported, max 8 (1 day = 8h per NB rule)
  'Asunto',              // Personal | Médico | Legal | Educativo (single)
  'Descripcion',         // brief description from form
  'Reponer',             // "Sí" | "No" | ""
  'Como_Reponer',        // comma-joined methods
  'Fecha_Final_Pagado',  // YYYY-MM-DD (auto-calc on form, editable by admin)
  'Comprobante_URL',     // Drive shareable URL (médico/legal proof)
  'Respuesta',           // Pendiente | Aprobado | Rechazado
  'Aprobado_Por',        // admin email
  'Fecha_Decision',      // YYYY-MM-DD when status flipped
  'Notas_Admin'          // optional rejection reason
];

const PERMISOS_FOLDER_NAME = 'NB_Comprobantes_Permisos';
const PERMISOS_CACHE_KEY_SHEET = 'asistencia_permisos_sheet_v1';
const PERMISOS_CACHE_TTL_SHEET = 300;  // 5 min — matches Notion cache

// ─── Sheet setup ──────────────────────────────────────────────────────────

/**
 * Idempotent. Creates PERMISOS tab if missing, ensures headers match.
 * Run once from Apps Script editor before launching the form.
 */
function setupPermisosSheet() {
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  // Ensure existing sheet has correct headers (in case of schema drift)
  const range = sheet.getRange(1, 1, 1, PERMISOS_HEADERS.length);
  range.setValues([PERMISOS_HEADERS]);
  range.setFontWeight('bold');
  range.setBackground('#1a3a1a');
  range.setFontColor('white');
  sheet.setFrozenRows(1);

  // Set reasonable column widths
  const widths = [140, 130, 60, 180, 100, 130, 70, 90, 250, 60, 220, 110, 220, 100, 220, 110, 220];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  Logger.log('PERMISOS sheet ready · ' + PERMISOS_HEADERS.length + ' columns');
  return { ok: true, columns: PERMISOS_HEADERS.length, headers: PERMISOS_HEADERS };
}

// ─── Public: form submission ──────────────────────────────────────────────

/**
 * Public POST handler — no auth required.
 * Body: {
 *   permiso: {
 *     numeroColab, nombre, fechaPermiso, horarioAusente, horasAusente,
 *     asunto, descripcion, reponer, comoReponer, fechaFinalPagado
 *   },
 *   comprobanteBase64?: string,
 *   comprobanteFilename?: string
 * }
 */
function submitPermiso(body) {
  const p = body.permiso || {};
  if (!p.numeroColab || !p.nombre || !p.fechaPermiso) {
    return { error: 'Faltan campos requeridos: numeroColab, nombre, fechaPermiso' };
  }

  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const id = 'PRM' + Date.now();
  const ahora = formatDateStr(new Date());

  // Optional comprobante upload
  let comprobanteUrl = '';
  if (body.comprobanteBase64 && body.comprobanteBase64.length > 100) {
    try {
      comprobanteUrl = saveComprobantePermisoToDrive_(
        id,
        body.comprobanteBase64,
        body.comprobanteFilename || 'comprobante.pdf',
        p.nombre || ''
      );
    } catch (err) {
      Logger.log('PERMISO_COMP_ERROR: ' + err.message);
      // Don't fail the whole submission — just log the comprobante error
    }
  }

  const comoReponerStr = Array.isArray(p.comoReponer)
    ? p.comoReponer.join(', ')
    : String(p.comoReponer || '');

  const row = [
    id,
    ahora,
    parseInt(p.numeroColab) || '',
    String(p.nombre || '').trim(),
    String(p.fechaPermiso || ''),
    String(p.horarioAusente || ''),
    parseFloat(p.horasAusente) || 0,
    String(p.asunto || ''),
    String(p.descripcion || ''),
    String(p.reponer || ''),
    comoReponerStr,
    String(p.fechaFinalPagado || ''),
    comprobanteUrl,
    'Pendiente',
    '',
    '',
    ''
  ];
  sheet.appendRow(row);

  // Bust the engine's permisos cache so next compute sees the new row immediately
  // (only matters for Aprobado, but cheap to do here too)
  try {
    CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
  } catch (e) {}

  log('PERMISO_SUBMIT', id + ' · ' + p.nombre + ' · ' + p.fechaPermiso);
  return { ok: true, id: id };
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
      _row:              r + 1
    });
  }
  out.sort((a, b) => String(b.fechaSolicitud).localeCompare(String(a.fechaSolicitud)));
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
      // Bust the engine's permisos cache so the change is picked up immediately
      CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
      log('PERMISO_DECISION', body.id + ' · ' + body.estado + ' · ' + body.email);
      return { ok: true, id: body.id, estado: body.estado };
    }
  }
  return { error: 'Permiso no encontrado: ' + body.id };
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
      fechaFinalManual: formatDateStr(row[idx('Fecha_Final_Pagado')]) || null
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

    rowsToAppend.push([
      sheetId,                                            // ID
      formatDateStr(new Date()),                          // Fecha_Solicitud (today, since we don't have it from Notion)
      numero || '',                                       // NumeroColab
      nombreCompleto,                                     // Nombre
      fecha,                                              // Fecha_Permiso
      horario,                                            // Horario_Ausente
      horas,                                              // Horas_Ausente
      asuntoStr,                                          // Asunto
      '',                                                 // Descripcion (Notion didn't have this field)
      reponer,                                            // Reponer
      comoReponerStr,                                     // Como_Reponer
      fechaFinal,                                         // Fecha_Final_Pagado
      '',                                                 // Comprobante_URL (Notion didn't store these)
      'Aprobado',                                         // Respuesta
      'le.nbclub@gmail.com',                              // Aprobado_Por (assumed Louie)
      formatDateStr(new Date()),                          // Fecha_Decision
      'Migrado de Notion (' + page.id + ')'               // Notas_Admin
    ]);
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
