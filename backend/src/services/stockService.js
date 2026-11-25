const { getStoreToday, toDateOnlyUTC, diffCalendarDays } = require('../utils/dateUtils');

/**
 * Classifies an individual batch relative to today's calendar date.
 * Batches expiring TODAY remain active (daysRemaining === 0, near_expiry).
 */
function classifyBatch(batch, nearExpiryWindowDays = 7, referenceToday = getStoreToday()) {
  if (batch.isDiscarded || batch.remainingQuantity <= 0) {
    return {
      batchStatus: batch.isDiscarded ? 'discarded' : 'depleted',
      daysRemaining: diffCalendarDays(batch.expiryDate, referenceToday),
      isActiveUsable: false,
      isExpired: false,
      isNearExpiry: false,
    };
  }

  const daysRemaining = diffCalendarDays(toDateOnlyUTC(batch.expiryDate), referenceToday);
  if (daysRemaining < 0) {
    return {
      batchStatus: 'expired',
      daysRemaining,
      isActiveUsable: false,
      isExpired: true,
      isNearExpiry: false,
    };
  }

  if (daysRemaining <= nearExpiryWindowDays) {
    return {
      batchStatus: 'near_expiry',
      daysRemaining,
      isActiveUsable: true,
      isExpired: false,
      isNearExpiry: true,
    };
  }

  return {
    batchStatus: 'fresh',
    daysRemaining,
    isActiveUsable: true,
    isExpired: false,
    isNearExpiry: false,
  };
}

/**
 * Sorts batches in strict FEFO order: earliest-expiring active batches first,
 * followed by expired batches (oldest first) for waste visibility.
 */
function sortBatchesFEFO(batches, nearExpiryWindowDays = 7, referenceToday = getStoreToday()) {
  const enriched = batches.map((batchDoc) => {
    const plain = typeof batchDoc.toObject === 'function' ? batchDoc.toObject() : { ...batchDoc };
    const statusInfo = classifyBatch(plain, nearExpiryWindowDays, referenceToday);
    return { ...plain, ...statusInfo };
  });

  return enriched.sort((a, b) => {
    const aActive = a.isActiveUsable ? 0 : 1;
    const bActive = b.isActiveUsable ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const expDiff = new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    if (expDiff !== 0) return expDiff;
    return new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime();
  });
}

/**
 * Computes product-level inventory balances strictly separating active usable stock
 * from expired stock while retaining expired and wasted totals for reporting.
 */
function aggregateProductStock({
  product,
  batches,
  wastedQuantity = 0,
  wastedLossAmount = 0,
  nearExpiryWindowDays = null,
  referenceToday = getStoreToday(),
}) {
  const plainProduct =
    typeof product.toObject === 'function' ? product.toObject() : { ...product };
  const windowDays =
    nearExpiryWindowDays !== null && nearExpiryWindowDays !== undefined
      ? Number(nearExpiryWindowDays)
      : plainProduct.nearExpiryWindowDays || 7;

  const sortedBatches = sortBatchesFEFO(batches, windowDays, referenceToday);

  let activeUsableQuantity = 0;
  let nearExpiryQuantity = 0;
  let expiredQuantity = 0;
  let activeInventoryValue = 0;
  let expiredInventoryValue = 0;

  for (const batch of sortedBatches) {
    if (batch.isDiscarded || batch.remainingQuantity <= 0) continue;
    if (batch.isActiveUsable) {
      activeUsableQuantity += batch.remainingQuantity;
      activeInventoryValue += batch.remainingQuantity * batch.costPrice;
      if (batch.isNearExpiry) {
        nearExpiryQuantity += batch.remainingQuantity;
      }
    } else if (batch.isExpired) {
      expiredQuantity += batch.remainingQuantity;
      expiredInventoryValue += batch.remainingQuantity * batch.costPrice;
    }
  }

  const totalPhysicalQuantity = Number((activeUsableQuantity + expiredQuantity).toFixed(2));
  activeUsableQuantity = Number(activeUsableQuantity.toFixed(2));
  nearExpiryQuantity = Number(nearExpiryQuantity.toFixed(2));
  expiredQuantity = Number(expiredQuantity.toFixed(2));

  let availabilityStatus = 'in_stock';
  if (activeUsableQuantity <= 0) {
    availabilityStatus = 'out_of_stock';
  } else if (activeUsableQuantity <= plainProduct.minStockThreshold) {
    availabilityStatus = 'low_stock';
  }

  let expiryStatus = 'fresh';
  if (expiredQuantity > 0) {
    expiryStatus = 'expired';
  } else if (nearExpiryQuantity > 0) {
    expiryStatus = 'near_expiry';
  }

  const statusLabels = [];
  if (availabilityStatus === 'out_of_stock') statusLabels.push('Out of Stock');
  else if (availabilityStatus === 'low_stock') statusLabels.push('Low Stock');
  else statusLabels.push('In Stock');

  if (nearExpiryQuantity > 0) statusLabels.push('Near Expiry');
  if (expiredQuantity > 0) statusLabels.push('Expired');

  const earliestActiveBatch = sortedBatches.find((b) => b.isActiveUsable) || null;

  return {
    ...plainProduct,
    id: plainProduct._id ? plainProduct._id.toString() : plainProduct.id,
    nearExpiryWindowDaysUsed: windowDays,
    activeUsableQuantity,
    nearExpiryQuantity,
    expiredQuantity,
    totalPhysicalQuantity,
    wastedQuantity: Number(wastedQuantity.toFixed(2)),
    wastedLossAmount: Number(wastedLossAmount.toFixed(2)),
    activeInventoryValue: Number(activeInventoryValue.toFixed(2)),
    expiredInventoryValue: Number(expiredInventoryValue.toFixed(2)),
    availabilityStatus,
    expiryStatus,
    statusLabels,
    earliestExpiryDate: earliestActiveBatch ? earliestActiveBatch.expiryDate : null,
    earliestDaysRemaining: earliestActiveBatch ? earliestActiveBatch.daysRemaining : null,
    batches: sortedBatches,
  };
}

module.exports = {
  classifyBatch,
  sortBatchesFEFO,
  aggregateProductStock,
};
