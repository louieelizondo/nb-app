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
// PERMISOS table holds BOTH Permiso and Vacacion records (Tipo column).
// For Permiso: Fecha_Permiso = day of absence, Fecha_Fin = same day.
// For Vacacion: Fecha_Permiso = start, Fecha_Fin = end (inclusive range).
const PERMISOS_TAB = 'PERMISOS';
const PERMISOS_HEADERS = [
  'ID',                  // PRM{timestamp} for permisos, VAC{timestamp} for vacaciones
  'Tipo',                // Permiso | Vacacion
  'Fecha_Solicitud',     // ISO datetime when form submitted
  'NumeroColab',         // number → maps to Colaboradores
  'Nombre',              // string snapshot at submit
  'Email_Empleado',      // optional, for confirmations
  'Fecha_Permiso',       // YYYY-MM-DD — start day for both types
  'Fecha_Fin',           // YYYY-MM-DD — end day; same as Fecha_Permiso for Permiso
  'Dias_Vacacion',       // count of vacation days (only set for Vacacion)
  'Horario_Ausente',     // e.g. "08:00 - 12:00" (only Permiso)
  'Horas_Ausente',       // hours (only Permiso)
  'Asunto',              // Permiso: Personal/Médico/Legal/Educativo · Vacacion: Vacaciones
  'Descripcion',         // brief description from form (required)
  'Reponer',             // "Sí" | "No" | "" (only Permiso)
  'Como_Reponer',        // comma-joined methods (only Permiso)
  'Fecha_Final_Pagado',  // YYYY-MM-DD repose end (only Permiso)
  'Comprobante_URL',     // Drive URL — admin uploads after decision (Permiso only)
  'Respuesta',           // Pendiente | Aprobado | Rechazado | Cancelado
  'Aprobado_Por',        // admin email
  'Fecha_Decision',      // YYYY-MM-DD when status flipped
  'Notas_Admin',         // optional rejection/cancellation reason
  // ── Engine writeback (populated by recomputeSemanal) ──
  'Real_Ausente_Min',    // actual minutes ausente per checador (Permiso)
  'Repose_Status',       // pending | completo | shortfall | over_cap_no_repose | not_required (Permiso)
  'Repose_Detail',       // text breakdown (Permiso)
  'Computed_At',         // timestamp of last engine writeback
  'Anualidad_Year'       // year the anualidad started (Vacacion only) — explicit override
];

const PERMISOS_FOLDER_NAME = 'NB_Comprobantes_Permisos';
const PERMISOS_CACHE_KEY_SHEET = 'asistencia_permisos_sheet_v1';
const PERMISOS_CACHE_TTL_SHEET = 300;  // 5 min — matches Notion cache

// ─── One-time backfill: days used pre-system per current anualidad ───────
// Edit this map directly when needed. Just maps numeroColab → días used.
// Going forward, real vacation rows in PERMISOS sheet drive everything;
// this is only here to seed the few people who had usage before the system.
const VACACION_BACKFILL = {
  1:  14,   // Monica Reyes (entitled 26, 12 left)
  9:  16,   // Iris Soto (used all)
  10: 12,   // Elena Aguilar (used all)
  34: 10,   // Antonio Aguiñaga (entitled 14, 4 left including 2 reserved)
  38: 10    // Elvia Acosta (entitled 12, 2 left)
};

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

  // Set reasonable column widths (matches PERMISOS_HEADERS in order)
  const widths = [140, 90, 130, 60, 180, 200, 100, 100, 70, 130, 70, 110, 250, 60, 220, 110, 220, 110, 220, 110, 220, 110, 130, 320, 130];
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
    Tipo: 'Permiso',
    Fecha_Solicitud: ahora,
    NumeroColab: parseInt(p.numeroColab) || '',
    Nombre: String(p.nombre || '').trim(),
    Email_Empleado: String(p.email || '').trim().toLowerCase(),
    Fecha_Permiso: String(p.fechaPermiso || ''),
    Fecha_Fin: String(p.fechaPermiso || ''),  // Permiso: same day
    Dias_Vacacion: '',
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

  // Always notify admin (Louie) so he can review without polling
  try {
    sendAdminSubmitNotification_('permiso', {
      id: id, nombre: p.nombre, fechaPermiso: p.fechaPermiso,
      horario: p.horarioAusente, asunto: p.asunto, descripcion: p.descripcion,
      reponer: p.reponer
    });
  } catch (err) {
    Logger.log('ADMIN_NOTIFY_ERROR (permiso): ' + err.message);
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

// ─── Public: submit vacation request ─────────────────────────────────────

/**
 * Body: { vacacion: { numeroColab, nombre, email?, fechaInicio, fechaFin,
 *   diasVacacion, descripcion } }
 *
 * Workflow:
 *   1. Validate range, employee exists in COLABORADORES
 *   2. Check vacation balance (must have available or reserve-eligible days)
 *   3. Detect overlaps with other employees' approved/pending requests (warning, not block)
 *   4. Insert row, send confirmation email
 */
function submitVacacion(body) {
  const v = body.vacacion || {};
  if (!v.numeroColab || !v.nombre || !v.fechaInicio || !v.fechaFin) {
    return { error: 'Faltan campos: numeroColab, nombre, fechaInicio, fechaFin' };
  }
  if (!v.descripcion || !String(v.descripcion).trim()) {
    return { error: 'La descripción es requerida.' };
  }
  if (String(v.fechaFin) < String(v.fechaInicio)) {
    return { error: 'La fecha de fin debe ser igual o después que la de inicio.' };
  }
  const dias = parseInt(v.diasVacacion) || countWorkDaysBetween_(v.fechaInicio, v.fechaFin);
  if (dias < 1) return { error: 'El rango debe tener al menos 1 día.' };

  // Validate balance
  const bal = getVacacionBalance(v.numeroColab);
  if (bal.error) return { error: 'No pude calcular tu balance: ' + bal.error };

  // Anualidad selection — employee picks explicitly which year these days come from.
  // Fallback to date inference if not provided (legacy behavior).
  let anualidadYear = parseInt(v.anualidadYear) || null;
  if (!anualidadYear) {
    const inferred = anniversaryYearForDate_(bal.inicioLaboral, v.fechaInicio);
    if (inferred == null) {
      return { error: 'Aún no aplicas a vacaciones — primera anualidad inicia el ' + bal.nextAnniversary + '.' };
    }
    // Convert "anniversary year index" (0,1,2,...) to absolute calendar year of anualidad start
    anualidadYear = parseInt(bal.inicioLaboral.slice(0, 4)) + inferred;
  }

  // Validate the chosen anualidad
  const currentAnualidadStartYear = parseInt(bal.anualidadInicio.slice(0, 4));
  if (anualidadYear === currentAnualidadStartYear) {
    if (dias > bal.disponibles) {
      return { error: `Solo tienes ${bal.disponibles} días disponibles en la anualidad ${anualidadYear}. Solicitaste ${dias}.` };
    }
  } else if (anualidadYear === currentAnualidadStartYear + 1) {
    // Reservación adelantada — must be within 2 months of next anniversary
    const todayStr = formatDateStr(new Date());
    const earliestReservaStr = addDaysStr_(bal.nextAnniversary, -60);
    if (todayStr < earliestReservaStr) {
      return { error: `Tu próxima anualidad ${anualidadYear} inicia el ${bal.nextAnniversary}. Solo puedes reservar hasta 2 meses antes (a partir del ${earliestReservaStr}).` };
    }
    if (dias > bal.proximaAnualidadDias) {
      return { error: `En tu anualidad ${anualidadYear} tendrás ${bal.proximaAnualidadDias} días. Solicitaste ${dias}.` };
    }
  } else if (anualidadYear < currentAnualidadStartYear) {
    return { error: `La anualidad ${anualidadYear} ya cerró. Solo puedes usar días de tu anualidad ${currentAnualidadStartYear} o reservar para ${currentAnualidadStartYear + 1}.` };
  } else {
    return { error: `No puedes solicitar vacaciones para la anualidad ${anualidadYear}. Demasiado adelantado.` };
  }

  // Overlap detection (soft warning — caller decides to proceed via body.confirmedOverlap)
  if (!body.confirmedOverlap) {
    const overlaps = findVacacionOverlaps_(v.fechaInicio, v.fechaFin, parseInt(v.numeroColab));
    if (overlaps.length) {
      return {
        warning: 'overlap',
        overlaps: overlaps.map(o => ({
          nombre: o.nombre, tipo: o.tipo, fechaInicio: o.fechaInicio, fechaFin: o.fechaFin,
          respuesta: o.respuesta
        }))
      };
    }
  }

  // Insert
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const id = 'VAC' + Date.now();
  const ahora = formatDateStr(new Date());
  const row = buildPermisoRow_({
    ID: id,
    Tipo: 'Vacacion',
    Fecha_Solicitud: ahora,
    NumeroColab: parseInt(v.numeroColab),
    Nombre: String(v.nombre).trim(),
    Email_Empleado: String(v.email || '').trim().toLowerCase(),
    Fecha_Permiso: String(v.fechaInicio),
    Fecha_Fin: String(v.fechaFin),
    Dias_Vacacion: dias,
    Horario_Ausente: '',
    Horas_Ausente: '',
    Asunto: 'Vacaciones',
    Descripcion: String(v.descripcion).trim(),
    Reponer: '',
    Como_Reponer: '',
    Fecha_Final_Pagado: '',
    Comprobante_URL: '',
    Respuesta: 'Pendiente',
    Aprobado_Por: '',
    Fecha_Decision: '',
    Notas_Admin: '',
    Real_Ausente_Min: '',
    Repose_Status: '',
    Repose_Detail: '',
    Computed_At: '',
    Anualidad_Year: anualidadYear
  });
  sheet.appendRow(row);
  CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);

  // Confirmation email
  if (v.email) {
    try {
      sendVacacionEmail_(v.email, 'submitted', {
        id, nombre: v.nombre, fechaInicio: v.fechaInicio, fechaFin: v.fechaFin,
        dias, descripcion: v.descripcion
      });
    } catch (err) {
      Logger.log('VACACION_EMAIL_ERROR (submit): ' + err.message);
    }
  }

  // Always notify admin
  try {
    sendAdminSubmitNotification_('vacacion', {
      id, nombre: v.nombre, fechaInicio: v.fechaInicio, fechaFin: v.fechaFin,
      dias, descripcion: v.descripcion
    });
  } catch (err) {
    Logger.log('ADMIN_NOTIFY_ERROR (vacacion): ' + err.message);
  }

  log('VACACION_SUBMIT', id + ' · ' + v.nombre + ' · ' + v.fechaInicio + '→' + v.fechaFin + ' (' + dias + 'd)');
  return { ok: true, id };
}

// ─── Vacation balance calculator (LFT post-2023) ─────────────────────────

/**
 * Returns { numero, nombre, inicioLaboral, anosCompletos,
 *   currentAnniversaryYear, anualidadInicio, anualidadFin, nextAnniversary,
 *   diasEntitled, diasUsados, diasReservados, disponibles,
 *   proximaAnualidadDias }
 *
 * For frontend display + submit validation.
 */
function getVacacionBalance(numeroColab) {
  const num = parseInt(numeroColab);
  if (!num) return { error: 'numeroColab inválido' };

  const colabs = (typeof getColaboradoresFromSheet_ === 'function')
    ? getColaboradoresFromSheet_() : {};
  const c = colabs[num];
  if (!c) return { error: 'Colaborador #' + num + ' no encontrado en COLABORADORES' };
  if (!c.inicioLaboral) return { error: 'Falta Inicio_Laboral en COLABORADORES para #' + num };

  // String-based date math — avoids the JS Date / TZ off-by-one bug entirely.
  const inicioStr = String(c.inicioLaboral);
  const todayStr  = formatDateStr(new Date());
  const [iy, im, id] = inicioStr.split('-').map(Number);
  const [ty, tm, td] = todayStr.split('-').map(Number);

  // Completed years
  let anos = ty - iy;
  if (tm < im || (tm === im && td < id)) anos--;

  const pad = n => String(n).padStart(2, '0');
  const mmdd = pad(im) + '-' + pad(id);
  // Backfill from hardcoded map (not sheet) — see VACACION_BACKFILL constant.
  const backfill = parseFloat(VACACION_BACKFILL[num]) || 0;

  if (anos < 1) {
    const firstAnnivStr = (iy + 1) + '-' + mmdd;
    return {
      numero: num, nombre: c.nombre, inicioLaboral: inicioStr,
      anosCompletos: 0, currentAnniversaryYear: 0,
      anualidadInicio: inicioStr,
      anualidadFin: addDaysStr_(firstAnnivStr, -1),
      nextAnniversary: firstAnnivStr,
      diasEntitled: 0,
      diasUsados: 0, diasUsadosBackfill: backfill,
      diasReservados: 0,
      disponibles: 0,
      proximaAnualidadDias: lftDaysForYear_(1)
    };
  }

  // Anniversary year window: [anniv N, anniv N+1)
  // anualidadInicio = day OF anniversary; anualidadFin = day BEFORE next anniversary
  const anualidadInicioStr = (iy + anos) + '-' + mmdd;
  const nextAnnivStr       = (iy + anos + 1) + '-' + mmdd;
  const anualidadFinStr    = addDaysStr_(nextAnnivStr, -1);
  const proxAnualidadFinStr = addDaysStr_((iy + anos + 2) + '-' + mmdd, -1);
  const diasEntitled       = lftDaysForYear_(anos);
  const proximaAnualidadDias = lftDaysForYear_(anos + 1);

  // Walk vacation rows and bucket by anualidad. New rows store Anualidad_Year
  // explicitly (the calendar year the anualidad started). Older rows fall back
  // to date inference.
  const currentAnualidadStartYear = iy + anos;  // e.g. 2025 for Elvia year-2 anualidad
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);
  const anualidadYearCol = idx('Anualidad_Year');
  let usadosFromRows = 0, reservadosActual = 0, reservadosProxima = 0;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (String(row[idx('Tipo')]) !== 'Vacacion') continue;
    if (parseInt(row[idx('NumeroColab')]) !== num) continue;
    const respuesta = String(row[idx('Respuesta')]);
    if (respuesta === 'Rechazado' || respuesta === 'Cancelado') continue;
    const dias = parseInt(row[idx('Dias_Vacacion')]) || 0;
    const startStr = formatDateStr(row[idx('Fecha_Permiso')]);
    const endStr   = formatDateStr(row[idx('Fecha_Fin')]) || startStr;
    if (!startStr) continue;

    // Determine anualidad: prefer explicit Anualidad_Year, fall back to dates.
    let anualidad = null;  // 'actual' | 'proxima' | null
    const explicitYear = anualidadYearCol >= 0 ? parseInt(row[anualidadYearCol]) : null;
    if (explicitYear) {
      if (explicitYear === currentAnualidadStartYear) anualidad = 'actual';
      else if (explicitYear === currentAnualidadStartYear + 1) anualidad = 'proxima';
      else continue;  // older anualidad — already closed, ignore for current balance
    } else {
      if (startStr >= anualidadInicioStr && startStr <= anualidadFinStr) {
        anualidad = 'actual';
      } else if (startStr >= addDaysStr_(anualidadFinStr, 1) && startStr <= proxAnualidadFinStr) {
        anualidad = 'proxima';
      } else {
        continue;
      }
    }

    if (anualidad === 'actual') {
      if (endStr < todayStr) usadosFromRows += dias;
      else                    reservadosActual += dias;
    } else {
      reservadosProxima += dias;
    }
  }

  const diasUsados = usadosFromRows + backfill;
  const disponibles = Math.max(0, diasEntitled - diasUsados - reservadosActual);
  const proximaDisponibles = Math.max(0, proximaAnualidadDias - reservadosProxima);

  return {
    numero: num,
    nombre: c.nombre,
    inicioLaboral: inicioStr,
    anosCompletos: anos,
    currentAnniversaryYear: anos,
    anualidadInicio: anualidadInicioStr,
    anualidadFin: anualidadFinStr,
    nextAnniversary: nextAnnivStr,
    diasEntitled,
    diasUsados,
    diasUsadosBackfill: backfill,
    diasReservadosActual: reservadosActual,
    diasReservadosProxima: reservadosProxima,
    disponibles,
    proximaAnualidadDias,
    proximaDisponibles
  };
}

/**
 * LFT post-2023 reform:
 *   Year 1: 12, Year 2: 14, Year 3: 16, Year 4: 18, Year 5: 20
 *   Years 6-10: 22, 11-15: 24, 16-20: 26, +2 every 5 years thereafter.
 */
function lftDaysForYear_(year) {
  if (year < 1) return 0;
  if (year === 1) return 12;
  if (year === 2) return 14;
  if (year === 3) return 16;
  if (year === 4) return 18;
  if (year === 5) return 20;
  if (year <= 10) return 22;
  if (year <= 15) return 24;
  if (year <= 20) return 26;
  if (year <= 25) return 28;
  if (year <= 30) return 30;
  return 32;  // capped reasonable upper bound
}

/** Returns the anniversary year index (0=before first anniv, 1=year-1 window, etc.) for a given absolute date string, or null if before inicio. */
function anniversaryYearForDate_(inicioLaboral, dateStr) {
  if (!inicioLaboral || !dateStr) return null;
  if (String(dateStr) < String(inicioLaboral)) return null;
  const [iy, im, id] = String(inicioLaboral).split('-').map(Number);
  const [ty, tm, td] = String(dateStr).split('-').map(Number);
  let years = ty - iy;
  if (tm < im || (tm === im && td < id)) years--;
  return Math.max(0, years);
}

/** Counts work days (Mon-Sat per NB schedule) between two dates inclusive. */
function countWorkDaysBetween_(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() !== 0) count++;  // skip Sundays
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ─── Overlap detection ────────────────────────────────────────────────────

/**
 * Returns array of {numeroColab, nombre, tipo, fechaInicio, fechaFin, respuesta}
 * for OTHER employees with approved/pending absences overlapping the range.
 */
function findVacacionOverlaps_(startStr, endStr, excludeNumero) {
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const num = parseInt(row[idx('NumeroColab')]);
    if (num === excludeNumero) continue;
    const respuesta = String(row[idx('Respuesta')]);
    if (respuesta !== 'Aprobado' && respuesta !== 'Pendiente') continue;
    const ini = formatDateStr(row[idx('Fecha_Permiso')]);
    const fin = formatDateStr(row[idx('Fecha_Fin')]) || ini;
    if (!ini) continue;
    // Overlap if start <= other.fin AND end >= other.ini
    if (startStr <= fin && endStr >= ini) {
      out.push({
        numeroColab: num,
        nombre: String(row[idx('Nombre')] || ''),
        tipo: String(row[idx('Tipo')] || 'Permiso'),
        fechaInicio: ini,
        fechaFin: fin,
        respuesta: respuesta
      });
    }
  }
  return out;
}

// ─── One-time seed: pre-existing reservations (Louie's data, May 2026) ──

/**
 * Seeds the 3 vacation reservations Louie communicated 2026-05-06:
 *   - Iris Soto Romero (#9)         · 2026-08-01 → 2026-08-15
 *   - Antonio Aguiñaga (#34)        · 2026-05-29 → 2026-05-30
 *   - Elvia Raquel Acosta (#38)     · 2026-08-07 → 2026-08-18
 *
 * All inserted as Tipo=Vacacion · Respuesta=Aprobado · Aprobado_Por=Louie.
 * Idempotent — skips rows whose ID already exists.
 *
 * Edit the SEED array below if names/dates need adjustment, then run once.
 */
function seedReservedVacaciones2026() {
  const SEED = [
    { numero: 9,  nombre: 'Iris Soto Romero',           inicio: '2026-08-01', fin: '2026-08-15', desc: 'Vacaciones reservadas (backfill 2026-05-06)' },
    { numero: 34, nombre: 'Juan Antonio Aguiñaga Rodriguez', inicio: '2026-05-29', fin: '2026-05-30', desc: 'Vacaciones reservadas (backfill 2026-05-06)' },
    { numero: 38, nombre: 'Elvia Raquel Acosta Jimenez', inicio: '2026-08-07', fin: '2026-08-18', desc: 'Vacaciones reservadas (backfill 2026-05-06)' }
  ];
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  const existingIds = new Set();
  for (let r = 1; r < data.length; r++) existingIds.add(String(data[r][idCol]));

  const ahora = formatDateStr(new Date());
  const rows = [];
  let inserted = 0, skipped = 0;
  SEED.forEach((s, i) => {
    const id = 'SEED' + s.numero + '_' + s.inicio.replace(/-/g, '');
    if (existingIds.has(id)) { skipped++; return; }
    const dias = countWorkDaysBetween_(s.inicio, s.fin);
    rows.push(buildPermisoRow_({
      ID: id,
      Tipo: 'Vacacion',
      Fecha_Solicitud: ahora,
      NumeroColab: s.numero,
      Nombre: s.nombre,
      Email_Empleado: '',
      Fecha_Permiso: s.inicio,
      Fecha_Fin: s.fin,
      Dias_Vacacion: dias,
      Horario_Ausente: '',
      Horas_Ausente: '',
      Asunto: 'Vacaciones',
      Descripcion: s.desc,
      Reponer: '',
      Como_Reponer: '',
      Fecha_Final_Pagado: '',
      Comprobante_URL: '',
      Respuesta: 'Aprobado',
      Aprobado_Por: 'le.nbclub@gmail.com',
      Fecha_Decision: ahora,
      Notas_Admin: 'Seed migration (backfill)',
      Real_Ausente_Min: '',
      Repose_Status: '',
      Repose_Detail: '',
      Computed_At: ''
    }));
    inserted++;
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PERMISOS_HEADERS.length).setValues(rows);
  }
  CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
  CacheService.getScriptCache().remove('asistencia_vacacion_days_v1');
  Logger.log('Seed reservaciones 2026: inserted=' + inserted + ', skipped=' + skipped);
  return { ok: true, inserted, skipped };
}

// ─── Calendar feed ────────────────────────────────────────────────────────

/**
 * Returns all approved + pending absences in a date window for calendar rendering.
 * Body params: { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 * Defaults to ±60 days from today.
 */
function getAusenciasCalendar(params) {
  const today = new Date();
  const from = (params && params.from) || formatDateStr(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const to   = (params && params.to)   || formatDateStr(new Date(today.getFullYear(), today.getMonth() + 4, 0));

  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const respuesta = String(row[idx('Respuesta')]);
    if (respuesta !== 'Aprobado' && respuesta !== 'Pendiente') continue;
    const ini = formatDateStr(row[idx('Fecha_Permiso')]);
    const fin = formatDateStr(row[idx('Fecha_Fin')]) || ini;
    if (!ini) continue;
    if (fin < from || ini > to) continue;
    out.push({
      id: String(row[idx('ID')]),
      tipo: String(row[idx('Tipo')] || 'Permiso'),
      numeroColab: parseInt(row[idx('NumeroColab')]) || null,
      nombre: String(row[idx('Nombre')] || ''),
      fechaInicio: ini,
      fechaFin: fin,
      diasVacacion: parseInt(row[idx('Dias_Vacacion')]) || null,
      horarioAusente: String(row[idx('Horario_Ausente')] || ''),
      asunto: String(row[idx('Asunto')] || ''),
      respuesta: respuesta
    });
  }
  out.sort((a, b) => String(a.fechaInicio).localeCompare(String(b.fechaInicio)));
  return { ok: true, from, to, ausencias: out };
}

// ─── Admin: full HR record table ─────────────────────────────────────────

/**
 * Returns ALL active colaboradores with their permiso/vacacion stats and
 * current vacation balance. Used by the admin Historial RH tab.
 *
 * Each entry: {
 *   numero, nombre, inicioLaboral, anosCompletos,
 *   anualidadInicio, anualidadFin, nextAnniversary, anualidadCalendarYear,
 *   diasEntitled, diasUsados, diasReservadosActual, diasReservadosProxima,
 *   disponibles, proximaAnualidadDias,
 *   permisosTotal, permisosAprobados,
 *   vacacionesTotal, vacacionesAprobadas
 * }
 */
/**
 * Returns multi-year balance trajectory for a single colaborador.
 * One entry per year from `fromYear` to `toYear` (inclusive).
 * Used by the Historial RH inline detail view.
 *
 * Body params: { numero, fromYear?: 2025, toYear?: currentYear + 2 }
 */
function getColaboradorMultiYearRecord(params) {
  const num = parseInt(params && params.numero);
  if (!num) return { error: 'numero requerido' };
  // Admin endpoint — bypass cache so any sheet edit (e.g. backfill values
  // typed by Louie) shows up immediately without waiting for cache TTL.
  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  CacheService.getScriptCache().remove(EMPLEADO_RULES_CACHE_KEY);
  const today = new Date();
  const fromYear = parseInt(params.fromYear) || 2025;
  const toYear   = parseInt(params.toYear)   || today.getFullYear() + 2;

  const colabs = (typeof getColaboradoresFromSheet_ === 'function')
    ? getColaboradoresFromSheet_() : {};
  const c = colabs[num];
  if (!c) return { error: 'Colaborador #' + num + ' no encontrado' };

  // Read PERMISOS once, share across all year calls
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);

  // Per-year permiso/vacacion stats for this colab (filtered by Anualidad_Year)
  const anualidadYearCol = idx('Anualidad_Year');
  const statsByYear = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (parseInt(row[idx('NumeroColab')]) !== num) continue;
    const tipo = String(row[idx('Tipo')] || '');
    const resp = String(row[idx('Respuesta')] || '');
    let year = anualidadYearCol >= 0 ? parseInt(row[anualidadYearCol]) : null;
    if (!year) {
      // Infer from start date relative to anniversary
      const startStr = formatDateStr(row[idx('Fecha_Permiso')]);
      if (!startStr || !c.inicioLaboral) continue;
      const [iy, im, id] = c.inicioLaboral.split('-').map(Number);
      const sy = parseInt(startStr.slice(0, 4));
      const sm = parseInt(startStr.slice(5, 7));
      const sd = parseInt(startStr.slice(8, 10));
      year = (sm > im || (sm === im && sd >= id)) ? sy : sy - 1;
    }
    if (!year) continue;
    if (!statsByYear[year]) statsByYear[year] = { permisosTotal: 0, permisosAprobados: 0, vacacionesTotal: 0, vacacionesAprobadas: 0 };
    if (tipo === 'Vacacion') {
      statsByYear[year].vacacionesTotal++;
      if (resp === 'Aprobado') statsByYear[year].vacacionesAprobadas++;
    } else {
      statsByYear[year].permisosTotal++;
      if (resp === 'Aprobado') statsByYear[year].permisosAprobados++;
    }
  }

  // Pre-bucket faltas/retardos for this colab from SEMANAL by year
  const semSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ASISTENCIA_SEMANAL');
  const semByYear = {};
  if (semSheet && semSheet.getLastRow() > 1) {
    const semData = semSheet.getDataRange().getValues();
    const semHeaders = semData[0];
    const semIdx = (h) => semHeaders.indexOf(h);
    const semNumIdx = semIdx('NumeroColab');
    const semIniIdx = semIdx('SemanaInicio');
    const semFaltasIdx = semIdx('FaltasReal');
    const semRetIdx = semIdx('Retardos');
    if (semNumIdx >= 0 && semIniIdx >= 0) {
      for (let r = 1; r < semData.length; r++) {
        if (parseInt(semData[r][semNumIdx]) !== num) continue;
        const ini = formatDateStr(semData[r][semIniIdx]);
        if (!ini) continue;
        const yr = parseInt(ini.slice(0, 4));
        if (!yr) continue;
        if (!semByYear[yr]) semByYear[yr] = { faltas: 0, retardos: 0 };
        semByYear[yr].faltas   += parseInt(semData[r][semFaltasIdx]) || 0;
        semByYear[yr].retardos += parseInt(semData[r][semRetIdx]) || 0;
      }
    }
  }

  const years = [];
  for (let y = fromYear; y <= toYear; y++) {
    const info = getColaboradorAnualidadInfo_(num, y, data, idx);
    const stats = statsByYear[y] || { permisosTotal: 0, permisosAprobados: 0, vacacionesTotal: 0, vacacionesAprobadas: 0 };
    const sem = semByYear[y] || { faltas: 0, retardos: 0 };
    years.push({
      ...info,
      permisosTotal: stats.permisosTotal,
      permisosAprobados: stats.permisosAprobados,
      vacacionesTotal: stats.vacacionesTotal,
      vacacionesAprobadas: stats.vacacionesAprobadas,
      faltasYear: sem.faltas,
      retardosYear: sem.retardos
    });
  }

  return {
    ok: true,
    numero: num,
    nombre: c.nombre,
    inicioLaboral: c.inicioLaboral || null,
    years: years
  };
}

function getColaboradoresRecord(params) {
  const targetYear = params && params.year ? parseInt(params.year) : null;
  // Admin endpoint — bypass cache so manual sheet edits (e.g. backfill,
  // estado changes) reflect immediately. Cheap because called rarely.
  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  CacheService.getScriptCache().remove(EMPLEADO_RULES_CACHE_KEY);
  const colabs = (typeof getColaboradoresFromSheet_ === 'function')
    ? getColaboradoresFromSheet_() : {};
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);

  // Pre-bucket rows by numeroColab AND by year for filtered counts.
  // Permisos: by calendar year of Fecha_Permiso.
  // Vacaciones: by Anualidad_Year column (preferred) or inferred from date.
  const statsByNumYear = {};  // { numero: { year: { permisosTotal, ... } } }
  const colabsForInfer = (typeof getColaboradoresFromSheet_ === 'function')
    ? getColaboradoresFromSheet_() : {};
  const anualidadYearCol = idx('Anualidad_Year');
  for (let r = 1; r < data.length; r++) {
    const num = parseInt(data[r][idx('NumeroColab')]);
    if (!num) continue;
    const tipo = String(data[r][idx('Tipo')] || '');
    const resp = String(data[r][idx('Respuesta')] || '');
    const fechaPermiso = formatDateStr(data[r][idx('Fecha_Permiso')]);

    let year = null;
    if (tipo === 'Vacacion' && anualidadYearCol >= 0) {
      year = parseInt(data[r][anualidadYearCol]);
    }
    if (!year && fechaPermiso) {
      // For permisos: use calendar year of fecha_permiso
      // For vacaciones without explicit Anualidad_Year: infer from anniversary
      if (tipo === 'Vacacion') {
        const c = colabsForInfer[num];
        if (c && c.inicioLaboral) {
          const [iy, im, id] = c.inicioLaboral.split('-').map(Number);
          const sy = parseInt(fechaPermiso.slice(0, 4));
          const sm = parseInt(fechaPermiso.slice(5, 7));
          const sd = parseInt(fechaPermiso.slice(8, 10));
          year = (sm > im || (sm === im && sd >= id)) ? sy : sy - 1;
        }
      } else {
        year = parseInt(fechaPermiso.slice(0, 4));
      }
    }
    if (!year) continue;

    if (!statsByNumYear[num]) statsByNumYear[num] = {};
    if (!statsByNumYear[num][year]) statsByNumYear[num][year] = {
      permisosTotal: 0, permisosAprobados: 0,
      vacacionesTotal: 0, vacacionesAprobadas: 0
    };
    const bucket = statsByNumYear[num][year];
    if (tipo === 'Vacacion') {
      bucket.vacacionesTotal++;
      if (resp === 'Aprobado') bucket.vacacionesAprobadas++;
    } else {
      bucket.permisosTotal++;
      if (resp === 'Aprobado') bucket.permisosAprobados++;
    }
  }

  // Also pre-bucket SEMANAL faltas/retardos per colab per calendar year.
  // We sum FaltasReal + Retardos across all weeks where SemanaInicio falls
  // in the queried calendar year. (Weeks span Vie-Jue so a week can straddle
  // years; using SemanaInicio's year is the convention.)
  const semSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ASISTENCIA_SEMANAL');
  const semByNumYear = {};
  if (semSheet && semSheet.getLastRow() > 1) {
    const semData = semSheet.getDataRange().getValues();
    const semHeaders = semData[0];
    const semIdx = (h) => semHeaders.indexOf(h);
    const semNumIdx = semIdx('NumeroColab');
    const semIniIdx = semIdx('SemanaInicio');
    const semFaltasIdx = semIdx('FaltasReal');
    const semRetIdx = semIdx('Retardos');
    if (semNumIdx >= 0 && semIniIdx >= 0) {
      for (let r = 1; r < semData.length; r++) {
        const num = parseInt(semData[r][semNumIdx]);
        if (!num) continue;
        const ini = formatDateStr(semData[r][semIniIdx]);
        if (!ini) continue;
        const yr = parseInt(ini.slice(0, 4));
        if (!yr) continue;
        if (!semByNumYear[num]) semByNumYear[num] = {};
        if (!semByNumYear[num][yr]) semByNumYear[num][yr] = { faltas: 0, retardos: 0 };
        semByNumYear[num][yr].faltas   += parseInt(semData[r][semFaltasIdx]) || 0;
        semByNumYear[num][yr].retardos += parseInt(semData[r][semRetIdx]) || 0;
      }
    }
  }

  const out = [];
  Object.keys(colabs).forEach(numStr => {
    const num = parseInt(numStr);
    const c = colabs[numStr];

    const info = getColaboradorAnualidadInfo_(num, targetYear, data, idx);
    const yearKey = info.anualidadCalendarYear || targetYear || (new Date()).getFullYear();
    const stats = (statsByNumYear[num] && statsByNumYear[num][yearKey]) || {
      permisosTotal: 0, permisosAprobados: 0, vacacionesTotal: 0, vacacionesAprobadas: 0
    };
    const sem = (semByNumYear[num] && semByNumYear[num][yearKey]) || { faltas: 0, retardos: 0 };
    out.push({
      numero: num,
      nombre: c.nombre,
      inicioLaboral: c.inicioLaboral || null,
      ...info,
      permisosTotal: stats.permisosTotal,
      permisosAprobados: stats.permisosAprobados,
      vacacionesTotal: stats.vacacionesTotal,
      vacacionesAprobadas: stats.vacacionesAprobadas,
      faltasYear: sem.faltas,
      retardosYear: sem.retardos
    });
  });
  // Sort by numero ASC (1, 5, 9, 10, 34, ...)
  out.sort((a, b) => (a.numero || 0) - (b.numero || 0));
  return { ok: true, colaboradores: out, year: targetYear };
}

/**
 * Computes vacation info for a colaborador for a SPECIFIC anualidad year
 * (calendar year of when the anualidad started). If targetYear is null,
 * uses the current anualidad.
 *
 * Returns { anualidadCalendarYear, status, anualidadInicio, anualidadFin,
 *   nextAnniversary, anosCompletos (year of service for this anualidad),
 *   diasEntitled, diasUsados, diasReservadosActual, diasReservadosProxima,
 *   disponibles, proximaAnualidadDias, proximaDisponibles }
 *
 * status: 'before-inicio' | 'past' | 'current' | 'future' | 'closed'
 */
function getColaboradorAnualidadInfo_(numero, targetYear, sheetData, sheetIdx) {
  const colabs = getColaboradoresFromSheet_();
  const c = colabs[numero];
  if (!c) return { error: 'Colaborador no encontrado', diasEntitled: 0 };
  if (!c.inicioLaboral) return { error: 'Falta Inicio_Laboral', diasEntitled: 0 };

  const inicioStr = c.inicioLaboral;
  const todayStr = formatDateStr(new Date());
  const [iy, im, id] = inicioStr.split('-').map(Number);
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const mmdd = pad(im) + '-' + pad(id);

  // Years completed at today
  let anosCurrent = ty - iy;
  if (tm < im || (tm === im && td < id)) anosCurrent--;
  if (anosCurrent < 0) anosCurrent = 0;

  // Calendar year of CURRENT anualidad start
  const currentAnualidadCalYear = anosCurrent < 1 ? null : (iy + anosCurrent);
  const proximaAnualidadDias = lftDaysForYear_(anosCurrent + 1);

  // Calendar year for the requested anualidad — defaults to current
  const anualidadCalYear = targetYear || currentAnualidadCalYear || iy + 1;
  const yos = anualidadCalYear - iy;  // year of service (1 = first full year, etc.)

  // Build window strings
  const anualidadInicioStr = anualidadCalYear + '-' + mmdd;
  const nextAnnivStr = (anualidadCalYear + 1) + '-' + mmdd;
  const anualidadFinStr = addDaysStr_(nextAnnivStr, -1);

  // Status relative to today
  let status;
  if (yos < 1) status = 'before-inicio';
  else if (todayStr < anualidadInicioStr) status = 'future';
  else if (todayStr > anualidadFinStr) status = 'closed';
  else status = 'current';

  const diasEntitled = yos < 1 ? 0 : lftDaysForYear_(yos);

  // Walk vacation rows for this colaborador. Count ONLY rows that belong to
  // the queried anualidad year (per Anualidad_Year column or date inference).
  // No mixing — the historial view shows a single year cleanly.
  const data = sheetData;
  const idx = sheetIdx;
  const anualidadYearCol = idx('Anualidad_Year');
  let usadosFromRows = 0, reservados = 0;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (String(row[idx('Tipo')]) !== 'Vacacion') continue;
    if (parseInt(row[idx('NumeroColab')]) !== numero) continue;
    const respuesta = String(row[idx('Respuesta')]);
    if (respuesta === 'Rechazado' || respuesta === 'Cancelado') continue;
    const dias = parseInt(row[idx('Dias_Vacacion')]) || 0;
    const startStr = formatDateStr(row[idx('Fecha_Permiso')]);
    const endStr   = formatDateStr(row[idx('Fecha_Fin')]) || startStr;
    if (!startStr) continue;

    let belongsToYear = null;
    if (anualidadYearCol >= 0) {
      const explicit = parseInt(row[anualidadYearCol]);
      if (explicit) belongsToYear = explicit;
    }
    if (!belongsToYear) {
      // Fallback: infer from start date relative to anniversary
      const sy = parseInt(startStr.slice(0, 4));
      const startMonth = parseInt(startStr.slice(5, 7));
      const startDay = parseInt(startStr.slice(8, 10));
      if (startMonth > im || (startMonth === im && startDay >= id)) belongsToYear = sy;
      else belongsToYear = sy - 1;
    }

    // Only count if this row is for the queried year
    if (belongsToYear !== anualidadCalYear) continue;

    if (endStr < todayStr) usadosFromRows += dias;
    else                    reservados += dias;
  }

  // Backfill: hardcoded map applies only to the CURRENT anualidad.
  // For future/closed years, no backfill (real vacation rows drive everything).
  const backfill = (status === 'current' && (anualidadCalYear === currentAnualidadCalYear))
    ? (parseFloat(VACACION_BACKFILL[numero]) || 0)
    : 0;
  const diasUsados = usadosFromRows + backfill;
  const disponibles = Math.max(0, diasEntitled - diasUsados - reservados);

  return {
    anualidadCalendarYear: anualidadCalYear,
    status,
    anualidadInicio: anualidadInicioStr,
    anualidadFin: anualidadFinStr,
    anosCompletos: yos,
    diasEntitled,
    diasUsados,
    diasUsadosBackfill: backfill,
    diasReservados: reservados,
    disponibles
  };
}

// ─── Vacation email ──────────────────────────────────────────────────────

function sendVacacionEmail_(toEmail, type, data) {
  if (!toEmail) return;
  const subjects = {
    submitted: 'Solicitud de vacaciones recibida',
    approved:  '✓ Tus vacaciones fueron aprobadas',
    rejected:  '✗ Tus vacaciones fueron rechazadas'
  };
  const subject = subjects[type] || 'Actualización de tus vacaciones';
  const fmtDate = (s) => {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : s;
  };
  const colorBar = type === 'approved' ? '#2e7d32' : type === 'rejected' ? '#c62828' : '#1565c0';
  const logoUrl = 'https://louieelizondo.github.io/nb-app/avocado-logo.png';
  let intro = '';
  if (type === 'submitted') intro = 'Recibimos tu solicitud de vacaciones. Pronto recibirás respuesta de Louie.';
  if (type === 'approved')  intro = '¡Tus vacaciones fueron aprobadas! Aquí están los detalles confirmados. Disfruta el descanso.';
  if (type === 'rejected')  intro = 'Tu solicitud de vacaciones fue rechazada.' + (data.notas ? ' Razón: ' + data.notas : '');

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
          <tr><td style="padding:7px 0;color:#998777;width:120px">Inicio</td><td><strong>${fmtDate(data.fechaInicio)}</strong></td></tr>
          <tr><td style="padding:7px 0;color:#998777">Fin</td><td><strong>${fmtDate(data.fechaFin)}</strong></td></tr>
          <tr><td style="padding:7px 0;color:#998777">Días</td><td>${data.dias}</td></tr>
          ${data.descripcion ? `<tr><td style="padding:7px 0;color:#998777;vertical-align:top">Descripción</td><td>${data.descripcion}</td></tr>` : ''}
        </table>
        <p style="margin:24px 0 0;font-size:11px;color:#bbb;border-top:1px solid #f0ebe4;padding-top:14px">Natural Balance Club · Sistema de Permisos &amp; Vacaciones<br>Ref: ${data.id || ''}</p>
      </div>
    </div>
  `;
  GmailApp.sendEmail(toEmail, subject, '', { htmlBody: html, name: 'NB Vacaciones' });
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
      tipo:              String(row[idx('Tipo')] || 'Permiso'),
      fechaSolicitud:    formatDateStr(row[idx('Fecha_Solicitud')]),
      numeroColab:       parseInt(row[idx('NumeroColab')]) || null,
      nombre:            String(row[idx('Nombre')] || ''),
      email:             String(row[idx('Email_Empleado')] || ''),
      fechaPermiso:      formatDateStr(row[idx('Fecha_Permiso')]),
      fechaFin:          formatDateStr(row[idx('Fecha_Fin')]) || formatDateStr(row[idx('Fecha_Permiso')]),
      diasVacacion:      parseInt(row[idx('Dias_Vacacion')]) || null,
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
  // Sort by fechaPermiso DESC (most recent / upcoming at top)
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

      // Best-effort decision email to employee — pick template by Tipo
      const empEmail = String(data[r][headers.indexOf('Email_Empleado')] || '');
      const tipo = String(data[r][headers.indexOf('Tipo')] || 'Permiso');
      if (empEmail) {
        try {
          if (tipo === 'Vacacion') {
            sendVacacionEmail_(empEmail, body.estado === 'Aprobado' ? 'approved' : 'rejected', {
              id: body.id,
              nombre: String(data[r][headers.indexOf('Nombre')] || ''),
              fechaInicio: formatDateStr(data[r][headers.indexOf('Fecha_Permiso')]),
              fechaFin: formatDateStr(data[r][headers.indexOf('Fecha_Fin')]),
              dias: parseInt(data[r][headers.indexOf('Dias_Vacacion')]) || 0,
              notas: body.notasAdmin || ''
            });
          } else {
            sendPermisoEmail_(empEmail, body.estado === 'Aprobado' ? 'approved' : 'rejected', {
              id: body.id,
              nombre: String(data[r][headers.indexOf('Nombre')] || ''),
              fechaPermiso: formatDateStr(data[r][headers.indexOf('Fecha_Permiso')]),
              horario: String(data[r][headers.indexOf('Horario_Ausente')] || ''),
              asunto: String(data[r][headers.indexOf('Asunto')] || ''),
              notas: body.notasAdmin || ''
            });
          }
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

// ─── Admin notification ─────────────────────────────────────────────────

const ADMIN_NOTIFY_EMAIL = 'le.nbclub@gmail.com';
const ADMIN_PERMISOS_URL = 'https://louieelizondo.github.io/nb-app/permisos-admin.html';

/**
 * Sends a notification to the admin (Louie) when a new permiso/vacación is
 * submitted. Includes the key info + a direct link to the admin queue.
 *
 * type: 'permiso' | 'vacacion'
 * data: same shape as employee email data, plus details specific to type
 */
function sendAdminSubmitNotification_(type, data) {
  const isVac = type === 'vacacion';
  const subject = isVac
    ? '🏖 Nueva solicitud de vacaciones — ' + (data.nombre || '')
    : '📝 Nuevo permiso pendiente — ' + (data.nombre || '');
  const fmtDate = (s) => {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : s;
  };
  const logoUrl = 'https://louieelizondo.github.io/nb-app/avocado-logo.png';
  const colorBar = isVac ? '#bf360c' : '#1565c0';

  const fields = isVac ? `
        <tr><td style="padding:7px 0;color:#998777;width:140px">Inicio</td><td><strong>${fmtDate(data.fechaInicio)}</strong></td></tr>
        <tr><td style="padding:7px 0;color:#998777">Fin</td><td><strong>${fmtDate(data.fechaFin)}</strong></td></tr>
        <tr><td style="padding:7px 0;color:#998777">Días</td><td>${data.dias || '—'}</td></tr>
  ` : `
        <tr><td style="padding:7px 0;color:#998777;width:140px">Fecha permiso</td><td><strong>${fmtDate(data.fechaPermiso)}</strong></td></tr>
        <tr><td style="padding:7px 0;color:#998777">Horario</td><td>${data.horario || '—'}</td></tr>
        <tr><td style="padding:7px 0;color:#998777">Asunto</td><td>${data.asunto || '—'}</td></tr>
        <tr><td style="padding:7px 0;color:#998777">Reponer</td><td>${data.reponer || '—'}</td></tr>
  `;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#2d2319">
      <div style="background:linear-gradient(135deg,#1a3a1a 0%,#2e6b2e 100%);color:white;padding:24px;border-radius:14px 14px 0 0;text-align:center">
        <img src="${logoUrl}" alt="Natural Balance" style="width:60px;height:60px;display:block;margin:0 auto 8px;background:rgba(255,255,255,.95);padding:5px;border-radius:12px">
        <h2 style="margin:0;font-size:17px;font-weight:700">${subject.replace(/^[🏖📝]\s/, '')}</h2>
      </div>
      <div style="background:white;padding:24px;border-left:4px solid ${colorBar};border-radius:0 0 14px 14px;box-shadow:0 4px 16px rgba(0,0,0,.05)">
        <p style="margin:0 0 14px;font-size:14px"><strong>${data.nombre || ''}</strong> envió una nueva ${isVac ? 'solicitud de vacaciones' : 'solicitud de permiso'}.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
          ${fields}
          ${data.descripcion ? `<tr><td style="padding:7px 0;color:#998777;vertical-align:top">Descripción</td><td>${data.descripcion}</td></tr>` : ''}
        </table>
        <div style="text-align:center;margin-top:20px">
          <a href="${ADMIN_PERMISOS_URL}" style="display:inline-block;padding:12px 24px;background:#2e6b2e;color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px">→ Revisar y aprobar</a>
        </div>
        <p style="margin:18px 0 0;font-size:11px;color:#bbb;border-top:1px solid #f0ebe4;padding-top:12px">Ref: ${data.id || ''}</p>
      </div>
    </div>
  `;
  GmailApp.sendEmail(ADMIN_NOTIFY_EMAIL, subject, '', { htmlBody: html, name: 'NB Permisos' });
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
    // Engine permiso pipeline only handles Tipo=Permiso (or unset, for legacy rows).
    // Vacaciones are processed separately via getApprovedVacacionesFromSheet_.
    const tipo = String(row[idx('Tipo')] || 'Permiso');
    if (tipo !== 'Permiso') continue;
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

/**
 * Returns approved vacation rows expanded to per-day records:
 *   [{ id, numeroColab, nombre, fecha }, ...]
 * Used by the engine to suppress falta detection on vacation days.
 */
function getApprovedVacacionDaysFromSheet_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('asistencia_vacacion_days_v1');
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }

  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);

  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (String(row[idx('Tipo')]) !== 'Vacacion') continue;
    if (String(row[idx('Respuesta')]) !== 'Aprobado') continue;
    const id = String(row[idx('ID')]);
    const numero = parseInt(row[idx('NumeroColab')]);
    const nombre = String(row[idx('Nombre')] || '');
    const ini = formatDateStr(row[idx('Fecha_Permiso')]);
    const fin = formatDateStr(row[idx('Fecha_Fin')]) || ini;
    if (!ini) continue;
    // Expand range to per-day records (skip Sundays — NB closes)
    const cur = new Date(ini + 'T00:00:00');
    const end = new Date(fin + 'T00:00:00');
    while (cur <= end) {
      if (cur.getDay() !== 0) {
        out.push({ id, numeroColab: numero, nombre, fecha: formatDateStr(cur) });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  cache.put('asistencia_vacacion_days_v1', JSON.stringify(out), 300);
  return out;
}

// ─── One-time fix: V2 → V3 column layout ─────────────────────────────────

/**
 * V2 schema (22 cols) had no Tipo / Fecha_Fin / Dias_Vacacion. V3 inserted
 * them at positions 2, 8, 9. Old NOT* migrated rows store data in V2
 * positions, so reading them with the V3 header gives shifted values
 * (Tipo column shows Fecha_Solicitud, Nombre column shows Email, etc).
 *
 * This rebuilds each NOT* row by taking the V2 layout values and placing
 * them in the correct V3 positions. Idempotent — detects already-fixed
 * rows by checking if the Tipo cell == 'Permiso'.
 *
 * Run once from the editor:  fixV2ToV3Permisos()
 */
function fixV2ToV3Permisos() {
  const sheet = getOrCreateTab(PERMISOS_TAB, PERMISOS_HEADERS);
  const lastCol = PERMISOS_HEADERS.length;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, fixed: 0 };
  const headers = data[0];
  const idCol = headers.indexOf('ID');
  const tipoCol = headers.indexOf('Tipo');

  const v2Order = [
    'ID','Fecha_Solicitud','NumeroColab','Nombre','Email_Empleado',
    'Fecha_Permiso','Horario_Ausente','Horas_Ausente','Asunto','Descripcion',
    'Reponer','Como_Reponer','Fecha_Final_Pagado','Comprobante_URL','Respuesta',
    'Aprobado_Por','Fecha_Decision','Notas_Admin',
    'Real_Ausente_Min','Repose_Status','Repose_Detail','Computed_At'
  ];

  let fixed = 0, skipped = 0;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const id = String(row[idCol] || '');
    // V2 layout can occur on NOT* (migrated from Notion) AND PRM* (form
    // submissions made before the V3 schema landed). SEED* + VAC* were
    // always created under V3 and use buildPermisoRow_, so they're safe.
    if (!id.startsWith('NOT') && !id.startsWith('PRM')) continue;

    // If Tipo is already 'Permiso' or 'Vacacion', the row is V3-aligned. Skip.
    const currentTipo = String(row[tipoCol] || '').trim();
    if (currentTipo === 'Permiso' || currentTipo === 'Vacacion') {
      skipped++;
      continue;
    }

    // Read row's V2 values from positions 0..21 (matches v2Order)
    const v2vals = {};
    for (let i = 0; i < v2Order.length; i++) {
      v2vals[v2Order[i]] = row[i];
    }

    // Build a V3 row with values placed correctly
    const fechaPermiso = v2vals['Fecha_Permiso'];
    const newRow = buildPermisoRow_({
      ID: v2vals['ID'],
      Tipo: 'Permiso',
      Fecha_Solicitud: v2vals['Fecha_Solicitud'],
      NumeroColab: v2vals['NumeroColab'],
      Nombre: v2vals['Nombre'],
      Email_Empleado: v2vals['Email_Empleado'],
      Fecha_Permiso: fechaPermiso,
      Fecha_Fin: fechaPermiso,            // permisos: same day
      Dias_Vacacion: '',
      Horario_Ausente: v2vals['Horario_Ausente'],
      Horas_Ausente: v2vals['Horas_Ausente'],
      Asunto: v2vals['Asunto'],
      Descripcion: v2vals['Descripcion'],
      Reponer: v2vals['Reponer'],
      Como_Reponer: v2vals['Como_Reponer'],
      Fecha_Final_Pagado: v2vals['Fecha_Final_Pagado'],
      Comprobante_URL: v2vals['Comprobante_URL'],
      Respuesta: v2vals['Respuesta'],
      Aprobado_Por: v2vals['Aprobado_Por'],
      Fecha_Decision: v2vals['Fecha_Decision'],
      Notas_Admin: v2vals['Notas_Admin'],
      Real_Ausente_Min: v2vals['Real_Ausente_Min'],
      Repose_Status: v2vals['Repose_Status'],
      Repose_Detail: v2vals['Repose_Detail'],
      Computed_At: v2vals['Computed_At']
    });

    sheet.getRange(r + 1, 1, 1, lastCol).setValues([newRow]);
    fixed++;
  }
  CacheService.getScriptCache().remove(PERMISOS_CACHE_KEY_SHEET);
  Logger.log('fixV2ToV3Permisos: fixed=' + fixed + ', skipped=' + skipped);
  return { ok: true, fixed, skipped };
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
