import express from 'express';
import { prepare } from '../config/database.js';
import {
  isCreativeEngineBusy,
  startNewCreativeVideoJob,
  retryCreativeVideoJob
} from '../services/creative/creativeVideoEngine.js';
import { getCharacters, SCRIPT_TONES } from '../services/creative/creativeAssets.js';
import { isPexelsConfigured, testPexelsApiKey } from '../services/creative/pexelsService.js';
import { isShotstackConfigured, testShotstackApiKey } from '../services/creative/shotstackRenderService.js';
import { isGeminiVideoConfigured } from '../services/creative/geminiVideoService.js';
import {
  getCreativeStudioSettings,
  CREATIVE_STUDIO_SETTING_KEYS
} from '../services/creative/creativeStudioSettings.js';
import { planCreativeVideo, briefJsonForPlanEditor } from '../services/creative/creativeScriptService.js';
import scheduler from '../services/scheduler.js';

const router = express.Router();

router.get('/settings', (req, res) => {
  try {
    const raw = getCreativeStudioSettings();
    const openaiKey = (raw.creative_openai_api_key || '').trim();
    const geminiKey = (raw.creative_gemini_api_key || '').trim();
    const geminiVideoKey = (raw.creative_gemini_video_api_key || '').trim();
    const pexelsKey = (raw.creative_pexels_api_key || '').trim();
    const shotstackKey = (raw.creative_shotstack_api_key || '').trim();
    const googleTtsKey = (raw.creative_google_tts_api_key || '').trim();
    const safe = { ...raw };
    delete safe.creative_openai_api_key;
    delete safe.creative_gemini_api_key;
    delete safe.creative_gemini_video_api_key;
    delete safe.creative_pexels_api_key;
    delete safe.creative_shotstack_api_key;
    delete safe.creative_google_tts_api_key;
    safe.creative_openai_key_configured = openaiKey.length > 0;
    safe.creative_gemini_key_configured = geminiKey.length > 0;
    safe.creative_gemini_video_key_configured = geminiVideoKey.length > 0;
    safe.creative_pexels_key_configured = pexelsKey.length > 0;
    safe.creative_shotstack_key_configured = shotstackKey.length > 0;
    safe.creative_google_tts_key_configured = googleTtsKey.length > 0;
    safe.creative_google_tts_from_env = !!(process.env.GOOGLE_CLOUD_TTS_API_KEY || '').trim();
    safe.creative_gemini_from_env = !!(process.env.CREATIVE_GEMINI_API_KEY || '').trim();
    safe.creative_gemini_video_from_env = !!(process.env.CREATIVE_GEMINI_VIDEO_API_KEY || '').trim();
    safe.creative_openai_from_env = !!(process.env.CREATIVE_OPENAI_API_KEY || '').trim();
    safe.creative_llm_provider_from_env = !!(process.env.CREATIVE_LLM_PROVIDER || '').trim();
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const body = req.body || {};
    let cronChanged = false;
    for (const key of CREATIVE_STUDIO_SETTING_KEYS) {
      if (body[key] === undefined) continue;
      if (
        key === 'creative_openai_api_key' ||
        key === 'creative_gemini_api_key' ||
        key === 'creative_gemini_video_api_key' ||
        key === 'creative_pexels_api_key' ||
        key === 'creative_shotstack_api_key' ||
        key === 'creative_google_tts_api_key'
      ) {
        const v = String(body[key] || '').trim();
        if (!v) continue;
        prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        `).run(key, v);
        continue;
      }
      prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(key, String(body[key]));
      if (key === 'creative_video_cron') cronChanged = true;
    }
    if (cronChanged) scheduler.rescheduleCreativeVideo();
    res.json({ success: true });
  } catch (e) {
    console.error('shortvid settings:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/options', (req, res) => {
  try {
    res.json({ characters: getCharacters(), tones: SCRIPT_TONES });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status', (req, res) => {
  const settings = getCreativeStudioSettings();
  res.json({
    busy: isCreativeEngineBusy(),
    pexels_configured: isPexelsConfigured(),
    shotstack_configured: isShotstackConfigured(),
    gemini_video_configured: isGeminiVideoConfigured(settings)
  });
});

router.post('/pexels/test', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    const result = await testPexelsApiKey(apiKey || undefined);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/shotstack/test', async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    const result = await testShotstackApiKey(apiKey || undefined);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/jobs', (req, res) => {
  try {
    const limit = Math.min(80, Math.max(1, parseInt(req.query.limit || '40', 10)));
    const rows = prepare(
      `
      SELECT id, status, trigger_source, video_description, script_tone, user_notes,
             character_id, render_provider, external_render_id, output_url,
             error_message, created_at, updated_at
      FROM creative_video_jobs
      ORDER BY id DESC
      LIMIT ?
    `
    ).all(limit);
    res.json({ jobs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = prepare(`SELECT * FROM creative_video_jobs WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    let brief = null;
    if (row.brief_json) {
      try {
        brief = JSON.parse(row.brief_json);
      } catch {
        brief = null;
      }
    }
    let pexelsUrls = null;
    if (row.pexels_urls_json) {
      try {
        pexelsUrls = JSON.parse(row.pexels_urls_json);
      } catch {
        pexelsUrls = null;
      }
    }
    res.json({ job: { ...row, brief, pexels_urls: pexelsUrls } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/plan', async (req, res) => {
  try {
    const body = req.body || {};
    const videoDescription = String(body.videoDescription || '').trim();
    if (videoDescription.length < 8) {
      return res.status(400).json({ error: 'תיאור הסרטון קצר מדי (לפחות 8 תווים)' });
    }
    const scriptTone = String(body.scriptTone || 'adults').trim().toLowerCase();
    const userNotes = String(body.userNotes || '').trim().slice(0, 8000);
    const production = body.production && typeof body.production === 'object' ? body.production : null;

    const settings = getCreativeStudioSettings();
    const { brief, planDocument } = await planCreativeVideo(settings, {
      videoDescription,
      toneId: scriptTone,
      userNotes,
      production
    });
    res.json({
      planDocument,
      brief,
      briefJson: briefJsonForPlanEditor(brief),
      llmRawText: brief.debug?.llm_raw_text ?? null,
      llmPromptFullText: brief.debug?.llm_prompt_full_text ?? null,
      llmProvider: brief.debug?.llm_provider ?? null
    });
  } catch (e) {
    console.error('creative /plan:', e);
    res.status(400).json({ error: e.message || String(e) });
  }
});

router.post('/jobs', async (req, res) => {
  try {
    const {
      videoDescription,
      scriptTone,
      userNotes,
      characterId,
      production,
      planDocument,
      approvedBriefJson
    } = req.body || {};
    const { jobId } = await startNewCreativeVideoJob({
      videoDescription,
      scriptTone,
      userNotes,
      characterId,
      triggerSource: 'manual',
      productionInput: production && typeof production === 'object' ? production : undefined,
      planDocument,
      approvedBriefJson
    });
    res.json({ jobId, status: 'started' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/jobs/:id/retry', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { jobId } = await retryCreativeVideoJob(id);
    res.json({ jobId, status: 'started' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
