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

async function briefOpenAI({ apiKey, model, userBlock }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.85,
      messages: [
        { role: 'system', content: `You are a senior short-form video producer. ${BRIEF_SCHEMA}` },
        { role: 'user', content: userBlock }
      ]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI chat error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned empty content');
  return parseBrief(raw, 'OpenAI');
}

async function briefGemini({ apiKey, model, userBlock }) {
  const m = (model || 'gemini-2.0-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${BRIEF_SCHEMA}\n\n---\n${userBlock}` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.85
      }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 400)}`);
  }
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned empty content');
  return parseBrief(raw, 'Gemini');
}

function userBlock({ videoDescription, toneId, userNotes, toneHint, productionPackText }) {
  const base = `Video idea from the client:\n${videoDescription}\n\nTone / audience style: ${toneId}\nTone direction: ${toneHint}\n\nExtra creative direction:\n${userNotes || '(none)'}`;
  if (!productionPackText) return base;
  return `${base}\n\n---\nDetailed production pack (instructions, demographics, style, file references):\n${productionPackText}`;
}

function attachDebug(brief, { provider, model, userPrompt }) {
  return {
    ...brief,
    debug: {
      ...(brief.debug || {}),
      llm_provider: provider,
      llm_model: model || null,
      prompt_user_block: userPrompt
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
  const pack = formatProductionForPrompt(production);
  const block = userBlock({
    videoDescription,
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
      const brief = await briefOpenAI({ apiKey: key, model: settings.creative_openai_model, userBlock: block });
      return attachDebug(brief, {
        provider: 'openai',
        model: settings.creative_openai_model || 'gpt-4o-mini',
        userPrompt: block
      });
    } catch (e) {
      if (isLlmQuotaOrRateLimitError(e)) {
        console.warn('[creative-video] OpenAI quota/rate limit; using template brief.');
        return generateBriefTemplate({ videoDescription, toneId: tone.id, userNotes, production });
      }
      throw e;
    }
  }

  if (p === 'gemini') {
    const key = (settings.creative_gemini_api_key || '').trim();
    if (!key) throw new Error('Creative studio: Gemini selected but no API key configured');
    try {
      const brief = await briefGemini({ apiKey: key, model: settings.creative_gemini_model, userBlock: block });
      return attachDebug(brief, {
        provider: 'gemini',
        model: settings.creative_gemini_model || 'gemini-2.0-flash',
        userPrompt: block
      });
    } catch (e) {
      if (isLlmQuotaOrRateLimitError(e)) {
        console.warn('[creative-video] Gemini quota/rate limit; using template brief.');
        return generateBriefTemplate({ videoDescription, toneId: tone.id, userNotes, production });
      }
      throw e;
    }
  }

  return generateBriefTemplate({ videoDescription, toneId: tone.id, userNotes, production });
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
