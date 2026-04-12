/**
 * Pexels Videos API — https://www.pexels.com/api/documentation/
 * API key: PEXELS_API_KEY in environment (never commit keys).
 * Search options (per page, orientation, timeout, quality) come from studio settings in the DB.
 */

const PEXELS_ROOT = 'https://api.pexels.com/videos';

function getKey() {
  return (process.env.PEXELS_API_KEY || '').trim();
}

export function isPexelsConfigured() {
  return getKey().length > 0;
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
 *   preferQuality?: 'hd'|'sd'|'any'
 * }} [opts]
 * @returns {Promise<string[]>} Direct HTTPS links to video files
 */
export async function searchVideoUrls(query, opts = {}) {
  const key = getKey();
  if (!key) throw new Error('PEXELS_API_KEY is not set (add it in Render → Environment)');

  const perPage = Math.min(15, Math.max(1, opts.perPage || 6));
  const orientation = opts.orientation || 'portrait';
  const timeoutMs = Math.min(120000, Math.max(5000, opts.timeoutMs ?? 45000));
  const preferQuality = opts.preferQuality || 'hd';

  const q = encodeURIComponent(query.trim().slice(0, 200));
  const url = `${PEXELS_ROOT}/search?query=${q}&per_page=${perPage}&orientation=${orientation}`;

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
