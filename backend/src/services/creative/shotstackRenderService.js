/**
 * Shotstack Edit API — https://shotstack.io/docs/api/
 * API key: SHOTSTACK_API_KEY env, or creative_shotstack_api_key in DB (הגדרות סטודיו). Env wins.
 * SHOTSTACK_HOST, SHOTSTACK_EDIT_VERSION — environment only (optional).
 */

import { prepare } from '../../config/database.js';

function baseUrl() {
  const explicit = (process.env.SHOTSTACK_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const host = (process.env.SHOTSTACK_HOST || 'api.shotstack.io').replace(/^https?:\/\//, '');
  const ver = (process.env.SHOTSTACK_EDIT_VERSION || 'v1').trim();
  return `https://${host}/edit/${ver}`;
}

function candidateBaseUrls() {
  const first = baseUrl();
  const out = [first];
  // If no explicit override, try common stage/prod endpoint variants.
  if (!(process.env.SHOTSTACK_BASE_URL || '').trim()) {
    out.push('https://api.shotstack.io/edit/stage');
    out.push('https://api.shotstack.io/stage/edit/v1');
  }
  return [...new Set(out.map(s => String(s || '').trim().replace(/\/$/, '')).filter(Boolean))];
}

function packRenderRef(base, id) {
  try {
    const b = Buffer.from(String(base || ''), 'utf8').toString('base64url');
    return `b64:${b}:${id}`;
  } catch {
    return String(id);
  }
}

function unpackRenderRef(ref) {
  const raw = String(ref || '').trim();
  if (!raw.startsWith('b64:')) return { base: baseUrl(), id: raw };
  const p = raw.indexOf(':', 4);
  if (p < 0) return { base: baseUrl(), id: raw };
  const b64 = raw.slice(4, p);
  const id = raw.slice(p + 1);
  try {
    const b = Buffer.from(b64, 'base64url').toString('utf8');
    return { base: b || baseUrl(), id };
  } catch {
    return { base: baseUrl(), id };
  }
}

/** @param {string} [override] non-empty = use only this (e.g. test before save) */
export function resolveShotstackApiKey(override) {
  const o = String(override || '').trim();
  if (o) return o;
  const env = (process.env.SHOTSTACK_API_KEY || '').trim();
  if (env) return env;
  const row = prepare('SELECT value FROM settings WHERE key = ?').get('creative_shotstack_api_key');
  return String(row?.value || '').trim();
}

export function isShotstackConfigured() {
  return resolveShotstackApiKey().length > 0;
}

/**
 * Auth check: GET a non-existent render id — 404 means key accepted; 401/403 means bad key.
 * @param {string} [optionalOverride]
 */
export async function testShotstackApiKey(optionalOverride) {
  const key = resolveShotstackApiKey(optionalOverride);
  if (!key) {
    throw new Error(
      'אין מפתח Shotstack — הגדר SHOTSTACK_API_KEY בסביבה או שמור מפתח בהגדרות הסטודיו.'
    );
  }
  const fakeId = '00000000-0000-0000-0000-000000000001';
  let authDenied = 0;
  for (const b of candidateBaseUrls()) {
    const res = await fetch(`${b}/render/${encodeURIComponent(fakeId)}`, {
      headers: {
        Accept: 'application/json',
        'x-api-key': key
      },
      signal: AbortSignal.timeout(15000)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      authDenied++;
      continue;
    }
    if (res.status === 404 || res.status === 400 || res.ok) {
      return { ok: true, note: 'auth_ok', base_url: b };
    }
    const msg = data?.message || JSON.stringify(data).slice(0, 240);
    throw new Error(`Shotstack ${res.status}: ${msg}`);
  }
  if (authDenied > 0) {
    throw new Error('מפתח Shotstack לא תקין/חסר הרשאת queue, או שאינו תואם לסביבת endpoint (stage/production).');
  }
  throw new Error('לא הצלחנו לאמת חיבור ל-Shotstack.');
}

/**
 * @param {{
 *   videoUrls: string[],
 *   segmentLengthSec: number,
 *   narration: string,
 *   voice: string,
 *   scenes: { text: string, start_sec: number, duration_sec: number }[],
 *   characterImageUrl?: string | null,
 *   totalDurationSec: number,
 *   includeVoiceover?: boolean,
 *   voiceoverAudioUrl?: string | null
 * }} params
 */
export function buildVerticalEdit(params) {
  const {
    videoUrls,
    segmentLengthSec,
    narration,
    voice,
    scenes,
    characterImageUrl,
    totalDurationSec,
    includeVoiceover = true,
    voiceoverAudioUrl
  } = params;

  const total = Math.min(60, Math.max(12, totalDurationSec));
  const seg = Math.min(20, Math.max(4, segmentLengthSec));
  const tracks = [];

  const videoClips = [];
  let t = 0;
  let i = 0;
  while (t < total - 0.1 && videoUrls.length) {
    const src = videoUrls[i % videoUrls.length];
    const len = Math.min(seg, total - t);
    videoClips.push({
      asset: {
        type: 'video',
        src,
        volume: 0,
        transcode: true
      },
      start: t,
      length: len,
      fit: 'cover'
    });
    t += len;
    i++;
  }

  if (!videoClips.length) {
    throw new Error('No Pexels video URLs to place on the timeline');
  }

  tracks.push({ clips: videoClips });

  if (characterImageUrl) {
    tracks.push({
      clips: [
        {
          asset: {
            type: 'image',
            src: characterImageUrl
          },
          start: 0,
          length: total,
          fit: 'none',
          scale: 0.22,
          position: 'bottomRight',
          offset: { x: -0.02, y: -0.04 }
        }
      ]
    });
  }

  const textClips = (scenes || [])
    .filter(s => s.text && s.duration_sec > 0)
    .map(s => ({
      asset: {
        type: 'title',
        text: String(s.text).slice(0, 72),
        style: 'minimal',
        size: 'small',
        color: '#ffffffff',
        background: '#aa000000',
        position: 'bottom'
      },
      start: Math.max(0, Number(s.start_sec) || 0),
      length: Math.min(12, Math.max(1, Number(s.duration_sec) || 3)),
      transition: { in: 'fade', out: 'fade' }
    }));

  if (textClips.length) {
    tracks.push({ clips: textClips });
  }

  if (includeVoiceover !== false) {
    const audioSrc = String(voiceoverAudioUrl || '').trim();
    if (audioSrc) {
      tracks.push({
        clips: [
          {
            asset: {
              type: 'audio',
              src: audioSrc,
              volume: 1
            },
            start: 0,
            length: total
          }
        ]
      });
    } else {
      tracks.push({
        clips: [
          {
            asset: {
              type: 'text-to-speech',
              text: narration.slice(0, 4500),
              voice: voice || 'Matthew',
              language: 'en-US',
              volume: 1,
              effect: 'fadeIn'
            },
            start: 0,
            length: total
          }
        ]
      });
    }
  }

  return {
    timeline: {
      background: '#000000',
      tracks
    },
    output: {
      format: 'mp4',
      resolution: '1080',
      aspectRatio: '9:16',
      fps: 30,
      quality: 'high'
    }
  };
}

export async function submitRender(editPayload) {
  const key = resolveShotstackApiKey();
  if (!key) {
    throw new Error(
      'SHOTSTACK_API_KEY is not set — add env var or save key in Studio settings'
    );
  }
  let lastErr = null;
  for (const b of candidateBaseUrls()) {
    const res = await fetch(`${b}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key
      },
      body: JSON.stringify(editPayload),
      signal: AbortSignal.timeout(60000)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || JSON.stringify(data).slice(0, 400);
      lastErr = `Shotstack queue failed ${res.status}: ${msg} (endpoint: ${b})`;
      continue;
    }
    const id = data?.response?.id;
    if (!id) throw new Error('Shotstack did not return render id');
    return packRenderRef(b, String(id));
  }
  throw new Error(lastErr || 'Shotstack queue failed on all known endpoints');
}

export async function getRenderStatus(renderId) {
  const key = resolveShotstackApiKey();
  const { base, id } = unpackRenderRef(renderId);
  const res = await fetch(`${base}/render/${encodeURIComponent(id)}`, {
    headers: {
      Accept: 'application/json',
      'x-api-key': key
    },
    signal: AbortSignal.timeout(45000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Shotstack status ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const r = data?.response || {};
  return {
    status: (r.status || '').toLowerCase(),
    url: r.url || null,
    error: r.error || data?.message || null
  };
}

/**
 * Poll until done/failed or timeout.
 * @param {string} renderId
 * @param {{ maxWaitMs?: number, intervalMs?: number }} [opts]
 */
export async function waitForRender(renderId, opts = {}) {
  const maxWait = opts.maxWaitMs ?? 14 * 60 * 1000;
  const interval = opts.intervalMs ?? 4000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const s = await getRenderStatus(renderId);
    if (s.status === 'done' && s.url) return { url: s.url };
    if (s.status === 'failed' || s.status === 'error') {
      throw new Error(s.error || 'Shotstack render failed');
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Shotstack render timed out while polling status');
}
