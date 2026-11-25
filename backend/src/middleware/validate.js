const AppError = require('../utils/AppError');

function validateBody(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        new AppError(400, 'Request validation failed.', parsed.error.flatten().fieldErrors)
      );
    }
    req.body = parsed.data;
    return next();
  };
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const cleaned = {};
    for (const [key, val] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        continue;
      }
      cleaned[key] = sanitizeValue(val);
    }
    return cleaned;
  }
  return value;
}

/**
 * Strips MongoDB operator keys ($gt, $ne, dotted paths) to prevent NoSQL injection.
 */
function sanitizeRequest(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeValue(req.params);
  }
  next();
}

module.exports = {
  validateBody,
  sanitizeRequest,
};
