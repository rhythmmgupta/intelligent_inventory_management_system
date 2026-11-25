const config = require('./config/env');
const logger = require('./config/logger');
const { connectDatabase, disconnectDatabase } = require('./config/db');
const createApp = require('./app');

async function start() {
  await connectDatabase(config.mongoUri);
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info('FreshGuard Backend listening', { port: config.port, env: config.nodeEnv });
  });

  const shutdown = async (signal) => {
    logger.info('Graceful shutdown initiated', { signal });
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Failed to start backend server', { error: err.message });
  process.exit(1);
});
