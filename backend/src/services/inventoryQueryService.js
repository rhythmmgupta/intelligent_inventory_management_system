const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const WasteLog = require('../models/WasteLog');
const StoreConfig = require('../models/StoreConfig');
const { aggregateProductStock } = require('./stockService');

async function getStoreConfig() {
  let cfg = await StoreConfig.findOne({ key: 'default' }).lean();
  if (!cfg) {
    cfg = await StoreConfig.create({ key: 'default' });
    cfg = cfg.toObject();
  }
  return cfg;
}

async function loadAllInventoryWithStock({
  nearExpiryDays = null,
  search = '',
  category = '',
  supplier = '',
  stockStatus = '',
  expiryStatus = '',
} = {}) {
  const [storeConfig, products, batches, wasteAgg] = await Promise.all([
    getStoreConfig(),
    Product.find({ isActive: true }).sort({ name: 1 }).lean(),
    InventoryBatch.find().lean(),
    WasteLog.aggregate([
      {
        $group: {
          _id: '$productId',
          wastedQuantity: { $sum: '$quantityWasted' },
          wastedLossAmount: { $sum: '$estimatedLossAmount' },
        },
      },
    ]),
  ]);

  const batchesByProduct = new Map();
  for (const batch of batches) {
    const pid = batch.productId.toString();
    if (!batchesByProduct.has(pid)) batchesByProduct.set(pid, []);
    batchesByProduct.get(pid).push(batch);
  }

  const wasteByProduct = new Map(
    wasteAgg.map((w) => [
      w._id.toString(),
      { wastedQuantity: w.wastedQuantity || 0, wastedLossAmount: w.wastedLossAmount || 0 },
    ])
  );

  const effectiveWindow =
    nearExpiryDays !== null && nearExpiryDays !== undefined && nearExpiryDays !== ''
      ? Number(nearExpiryDays)
      : null;

  const allItems = products.map((product) => {
    const pid = product._id.toString();
    const waste = wasteByProduct.get(pid) || { wastedQuantity: 0, wastedLossAmount: 0 };
    return aggregateProductStock({
      product,
      batches: batchesByProduct.get(pid) || [],
      wastedQuantity: waste.wastedQuantity,
      wastedLossAmount: waste.wastedLossAmount,
      nearExpiryWindowDays: effectiveWindow ?? storeConfig.defaultNearExpiryDays ?? product.nearExpiryWindowDays,
    });
  });

  const categories = [...new Set(allItems.map((p) => p.category))].sort();
  const suppliers = [
    ...new Set([
      ...allItems.map((p) => p.defaultSupplier),
      ...batches.map((b) => b.supplier),
    ]),
  ]
    .filter(Boolean)
    .sort();

  const searchLower = search.trim().toLowerCase();
  const filtered = allItems.filter((item) => {
    if (searchLower) {
      const matchesMeta =
        item.name.toLowerCase().includes(searchLower) ||
        item.sku.toLowerCase().includes(searchLower) ||
        item.category.toLowerCase().includes(searchLower) ||
        item.defaultSupplier.toLowerCase().includes(searchLower) ||
        item.batches.some((b) => b.batchNumber.toLowerCase().includes(searchLower));
      if (!matchesMeta) return false;
    }
    if (category && item.category.toLowerCase() !== category.trim().toLowerCase()) {
      return false;
    }
    if (supplier) {
      const supLower = supplier.trim().toLowerCase();
      const matchesSupplier =
        item.defaultSupplier.toLowerCase() === supLower ||
        item.batches.some((b) => b.supplier.toLowerCase() === supLower);
      if (!matchesSupplier) return false;
    }
    if (stockStatus && item.availabilityStatus !== stockStatus) {
      return false;
    }
    if (expiryStatus === 'expired' && item.expiredQuantity <= 0) {
      return false;
    }
    if (expiryStatus === 'near_expiry' && item.nearExpiryQuantity <= 0) {
      return false;
    }
    if (expiryStatus === 'fresh' && (item.expiredQuantity > 0 || item.nearExpiryQuantity > 0)) {
      return false;
    }
    return true;
  });

  return {
    items: filtered,
    allItems,
    storeConfig,
    filters: { categories, suppliers },
  };
}

module.exports = {
  getStoreConfig,
  loadAllInventoryWithStock,
};
