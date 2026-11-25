const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const WasteLog = require('../models/WasteLog');
const SalesRecord = require('../models/SalesRecord');
const AppError = require('../utils/AppError');
const { getStoreToday, addDaysUTC } = require('../utils/dateUtils');
const { recordAudit } = require('./auditService');

async function logWasteDisposal({
  batchId,
  quantityWasted = null,
  reason,
  notes = '',
  wastedAt = new Date(),
  req = null,
  actor = null,
}) {
  const batch = await InventoryBatch.findById(batchId);
  if (!batch) {
    throw new AppError(404, 'Inventory batch not found.');
  }
  if (batch.isDiscarded || batch.remainingQuantity <= 0) {
    throw new AppError(400, 'Batch has no remaining stock to dispose.');
  }

  const product = await Product.findById(batch.productId);
  if (!product) {
    throw new AppError(404, 'Parent product not found.');
  }

  const qtyToDispose =
    quantityWasted !== null && quantityWasted !== undefined
      ? Number(quantityWasted)
      : batch.remainingQuantity;

  if (!Number.isFinite(qtyToDispose) || qtyToDispose <= 0 || qtyToDispose > batch.remainingQuantity) {
    throw new AppError(
      400,
      `Invalid disposal quantity (${qtyToDispose}). Available in batch: ${batch.remainingQuantity}.`
    );
  }

  const newRemaining = Number((batch.remainingQuantity - qtyToDispose).toFixed(2));
  batch.remainingQuantity = newRemaining;
  if (newRemaining <= 0) {
    batch.isDiscarded = true;
  }
  await batch.save();

  const estimatedLossAmount = Number((qtyToDispose * batch.costPrice).toFixed(2));
  const wasteLog = await WasteLog.create({
    productId: product._id,
    batchId: batch._id,
    batchNumber: batch.batchNumber,
    supplier: batch.supplier,
    category: product.category,
    quantityWasted: qtyToDispose,
    reason,
    estimatedLossAmount,
    notes,
    wastedAt,
    recordedBy: actor ? actor.id : req && req.user ? req.user.id : null,
  });

  await recordAudit({
    req,
    actor,
    action: 'WASTE_LOGGED',
    targetCollection: 'waste_logs',
    targetId: wasteLog._id.toString(),
    summary: `Disposed ${qtyToDispose} ${product.unit} of ${product.name} (${batch.batchNumber}) due to ${reason}`,
    metadata: { estimatedLossAmount, reason, batchId: batch._id.toString() },
  });

  return { wasteLog, updatedBatch: batch };
}

async function getWasteAnalytics({ periodDays = 30, category = null, supplier = null } = {}) {
  const match = {};
  if (periodDays && Number(periodDays) > 0) {
    match.wastedAt = { $gte: addDaysUTC(getStoreToday(), -Number(periodDays)) };
  }
  if (category) match.category = category;
  if (supplier) match.supplier = supplier;

  const [totals, byItem, byCategory, bySupplier, byReason, dailyTrend] = await Promise.all([
    WasteLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: '$quantityWasted' },
          totalLossAmount: { $sum: '$estimatedLossAmount' },
          incidentCount: { $sum: 1 },
        },
      },
    ]),
    WasteLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$productId',
          totalQuantity: { $sum: '$quantityWasted' },
          totalLossAmount: { $sum: '$estimatedLossAmount' },
          incidents: { $sum: 1 },
        },
      },
      { $sort: { totalLossAmount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          productId: '$_id',
          name: { $ifNull: ['$product.name', 'Unknown'] },
          sku: { $ifNull: ['$product.sku', ''] },
          category: { $ifNull: ['$product.category', ''] },
          unit: { $ifNull: ['$product.unit', 'units'] },
          totalQuantity: { $round: ['$totalQuantity', 2] },
          totalLossAmount: { $round: ['$totalLossAmount', 2] },
          incidents: 1,
        },
      },
    ]),
    WasteLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          totalQuantity: { $sum: '$quantityWasted' },
          totalLossAmount: { $sum: '$estimatedLossAmount' },
        },
      },
      { $sort: { totalLossAmount: -1 } },
    ]),
    WasteLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$supplier',
          totalQuantity: { $sum: '$quantityWasted' },
          totalLossAmount: { $sum: '$estimatedLossAmount' },
        },
      },
      { $sort: { totalLossAmount: -1 } },
    ]),
    WasteLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$reason',
          totalQuantity: { $sum: '$quantityWasted' },
          totalLossAmount: { $sum: '$estimatedLossAmount' },
          incidents: { $sum: 1 },
        },
      },
      { $sort: { totalLossAmount: -1 } },
    ]),
    WasteLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$wastedAt' } },
            reason: '$reason',
          },
          quantity: { $sum: '$quantityWasted' },
          lossAmount: { $sum: '$estimatedLossAmount' },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]),
  ]);

  const summary = totals[0] || { totalQuantity: 0, totalLossAmount: 0, incidentCount: 0 };

  // Build normalized daily trend rows suitable for charting
  const trendMap = new Map();
  for (const row of dailyTrend) {
    const date = row._id.date;
    if (!trendMap.has(date)) {
      trendMap.set(date, { date, expired: 0, damaged: 0, spoiled: 0, quality_reject: 0, totalLoss: 0 });
    }
    const entry = trendMap.get(date);
    entry[row._id.reason] = Number((entry[row._id.reason] + row.quantity).toFixed(2));
    entry.totalLoss = Number((entry.totalLoss + row.lossAmount).toFixed(2));
  }

  return {
    periodDays,
    summary: {
      totalQuantity: Number((summary.totalQuantity || 0).toFixed(2)),
      totalLossAmount: Number((summary.totalLossAmount || 0).toFixed(2)),
      incidentCount: summary.incidentCount || 0,
    },
    frequentlyWastedProducts: byItem,
    byCategory: byCategory.map((c) => ({
      category: c._id,
      totalQuantity: Number(c.totalQuantity.toFixed(2)),
      totalLossAmount: Number(c.totalLossAmount.toFixed(2)),
    })),
    bySupplier: bySupplier.map((s) => ({
      supplier: s._id,
      totalQuantity: Number(s.totalQuantity.toFixed(2)),
      totalLossAmount: Number(s.totalLossAmount.toFixed(2)),
    })),
    byReason: byReason.map((r) => ({
      reason: r._id,
      totalQuantity: Number(r.totalQuantity.toFixed(2)),
      totalLossAmount: Number(r.totalLossAmount.toFixed(2)),
      incidents: r.incidents,
    })),
    trend: Array.from(trendMap.values()),
  };
}

/**
 * Generates rule-based food-waste reduction advisories informed by near-expiry stock,
 * predicted daily velocity, and historical wastage ratio.
 */
async function generateWasteRecommendations(productsWithStock, predictionsById = {}, storeConfig = {}) {
  const since30 = addDaysUTC(getStoreToday(), -30);
  const [recentSales, recentWaste] = await Promise.all([
    SalesRecord.aggregate([
      { $match: { saleDate: { $gte: since30 } } },
      { $group: { _id: '$productId', totalSold: { $sum: '$quantitySold' } } },
    ]),
    WasteLog.aggregate([
      { $match: { wastedAt: { $gte: since30 } } },
      {
        $group: {
          _id: '$productId',
          totalWasted: { $sum: '$quantityWasted' },
          totalLoss: { $sum: '$estimatedLossAmount' },
        },
      },
    ]),
  ]);

  const salesMap = new Map(recentSales.map((s) => [s._id.toString(), s.totalSold]));
  const wasteMap = new Map(recentWaste.map((w) => [w._id.toString(), w]));
  const discountTriggerDays = storeConfig.discountTriggerDays || 3;

  const recommendations = [];

  for (const item of productsWithStock) {
    const pid = item.id;
    const pred = predictionsById[pid];
    const dailyDemand = pred ? pred.predictedDailyDemand : Math.max(0.5, (salesMap.get(pid) || 15) / 30);

    // 1. Expired on-shelf removal action
    if (item.expiredQuantity > 0) {
      recommendations.push({
        productId: pid,
        productName: item.name,
        category: item.category,
        type: 'DISPOSE_EXPIRED',
        priority: 'critical',
        title: `Quarantine & log ${item.expiredQuantity} expired ${item.unit}`,
        action: `Remove ${item.expiredQuantity} ${item.unit} from active shelves and log disposal for audit & supplier review.`,
        potentialSavingsOrLoss: item.expiredInventoryValue,
        source: 'rule_based',
      });
    }

    // 2. Near-expiry discounting & FEFO push
    if (item.nearExpiryQuantity > 0 && item.earliestDaysRemaining !== null) {
      const daysLeft = Math.max(1, item.earliestDaysRemaining + 1);
      const expectedBeforeExpiry = Number((dailyDemand * daysLeft).toFixed(1));
      if (item.nearExpiryQuantity > expectedBeforeExpiry) {
        const atRiskQty = Number((item.nearExpiryQuantity - expectedBeforeExpiry).toFixed(1));
        const suggestedDiscount = daysLeft <= 2 ? 35 : 20;
        recommendations.push({
          productId: pid,
          productName: item.name,
          category: item.category,
          type: 'DISCOUNT_NEAR_EXPIRY',
          priority: daysLeft <= discountTriggerDays ? 'high' : 'medium',
          title: `Apply ${suggestedDiscount}% markdown on near-expiry batch`,
          action: `${item.nearExpiryQuantity} ${item.unit} expire within ${daysLeft} day(s), while forecasted demand is ~${expectedBeforeExpiry}. Markdown ${suggestedDiscount}% and move batch to front (FEFO) to rescue ~${atRiskQty} ${item.unit}.`,
          potentialSavingsOrLoss: Number((atRiskQty * item.costPrice).toFixed(2)),
          source: pred ? pred.predictionSource : 'rule_based',
        });
      } else {
        recommendations.push({
          productId: pid,
          productName: item.name,
          category: item.category,
          type: 'PRIORITIZE_FEFO',
          priority: 'medium',
          title: 'Prioritize near-expiry batch at shelf front (FEFO)',
          action: `Sell ${item.nearExpiryQuantity} near-expiry ${item.unit} before newer lots; demand (${dailyDemand.toFixed(1)}/day) is sufficient to clear before expiry.`,
          potentialSavingsOrLoss: 0,
          source: 'rule_based',
        });
      }
    }

    // 3. Repeat wastage order-size / timing adjustment
    const wasteStats = wasteMap.get(pid);
    const sold30 = salesMap.get(pid) || 0;
    if (wasteStats && wasteStats.totalWasted > 0) {
      const wasteRatio = wasteStats.totalWasted / Math.max(1, sold30 + wasteStats.totalWasted);
      if (wasteRatio >= 0.12) {
        const reducedOrder = Math.max(1, Math.round(item.reorderQuantity * 0.75));
        recommendations.push({
          productId: pid,
          productName: item.name,
          category: item.category,
          type: 'REDUCE_ORDER_QUANTITY',
          priority: wasteRatio >= 0.25 ? 'high' : 'medium',
          title: `Reduce reorder quantity (${item.reorderQuantity} -> ${reducedOrder} ${item.unit})`,
          action: `${Math.round(wasteRatio * 100)}% of recent volume was wasted ($${wasteStats.totalLoss.toFixed(2)} loss). Switch to smaller, more frequent deliveries aligned to shelf life (${item.shelfLifeDays || 14}d).`,
          potentialSavingsOrLoss: Number(wasteStats.totalLoss.toFixed(2)),
          source: 'rule_based',
        });
      }
    }
  }

  const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return recommendations.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
}

module.exports = {
  logWasteDisposal,
  getWasteAnalytics,
  generateWasteRecommendations,
};
