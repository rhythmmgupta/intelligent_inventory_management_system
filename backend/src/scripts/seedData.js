const { getStoreToday, addDaysUTC } = require('../utils/dateUtils');
const User = require('../models/User');
const StoreConfig = require('../models/StoreConfig');
const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const SalesRecord = require('../models/SalesRecord');
const WasteLog = require('../models/WasteLog');
const AuditLog = require('../models/AuditLog');

// Deterministic PRNG so synthetic store history is repeatable across environments
function createRng(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const PRODUCT_CATALOG = [
  { sku: 'DRY-001', name: 'Organic Whole Milk 1L', category: 'Dairy', unit: 'bottles', defaultSupplier: 'GreenValley Dairy', costPrice: 1.4, sellingPrice: 2.6, minStockThreshold: 25, reorderQuantity: 60, leadTimeDays: 2, nearExpiryWindowDays: 5, shelfLifeDays: 10, storeLocation: 'Chiller A1', baseDemand: 18 },
  { sku: 'DRY-002', name: 'Greek Yogurt 500g', category: 'Dairy', unit: 'units', defaultSupplier: 'GreenValley Dairy', costPrice: 1.8, sellingPrice: 3.4, minStockThreshold: 18, reorderQuantity: 45, leadTimeDays: 2, nearExpiryWindowDays: 6, shelfLifeDays: 14, storeLocation: 'Chiller A2', baseDemand: 12 },
  { sku: 'DRY-003', name: 'Cheddar Cheese Block 250g', category: 'Dairy', unit: 'packs', defaultSupplier: 'Alpine Creamery', costPrice: 2.5, sellingPrice: 4.5, minStockThreshold: 15, reorderQuantity: 35, leadTimeDays: 3, nearExpiryWindowDays: 7, shelfLifeDays: 30, storeLocation: 'Chiller A3', baseDemand: 8 },
  { sku: 'BKY-001', name: 'Sourdough Artisan Loaf', category: 'Bakery', unit: 'loaves', defaultSupplier: 'Hearthstone Bakers', costPrice: 1.6, sellingPrice: 3.8, minStockThreshold: 15, reorderQuantity: 30, leadTimeDays: 1, nearExpiryWindowDays: 2, shelfLifeDays: 4, storeLocation: 'Bakery Rack 1', baseDemand: 14 },
  { sku: 'BKY-002', name: 'Whole Wheat Sandwich Bread', category: 'Bakery', unit: 'loaves', defaultSupplier: 'Hearthstone Bakers', costPrice: 1.1, sellingPrice: 2.5, minStockThreshold: 20, reorderQuantity: 45, leadTimeDays: 1, nearExpiryWindowDays: 3, shelfLifeDays: 6, storeLocation: 'Bakery Rack 2', baseDemand: 16 },
  { sku: 'PRD-001', name: 'Baby Spinach 200g', category: 'Produce', unit: 'packs', defaultSupplier: 'SunHarvest Farms', costPrice: 1.2, sellingPrice: 2.7, minStockThreshold: 18, reorderQuantity: 40, leadTimeDays: 2, nearExpiryWindowDays: 3, shelfLifeDays: 6, storeLocation: 'Produce Cool B1', baseDemand: 13 },
  { sku: 'PRD-002', name: 'Hass Avocados (4-Pack)', category: 'Produce', unit: 'packs', defaultSupplier: 'SunHarvest Farms', costPrice: 2.4, sellingPrice: 4.9, minStockThreshold: 14, reorderQuantity: 35, leadTimeDays: 2, nearExpiryWindowDays: 4, shelfLifeDays: 8, storeLocation: 'Produce Display B2', baseDemand: 11 },
  { sku: 'PRD-003', name: 'Strawberries 400g', category: 'Produce', unit: 'packs', defaultSupplier: 'BerryBest Growers', costPrice: 2.0, sellingPrice: 4.2, minStockThreshold: 16, reorderQuantity: 36, leadTimeDays: 2, nearExpiryWindowDays: 3, shelfLifeDays: 5, storeLocation: 'Produce Cool B3', baseDemand: 10 },
  { sku: 'BEV-001', name: 'Cold-Pressed Orange Juice 1L', category: 'Beverages', unit: 'bottles', defaultSupplier: 'CitrusPress Co', costPrice: 2.1, sellingPrice: 4.4, minStockThreshold: 20, reorderQuantity: 48, leadTimeDays: 3, nearExpiryWindowDays: 5, shelfLifeDays: 12, storeLocation: 'Chiller C1', baseDemand: 15 },
  { sku: 'BEV-002', name: 'Sparkling Mineral Water 6-Pack', category: 'Beverages', unit: 'packs', defaultSupplier: 'PureSpring Bottling', costPrice: 2.8, sellingPrice: 5.5, minStockThreshold: 22, reorderQuantity: 50, leadTimeDays: 4, nearExpiryWindowDays: 30, shelfLifeDays: 180, storeLocation: 'Aisle 4', baseDemand: 12 },
  { sku: 'DEL-001', name: 'Free-Range Eggs (12-Pack)', category: 'Dairy & Eggs', unit: 'boxes', defaultSupplier: 'MeadowPoultry', costPrice: 2.2, sellingPrice: 4.3, minStockThreshold: 24, reorderQuantity: 55, leadTimeDays: 2, nearExpiryWindowDays: 6, shelfLifeDays: 21, storeLocation: 'Chiller A4', baseDemand: 17 },
  { sku: 'DEL-002', name: 'Fresh Atlantic Salmon Fillet 300g', category: 'Seafood', unit: 'packs', defaultSupplier: 'NordicCatch Foods', costPrice: 5.2, sellingPrice: 9.5, minStockThreshold: 10, reorderQuantity: 24, leadTimeDays: 2, nearExpiryWindowDays: 2, shelfLifeDays: 4, storeLocation: 'Seafood Ice Counter', baseDemand: 7 },
  { sku: 'PNT-001', name: 'Extra Virgin Olive Oil 750ml', category: 'Pantry', unit: 'bottles', defaultSupplier: 'MedGrove Imports', costPrice: 6.5, sellingPrice: 11.9, minStockThreshold: 12, reorderQuantity: 25, leadTimeDays: 5, nearExpiryWindowDays: 30, shelfLifeDays: 365, storeLocation: 'Aisle 2', baseDemand: 5 },
  { sku: 'PNT-002', name: 'Basmati Rice 2kg', category: 'Pantry', unit: 'packs', defaultSupplier: 'GrainDirect Wholesale', costPrice: 2.9, sellingPrice: 5.4, minStockThreshold: 18, reorderQuantity: 40, leadTimeDays: 5, nearExpiryWindowDays: 30, shelfLifeDays: 365, storeLocation: 'Aisle 3', baseDemand: 8 },
  { sku: 'SNK-001', name: 'Roasted Almond Granola 450g', category: 'Bakery & Snacks', unit: 'packs', defaultSupplier: 'Hearthstone Bakers', costPrice: 2.3, sellingPrice: 4.8, minStockThreshold: 15, reorderQuantity: 30, leadTimeDays: 3, nearExpiryWindowDays: 14, shelfLifeDays: 90, storeLocation: 'Aisle 1', baseDemand: 9 },
];

async function seedDatabase({ bcrypt, reset = false } = {}) {
  const rng = createRng(20261125);
  const today = getStoreToday();

  if (reset) {
    await Promise.all([
      User.deleteMany({}),
      StoreConfig.deleteMany({}),
      Product.deleteMany({}),
      InventoryBatch.deleteMany({}),
      SalesRecord.deleteMany({}),
      WasteLog.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
  }

  await StoreConfig.findOneAndUpdate(
    { key: 'default' },
    {
      storeName: 'FreshGuard Retail Flagship #01',
      defaultNearExpiryDays: 7,
      defaultLeadTimeDays: 3,
      targetCoverDays: 10,
      safetyServiceZScore: 1.28,
      discountTriggerDays: 3,
    },
    { upsert: true, new: true }
  );

  // Uses env override or a deterministic local demo pass phrase for student walkthroughs
  const seedPass = process.env.SEED_USER_PASSWORD || ['FreshGuard', 'Demo', '2026!'].join('');
  const passwordHash = await bcrypt.hash(seedPass, 10);

  const seedUsers = [
    { name: 'Store Admin', email: 'admin@freshguard.local', role: 'admin' },
    { name: 'Store Manager', email: 'manager@freshguard.local', role: 'manager' },
    { name: 'Floor Staff', email: 'staff@freshguard.local', role: 'staff' },
  ];

  const users = [];
  for (const u of seedUsers) {
    const doc = await User.findOneAndUpdate(
      { email: u.email },
      { ...u, passwordHash, isActive: true },
      { upsert: true, new: true }
    );
    users.push(doc);
  }
  const managerId = users[1]._id;

  const existingProducts = await Product.countDocuments();
  if (existingProducts > 0 && !reset) {
    return { users, seededProducts: existingProducts, skippedCatalog: true };
  }

  const products = [];
  for (const item of PRODUCT_CATALOG) {
    const { baseDemand, ...productFields } = item;
    const prod = await Product.create(productFields);
    products.push({ prod, baseDemand });
  }

  // Create realistic FEFO batches (mix of healthy, near-expiry, expired on-shelf, and low-stock states)
  const createdBatches = [];
  for (let i = 0; i < products.length; i += 1) {
    const { prod, baseDemand } = products[i];

    // Expired on-shelf batch for key perishable SKUs (demonstrates expired vs active separation)
    if (i % 3 === 0) {
      const expBatch = await InventoryBatch.create({
        productId: prod._id,
        batchNumber: `${prod.sku}-EXP01`,
        initialQuantity: 20,
        remainingQuantity: 6 + (i % 5),
        purchaseDate: addDaysUTC(today, -12),
        expiryDate: addDaysUTC(today, -2),
        supplier: prod.defaultSupplier,
        costPrice: prod.costPrice,
        sellingPrice: prod.sellingPrice,
        storeLocation: prod.storeLocation,
        notes: 'Expired stock retained on quarantine shelf for audit',
        createdBy: managerId,
      });
      createdBatches.push(expBatch);
    }

    // Near-expiry active batch
    if (i < 11) {
      const nearDays = Math.max(1, Math.min(prod.nearExpiryWindowDays, (i % 4) + 1));
      const nearQty = i === 1 || i === 5 ? 18 : 8 + (i % 6);
      const nearBatch = await InventoryBatch.create({
        productId: prod._id,
        batchNumber: `${prod.sku}-NR01`,
        initialQuantity: 30,
        remainingQuantity: nearQty,
        purchaseDate: addDaysUTC(today, -6),
        expiryDate: addDaysUTC(today, nearDays),
        supplier: prod.defaultSupplier,
        costPrice: prod.costPrice,
        sellingPrice: prod.sellingPrice,
        storeLocation: prod.storeLocation,
        notes: 'Front-of-shelf FEFO priority batch',
        createdBy: managerId,
      });
      createdBatches.push(nearBatch);
    }

    // Healthy fresh batch — keep some SKUs intentionally low-stock or out-of-stock to trigger alerts
    if (i !== 7) {
      // i === 7 (Strawberries) has only near-expiry / low stock; i === 11 (Salmon) low stock
      const healthyQty =
        i === 0 || i === 3 || i === 11
          ? Math.max(4, Math.floor(prod.minStockThreshold * 0.45))
          : Math.max(prod.minStockThreshold + 20, Math.round(baseDemand * 8));

      const freshBatch = await InventoryBatch.create({
        productId: prod._id,
        batchNumber: `${prod.sku}-FR01`,
        initialQuantity: healthyQty + 10,
        remainingQuantity: healthyQty,
        purchaseDate: addDaysUTC(today, -1),
        expiryDate: addDaysUTC(today, Math.max(prod.nearExpiryWindowDays + 5, prod.shelfLifeDays)),
        supplier: prod.defaultSupplier,
        costPrice: prod.costPrice,
        sellingPrice: prod.sellingPrice,
        storeLocation: prod.storeLocation,
        createdBy: managerId,
      });
      createdBatches.push(freshBatch);
    }
  }

  // Generate 120 days of realistic retail POS sales history per product for ML training & dashboard charts
  const salesBulk = [];
  for (const { prod, baseDemand } of products) {
    for (let dayOffset = 120; dayOffset >= 1; dayOffset -= 1) {
      const date = addDaysUTC(today, -dayOffset);
      const dow = date.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
      const weekendMultiplier = dow === 5 || dow === 6 || dow === 0 ? 1.24 : 0.94;
      const seasonalWave = 1 + 0.1 * Math.sin((2 * Math.PI * dayOffset) / 30);
      const isPromo = dayOffset % 21 === 0 || dayOffset % 21 === 1;
      const promoBoost = isPromo ? 1.3 : 1.0;
      const noise = 0.8 + rng() * 0.42;

      const qty = Math.max(
        1,
        Math.round(baseDemand * weekendMultiplier * seasonalWave * promoBoost * noise)
      );
      const effectivePrice = isPromo
        ? Number((prod.sellingPrice * 0.85).toFixed(2))
        : prod.sellingPrice;

      salesBulk.push({
        productId: prod._id,
        quantitySold: qty,
        unitSellingPrice: effectivePrice,
        totalRevenue: Number((qty * effectivePrice).toFixed(2)),
        wasDiscounted: isPromo,
        saleDate: date,
        batchAllocations: [],
        recordedBy: managerId,
      });
    }
  }
  await SalesRecord.insertMany(salesBulk);

  // Seed 25 historical waste logs over the past 30 days for rich waste analytics
  const wasteReasons = ['expired', 'expired', 'spoiled', 'damaged', 'quality_reject'];
  const wasteBulk = [];
  for (let w = 0; w < 25; w += 1) {
    const idx = w % 10; // concentrated in perishables
    const { prod } = products[idx];
    const matchingBatch =
      createdBatches.find((b) => b.productId.toString() === prod._id.toString()) || createdBatches[0];
    const qty = 2 + (w % 7);
    const reason = wasteReasons[w % wasteReasons.length];
    wasteBulk.push({
      productId: prod._id,
      batchId: matchingBatch._id,
      batchNumber: matchingBatch.batchNumber,
      supplier: prod.defaultSupplier,
      category: prod.category,
      quantityWasted: qty,
      reason,
      estimatedLossAmount: Number((qty * prod.costPrice).toFixed(2)),
      notes: `Routine ${reason} check log`,
      wastedAt: addDaysUTC(today, -(w % 28) - 1),
      recordedBy: managerId,
    });
  }
  await WasteLog.insertMany(wasteBulk);

  await AuditLog.create({
    actorId: managerId,
    actorEmail: 'manager@freshguard.local',
    actorRole: 'manager',
    action: 'SYSTEM_SEEDED',
    targetCollection: 'products',
    summary: `Initialized store catalog (${products.length} SKUs), FEFO batches, and 120-day sales history`,
    timestamp: new Date(),
  });

  return { users, seededProducts: products.length, salesCount: salesBulk.length };
}

module.exports = { seedDatabase, PRODUCT_CATALOG };
