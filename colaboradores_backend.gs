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
  'Email',                      // Correo electrónico
  'Celular',                    // Celular
  'Inicio_Laboral',             // drives vacation accrual
  'Fecha_Nacimiento',
  'Estado_Civil',
  'Estado',                     // Activo | Inactivo
  'Area_Trabajo',
  'Mesa_Puesto',                // Mesa / Puesto
  'RFC',
  'CURP',
  'NSS_IMSS',
  'Clinica',
  'Calle',
  'Colonia',
  'Codigo_Postal',
  'Beneficiario_Nombre',
  'Beneficiario_Telefono',
  'Cuenta_Santander',
  'Tamano_Sudadera',
  'Contrato_28_Fecha',
  'Contrato_28_Firmado',
  'Contrato_84_Fecha',
  'Contrato_84_Firmado',
  'Contrato_Indef_Fecha',
  'Contrato_Indef_Firmado',
  'Usa_Checador',
  'Dias_Trabaja',               // comma-joined: "Lun,Mar,Mié,Jue,Vie,Sáb"
  'Horas_Dia',
  'Retardos_Perdonados',
  'Dias_Usados_Backfill_Actual', // manual: días vacación ya usados ANTES del sistema (anualidad actual)
  'Notas',
  'Notion_Page_Id',
  'Last_Synced_At'
];

const COLABORADORES_CACHE_KEY = 'colaboradores_sheet_v1';
const COLABORADORES_CACHE_TTL = 600;  // 10 min — same as Notion cache

// ─── Setup ────────────────────────────────────────────────────────────────

/**
 * Idempotent. Run after schema additions — overwrites header row only,
 * data rows untouched. Existing migrated rows that miss new columns will
 * just have empty values until next migrateColaboradoresFromNotion() run.
 */
function setupColaboradoresSheet() {
  const sheet = getOrCreateTab(COLABORADORES_TAB, COLABORADORES_HEADERS);
  const range = sheet.getRange(1, 1, 1, COLABORADORES_HEADERS.length);
  range.setValues([COLABORADORES_HEADERS]);
  range.setFontWeight('bold');
  range.setBackground('#1a3a1a');
  range.setFontColor('white');
  sheet.setFrozenRows(1);
  // Reasonable column widths
  const w = [60, 200, 220, 120, 110, 110, 100, 80, 140, 140, 130, 150, 130, 80, 200, 140, 100, 180, 130, 130, 100, 110, 80, 110, 80, 110, 80, 80, 200, 70, 80, 130, 200, 220, 130];
  w.forEach((px, i) => sheet.setColumnWidth(i + 1, px));
  Logger.log('COLABORADORES sheet ready · ' + COLABORADORES_HEADERS.length + ' columns');
  return { ok: true, columns: COLABORADORES_HEADERS.length };
}

/**
 * DEBUG helper — logs every property name + type from the first
 * Colaboradores Activos page so we can see exactly what to map against.
 * Run from Apps Script editor when migration misses fields.
 */
function debugListColaboradorProperties() {
  const pages = notionQueryAll_(NOTION_DS_COLABORADORES_ACTIVOS, null);
  if (!pages.length) { Logger.log('No pages returned'); return; }
  const sample = pages[0];
  const lines = [];
  Object.keys(sample.properties).sort().forEach(propName => {
    const p = sample.properties[propName];
    let preview = '';
    try {
      const v = notionPropValue_(sample, propName);
      preview = v === null ? '(null)' : JSON.stringify(v).slice(0, 60);
    } catch (e) { preview = '(err)'; }
    // Show name with quotes so trailing spaces are visible
    lines.push(`"${propName}" [${p.type}] = ${preview}`);
  });
  const out = lines.join('\n');
  Logger.log('Notion properties on page "' + (notionPropValue_(sample, 'Nombre') || sample.id) + '":\n' + out);
  return out;
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
  const pageIdCol = headers.indexOf('Notion_Page_Id');

  // Match by Notion page ID (each Notion page → exactly one sheet row).
  // Numero alone isn't unique because Notion recycles employee numbers when
  // a slot is reused (e.g. #38 = Elvia Activa + Michelle Inactiva).
  const existingByPageId = {};
  for (let r = 1; r < data.length; r++) {
    const pid = String(data[r][pageIdCol] || '').replace(/-/g, '').trim();
    if (pid) existingByPageId[pid] = r + 1;
  }

  // Whitespace + case insensitive property lookup. Notion property names often
  // have trailing/leading spaces or weird capitalization — this normalizes both
  // sides so we don't have to enumerate every variant.
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tryProp = (page, names) => {
    const wanted = names.map(norm);
    for (const pname in page.properties) {
      if (wanted.indexOf(norm(pname)) >= 0) {
        const v = notionPropValue_(page, pname);
        if (v != null && v !== '' && (!Array.isArray(v) || v.length)) return v;
      }
    }
    return null;
  };
  const trySafe = (page, names) => {
    const v = tryProp(page, names);
    return v == null ? '' : v;
  };
  // For multi_select fields — return joined string instead of array
  const tryMulti = (page, names) => {
    const v = tryProp(page, names);
    if (Array.isArray(v)) return v.join(', ');
    return v == null ? '' : String(v);
  };

  const now = formatDateStr(new Date());
  const updates = [];
  const inserts = [];
  let unmatched = 0;
  const missingFields = {};  // tracks which fields couldn't be found across pages

  pages.forEach(page => {
    const numero = parseInt(notionPropValue_(page, 'Número Colab.')) || null;
    if (!numero) { unmatched++; return; }

    // Personal
    const nombre = String(notionPropValue_(page, 'Nombre') || '').trim();
    const email = String(trySafe(page, ['Correo electrónico', 'Correo Electrónico', 'Correo', 'Email'])).trim();
    const celular = String(trySafe(page, ['Celular', 'Teléfono', 'Telefono', 'Phone', 'Cel'])).trim();
    const inicioLaboralRaw = tryProp(page, ['Inicio laboral', 'Inicio Laboral', 'Fecha de Inicio']);
    const inicioLaboral = inicioLaboralRaw ? formatDateStr(inicioLaboralRaw) : '';
    const fechaNacRaw = tryProp(page, ['Fecha nacimiento', 'Fecha de nacimiento']);
    const fechaNac = fechaNacRaw ? formatDateStr(fechaNacRaw) : '';
    const estadoCivil = String(trySafe(page, ['Estado civil'])).trim();
    const estado = String(trySafe(page, ['Estado'])).trim();
    const areaTrabajo = tryMulti(page, ['Area de trabajo', 'Área de trabajo']);
    const mesaPuesto = tryMulti(page, ['Mesa / Puesto', 'Mesa/Puesto', 'Puesto', 'Mesa']);

    // IDs
    const rfc = String(trySafe(page, ['RFC', 'rfc'])).trim();
    const curp = String(trySafe(page, ['CURP', 'curp'])).trim();
    const nss = String(trySafe(page, ['NSS - IMSS', 'NSS-IMSS', 'NSS IMSS', 'NSS', 'NSS_IMSS'])).trim();
    const clinica = String(trySafe(page, ['Clinica', 'Clínica'])).trim();

    // Address
    const calle = String(trySafe(page, ['Calle'])).trim();
    const colonia = String(trySafe(page, ['Colonia'])).trim();
    const cp = String(trySafe(page, ['Codigo postal', 'Código postal', 'Codigo Postal', 'CP'])).trim();

    // Beneficiarios
    const benefNombre = String(trySafe(page, [
      'Beneficiario Nombre', 'Beneficiario nombre', 'Beneficiario'
    ])).trim();
    const benefTel = String(trySafe(page, [
      'Beneficiario Teléfono', 'Beneficiario Telefono', 'Beneficiario teléfono', 'Beneficiario telefono'
    ])).trim();

    // Otros
    const cuentaSantander = String(trySafe(page, ['Cuenta Santander'])).trim();
    const sudadera = String(trySafe(page, ['Tamaño Sudadera', 'Tamano Sudadera', 'Tamaño sudadera'])).trim();

    // Contratos — Notion has BOTH a date and a checkbox property with the
    // same display name (e.g. two "Contrato 28 días"). Indexing by name gives
    // whichever Notion serializes first, so we scan all props and pick by type.
    const findByNameAndType = (page, namePatterns, type) => {
      for (const pname in page.properties) {
        const p = page.properties[pname];
        if (p.type !== type) continue;
        const lc = pname.toLowerCase().replace(/\s+/g, ' ').trim();
        for (const pat of namePatterns) {
          if (lc === pat) return notionPropValue_(page, pname);
        }
      }
      return null;
    };

    const c28FechaRaw = findByNameAndType(page, ['contrato 28 días', 'contrato 28 dias'], 'date');
    const c28FechaStr = c28FechaRaw ? formatDateStr(c28FechaRaw) : '';
    const c28FirmadoStrict = findByNameAndType(page, ['contrato 28 días', 'contrato 28 dias'], 'checkbox') === true;

    const c84FechaRaw = findByNameAndType(page, ['contrato 84 días', 'contrato 84 dias'], 'date');
    const c84FechaStr = c84FechaRaw ? formatDateStr(c84FechaRaw) : '';
    const c84FirmadoStrict = findByNameAndType(page, ['contrato 84 días', 'contrato 84 dias'], 'checkbox') === true;

    const cIndefFechaRaw = findByNameAndType(page, [
      'contrato indeterminado', 'contrato indeter', 'contrato indef'
    ], 'date');
    const cIndefFechaStr = cIndefFechaRaw ? formatDateStr(cIndefFechaRaw) : '';
    const cIndefFirmadoStrict = findByNameAndType(page, [
      'contrato indeterminado', 'contrato indeter', 'contrato indef'
    ], 'checkbox') === true;

    // Engine rules
    const usaChecador = notionPropValue_(page, 'Usa Checador');
    const diasTrabajaArr = notionPropValue_(page, 'Días Trabaja') || [];
    const horasDia = notionPropValue_(page, 'Horas/Día');
    const retardosPerdonados = notionPropValue_(page, 'Retardos Perdonados') === true;

    const pageIdNoDash = page.id.replace(/-/g, '');

    // Track missing core fields for diagnostic
    if (!email) missingFields.Email = (missingFields.Email || 0) + 1;
    if (!inicioLaboral) missingFields.Inicio_Laboral = (missingFields.Inicio_Laboral || 0) + 1;
    if (!celular) missingFields.Celular = (missingFields.Celular || 0) + 1;
    if (!mesaPuesto) missingFields.Mesa_Puesto = (missingFields.Mesa_Puesto || 0) + 1;

    const rowDict = {
      Numero: numero,
      Nombre: nombre,
      Email: email,
      Celular: celular,
      Inicio_Laboral: inicioLaboral,
      Fecha_Nacimiento: fechaNac,
      Estado_Civil: estadoCivil,
      Estado: estado,
      Area_Trabajo: areaTrabajo,
      Mesa_Puesto: mesaPuesto,
      RFC: rfc,
      CURP: curp,
      NSS_IMSS: nss,
      Clinica: clinica,
      Calle: calle,
      Colonia: colonia,
      Codigo_Postal: cp,
      Beneficiario_Nombre: benefNombre,
      Beneficiario_Telefono: benefTel,
      Cuenta_Santander: cuentaSantander,
      Tamano_Sudadera: sudadera,
      Contrato_28_Fecha: c28FechaStr,
      Contrato_28_Firmado: c28FirmadoStrict === true,
      Contrato_84_Fecha: c84FechaStr,
      Contrato_84_Firmado: c84FirmadoStrict === true,
      Contrato_Indef_Fecha: cIndefFechaStr,
      Contrato_Indef_Firmado: cIndefFirmadoStrict === true,
      Usa_Checador: usaChecador !== false,
      Dias_Trabaja: Array.isArray(diasTrabajaArr) ? diasTrabajaArr.join(',') : '',
      Horas_Dia: (typeof horasDia === 'number' && horasDia > 0) ? horasDia : 8,
      Retardos_Perdonados: retardosPerdonados,
      Notas: '',
      Notion_Page_Id: pageIdNoDash,
      Last_Synced_At: now
    };
    const rowArr = COLABORADORES_HEADERS.map(h => rowDict[h] != null ? rowDict[h] : '');

    if (existingByPageId[pageIdNoDash]) {
      updates.push({ rowNum: existingByPageId[pageIdNoDash], rowArr: rowArr });
    } else {
      inserts.push(rowArr);
    }
  });

  updates.forEach(u => {
    sheet.getRange(u.rowNum, 1, 1, COLABORADORES_HEADERS.length).setValues([u.rowArr]);
  });
  if (inserts.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, inserts.length, COLABORADORES_HEADERS.length)
         .setValues(inserts);
  }

  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  CacheService.getScriptCache().remove(EMPLEADO_RULES_CACHE_KEY);

  const summary = {
    ok: true,
    updated: updates.length,
    inserted: inserts.length,
    unmatched: unmatched,
    missingFieldCount: missingFields
  };
  Logger.log('Colaboradores migration: ' + JSON.stringify(summary, null, 2));
  if (Object.keys(missingFields).length) {
    Logger.log('TIP: run debugListColaboradorProperties() to see exact Notion property names.');
  }
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

  const headers = data[0].map(h => String(h || '').trim());
  // Robust column lookup: tries exact match first, then alias map, then
  // prefix match against truncated header names. Survives historical
  // schema renames (Telefono → Celular, Dias_Usados_Bac → Dias_Usados_Backfill_Actual).
  const aliasMap = {
    'Celular': ['Telefono', 'Phone', 'Cel'],
    'Dias_Usados_Backfill_Actual': ['Dias_Usados_Bac', 'Dias_Usados', 'Dias_Usados_Backfill']
  };
  const idx = (h) => {
    let i = headers.indexOf(h);
    if (i >= 0) return i;
    const aliases = aliasMap[h] || [];
    for (let a of aliases) {
      i = headers.indexOf(a);
      if (i >= 0) return i;
    }
    // Prefix fallback: header starts-with the first 12 chars of canonical
    const prefix = h.substring(0, 12).toLowerCase();
    for (let j = 0; j < headers.length; j++) {
      if (String(headers[j]).toLowerCase().startsWith(prefix)) return j;
    }
    return -1;
  };
  const out = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const numero = parseInt(row[idx('Numero')]);
    if (!numero) continue;
    const estado = String(row[idx('Estado')] || '').trim();
    if (estado && estado.toLowerCase().indexOf('inactivo') >= 0) continue;
    // Skip phantom rows (no Notion_Page_Id) — they were created by sync
    // artifacts and would overwrite real rows in this dedup loop.
    const pageId = String(row[idx('Notion_Page_Id')] || '').trim();
    if (!pageId) continue;
    out[numero] = {
      nombre:             String(row[idx('Nombre')] || '').trim(),
      email:              String(row[idx('Email')] || '').trim(),
      telefono:           String(row[idx('Celular')] || '').trim(),
      inicioLaboral:      formatDateStr(row[idx('Inicio_Laboral')]),
      estado:             estado || 'Activo',
      mesaPuesto:         String(row[idx('Mesa_Puesto')] || '').trim(),
      usaChecador:        row[idx('Usa_Checador')] !== false && row[idx('Usa_Checador')] !== 'FALSE',
      diasTrabaja:        String(row[idx('Dias_Trabaja')] || '').split(',').map(s => s.trim()).filter(Boolean),
      horasDia:           parseFloat(row[idx('Horas_Dia')]) || 8,
      retardosPerdonados: row[idx('Retardos_Perdonados')] === true || row[idx('Retardos_Perdonados')] === 'TRUE',
      diasUsadosBackfill: parseFloat(row[idx('Dias_Usados_Backfill_Actual')]) || 0,
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

/**
 * Removes phantom rows from COLABORADORES — rows that have a Numero but
 * no Notion_Page_Id (sync artifacts, manually-created blanks, etc).
 * These rows were causing real data to be overwritten by empty values.
 *
 * Run from the editor:  cleanupPhantomColaboradores()
 */
function cleanupPhantomColaboradores() {
  const sheet = getOrCreateTab(COLABORADORES_TAB, COLABORADORES_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const numCol = headers.indexOf('Numero');
  const pageIdCol = headers.indexOf('Notion_Page_Id');

  // Collect rows to delete (1-indexed, matching sheet row numbers)
  const toDelete = [];
  for (let r = 1; r < data.length; r++) {
    const numero = parseInt(data[r][numCol]);
    const pageId = String(data[r][pageIdCol] || '').trim();
    // Phantom: has a numero but no page_id, OR completely empty
    const isEmpty = data[r].every(v => v === '' || v === null);
    if (isEmpty || (numero && !pageId)) {
      toDelete.push(r + 1);  // sheet row number is r + 1
    }
  }
  // Delete from bottom up to preserve indices
  toDelete.sort((a, b) => b - a).forEach(rn => sheet.deleteRow(rn));
  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  Logger.log('cleanupPhantomColaboradores: removed ' + toDelete.length + ' phantom rows');
  return { ok: true, removed: toDelete.length };
}

/**
 * Loops every row, logs each one with numero=1 so we can see if there
 * are duplicates that overwrite Monica's correct data.
 */
function _testLoopDebug() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('COLABORADORES');
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const numColIdx = headers.indexOf('Numero');
  const backfillIdx = headers.indexOf('Dias_Usados_Backfill_Actual');
  const estadoIdx = headers.indexOf('Estado');
  Logger.log('Total data rows: ' + (data.length - 1));
  Logger.log('numColIdx = ' + numColIdx + ', backfillIdx = ' + backfillIdx + ', estadoIdx = ' + estadoIdx);
  let count1 = 0;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const numero = parseInt(row[numColIdx]);
    if (numero === 1) {
      count1++;
      Logger.log('Row index ' + r + ' (sheet row ' + (r+1) + '): numero=' + numero +
                 ', estado=' + JSON.stringify(row[estadoIdx]) +
                 ', backfill=' + JSON.stringify(row[backfillIdx]) +
                 ', parseFloat=' + parseFloat(row[backfillIdx]));
    }
  }
  Logger.log('Total rows with numero=1: ' + count1);
}

/**
 * Direct sanity test — completely bypasses getColaboradoresFromSheet_().
 * If this prints 14 but the other debug prints 0, the function is the bug.
 */
function _testDirectBackfill() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('COLABORADORES');
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const idx = headers.indexOf('Dias_Usados_Backfill_Actual');
  Logger.log('headers.indexOf("Dias_Usados_Backfill_Actual") = ' + idx);
  Logger.log('Monica row[' + idx + '] = ' + JSON.stringify(data[1][idx]) + ' (typeof ' + typeof data[1][idx] + ')');
  Logger.log('parseFloat result = ' + parseFloat(data[1][idx]));
  Logger.log('parseFloat || 0 = ' + (parseFloat(data[1][idx]) || 0));

  // Now let's compare with what getColaboradoresFromSheet_ produces
  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  const colabs = getColaboradoresFromSheet_();
  Logger.log('getColaboradoresFromSheet_()[1].diasUsadosBackfill = ' + (colabs[1] && colabs[1].diasUsadosBackfill));
}

/**
 * Debug — logs everything about a colaborador's backfill column lookup.
 * Run after filling Dias_Usados_Backfill_Actual to verify it's being
 * read correctly. Pass any active numero (1, 9, 10, 34, 38, etc.).
 */
function debugColaboradorBackfill(numero) {
  numero = numero || 1;  // default to Monica
  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  const sheet = getOrCreateTab(COLABORADORES_TAB, COLABORADORES_HEADERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  Logger.log('Headers (positions): ' + headers.map((h, i) => i + '=' + h).join(' | '));
  Logger.log('Looking for: Dias_Usados_Backfill_Actual');
  Logger.log('Exact indexOf: ' + headers.indexOf('Dias_Usados_Backfill_Actual'));

  // Find the row for this numero
  const numCol = headers.indexOf('Numero');
  let foundRow = null;
  for (let r = 1; r < data.length; r++) {
    if (parseInt(data[r][numCol]) === parseInt(numero)) {
      foundRow = data[r];
      break;
    }
  }
  if (!foundRow) { Logger.log('No row for numero ' + numero); return null; }

  const colabs = getColaboradoresFromSheet_();
  const c = colabs[numero];
  Logger.log('Row values per header:\n' + headers.map((h, i) => h + ' = ' + JSON.stringify(foundRow[i])).join('\n'));
  Logger.log('\ngetColaboradoresFromSheet_() returned for #' + numero + ':\n' + JSON.stringify(c, null, 2));
  return { headers, row: foundRow, colab: c };
}

/**
 * Sets the spreadsheet timezone to America/Chihuahua. Run once after
 * cloning or if the dates show off-by-one in the form. After running,
 * re-run migrateColaboradoresFromNotion() to refresh stored dates with
 * the new TZ baseline.
 */
function setSheetTimezoneChihuahua() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSpreadsheetTimeZone();
  ss.setSpreadsheetTimeZone('America/Chihuahua');
  Logger.log('Sheet timezone changed: ' + old + ' → America/Chihuahua');
  return { ok: true, before: old, after: 'America/Chihuahua' };
}

/**
 * Repair tool — schema changes over time caused duplicate / orphan columns
 * to be auto-appended at the end of the sheet (e.g. an old 'Telefono' column
 * after 'Celular' was renamed; or 'Dias_Usados_Backfill_Actual' got appended
 * to the end before setupColaboradoresSheet rewrote headers in a different
 * position).
 *
 * This walks every row, builds the canonical row from whichever physical
 * column has data for each logical key, and truncates the extra columns.
 *
 * Run from the editor:  repairColaboradoresColumns()
 */
function repairColaboradoresColumns() {
  const sheet = getOrCreateTab(COLABORADORES_TAB, COLABORADORES_HEADERS);
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, repaired: 0, columnsTrimmed: 0 };

  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headerRow = data[0].map(h => String(h || '').trim());

  // Map each canonical header → list of physical column indexes (0-based)
  // that ever held that value (current header row + known legacy aliases).
  const aliasToCanonical = {
    'Telefono': 'Celular',
    'Phone': 'Celular',
    'Dias_Usados': 'Dias_Usados_Backfill_Actual',
    'Dias_Usados_Bac': 'Dias_Usados_Backfill_Actual',
    'Dias_Usados_Backfill': 'Dias_Usados_Backfill_Actual'
  };
  const canonicalToCols = {};
  COLABORADORES_HEADERS.forEach(h => { canonicalToCols[h] = []; });
  headerRow.forEach((h, i) => {
    if (canonicalToCols[h] !== undefined) canonicalToCols[h].push(i);
    else if (aliasToCanonical[h] && canonicalToCols[aliasToCanonical[h]] !== undefined) {
      canonicalToCols[aliasToCanonical[h]].push(i);
    }
  });

  // For each data row, build a clean canonical row by picking the first
  // non-empty value across all candidate physical columns for that field.
  const targetCols = COLABORADORES_HEADERS.length;
  const rebuilt = [COLABORADORES_HEADERS.slice()];
  let repaired = 0;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const newRow = COLABORADORES_HEADERS.map((h) => {
      const candidates = canonicalToCols[h] || [];
      for (let i = 0; i < candidates.length; i++) {
        const v = row[candidates[i]];
        if (v !== '' && v !== null && v !== undefined) return v;
      }
      return '';
    });
    rebuilt.push(newRow);
    // count rows that needed any change
    repaired++;
  }

  // Clear the entire used range and write the rebuilt data + truncate cols
  if (lastCol > targetCols) {
    sheet.deleteColumns(targetCols + 1, lastCol - targetCols);
  }
  sheet.getRange(1, 1, rebuilt.length, targetCols).setValues(rebuilt);

  // Re-style header
  const range = sheet.getRange(1, 1, 1, targetCols);
  range.setFontWeight('bold');
  range.setBackground('#1a3a1a');
  range.setFontColor('white');
  sheet.setFrozenRows(1);

  CacheService.getScriptCache().remove(COLABORADORES_CACHE_KEY);
  CacheService.getScriptCache().remove(EMPLEADO_RULES_CACHE_KEY);
  const summary = { ok: true, repaired, columnsTrimmed: Math.max(0, lastCol - targetCols) };
  Logger.log('repairColaboradoresColumns: ' + JSON.stringify(summary));
  return summary;
}
