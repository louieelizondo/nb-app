/**
 * ═══════════════════════════════════════════════════════════════
 * NB · Email Notification Functions
 * ═══════════════════════════════════════════════════════════════
 *
 * ADD THIS FILE to your Apps Script project
 * (Extensions → Apps Script → + → Script → name it "notification_functions")
 *
 * These functions send email notifications at key workflow points:
 * - Notify owner when store leader completes corte de tienda
 * - Notify store leader when owner sets Sobre 2
 *
 * REQUIRES: Gmail service permissions (will prompt on first run)
 */

// ══════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════

const LEADER_EMAIL = 'facturacion.nbclub@gmail.com';
const OWNER_EMAIL = 'le.nbclub@gmail.com';
const NB_GREEN = '#4CAF50';
const CORTE_CAJA_APP_URL = 'https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit#gid=YOUR_SHEET_ID';

// ══════════════════════════════════════════════
// HELPER: Format number as Mexican peso
// ══════════════════════════════════════════════

function formatPeso(amount) {
  return '$' + (Math.round(amount * 100) / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// ══════════════════════════════════════════════
// HELPER: Format date as DD/MM/YYYY
// ══════════════════════════════════════════════

function formatFecha(fechaStr) {
  if (!fechaStr) return '';
  const d = new Date(fechaStr);
  if (isNaN(d.getTime())) return fechaStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return day + '/' + month + '/' + year;
}

// ══════════════════════════════════════════════
// Notify owner that store leader completed corte
// ══════════════════════════════════════════════

/**
 * Notify Louie that the store leader has completed the corte de tienda.
 * Called when leader saves corte de tienda with notifyOwner flag.
 *
 * @param {string} fecha - Date in YYYY-MM-DD format
 * @param {number} pagosRecibidos - Total cash received
 * @param {number} faltanteSobrante - Cash shortage/surplus
 * @param {Object} opts - Optional: { colaborador, totalEfectivo, discrepancia }
 */
function notifyOwnerCorteReady(fecha, pagosRecibidos, faltanteSobrante, opts) {
  opts = opts || {};
  const colaborador = opts.colaborador || 'Store Leader';
  const totalEfectivo = opts.totalEfectivo || pagosRecibidos;
  const discrepancia = opts.discrepancia || 0;

  const fechaFormato = formatFecha(fecha);
  const subject = 'NB · Corte de Tienda listo - ' + fechaFormato;

  const htmlBody = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <!-- Header -->
      <tr>
        <td style="background-color: ${NB_GREEN}; padding: 20px; text-align: center;">
          <h2 style="color: white; margin: 0; font-size: 18px;">NB · Corte de Tienda Listo</h2>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0; font-size: 14px;">${fechaFormato}</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding: 20px; background-color: #f9f9f9;">
          <p style="margin: 0 0 15px 0; color: #333; font-size: 14px;">
            <strong>${colaborador}</strong> ha completado el corte de tienda.
          </p>

          <!-- Key Numbers -->
          <table width="100%" cellpadding="10" cellspacing="0" border="1" style="border-collapse: collapse; border-color: #e0e0e0; margin-bottom: 15px; background-color: white;">
            <tr style="background-color: #f5f5f5;">
              <td style="border-color: #e0e0e0; color: #666; font-size: 12px; font-weight: bold;">Concepto</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #666; font-size: 12px; font-weight: bold;">Monto</td>
            </tr>
            <tr>
              <td style="border-color: #e0e0e0; color: #333; font-size: 13px;">Pagos Recibidos</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #333; font-size: 13px; font-weight: bold;">${formatPeso(pagosRecibidos)}</td>
            </tr>
            <tr style="background-color: #f9f9f9;">
              <td style="border-color: #e0e0e0; color: #333; font-size: 13px;">Faltante/Sobrante</td>
              <td style="border-color: #e0e0e0; text-align: right; color: ${faltanteSobrante < 0 ? '#d32f2f' : '#388e3c'}; font-size: 13px; font-weight: bold;">${formatPeso(faltanteSobrante)}</td>
            </tr>
            ${discrepancia !== 0 ? `
            <tr>
              <td style="border-color: #e0e0e0; color: #666; font-size: 13px;">Discrepancia Shopify</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #666; font-size: 13px;">${formatPeso(discrepancia)}</td>
            </tr>
            ` : ''}
          </table>

          <!-- Call to Action -->
          <p style="margin: 15px 0; color: #333; font-size: 14px;">
            <strong>Siguiente paso:</strong> Ingresa al Registro de Ingresos para asignar Sobre 2 (Socios + Nóminas).
          </p>

          <!-- Footer -->
          <p style="margin: 20px 0 0 0; padding-top: 15px; border-top: 1px solid #e0e0e0; color: #999; font-size: 11px;">
            Este correo fue generado automáticamente por el sistema NB.
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    GmailApp.sendEmail(OWNER_EMAIL, subject, '', {
      htmlBody: htmlBody,
      from: 'noreply@nbclub.com',
      name: 'NB System'
    });
    log('NOTIFY_OWNER_CORTE', fecha + ' | ' + colaborador + ' | To: ' + OWNER_EMAIL);
  } catch (err) {
    log('NOTIFY_ERROR', 'notifyOwnerCorteReady: ' + err.message);
  }
}

// ══════════════════════════════════════════════
// Notify leader that owner set Sobre 2
// ══════════════════════════════════════════════

/**
 * Notify the store leader that Louie has set the Sobre 2.
 * Called when owner saves ingreso with notifyLeader flag.
 *
 * @param {string} fecha - Date in YYYY-MM-DD format
 * @param {number} deposito - Amount to deposit (pagosRecibidos - sobre2)
 * @param {number} sobre2 - Total Sobre 2 (socios + nominas)
 * @param {number} socios - Socios portion
 * @param {number} nominas - Nóminas portion
 */
function notifyLeaderSobre2Ready(fecha, deposito, sobre2, socios, nominas) {
  const fechaFormato = formatFecha(fecha);
  const subject = 'NB · Sobre 2 listo - ' + fechaFormato;

  const htmlBody = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <!-- Header -->
      <tr>
        <td style="background-color: ${NB_GREEN}; padding: 20px; text-align: center;">
          <h2 style="color: white; margin: 0; font-size: 18px;">NB · Sobre 2 Listo</h2>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0; font-size: 14px;">${fechaFormato}</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding: 20px; background-color: #f9f9f9;">
          <p style="margin: 0 0 15px 0; color: #333; font-size: 14px;">
            Louie ha procesado el registro de ingresos.
          </p>

          <!-- Key Numbers -->
          <table width="100%" cellpadding="12" cellspacing="0" border="1" style="border-collapse: collapse; border-color: #e0e0e0; margin-bottom: 15px; background-color: white;">
            <tr style="background-color: #f5f5f5;">
              <td style="border-color: #e0e0e0; color: #666; font-size: 12px; font-weight: bold;">Concepto</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #666; font-size: 12px; font-weight: bold;">Monto</td>
            </tr>
            <tr style="background-color: #e8f5e9;">
              <td style="border-color: #e0e0e0; color: #1b5e20; font-size: 13px; font-weight: bold;">Depositar a BBVA</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #1b5e20; font-size: 14px; font-weight: bold;">${formatPeso(deposito)}</td>
            </tr>
            <tr>
              <td style="border-color: #e0e0e0; color: #333; font-size: 13px;">├ Socios</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #666; font-size: 13px; padding-left: 30px;">${formatPeso(socios)}</td>
            </tr>
            <tr style="background-color: #f9f9f9;">
              <td style="border-color: #e0e0e0; color: #333; font-size: 13px;">└ Nóminas</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #666; font-size: 13px; padding-left: 30px;">${formatPeso(nominas)}</td>
            </tr>
            <tr style="background-color: #fff3e0;">
              <td style="border-color: #e0e0e0; color: #333; font-size: 13px; font-weight: bold;">Sobre 2 Total</td>
              <td style="border-color: #e0e0e0; text-align: right; color: #333; font-size: 13px; font-weight: bold;">${formatPeso(sobre2)}</td>
            </tr>
          </table>

          <!-- Action Items -->
          <div style="background-color: #e3f2fd; border-left: 4px solid ${NB_GREEN}; padding: 12px; margin-bottom: 15px; border-radius: 2px;">
            <p style="margin: 0; color: #1565c0; font-size: 13px; font-weight: bold;">Próximos pasos:</p>
            <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #333; font-size: 12px;">
              <li>Abre la app Corte de Caja en la pestaña de Depósitos</li>
              <li>Registra el depósito a BBVA</li>
              <li>Prepara el Sobre 2 con la distribución indicada</li>
            </ul>
          </div>

          <!-- Footer -->
          <p style="margin: 20px 0 0 0; padding-top: 15px; border-top: 1px solid #e0e0e0; color: #999; font-size: 11px;">
            Este correo fue generado automáticamente por el sistema NB.
          </p>
        </td>
      </tr>
    </table>
  `;

  try {
    GmailApp.sendEmail(LEADER_EMAIL, subject, '', {
      htmlBody: htmlBody,
      from: 'noreply@nbclub.com',
      name: 'NB System'
    });
    log('NOTIFY_LEADER_SOBRE2', fecha + ' | Deposito: ' + formatPeso(deposito) + ' | Sobre2: ' + formatPeso(sobre2));
  } catch (err) {
    log('NOTIFY_ERROR', 'notifyLeaderSobre2Ready: ' + err.message);
  }
}
