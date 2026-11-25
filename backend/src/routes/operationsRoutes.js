const express = require('express');
const ops = require('../controllers/operationsController');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const {
  recordSaleSchema,
  logWasteSchema,
  updateReorderStatusSchema,
  updateConfigSchema,
} = require('../utils/schemas');

const router = express.Router();

router.use(authenticate);

// Sales (FEFO)
router.get('/sales', ops.listSales);
router.post('/sales', validateBody(recordSaleSchema), ops.createSale);

// Waste & Reduction
router.get('/waste', ops.listWasteLogs);
router.post('/waste', validateBody(logWasteSchema), ops.createWasteLog);
router.get('/waste/analytics', ops.getWasteReport);
router.get('/waste/recommendations', ops.getWasteRecommendationsController);

// Reorders
router.get('/reorders/recommendations', ops.getReorderRecommendations);
router.patch(
  '/reorders/:id/status',
  requireRole('admin', 'manager'),
  validateBody(updateReorderStatusSchema),
  ops.updateReorderStatus
);

// Predictions & ML
router.get('/predictions/forecast/:productId', ops.getProductForecast);
router.get('/predictions/stockouts', ops.getStockoutPredictions);
router.get('/predictions/metrics', ops.getMlMetrics);
router.post('/predictions/retrain', requireRole('admin', 'manager'), ops.retrainModels);

// Dashboard
router.get('/dashboard/summary', ops.getDashboardSummary);

// Admin & Audit
router.get('/audit-logs', requireRole('admin', 'manager'), ops.listAuditLogs);
router.get('/config', ops.getConfig);
router.patch(
  '/config',
  requireRole('admin', 'manager'),
  validateBody(updateConfigSchema),
  ops.updateConfig
);

module.exports = router;
