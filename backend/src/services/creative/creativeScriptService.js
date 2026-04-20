import { getToneById } from './creativeAssets.js';
import { formatProductionForPrompt, formatPlanDocumentHe } from './productionPack.js';

function hashString(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Hebrew / Arabic / Cyrillic-heavy descriptions — Pexels works best with English queries */
function isMostlyNonLatin(text) {
  const t = String(text || '').trim();
  if (t.length < 3) return false;
  const latin = (t.match(/[a-zA-Z]/g) || []).length;
  const he = (t.match(/[\u0590-\u05FF]/g) || []).length;
  const ar = (t.match(/[\u0600-\u06FF]/g) || []).length;
  const cy = (t.match(/[\u0400-\u04FF]/g) || []).length;
  return he + ar + cy > latin;
}

/** Rotating English queries so Template mode is not stuck on the same stock pack */
const TEMPLATE_QUERY_SETS = [
  [
    'couple cafe conversation vertical',
    'coffee date romantic portrait',
    'restaurant window couple vertical',
    'urban cafe daylight vertical'
  ],
  [
    'diamond ring close up hand',
    'proposal ring gift box vertical',
    'jewelry sparkle macro vertical',
    'luxury watch wrist vertical'
  ],
  [
    'family home cozy morning vertical',
    'kitchen cooking together vertical',
    'living room natural light vertical',
    'parents kids playing indoor vertical'
  ],
  [
    'beach sunset walking vertical',
    'ocean waves vertical phone',
    'summer travel vertical video',
    'palm trees breeze vertical'
  ],
  [
    'city night traffic bokeh vertical',
    'urban street style walking vertical',
    'skyline dusk vertical phone',
    'metro commute vertical video'
  ],
  [
    'nature forest path vertical',
    'mountain view peaceful vertical',
    'lake reflection calm vertical',
    'countryside golden hour vertical'
  ],
  [
    'gym workout motivation vertical',
    'running city morning vertical',
    'yoga studio calm vertical',
    'fitness energy vertical video'
  ],
  [
    'office handshake meeting vertical',
    'laptop workspace daylight vertical',
    'startup team talking vertical',
    'business casual portrait vertical'
  ]
];

const TEMPLATE_LATIN_TAIL_SETS = [
  ['urban lifestyle portrait vertical', 'golden hour street vertical', 'evening city lights bokeh vertical'],
  ['modern office vertical', 'workspace daylight vertical', 'coffee laptop morning vertical'],
  ['cozy apartment vertical', 'plants window light vertical', 'reading nook calm vertical'],
  ['fashion street vertical', 'shopping bags city vertical', 'boutique mirror vertical'],
  ['food plating close vertical', 'restaurant dish steam vertical', 'cafe pastry vertical'],
  ['pet dog park vertical', 'cat window sunlight vertical', 'home animal cozy vertical'],
  ['music headphones urban vertical', 'concert crowd lights vertical', 'dj party vertical phone'],
  ['art gallery walk vertical', 'museum hall vertical phone', 'creative studio vertical']
];

const BRIEF_SCHEMA = `Return ONLY valid JSON:
{
  "title": "short hook line for the video (English)",
  "narration": "single voiceover paragraph, English, max ~110 words, natural spoken pace for under 55 seconds",
  "pexels_search_queries": ["2-4 short search phrases for stock B-roll, in English, match the visual mood"],
  "scenes": [
    { "text": "on-screen caption, max 8 words", "start_sec": 0, "duration_sec": 4 }
  ],
  "shotstack_voice": "Matthew",
  "production_notes": "optional notes for editors (camera, pacing, brand)"
}
Rules:
- English only for narration and on-screen text.
- scenes: 4–7 items; start_sec must be non-overlapping order; total visual coverage ~0–48s.
- pexels_search_queries: concrete visual terms (e.g. "city night traffic", "morning coffee shop").
- shotstack_voice: one of Matthew, Joanna, Amy, Brian, Emma, Geraint, Nicole, Russell, Amy, Raveena, Joey, Justin, Kendra, Kimberly, Salli, Joey — pick one that fits the tone.`;

function isLlmQuotaOrRateLimitError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return (
    m.includes('429') ||
    m.includes('quota') ||
    m.includes('rate limit') ||
    m.includes('resource exhausted')
  );
}

function redactUrlSecrets(u) {
  return String(u || '')
    .replace(/([?&]key=)[^&]+/gi, '$1***')
    .replace(/([?&]access_token=)[^&]+/gi, '$1***');
}

function previewJson(obj, max = 6000) {
  try {
    return JSON.stringify(obj).slice(0, max);
  } catch {
    return '';
  }
}

function parseBrief(raw, label) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    throw new Error(`${label} returned non-JSON`);
  }
  if (!p.narration || typeof p.narration !== 'string') {
    throw new Error(`${label} JSON missing narration`);
  }
  if (!Array.isArray(p.pexels_search_queries) || p.pexels_search_queries.length < 1) {
    p.pexels_search_queries = ['lifestyle vertical video'];
  }
  if (!Array.isArray(p.scenes)) {
    p.scenes = [];
  }
  p.narration = p.narration.replace(/\s+/g, ' ').trim().slice(0, 4500);
  return p;
}

function unwrapJsonFence(raw) {
  let s = String(raw).trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/u, '');
  }
  return s.trim();
}

/** Full text from Gemini candidates; throws with a clear reason if blocked or empty. */
function extractGeminiResponseText(data) {
  const err = data?.error;
  if (err) {
    throw new Error(`Gemini API: ${err.message || JSON.stringify(err).slice(0, 400)}`);
  }
  const feedback = data.promptFeedback;
  if (feedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt (${feedback.blockReason}).`);
  }
  const candidates = data.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const msg = feedback ? JSON.stringify(feedback) : JSON.stringify(data).slice(0, 500);
    throw new Error(`Gemini returned no candidates — ${msg}`);
  }
  const cand = candidates[0];
  const reason = cand.finishReason;
  if (reason === 'SAFETY' || reason === 'RECITATION') {
    throw new Error(`Gemini refused output (finishReason=${reason}).`);
  }
  const parts = cand.content?.parts;
  if (!Array.isArray(parts)) {
    throw new Error('Gemini: missing content.parts in response');
  }
  const text = parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('');
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      `Gemini returned empty text (finishReason=${reason || 'unknown'}). Try another model or shorten input.`
    );
  }
  return trimmed;
}

async function briefOpenAI({ apiKey, model, userBlock }) {
  const systemText = `You are a senior short-form video producer. ${BRIEF_SCHEMA}`;
  const userText = String(userBlock || '');
  const requestBody = {
    model: model || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.85,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: userText }
    ]
  };
  const url = 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  const httpTrace = {
    label: 'OpenAI chat/completions',
    url: redactUrlSecrets(url),
    method: 'POST',
    status: res.status,
    request_body_preview: previewJson(requestBody, 8000),
    response_text_preview: ''
  };
  if (!res.ok) {
    const err = await res.text();
    httpTrace.response_text_preview = err.slice(0, 8000);
    const e = new Error(`OpenAI chat error ${res.status}: ${err.slice(0, 300)}`);
    e.httpTrace = httpTrace;
    throw e;
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned empty content');
  httpTrace.response_text_preview = previewJson(data, 8000);
  const promptFullText = `OPENAI CHAT REQUEST\n--- SYSTEM ---\n${systemText}\n\n--- USER ---\n${userText}`;
  return { brief: parseBrief(raw, 'OpenAI'), llmRawText: String(raw), promptFullText, httpTrace };
}

async function briefGemini({ apiKey, model, userBlock }) {
  const userTrim = String(userBlock || '').trim();
  if (!userTrim) {
    throw new Error('Gemini: internal error — client brief (user block) is empty');
  }

  const m = (model || 'gemini-2.0-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const systemText = `You are a senior short-form video producer.

You MUST read the entire user message below the line "CLIENT BRIEF". It contains the real video idea, audience tone, notes, and optional production instructions. Your JSON output must reflect that content (story, mood, visuals) — do not invent unrelated topics.

Output ONLY one JSON object. No markdown fences. No text before or after the JSON.

Schema and rules:
${BRIEF_SCHEMA}`;

  const userText = `=== CLIENT BRIEF (use all sections) ===\n\n${userTrim}`;

  const generationConfig = {
    temperature: 0.85,
    responseMimeType: 'application/json'
  };

  const bodyWithSystem = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig
  };

  const bodyFallback = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemText}\n\n---\n\n${userText}` }]
      }
    ],
    generationConfig
  };

  const httpTraces = [];

  const post = async (label, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    httpTraces.push({
      label,
      url: redactUrlSecrets(url),
      method: 'POST',
      status: res.status,
      request_body_preview: previewJson(body, 8000),
      response_text_preview: (parsed ? previewJson(parsed, 8000) : text).slice(0, 8000)
    });
    return { res, parsed, text };
  };

  let first = await post('Gemini generateContent (systemInstruction)', bodyWithSystem);
  let res = first.res;
  let data = first.parsed && typeof first.parsed === 'object' ? first.parsed : {};

  if (!res.ok && res.status === 400) {
    console.warn(
      '[creative-video] Gemini request with systemInstruction failed; retrying combined user message:',
      JSON.stringify(data).slice(0, 280)
    );
    const second = await post('Gemini generateContent (combined user)', bodyFallback);
    res = second.res;
    data = second.parsed && typeof second.parsed === 'object' ? second.parsed : {};
  }

  if (!res.ok) {
    const e = new Error(`Gemini error ${res.status}: ${JSON.stringify(data).slice(0, 450)}`);
    e.geminiHttpTraces = httpTraces;
    throw e;
  }

  const extracted = extractGeminiResponseText(data);
  const rawForParse = unwrapJsonFence(extracted);
  const promptFullText = `GEMINI REQUEST\n--- SYSTEM INSTRUCTION ---\n${systemText}\n\n--- USER CONTENT ---\n${userText}`;
  return {
    brief: parseBrief(rawForParse, 'Gemini'),
    llmRawText: extracted,
    promptFullText,
    geminiHttpTraces: httpTraces
  };
}

function userBlock({ videoDescription, toneId, userNotes, toneHint, productionPackText }) {
  const base = `Video idea from the client:\n${videoDescription}\n\nTone / audience style: ${toneId}\nTone direction: ${toneHint}\n\nExtra creative direction:\n${userNotes || '(none)'}`;
  if (!productionPackText) return base;
  return `${base}\n\n---\nDetailed production pack (instructions, demographics, style, file references):\n${productionPackText}`;
}

const LLM_RAW_MAX = 240_000;

function attachDebug(
  brief,
  { provider, model, userPrompt, llmRawText, promptFullText, httpTrace, geminiHttpTraces }
) {
  const raw =
    llmRawText != null && String(llmRawText).trim()
      ? String(llmRawText).slice(0, LLM_RAW_MAX)
      : undefined;
  const fullPrompt =
    promptFullText != null && String(promptFullText).trim()
      ? String(promptFullText).slice(0, LLM_RAW_MAX)
      : undefined;
  const traces = [];
  if (httpTrace) traces.push(httpTrace);
  if (Array.isArray(geminiHttpTraces) && geminiHttpTraces.length) traces.push(...geminiHttpTraces);
  return {
    ...brief,
    debug: {
      ...(brief.debug || {}),
      llm_provider: provider,
      llm_model: model || null,
      prompt_user_block: userPrompt,
      ...(raw != null ? { llm_raw_text: raw } : {}),
      ...(fullPrompt != null ? { llm_prompt_full_text: fullPrompt } : {}),
      ...(traces.length ? { llm_http_trace: JSON.stringify(traces).slice(0, LLM_RAW_MAX) } : {})
    }
  };
}

export function generateBriefTemplate({ videoDescription, toneId, userNotes, production }) {
  const tone = getToneById(toneId);
  const desc = videoDescription.replace(/\s+/g, ' ').trim().slice(0, 500);
  const pack = formatProductionForPrompt(production);
  const notes = [userNotes, pack].filter(Boolean).join('\n\n').replace(/\s+/g, ' ').trim().slice(0, 1200);

  const narration = `Here's a quick take on something worth your attention: ${desc}. ${tone.hint}. ${
    notes ? `Keep in mind: ${notes}. ` : ''
  }If this resonates, save it for later and share it with someone who'd appreciate the tip. Stay curious — more ideas coming soon.`;

  const userPrompt = userBlock({
    videoDescription,
    toneId: tone.id,
    userNotes,
    toneHint: tone.hint,
    productionPackText: pack || null
  });

  const h = hashString(`${desc}\n${tone.id}`);
  let pexels_search_queries;
  if (isMostlyNonLatin(desc)) {
    pexels_search_queries = [...TEMPLATE_QUERY_SETS[h % TEMPLATE_QUERY_SETS.length]];
  } else {
    const q1 = desc.split(/\s+/).slice(0, 4).join(' ') || 'lifestyle inspiration';
    const tail = TEMPLATE_LATIN_TAIL_SETS[h % TEMPLATE_LATIN_TAIL_SETS.length];
    pexels_search_queries = [q1, ...tail].slice(0, 4);
  }

  return attachDebug(
    {
    title: desc.slice(0, 72) || 'Quick idea',
    narration,
    pexels_search_queries,
    scenes: [
      { text: 'Quick idea', start_sec: 0, duration_sec: 3 },
      { text: 'Here is the takeaway', start_sec: 3, duration_sec: 4 },
      { text: 'Worth remembering', start_sec: 7, duration_sec: 4 },
      { text: 'Share if it helps', start_sec: 11, duration_sec: 4 },
      { text: 'More soon', start_sec: 15, duration_sec: 4 }
    ],
    shotstack_voice: 'Matthew',
    production_notes: `Template mode (no LLM). Tone=${tone.id}. non_latin=${isMostlyNonLatin(desc)}`
    },
    { provider: 'template', model: null, userPrompt }
  );
}

/** @param {Record<string, string>} settings — Creative studio only (see creativeStudioSettings.js). */
export async function generateCreativeBrief(settings, { videoDescription, toneId, userNotes, production }) {
  const tone = getToneById(toneId);
  const vd = String(videoDescription ?? '').trim();
  if (!vd) {
    throw new Error('חסר תיאור סרטון — לא ניתן לבקש תסריט מהמודל');
  }

  const pack = formatProductionForPrompt(production);
  const block = userBlock({
    videoDescription: vd,
    toneId: tone.id,
    userNotes,
    toneHint: tone.hint,
    productionPackText: pack || null
  });

  const p = (settings.creative_llm_provider || 'template').trim().toLowerCase();

  if (p === 'openai') {
    const key = (settings.creative_openai_api_key || '').trim();
    if (!key) throw new Error('Creative studio: OpenAI selected but no API key configured');
    try {
      const { brief, llmRawText, promptFullText, httpTrace } = await briefOpenAI({
        apiKey: key,
        model: settings.creative_openai_model,
        userBlock: block
      });
      return attachDebug(brief, {
        provider: 'openai',
        model: settings.creative_openai_model || 'gpt-4o-mini',
        userPrompt: block,
        llmRawText,
        promptFullText,
        httpTrace
      });
    } catch (e) {
      if (isLlmQuotaOrRateLimitError(e)) {
        console.warn('[creative-video] OpenAI quota/rate limit; using template brief.');
        return generateBriefTemplate({ videoDescription: vd, toneId: tone.id, userNotes, production });
      }
      throw e;
    }
  }

  if (p === 'gemini') {
    const key = (settings.creative_gemini_api_key || '').trim();
    if (!key) {
      throw new Error(
        'סטודיו Creative: נבחר Gemini אבל אין מפתח — שמרו מפתח בהגדרות או הגדירו CREATIVE_GEMINI_API_KEY בסביבת השרת'
      );
    }
    try {
      const { brief, llmRawText, promptFullText, geminiHttpTraces } = await briefGemini({
        apiKey: key,
        model: settings.creative_gemini_model,
        userBlock: block
      });
      return attachDebug(brief, {
        provider: 'gemini',
        model: settings.creative_gemini_model || 'gemini-2.0-flash',
        userPrompt: block,
        llmRawText,
        promptFullText,
        geminiHttpTraces
      });
    } catch (e) {
      if (isLlmQuotaOrRateLimitError(e)) {
        console.warn('[creative-video] Gemini quota/rate limit; using template brief.');
        return generateBriefTemplate({ videoDescription: vd, toneId: tone.id, userNotes, production });
      }
      throw e;
    }
  }

  return generateBriefTemplate({ videoDescription: vd, toneId: tone.id, userNotes, production });
}

/** JSON לעריכה בממשק — בלי llm_raw_text (כדי שלא להנפיח את שדה ה-JSON). */
export function briefJsonForPlanEditor(brief) {
  try {
    const copy = JSON.parse(JSON.stringify(brief));
    if (copy.debug && typeof copy.debug === 'object') {
      delete copy.debug.llm_raw_text;
      delete copy.debug.llm_prompt_full_text;
      delete copy.debug.llm_http_trace;
    }
    return JSON.stringify(copy, null, 2);
  } catch {
    return JSON.stringify(brief, null, 2);
  }
}

/** תכנון בלבד — מחזיר בריף + מסמך תכנית בעברית לעריכה בממשק */
export async function planCreativeVideo(settings, ctx) {
  const brief = await generateCreativeBrief(settings, ctx);
  const planDocument = formatPlanDocumentHe({
    videoDescription: ctx.videoDescription,
    userNotes: ctx.userNotes,
    production: ctx.production,
    brief
  });
  return { brief, planDocument };
}
