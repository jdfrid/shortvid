import express from 'express';
import {
  createTavusScriptJob,
  enqueueTavusScriptJob,
  getTavusScriptJob
} from '../services/tavusScriptVideoService.js';

const router = express.Router();

router.post('/jobs', (req, res) => {
  try {
    const scriptText = String(req.body?.scriptText || '').trim();
    const jobId = createTavusScriptJob(scriptText);
    enqueueTavusScriptJob(jobId);
    res.json({ jobId, status: 'started' });
  } catch (e) {
    res.status(400).json({ error: e.message || String(e) });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const row = getTavusScriptJob(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ job: row });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

export default router;
