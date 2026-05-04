# Deploy Bono Productividad — pasos exactos

Esta es la primera feature en nb-app que jala datos de **Notion**. Hay que crear una integración Notion una sola vez. Después es deploy normal de nb-app.

## 1. Crear integración Notion (5 minutos, una sola vez)

1. Ir a https://www.notion.so/profile/integrations
2. Click **+ New integration**
3. Nombre: `NB-app Bono Productividad`
4. Asociado al workspace de NB
5. Type: **Internal**
6. Capabilities: solo necesita **Read content** (no escribe a Notion)
7. Submit → copiar el **Internal Integration Secret** (empieza con `secret_…`). Guárdalo.

Ahora compartir las DBs con la integración:

8. Abrir DB **Colaboradores Activos** en Notion → arriba a la derecha clic `…` → **Connect to integration** → escoger `NB-app Bono Productividad`. Confirma.
9. Repetir para **Reporte de nómina semanal** (la DB que tiene `Faltas`, `Retardos`, `Colaborador`, `Date`, etc.).

## 2. Pegar el código en Apps Script

1. Abrir https://script.google.com/u/0/home/projects/1AdENQ3QOvVjzyZ_BDgWEf3c7I-jZ4Z6BNemjsn1MPNCYb0mir9j8Tbv5/edit
2. Crear un nuevo archivo: + → Script → nombre `bono_productividad`
3. Pegar el contenido COMPLETO de `bono_productividad.gs` (en el repo).
4. En el archivo `Código.gs` (el router): aplicar los cambios de `gastos_script_DEPLOY_THIS.gs` — específicamente las nuevas líneas en doGet:
   ```js
   case 'get_bono_productividad_data': return jsonResp(getBonoProductividadData(e.parameter));
   case 'get_bono_history':            return jsonResp(getBonoHistory(e.parameter));
   case 'get_bono_employee_roster':    return jsonResp({ ok: true, roster: getBonoEmployeeRoster() });
   ```
5. Guardar.

## 3. Set NOTION_TOKEN en Script Properties

1. En Apps Script: Configuración (engrane) → Propiedades del script → Editar
2. Add property:
   - Name: `NOTION_TOKEN`
   - Value: el `secret_…` del paso 1.7
3. Save.

## 4. Re-deploy el backend

1. Implementar → Administrar implementaciones → Lápiz (editar)
2. Versión: **Nueva versión**
3. Description: "Bono Productividad backend"
4. Implementar.
5. La URL del Web App NO cambia.

## 5. Push frontend a GitHub

```bash
cd /path/to/nb-app
TOKEN=$(cat workspace/.credentials/github-token.txt)
git add bono_productividad.html bono_productividad.gs index.html BONO_PRODUCTIVIDAD_DEPLOY.md
git commit -m "feat: Bono Productividad — per-employee biweekly bonus engine with Notion integration"
git remote set-url origin https://louieelizondo:$TOKEN@github.com/louieelizondo/nb-app.git
git push origin main
git remote set-url origin https://github.com/louieelizondo/nb-app.git
```

GitHub Pages tarda ~1 min en publicar. Verifica en https://louieelizondo.github.io/nb-app/

## 6. Smoke test

1. Abrir https://louieelizondo.github.io/nb-app/bono_productividad.html
2. La quincena 24 abr → 7 may debería estar precargada (o la más reciente que tienes en VENTAS_MESA)
3. Si dice "Captura pendiente", regresa a Registro de Ingresos → Ventas por Mesa, captura, vuelve.
4. Una vez cargada, verifica que las 14 filas aparezcan con sus mesas correctas.
5. Si las faltas/retardos están en 0 para todos, revisa que la integración Notion tenga acceso a la DB Reporte de Nómina semanal.

## 7. Una sola vez: limpiar duplicados de VENTAS_MESA

Desde el editor de Apps Script, abrir el archivo `bono_productividad`, seleccionar la función `cleanupVentasMesaDuplicates` en el dropdown, y presionar ▶ Ejecutar. Te dirá cuántas filas removió.

## Troubleshooting

**"NOTION_TOKEN no está configurado"** — Paso 3 no se hizo o el secret está mal pegado.

**"Notion API 401" o 403** — La integración no está conectada a la DB. Repetir paso 1.8/1.9.

**Faltas/retardos en cero para todos** — Probablemente la DB Reporte de Nómina semanal no tiene rows en el rango Vie→Jue × 2 que estás pidiendo. Verifica las fechas.

**"Captura pendiente"** — VENTAS_MESA no tiene fila para esas fechas exactas. Crea desde Registro de Ingresos.

**Algún colaborador no aparece** — Verifica en Notion que `Estado = Activo` Y `Mesa / Puesto` tenga un valor en la lista (Cocina/Casa/Producción/Express/Aux Mixto/Repartidor/Líder Tienda). Excluidos por diseño: Louicarlo (#48 Marketing) y Enrique (#65 Granja).
