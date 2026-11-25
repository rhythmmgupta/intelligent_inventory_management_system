const mongoose = require('mongoose');

const wasteLogSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryBatch',
      required: true,
    },
    batchNumber: { type: String, required: true },
    supplier: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    quantityWasted: { type: Number, required: true, min: 0.01 },
    reason: {
      type: String,
      required: true,
      enum: ['expired', 'damaged', 'spoiled', 'quality_reject'],
    },
    estimatedLossAmount: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
    wastedAt: { type: Date, required: true, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

wasteLogSchema.index({ wastedAt: -1 });
wasteLogSchema.index({ productId: 1, reason: 1 });
wasteLogSchema.index({ supplier: 1, category: 1 });

module.exports = mongoose.model('WasteLog', wasteLogSchema);
