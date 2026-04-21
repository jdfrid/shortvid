import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import * as authController from '../controllers/authController.js';
import creativeRoutes from './creativeRoutes.js';
import shotstackScriptRoutes from './shotstackScriptRoutes.js';
import { prepare, getDataRoot } from '../config/database.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));

function pickDeployTimestamp() {
  // Render has multiple possible env-var names depending on how/when it exposes them.
  const candidates = [
    process.env.RENDER_DEPLOY_TIME,
    process.env.RENDER_CREATED_AT,
    process.env.RENDER_SERVICE_CREATED_AT,
    process.env.RENDER_INSTANCE_CREATED_AT,
    process.env.RENDER_INITIALIZED_AT,
    process.env.RENDER_START_TIME,
    process.env.BUILD_CREATED_AT
  ]
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean);

  for (const c of candidates) {
    const d = new Date(c);
    if (Number.isFinite(d.getTime())) return d;
  }

  // Fallback: time when this Node process started (usually close to deploy time).
  const fallbackIso = globalThis.__shortvid_server_started_at;
  const d2 = fallbackIso ? new Date(fallbackIso) : null;
  if (d2 && Number.isFinite(d2.getTime())) return d2;

  return new Date();
}

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

router.get('/meta', (req, res) => {
  const d = pickDeployTimestamp();
  res.json({
    service: 'shortvid',
    version: backendPkg.version || 'unknown',
    deployedAtIso: d.toISOString(),
    deployedAtHuman: d.toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }),
    gitCommit: process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || null
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
router.use('/shotstack-script', authenticateToken, requireRole('admin', 'editor'), shotstackScriptRoutes);

export default router;
