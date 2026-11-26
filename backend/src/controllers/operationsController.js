const SalesRecord = require('../models/SalesRecord');
const WasteLog = require('../models/WasteLog');
const ReorderRecommendation = require('../models/ReorderRecommendation');
const MlModelRun = require('../models/MlModelRun');
const AuditLog = require('../models/AuditLog');
const StoreConfig = require('../models/StoreConfig');
const AppError = require('../utils/AppError');
const { recordSaleFEFO } = require('../services/fefoService');
const {
  logWasteDisposal,
  getWasteAnalytics,
  generateWasteRecommendations,
} = require('../services/wasteService');
const { loadAllInventoryWithStock, getStoreConfig } = require('../services/inventoryQueryService');
const {
  predictForProducts,
  buildDailySalesSeries,
  triggerModelTraining,
} = require('../services/mlClientService');
const { recordAudit } = require('../services/auditService');
const { addDaysUTC, getStoreToday } = require('../utils/dateUtils');

// --- Sales (FEFO) ---
async function createSale(req, res, next) {
  try {
    const sale = await recordSaleFEFO({
      productId: req.body.productId,
      quantitySold: req.body.quantitySold,
      unitSellingPrice: req.body.unitSellingPrice,
      wasDiscounted: req.body.wasDiscounted,
      saleDate: req.body.saleDate ? new Date(req.body.saleDate) : new Date(),
      req,
    });
    return res.status(201).json({ sale });
  } catch (err) {
    return next(err);
  }
}

async function listSales(req, res, next) {
  try {
    const limit = Math.min(100, Number(req.query.limit || 40));
    const sales = await SalesRecord.find()
      .populate('productId', 'name sku unit category')
      .sort({ saleDate: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ sales });
  } catch (err) {
    return next(err);
  }
}

// --- Waste & Reduction ---
async function createWasteLog(req, res, next) {
  try {
    const result = await logWasteDisposal({
      batchId: req.body.batchId,
      quantityWasted: req.body.quantityWasted,
      reason: req.body.reason,
      notes: req.body.notes,
      req,
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function listWasteLogs(req, res, next) {
  try {
    const limit = Math.min(100, Number(req.query.limit || 50));
    const logs = await WasteLog.find()
      .populate('productId', 'name sku unit category')
      .sort({ wastedAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ logs });
  } catch (err) {
    return next(err);
  }
}

async function getWasteReport(req, res, next) {
  try {
    const periodDays = req.query.periodDays ? Number(req.query.periodDays) : 30;
    const analytics = await getWasteAnalytics({
      periodDays,
      category: req.query.category || null,
      supplier: req.query.supplier || null,
    });
    return res.json(analytics);
  } catch (err) {
    return next(err);
  }
}

async function getWasteRecommendationsController(req, res, next) {
  try {
    const { allItems, storeConfig } = await loadAllInventoryWithStock();
    const predictions = await predictForProducts(allItems, storeConfig);
    const recommendations = await generateWasteRecommendations(allItems, predictions, storeConfig);
    return res.json({ recommendations });
  } catch (err) {
    return next(err);
  }
}

// --- Reorders & Predictions ---
async function getReorderRecommendations(req, res, next) {
  try {
    const { allItems, storeConfig } = await loadAllInventoryWithStock();
    const predictions = await predictForProducts(allItems, storeConfig);

    const existingOpen = await ReorderRecommendation.find({
      status: { $in: ['pending', 'approved'] },
    }).lean();
    const existingByProduct = new Map(existingOpen.map((r) => [r.productId.toString(), r]));

    const recommendations = [];
    for (const item of allItems) {
      const pred = predictions[item.id];
      const needsReorder =
        item.availabilityStatus !== 'in_stock' ||
        (pred && pred.recommendedReorderQuantity > 0);

      if (!needsReorder) continue;

      const urgency =
        item.availabilityStatus === 'out_of_stock' ||
        (pred && pred.stockoutRisk === 'HIGH')
          ? 'critical'
          : item.availabilityStatus === 'low_stock' || (pred && pred.stockoutRisk === 'MEDIUM')
          ? 'high'
          : 'normal';

      const recommendedQuantity =
        pred && pred.recommendedReorderQuantity > 0
          ? pred.recommendedReorderQuantity
          : item.reorderQuantity;

      const existing = existingByProduct.get(item.id);
      let doc;
      if (existing) {
        doc = await ReorderRecommendation.findByIdAndUpdate(
          existing._id,
          {
            activeStockAtGeneration: item.activeUsableQuantity,
            predictedDailyDemand: pred ? pred.predictedDailyDemand : 0,
            recommendedReorderPoint: pred ? pred.recommendedReorderPoint : item.minStockThreshold,
            recommendedQuantity,
            predictedStockoutDays: pred ? pred.predictedStockoutDays : null,
            predictionSource: pred ? pred.predictionSource : 'rule_fallback',
            explanation: pred ? pred.explanation : 'Static minimum threshold breach.',
            urgency,
          },
          { new: true }
        ).lean();
      } else {
        const created = await ReorderRecommendation.create({
          productId: item._id,
          activeStockAtGeneration: item.activeUsableQuantity,
          predictedDailyDemand: pred ? pred.predictedDailyDemand : 0,
          recommendedReorderPoint: pred ? pred.recommendedReorderPoint : item.minStockThreshold,
          recommendedQuantity,
          predictedStockoutDays: pred ? pred.predictedStockoutDays : null,
          predictionSource: pred ? pred.predictionSource : 'rule_fallback',
          explanation: pred ? pred.explanation : 'Static minimum threshold breach.',
          urgency,
        });
        doc = created.toObject();
      }

      recommendations.push({
        ...doc,
        product: {
          id: item.id,
          sku: item.sku,
          name: item.name,
          category: item.category,
          unit: item.unit,
          supplier: item.defaultSupplier,
          minStockThreshold: item.minStockThreshold,
          expiredQuantity: item.expiredQuantity,
          availabilityStatus: item.availabilityStatus,
        },
      });
    }

    const rank = { critical: 0, high: 1, normal: 2 };
    recommendations.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
    return res.json({ recommendations });
  } catch (err) {
    return next(err);
  }
}

async function updateReorderStatus(req, res, next) {
  try {
    const rec = await ReorderRecommendation.findByIdAndUpdate(
      req.params.id,
      {
        status: req.body.status,
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
      },
      { new: true }
    );
    if (!rec) return next(new AppError(404, 'Reorder recommendation not found.'));

    await recordAudit({
      req,
      action: 'REORDER_STATUS_UPDATED',
      targetCollection: 'reorder_recommendations',
      targetId: rec._id.toString(),
      summary: `Marked reorder recommendation as ${req.body.status}`,
    });

    return res.json({ recommendation: rec });
  } catch (err) {
    return next(err);
  }
}

async function getProductForecast(req, res, next) {
  try {
    const { allItems, storeConfig } = await loadAllInventoryWithStock();
    const item = allItems.find((p) => p.id === req.params.productId);
    if (!item) return next(new AppError(404, 'Product not found.'));

    const [predictions, salesMap] = await Promise.all([
      predictForProducts([item], storeConfig),
      buildDailySalesSeries([item._id], 30),
    ]);

    return res.json({
      product: {
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        unit: item.unit,
        activeUsableQuantity: item.activeUsableQuantity,
        expiredQuantity: item.expiredQuantity,
        minStockThreshold: item.minStockThreshold,
      },
      historicalSales: salesMap.get(item.id) || [],
      prediction: predictions[item.id],
    });
  } catch (err) {
    return next(err);
  }
}

async function getStockoutPredictions(req, res, next) {
  try {
    const { allItems, storeConfig } = await loadAllInventoryWithStock();
    const predictions = await predictForProducts(allItems, storeConfig);
    const list = allItems.map((item) => ({
      productId: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      unit: item.unit,
      supplier: item.defaultSupplier,
      activeUsableQuantity: item.activeUsableQuantity,
      expiredQuantity: item.expiredQuantity,
      nearExpiryQuantity: item.nearExpiryQuantity,
      minStockThreshold: item.minStockThreshold,
      availabilityStatus: item.availabilityStatus,
      ...predictions[item.id],
    }));
    return res.json({ predictions: list });
  } catch (err) {
    return next(err);
  }
}

async function getMlMetrics(_req, res, next) {
  try {
    const latestRun = await MlModelRun.findOne({ isActiveModel: true }).sort({ trainedAt: -1 }).lean();
    return res.json({ modelRun: latestRun });
  } catch (err) {
    return next(err);
  }
}

async function retrainModels(req, res, next) {
  try {
    const runDoc = await triggerModelTraining();
    await recordAudit({
      req,
      action: 'ML_RETRAINED',
      targetCollection: 'ml_model_runs',
      targetId: runDoc._id.toString(),
      summary: `Retrained ML models (${runDoc.selectedDemandAlgorithm}, rows=${runDoc.trainingRows})`,
    });
    return res.json({ modelRun: runDoc });
  } catch (err) {
    return next(err);
  }
}

// --- Dashboard ---
async function getDashboardSummary(req, res, next) {
  try {
    const nearExpiryDays = req.query.nearExpiryDays ? Number(req.query.nearExpiryDays) : null;
    const { allItems, storeConfig } = await loadAllInventoryWithStock({ nearExpiryDays });
    const [predictions, wasteAnalytics, recentActivity, latestModelRun] = await Promise.all([
      predictForProducts(allItems, storeConfig),
      getWasteAnalytics({ periodDays: 30 }),
      AuditLog.find({ action: { $nin: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT'] } })
        .sort({ timestamp: -1 })
        .limit(12)
        .lean(),
      MlModelRun.findOne({ isActiveModel: true }).sort({ trainedAt: -1 }).lean(),
    ]);

    const wasteRecommendations = await generateWasteRecommendations(
      allItems,
      predictions,
      storeConfig
    );

    let totalActiveStock = 0;
    let totalExpiredStock = 0;
    let totalNearExpiryStock = 0;
    let totalPhysicalStock = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let nearExpiryItemCount = 0;
    let predictedStockoutCount = 0;

    const categoryMap = new Map();
    const reorderQueue = [];

    for (const item of allItems) {
      totalActiveStock += item.activeUsableQuantity;
      totalExpiredStock += item.expiredQuantity;
      totalNearExpiryStock += item.nearExpiryQuantity;
      totalPhysicalStock += item.totalPhysicalQuantity;

      if (item.availabilityStatus === 'low_stock') lowStockCount += 1;
      if (item.availabilityStatus === 'out_of_stock') outOfStockCount += 1;
      if (item.nearExpiryQuantity > 0) nearExpiryItemCount += 1;

      const pred = predictions[item.id];
      if (pred && pred.stockoutRisk === 'HIGH') {
        predictedStockoutCount += 1;
      }
      if (pred && (pred.recommendedReorderQuantity > 0 || item.availabilityStatus !== 'in_stock')) {
        reorderQueue.push({
          productId: item.id,
          sku: item.sku,
          name: item.name,
          category: item.category,
          unit: item.unit,
          activeUsableQuantity: item.activeUsableQuantity,
          minStockThreshold: item.minStockThreshold,
          predictedDailyDemand: pred.predictedDailyDemand,
          predictedStockoutDays: pred.predictedStockoutDays,
          recommendedQuantity:
            pred.recommendedReorderQuantity > 0
              ? pred.recommendedReorderQuantity
              : item.reorderQuantity,
          stockoutRisk: pred.stockoutRisk,
          predictionSource: pred.predictionSource,
          explanation: pred.explanation,
        });
      }

      if (!categoryMap.has(item.category)) {
        categoryMap.set(item.category, {
          category: item.category,
          healthyActive: 0,
          nearExpiry: 0,
          expired: 0,
        });
      }
      const cat = categoryMap.get(item.category);
      const healthy = Math.max(0, item.activeUsableQuantity - item.nearExpiryQuantity);
      cat.healthyActive = Number((cat.healthyActive + healthy).toFixed(2));
      cat.nearExpiry = Number((cat.nearExpiry + item.nearExpiryQuantity).toFixed(2));
      cat.expired = Number((cat.expired + item.expiredQuantity).toFixed(2));
    }

    // Aggregate store-wide 14-day historical daily demand + 7-day projected demand
    const since14 = addDaysUTC(getStoreToday(), -14);
    const dailyDemandAgg = await SalesRecord.aggregate([
      { $match: { saleDate: { $gte: since14 } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$saleDate' } },
          actualUnits: { $sum: '$quantitySold' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalPredictedDaily = Object.values(predictions).reduce(
      (sum, p) => sum + (p.predictedDailyDemand || 0),
      0
    );

    const demandTrend = dailyDemandAgg.map((d) => ({
      date: d._id,
      actualUnits: Number(d.actualUnits.toFixed(1)),
      predictedUnits: null,
    }));
    const today = getStoreToday();
    for (let i = 1; i <= 7; i += 1) {
      const nextDate = addDaysUTC(today, i).toISOString().slice(0, 10);
      const dayForecast = Object.values(predictions).reduce((sum, p) => {
        const pt = (p.forecastHorizon || [])[i - 1];
        return sum + (pt ? pt.predicted_units : p.predictedDailyDemand || 0);
      }, 0);
      demandTrend.push({
        date: nextDate,
        actualUnits: null,
        predictedUnits: Number((dayForecast || totalPredictedDaily).toFixed(1)),
      });
    }

    return res.json({
      kpis: {
        totalProducts: allItems.length,
        totalPhysicalStock: Number(totalPhysicalStock.toFixed(2)),
        totalActiveStock: Number(totalActiveStock.toFixed(2)),
        totalExpiredStock: Number(totalExpiredStock.toFixed(2)),
        totalNearExpiryStock: Number(totalNearExpiryStock.toFixed(2)),
        nearExpiryItemCount,
        lowStockCount,
        outOfStockCount,
        predictedStockoutCount,
        estimatedWasteUnits30d: wasteAnalytics.summary.totalQuantity,
        estimatedWasteLoss30d: wasteAnalytics.summary.totalLossAmount,
      },
      charts: {
        stockByCategory: Array.from(categoryMap.values()),
        wasteTrends: wasteAnalytics.trend,
        frequentlyWasted: wasteAnalytics.frequentlyWastedProducts.slice(0, 6),
        demandTrend,
      },
      reorderRecommendations: reorderQueue.slice(0, 8),
      wasteRecommendations: wasteRecommendations.slice(0, 6),
      recentActivity,
      modelSummary: latestModelRun,
      nearExpiryWindowDays:
        nearExpiryDays || storeConfig.defaultNearExpiryDays,
    });
  } catch (err) {
    return next(err);
  }
}

// --- Audit & Config ---
async function listAuditLogs(req, res, next) {
  try {
    const limit = Math.min(150, Number(req.query.limit || 60));
    const filter = req.query.action ? { action: req.query.action } : {};
    const logs = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
    return res.json({ logs });
  } catch (err) {
    return next(err);
  }
}

async function getConfig(_req, res, next) {
  try {
    const configDoc = await getStoreConfig();
    return res.json({ config: configDoc });
  } catch (err) {
    return next(err);
  }
}

async function updateConfig(req, res, next) {
  try {
    const updated = await StoreConfig.findOneAndUpdate(
      { key: 'default' },
      { $set: req.body },
      { new: true, upsert: true, runValidators: true }
    );
    await recordAudit({
      req,
      action: 'CONFIG_UPDATED',
      targetCollection: 'store_configs',
      targetId: updated._id.toString(),
      summary: 'Updated global store inventory & expiry policy settings',
      metadata: req.body,
    });
    return res.json({ config: updated });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createSale,
  listSales,
  createWasteLog,
  listWasteLogs,
  getWasteReport,
  getWasteRecommendationsController,
  getReorderRecommendations,
  updateReorderStatus,
  getProductForecast,
  getStockoutPredictions,
  getMlMetrics,
  retrainModels,
  getDashboardSummary,
  listAuditLogs,
  getConfig,
  updateConfig,
};
