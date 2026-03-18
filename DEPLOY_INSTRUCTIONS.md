# Shopify API Integration — Apps Script Deploy Guide

## File 1: `gastos_script.gs`

Find your `doGet` switch statement. Add these 4 new cases **BEFORE** the `default:` line:

```javascript
      // Shopify API
      case 'get_shopify_daily_summary': return jsonResp(getShopifyDailySummary(e.parameter));
      case 'get_shopify_products':      return jsonResp(getShopifyProducts(e.parameter));
      case 'get_shopify_inventory':     return jsonResp(getShopifyInventory(e.parameter));
      case 'shopify_health':            return jsonResp(shopifyHealthCheck());
```

That's it for gastos_script.gs. Just 4 lines.

---

## File 2: `cortes_ingresos.gs`

Paste the ENTIRE block below at the **end of `syncShopifyDaily()`** function (after its closing `}`), right before `getFaltanteHistory()`.

```javascript
// ══════════════════════════════════════════════
// SHOPIFY API — REUSABLE HELPERS & EXTENDED ROUTES
// ══════════════════════════════════════════════

/**
 * Reusable Shopify GraphQL fetch. Returns parsed JSON or throws.
 */
function shopifyFetch(query) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SHOPIFY_TOKEN');
  const store = props.getProperty('SHOPIFY_STORE');

  if (!token || !store) {
    throw new Error('Shopify not configured. Set SHOPIFY_TOKEN and SHOPIFY_STORE in Script Properties.');
  }

  const apiVersion = '2025-01';
  const url = 'https://' + store + '.myshopify.com/admin/api/' + apiVersion + '/graphql.json';

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': token },
    payload: JSON.stringify({ query }),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Shopify API error ' + code + ': ' + resp.getContentText().slice(0, 300));
  }

  const result = JSON.parse(resp.getContentText());
  if (result.errors) {
    throw new Error('Shopify GraphQL error: ' + JSON.stringify(result.errors).slice(0, 300));
  }
  return result;
}

/**
 * Map Shopify payment gateway string to NB category.
 */
function mapShopifyGateway(gateway) {
  const g = (gateway || '').toLowerCase();
  if (g.includes('cash') && !g.includes('back')) return 'efectivo';
  if (g.includes('card') || g.includes('tarjeta') || g.includes('stripe') || g.includes('shopify_payments')) return 'tarjeta';
  if (g.includes('transfer') || g.includes('bank')) return 'transferencias';
  if (g.includes('cashback')) return 'cashback';
  if (g.includes('store_credit') || g.includes('gift_card')) return 'storeCredit';
  return 'efectivo'; // unknown → default cash
}

/**
 * GET: Aggregated Shopify daily summary.
 * Params: fecha (single day) OR month + year (full month aggregate)
 * Returns: totals, payment breakdown, order count, avg order, channel split, top products
 */
function getShopifyDailySummary(params) {
  const fecha = params.fecha;
  const month = parseInt(params.month);
  const year = parseInt(params.year);

  // Build date filter
  let dateFilter;
  if (fecha) {
    dateFilter = "created_at:>='" + fecha + "T00:00:00' created_at:<='" + fecha + "T23:59:59'";
  } else if (month && year) {
    const startDate = year + '-' + String(month).padStart(2, '0') + '-01';
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
    dateFilter = "created_at:>='" + startDate + "T00:00:00' created_at:<='" + endDate + "T23:59:59'";
  } else {
    // Default: today
    const today = formatDateStr(new Date());
    dateFilter = "created_at:>='" + today + "T00:00:00' created_at:<='" + today + "T23:59:59'";
  }

  // Fetch orders with pagination (up to 750 orders = 3 pages)
  let allOrders = [];
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    const afterClause = cursor ? ', after: "' + cursor + '"' : '';
    const query = `{
      orders(first: 250, query: "${dateFilter}"${afterClause}) {
        edges {
          cursor
          node {
            name
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            channelInformation { channelDefinition { handle } }
            transactions(first: 10) {
              gateway
              kind
              status
              amountSet { shopMoney { amount } }
            }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  originalTotalSet { shopMoney { amount } }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`;

    const result = shopifyFetch(query);
    const edges = result.data?.orders?.edges || [];
    allOrders = allOrders.concat(edges);

    if (!result.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1].cursor;
  }

  // Aggregate
  let totalSales = 0;
  let payments = { efectivo: 0, tarjeta: 0, transferencias: 0, cashback: 0, storeCredit: 0 };
  let channels = { online: 0, pos: 0 };
  let productMap = {}; // title → { qty, revenue }
  let dailyMap = {};   // YYYY-MM-DD → totalSales

  allOrders.forEach(({ node: order }) => {
    const total = parseFloat(order.totalPriceSet?.shopMoney?.amount) || 0;
    totalSales += total;

    // Channel split
    const channel = (order.channelInformation?.channelDefinition?.handle || '').toLowerCase();
    if (channel.includes('point_of_sale') || channel.includes('pos')) {
      channels.pos += total;
    } else {
      channels.online += total;
    }

    // Daily breakdown (for monthly queries)
    const orderDate = (order.createdAt || '').slice(0, 10);
    if (orderDate) {
      dailyMap[orderDate] = (dailyMap[orderDate] || 0) + total;
    }

    // Payment breakdown from transactions
    (order.transactions || []).forEach(tx => {
      if (tx.kind !== 'SALE' && tx.kind !== 'sale') return;
      if (tx.status !== 'SUCCESS' && tx.status !== 'success') return;
      const amount = parseFloat(tx.amountSet?.shopMoney?.amount) || 0;
      const category = mapShopifyGateway(tx.gateway);
      payments[category] = (payments[category] || 0) + amount;
    });

    // Product aggregation
    (order.lineItems?.edges || []).forEach(({ node: item }) => {
      const title = item.title || 'Sin nombre';
      if (!productMap[title]) productMap[title] = { qty: 0, revenue: 0 };
      productMap[title].qty += item.quantity || 0;
      productMap[title].revenue += parseFloat(item.originalTotalSet?.shopMoney?.amount) || 0;
    });
  });

  // Top 5 products by revenue
  const topProducts = Object.entries(productMap)
    .map(([title, data]) => ({ title, qty: data.qty, revenue: Math.round(data.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Daily breakdown array (sorted)
  const dailyBreakdown = Object.entries(dailyMap)
    .map(([date, sales]) => ({ date, sales: Math.round(sales * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    ok: true,
    orderCount: allOrders.length,
    totalSales: Math.round(totalSales * 100) / 100,
    avgOrderValue: allOrders.length > 0 ? Math.round((totalSales / allOrders.length) * 100) / 100 : 0,
    payments: {
      efectivo: Math.round(payments.efectivo * 100) / 100,
      tarjeta: Math.round(payments.tarjeta * 100) / 100,
      transferencias: Math.round(payments.transferencias * 100) / 100,
      cashback: Math.round(payments.cashback * 100) / 100,
      storeCredit: Math.round(payments.storeCredit * 100) / 100
    },
    channels: {
      online: Math.round(channels.online * 100) / 100,
      pos: Math.round(channels.pos * 100) / 100
    },
    topProducts,
    dailyBreakdown,
    fecha: fecha || (year + '-' + String(month).padStart(2, '0'))
  };
}

/**
 * GET: Shopify product catalog with inventory quantities.
 * Returns all active products with variants, prices, SKUs.
 */
function getShopifyProducts(params) {
  let allProducts = [];
  let cursor = null;

  for (let page = 0; page < 4; page++) { // up to 1000 products
    const afterClause = cursor ? ', after: "' + cursor + '"' : '';
    const query = `{
      products(first: 250, query: "status:active"${afterClause}) {
        edges {
          cursor
          node {
            id
            title
            productType
            status
            totalInventory
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryQuantity
                  inventoryItem { id }
                }
              }
            }
            images(first: 1) {
              edges { node { url } }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`;

    const result = shopifyFetch(query);
    const edges = result.data?.products?.edges || [];
    allProducts = allProducts.concat(edges);

    if (!result.data?.products?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1].cursor;
  }

  const products = allProducts.map(({ node: p }) => ({
    id: p.id,
    title: p.title,
    productType: p.productType,
    totalInventory: p.totalInventory,
    imageUrl: p.images?.edges?.[0]?.node?.url || '',
    variants: (p.variants?.edges || []).map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: parseFloat(v.price) || 0,
      inventoryQuantity: v.inventoryQuantity || 0,
      inventoryItemId: v.inventoryItem?.id || ''
    }))
  }));

  return { ok: true, products, count: products.length };
}

/**
 * GET: Shopify inventory levels per location.
 * Returns stock per product/variant per location.
 */
function getShopifyInventory(params) {
  // First get locations
  const locQuery = `{ locations(first: 10) { edges { node { id name } } } }`;
  const locResult = shopifyFetch(locQuery);
  const locations = (locResult.data?.locations?.edges || []).map(({ node }) => ({
    id: node.id,
    name: node.name
  }));

  // Then get inventory levels for each location
  const inventoryByLocation = [];

  for (const loc of locations) {
    // Extract numeric ID from gid
    const locGid = loc.id;
    const query = `{
      location(id: "${locGid}") {
        inventoryLevels(first: 250) {
          edges {
            node {
              available
              item {
                id
                variant {
                  id
                  title
                  sku
                  product { id title }
                }
              }
            }
          }
        }
      }
    }`;

    try {
      const result = shopifyFetch(query);
      const levels = (result.data?.location?.inventoryLevels?.edges || []).map(({ node }) => ({
        locationId: locGid,
        locationName: loc.name,
        available: node.available,
        inventoryItemId: node.item?.id || '',
        variantId: node.item?.variant?.id || '',
        variantTitle: node.item?.variant?.title || '',
        sku: node.item?.variant?.sku || '',
        productId: node.item?.variant?.product?.id || '',
        productTitle: node.item?.variant?.product?.title || ''
      }));
      inventoryByLocation.push(...levels);
    } catch (e) {
      log('SHOPIFY_INVENTORY_ERROR', loc.name + ': ' + e.message);
    }
  }

  return {
    ok: true,
    locations,
    inventory: inventoryByLocation,
    count: inventoryByLocation.length
  };
}

/**
 * GET: Quick Shopify health check — verifies token works.
 */
function shopifyHealthCheck() {
  try {
    const result = shopifyFetch('{ shop { name myshopifyDomain } }');
    return {
      ok: true,
      shop: result.data?.shop?.name,
      domain: result.data?.shop?.myshopifyDomain,
      message: 'Shopify connection verified'
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Auto daily sync wrapper — for time-driven trigger.
 * Call this at 11:30 PM to auto-populate Corte de Tienda Shopify columns.
 */
function autoSyncShopifyDaily() {
  const today = formatDateStr(new Date());
  const result = syncShopifyDaily({ fecha: today });
  log('AUTO_SHOPIFY_SYNC', today + ' | ' + JSON.stringify(result).slice(0, 200));
  return result;
}
```

---

## After Pasting

1. **Save** (Ctrl+S)
2. **Deploy** → Manage deployments → Edit → Version: New version → Deploy
3. **Test**: Visit `YOUR_SCRIPT_URL?action=shopify_health` — should return `{"ok":true,"shop":"Natural Balance Club",...}`
