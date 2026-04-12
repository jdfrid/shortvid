import { getToneById } from './creativeAssets.js';

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

function userBlock({ videoDescription, toneId, userNotes, toneHint }) {
  return `Video idea from the client:\n${videoDescription}\n\nTone / audience style: ${toneId}\nTone direction: ${toneHint}\n\nExtra creative direction:\n${userNotes || '(none)'}`;
}

export function generateBriefTemplate({ videoDescription, toneId, userNotes }) {
  const tone = getToneById(toneId);
  const desc = videoDescription.replace(/\s+/g, ' ').trim().slice(0, 500);
  const notes = (userNotes || '').replace(/\s+/g, ' ').trim().slice(0, 400);

  const narration = `Here's a quick take on something worth your attention: ${desc}. ${tone.hint}. ${
    notes ? `Keep in mind: ${notes}. ` : ''
  }If this resonates, save it for later and share it with someone who'd appreciate the tip. Stay curious — more ideas coming soon.`;

  const q1 = desc.split(/\s+/).slice(0, 4).join(' ') || 'lifestyle inspiration';
  return {
    title: desc.slice(0, 72) || 'Quick idea',
    narration,
    pexels_search_queries: [q1, 'vertical lifestyle b-roll', 'people urban moment', 'abstract light texture'],
    scenes: [
      { text: 'Quick idea', start_sec: 0, duration_sec: 3 },
      { text: 'Here is the takeaway', start_sec: 3, duration_sec: 4 },
      { text: 'Worth remembering', start_sec: 7, duration_sec: 4 },
      { text: 'Share if it helps', start_sec: 11, duration_sec: 4 },
      { text: 'More soon', start_sec: 15, duration_sec: 4 }
    ],
    shotstack_voice: 'Matthew',
    production_notes: `Template mode (no LLM). Tone=${tone.id}.`
  };
}

/** @param {Record<string, string>} settings — Creative studio only (see creativeStudioSettings.js). */
export async function generateCreativeBrief(settings, { videoDescription, toneId, userNotes }) {
  const tone = getToneById(toneId);
  const block = userBlock({
    videoDescription,
    toneId: tone.id,
    userNotes,
    toneHint: tone.hint
  });

  const p = (settings.creative_llm_provider || 'template').trim().toLowerCase();

  if (p === 'openai') {
    const key = (settings.creative_openai_api_key || '').trim();
    if (!key) throw new Error('Creative studio: OpenAI selected but no API key configured');
    try {
      return await briefOpenAI({ apiKey: key, model: settings.creative_openai_model, userBlock: block });
    } catch (e) {
      if (isLlmQuotaOrRateLimitError(e)) {
        console.warn('[creative-video] OpenAI quota/rate limit; using template brief.');
        return generateBriefTemplate({ videoDescription, toneId: tone.id, userNotes });
      }
      throw e;
    }
  }

  if (p === 'gemini') {
    const key = (settings.creative_gemini_api_key || '').trim();
    if (!key) throw new Error('Creative studio: Gemini selected but no API key configured');
    try {
      return await briefGemini({ apiKey: key, model: settings.creative_gemini_model, userBlock: block });
    } catch (e) {
      if (isLlmQuotaOrRateLimitError(e)) {
        console.warn('[creative-video] Gemini quota/rate limit; using template brief.');
        return generateBriefTemplate({ videoDescription, toneId: tone.id, userNotes });
      }
      throw e;
    }
  }

  return generateBriefTemplate({ videoDescription, toneId: tone.id, userNotes });
}
