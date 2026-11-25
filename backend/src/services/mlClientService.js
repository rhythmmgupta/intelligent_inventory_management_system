const config = require('../config/env');
const logger = require('../config/logger');
const { mlFallbackCounter } = require('../config/metrics');
const Product = require('../models/Product');
const SalesRecord = require('../models/SalesRecord');
const MlModelRun = require('../models/MlModelRun');
const { getStoreToday, addDaysUTC, formatISODate, toDateOnlyUTC, diffCalendarDays } = require('../utils/dateUtils');

async function callMlService(path, options = {}) {
  const url = `${config.mlServiceUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs || config.mlTimeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ML service ${path} returned ${response.status}: ${body}`);
  }
  return response.json();
}

async function pingMlService() {
  try {
    const data = await callMlService('/health', { method: 'GET', timeoutMs: 2000 });
    return Boolean(data && data.status === 'ok');
  } catch {
    return false;
  }
}

/**
 * Aggregates daily unit sales per product over the past lookbackDays.
 */
async function buildDailySalesSeries(productIds = null, lookbackDays = 180) {
  const today = getStoreToday();
  const startDate = addDaysUTC(today, -lookbackDays);

  const match = { saleDate: { $gte: startDate } };
  if (productIds && productIds.length > 0) {
    match.productId = { $in: productIds };
  }

  const rows = await SalesRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          productId: '$productId',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$saleDate' } },
        },
        unitsSold: { $sum: '$quantitySold' },
        avgPrice: { $avg: '$unitSellingPrice' },
        wasDiscounted: { $max: { $cond: ['$wasDiscounted', 1, 0] } },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  const byProduct = new Map();
  for (const row of rows) {
    const pid = row._id.productId.toString();
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid).push({
      date: row._id.date,
      units_sold: Number(row.unitsSold.toFixed(2)),
      unit_price: Number((row.avgPrice || 0).toFixed(2)),
      was_discounted: row.wasDiscounted || 0,
    });
  }
  return byProduct;
}

/**
 * Deterministic moving-average + expiry-aware FEFO forward simulation fallback.
 * Used when ML service is unreachable or a product has fewer than 14 days of history.
 */
function computeRuleFallbackPrediction(productWithStock, dailySeries = [], storeConfig = {}) {
  const recent = dailySeries.slice(-14);
  const avgDaily =
    recent.length > 0
      ? recent.reduce((acc, r) => acc + r.units_sold, 0) / recent.length
      : Math.max(1, productWithStock.minStockThreshold / 5);

  const stdDaily =
    recent.length > 1
      ? Math.sqrt(
          recent.reduce((acc, r) => acc + (r.units_sold - avgDaily) ** 2, 0) / recent.length
        )
      : avgDaily * 0.25;

  const today = getStoreToday();
  const activeBatches = (productWithStock.batches || [])
    .filter((b) => b.isActiveUsable && b.remainingQuantity > 0)
    .map((b) => ({
      remaining: b.remainingQuantity,
      daysLeft: Math.max(0, diffCalendarDays(toDateOnlyUTC(b.expiryDate), today)),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  let predictedStockoutDays = null;
  let projectedSpoilage = 0;

  for (let day = 0; day < 30; day += 1) {
    // Expire batches whose shelf life ended before today + day
    for (const batch of activeBatches) {
      if (batch.daysLeft < day && batch.remaining > 0) {
        projectedSpoilage += batch.remaining;
        batch.remaining = 0;
      }
    }
    let demandLeft = avgDaily;
    for (const batch of activeBatches) {
      if (demandLeft <= 0) break;
      if (batch.remaining <= 0) continue;
      const take = Math.min(batch.remaining, demandLeft);
      batch.remaining -= take;
      demandLeft -= take;
    }
    const surviving = activeBatches.reduce((sum, b) => sum + b.remaining, 0);
    if (surviving <= 0.01 && predictedStockoutDays === null) {
      predictedStockoutDays = day + 1;
      break;
    }
  }

  const leadTime = productWithStock.leadTimeDays || storeConfig.defaultLeadTimeDays || 3;
  const coverDays = storeConfig.targetCoverDays || 10;
  const zScore = storeConfig.safetyServiceZScore || 1.28;
  const safetyStock = zScore * stdDaily * Math.sqrt(leadTime);
  const rop = Math.ceil(avgDaily * leadTime + safetyStock);

  const usableNow = productWithStock.activeUsableQuantity || 0;
  const stockoutRisk =
    usableNow <= 0
      ? 'HIGH'
      : predictedStockoutDays !== null && predictedStockoutDays <= leadTime + 2
      ? 'HIGH'
      : usableNow <= rop
      ? 'MEDIUM'
      : 'LOW';

  const recommendedReorderQty =
    usableNow <= rop || (predictedStockoutDays !== null && predictedStockoutDays <= leadTime + 3)
      ? Math.max(1, Math.ceil(avgDaily * coverDays + safetyStock - usableNow))
      : 0;

  const forecast7 = Array.from({ length: 7 }, (_, i) => ({
    date: formatISODate(addDaysUTC(today, i + 1)),
    predicted_units: Number(avgDaily.toFixed(2)),
    lower_bound: Number(Math.max(0, avgDaily - 1.28 * stdDaily).toFixed(2)),
    upper_bound: Number((avgDaily + 1.28 * stdDaily).toFixed(2)),
  }));

  return {
    productId: productWithStock.id,
    sku: productWithStock.sku,
    productName: productWithStock.name,
    predictedDailyDemand: Number(avgDaily.toFixed(2)),
    predicted7DayDemand: Number((avgDaily * 7).toFixed(2)),
    demandStdDev: Number(stdDaily.toFixed(2)),
    predictedStockoutDays,
    projectedSpoilageUnits: Number(projectedSpoilage.toFixed(2)),
    stockoutRisk,
    stockoutProbability: stockoutRisk === 'HIGH' ? 0.85 : stockoutRisk === 'MEDIUM' ? 0.52 : 0.12,
    recommendedReorderPoint: rop,
    recommendedReorderQuantity: recommendedReorderQty,
    predictionSource: 'rule_fallback',
    modelUsed: 'MovingAverage14dFallback',
    explanation:
      recent.length < 14
        ? `Cold-start fallback: only ${recent.length} day(s) of sales history (<14 required for ML), using ${avgDaily.toFixed(2)} units/day average.`
        : `Rule-based 14-day moving average (${avgDaily.toFixed(2)} units/day) used while ML service was bypassed or unavailable.`,
    forecastHorizon: forecast7,
  };
}

/**
 * Predicts demand and expiry-aware stockout risk for one or many products via FastAPI,
 * falling back cleanly if the ML container is offline or SKU history is below threshold.
 */
async function predictForProducts(productsWithStock, storeConfig = {}) {
  if (!productsWithStock.length) return {};
  const productIds = productsWithStock.map((p) => p._id || p.id);
  const salesMap = await buildDailySalesSeries(productIds, 180);

  const mlEligible = [];
  const results = {};

  for (const item of productsWithStock) {
    const series = salesMap.get(item.id) || [];
    if (series.length < 14) {
      results[item.id] = computeRuleFallbackPrediction(item, series, storeConfig);
    } else {
      mlEligible.push({ item, series });
    }
  }

  if (mlEligible.length === 0) {
    return results;
  }

  try {
    const payload = {
      horizon_days: 7,
      target_cover_days: storeConfig.targetCoverDays || 10,
      safety_z_score: storeConfig.safetyServiceZScore || 1.28,
      products: mlEligible.map(({ item, series }) => ({
        product_id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        selling_price: item.sellingPrice,
        lead_time_days: item.leadTimeDays || storeConfig.defaultLeadTimeDays || 3,
        min_stock_threshold: item.minStockThreshold,
        active_usable_quantity: item.activeUsableQuantity,
        batches: (item.batches || [])
          .filter((b) => b.isActiveUsable && b.remainingQuantity > 0)
          .map((b) => ({
            remaining_quantity: b.remainingQuantity,
            expiry_date: formatISODate(b.expiryDate),
          })),
        sales_history: series,
      })),
    };

    const mlResponse = await callMlService('/predict/stockout-risk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    for (const pred of mlResponse.predictions || []) {
      results[pred.product_id] = {
        productId: pred.product_id,
        sku: pred.sku,
        productName: pred.name,
        predictedDailyDemand: pred.predicted_daily_demand,
        predicted7DayDemand: pred.predicted_7day_demand,
        demandStdDev: pred.demand_std_dev,
        predictedStockoutDays: pred.predicted_stockout_days,
        projectedSpoilageUnits: pred.projected_spoilage_units,
        stockoutRisk: pred.stockout_risk,
        stockoutProbability: pred.stockout_probability,
        recommendedReorderPoint: pred.recommended_reorder_point,
        recommendedReorderQuantity: pred.recommended_reorder_quantity,
        predictionSource: pred.prediction_source || 'ml_model',
        modelUsed: pred.model_used,
        explanation: pred.explanation,
        forecastHorizon: pred.forecast_horizon || [],
      };
    }

    // Fill any unreturned products gracefully
    for (const { item, series } of mlEligible) {
      if (!results[item.id]) {
        results[item.id] = computeRuleFallbackPrediction(item, series, storeConfig);
      }
    }
  } catch (err) {
    logger.warn('ML service unreachable; falling back to moving-average predictions', {
      error: err.message,
    });
    mlFallbackCounter.inc();
    for (const { item, series } of mlEligible) {
      results[item.id] = computeRuleFallbackPrediction(item, series, storeConfig);
    }
  }

  return results;
}

/**
 * Triggers ML training using real MongoDB sales history and stores benchmark metrics.
 */
async function triggerModelTraining() {
  const products = await Product.find({ isActive: true }).lean();
  const salesMap = await buildDailySalesSeries(
    products.map((p) => p._id),
    365
  );

  const trainingPayload = {
    products: products.map((p) => ({
      product_id: p._id.toString(),
      sku: p.sku,
      name: p.name,
      category: p.category,
      selling_price: p.sellingPrice,
      lead_time_days: p.leadTimeDays || 3,
      min_stock_threshold: p.minStockThreshold,
      sales_history: salesMap.get(p._id.toString()) || [],
    })),
  };

  const result = await callMlService('/train', {
    method: 'POST',
    body: JSON.stringify(trainingPayload),
    timeoutMs: 25000,
  });

  await MlModelRun.updateMany({ isActiveModel: true }, { $set: { isActiveModel: false } });
  const runDoc = await MlModelRun.create({
    runId: result.run_id,
    selectedDemandAlgorithm: result.selected_demand_algorithm,
    selectedClassifierAlgorithm: result.selected_classifier_algorithm,
    metrics: result.metrics,
    trainingRows: result.training_rows,
    featureImportance: result.feature_importance || [],
    trainedAt: new Date(),
    isActiveModel: true,
  });

  return runDoc;
}

module.exports = {
  pingMlService,
  buildDailySalesSeries,
  computeRuleFallbackPrediction,
  predictForProducts,
  triggerModelTraining,
};
