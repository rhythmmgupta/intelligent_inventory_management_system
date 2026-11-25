const mongoose = require('mongoose');

const storeConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    storeName: { type: String, default: 'FreshGuard Retail Flagship #01' },
    defaultNearExpiryDays: { type: Number, default: 7, min: 1, max: 90 },
    defaultLeadTimeDays: { type: Number, default: 3, min: 1, max: 30 },
    targetCoverDays: { type: Number, default: 10, min: 1, max: 60 },
    safetyServiceZScore: { type: Number, default: 1.28, min: 0.5, max: 3.0 },
    discountTriggerDays: { type: Number, default: 3, min: 1, max: 14 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StoreConfig', storeConfigSchema);
