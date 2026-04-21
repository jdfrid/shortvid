import { prepare } from '../config/database.js';
import { isShotstackConfigured, submitRender, waitForRender } from './creative/shotstackRenderService.js';

function estimateDurationSec(scriptText) {
  const words = String(scriptText || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const sec = Math.ceil(words / 2.4) + 4;
  return Math.min(120, Math.max(12, sec));
}

function buildSimpleScriptEdit(scriptText) {
  const duration = estimateDurationSec(scriptText);
  return {
    timeline: {
      background: '#0b1020',
      tracks: [
        {
          clips: [
            {
              asset: {
                type: 'title',
                text: 'Script Video',
                style: 'minimal',
                size: 'medium',
                color: '#ffffff',
                position: 'center'
              },
              start: 0,
              length: duration
            }
          ]
        },
        {
          clips: [
            {
              asset: {
                type: 'text-to-speech',
                text: String(scriptText).slice(0, 4500),
                voice: 'Matthew',
                language: 'en-US',
                volume: 1
              },
              start: 0,
              length: duration
            }
          ]
        }
      ]
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

export function createShotstackScriptJob(scriptText) {
  const text = String(scriptText || '').trim();
  if (text.length < 8) throw new Error('תסריט קצר מדי (לפחות 8 תווים)');
  if (!isShotstackConfigured()) {
    throw new Error('Shotstack לא מוגדר — הגדר SHOTSTACK_API_KEY או שמור מפתח בהגדרות הסטודיו');
  }
  const ins = prepare(
    `
    INSERT INTO shotstack_script_jobs (status, script_text)
    VALUES ('pending', ?)
  `
  ).run(text.slice(0, 12000));
  return Number(ins.lastInsertRowid);
}

export function getShotstackScriptJob(jobId) {
  const id = parseInt(String(jobId), 10);
  if (!Number.isFinite(id) || id < 1) return null;
  return prepare('SELECT * FROM shotstack_script_jobs WHERE id = ?').get(id) || null;
}

export async function processShotstackScriptJob(jobId) {
  const row = getShotstackScriptJob(jobId);
  if (!row) throw new Error('Job not found');
  if (row.status === 'completed') return row;

  prepare(
    `
    UPDATE shotstack_script_jobs
    SET status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(row.id);

  try {
    const edit = buildSimpleScriptEdit(row.script_text);
    const renderId = await submitRender(edit);
    prepare(
      `
      UPDATE shotstack_script_jobs
      SET render_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(renderId, row.id);

    const { url } = await waitForRender(renderId, { maxWaitMs: 16 * 60 * 1000, intervalMs: 4000 });
    prepare(
      `
      UPDATE shotstack_script_jobs
      SET status = 'completed', output_url = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(url, row.id);
  } catch (e) {
    prepare(
      `
      UPDATE shotstack_script_jobs
      SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(String(e.message || e).slice(0, 2000), row.id);
    throw e;
  }
}

export function enqueueShotstackScriptJob(jobId) {
  processShotstackScriptJob(jobId).catch(err => {
    console.error(`shotstack-script job ${jobId} failed:`, err?.message || err);
  });
}
