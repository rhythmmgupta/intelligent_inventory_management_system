const mongoose = require('mongoose');
const config = require('./env');
const logger = require('./logger');

async function connectDatabase(uri = config.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  logger.info('Connected to MongoDB', { dbName: mongoose.connection.name });
  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function pingDatabase() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return false;
  }
  await mongoose.connection.db.admin().ping();
  return true;
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  pingDatabase,
};
