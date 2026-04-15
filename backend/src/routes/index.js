import express from 'express';
import fs from 'fs';
import path from 'path';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import * as authController from '../controllers/authController.js';
import creativeRoutes from './creativeRoutes.js';
import { prepare, getDataRoot } from '../config/database.js';

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

/** Public MP3 for Shotstack render (Google Cloud TTS path). No auth — URL is not secret; file exists only during/after job processing. */
router.get('/creative/public-tts/:jobId', (req, res) => {
  const id = parseInt(String(req.params.jobId), 10);
  if (!Number.isFinite(id) || id < 1) return res.status(400).end();
  const row = prepare('SELECT id FROM creative_video_jobs WHERE id = ?').get(id);
  if (!row) return res.status(404).end();
  const fp = path.join(getDataRoot(), 'creative_tts', `${id}.mp3`);
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  fs.createReadStream(fp).pipe(res);
});

router.use('/creative', authenticateToken, requireRole('admin', 'editor'), creativeRoutes);

export default router;
