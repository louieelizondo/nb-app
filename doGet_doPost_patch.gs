/**
 * ═══════════════════════════════════════════════════════════════
 * PATCH: Add these cases to your existing doGet/doPost switches
 * in gastos_script.gs
 * ═══════════════════════════════════════════════════════════════
 *
 * In doGet, add inside the switch(action) block:
 */

// --- ADD TO doGet switch ---
      case 'get_cortes_dia':       return jsonResp(getCortesDia(e.parameter));
      case 'get_corte_tienda':     return jsonResp(getCorteTienda(e.parameter));
      case 'get_arqueos':          return jsonResp(getArqueos(e.parameter));
      case 'get_transferencias':   return jsonResp(getTransferencias(e.parameter));
      case 'get_ingresos':         return jsonResp(getIngresos(e.parameter));
      case 'get_monthly_summary':  return jsonResp(getMonthlySummary(e.parameter));
      case 'get_dashboard_data':   return jsonResp(getDashboardData(e.parameter));
      case 'get_payment_trends':   return jsonResp(getPaymentTrends(e.parameter));
      case 'get_faltante_history': return jsonResp(getFaltanteHistory(e.parameter));
      case 'get_mesa_sales':       return jsonResp(getMesaSales(e.parameter));
      case 'get_config_cajas':     return jsonResp({ cajas: getConfigCajas() });


// --- ADD TO doPost switch ---
      case 'save_corte_individual':  return jsonResp(saveCorteIndividual(body));
      case 'delete_corte_individual': return jsonResp(deleteCorteIndividual(body));
      case 'save_corte_tienda':      return jsonResp(saveCorteTienda(body));
      case 'save_arqueo':            return jsonResp(saveArqueo(body));
      case 'save_transferencia':     return jsonResp(saveTransferencia(body));
      case 'save_ingreso':           return jsonResp(saveIngreso(body));
      case 'update_sobre2':          return jsonResp(updateSobre2(body));
      case 'update_facturacion':     return jsonResp(updateFacturacion(body));
      case 'update_neto_mensual':    return jsonResp(updateNetoMensual(body));
      case 'sync_shopify':           return jsonResp(syncShopifyDaily(body));
      case 'update_config_cajas':    return jsonResp(updateConfigCajas(body));
      case 'add_ingredient':         return jsonResp(addIngredient(body));
      case 'add_proveedor':          return jsonResp(addProveedor(body));


/**
 * ALSO add these actions to the processSyncBatch switch for offline support:
 */
      case 'save_corte_individual':  result = saveCorteIndividual(op); break;
      case 'save_corte_tienda':      result = saveCorteTienda(op); break;
      case 'save_arqueo':            result = saveArqueo(op); break;
      case 'save_transferencia':     result = saveTransferencia(op); break;
      case 'save_ingreso':           result = saveIngreso(op); break;
