const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { recordAudit } = require('../services/auditService');

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');

    if (!user || !user.isActive) {
      await recordAudit({
        req,
        action: 'LOGIN_FAILED',
        targetCollection: 'users',
        summary: `Failed login attempt for ${email}`,
        metadata: { reason: 'user_not_found_or_inactive' },
      });
      return next(new AppError(401, 'Invalid email or password.'));
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await recordAudit({
        req,
        actor: { id: user._id.toString(), email: user.email, role: user.role },
        action: 'LOGIN_FAILED',
        targetCollection: 'users',
        targetId: user._id.toString(),
        summary: `Invalid password attempt for ${email}`,
      });
      return next(new AppError(401, 'Invalid email or password.'));
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = jwt.sign(
      { sub: user._id.toString(), role: user.role, email: user.email },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.cookie('fg_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 8 * 60 * 60 * 1000,
    });

    await recordAudit({
      req,
      actor: { id: user._id.toString(), email: user.email, role: user.role },
      action: 'LOGIN_SUCCESS',
      targetCollection: 'users',
      targetId: user._id.toString(),
      summary: `User ${user.email} (${user.role}) logged in`,
    });

    return res.json({
      token,
      user: user.toSafeJSON(),
    });
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res) {
  res.clearCookie('fg_token');
  await recordAudit({
    req,
    action: 'LOGOUT',
    targetCollection: 'users',
    targetId: req.user.id,
    summary: `User ${req.user.email} logged out`,
  });
  return res.json({ message: 'Logged out successfully.' });
}

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return next(new AppError(404, 'User not found.'));
    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

async function listUsers(_req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return res.json({ users: users.map((u) => u.toSafeJSON()) });
  } catch (err) {
    return next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) {
      return next(new AppError(409, 'A user with this email already exists.'));
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role });

    await recordAudit({
      req,
      action: 'USER_CREATED',
      targetCollection: 'users',
      targetId: user._id.toString(),
      summary: `Created user ${email} with role ${role}`,
    });

    return res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!user) return next(new AppError(404, 'User not found.'));

    await recordAudit({
      req,
      action: 'USER_UPDATED',
      targetCollection: 'users',
      targetId: user._id.toString(),
      summary: `Updated user ${user.email}`,
      metadata: req.body,
    });

    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  login,
  logout,
  getMe,
  listUsers,
  createUser,
  updateUser,
};
