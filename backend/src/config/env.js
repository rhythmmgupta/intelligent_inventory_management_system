require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  if (isProd) {
    throw new Error('JWT_SECRET must be configured with at least 16 characters in production.');
  }
  return 'dev-only-insecure-secret-change-in-env';
}

const config = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/freshguard_inventory',
  jwtSecret: getJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  mlTimeoutMs: Number(process.env.ML_TIMEOUT_MS || 4000),
  allowedOrigins: (process.env.ALLOWED_ORIGIN || 'http://localhost:5173,http://localhost:3000,http://localhost:80,http://localhost')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  storeTimezoneOffsetMinutes: Number(process.env.STORE_TZ_OFFSET_MINUTES || 0),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
};

module.exports = config;
