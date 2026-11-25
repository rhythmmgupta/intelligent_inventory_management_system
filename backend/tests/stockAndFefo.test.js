const Product = require('../src/models/Product');
const InventoryBatch = require('../src/models/InventoryBatch');
const { aggregateProductStock, classifyBatch } = require('../src/services/stockService');
const { recordSaleFEFO } = require('../src/services/fefoService');
const { addDaysUTC, getStoreToday } = require('../src/utils/dateUtils');

describe('Stock Calculation, Expiry Boundary & FEFO Engine', () => {
  test('treats expiryDate == today as near-expiry active stock and expiryDate < today as expired', () => {
    const today = getStoreToday();
    const todayBatch = { remainingQuantity: 10, expiryDate: today, isDiscarded: false };
    const yesterdayBatch = {
      remainingQuantity: 10,
      expiryDate: addDaysUTC(today, -1),
      isDiscarded: false,
    };

    const todayStatus = classifyBatch(todayBatch, 7, today);
    const yesterdayStatus = classifyBatch(yesterdayBatch, 7, today);

    expect(todayStatus.isActiveUsable).toBe(true);
    expect(todayStatus.isNearExpiry).toBe(true);
    expect(todayStatus.daysRemaining).toBe(0);

    expect(yesterdayStatus.isActiveUsable).toBe(false);
    expect(yesterdayStatus.isExpired).toBe(true);
    expect(yesterdayStatus.batchStatus).toBe('expired');
  });

  test('excludes expired stock from activeUsableQuantity while preserving physical & wasted totals', () => {
    const today = getStoreToday();
    const product = {
      _id: '507f1f77bcf86cd799439011',
      sku: 'DRY-100',
      name: 'Fresh Milk',
      category: 'Dairy',
      unit: 'bottles',
      defaultSupplier: 'DairyCo',
      costPrice: 1.5,
      sellingPrice: 3.0,
      minStockThreshold: 15,
      reorderQuantity: 30,
      nearExpiryWindowDays: 7,
    };

    const batches = [
      {
        _id: 'b1',
        batchNumber: 'B-EXP',
        remainingQuantity: 20,
        purchaseDate: addDaysUTC(today, -10),
        expiryDate: addDaysUTC(today, -1),
        costPrice: 1.5,
        isDiscarded: false,
      },
      {
        _id: 'b2',
        batchNumber: 'B-NEAR',
        remainingQuantity: 5,
        purchaseDate: addDaysUTC(today, -4),
        expiryDate: addDaysUTC(today, 2),
        costPrice: 1.5,
        isDiscarded: false,
      },
      {
        _id: 'b3',
        batchNumber: 'B-FRESH',
        remainingQuantity: 6,
        purchaseDate: addDaysUTC(today, -1),
        expiryDate: addDaysUTC(today, 12),
        costPrice: 1.5,
        isDiscarded: false,
      },
    ];

    const summary = aggregateProductStock({
      product,
      batches,
      wastedQuantity: 4,
      wastedLossAmount: 6,
      referenceToday: today,
    });

    expect(summary.activeUsableQuantity).toBe(11);
    expect(summary.nearExpiryQuantity).toBe(5);
    expect(summary.expiredQuantity).toBe(20);
    expect(summary.totalPhysicalQuantity).toBe(31);
    expect(summary.wastedQuantity).toBe(4);
    // Active stock (11) <= minStockThreshold (15), even though total physical is 31!
    expect(summary.availabilityStatus).toBe('low_stock');
    expect(summary.statusLabels).toEqual(['Low Stock', 'Near Expiry', 'Expired']);
    // FEFO sorting puts B-NEAR before B-FRESH, and expired last
    expect(summary.batches.map((b) => b.batchNumber)).toEqual(['B-NEAR', 'B-FRESH', 'B-EXP']);
  });

  test('deducts sales using strict FEFO order and rejects selling expired stock', async () => {
    const today = getStoreToday();
    const product = await Product.create({
      sku: 'BKY-900',
      name: 'Artisan Bread',
      category: 'Bakery',
      unit: 'loaves',
      defaultSupplier: 'BakerCo',
      costPrice: 1,
      sellingPrice: 3,
      minStockThreshold: 5,
      reorderQuantity: 20,
    });

    const expired = await InventoryBatch.create({
      productId: product._id,
      batchNumber: 'EXP-01',
      initialQuantity: 10,
      remainingQuantity: 10,
      purchaseDate: addDaysUTC(today, -6),
      expiryDate: addDaysUTC(today, -1),
      supplier: 'BakerCo',
      costPrice: 1,
      sellingPrice: 3,
      storeLocation: 'Shelf 1',
    });

    const earliestActive = await InventoryBatch.create({
      productId: product._id,
      batchNumber: 'ACT-01',
      initialQuantity: 4,
      remainingQuantity: 4,
      purchaseDate: addDaysUTC(today, -2),
      expiryDate: addDaysUTC(today, 1),
      supplier: 'BakerCo',
      costPrice: 1,
      sellingPrice: 3,
      storeLocation: 'Shelf 1',
    });

    const laterActive = await InventoryBatch.create({
      productId: product._id,
      batchNumber: 'ACT-02',
      initialQuantity: 8,
      remainingQuantity: 8,
      purchaseDate: addDaysUTC(today, -1),
      expiryDate: addDaysUTC(today, 5),
      supplier: 'BakerCo',
      costPrice: 1,
      sellingPrice: 3,
      storeLocation: 'Shelf 1',
    });

    // Sell 6 loaves -> takes all 4 from ACT-01 and 2 from ACT-02, leaving EXP-01 untouched
    const sale = await recordSaleFEFO({
      productId: product._id.toString(),
      quantitySold: 6,
    });

    expect(sale.batchAllocations).toHaveLength(2);
    expect(sale.batchAllocations[0].batchNumber).toBe('ACT-01');
    expect(sale.batchAllocations[0].quantityDeducted).toBe(4);
    expect(sale.batchAllocations[1].batchNumber).toBe('ACT-02');
    expect(sale.batchAllocations[1].quantityDeducted).toBe(2);

    const refreshedExpired = await InventoryBatch.findById(expired._id);
    const refreshedAct1 = await InventoryBatch.findById(earliestActive._id);
    const refreshedAct2 = await InventoryBatch.findById(laterActive._id);

    expect(refreshedExpired.remainingQuantity).toBe(10);
    expect(refreshedAct1.remainingQuantity).toBe(0);
    expect(refreshedAct2.remainingQuantity).toBe(6);

    // Attempting to sell 7 (only 6 active left, despite 10 expired on shelf) must fail with 409
    await expect(
      recordSaleFEFO({ productId: product._id.toString(), quantitySold: 7 })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
