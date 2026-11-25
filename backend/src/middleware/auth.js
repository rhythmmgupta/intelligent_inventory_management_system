const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const AppError = require('../utils/AppError');

async function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const token = bearerToken || (req.cookies ? req.cookies.fg_token : null);

    if (!token) {
      return next(new AppError(401, 'Authentication required. Please log in.'));
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.sub);
    if (!user || !user.isActive) {
      return next(new AppError(401, 'User account is inactive or no longer exists.'));
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };
    return next();
  } catch (_err) {
    return next(new AppError(401, 'Invalid or expired authentication token.'));
  }
}

function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, 'Authentication required.'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(403, `Forbidden: requires one of roles [${allowedRoles.join(', ')}].`)
      );
    }
    return next();
  };
}

module.exports = {
  authenticate,
  requireRole,
};
