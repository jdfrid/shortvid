/**
 * Pexels Videos API — https://www.pexels.com/api/documentation/
 * Key resolution: 1) PEXELS_API_KEY env 2) creative_pexels_api_key in DB (הגדרות סטודיו).
 * Search options (per page, orientation, timeout, quality) from studio settings in the DB.
 */

import { prepare } from '../../config/database.js';

const PEXELS_ROOT = 'https://api.pexels.com/videos';

/** @param {string} [override] non-empty = use only this (e.g. test before save) */
export function resolvePexelsApiKey(override) {
  const o = String(override || '').trim();
  if (o) return o;
  const env = (process.env.PEXELS_API_KEY || '').trim();
  if (env) return env;
  const row = prepare('SELECT value FROM settings WHERE key = ?').get('creative_pexels_api_key');
  return String(row?.value || '').trim();
}

export function isPexelsConfigured() {
  return resolvePexelsApiKey().length > 0;
}

/**
 * Lightweight call to verify a key works (does not use studio search options).
 * @param {string} [optionalOverride] if non-empty, test this key only
 */
export async function testPexelsApiKey(optionalOverride) {
  const key = resolvePexelsApiKey(optionalOverride);
  if (!key) {
    throw new Error(
      'אין מפתח Pexels — הגדר PEXELS_API_KEY בסביבה או שמור מפתח בהגדרות הסטודיו.'
    );
  }
  const url = `${PEXELS_ROOT}/search?query=nature&per_page=1&orientation=portrait`;
  const res = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Pexels ${res.status}: ${t.slice(0, 240)}`);
  }
  const data = await res.json();
  const videos = data.videos || [];
  return { ok: true, videosReturned: videos.length };
}

function pickVideoLink(files, preferQuality) {
  const prefer = (preferQuality || 'hd').toLowerCase();
  const hd = files.find(f => f.quality === 'hd' && f.link);
  const sd = files.find(f => f.quality === 'sd' && f.link);
  const any = files.find(f => f.link);
  if (prefer === 'sd') return (sd || hd || any)?.link || null;
  if (prefer === 'any') return (any || hd || sd)?.link || null;
  return (hd || sd || any)?.link || null;
}

/**
 * @param {string} query
 * @param {{
 *   perPage?: number,
 *   orientation?: 'landscape'|'portrait'|'square',
 *   timeoutMs?: number,
 *   preferQuality?: 'hd'|'sd'|'any',
 *   page?: number
 * }} [opts]
 * @returns {Promise<string[]>} Direct HTTPS links to video files
 */
export async function searchVideoUrls(query, opts = {}) {
  const key = resolvePexelsApiKey();
  if (!key) {
    throw new Error(
      'אין מפתח Pexels — הגדר PEXELS_API_KEY בסביבה או שמור מפתח בהגדרות הסטודיו.'
    );
  }

  const perPage = Math.min(15, Math.max(1, opts.perPage || 6));
  const orientation = opts.orientation || 'portrait';
  const timeoutMs = Math.min(120000, Math.max(5000, opts.timeoutMs ?? 45000));
  const preferQuality = opts.preferQuality || 'hd';
  const pageRaw = parseInt(String(opts.page ?? 1), 10);
  const page = Math.min(1000, Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1));

  const q = encodeURIComponent(query.trim().slice(0, 200));
  const url = `${PEXELS_ROOT}/search?query=${q}&per_page=${perPage}&orientation=${orientation}&page=${page}`;

  const res = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Pexels search ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const videos = data.videos || [];
  const out = [];

  for (const v of videos) {
    const files = v.video_files || [];
    const link = pickVideoLink(files, preferQuality);
    if (link) out.push(link);
  }

  return out;
}
