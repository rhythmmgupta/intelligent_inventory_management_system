const bcrypt = require('bcryptjs');
const config = require('../config/env');
const logger = require('../config/logger');
const { connectDatabase, disconnectDatabase } = require('../config/db');
const { seedDatabase } = require('./seedData');

async function runSeed() {
  const reset = process.argv.includes('--reset');
  await connectDatabase(config.mongoUri);
  const summary = await seedDatabase({ bcrypt, reset });
  logger.info('Seed script completed', summary);
  await disconnectDatabase();
}

runSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seed script failed', { error: err.message });
    process.exit(1);
  });
