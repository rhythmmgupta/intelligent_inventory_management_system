const mongoose = require('mongoose');

const mlModelRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    modelType: { type: String, required: true, default: 'demand_and_stockout' },
    selectedDemandAlgorithm: { type: String, required: true },
    selectedClassifierAlgorithm: { type: String, required: true },
    metrics: {
      regression: {
        mae: Number,
        rmse: Number,
        mape: Number,
      },
      baselineMovingAvg: {
        mae: Number,
        rmse: Number,
        mape: Number,
      },
      candidates: { type: Array, default: [] },
      classification: {
        precision: Number,
        recall: Number,
        f1: Number,
      },
    },
    trainingRows: { type: Number, required: true },
    featureImportance: { type: Array, default: [] },
    trainedAt: { type: Date, default: Date.now },
    isActiveModel: { type: Boolean, default: true },
  },
  { timestamps: true }
);

mlModelRunSchema.index({ trainedAt: -1 });

module.exports = mongoose.model('MlModelRun', mlModelRunSchema);
