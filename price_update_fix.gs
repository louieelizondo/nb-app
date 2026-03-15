/**
 * FIXED updatePrices() — corrected column indexes for current MATERIA PRIMA layout
 *
 * Current layout (March 2026):
 * A(0)=Ingrediente, B(1)=Proveedor A, C(2)=Proveedor B,
 * D(3)=Costo x Paquete ($), E(4)=Fecha de Precio,
 * F(5)=Unidades x Caja, G(6)=Volumen x Unidad,
 * H(7)=Unidad (kg/lt/pza), I(8)=Costo por kg/lt ($)
 *
 * Replace the old updatePrices() in Código.gs with this version.
 */

function updatePrices(body) {
  const items = body.items;
  if (!items || !items.length) throw new Error('No items to update');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mp = ss.getSheetByName(MP_TAB);
  if (!mp) throw new Error('Tab "' + MP_TAB + '" not found');

  const data = mp.getDataRange().getValues();
  // MATERIA PRIMA columns (current layout — March 2026):
  // A(0)=Ingrediente, B(1)=Proveedor A, C(2)=Proveedor B,
  // D(3)=Costo x Paquete ($), E(4)=Fecha de Precio,
  // F(5)=Unidades x Caja, G(6)=Volumen x Unidad, H(7)=Unidad (kg/lt/pza),
  // I(8)=Costo por kg/lt (formula — don't touch)
  let updated = 0;
  const nameCol = 0;     // A = Ingrediente
  const costPaqCol = 3;  // D = Costo x Paquete ($)
  const fechaCol = 4;    // E = Fecha de Precio
  const unidadCol = 7;   // H = Unidad (kg/lt/pza)

  items.forEach(item => {
    const bdName = (item.bd_name || '').trim().toLowerCase();
    // Use precio_unitario (whole-package price from invoice), NOT precio_base (per-kg/L)
    const newPrice = item.precio_unitario || item.price;
    const unidadCompra = (item.unidad_compra || '').trim().toUpperCase();
    if (!bdName || !newPrice) return;

    for (var i = 1; i < data.length; i++) {
      var cellName = String(data[i][nameCol] || '').trim().toLowerCase();
      if (cellName === bdName) {
        mp.getRange(i + 1, costPaqCol + 1).setValue(newPrice);  // Col D: Costo x Paquete
        mp.getRange(i + 1, fechaCol + 1).setValue(new Date());   // Col E: Fecha de Precio
        // Update unit (Col H) if provided
        if (unidadCompra) {
          mp.getRange(i + 1, unidadCol + 1).setValue(unidadCompra);
        }
        // NOTE: Col I (Costo/kg) is a formula — don't touch it
        updated++;
        break;
      }
    }
  });

  log('UPDATE_PRICES', updated + ' updated in MATERIA PRIMA');
  return { ok: true, updated: updated, message: updated + ' prices updated' };
}
