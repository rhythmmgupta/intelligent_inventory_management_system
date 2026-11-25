const bcrypt = require('bcryptjs');
const config = require('../config/env');
const logger = require('../config/logger');
const { connectDatabase, disconnectDatabase } = require('../config/db');
const User = require('../models/User');
const StoreConfig = require('../models/StoreConfig');
const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const SalesRecord = require('../models/SalesRecord');
const WasteLog = require('../models/WasteLog');
const ReorderRecommendation = require('../models/ReorderRecommendation');
const MlModelRun = require('../models/MlModelRun');
const AuditLog = require('../models/AuditLog');
const { seedDatabase } = require('./seedData');

/**
 * Idempotent database initialization and migration verification script.
 * Safe to run on every CI/CD deployment (Stage 14).
 */
async function initDatabase() {
  await connectDatabase(config.mongoUri);

  // Ensure all Mongoose schema indexes exist
  await Promise.all([
    User.syncIndexes(),
    StoreConfig.syncIndexes(),
    Product.syncIndexes(),
    InventoryBatch.syncIndexes(),
    SalesRecord.syncIndexes(),
    WasteLog.syncIndexes(),
    ReorderRecommendation.syncIndexes(),
    MlModelRun.syncIndexes(),
    AuditLog.syncIndexes(),
  ]);

  await StoreConfig.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { upsert: true }
  );

  // Bootstrap admin user or full demo dataset if empty and SEED_ON_EMPTY=true
  const userCount = await User.countDocuments();
  if (userCount === 0 && process.env.SEED_ON_EMPTY !== 'false') {
    await seedDatabase({ bcrypt });
    logger.info('Bootstrapped initial FreshGuard dataset on empty database');
  } else {
    logger.info('Database indexes and config verified', { existingUsers: userCount });
  }

  await disconnectDatabase();
}

if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Database initialization failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = { initDatabase };
