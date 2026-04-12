/**
 * Pexels Videos API — https://www.pexels.com/api/documentation/
 * Requires PEXELS_API_KEY in environment (never commit keys).
 */

const PEXELS_ROOT = 'https://api.pexels.com/videos';

function getKey() {
  return (process.env.PEXELS_API_KEY || '').trim();
}

export function isPexelsConfigured() {
  return getKey().length > 0;
}

/**
 * @param {string} query
 * @param {{ perPage?: number, orientation?: 'landscape'|'portrait'|'square' }} [opts]
 * @returns {Promise<string[]>} Direct HTTPS links to video files (hd or sd)
 */
export async function searchVideoUrls(query, opts = {}) {
  const key = getKey();
  if (!key) throw new Error('PEXELS_API_KEY is not set (add it in Render → Environment)');

  const perPage = Math.min(15, Math.max(1, opts.perPage || 6));
  const orientation = opts.orientation || 'portrait';
  const q = encodeURIComponent(query.trim().slice(0, 200));
  const url = `${PEXELS_ROOT}/search?query=${q}&per_page=${perPage}&orientation=${orientation}`;

  const res = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(45000)
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
    const hd = files.find(f => f.quality === 'hd' && f.link);
    const sd = files.find(f => f.quality === 'sd' && f.link);
    const any = files.find(f => f.link);
    const link = (hd || sd || any)?.link;
    if (link) out.push(link);
  }

  return out;
}
