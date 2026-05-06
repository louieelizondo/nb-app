/**
 * ═══════════════════════════════════════════════════════════════
 * NB · Colaboradores Backend — Sheet-based employee roster
 * ═══════════════════════════════════════════════════════════════
 *
 * Phase 2 of the migration off Notion. Mirrors Colaboradores Activos
 * (the basics — no PII like CURP/RFC/INE, those stay in Notion).
 *
 * COLABORADORES sheet becomes the source of truth for the engine's
 * empleado rules. Notion remains the secondary source / archive.
 *
 * Setup (one-time):
 *   1. Run setupColaboradoresSheet() — creates the tab
 *   2. Run migrateColaboradoresFromNotion() — pulls active rows from Notion
 *   3. Engine automatically prefers sheet over Notion once sheet has rows
 *
 * Author: Claude + Louie · 2026-05-06
 */

// ─── Constants ────────────────────────────────────────────────────────────
const COLABORADORES_TAB = 'COLABORADORES';
const COLABORADORES_HEADERS = [
  'Numero',
  'Nombre',
  'Email',
  'Telefono',
  'Inicio_Laboral',         // YYYY-MM-DD — drives vacation accrual
  'Estado',                 // Activo | Inactivo
  'Mesa_Puesto',
  'Usa_Checador',           // boolean
  'Dias_Trabaja',           // comma-joined: "Lun,Mar,Mié,Jue,Vie,Sáb"
  'Horas_Dia',              // number, default 8
  'Retardos_Perdonados',    // boolean
  'Notas',
  'Notion_Page_Id',         // for legacy permiso relation matching
  'Last_Synced_At'
];

const COLABORADORES_CACHE_KEY = 'colaboradores_sheet_v1';
const COLABORADORES_CACHE_TTL = 600;  // 10 min — same as Notion cache

// ─── Setup ────────────────────────────────────────────────────────────────

function setupColaboradoresSheet() {
  const sheet = getOrCreateTab(COLABORADORES_TAB, COLABORADORES_HEADERS);
  const range = sheet.getRange(1, 1, 1, COLABORADORES_HEADERS.length);
  range.setValues([COLABORADORES_HEADERS]);
  range.setFontWeight('bold');
  range.setBackground('#1a3a1a');
  range.setFontColor('white');
  sheet.setFrozenRows(1);
  const widths = [70, 220, 220, 130, 110, 90, 180, 110, 220, 90, 140, 220, 250, 130];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  Logger.log('COLABORADORES sheet ready · ' + COLABORADORES_HEADERS.length + ' columns');
  return { ok: true, columns: COLABORADORES_HEADERS.length };
}

// ─── Migration: Notion → Sheet ────────────────────────────────────────────

/**
 * Pulls all rows from Notion Colaboradores Activos into the sheet.
 * Idempotent — updates existing rows by Numero, appends new ones.
 *
 * Tries multiple property name variants for fields whose Notion names
 * I don't know exactly (e.g. "Inicio Laboral" vs "Fecha de Inicio"). If
 * a field is missing across all variants, it logs a warning so we can
 * adjust the variant list.
 *
 * Run once from the editor:
 *   migrateColaboradoresFromNotion()
 */
function migrateColaboradoresFromNotion() {
  const pages = notionQueryAll_(NOTION_DS_COLABORADORES_ACTIVOS, null);

  const sheet = getOrCreateTab(COLABORADORES_TAB, COLABORADORES_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const numCol = headers.indexOf('Numero');
  const existingByNumero = {};
  for (let r = 1; r < data.length; r++) {
    const n = parseInt(data[r][numCol]);
    if (n) existingByNumero[n] = r + 1;  // 1-indexed row
  }

  // Try variants — Notion property names sometimes have trailing spaces or
  // accents differ. First match wins.
  const tryProp = (page, names) => {
    for (const n of names) {
      const v = notionPropValue_(page, n);
      if (v != null && v !== '' && (!Array.isArray(v) || v.length)) return v;
    }
    return null;
  };

  const now = formatDateStr(new Date());
  const updates = [];   // [{ rowNum, rowArr }]
  const inserts = [];   // 2D
  let unmatched = 0;

  pages.forEach(page => {
    const numero = parseInt(notionPropValue_(page, 'Número Colab.')) || null;
    if (!numero) { unmatched++; return; }

    const inicioLaboralRaw = tryProp(page, [
      'Inicio Laboral', 'Inicio laboral', 'Fecha de Inicio', 'Fecha Inicio',
      'Fecha de inicio', 'Inicio de Labores', 'Inicio_Laboral'
    ]);
    const inicioLaboral = inicioLaboralRaw ? formatDateStr(inicioLaboralRaw) : '';

    const estado = String(notionPropValue_(page, 'Estado ') || notionPropValue_(page, 'Estado') || '').trim();
    const nombre = String(notionPropValue_(page, 'Nombre') || '').trim();
    const email = String(tryProp(page, ['Email', 'Correo', 'E-mail']) || '').trim();
    const telefono = String(tryProp(page, ['Teléfono', 'Telefono', 'Phone', 'Cel']) || '').trim();
    const mesaPuesto = String(tryProp(page, ['Mesa/Puesto', 'Puesto', 'Mesa']) || '').trim();
    const usaChecador = notionPropValue_(page, 'Usa Checador');
    const diasTrabajaArr = notionPropValue_(page, 'Días Trabaja') || [];
    const horasDia = notionPropValue_(page, 'Horas/Día');
    const retardosPerdonados = notionPropValue_(page, 'Retardos Perdonados') === true;
    const pageIdNoDash = page.id.replace(/-/g, '');

    const rowDict = {
      Numero: numero,
      Nombre: nombre,
      Email: email,
      Telefono: telefono,
      Inicio_Laboral: inicioLaboral,
      Estado: estado,
      Mesa_Puesto: mesaPuesto,
      Usa_Checador: usaChecador !== false,  // default true
      Dias_Trabaja: Array.isArray(diasTrabajaArr) ? diasTrabajaArr.join(',') : '',
      Horas_Dia: (typeof horasDia === 'number' && horasDia > 0) ? horasDia : 8,
      Retardos_Perdonados: retardosPerdonados,
      Notas: '',
      Notion_Page_Id: pageIdNoDash,
      Last_Synced_At: now
    };
    const rowArr = COLABORADORES_HEADERS.map(h => rowDict[h] != null ? rowDict[h] : '');

    if (existingByNumero[numero]) {
      updates.push({ rowNum: existingByNumero[numero], rowArr: rowArr });
    } else {
      inserts.push(rowArr);
    }
  });

  // Flush
  updates.forEach(u => {
    sheet.getRange(u.rowNum, 1, 1, COLABORADORES_HEADERS.length).setValues([u.rowArr]);
  });
  if (inserts.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, inserts.length, COLABORADORES_HEADERS.length)
         .setValues(inserts);
  }

  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  CacheService.getScriptCache().remove(EMPLEADO_RULES_CACHE_KEY);  // engine cache

  const summary = { ok: true, updated: updates.length, inserted: inserts.length, unmatched: unmatched };
  Logger.log('Colaboradores migration: ' + JSON.stringify(summary));
  log('COLAB_MIGRATE', JSON.stringify(summary));
  return summary;
}

// ─── Read: cached map by numero ──────────────────────────────────────────

/**
 * Returns { numero: { nombre, email, telefono, inicioLaboral, estado,
 * mesaPuesto, usaChecador, diasTrabaja, horasDia, retardosPerdonados,
 * notionPageId } } — only Activo rows.
 *
 * Cached 10 min via CacheService.
 */
function getColaboradoresFromSheet_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(COLABORADORES_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const sheet = getOrCreateTab(COLABORADORES_TAB, COLABORADORES_HEADERS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    cache.put(COLABORADORES_CACHE_KEY, '{}', COLABORADORES_CACHE_TTL);
    return {};
  }

  const headers = data[0];
  const idx = (h) => headers.indexOf(h);
  const out = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const numero = parseInt(row[idx('Numero')]);
    if (!numero) continue;
    const estado = String(row[idx('Estado')] || '').trim();
    if (estado && estado.toLowerCase().indexOf('inactivo') >= 0) continue;
    out[numero] = {
      nombre:             String(row[idx('Nombre')] || '').trim(),
      email:              String(row[idx('Email')] || '').trim(),
      telefono:           String(row[idx('Telefono')] || '').trim(),
      inicioLaboral:      formatDateStr(row[idx('Inicio_Laboral')]),
      estado:             estado || 'Activo',
      mesaPuesto:         String(row[idx('Mesa_Puesto')] || '').trim(),
      usaChecador:        row[idx('Usa_Checador')] !== false && row[idx('Usa_Checador')] !== 'FALSE',
      diasTrabaja:        String(row[idx('Dias_Trabaja')] || '').split(',').map(s => s.trim()).filter(Boolean),
      horasDia:           parseFloat(row[idx('Horas_Dia')]) || 8,
      retardosPerdonados: row[idx('Retardos_Perdonados')] === true || row[idx('Retardos_Perdonados')] === 'TRUE',
      notionPageId:       String(row[idx('Notion_Page_Id')] || '')
    };
  }
  cache.put(COLABORADORES_CACHE_KEY, JSON.stringify(out), COLABORADORES_CACHE_TTL);
  return out;
}

/** Cache buster. */
function refreshColaboradores() {
  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  CacheService.getScriptCache().remove(EMPLEADO_RULES_CACHE_KEY);
  const out = getColaboradoresFromSheet_();
  Logger.log('Cache cleared. Active colaboradores: ' + Object.keys(out).length);
  return out;
}
