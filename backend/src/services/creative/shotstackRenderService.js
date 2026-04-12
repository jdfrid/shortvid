/**
 * Shotstack Edit API — https://shotstack.io/docs/api/
 * Env: SHOTSTACK_API_KEY (required), SHOTSTACK_HOST optional (default api.shotstack.io), SHOTSTACK_EDIT_VERSION (default v1)
 */

function apiKey() {
  return (process.env.SHOTSTACK_API_KEY || '').trim();
}

function baseUrl() {
  const host = (process.env.SHOTSTACK_HOST || 'api.shotstack.io').replace(/^https?:\/\//, '');
  const ver = (process.env.SHOTSTACK_EDIT_VERSION || 'v1').trim();
  return `https://${host}/edit/${ver}`;
}

export function isShotstackConfigured() {
  return apiKey().length > 0;
}

/**
 * @param {{
 *   videoUrls: string[],
 *   segmentLengthSec: number,
 *   narration: string,
 *   voice: string,
 *   scenes: { text: string, start_sec: number, duration_sec: number }[],
 *   characterImageUrl?: string | null,
 *   totalDurationSec: number
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
    totalDurationSec
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
  const key = apiKey();
  if (!key) throw new Error('SHOTSTACK_API_KEY is not set');

  const res = await fetch(`${baseUrl()}/render`, {
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
    throw new Error(`Shotstack queue failed ${res.status}: ${msg}`);
  }
  const id = data?.response?.id;
  if (!id) throw new Error('Shotstack did not return render id');
  return String(id);
}

export async function getRenderStatus(renderId) {
  const key = apiKey();
  const res = await fetch(`${baseUrl()}/render/${encodeURIComponent(renderId)}`, {
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
