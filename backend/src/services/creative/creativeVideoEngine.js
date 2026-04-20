import path from 'path';
import { prepare, getDataRoot } from '../../config/database.js';
import { getCreativeStudioSettings } from './creativeStudioSettings.js';
import { generateCreativeBrief } from './creativeScriptService.js';
import { sanitizeApprovedBriefJson, formatProductionForPrompt } from './productionPack.js';
import { searchVideoUrls, isPexelsConfigured } from './pexelsService.js';
import { getCharacterById, getCharacters } from './creativeAssets.js';
import {
  buildVerticalEdit,
  submitRender,
  waitForRender,
  isShotstackConfigured
} from './shotstackRenderService.js';
import {
  resolveGoogleTtsApiKey,
  publicAppBaseUrl,
  synthesizeToMp3File
} from './googleTtsService.js';
import {
  buildGeminiVideoPrompt,
  isGeminiVideoConfigured,
  resolveGeminiApiKey,
  resolveGeminiVideoModel,
  submitGeminiVideoGeneration,
  waitForGeminiVideo
} from './geminiVideoService.js';

let creativeBusy = false;

export function isCreativeEngineBusy() {
  return creativeBusy;
}

function setting(key, fallback = '') {
  const row = prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return (row?.value ?? fallback).trim();
}

/** @param {Record<string, string>} studioSettings — from getCreativeStudioSettings() */
function pexelsSearchOptsFromSettings(studioSettings) {
  const s = studioSettings || {};
  const per = parseInt(String(s.creative_pexels_per_page || '6'), 10);
  const perPage = Math.min(15, Math.max(1, Number.isFinite(per) ? per : 6));
  let orientation = String(s.creative_pexels_orientation || 'portrait').toLowerCase();
  if (!['portrait', 'landscape', 'square'].includes(orientation)) orientation = 'portrait';
  const sec = parseInt(String(s.creative_pexels_timeout_sec || '45'), 10);
  const timeoutMs = Math.min(120, Math.max(5, Number.isFinite(sec) ? sec : 45)) * 1000;
  let preferQuality = String(s.creative_pexels_prefer_quality || 'hd').toLowerCase();
  if (!['hd', 'sd', 'any'].includes(preferQuality)) preferQuality = 'hd';
  return { perPage, orientation, timeoutMs, preferQuality };
}

/** Rotate + slice so consecutive jobs don't always open with the same first clips */
function pickTimelineUrls(videoUrls, clipsCount, jobId) {
  if (!videoUrls.length) return [];
  const n = Math.min(clipsCount, videoUrls.length);
  const offset = jobId % videoUrls.length;
  const rotated = [...videoUrls.slice(offset), ...videoUrls.slice(0, offset)];
  return rotated.slice(0, n);
}

function isGeminiVideoBillingOrPreconditionError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return (
    m.includes('failed_precondition') ||
    m.includes('gcp billing') ||
    m.includes('billing enabled') ||
    m.includes('google cloud platform billing') ||
    m.includes('exclusively available to users with') ||
    m.includes('veo-2.0-generate-001')
  );
}

function saveBriefForLog(jobId, brief, debugPatch = null) {
  const merged =
    debugPatch && typeof debugPatch === 'object'
      ? { ...brief, debug: { ...(brief?.debug || {}), ...debugPatch } }
      : brief;
  prepare(
    `
    UPDATE creative_video_jobs
    SET brief_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(JSON.stringify(merged), jobId);
  return merged;
}

async function runShotstackRenderPipeline({
  id,
  row,
  settings,
  brief,
  voiceMech,
  includeVoiceover,
  renderProviderLabel = 'shotstack',
  extraDebug = {}
}) {
  let voiceoverAudioUrl = null;
  let googleTtsHttpTraceJson = null;
  if (voiceMech === 'google_cloud_tts') {
    const gKey = resolveGoogleTtsApiKey(settings);
    if (!gKey) {
      throw new Error(
        'נבחר Google Cloud TTS — הגדר מפתח API בהגדרות הסטודיו או משתנה סביבה GOOGLE_CLOUD_TTS_API_KEY'
      );
    }
    const base = publicAppBaseUrl();
    if (!base) {
      throw new Error(
        'נבחר Google Cloud TTS — חובה כתובת האפליקציה בפומבי: PUBLIC_BASE_URL או RENDER_EXTERNAL_URL (כדי ש־Shotstack יוריד את קובץ הדיבור)'
      );
    }
    const ttsDir = path.join(getDataRoot(), 'creative_tts');
    const outFile = path.join(ttsDir, `${id}.mp3`);
    const lang =
      String(brief.tts_language || 'en-US')
        .trim()
        .replace('_', '-')
        .slice(0, 16) || 'en-US';
    const voiceName =
      String(settings.creative_google_tts_voice || 'en-US-Neural2-A').trim() || 'en-US-Neural2-A';
    const ttsMeta = await synthesizeToMp3File(
      { text: brief.narration, voiceName, languageCode: lang, apiKey: gKey },
      outFile
    );
    voiceoverAudioUrl = `${base}/api/creative/public-tts/${id}`;
    if (ttsMeta?.googleTtsHttpTrace) {
      googleTtsHttpTraceJson = JSON.stringify([ttsMeta.googleTtsHttpTrace]).slice(0, 120_000);
    }
  }

  const pexelsOpts = pexelsSearchOptsFromSettings(settings);
  const queries = brief.pexels_search_queries.map(q => String(q).trim()).filter(Boolean);
  const videoUrls = [];
  const seen = new Set();
  const pagesUsed = [];
  const sliceQ = queries.slice(0, 4);
  for (let qi = 0; qi < sliceQ.length; qi++) {
    const q = sliceQ[qi];
    const page = 1 + ((id * 31 + qi * 5) % 8);
    pagesUsed.push({ query: q, page });
    const batch = await searchVideoUrls(q, { ...pexelsOpts, page });
    for (const u of batch) {
      if (!seen.has(u)) {
        seen.add(u);
        videoUrls.push(u);
      }
      if (videoUrls.length >= 8) break;
    }
    if (videoUrls.length >= 6) break;
  }

  if (!videoUrls.length) {
    throw new Error(`Pexels returned no usable ${pexelsOpts.orientation} videos for these queries`);
  }

  let char = row.character_id ? getCharacterById(row.character_id) : null;
  if (!char) {
    const all = getCharacters();
    char = all[0] || null;
  }
  const characterImageUrl = char?.image_url || null;

  const totalDurationSec = 45;
  const clipsCount = Math.min(5, Math.max(3, Math.ceil(totalDurationSec / 12)));
  const urlsForTimeline = pickTimelineUrls(videoUrls, clipsCount, id);
  const segmentLengthSec = totalDurationSec / urlsForTimeline.length;

  const edit = buildVerticalEdit({
    videoUrls: urlsForTimeline,
    segmentLengthSec,
    narration: brief.narration,
    voice: brief.shotstack_voice || 'Matthew',
    scenes: (brief.scenes || []).map(s => ({
      text: s.text,
      start_sec: s.start_sec,
      duration_sec: s.duration_sec
    })),
    characterImageUrl,
    totalDurationSec,
    includeVoiceover,
    voiceoverAudioUrl
  });

  const enrichedBrief = {
    ...brief,
    debug: {
      ...(brief.debug || {}),
      pexels_search_options: pexelsOpts,
      pexels_pages_used: pagesUsed,
      pexels_queries_used: queries,
      pexels_candidate_video_urls: videoUrls,
      selected_timeline_video_urls: urlsForTimeline,
      character_image_url: characterImageUrl,
      segment_length_sec: Number(segmentLengthSec.toFixed(2)),
      total_duration_sec: totalDurationSec,
      render_provider: renderProviderLabel,
      voice_mechanism: voiceMech,
      include_voiceover: includeVoiceover,
      google_tts_voice: voiceMech === 'google_cloud_tts' ? settings.creative_google_tts_voice : null,
      voiceover_audio_public_url: voiceoverAudioUrl,
      ...(googleTtsHttpTraceJson ? { google_tts_http_trace: googleTtsHttpTraceJson } : {}),
      ...extraDebug
    }
  };

  prepare(
    `
    UPDATE creative_video_jobs SET
      brief_json = ?,
      pexels_urls_json = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(JSON.stringify(enrichedBrief), JSON.stringify(videoUrls), id);

  const renderId = await submitRender(edit);
  prepare(
    `
    UPDATE creative_video_jobs SET external_render_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `
  ).run(renderId, id);

  const { url } = await waitForRender(renderId);
  prepare(
    `
    UPDATE creative_video_jobs SET
      status = 'completed',
      output_url = ?,
      error_message = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(url, id);
}

export function assertCreativePipelineReady() {
  const provider = (setting('creative_video_provider', 'shotstack') || 'shotstack').toLowerCase();
  if (provider === 'shotstack') {
    if (!isPexelsConfigured()) {
      throw new Error(
        'Pexels is not configured — set PEXELS_API_KEY on the server or save a key in Studio settings'
      );
    }
    if (!isShotstackConfigured()) {
      throw new Error(
        'Shotstack is not configured — set SHOTSTACK_API_KEY on the server or save a key in Studio settings'
      );
    }
    return;
  }
  if (provider === 'gemini_video') {
    const settings = getCreativeStudioSettings();
    if (!isGeminiVideoConfigured(settings)) {
      throw new Error(
        'Gemini video is not configured — set CREATIVE_GEMINI_VIDEO_API_KEY/CREATIVE_GEMINI_API_KEY in env or save a Gemini key in Studio settings'
      );
    }
    return;
  }
  if (!['shotstack', 'gemini_video'].includes(provider)) {
    throw new Error(`Render provider "${provider}" is not implemented yet — use shotstack or gemini_video in Settings`);
  }
}

/**
 * @param {{
 *   videoDescription: string,
 *   scriptTone: string,
 *   userNotes?: string,
 *   characterId?: string,
 *   triggerSource?: string,
 *   productionInput?: object,
 *   planDocument?: string,
 *   approvedBriefJson?: string
 * }} input
 */
export async function createCreativeVideoJob(input) {
  assertCreativePipelineReady();

  const videoDescription = String(input.videoDescription || '').trim();
  if (videoDescription.length < 8) {
    throw new Error('Video description is too short (at least 8 characters)');
  }

  const scriptTone = String(input.scriptTone || 'adults').trim().toLowerCase();
  const userNotes = String(input.userNotes || '').trim().slice(0, 8000);
  const characterId = input.characterId ? String(input.characterId).trim() : '';
  const triggerSource = String(input.triggerSource || 'manual').slice(0, 32);

  const productionInputJson =
    input.productionInput && typeof input.productionInput === 'object'
      ? JSON.stringify(input.productionInput).slice(0, 500_000)
      : null;
  const planDocument =
    input.planDocument != null && String(input.planDocument).trim()
      ? String(input.planDocument).slice(0, 500_000)
      : null;
  const approvedBriefJson =
    input.approvedBriefJson != null && String(input.approvedBriefJson).trim()
      ? String(input.approvedBriefJson).trim().slice(0, 500_000)
      : null;

  if (approvedBriefJson) {
    try {
      sanitizeApprovedBriefJson(approvedBriefJson);
    } catch (e) {
      throw new Error(e.message || 'approvedBriefJson לא תקין');
    }
  }

  const ins = prepare(
    `
    INSERT INTO creative_video_jobs (
      status, trigger_source, video_description, script_tone, user_notes, character_id, render_provider,
      production_input_json, plan_document, approved_brief_json
    )
    VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    triggerSource,
    videoDescription,
    scriptTone,
    userNotes || null,
    characterId || null,
    setting('creative_video_provider', 'shotstack') || 'shotstack',
    productionInputJson,
    planDocument,
    approvedBriefJson
  );

  return { jobId: ins.lastInsertRowid };
}

export async function processCreativeVideoJob(jobId) {
  const id = parseInt(String(jobId), 10);
  const row = prepare(`SELECT * FROM creative_video_jobs WHERE id = ?`).get(id);
  if (!row) throw new Error('Job not found');
  if (row.status === 'completed') return;

  prepare(
    `UPDATE creative_video_jobs SET status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);

  try {
    assertCreativePipelineReady();

    const settings = getCreativeStudioSettings();
    const provider = String(row.render_provider || setting('creative_video_provider', 'shotstack') || 'shotstack')
      .trim()
      .toLowerCase();

    let brief;
    const preApproved = (row.approved_brief_json || '').trim();
    if (preApproved) {
      brief = sanitizeApprovedBriefJson(preApproved);
    } else {
      let production = null;
      try {
        if (row.production_input_json) production = JSON.parse(row.production_input_json);
      } catch {
        production = null;
      }
      brief = await generateCreativeBrief(settings, {
        videoDescription: row.video_description,
        toneId: row.script_tone,
        userNotes: row.user_notes || '',
        production
      });
    }

    const voiceMech = String(settings.creative_voice_mechanism || 'shotstack_tts').trim().toLowerCase();
    const includeVoiceover = voiceMech !== 'captions_only';
    saveBriefForLog(id, brief);

    if (provider === 'gemini_video') {
      let production = null;
      try {
        if (row.production_input_json) production = JSON.parse(row.production_input_json);
      } catch {
        production = null;
      }
      const productionText = formatProductionForPrompt(production);
      const prompt = buildGeminiVideoPrompt({
        videoDescription: row.video_description,
        userNotes: row.user_notes || '',
        brief,
        productionText,
        planDocument: row.plan_document || ''
      });
      const geminiApiKey = resolveGeminiApiKey(settings);
      const geminiVideoModel = resolveGeminiVideoModel(settings);
      saveBriefForLog(id, brief, {
        render_provider: 'gemini_video',
        gemini_video_model: geminiVideoModel,
        gemini_video_prompt: prompt
      });
      try {
        const submit = await submitGeminiVideoGeneration({
          apiKey: geminiApiKey,
          model: geminiVideoModel,
          prompt,
          aspectRatio: '9:16'
        });

        prepare(
          `
        UPDATE creative_video_jobs SET
          external_render_id = ?,
          brief_json = ?,
          pexels_urls_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
        ).run(
          submit.operationName || null,
          JSON.stringify({
            ...brief,
            debug: {
              ...(brief.debug || {}),
              render_provider: 'gemini_video',
              gemini_video_model: geminiVideoModel,
              gemini_video_operation: submit.operationName || null,
              gemini_video_prompt: prompt,
              gemini_video_submit_response: submit.submitPayload
                ? JSON.stringify(submit.submitPayload).slice(0, 6000)
                : null,
              gemini_video_http_trace: submit.httpTraces
                ? JSON.stringify(submit.httpTraces).slice(0, 120_000)
                : null
            }
          }),
          null,
          id
        );

        const resolved =
          submit.url != null
            ? { url: submit.url, operationPayload: submit.submitPayload }
            : await waitForGeminiVideo({
                apiKey: geminiApiKey,
                operationName: submit.operationName
              });

        prepare(
          `
        UPDATE creative_video_jobs SET
          status = 'completed',
          output_url = ?,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
        ).run(resolved.url, id);
        return;
      } catch (geminiErr) {
        const geminiErrText = String(geminiErr?.message || geminiErr || '').slice(0, 2000);
        const traces = Array.isArray(geminiErr?.geminiVideoHttpTraces) ? geminiErr.geminiVideoHttpTraces : [];
        saveBriefForLog(id, brief, {
          render_provider: 'gemini_video',
          gemini_video_model: geminiVideoModel,
          gemini_video_prompt: prompt,
          gemini_video_error: geminiErrText,
          ...(traces.length ? { gemini_video_http_trace: JSON.stringify(traces).slice(0, 120_000) } : {})
        });

        const canFallbackToShotstack = isPexelsConfigured() && isShotstackConfigured();
        if (isGeminiVideoBillingOrPreconditionError(geminiErr) && canFallbackToShotstack) {
          await runShotstackRenderPipeline({
            id,
            row,
            settings,
            brief,
            voiceMech,
            includeVoiceover,
            renderProviderLabel: 'shotstack_fallback',
            extraDebug: {
              render_provider_requested: 'gemini_video',
              gemini_video_error: geminiErrText,
              fallback_render_provider: 'shotstack'
            }
          });
          return;
        }
        throw geminiErr;
      }
    }

    await runShotstackRenderPipeline({
      id,
      row,
      settings,
      brief,
      voiceMech,
      includeVoiceover,
      renderProviderLabel: provider || 'shotstack'
    });
  } catch (e) {
    console.error(`Creative video job ${id} failed:`, e);
    const errText = String(e.message || e).slice(0, 2000);
    try {
      const row2 = prepare(`SELECT brief_json FROM creative_video_jobs WHERE id = ?`).get(id);
      let base = {};
      if (row2?.brief_json) {
        try {
          base = JSON.parse(row2.brief_json);
        } catch {
          base = {};
        }
      }
      const merged = {
        ...(base && typeof base === 'object' ? base : {}),
        debug: {
          ...((base && typeof base === 'object' && base.debug && typeof base.debug === 'object') ? base.debug : {}),
          job_failed_at: new Date().toISOString(),
          job_error_message: errText
        }
      };
      prepare(
        `
        UPDATE creative_video_jobs SET
          status = 'failed',
          error_message = ?,
          brief_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(errText, JSON.stringify(merged), id);
    } catch (mergeErr) {
      console.warn(`Creative video job ${id}: failed to persist brief_json on error:`, mergeErr?.message || mergeErr);
      prepare(
        `
        UPDATE creative_video_jobs SET
          status = 'failed',
          error_message = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(errText, id);
    }
    throw e;
  }
}

export function enqueueCreativeVideoJob(jobId) {
  if (creativeBusy) {
    throw new Error('Creative video engine is busy; wait for the current job to finish');
  }
  creativeBusy = true;
  processCreativeVideoJob(jobId)
    .catch(err => console.error('Creative video background job error:', err))
    .finally(() => {
      creativeBusy = false;
    });
}

export async function startNewCreativeVideoJob(input) {
  assertCreativePipelineReady();
  if (creativeBusy) {
    throw new Error('Creative video engine is busy; wait for the current job to finish');
  }
  creativeBusy = true;
  try {
    const { jobId } = await createCreativeVideoJob(input);
    processCreativeVideoJob(jobId)
      .catch(err => console.error('Creative video background job error:', err))
      .finally(() => {
        creativeBusy = false;
      });
    return { jobId };
  } catch (e) {
    creativeBusy = false;
    throw e;
  }
}

export function recoverStuckCreativeJobs(staleMinutes = 45) {
  const msg = `Stuck in processing for over ${staleMinutes} minutes (timeout or server restart).`;
  prepare(
    `
    UPDATE creative_video_jobs
    SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'processing'
      AND datetime(updated_at) < datetime('now', ?)
  `
  ).run(msg, `-${staleMinutes} minutes`);
}

export async function runScheduledCreativeIfEnabled() {
  const enabled = setting('creative_video_auto_enabled', 'false') === 'true';
  if (!enabled) {
    console.log('🎬 Creative video cron: disabled');
    return;
  }
  if (creativeBusy) {
    console.log('🎬 Creative video cron: skipped (engine busy)');
    return;
  }
  try {
    assertCreativePipelineReady();
  } catch (e) {
    console.log('🎬 Creative video cron: skipped —', e.message);
    return;
  }

  const videoDescription = setting(
    'creative_auto_description',
    'Short vertical video with a useful tip for online shoppers.'
  );
  const scriptTone = setting('creative_auto_tone', 'adults');

  try {
    await startNewCreativeVideoJob({
      videoDescription,
      scriptTone,
      userNotes: 'Scheduled automatic run — keep pacing tight and friendly.',
      triggerSource: 'schedule'
    });
    console.log('🎬 Creative video cron: started new job');
  } catch (e) {
    console.error('🎬 Creative video cron failed:', e.message);
  }
}

export async function retryCreativeVideoJob(jobId) {
  if (creativeBusy) {
    throw new Error('Creative video engine is busy; wait for the current job to finish');
  }
  const id = parseInt(String(jobId), 10);
  const row = prepare(`SELECT id FROM creative_video_jobs WHERE id = ?`).get(id);
  if (!row) throw new Error('Job not found');

  prepare(
    `
    UPDATE creative_video_jobs SET
      status = 'pending',
      error_message = NULL,
      output_url = NULL,
      external_render_id = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(id);

  enqueueCreativeVideoJob(id);
  return { jobId: id };
}
