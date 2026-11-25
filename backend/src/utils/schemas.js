const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(6).max(128),
});

const createUserSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'manager', 'staff']).default('staff'),
});

const updateUserSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  role: z.enum(['admin', 'manager', 'staff']).optional(),
  isActive: z.boolean().optional(),
});

const createBatchSchema = z.object({
  productId: z.string().optional(),
  sku: z.string().min(2).max(40).trim().optional(),
  name: z.string().min(2).max(140).trim().optional(),
  category: z.string().min(2).max(80).trim().optional(),
  unit: z.enum(['units', 'kg', 'liters', 'packs', 'boxes', 'bottles', 'loaves']).optional(),
  minStockThreshold: z.coerce.number().min(0).optional(),
  reorderQuantity: z.coerce.number().min(1).optional(),
  leadTimeDays: z.coerce.number().int().min(1).max(60).optional(),
  nearExpiryWindowDays: z.coerce.number().int().min(1).max(90).optional(),
  shelfLifeDays: z.coerce.number().int().min(1).max(1095).optional(),
  batchNumber: z.string().min(2).max(64).trim(),
  quantity: z.coerce.number().positive(),
  purchaseDate: z.string().min(8),
  expiryDate: z.string().min(8),
  supplier: z.string().min(2).max(120).trim(),
  costPrice: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  storeLocation: z.string().min(1).max(80).trim().default('Main Shelf'),
  notes: z.string().max(300).optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(2).max(140).trim().optional(),
  category: z.string().min(2).max(80).trim().optional(),
  unit: z.enum(['units', 'kg', 'liters', 'packs', 'boxes', 'bottles', 'loaves']).optional(),
  defaultSupplier: z.string().min(2).max(120).trim().optional(),
  costPrice: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  minStockThreshold: z.coerce.number().min(0).optional(),
  reorderQuantity: z.coerce.number().min(1).optional(),
  leadTimeDays: z.coerce.number().int().min(1).max(60).optional(),
  nearExpiryWindowDays: z.coerce.number().int().min(1).max(90).optional(),
  storeLocation: z.string().min(1).max(80).trim().optional(),
});

const updateBatchSchema = z.object({
  remainingQuantity: z.coerce.number().min(0).optional(),
  expiryDate: z.string().min(8).optional(),
  supplier: z.string().min(2).max(120).trim().optional(),
  costPrice: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  storeLocation: z.string().min(1).max(80).trim().optional(),
  notes: z.string().max(300).optional(),
});

const recordSaleSchema = z.object({
  productId: z.string().min(1),
  quantitySold: z.coerce.number().positive(),
  unitSellingPrice: z.coerce.number().min(0).optional(),
  wasDiscounted: z.boolean().optional(),
  saleDate: z.string().optional(),
});

const logWasteSchema = z.object({
  batchId: z.string().min(1),
  quantityWasted: z.coerce.number().positive().optional(),
  reason: z.enum(['expired', 'damaged', 'spoiled', 'quality_reject']),
  notes: z.string().max(300).optional(),
});

const updateReorderStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'ordered', 'dismissed']),
});

const updateConfigSchema = z.object({
  storeName: z.string().min(2).max(120).optional(),
  defaultNearExpiryDays: z.coerce.number().int().min(1).max(90).optional(),
  defaultLeadTimeDays: z.coerce.number().int().min(1).max(30).optional(),
  targetCoverDays: z.coerce.number().int().min(1).max(60).optional(),
  discountTriggerDays: z.coerce.number().int().min(1).max(14).optional(),
});

module.exports = {
  loginSchema,
  createUserSchema,
  updateUserSchema,
  createBatchSchema,
  updateProductSchema,
  updateBatchSchema,
  recordSaleSchema,
  logWasteSchema,
  updateReorderStatusSchema,
  updateConfigSchema,
};
