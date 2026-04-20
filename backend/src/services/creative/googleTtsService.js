import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

/**
 * Google Cloud Text-to-Speech (REST). API key with "Cloud Text-to-Speech API" enabled.
 * Env: GOOGLE_CLOUD_TTS_API_KEY, PUBLIC_BASE_URL or RENDER_EXTERNAL_URL (for Shotstack to fetch audio).
 */

export function resolveGoogleTtsApiKey(settings) {
  const env = (process.env.GOOGLE_CLOUD_TTS_API_KEY || '').trim();
  if (env) return env;
  return String(settings?.creative_google_tts_api_key || '').trim();
}

export function publicAppBaseUrl() {
  const u = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  return u;
}

function redactUrlSecrets(u) {
  return String(u || '')
    .replace(/([?&]key=)[^&]+/gi, '$1***')
    .replace(/([?&]access_token=)[^&]+/gi, '$1***');
}

function previewJson(obj, max = 8000) {
  try {
    return JSON.stringify(obj).slice(0, max);
  } catch {
    return '';
  }
}

/**
 * @param {{ text: string, voiceName: string, languageCode: string, apiKey: string }} opts
 * @param {string} outPath absolute path to .mp3
 */
export async function synthesizeToMp3File(opts, outPath) {
  const apiKey = String(opts.apiKey || '').trim();
  if (!apiKey) throw new Error('חסר מפתח Google Cloud TTS');

  const text = String(opts.text || '').trim().slice(0, 4500);
  if (!text) throw new Error('אין טקסט לדיבור');

  let languageCode = String(opts.languageCode || 'en-US').trim().replace('_', '-').slice(0, 16) || 'en-US';
  let voiceName = String(opts.voiceName || 'en-US-Neural2-A').trim() || 'en-US-Neural2-A';

  const body = {
    input: { text },
    voice: { languageCode, name: voiceName },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 1 }
  };

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });

  const httpTrace = {
    label: 'Google Cloud Text-to-Speech synthesize',
    url: redactUrlSecrets(url),
    method: 'POST',
    status: res.status,
    request_body_preview: previewJson(body, 8000),
    response_text_preview: ''
  };

  if (!res.ok) {
    const err = await res.text();
    httpTrace.response_text_preview = err.slice(0, 8000);
    const e = new Error(`Google TTS: ${res.status} — ${err.slice(0, 280)}`);
    e.googleTtsHttpTrace = httpTrace;
    throw e;
  }

  const data = await res.json();
  const b64 = data.audioContent;
  if (!b64) throw new Error('Google TTS: תשובה ריקה');

  httpTrace.response_text_preview = previewJson(
    { audioContent: `${String(b64).slice(0, 48)}…(base64, ${String(b64).length} chars)` },
    8000
  );

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(b64, 'base64'));
  return { googleTtsHttpTrace: httpTrace };
}
