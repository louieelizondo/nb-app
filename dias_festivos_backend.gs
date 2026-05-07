/**
 * ═══════════════════════════════════════════════════════════════
 * NB · Días Festivos Backend
 * ═══════════════════════════════════════════════════════════════
 *
 * Holds the list of paid-but-not-worked days (federal holidays per LFT
 * Art. 74 + any company-specific days). Engine respects these dates:
 *   - No falta if checador shows absence
 *   - No retardo flags
 *   - Counted in DiasFestivos (new SEMANAL column)
 *
 * For swap exceptions (e.g. Día del Trabajo Friday → swapped to Saturday):
 *   - Delete the original holiday row from this sheet
 *   - Add a new row for the compensatory day
 *   The engine just respects what's in the list.
 *
 * Setup:
 *   1. setupDiasFestivosSheet()
 *   2. seedDiasFestivosMx() — federal holidays 2026 + 2027
 *
 * Author: Claude + Louie · 2026-05-06
 */

// ─── Constants ────────────────────────────────────────────────────────────
const DIAS_FESTIVOS_TAB = 'DIAS_FESTIVOS';
const DIAS_FESTIVOS_HEADERS = [
  'Fecha',     // YYYY-MM-DD
  'Nombre',    // 'Día del Trabajo', etc.
  'Tipo',      // 'Federal' | 'Empresa'
  'Notas'
];

const DIAS_FESTIVOS_CACHE_KEY = 'dias_festivos_v1';
const DIAS_FESTIVOS_CACHE_TTL = 600;  // 10 min

// ─── Setup ────────────────────────────────────────────────────────────────

function setupDiasFestivosSheet() {
  const sheet = getOrCreateTab(DIAS_FESTIVOS_TAB, DIAS_FESTIVOS_HEADERS);
  const range = sheet.getRange(1, 1, 1, DIAS_FESTIVOS_HEADERS.length);
  range.setValues([DIAS_FESTIVOS_HEADERS]);
  range.setFontWeight('bold');
  range.setBackground('#1a3a1a');
  range.setFontColor('white');
  sheet.setFrozenRows(1);
  [110, 280, 110, 320].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  Logger.log('DIAS_FESTIVOS sheet ready · ' + DIAS_FESTIVOS_HEADERS.length + ' columns');
  return { ok: true };
}

// ─── Seed: Mexican federal holidays per LFT Art. 74 ──────────────────────

/**
 * Pre-fills Mexican federal holidays for 2026 and 2027.
 * Idempotent — skips dates already present.
 *
 * Per LFT Art. 74:
 *   - 1 enero · Año Nuevo
 *   - 1er lunes de febrero · Día de la Constitución (movido del 5 feb)
 *   - 3er lunes de marzo · Natalicio Benito Juárez (movido del 21 mar)
 *   - 1 mayo · Día del Trabajo
 *   - 16 septiembre · Independencia
 *   - 3er lunes de noviembre · Día de la Revolución (movido del 20 nov)
 *   - 25 diciembre · Navidad
 *   - Día de elecciones federales (cada 6 años; 2024, 2030, ...)
 *   - 1 octubre Toma de Posesión Presidente (cada 6 años; 2024, 2030, ...)
 */
function seedDiasFestivosMx() {
  const sheet = getOrCreateTab(DIAS_FESTIVOS_TAB, DIAS_FESTIVOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf('Fecha');
  const existing = new Set();
  for (let r = 1; r < data.length; r++) {
    const f = formatDateStr(data[r][fechaCol]);
    if (f) existing.add(f);
  }

  const SEED = [
    // 2026
    { fecha: '2026-01-01', nombre: 'Año Nuevo' },
    { fecha: '2026-02-02', nombre: 'Día de la Constitución (1er lunes feb)' },
    { fecha: '2026-03-16', nombre: 'Natalicio de Benito Juárez (3er lunes mar)' },
    { fecha: '2026-05-01', nombre: 'Día del Trabajo' },
    { fecha: '2026-09-16', nombre: 'Día de la Independencia' },
    { fecha: '2026-11-16', nombre: 'Día de la Revolución (3er lunes nov)' },
    { fecha: '2026-12-25', nombre: 'Navidad' },
    // 2027
    { fecha: '2027-01-01', nombre: 'Año Nuevo' },
    { fecha: '2027-02-01', nombre: 'Día de la Constitución (1er lunes feb)' },
    { fecha: '2027-03-15', nombre: 'Natalicio de Benito Juárez (3er lunes mar)' },
    { fecha: '2027-05-01', nombre: 'Día del Trabajo' },
    { fecha: '2027-09-16', nombre: 'Día de la Independencia' },
    { fecha: '2027-11-15', nombre: 'Día de la Revolución (3er lunes nov)' },
    { fecha: '2027-12-25', nombre: 'Navidad' }
  ];

  const rows = [];
  let inserted = 0, skipped = 0;
  SEED.forEach(s => {
    if (existing.has(s.fecha)) { skipped++; return; }
    rows.push([s.fecha, s.nombre, 'Federal', '']);
    inserted++;
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, DIAS_FESTIVOS_HEADERS.length).setValues(rows);
  }
  CacheService.getScriptCache().remove(DIAS_FESTIVOS_CACHE_KEY);
  Logger.log('seedDiasFestivosMx: inserted=' + inserted + ', skipped=' + skipped);
  return { ok: true, inserted, skipped };
}

// ─── Read ─────────────────────────────────────────────────────────────────

/**
 * Returns Set of YYYY-MM-DD strings for all holidays.
 * Cached 10 min.
 */
function getDiasFestivosSet_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(DIAS_FESTIVOS_CACHE_KEY);
  if (cached) {
    try { return new Set(JSON.parse(cached)); } catch (e) {}
  }
  const sheet = getOrCreateTab(DIAS_FESTIVOS_TAB, DIAS_FESTIVOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const f = formatDateStr(data[r][0]);
    if (f) out.push(f);
  }
  cache.put(DIAS_FESTIVOS_CACHE_KEY, JSON.stringify(out), DIAS_FESTIVOS_CACHE_TTL);
  return new Set(out);
}

/**
 * Returns array of {fecha, nombre, tipo, notas} for calendar display.
 * Filtered by date range if from/to provided.
 */
function listDiasFestivos(params) {
  const sheet = getOrCreateTab(DIAS_FESTIVOS_TAB, DIAS_FESTIVOS_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, festivos: [] };
  const from = params && params.from;
  const to   = params && params.to;
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const fecha = formatDateStr(data[r][0]);
    if (!fecha) continue;
    if (from && fecha < from) continue;
    if (to && fecha > to) continue;
    out.push({
      fecha,
      nombre: String(data[r][1] || ''),
      tipo: String(data[r][2] || 'Federal'),
      notas: String(data[r][3] || '')
    });
  }
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { ok: true, festivos: out };
}

/** Cache buster — run after manually editing the DIAS_FESTIVOS sheet. */
function refreshDiasFestivos() {
  CacheService.getScriptCache().remove(DIAS_FESTIVOS_CACHE_KEY);
  const set = getDiasFestivosSet_();
  Logger.log('Días festivos cargados: ' + set.size);
  return { ok: true, count: set.size };
}
