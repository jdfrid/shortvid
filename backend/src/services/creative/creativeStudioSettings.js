import { prepare } from '../../config/database.js';

/** Settings used only by the Creative video studio (Pexels + Shotstack). */
export const CREATIVE_STUDIO_SETTING_KEYS = [
  'creative_llm_provider',
  'creative_gemini_api_key',
  'creative_pexels_api_key',
  'creative_shotstack_api_key',
  'creative_gemini_model',
  'creative_openai_api_key',
  'creative_openai_model',
  'creative_video_provider',
  'creative_video_auto_enabled',
  'creative_video_cron',
  'creative_auto_description',
  'creative_auto_tone',
  'creative_pexels_per_page',
  'creative_pexels_orientation',
  'creative_pexels_timeout_sec',
  'creative_pexels_prefer_quality'
];

export function getCreativeStudioSettings() {
  const out = {};
  for (const k of CREATIVE_STUDIO_SETTING_KEYS) {
    const row = prepare('SELECT value FROM settings WHERE key = ?').get(k);
    out[k] = row?.value ?? '';
  }
  return out;
}
