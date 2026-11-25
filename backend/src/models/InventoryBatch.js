const mongoose = require('mongoose');

const inventoryBatchSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    batchNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    initialQuantity: { type: Number, required: true, min: 0 },
    remainingQuantity: { type: Number, required: true, min: 0 },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    supplier: { type: String, required: true, trim: true, maxlength: 120 },
    costPrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    storeLocation: { type: String, required: true, trim: true, maxlength: 80 },
    isDiscarded: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

inventoryBatchSchema.index({ productId: 1, expiryDate: 1, purchaseDate: 1 });
inventoryBatchSchema.index({ productId: 1, batchNumber: 1 }, { unique: true });
inventoryBatchSchema.index({ expiryDate: 1 });

module.exports = mongoose.model('InventoryBatch', inventoryBatchSchema);
