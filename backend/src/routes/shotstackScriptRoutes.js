import express from 'express';
import {
  createShotstackScriptJob,
  enqueueShotstackScriptJob,
  getShotstackScriptJob
} from '../services/shotstackScriptVideoService.js';

const router = express.Router();

router.post('/jobs', (req, res) => {
  try {
    const scriptText = String(req.body?.scriptText || '').trim();
    const jobId = createShotstackScriptJob(scriptText);
    enqueueShotstackScriptJob(jobId);
    res.json({ jobId, status: 'started' });
  } catch (e) {
    res.status(400).json({ error: e.message || String(e) });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const row = getShotstackScriptJob(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ job: row });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

export default router;
