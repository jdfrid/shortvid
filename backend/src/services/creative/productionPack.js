/**
 * Client "production pack" — extended brief UI (shortvid).
 * Kept in one module so routes + script service + engine stay aligned.
 */

const VIDEO_STYLES_HE = {
  young: 'צעיר',
  nature: 'טבע',
  kids: 'לילדים',
  clubs: 'מועדונים',
  professional: 'מקצועי',
  spiritual: 'רוחני',
  polished: 'מכופתר',
  hippie: 'היפי'
};

export function formatProductionForPrompt(production) {
  if (!production || typeof production !== 'object') return '';
  const p = production;
  const lines = [];
  if (p.scriptInstructions) lines.push(`הוראות לתסריט / מבנה:\n${String(p.scriptInstructions).trim()}`);
  if (p.emphasis) lines.push(`הדגשים / נקודות חובה:\n${String(p.emphasis).trim()}`);
  if (p.inspirationUrls) lines.push(`קישורים להשראה:\n${String(p.inspirationUrls).trim()}`);
  const inspFiles = Array.isArray(p.inspirationFiles) ? p.inspirationFiles : [];
  const illFiles = Array.isArray(p.illustrationFiles) ? p.illustrationFiles : [];
  const camFiles = Array.isArray(p.cameraCaptureFiles) ? p.cameraCaptureFiles : [];
  if (inspFiles.length) {
    lines.push(
      `קבצי השראה שהועלו (${inspFiles.length}): ${inspFiles.map(f => f.name || 'file').join(', ')}`
    );
  }
  if (illFiles.length) {
    lines.push(`תמונות להמחשה (${illFiles.length}): ${illFiles.map(f => f.name || 'image').join(', ')}`);
  }
  if (camFiles.length) {
    lines.push(`צילומי מצלמה (${camFiles.length}): ${camFiles.map(f => f.name || 'capture').join(', ')}`);
  }
  if (p.backgroundAudio && (p.backgroundAudio.name || p.backgroundAudio.dataUrl)) {
    lines.push(`קול רקע / מוזיקה: ${p.backgroundAudio.name || 'קובץ מצורף'}`);
  }
  if (p.language) lines.push(`שפת יעד לתוכן: ${p.language}`);
  if (p.genderPresentation) lines.push(`דיבור/דמות (מגדר): ${p.genderPresentation}`);
  if (p.ethnicityPresentation) lines.push(`ייצוג (עור/מראה): ${p.ethnicityPresentation}`);
  if (p.ageGroup) lines.push(`קבוצת גיל: ${p.ageGroup}`);
  if (p.videoStyle) {
    const label = VIDEO_STYLES_HE[p.videoStyle] || p.videoStyle;
    lines.push(`סגנון וידאו: ${label} (${p.videoStyle})`);
  }
  return lines.filter(Boolean).join('\n\n');
}

export function formatPlanDocumentHe({ videoDescription, userNotes, production, brief }) {
  const prodLines = formatProductionForPrompt(production);
  const scenes = Array.isArray(brief?.scenes) ? brief.scenes : [];
  const queries = Array.isArray(brief?.pexels_search_queries) ? brief.pexels_search_queries : [];

  const scenesBlock = scenes.length
    ? scenes.map((s, i) => `${i + 1}. [${s.start_sec}s + ${s.duration_sec}s] ${s.text || ''}`).join('\n')
    : '(אין)';

  const queriesBlock = queries.length ? queries.map((q, i) => `${i + 1}. ${q}`).join('\n') : '(אין)';

  return `תכנית הפקה — shortvid
==================

## תיאור הסרטון (מבוסס קליט)
${String(videoDescription || '').trim() || '(ריק)'}

## הערות נוספות מהטופס
${String(userNotes || '').trim() || '(אין)'}

## חבילת הפקה (הוראות, קבצים, מאפיינים)
${prodLines || '(לא צוינו)'}

## כותרת (מערכת)
${String(brief?.title || '').trim() || '(—)'}

## תסריט קריינות (ניתן לעריכה גם ב־JSON המובנה)
${String(brief?.narration || '').trim() || '(—)'}

## כיתובים על המסך (scenes)
${scenesBlock}

## שאילתות חיפוש B-roll (Pexels)
${queriesBlock}

## קול Shotstack (בחירת מערכת)
${String(brief?.shotstack_voice || 'Matthew')}

## הערות הפקה (production_notes)
${String(brief?.production_notes || '').trim() || '(—)'}

---
קטע זה הוא המסמך האנושי; מתחת למסך העריכה יש גם JSON טכני לאותו בריף.
`;
}

const DEBUG_KEYS_TO_KEEP = new Set([
  'llm_provider',
  'llm_model',
  'prompt_user_block',
  'llm_raw_text',
  'llm_prompt_full_text',
  'llm_http_trace',
  'gemini_script_http_trace',
  'gemini_video_model',
  'gemini_video_operation',
  'gemini_video_prompt',
  'gemini_video_submit_response',
  'gemini_video_http_trace',
  'gemini_video_error',
  'render_provider',
  'render_provider_requested',
  'fallback_render_provider',
  'voice_mechanism',
  'include_voiceover',
  'google_tts_voice',
  'voiceover_audio_public_url',
  'google_tts_http_trace'
]);

function pickSafeDebugFromClient(debug) {
  if (!debug || typeof debug !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(debug)) {
    if (!DEBUG_KEYS_TO_KEEP.has(k)) continue;
    if (typeof v === 'string') {
      out[k] = v.slice(0, 120_000);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else {
      try {
        out[k] = JSON.stringify(v).slice(0, 120_000);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/** Strip client-supplied debug; keep render fields. */
export function sanitizeApprovedBriefJson(raw) {
  let p;
  if (typeof raw === 'string') {
    try {
      p = JSON.parse(raw);
    } catch {
      throw new Error('approvedBriefJson אינו JSON תקין');
    }
  } else {
    p = raw;
  }
  if (!p || typeof p !== 'object') throw new Error('בריף ריק');
  if (!p.narration || typeof p.narration !== 'string') {
    throw new Error('חובה שדה narration (תסריט קריינות)');
  }
  if (!Array.isArray(p.pexels_search_queries) || !p.pexels_search_queries.length) {
    p.pexels_search_queries = ['vertical lifestyle b-roll portrait'];
  }
  if (!Array.isArray(p.scenes)) p.scenes = [];
  p.narration = p.narration.replace(/\s+/g, ' ').trim().slice(0, 4500);
  const { debug: clientDebug, ...rest } = p;
  const safeDebug = pickSafeDebugFromClient(clientDebug);
  if (Object.keys(safeDebug).length) {
    return { ...rest, debug: safeDebug };
  }
  return rest;
}
