/**
 * Gemini video generation (Veo-family models via Google Generative Language API).
 * Uses API key auth (same key style as Gemini text models).
 */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeOperationName(name) {
  const n = String(name || '').trim().replace(/^\/+/, '');
  if (!n) return '';
  return n.startsWith('operations/') ? n : `operations/${n}`;
}

function pickFirstString(values) {
  for (const v of values) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

function clip(text, max = 3000) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Find first likely downloadable video URL in unknown response shape. */
function extractVideoUrl(payload) {
  const queue = [payload];
  const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    for (const [k, v] of Object.entries(cur)) {
      if (typeof v === 'string') {
        if (/^https?:\/\//i.test(v) && /\.(mp4|mov|webm)(\?|$)/i.test(v)) return v;
        if (/^https?:\/\//i.test(v) && /(video|download|media|file|storage|googleapis)/i.test(k)) return v;
      } else if (v && typeof v === 'object') {
        queue.push(v);
      }
    }
  }
  return '';
}

export function resolveGeminiApiKey(settings) {
  return pickFirstString([
    settings?.creative_gemini_video_api_key,
    process.env.CREATIVE_GEMINI_VIDEO_API_KEY,
    settings?.creative_gemini_api_key,
    process.env.CREATIVE_GEMINI_API_KEY
  ]);
}

export function resolveGeminiVideoModel(settings) {
  return pickFirstString([settings?.creative_gemini_video_model, 'veo-2.0-generate-001']);
}

export function isGeminiVideoConfigured(settings) {
  return resolveGeminiApiKey(settings).length > 0;
}

export function buildGeminiVideoPrompt({ videoDescription, userNotes, brief, productionText, planDocument }) {
  const scenes = Array.isArray(brief?.scenes) ? brief.scenes : [];
  const sceneLines = scenes.length
    ? scenes.map((s, i) => `${i + 1}) ${clip(s.text, 120)} [${s.start_sec}s/${s.duration_sec}s]`).join('\n')
    : '(none)';

  return `Create ONE vertical marketing/social video clip.

Core request:
${clip(videoDescription, 1200)}

Audience + style notes:
${clip(userNotes, 900) || '(none)'}

Narration intent:
${clip(brief?.narration, 1600)}

Visual guidance from planned scenes:
${sceneLines}

Stock search intent / visual keywords:
${(brief?.pexels_search_queries || []).map(q => `- ${clip(q, 80)}`).join('\n') || '(none)'}

Production pack:
${clip(productionText, 1800) || '(none)'}

Plan document context:
${clip(planDocument, 1800) || '(none)'}

Hard constraints:
- Aspect ratio 9:16 (vertical).
- Duration target: 35-55 seconds.
- Keep visuals directly tied to the core request.
- Avoid generic unrelated clips.
- Cinematic, coherent sequence, not random shots.
- No logos/watermarks/text overlays unless implied by the request.`;
}

async function postGenerateVideos({ apiKey, model, prompt, aspectRatio }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateVideos?key=${encodeURIComponent(apiKey)}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: { text: prompt },
      config: { numberOfVideos: 1, aspectRatio: aspectRatio || '9:16' }
    }),
    signal: AbortSignal.timeout(120000)
  });
}

async function postPredictLongRunning({ apiKey, model, prompt, aspectRatio }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: aspectRatio || '9:16' }
    }),
    signal: AbortSignal.timeout(120000)
  });
}

/**
 * Returns either { operationName } or direct { url }.
 */
export async function submitGeminiVideoGeneration({ apiKey, model, prompt, aspectRatio = '9:16' }) {
  if (!apiKey) throw new Error('Gemini video: missing API key');
  if (!model) throw new Error('Gemini video: missing model');
  if (!String(prompt || '').trim()) throw new Error('Gemini video: prompt is empty');

  let res = await postGenerateVideos({ apiKey, model, prompt, aspectRatio });
  let data = await res.json().catch(() => ({}));

  if (!res.ok && (res.status === 404 || res.status === 400 || res.status === 405)) {
    res = await postPredictLongRunning({ apiKey, model, prompt, aspectRatio });
    data = await res.json().catch(() => ({}));
  }

  if (!res.ok) {
    throw new Error(`Gemini video submit ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const directUrl = extractVideoUrl(data);
  if (directUrl) {
    return { url: directUrl, operationName: null, submitPayload: data };
  }

  const operationName = normalizeOperationName(data?.name || data?.operation?.name || data?.response?.name);
  if (!operationName) {
    throw new Error(`Gemini video submit: no operation name or video url in response (${JSON.stringify(data).slice(0, 400)})`);
  }
  return { operationName, url: null, submitPayload: data };
}

async function getOperation({ apiKey, operationName }) {
  const op = normalizeOperationName(operationName);
  const url = `https://generativelanguage.googleapis.com/v1beta/${op}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini operation ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

export async function waitForGeminiVideo({ apiKey, operationName, maxWaitMs = 20 * 60 * 1000, intervalMs = 7000 }) {
  const start = Date.now();
  const op = normalizeOperationName(operationName);
  if (!op) throw new Error('Gemini video: invalid operation name');

  while (Date.now() - start < maxWaitMs) {
    const data = await getOperation({ apiKey, operationName: op });
    const done = !!data?.done;
    if (done) {
      if (data?.error) {
        const msg = data.error.message || JSON.stringify(data.error).slice(0, 400);
        throw new Error(`Gemini video failed: ${msg}`);
      }
      const url =
        extractVideoUrl(data?.response) ||
        extractVideoUrl(data?.result) ||
        extractVideoUrl(data?.metadata) ||
        extractVideoUrl(data);
      if (!url) {
        throw new Error(`Gemini video done but no url in operation response: ${JSON.stringify(data).slice(0, 500)}`);
      }
      return { url, operationPayload: data };
    }
    await sleep(intervalMs);
  }

  throw new Error('Gemini video generation timed out while waiting for operation');
}
