import { prepare } from '../config/database.js';

const TAVUS_BASE_URL = 'https://tavusapi.com/v2';
// User requested key in code for now.
const TAVUS_API_KEY_HARDCODED = '6652146515da457583f29cb1d56c56cd';

function tavusHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': TAVUS_API_KEY_HARDCODED
  };
}

function firstReplicaIdFromPayload(data) {
  const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  for (const item of arr) {
    const id = String(item?.replica_id || item?.id || item?.replicaId || '').trim();
    if (id) return id;
  }
  return '';
}

async function resolveReplicaId() {
  const fromEnv = String(process.env.TAVUS_REPLICA_ID || '').trim();
  if (fromEnv) return fromEnv;

  const res = await fetch(`${TAVUS_BASE_URL}/replicas`, {
    method: 'GET',
    headers: { 'x-api-key': TAVUS_API_KEY_HARDCODED },
    signal: AbortSignal.timeout(45000)
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(`Tavus replicas ${res.status}: ${String(text || '').slice(0, 300)}`);
  }
  const replicaId = firstReplicaIdFromPayload(data);
  if (!replicaId) {
    throw new Error('לא נמצא replica ב-Tavus. צור/י Replica בדשבורד או הגדר/י TAVUS_REPLICA_ID');
  }
  return replicaId;
}

export function createTavusScriptJob(scriptText) {
  const text = String(scriptText || '').trim();
  if (text.length < 8) throw new Error('תסריט קצר מדי (לפחות 8 תווים)');
  const ins = prepare(
    `
    INSERT INTO tavus_script_jobs (status, script_text)
    VALUES ('pending', ?)
  `
  ).run(text.slice(0, 12000));
  return Number(ins.lastInsertRowid);
}

export function getTavusScriptJob(jobId) {
  const id = parseInt(String(jobId), 10);
  if (!Number.isFinite(id) || id < 1) return null;
  return prepare('SELECT * FROM tavus_script_jobs WHERE id = ?').get(id) || null;
}

async function createTavusVideo({ replicaId, scriptText }) {
  const body = { replica_id: replicaId, script: scriptText };
  const res = await fetch(`${TAVUS_BASE_URL}/videos`, {
    method: 'POST',
    headers: tavusHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(`Tavus create video ${res.status}: ${String(text || '').slice(0, 500)}`);
  }
  const videoId = String(data?.video_id || '').trim();
  if (!videoId) throw new Error('Tavus לא החזיר video_id');
  return { videoId, response: data };
}

async function getTavusVideo(videoId) {
  const res = await fetch(`${TAVUS_BASE_URL}/videos/${encodeURIComponent(videoId)}`, {
    method: 'GET',
    headers: { 'x-api-key': TAVUS_API_KEY_HARDCODED },
    signal: AbortSignal.timeout(45000)
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(`Tavus get video ${res.status}: ${String(text || '').slice(0, 400)}`);
  }
  return data;
}

async function waitForTavusVideo(videoId, { maxWaitMs = 25 * 60 * 1000, intervalMs = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const data = await getTavusVideo(videoId);
    const status = String(data?.status || '').toLowerCase();
    if (status === 'ready') {
      const url = data?.download_url || data?.hosted_url || data?.stream_url || null;
      if (!url) throw new Error('Tavus status=ready אבל לא חזר download_url/hosted_url');
      return { url, payload: data };
    }
    if (status === 'error' || status === 'deleted') {
      throw new Error(`Tavus video failed: ${data?.status_details || status}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Tavus timeout בזמן המתנה לקובץ וידאו');
}

export async function processTavusScriptJob(jobId) {
  const row = getTavusScriptJob(jobId);
  if (!row) throw new Error('Job not found');
  if (row.status === 'completed') return row;

  prepare(
    `
    UPDATE tavus_script_jobs
    SET status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(row.id);

  try {
    const replicaId = await resolveReplicaId();
    const created = await createTavusVideo({ replicaId, scriptText: row.script_text });
    prepare(
      `
      UPDATE tavus_script_jobs
      SET provider_job_id = ?, provider_name = 'tavus', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(created.videoId, row.id);

    const done = await waitForTavusVideo(created.videoId);
    prepare(
      `
      UPDATE tavus_script_jobs
      SET status = 'completed', output_url = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(done.url, row.id);
  } catch (e) {
    prepare(
      `
      UPDATE tavus_script_jobs
      SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(String(e.message || e).slice(0, 2000), row.id);
    throw e;
  }
}

export function enqueueTavusScriptJob(jobId) {
  processTavusScriptJob(jobId).catch(err => {
    console.error(`tavus-script job ${jobId} failed:`, err?.message || err);
  });
}
