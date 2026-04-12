import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import * as authController from '../controllers/authController.js';
import creativeRoutes from './creativeRoutes.js';

const router = express.Router();

router.get('/health', (req, res) => {
  const xfProto = req.get('x-forwarded-proto');
  const proto = (xfProto || req.protocol || 'https').split(',')[0].trim();
  const host = req.get('host') || '';
  res.json({
    ok: true,
    service: 'shortvid',
    thisOrigin: host ? `${proto}://${host}` : null
  });
});

router.post('/auth/login', authController.login);
router.get('/auth/profile', authenticateToken, authController.getProfile);

router.use('/creative', authenticateToken, requireRole('admin', 'editor'), creativeRoutes);

export default router;
