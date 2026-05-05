/**
 * Asistencia Engine — Single source of truth for empleado attendance.
 *
 * Architecture:
 *   xlsx (reloj checador)
 *     ↓ browser parses with SheetJS, sends 2D array as JSON
 *   ASISTENCIA_RAW           (1 row per empleado × día — source of truth)
 *     ↓ recomputed on each upload
 *   ASISTENCIA_SEMANAL       (1 row per empleado × semana — aggregated, ready to consume)
 *
 * Consumers (all read from ASISTENCIA_SEMANAL):
 *   - Reporte Semanal de Asistencia UI (replaces Notion's Reporte de Nómina semanal)
 *   - Bono Productividad — sums faltas/retardos for any 14-day period
 *   - Bono Asistencia Mensual — sums for the month
 *
 * Author: Claude + Louie · 2026-05-04
 */

// ─── Constants ────────────────────────────────────────────────────────────
const ASISTENCIA_RAW_TAB = 'ASISTENCIA_RAW';
const ASISTENCIA_RAW_HEADERS = [
  'ID',                         // {numero}_{YYYY-MM-DD}
  'NumeroColab',
  'Nombre',
  'Fecha',                      // YYYY-MM-DD
  'DiaSemana',                  // Lun/Mar/Mié/Jue/Vie/Sáb/Dom
  'IsDescanso',
  'IsFalta',
  'RetEntrada_min',             // raw minutes from checador
  'SalComerAntes_min',
  'RetComida_min',
  'SalAntes_min',
  'Laborado_min',
  'ALaborar_min',
  'Saldo_min',                  // can be negative
  'UploadedAt',
  'SourceFile'
];

const ASISTENCIA_SEMANAL_TAB = 'ASISTENCIA_SEMANAL';
const ASISTENCIA_SEMANAL_HEADERS = [
  'ID',                         // {numero}_{YYYY-MM-DD-startVie}
  'NumeroColab',
  'Nombre',
  'SemanaInicio',               // Vie YYYY-MM-DD
  'SemanaFin',                  // Jue YYYY-MM-DD
  'DiasTrabajados',
  'DiasDescanso',
  'FaltasRaw',                  // count of FALTA days from checador
  'FaltasReal',                 // after classification (manual override)
  'FaltasJustificadas',         // with comprobante
  'FaltasInjustificadas',
  'FaltasPermisoCubierto',      // covered by approved permiso → not counted
  'Retardos',                   // NB rules: >4m entrada + >3m comida (after skip flags)
  'RetardosDetalle',            // text "Vie entrada 7m · Sáb comida 5m..."
  'HorasNoTrabajadas',          // for accountant
  'Puntualidad',
  'Asistencia',
  'Ajustes',                    // text — manual notes
  'Locked',                     // 🔒 No sincronizar override
  'LastComputedAt',
  'SourceFile'
];

// NB attendance rules (mirror of asistencia/scripts/config.py)
const NB_ENTRADA_RETARDO_MIN = 4;       // Entrada > 4 min late = retardo
const NB_COMIDA_RETARDO_MIN = 3;        // Regreso comida > 3 min late = retardo

// Per-employee rule overrides
const EMPLEADO_RULES = {
  // Louicarlo: 9am-5pm L-V con 30min comida adentro (7.5 hrs efectivos). No trabaja Sábado.
  // Retardos perdonados (trusted, trabaja también desde casa).
  48: {
    skipEntradaRetardos: true,
    skipComidaRetardos: true,
    expectedDaysPerWeek: 5,
    hoursPerDay: 7.5,
    workDays: ['Lun','Mar','Mié','Jue','Vie']  // Sat/Sun = descanso, never falta
  },
  // Enrique — Granja. No usa checador. Inject default-perfect (6 días Mon-Sat).
  // Louie override en UI si hay algo que reportar.
  65: {
    noChecador: true,
    expectedDaysPerWeek: 6,
    hoursPerDay: 7.5,         // 8-4 con 30min comida adentro
    workDays: ['Lun','Mar','Mié','Jue','Vie','Sáb'],
    nombre: 'Enrique'         // TODO: completa con apellido
  }
};
const DEFAULT_HOURS_PER_DAY = 8;

const DIAS_SP = { 0: 'Lun', 1: 'Mar', 2: 'Mié', 3: 'Jue', 4: 'Vie', 5: 'Sáb', 6: 'Dom' };


// ─── PARSE: 2D array (from xlsx) → per-day records ─────────────────────────

/**
 * Receives the raw 2D array from a parsed xlsx (checador "Asistencia y puntualidad" sheet)
 * and returns a list of per-day records ready to write into ASISTENCIA_RAW.
 *
 * Format expected:
 *   Rows 1-4: metadata (title, Desde date, Hasta date, label row)
 *   Row 5: column headers
 *   Rows 6+: data — daily rows + 1 summary row per employee (Fecha blank in summary)
 *
 * Cells:
 *   Col A: Número  | Col B: Nombre | Col C: Fecha
 *   Col D: Tiempo retardo (entrada)
 *   Col E: T. salida a comer antes
 *   Col F: Tiempo retardo comida
 *   Col G: Tiempo salida antes
 *   Col H: Tiempo laborado
 *   Col I: Tiempo a laborar
 *   Col J: Saldo de tiempo
 *   Col K: Faltas (summary only)
 *   Col L: Retardos (summary only)
 *   Col M: Salidas antes (summary only)
 *
 * Special values:
 *   "DESCANSO" — rest day
 *   "FALTA" — full-day absence
 *   timedelta string "0:07:00" or "7m00s" or duration object — varies by xlsx serialization
 *   negative saldo "- 0:37" or timedelta
 */
function parseAsistenciaXlsx(rows2D) {
  if (!rows2D || rows2D.length < 6) {
    throw new Error('xlsx vacío o formato no esperado');
  }

  const records = [];
  let currentNumero = null;
  let currentNombre = null;

  // Skip header (rows 1-5), iterate from row 6 (index 5)
  for (let i = 5; i < rows2D.length; i++) {
    const row = rows2D[i];
    if (!row || !row.length) continue;
    const numero = row[0];
    const nombre = row[1];
    const fechaCell = row[2];

    if (numero == null || numero === '') continue;

    // New employee block: track current
    if (numero !== currentNumero) {
      currentNumero = numero;
      currentNombre = String(nombre || '').trim();
    }

    // Skip summary row (Fecha is blank/null)
    if (fechaCell == null || fechaCell === '') continue;

    const fecha = parseFechaCell_(fechaCell);
    if (!fecha) continue;

    const isDescanso = isDescansoCell_(row);
    const isFalta = isFaltaCell_(row);

    records.push({
      numero: parseInt(numero),
      nombre: currentNombre,
      fecha: fecha,
      diaSemana: DIAS_SP[dayOfWeek_(fecha)],
      isDescanso: isDescanso,
      isFalta: isFalta,
      retEntrada_min: isDescanso || isFalta ? 0 : parseDurationToMinutes_(row[3]),
      salComerAntes_min: isDescanso || isFalta ? 0 : parseDurationToMinutes_(row[4]),
      retComida_min: isDescanso || isFalta ? 0 : parseDurationToMinutes_(row[5]),
      salAntes_min: isDescanso || isFalta ? 0 : parseDurationToMinutes_(row[6]),
      laborado_min: isDescanso || isFalta ? 0 : parseDurationToMinutes_(row[7]),
      aLaborar_min: parseDurationToMinutes_(row[8]),
      saldo_min: parseSaldoToMinutes_(row[9])
    });
  }
  return records;
}

function parseFechaCell_(cell) {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  // String "YYYY-MM-DD" or similar
  const s = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try parse as date
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return null;
}

function isDescansoCell_(row) {
  // DESCANSO appears in all data cells (cols 3-9). Check col 3 or col 7.
  for (let c = 3; c <= 9; c++) {
    if (typeof row[c] === 'string' && row[c].trim() === 'DESCANSO') return true;
  }
  return false;
}

function isFaltaCell_(row) {
  for (let c = 3; c <= 9; c++) {
    if (typeof row[c] === 'string' && row[c].trim() === 'FALTA') return true;
  }
  return false;
}

/**
 * Parse a duration cell (could be Date object, timedelta-like string, number of seconds, or null)
 * to minutes (integer). Returns 0 for invalid/empty/DESCANSO/FALTA.
 */
function parseDurationToMinutes_(cell) {
  if (cell == null || cell === '') return 0;
  if (typeof cell === 'string') {
    const s = cell.trim();
    if (s === 'DESCANSO' || s === 'FALTA' || s === '') return 0;
    // Format "H:MM:SS" or "M:SS"
    if (/^\d+:\d{2}(:\d{2})?$/.test(s)) {
      const parts = s.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
      if (parts.length === 2) return parts[0] * 60 + parts[1]; // assume H:MM
    }
    // Fall-through: try Number
    const n = parseFloat(s);
    if (!isNaN(n)) return Math.round(n);
    return 0;
  }
  if (cell instanceof Date) {
    // Excel stores duration as a Date with offset from epoch. Get hours+minutes.
    // Common: cell is Date(1899,11,30,h,m,s) — duration in time-of-day part.
    return cell.getHours() * 60 + cell.getMinutes() + Math.round(cell.getSeconds() / 60);
  }
  if (typeof cell === 'number') {
    // Could be Excel serial fraction-of-day (e.g. 0.005 = ~7 min)
    if (cell < 1) return Math.round(cell * 24 * 60);
    return Math.round(cell);
  }
  return 0;
}

/** Saldo can be negative. Returns minutes (signed). */
function parseSaldoToMinutes_(cell) {
  if (cell == null || cell === '') return 0;
  if (typeof cell === 'string') {
    const s = cell.trim();
    if (s === 'DESCANSO' || s === 'FALTA' || s === '') return 0;
    // "- 0:37" or "0:37"
    let negative = false;
    let str = s;
    if (str.startsWith('-')) { negative = true; str = str.substring(1).trim(); }
    if (/^\d+:\d{2}/.test(str)) {
      const parts = str.split(':').map(Number);
      const mins = parts[0] * 60 + (parts[1] || 0);
      return negative ? -mins : mins;
    }
    return 0;
  }
  return parseDurationToMinutes_(cell);
}

function dayOfWeek_(yyyymmdd) {
  // 0=Mon..6=Sun (matches Python convention)
  const d = new Date(yyyymmdd + 'T00:00:00');
  const js = d.getDay(); // 0=Sun..6=Sat
  return js === 0 ? 6 : js - 1;
}


// ─── WRITE: records → ASISTENCIA_RAW (upsert by ID) ────────────────────────

/**
 * Saves parsed records to ASISTENCIA_RAW. Upserts by ID = "{numero}_{fecha}".
 * Returns counts.
 */
function saveAsistenciaRaw(records, sourceFile) {
  if (!records || !records.length) return { ok: true, inserted: 0, updated: 0 };
  const sheet = getOrCreateTab(ASISTENCIA_RAW_TAB, ASISTENCIA_RAW_HEADERS);

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('ID');

  // Build existing-row map
  const existingMap = {};
  for (let r = 1; r < data.length; r++) {
    existingMap[String(data[r][idIdx])] = r + 1;  // 1-indexed
  }

  const now = new Date();
  const nowIso = now.toISOString();
  let inserted = 0, updated = 0;

  records.forEach(rec => {
    const id = rec.numero + '_' + rec.fecha;
    const rowDict = {
      'ID': id,
      'NumeroColab': rec.numero,
      'Nombre': rec.nombre,
      'Fecha': rec.fecha,
      'DiaSemana': rec.diaSemana,
      'IsDescanso': rec.isDescanso,
      'IsFalta': rec.isFalta,
      'RetEntrada_min': rec.retEntrada_min,
      'SalComerAntes_min': rec.salComerAntes_min,
      'RetComida_min': rec.retComida_min,
      'SalAntes_min': rec.salAntes_min,
      'Laborado_min': rec.laborado_min,
      'ALaborar_min': rec.aLaborar_min,
      'Saldo_min': rec.saldo_min,
      'UploadedAt': nowIso,
      'SourceFile': sourceFile || ''
    };
    const rowArr = ASISTENCIA_RAW_HEADERS.map(h => rowDict[h] != null ? rowDict[h] : '');

    if (existingMap[id]) {
      sheet.getRange(existingMap[id], 1, 1, rowArr.length).setValues([rowArr]);
      updated++;
    } else {
      sheet.appendRow(rowArr);
      inserted++;
    }
  });
  SpreadsheetApp.flush();
  return { ok: true, inserted: inserted, updated: updated, total: records.length };
}


// ─── COMPUTE: ASISTENCIA_RAW → ASISTENCIA_SEMANAL ──────────────────────────

/**
 * Computes weekly aggregates for the period [weekStart..weekEnd] (Vie..Jue).
 * Reads RAW, applies NB rules, upserts to SEMANAL.
 *
 * Preserves manually-set fields if SEMANAL row is locked OR has manual classification.
 */
function recomputeSemanal(weekStart, weekEnd, sourceFile) {
  if (!weekStart || !weekEnd) throw new Error('weekStart y weekEnd requeridos (YYYY-MM-DD)');

  // Read RAW for the period
  const rawRows = sheetToObjects(ASISTENCIA_RAW_TAB, ASISTENCIA_RAW_HEADERS);
  const inPeriod = rawRows.filter(r => {
    const f = formatDateStr(r.Fecha);
    return f >= weekStart && f <= weekEnd;
  });
  if (!inPeriod.length) return { ok: true, computed: 0, message: 'Sin datos en RAW para el período' };

  // Group by NORMALIZED NAME (not numero) — handles cases where checador and
  // Notion have different numeros for the same person (Andrea: checador #65,
  // Notion #64). Whichever numero shows up first in the RAW rows wins as canonical.
  const byEmpleado = {};
  inPeriod.forEach(r => {
    const key = String(r.Nombre || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (!key) return;
    if (!byEmpleado[key]) {
      byEmpleado[key] = { numero: parseInt(r.NumeroColab), nombre: r.Nombre, days: [] };
    }
    byEmpleado[key].days.push(r);
  });

  // Read existing SEMANAL rows for the period to preserve locks/manual edits
  const semanalSheet = getOrCreateTab(ASISTENCIA_SEMANAL_TAB, ASISTENCIA_SEMANAL_HEADERS);
  const semData = semanalSheet.getDataRange().getValues();
  const semHeaders = semData[0];
  const sIdIdx = semHeaders.indexOf('ID');

  const existingSem = {};
  for (let r = 1; r < semData.length; r++) {
    const id = String(semData[r][sIdIdx]);
    if (id.endsWith('_' + weekStart)) {
      const obj = {};
      semHeaders.forEach((h, i) => { obj[h] = semData[r][i]; });
      obj._row = r + 1;
      existingSem[id] = obj;
    }
  }

  const now = new Date().toISOString();
  let computedCount = 0;

  Object.keys(byEmpleado).forEach(numStr => {
    const emp = byEmpleado[numStr];
    const id = emp.numero + '_' + weekStart;
    const existing = existingSem[id] || {};

    // If row is locked, skip the recompute (preserve manual values)
    if (existing.Locked === true || existing.Locked === '__YES__') {
      // Still update DiasTrabajados (factual) if it changed
      const aggLocked = aggregateEmpDays_(emp.days, emp.numero);
      if (existing.DiasTrabajados !== aggLocked.diasTrabajados) {
        const rowNum = existing._row;
        const colDT = semHeaders.indexOf('DiasTrabajados') + 1;
        semanalSheet.getRange(rowNum, colDT).setValue(aggLocked.diasTrabajados);
      }
      return;
    }

    const agg = aggregateEmpDays_(emp.days, emp.numero);

    // Build SEMANAL row
    const rowDict = {
      'ID': id,
      'NumeroColab': emp.numero,
      'Nombre': emp.nombre,
      'SemanaInicio': weekStart,
      'SemanaFin': weekEnd,
      'DiasTrabajados': agg.diasTrabajados,
      'DiasDescanso': agg.diasDescanso,
      'FaltasRaw': agg.faltasRaw,
      'FaltasReal': existing.FaltasReal != null && existing.FaltasReal !== ''
        ? existing.FaltasReal
        : agg.faltasRaw,
      'FaltasJustificadas': existing.FaltasJustificadas || 0,
      'FaltasInjustificadas': existing.FaltasInjustificadas != null && existing.FaltasInjustificadas !== ''
        ? existing.FaltasInjustificadas
        : agg.faltasRaw,
      'FaltasPermisoCubierto': existing.FaltasPermisoCubierto || 0,
      'Retardos': agg.retardos,
      'RetardosDetalle': agg.retardosDetalle,
      'HorasNoTrabajadas': existing.HorasNoTrabajadas != null && existing.HorasNoTrabajadas !== ''
        ? existing.HorasNoTrabajadas
        : agg.horasNoTrabajadas,
      'Puntualidad': agg.retardos <= 1 && agg.faltasRaw === 0,
      'Asistencia': agg.faltasRaw === 0,
      'Ajustes': existing.Ajustes || '',  // libre — manual notes only, no auto-fill
      'Locked': existing.Locked === true || existing.Locked === '__YES__' ? true : false,
      'LastComputedAt': now,
      'SourceFile': sourceFile || existing.SourceFile || ''
    };
    const rowArr = ASISTENCIA_SEMANAL_HEADERS.map(h => rowDict[h] != null ? rowDict[h] : '');

    if (existing._row) {
      semanalSheet.getRange(existing._row, 1, 1, rowArr.length).setValues([rowArr]);
    } else {
      semanalSheet.appendRow(rowArr);
    }
    computedCount++;
  });

  // ── Inject noChecador employees (e.g. Enrique en Granja) ─────────────────
  // They never appear in the xlsx, so we add a default-perfect row and let
  // Louie override via Faltas Reales / Ajustes if something happened that week.
  Object.keys(EMPLEADO_RULES).forEach(numStr => {
    const rules = EMPLEADO_RULES[numStr];
    if (!rules.noChecador) return;
    const numero = parseInt(numStr);
    const id = numero + '_' + weekStart;
    if (existingSem[id]) return;  // already present (was injected on a prior run, manual edits live there)

    const expectedDays = rules.expectedDaysPerWeek || 6;
    const rowDict = {
      'ID': id,
      'NumeroColab': numero,
      'Nombre': rules.nombre || ('Empleado #' + numero),
      'SemanaInicio': weekStart,
      'SemanaFin': weekEnd,
      'DiasTrabajados': expectedDays,
      'DiasDescanso': 7 - expectedDays,
      'FaltasRaw': 0,
      'FaltasReal': 0,
      'FaltasJustificadas': 0,
      'FaltasInjustificadas': 0,
      'FaltasPermisoCubierto': 0,
      'Retardos': 0,
      'RetardosDetalle': '',
      'HorasNoTrabajadas': 0,
      'Puntualidad': true,
      'Asistencia': true,
      'Ajustes': '(sin checador — Granja)',
      'Locked': false,
      'LastComputedAt': now,
      'SourceFile': sourceFile || ''
    };
    const rowArr = ASISTENCIA_SEMANAL_HEADERS.map(h => rowDict[h] != null ? rowDict[h] : '');
    semanalSheet.appendRow(rowArr);
    computedCount++;
  });

  SpreadsheetApp.flush();
  return { ok: true, computed: computedCount, weekStart: weekStart, weekEnd: weekEnd };
}

/**
 * Aggregate one employee's days for a week. Applies NB rules + per-employee overrides.
 */
function aggregateEmpDays_(days, numero) {
  const rules = EMPLEADO_RULES[numero] || {};
  const skipEntrada = rules.skipEntradaRetardos === true;
  const skipComida = rules.skipComidaRetardos === true;
  const workDays = Array.isArray(rules.workDays) ? rules.workDays : null;

  let diasTrabajados = 0;
  let diasDescanso = 0;
  let faltasRaw = 0;
  const retardos = [];

  days.forEach(d => {
    // For employees with fixed schedules (e.g. Louicarlo M-V), force non-workdays
    // to count as descanso regardless of what the checador shows. Prevents Saturday
    // from being a phantom falta.
    if (workDays && workDays.indexOf(d.DiaSemana) === -1) {
      diasDescanso++;
      return;
    }
    if (d.IsDescanso === true || d.IsDescanso === 'TRUE') {
      diasDescanso++;
      return;
    }
    if (d.IsFalta === true || d.IsFalta === 'TRUE') {
      faltasRaw++;
      return;
    }
    diasTrabajados++;

    if (!skipEntrada) {
      const entMin = parseInt(d.RetEntrada_min) || 0;
      if (entMin > NB_ENTRADA_RETARDO_MIN) {
        retardos.push({ kind: 'entrada', min: entMin, fecha: formatDateStr(d.Fecha), dia: d.DiaSemana });
      }
    }
    if (!skipComida) {
      const comMin = parseInt(d.RetComida_min) || 0;
      if (comMin > NB_COMIDA_RETARDO_MIN) {
        retardos.push({ kind: 'comida', min: comMin, fecha: formatDateStr(d.Fecha), dia: d.DiaSemana });
      }
    }
  });

  const retardosDetalle = retardos.length
    ? 'Retardos (' + retardos.length + '): ' + retardos.map(r => r.dia + ' ' + (r.kind === 'entrada' ? 'entrada' : 'regreso comida') + ' ' + r.min + 'm').join(' · ')
    : '';

  // Hours per falta day for accountant deduction (per-employee, default 8)
  const hoursPerDay = (rules.hoursPerDay) || DEFAULT_HOURS_PER_DAY;
  const horasNoTrabajadas = faltasRaw * hoursPerDay;

  return {
    diasTrabajados: diasTrabajados,
    diasDescanso: diasDescanso,
    faltasRaw: faltasRaw,
    retardos: retardos.length,
    retardosDetalle: retardosDetalle,
    horasNoTrabajadas: horasNoTrabajadas
  };
}


// ─── READ: query SEMANAL for any range ─────────────────────────────────────

/**
 * Returns aggregated faltas/retardos per colaborador for the given period.
 * Sums across overlapping SEMANAL rows.
 *
 * Used by Bono Productividad (14-day periods) and Bono Asistencia Mensual.
 *
 * Returns: { 'NombreNormalizado': { faltas, retardos, ... }, ... }
 * Also returns: { byNumero: { 1: {...}, 5: {...}, ... } }
 */
function getAsistenciaForPeriod(periodStart, periodEnd) {
  const rows = sheetToObjects(ASISTENCIA_SEMANAL_TAB, ASISTENCIA_SEMANAL_HEADERS);
  const byNombre = {};
  const byNumero = {};

  rows.forEach(r => {
    const semIni = formatDateStr(r.SemanaInicio);
    const semFin = formatDateStr(r.SemanaFin);
    // Include if the week overlaps with the period
    if (semFin < periodStart || semIni > periodEnd) return;

    const nombre = String(r.Nombre || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const num = parseInt(r.NumeroColab);
    const entry = {
      faltas: parseInt(r.FaltasReal) || 0,
      faltasJustificadas: parseInt(r.FaltasJustificadas) || 0,
      faltasInjustificadas: parseInt(r.FaltasInjustificadas) || 0,
      retardos: parseInt(r.Retardos) || 0,
      diasTrabajados: parseInt(r.DiasTrabajados) || 0,
      horasNoTrabajadas: parseFloat(r.HorasNoTrabajadas) || 0
    };
    if (!byNombre[nombre]) byNombre[nombre] = { faltas: 0, faltasJustificadas: 0, faltasInjustificadas: 0, retardos: 0, diasTrabajados: 0, horasNoTrabajadas: 0 };
    if (!byNumero[num])   byNumero[num]   = { faltas: 0, faltasJustificadas: 0, faltasInjustificadas: 0, retardos: 0, diasTrabajados: 0, horasNoTrabajadas: 0 };
    Object.keys(entry).forEach(k => {
      byNombre[nombre][k] = (byNombre[nombre][k] || 0) + entry[k];
      byNumero[num][k]   = (byNumero[num][k] || 0) + entry[k];
    });
  });
  return { byNombre: byNombre, byNumero: byNumero };
}


// ─── HIGH-LEVEL: parse + save + recompute (one call from frontend) ─────────

/**
 * Frontend sends the parsed xlsx as 2D array. Backend parses, writes to RAW,
 * recomputes affected weeks in SEMANAL.
 *
 * Body: { rows2D: [[...], [...]], weekStart?: 'YYYY-MM-DD', weekEnd?: 'YYYY-MM-DD', sourceFile?: string }
 *
 * If weekStart/weekEnd provided → recompute that week only (semanal upload).
 * Otherwise → derive all unique weeks from records and recompute each (mensual upload).
 */
function uploadAsistencia(body) {
  const rows2D = body.rows2D || body.rows || [];
  const sourceFile = body.sourceFile || 'unknown.xlsx';
  if (!rows2D.length) throw new Error('rows2D vacío');

  const records = parseAsistenciaXlsx(rows2D);
  const saveResult = saveAsistenciaRaw(records, sourceFile);

  // Always derive ALL Vie-Jue weeks present in the records.
  // Works for weekly (Fri-Wed/Thu), biweekly, or monthly xlsx uploads — auto-detects.
  const fechaSet = {};
  records.forEach(r => { fechaSet[r.fecha] = true; });
  const fechas = Object.keys(fechaSet).sort();
  const seenWeeks = {};
  fechas.forEach(f => {
    const w = vieJueWeek_(f);
    seenWeeks[w.start + '|' + w.end] = w;
  });
  const weeks = Object.values(seenWeeks);

  const recomputeResults = weeks.map(w => recomputeSemanal(w.start, w.end, sourceFile));
  return {
    ok: true,
    saveRaw: saveResult,
    weeksComputed: recomputeResults,
    records: records.length,
    weeksFound: weeks.length
  };
}

/** Returns the Vie-Jue week containing the given date (YYYY-MM-DD). */
function vieJueWeek_(yyyymmdd) {
  const d = new Date(yyyymmdd + 'T00:00:00');
  const js = d.getDay(); // 0=Sun..6=Sat
  // Vie = 5. Find offset back to last Vie.
  const offset = js >= 5 ? js - 5 : js + 2;
  const friday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  const thursday = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 6);
  return {
    start: Utilities.formatDate(friday, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    end: Utilities.formatDate(thursday, Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
}


// ─── PUBLIC API: read SEMANAL for the UI ───────────────────────────────────

/** Returns all SEMANAL rows for a given week (Vie-Jue). */
function getSemanaDetalle(params) {
  const start = params.weekStart || params.start;
  const end = params.weekEnd || params.end;
  if (!start || !end) throw new Error('weekStart y weekEnd requeridos');
  const rows = sheetToObjects(ASISTENCIA_SEMANAL_TAB, ASISTENCIA_SEMANAL_HEADERS);
  const filtered = rows.filter(r => formatDateStr(r.SemanaInicio) === start && formatDateStr(r.SemanaFin) === end);
  filtered.sort((a, b) => (parseInt(a.NumeroColab) || 0) - (parseInt(b.NumeroColab) || 0));
  return { ok: true, weekStart: start, weekEnd: end, rows: filtered };
}

/**
 * Cleanup helper — corre una vez desde Apps Script editor cuando hay duplicados.
 *
 * Para cada (nombre + fecha) que aparece bajo múltiples NumeroColab en ASISTENCIA_RAW,
 * conserva una sola fila (la del numero más bajo, asumiendo que es el canónico actual).
 * Borra las demás. También consolida ASISTENCIA_SEMANAL.
 *
 * Caso conocido: Andrea Sánchez aparece como #65 en checador pero #64 en Notion.
 */
function cleanupAsistenciaRawDuplicateNames() {
  const rawSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ASISTENCIA_RAW_TAB);
  if (!rawSheet || rawSheet.getLastRow() < 2) return { ok: true, removed: 0 };

  const data = rawSheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('ID');
  const numIdx = headers.indexOf('NumeroColab');
  const nomIdx = headers.indexOf('Nombre');
  const fecIdx = headers.indexOf('Fecha');

  const byKey = {};  // 'NOMBRE|FECHA' → array of { rowNum, numero }
  for (let r = 1; r < data.length; r++) {
    const nombre = String(data[r][nomIdx] || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const fecha = formatDateStr(data[r][fecIdx]);
    if (!nombre || !fecha) continue;
    const key = nombre + '|' + fecha;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ rowNum: r + 1, numero: parseInt(data[r][numIdx]) });
  }

  const toDelete = [];
  Object.values(byKey).forEach(group => {
    if (group.length <= 1) return;
    // Sort by numero ascending — keep the lowest, delete the rest
    group.sort((a, b) => a.numero - b.numero);
    for (let i = 1; i < group.length; i++) toDelete.push(group[i].rowNum);
  });

  // Delete from bottom up to keep indices stable
  toDelete.sort((a, b) => b - a).forEach(r => rawSheet.deleteRow(r));

  // Same cleanup on SEMANAL
  const semSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ASISTENCIA_SEMANAL_TAB);
  let semRemoved = 0;
  if (semSheet && semSheet.getLastRow() >= 2) {
    const sd = semSheet.getDataRange().getValues();
    const sh = sd[0];
    const sNumIdx = sh.indexOf('NumeroColab');
    const sNomIdx = sh.indexOf('Nombre');
    const sIniIdx = sh.indexOf('SemanaInicio');
    const sBy = {};
    for (let r = 1; r < sd.length; r++) {
      const nombre = String(sd[r][sNomIdx] || '').toUpperCase().replace(/\s+/g, ' ').trim();
      const ini = formatDateStr(sd[r][sIniIdx]);
      const key = nombre + '|' + ini;
      if (!nombre || !ini) continue;
      if (!sBy[key]) sBy[key] = [];
      sBy[key].push({ rowNum: r + 1, numero: parseInt(sd[r][sNumIdx]) });
    }
    const semToDelete = [];
    Object.values(sBy).forEach(group => {
      if (group.length <= 1) return;
      group.sort((a, b) => a.numero - b.numero);
      for (let i = 1; i < group.length; i++) semToDelete.push(group[i].rowNum);
    });
    semToDelete.sort((a, b) => b - a).forEach(r => semSheet.deleteRow(r));
    semRemoved = semToDelete.length;
  }

  SpreadsheetApp.flush();
  return { ok: true, rawRemoved: toDelete.length, semRemoved: semRemoved };
}


/**
 * Cleanup helper — limpia el campo Ajustes en SEMANAL para todas las filas que
 * tengan texto auto-generado tipo "Retardos (N): ...". Respeta locks: si una fila
 * está locked, no toca su Ajustes (puede ser nota manual del usuario).
 *
 * Corre una vez desde el editor cuando notas que Notas/Ajustes tiene basura vieja.
 */
function cleanupAjustesAutoGenerated() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ASISTENCIA_SEMANAL_TAB);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, cleared: 0 };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const ajIdx = headers.indexOf('Ajustes');
  const lockIdx = headers.indexOf('Locked');
  if (ajIdx < 0) return { ok: true, cleared: 0 };

  let cleared = 0;
  for (let r = 1; r < data.length; r++) {
    const aj = String(data[r][ajIdx] || '');
    const locked = data[r][lockIdx] === true || data[r][lockIdx] === '__YES__';
    if (locked) continue;
    // Match auto-generated retardo summary
    if (/^Retardos\s*\(\d+\):/i.test(aj.trim())) {
      sheet.getRange(r + 1, ajIdx + 1).setValue('');
      cleared++;
    }
  }
  SpreadsheetApp.flush();
  return { ok: true, cleared: cleared };
}


/**
 * Cleanup helper — borra la fila SEMANAL de un empleado para una semana
 * y la re-calcula desde cero (sin preservar manual fields). Útil cuando
 * cambian las reglas (workDays/hoursPerDay) y los valores viejos quedaron
 * pegados.
 *
 * Uso desde el editor de Apps Script:
 *   resetSemanalEmpleado(48, '2026-04-24')   // Louicarlo, semana 24-30 abr
 *   resetSemanalEmpleadoTodas(48)            // Louicarlo, todas las semanas
 */
function resetSemanalEmpleado(numero, weekStart) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ASISTENCIA_SEMANAL_TAB);
  if (!sheet) return { ok: false, error: 'Sheet not found' };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('ID');
  const targetId = numero + '_' + weekStart;
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][idIdx]) === targetId) {
      sheet.deleteRow(r + 1);
      // Re-recompute that week
      const friday = new Date(weekStart + 'T00:00:00');
      const thursday = new Date(friday);
      thursday.setDate(friday.getDate() + 6);
      const weekEnd = Utilities.formatDate(thursday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      recomputeSemanal(weekStart, weekEnd, 'reset');
      return { ok: true, deleted: targetId };
    }
  }
  return { ok: false, error: 'Row not found: ' + targetId };
}

function resetSemanalEmpleadoTodas(numero) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ASISTENCIA_SEMANAL_TAB);
  if (!sheet) return { ok: false, error: 'Sheet not found' };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('ID');
  const numIdx = headers.indexOf('NumeroColab');
  const iniIdx = headers.indexOf('SemanaInicio');
  const weeks = [];
  // Collect rows to delete + weeks to recompute
  const toDelete = [];
  for (let r = 1; r < data.length; r++) {
    if (parseInt(data[r][numIdx]) === numero) {
      toDelete.push(r + 1);
      weeks.push(formatDateStr(data[r][iniIdx]));
    }
  }
  toDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  weeks.forEach(weekStart => {
    if (!weekStart) return;
    const friday = new Date(weekStart + 'T00:00:00');
    const thursday = new Date(friday);
    thursday.setDate(friday.getDate() + 6);
    const weekEnd = Utilities.formatDate(thursday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    recomputeSemanal(weekStart, weekEnd, 'reset');
  });
  return { ok: true, deleted: toDelete.length, weeksRecomputed: weeks.length };
}


/** Update one SEMANAL row's manual fields (after parsing locks/classifications).
 *  Recomputes Puntualidad / Asistencia / FaltasInjustificadas after the edit so
 *  badges stay consistent with what's been saved.
 */
function updateSemanaRow(body) {
  const id = body.id;
  if (!id) throw new Error('ID requerido');
  const sheet = getOrCreateTab(ASISTENCIA_SEMANAL_TAB, ASISTENCIA_SEMANAL_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('ID');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idIdx]) === id) {
      // Write provided fields
      Object.keys(body).forEach(k => {
        if (k === 'id') return;
        const ci = headers.indexOf(k);
        if (ci >= 0) sheet.getRange(r + 1, ci + 1).setValue(body[k]);
      });

      // Re-read the row and recompute derived fields
      const rowData = sheet.getRange(r + 1, 1, 1, headers.length).getValues()[0];
      const get = (name) => rowData[headers.indexOf(name)];
      const retardos    = parseInt(get('Retardos'))           || 0;
      const faltasReal  = parseInt(get('FaltasReal'))         || 0;
      const faltasJust  = parseInt(get('FaltasJustificadas')) || 0;
      const faltasInjust = Math.max(0, faltasReal - faltasJust);

      const newPunt = retardos <= 1 && faltasReal === 0;
      const newAsis = faltasReal === 0;

      const setIf = (name, val) => {
        const ci = headers.indexOf(name);
        if (ci >= 0) sheet.getRange(r + 1, ci + 1).setValue(val);
      };
      setIf('FaltasInjustificadas', faltasInjust);
      setIf('Puntualidad', newPunt);
      setIf('Asistencia', newAsis);
      setIf('LastComputedAt', new Date().toISOString());

      SpreadsheetApp.flush();
      return { ok: true, puntualidad: newPunt, asistencia: newAsis, faltasInjustificadas: faltasInjust };
    }
  }
  throw new Error('Row no encontrada: ' + id);
}
