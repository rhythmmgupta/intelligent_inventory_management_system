const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const SalesRecord = require('../models/SalesRecord');
const AppError = require('../utils/AppError');
const { getStoreToday, toDateOnlyUTC } = require('../utils/dateUtils');
const { fefoSalesCounter } = require('../config/metrics');
const { recordAudit } = require('./auditService');

/**
 * Records a sale by deducting quantities from active non-expired batches in strict
 * FEFO order (earliest expiryDate first, tie-broken by purchaseDate).
 */
async function recordSaleFEFO({
  productId,
  quantitySold,
  unitSellingPrice = null,
  wasDiscounted = false,
  saleDate = new Date(),
  req = null,
  actor = null,
}) {
  if (!Number.isFinite(quantitySold) || quantitySold <= 0) {
    throw new AppError(400, 'quantitySold must be a positive number.');
  }

  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new AppError(404, 'Product not found or inactive.');
  }

  const today = getStoreToday();
  const batches = await InventoryBatch.find({
    productId: product._id,
    isDiscarded: false,
    remainingQuantity: { $gt: 0 },
  }).sort({ expiryDate: 1, purchaseDate: 1, createdAt: 1 });

  const activeBatches = [];
  let activeAvailable = 0;
  let expiredOnShelf = 0;

  for (const batch of batches) {
    const expDay = toDateOnlyUTC(batch.expiryDate);
    if (expDay < today) {
      expiredOnShelf += batch.remainingQuantity;
    } else {
      activeBatches.push(batch);
      activeAvailable += batch.remainingQuantity;
    }
  }

  if (activeAvailable < quantitySold) {
    const expiredNote =
      expiredOnShelf > 0
        ? ` (${expiredOnShelf} expired ${product.unit} on shelf cannot be sold)`
        : '';
    throw new AppError(
      409,
      `Insufficient active usable stock for ${product.name}: available ${activeAvailable}, requested ${quantitySold}${expiredNote}.`
    );
  }

  let remainingToDeduct = quantitySold;
  const allocations = [];
  const appliedChanges = [];

  try {
    for (const batch of activeBatches) {
      if (remainingToDeduct <= 0) break;
      const deductQty = Number(Math.min(remainingToDeduct, batch.remainingQuantity).toFixed(2));
      const updated = await InventoryBatch.findOneAndUpdate(
        {
          _id: batch._id,
          isDiscarded: false,
          remainingQuantity: { $gte: deductQty },
        },
        { $inc: { remainingQuantity: -deductQty } },
        { new: true }
      );

      if (!updated) {
        throw new AppError(409, 'Concurrent stock modification detected; please retry sale.');
      }

      appliedChanges.push({ batchId: batch._id, deductQty });
      allocations.push({
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        quantityDeducted: deductQty,
        expiryDate: batch.expiryDate,
      });
      remainingToDeduct = Number((remainingToDeduct - deductQty).toFixed(2));
    }
  } catch (err) {
    // Compensating rollback for standalone MongoDB deployments without replica-set transactions
    for (const change of appliedChanges) {
      await InventoryBatch.findByIdAndUpdate(change.batchId, {
        $inc: { remainingQuantity: change.deductQty },
      });
    }
    throw err;
  }

  const effectivePrice =
    unitSellingPrice !== null && unitSellingPrice !== undefined
      ? Number(unitSellingPrice)
      : activeBatches[0].sellingPrice || product.sellingPrice;

  const sale = await SalesRecord.create({
    productId: product._id,
    quantitySold,
    unitSellingPrice: effectivePrice,
    totalRevenue: Number((quantitySold * effectivePrice).toFixed(2)),
    wasDiscounted: Boolean(wasDiscounted),
    saleDate,
    batchAllocations: allocations,
    recordedBy: actor ? actor.id : req && req.user ? req.user.id : null,
  });

  fefoSalesCounter.inc();

  await recordAudit({
    req,
    actor,
    action: 'SALE_RECORDED',
    targetCollection: 'sales_records',
    targetId: sale._id.toString(),
    summary: `Sold ${quantitySold} ${product.unit} of ${product.name} via FEFO across ${allocations.length} batch(es)`,
    metadata: { productId: product._id.toString(), allocations },
  });

  return sale;
}

module.exports = { recordSaleFEFO };
