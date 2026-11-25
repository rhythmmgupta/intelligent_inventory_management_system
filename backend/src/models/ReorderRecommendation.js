const mongoose = require('mongoose');

const reorderRecommendationSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    activeStockAtGeneration: { type: Number, required: true, min: 0 },
    predictedDailyDemand: { type: Number, required: true, min: 0 },
    recommendedReorderPoint: { type: Number, required: true, min: 0 },
    recommendedQuantity: { type: Number, required: true, min: 0 },
    predictedStockoutDays: { type: Number, default: null },
    predictionSource: {
      type: String,
      enum: ['ml_model', 'rule_fallback'],
      required: true,
    },
    explanation: { type: String, required: true },
    urgency: {
      type: String,
      enum: ['critical', 'high', 'normal'],
      default: 'normal',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'ordered', 'dismissed'],
      default: 'pending',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reorderRecommendationSchema.index({ status: 1, urgency: 1, createdAt: -1 });

module.exports = mongoose.model('ReorderRecommendation', reorderRecommendationSchema);
