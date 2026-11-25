const crypto = require('crypto');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

function attachRequestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      latencyMs: Date.now() - startedAt,
      userId: req.user ? req.user.id : null,
    });
  });

  next();
}

function notFoundHandler(req, _res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid identifier format for ${err.path || 'parameter'}.`;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate record violates a unique constraint.';
  }

  if (statusCode === 500 && process.env.NODE_ENV === 'production') {
    message = 'Internal server error';
  }

  if (statusCode >= 500) {
    logger.error('Unhandled request error', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    error: message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  });
}

module.exports = {
  attachRequestContext,
  notFoundHandler,
  errorHandler,
};
