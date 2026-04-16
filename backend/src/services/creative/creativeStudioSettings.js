import { prepare } from '../../config/database.js';

const CREATIVE_ENV_OVERRIDES = [
  ['GOOGLE_CLOUD_TTS_API_KEY', 'creative_google_tts_api_key'],
  ['CREATIVE_GEMINI_API_KEY', 'creative_gemini_api_key'],
  ['CREATIVE_GEMINI_VIDEO_API_KEY', 'creative_gemini_video_api_key'],
  ['CREATIVE_OPENAI_API_KEY', 'creative_openai_api_key'],
  ['CREATIVE_LLM_PROVIDER', 'creative_llm_provider'],
  ['CREATIVE_GEMINI_MODEL', 'creative_gemini_model'],
  ['CREATIVE_OPENAI_MODEL', 'creative_openai_model'],
  ['CREATIVE_GEMINI_VIDEO_MODEL', 'creative_gemini_video_model']
];

/** Settings used only by the Creative video studio (Pexels + Shotstack). */
export const CREATIVE_STUDIO_SETTING_KEYS = [
  'creative_llm_provider',
  'creative_gemini_api_key',
  'creative_gemini_video_api_key',
  'creative_pexels_api_key',
  'creative_shotstack_api_key',
  'creative_google_tts_api_key',
  'creative_gemini_model',
  'creative_openai_api_key',
  'creative_openai_model',
  'creative_gemini_video_model',
  'creative_video_provider',
  'creative_video_auto_enabled',
  'creative_video_cron',
  'creative_auto_description',
  'creative_auto_tone',
  'creative_pexels_per_page',
  'creative_pexels_orientation',
  'creative_pexels_timeout_sec',
  'creative_pexels_prefer_quality',
  'creative_voice_mechanism',
  'creative_google_tts_voice'
];

export function getCreativeStudioSettings() {
  const out = {};
  for (const k of CREATIVE_STUDIO_SETTING_KEYS) {
    const row = prepare('SELECT value FROM settings WHERE key = ?').get(k);
    out[k] = row?.value ?? '';
  }
  for (const [envName, settingKey] of CREATIVE_ENV_OVERRIDES) {
    const v = (process.env[envName] || '').trim();
    if (v) out[settingKey] = v;
  }
  return out;
}
