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
  const w = [60, 200, 220, 120, 110, 110, 100, 80, 140, 140, 130, 150, 130, 80, 200, 140, 100, 180, 130, 130, 100, 110, 80, 110, 80, 110, 80, 80, 200, 70, 80, 200, 220, 130];
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
