const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config/env');
const { pingDatabase } = require('./config/db');
const { pingMlService } = require('./services/mlClientService');
const { register, metricsMiddleware } = require('./config/metrics');
const { sanitizeRequest } = require('./middleware/validate');
const {
  attachRequestContext,
  notFoundHandler,
  errorHandler,
} = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const operationsRoutes = require('./routes/operationsRoutes');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(sanitizeRequest);
  app.use(attachRequestContext);
  app.use(metricsMiddleware);

  // Health, readiness, and Prometheus metrics endpoints
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'freshguard-backend', timestamp: new Date().toISOString() });
  });

  app.get('/ready', async (_req, res) => {
    const dbOk = await pingDatabase().catch(() => false);
    const mlOk = await pingMlService().catch(() => false);
    const status = dbOk ? (mlOk ? 'ready' : 'degraded_ml_fallback') : 'not_ready';
    const httpCode = dbOk ? 200 : 503;
    res.status(httpCode).json({
      status,
      dependencies: {
        mongodb: dbOk ? 'up' : 'down',
        mlService: mlOk ? 'up' : 'unreachable_fallback_active',
      },
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Application API routes
  app.use('/api', authRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api', operationsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
