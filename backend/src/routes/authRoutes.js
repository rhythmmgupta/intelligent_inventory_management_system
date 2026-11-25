const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { loginSchema, createUserSchema, updateUserSchema } = require('../utils/schemas');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many login attempts; please wait 15 minutes.' },
});

router.post('/auth/login', loginLimiter, validateBody(loginSchema), authController.login);
router.post('/auth/logout', authenticate, authController.logout);
router.get('/auth/me', authenticate, authController.getMe);

router.get('/users', authenticate, requireRole('admin'), authController.listUsers);
router.post(
  '/users',
  authenticate,
  requireRole('admin'),
  validateBody(createUserSchema),
  authController.createUser
);
router.patch(
  '/users/:id',
  authenticate,
  requireRole('admin'),
  validateBody(updateUserSchema),
  authController.updateUser
);

module.exports = router;
