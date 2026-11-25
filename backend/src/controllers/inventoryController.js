const mongoose = require('mongoose');
const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const SalesRecord = require('../models/SalesRecord');
const WasteLog = require('../models/WasteLog');
const AppError = require('../utils/AppError');
const { toDateOnlyUTC } = require('../utils/dateUtils');
const { loadAllInventoryWithStock, getStoreConfig } = require('../services/inventoryQueryService');
const { aggregateProductStock } = require('../services/stockService');
const { recordAudit } = require('../services/auditService');

async function listInventory(req, res, next) {
  try {
    const { search, category, supplier, stockStatus, expiryStatus, nearExpiryDays } = req.query;
    const data = await loadAllInventoryWithStock({
      nearExpiryDays,
      search,
      category,
      supplier,
      stockStatus,
      expiryStatus,
    });

    return res.json({
      items: data.items,
      filters: data.filters,
      nearExpiryWindowDays:
        nearExpiryDays && Number(nearExpiryDays) > 0
          ? Number(nearExpiryDays)
          : data.storeConfig.defaultNearExpiryDays,
    });
  } catch (err) {
    return next(err);
  }
}

async function getProductInventory(req, res, next) {
  try {
    const { productId } = req.params;
    if (!mongoose.isValidObjectId(productId)) {
      return next(new AppError(400, 'Invalid product identifier.'));
    }
    const nearExpiryDays = req.query.nearExpiryDays ? Number(req.query.nearExpiryDays) : null;
    const [storeConfig, product, batches, wasteStats] = await Promise.all([
      getStoreConfig(),
      Product.findById(productId).lean(),
      InventoryBatch.find({ productId }).lean(),
      WasteLog.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(productId) } },
        {
          $group: {
            _id: null,
            wastedQuantity: { $sum: '$quantityWasted' },
            wastedLossAmount: { $sum: '$estimatedLossAmount' },
          },
        },
      ]),
    ]);

    if (!product || !product.isActive) {
      return next(new AppError(404, 'Product not found.'));
    }

    const waste = wasteStats[0] || { wastedQuantity: 0, wastedLossAmount: 0 };
    const aggregated = aggregateProductStock({
      product,
      batches,
      wastedQuantity: waste.wastedQuantity,
      wastedLossAmount: waste.wastedLossAmount,
      nearExpiryWindowDays: nearExpiryDays ?? storeConfig.defaultNearExpiryDays,
    });

    return res.json({ item: aggregated });
  } catch (err) {
    return next(err);
  }
}

/**
 * Adds a new batch to an existing product OR creates a brand-new product SKU + initial batch.
 */
async function createBatchOrProduct(req, res, next) {
  try {
    const payload = req.body;
    const purchaseDate = toDateOnlyUTC(payload.purchaseDate);
    const expiryDate = toDateOnlyUTC(payload.expiryDate);

    if (expiryDate < purchaseDate) {
      return next(new AppError(400, 'Expiry date cannot be earlier than purchase date.'));
    }

    let product = null;
    if (payload.productId) {
      product = await Product.findById(payload.productId);
      if (!product || !product.isActive) {
        return next(new AppError(404, 'Target product not found.'));
      }
    } else {
      if (!payload.name || !payload.category) {
        return next(
          new AppError(400, 'When creating a new item, product name and category are required.')
        );
      }
      const generatedSku =
        payload.sku ||
        `${payload.category.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-5)}`;

      const existingBySku = await Product.findOne({ sku: generatedSku.toUpperCase() });
      if (existingBySku) {
        return next(new AppError(409, `Product SKU ${generatedSku} already exists.`));
      }

      product = await Product.create({
        sku: generatedSku.toUpperCase(),
        name: payload.name,
        category: payload.category,
        unit: payload.unit || 'units',
        defaultSupplier: payload.supplier,
        costPrice: payload.costPrice,
        sellingPrice: payload.sellingPrice,
        minStockThreshold: payload.minStockThreshold ?? 10,
        reorderQuantity: payload.reorderQuantity ?? 25,
        leadTimeDays: payload.leadTimeDays ?? 3,
        nearExpiryWindowDays: payload.nearExpiryWindowDays ?? 7,
        shelfLifeDays: payload.shelfLifeDays ?? 14,
        storeLocation: payload.storeLocation,
      });
    }

    const dupBatch = await InventoryBatch.findOne({
      productId: product._id,
      batchNumber: payload.batchNumber.toUpperCase(),
    });
    if (dupBatch) {
      return next(
        new AppError(409, `Batch ${payload.batchNumber.toUpperCase()} already exists for ${product.name}.`)
      );
    }

    const batch = await InventoryBatch.create({
      productId: product._id,
      batchNumber: payload.batchNumber.toUpperCase(),
      initialQuantity: payload.quantity,
      remainingQuantity: payload.quantity,
      purchaseDate,
      expiryDate,
      supplier: payload.supplier,
      costPrice: payload.costPrice,
      sellingPrice: payload.sellingPrice,
      storeLocation: payload.storeLocation,
      notes: payload.notes || '',
      createdBy: req.user.id,
    });

    await recordAudit({
      req,
      action: 'BATCH_CREATED',
      targetCollection: 'inventory_batches',
      targetId: batch._id.toString(),
      summary: `Added batch ${batch.batchNumber} (${batch.initialQuantity} ${product.unit}) for ${product.name}`,
      metadata: { productId: product._id.toString(), expiryDate: payload.expiryDate },
    });

    return res.status(201).json({ product, batch });
  } catch (err) {
    return next(err);
  }
}

async function updateProduct(req, res, next) {
  try {
    const product = await Product.findByIdAndUpdate(req.params.productId, req.body, {
      new: true,
      runValidators: true,
    });
    if (!product) return next(new AppError(404, 'Product not found.'));

    await recordAudit({
      req,
      action: 'PRODUCT_UPDATED',
      targetCollection: 'products',
      targetId: product._id.toString(),
      summary: `Updated product ${product.name} (${product.sku})`,
      metadata: req.body,
    });

    return res.json({ product });
  } catch (err) {
    return next(err);
  }
}

async function updateBatch(req, res, next) {
  try {
    const updates = { ...req.body };
    if (updates.expiryDate) {
      updates.expiryDate = toDateOnlyUTC(updates.expiryDate);
    }
    const batch = await InventoryBatch.findByIdAndUpdate(req.params.batchId, updates, {
      new: true,
      runValidators: true,
    });
    if (!batch) return next(new AppError(404, 'Batch not found.'));

    await recordAudit({
      req,
      action: 'BATCH_UPDATED',
      targetCollection: 'inventory_batches',
      targetId: batch._id.toString(),
      summary: `Updated batch ${batch.batchNumber}`,
      metadata: req.body,
    });

    return res.json({ batch });
  } catch (err) {
    return next(err);
  }
}

async function deleteBatch(req, res, next) {
  try {
    const batch = await InventoryBatch.findById(req.params.batchId);
    if (!batch) return next(new AppError(404, 'Batch not found.'));

    const [referencedInSales, referencedInWaste] = await Promise.all([
      SalesRecord.exists({ 'batchAllocations.batchId': batch._id }),
      WasteLog.exists({ batchId: batch._id }),
    ]);

    if (referencedInSales || referencedInWaste) {
      return next(
        new AppError(
          409,
          'Cannot delete batch that has sales or waste audit history. Use Waste Disposal to write off remaining units.'
        )
      );
    }

    await InventoryBatch.deleteOne({ _id: batch._id });
    await recordAudit({
      req,
      action: 'BATCH_DELETED',
      targetCollection: 'inventory_batches',
      targetId: batch._id.toString(),
      summary: `Deleted unreferenced batch ${batch.batchNumber}`,
    });

    return res.json({ message: 'Batch deleted successfully.' });
  } catch (err) {
    return next(err);
  }
}

async function deleteProduct(req, res, next) {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return next(new AppError(404, 'Product not found.'));

    const [hasSales, hasWaste] = await Promise.all([
      SalesRecord.exists({ productId: product._id }),
      WasteLog.exists({ productId: product._id }),
    ]);

    if (hasSales || hasWaste) {
      product.isActive = false;
      await product.save();
      await recordAudit({
        req,
        action: 'PRODUCT_ARCHIVED',
        targetCollection: 'products',
        targetId: product._id.toString(),
        summary: `Archived product ${product.name} while preserving sales/waste audit history`,
      });
      return res.json({ message: 'Product archived to preserve audit and waste history.', archived: true });
    }

    await InventoryBatch.deleteMany({ productId: product._id });
    await Product.deleteOne({ _id: product._id });
    await recordAudit({
      req,
      action: 'PRODUCT_DELETED',
      targetCollection: 'products',
      targetId: product._id.toString(),
      summary: `Deleted product ${product.name} and its unused batches`,
    });

    return res.json({ message: 'Product deleted successfully.', archived: false });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listInventory,
  getProductInventory,
  createBatchOrProduct,
  updateProduct,
  updateBatch,
  deleteBatch,
  deleteProduct,
};
