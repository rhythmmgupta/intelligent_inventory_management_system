const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    unit: {
      type: String,
      required: true,
      enum: ['units', 'kg', 'liters', 'packs', 'boxes', 'bottles', 'loaves'],
      default: 'units',
    },
    defaultSupplier: { type: String, required: true, trim: true, maxlength: 120 },
    costPrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    minStockThreshold: { type: Number, required: true, min: 0, default: 10 },
    reorderQuantity: { type: Number, required: true, min: 1, default: 25 },
    leadTimeDays: { type: Number, required: true, min: 1, max: 60, default: 3 },
    nearExpiryWindowDays: { type: Number, required: true, min: 1, max: 90, default: 7 },
    shelfLifeDays: { type: Number, min: 1, max: 1095, default: 14 },
    storeLocation: { type: String, required: true, trim: true, maxlength: 80, default: 'Aisle 1' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', category: 'text', defaultSupplier: 'text', sku: 'text' });
productSchema.index({ category: 1, defaultSupplier: 1 });

module.exports = mongoose.model('Product', productSchema);
