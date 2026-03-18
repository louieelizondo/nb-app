# NB Finance Portal — Two Bug Fixes
**Date:** 2026-03-17
**Files to edit:** Both in Google Apps Script editor

---

## Fix 1: "Error cargando pendientes" — Missing API Route

**File:** `gastos_script_DEPLOY_THIS.gs`
**Location:** Inside `doGet()` switch block

**Find this line (~line 90):**
```javascript
      case 'get_mesa_sales':       return jsonResp(getMesaSales(e.parameter));
```

**Add this line directly BELOW it:**
```javascript
      case 'get_pendientes_sobre2': return jsonResp(getPendientesSobre2(e.parameter));
```

**Why:** The `getPendientesSobre2()` function exists in `cortes_ingresos.gs` but was never wired into the API router. The frontend calls it, gets "Unknown action", and shows the red error.

---

## Fix 2: Day-of-Week Off by One (Viernes → Sábado)

**File:** `cortes_ingresos.gs`
**Location:** `parseDateInfo()` function (~line 158)

**Find and DELETE this entire function:**
```javascript
function parseDateInfo(fechaStr) {
  const d = new Date(fechaStr);
  if (isNaN(d.getTime())) return { dia: '', mes: '', mesNum: 0, anio: 0 };
  return {
    dia: DIAS_SEMANA[d.getDay()],
    mes: MESES[d.getMonth() + 1],
    mesNum: d.getMonth() + 1,
    anio: d.getFullYear()
  };
}
```

**Replace with:**
```javascript
function parseDateInfo(fechaStr) {
  // Parse date components directly to avoid UTC timezone offset
  // (new Date("2026-03-14") = midnight UTC = March 13 evening in Mexico → wrong day)
  const parts = String(fechaStr).split(/[-\/T]/);
  if (parts.length < 3) {
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return { dia: '', mes: '', mesNum: 0, anio: 0 };
    // Add 12 hours to avoid timezone boundary issues
    d.setHours(d.getHours() + 12);
    return {
      dia: DIAS_SEMANA[d.getDay()],
      mes: MESES[d.getMonth() + 1],
      mesNum: d.getMonth() + 1,
      anio: d.getFullYear()
    };
  }
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const day = parseInt(parts[2]);
  const d = new Date(year, month - 1, day, 12, 0, 0); // noon local time
  return {
    dia: DIAS_SEMANA[d.getDay()],
    mes: MESES[month],
    mesNum: month,
    anio: year
  };
}
```

**Why:** `new Date("2026-03-14")` parses as midnight UTC. In Mexico (UTC-6), that's still March 13 at 6pm. So `getDay()` returns Friday instead of Saturday. The fix parses the year/month/day components directly and creates the date at noon local time.

**Note:** Existing rows in INGRESOS that already have the wrong DiaSemana (like Mar 14 showing "Viernes") will NOT auto-correct. They'll only be fixed if you re-save those dates through Sobre 2, which triggers `saveIngreso()` → `parseDateInfo()` again. New entries will be correct going forward.

---

## Deployment Steps

1. Open Google Sheet: NB_Margenes_Dashboard
2. Extensions → Apps Script
3. Edit `gastos_script_DEPLOY_THIS.gs` — add the pendientes route (Fix 1)
4. Edit `cortes_ingresos.gs` — replace parseDateInfo (Fix 2)
5. Click Save (Ctrl+S)
6. Deploy → Manage deployments → Edit existing deployment → Deploy
7. Test:
   - Open Registro de Ingresos → Sobre 2 tab → "Pendientes" section should load
   - Save a new date → check INGRESOS tab → DiaSemana should be correct

---

## Optional: Fix existing wrong DiaSemana values

If you want to bulk-fix all existing rows, add this one-time utility function to Apps Script and run it once:

```javascript
function fixAllDiaSemana() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('INGRESOS');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf('Fecha');
  const diaCol = headers.indexOf('DiaSemana');
  if (fechaCol < 0 || diaCol < 0) return;

  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  let fixed = 0;
  for (let i = 1; i < data.length; i++) {
    const fechaRaw = data[i][fechaCol];
    if (!fechaRaw) continue;
    const fechaStr = typeof fechaRaw === 'object' ? Utilities.formatDate(fechaRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(fechaRaw);
    const parts = fechaStr.split(/[-\/T]/);
    if (parts.length < 3) continue;
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
    const correctDay = DIAS[d.getDay()];
    if (data[i][diaCol] !== correctDay) {
      sheet.getRange(i + 1, diaCol + 1).setValue(correctDay);
      fixed++;
    }
  }
  SpreadsheetApp.flush();
  Logger.log('Fixed ' + fixed + ' rows');
}
```

Run it once from the Apps Script editor (Run → fixAllDiaSemana), then delete it.
