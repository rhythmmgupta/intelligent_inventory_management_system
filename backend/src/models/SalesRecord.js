const mongoose = require('mongoose');

const batchAllocationSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryBatch', required: true },
    batchNumber: { type: String, required: true },
    quantityDeducted: { type: Number, required: true, min: 0.01 },
    expiryDate: { type: Date, required: true },
  },
  { _id: false }
);

const salesRecordSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    quantitySold: { type: Number, required: true, min: 0.01 },
    unitSellingPrice: { type: Number, required: true, min: 0 },
    totalRevenue: { type: Number, required: true, min: 0 },
    wasDiscounted: { type: Boolean, default: false },
    saleDate: { type: Date, required: true, default: Date.now },
    batchAllocations: { type: [batchAllocationSchema], default: [] },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

salesRecordSchema.index({ productId: 1, saleDate: -1 });
salesRecordSchema.index({ saleDate: -1 });

module.exports = mongoose.model('SalesRecord', salesRecordSchema);
