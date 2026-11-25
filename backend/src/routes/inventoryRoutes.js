const express = require('express');
const inventoryController = require('../controllers/inventoryController');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const {
  createBatchSchema,
  updateProductSchema,
  updateBatchSchema,
} = require('../utils/schemas');

const router = express.Router();

router.use(authenticate);

router.get('/', inventoryController.listInventory);
router.get('/:productId', inventoryController.getProductInventory);
router.post(
  '/batches',
  requireRole('admin', 'manager'),
  validateBody(createBatchSchema),
  inventoryController.createBatchOrProduct
);
router.patch(
  '/products/:productId',
  requireRole('admin', 'manager'),
  validateBody(updateProductSchema),
  inventoryController.updateProduct
);
router.delete(
  '/products/:productId',
  requireRole('admin', 'manager'),
  inventoryController.deleteProduct
);
router.patch(
  '/batches/:batchId',
  requireRole('admin', 'manager'),
  validateBody(updateBatchSchema),
  inventoryController.updateBatch
);
router.delete(
  '/batches/:batchId',
  requireRole('admin', 'manager'),
  inventoryController.deleteBatch
);

module.exports = router;
