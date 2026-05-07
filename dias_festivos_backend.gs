/**
 * ═══════════════════════════════════════════════════════════════
 * NB · Días Festivos — Mexican federal holidays (computed)
 * ═══════════════════════════════════════════════════════════════
 *
 * Per LFT Art. 74. Computed at runtime using fixed-day + Nth-Monday
 * rules — zero maintenance, works forever.
 *
 * Source-of-truth hierarchy:
 *   1. Checador's INHABIL mark (RAW.IsFestivo) — actual operational truth.
 *      Handles swaps automatically (admin marks the actual day off in
 *      the checador system → it shows up here as IsFestivo).
 *   2. Computed federal holidays (this file) — fallback ONLY for:
 *      a) noChecador employees who don't appear in the xlsx
 *      b) calendar preview of months not yet uploaded
 *
 * If the checador and the computed list disagree for a date that's been
 * uploaded, the checador wins (because it reflects what actually happened).
 *
 * Author: Claude + Louie · 2026-05-06
 */

// ─── LFT Art. 74 federal holidays ─────────────────────────────────────────

/** Returns Nth weekday-of-month as YYYY-MM-DD. weekday 0=Sun..6=Sat */
function nthWeekdayOfMonth_(year, month1Indexed, weekday, n) {
  // Find first occurrence of weekday in the month
  const first = new Date(year, month1Indexed - 1, 1);
  const offset = ((weekday - first.getDay()) + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const pad = x => String(x).padStart(2, '0');
  return year + '-' + pad(month1Indexed) + '-' + pad(day);
}

/**
 * Returns array of {fecha, nombre} for the year's federal holidays.
 * Per LFT Art. 74 (post-2023 form):
 *   - 1 enero · Año Nuevo
 *   - 1er lunes febrero · Día de la Constitución (movible)
 *   - 3er lunes marzo · Natalicio Benito Juárez (movible)
 *   - 1 mayo · Día del Trabajo
 *   - 16 septiembre · Día de la Independencia
 *   - 3er lunes noviembre · Día de la Revolución (movible)
 *   - 1 octubre cada 6 años · Toma de Posesión Presidente (2024, 2030, ...)
 *   - 25 diciembre · Navidad
 *   (Día de elecciones federales también, pero la fecha varía y se omite aquí)
 */
function getMxFederalHolidays_(year) {
  const out = [
    { fecha: year + '-01-01', nombre: 'Año Nuevo' },
    { fecha: nthWeekdayOfMonth_(year, 2, 1, 1), nombre: 'Día de la Constitución' },
    { fecha: nthWeekdayOfMonth_(year, 3, 1, 3), nombre: 'Natalicio de Benito Juárez' },
    { fecha: year + '-05-01', nombre: 'Día del Trabajo' },
    { fecha: year + '-09-16', nombre: 'Día de la Independencia' },
    { fecha: nthWeekdayOfMonth_(year, 11, 1, 3), nombre: 'Día de la Revolución' },
    { fecha: year + '-12-25', nombre: 'Navidad' }
  ];
  // Toma de Posesión: Oct 1 every 6 years starting 2024
  if (((year - 2024) % 6) === 0 && year >= 2024) {
    out.push({ fecha: year + '-10-01', nombre: 'Toma de Posesión Presidente' });
  }
  return out;
}

/**
 * Returns Set<YYYY-MM-DD> for the years specified (or current ± 1 if omitted).
 * Used as fallback for noChecador employees + calendar future preview.
 */
function getMxFederalHolidaysSet_(years) {
  const ys = years || [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];
  const set = new Set();
  ys.forEach(y => getMxFederalHolidays_(y).forEach(h => set.add(h.fecha)));
  return set;
}

// ─── Public API: list federal holidays in a date range (for calendar) ───

/**
 * Returns federal holidays in a date range (inclusive). Used by the calendar
 * to render holidays for months that haven't been uploaded yet to checador.
 * Body params: { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 */
function listDiasFestivos(params) {
  const today = new Date();
  const from = (params && params.from) || (today.getFullYear() - 1) + '-01-01';
  const to   = (params && params.to)   || (today.getFullYear() + 1) + '-12-31';

  // Span all years touched by the range
  const fromYear = parseInt(from.slice(0, 4));
  const toYear   = parseInt(to.slice(0, 4));
  const out = [];
  for (let y = fromYear; y <= toYear; y++) {
    getMxFederalHolidays_(y).forEach(h => {
      if (h.fecha >= from && h.fecha <= to) {
        out.push({ fecha: h.fecha, nombre: h.nombre, tipo: 'Federal', notas: '' });
      }
    });
  }
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { ok: true, festivos: out };
}

// ─── Engine bridge ───────────────────────────────────────────────────────

/**
 * Returns Set<YYYY-MM-DD> of festivos to apply during recomputeSemanal.
 * Currently just the computed federal holidays — checador's IsFestivo
 * flag handles per-employee per-day truth.
 *
 * Kept as a function (not inlined) so we can add future overrides without
 * touching the engine.
 */
function getDiasFestivosSet_() {
  return getMxFederalHolidaysSet_();
}
