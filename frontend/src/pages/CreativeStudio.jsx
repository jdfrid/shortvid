import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader,
  ExternalLink,
  Settings,
  LayoutGrid,
  Clapperboard
} from 'lucide-react';
import api from '../services/api';

const tabs = [
  { id: 'brief', label: 'יצירת סרטון', icon: Clapperboard },
  { id: 'jobs', label: 'היסטוריית Jobs', icon: LayoutGrid },
  { id: 'settings', label: 'הגדרות סטודיו', icon: Settings }
];

const SETTINGS_PAYLOAD_KEYS = [
  'creative_llm_provider',
  'creative_gemini_model',
  'creative_openai_model',
  'creative_video_provider',
  'creative_video_auto_enabled',
  'creative_video_cron',
  'creative_auto_description',
  'creative_auto_tone',
  'creative_pexels_per_page',
  'creative_pexels_orientation',
  'creative_pexels_timeout_sec',
  'creative_pexels_prefer_quality',
  'creative_voice_mechanism'
];

const MAX_ASSET_BYTES = 400 * 1024;

async function filesToAssetPayloads(files, maxFiles = 8) {
  const list = Array.from(files || []).slice(0, maxFiles);
  const out = [];
  for (const f of list) {
    if (f.size > MAX_ASSET_BYTES) {
      throw new Error(`הקובץ "${f.name}" גדול מדי (מקסימום ~${Math.round(MAX_ASSET_BYTES / 1024)}KB לקובץ)`);
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('קריאת קובץ נכשלה'));
      r.readAsDataURL(f);
    });
    out.push({ name: f.name, mime: f.type || 'application/octet-stream', dataUrl });
  }
  return out;
}

async function singleAudioAsset(file) {
  if (!file) return null;
  const [one] = await filesToAssetPayloads([file], 1);
  return one;
}

function urlTailLabel(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    const path = new URL(u).pathname;
    const last = path.split('/').filter(Boolean).pop() || '';
    return last.length > 64 ? `${last.slice(0, 64)}…` : last;
  } catch {
    const s = u.replace(/\?.*$/, '');
    return s.length > 48 ? `…${s.slice(-48)}` : s;
  }
}

function normalizeCreateJobId(res) {
  const raw = res?.jobId ?? res?.job_id ?? res?.data?.jobId;
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

export default function CreativeStudio() {
  const [tab, setTab] = useState('brief');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const [creativeBusy, setCreativeBusy] = useState(false);
  const [creativeJobs, setCreativeJobs] = useState([]);
  const [creativeCfg, setCreativeCfg] = useState({ pexels_configured: false, shotstack_configured: false });
  const [creativeOptions, setCreativeOptions] = useState({ characters: [], tones: [] });
  const [creativeDesc, setCreativeDesc] = useState('');
  const [creativeTone, setCreativeTone] = useState('adults');
  const [creativeNotes, setCreativeNotes] = useState('');
  const [creativeCharacterId, setCreativeCharacterId] = useState('');
  const [creativeDetail, setCreativeDetail] = useState(null);
  const [creativeRetryingId, setCreativeRetryingId] = useState(null);

  const [scriptInstructions, setScriptInstructions] = useState('');
  const [emphasis, setEmphasis] = useState('');
  const [inspirationUrls, setInspirationUrls] = useState('');
  const [inspirationFiles, setInspirationFiles] = useState([]);
  const [illustrationFiles, setIllustrationFiles] = useState([]);
  const [cameraFiles, setCameraFiles] = useState([]);
  const [backgroundAudioFile, setBackgroundAudioFile] = useState(null);
  const [prodLanguage, setProdLanguage] = useState('he');
  const [prodGender, setProdGender] = useState('neutral');
  const [prodEthnicity, setProdEthnicity] = useState('any');
  const [prodAge, setProdAge] = useState('adult');
  const [videoStyle, setVideoStyle] = useState('professional');

  const [planDocument, setPlanDocument] = useState('');
  const [editableBriefJson, setEditableBriefJson] = useState('');
  const [hasPlanned, setHasPlanned] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [creatingVideo, setCreatingVideo] = useState(false);

  const [settings, setSettings] = useState({
    creative_llm_provider: 'template',
    creative_gemini_model: 'gemini-2.0-flash',
    creative_openai_model: 'gpt-4o-mini',
    creative_video_provider: 'shotstack',
    creative_video_auto_enabled: 'false',
    creative_video_cron: '0 14 * * *',
    creative_auto_description:
      'Short vertical video: practical tips about shopping smart and spotting real value online.',
    creative_auto_tone: 'adults',
    creative_pexels_per_page: '6',
    creative_pexels_orientation: 'portrait',
    creative_pexels_timeout_sec: '45',
    creative_pexels_prefer_quality: 'hd',
    creative_voice_mechanism: 'shotstack_tts',
    creative_openai_key_configured: false,
    creative_gemini_key_configured: false,
    creative_pexels_key_configured: false,
    creative_shotstack_key_configured: false
  });
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [pexelsKeyInput, setPexelsKeyInput] = useState('');
  const [pexelsTesting, setPexelsTesting] = useState(false);
  const [shotstackKeyInput, setShotstackKeyInput] = useState('');
  const [shotstackTesting, setShotstackTesting] = useState(false);
  const [loadedSettings, setLoadedSettings] = useState(null);
  const [activeLogJobId, setActiveLogJobId] = useState(null);
  const [activeLogJob, setActiveLogJob] = useState(null);
  const [activeLogLoading, setActiveLogLoading] = useState(false);

  const loadCreative = useCallback(async () => {
    const [st, jobs, opt] = await Promise.all([
      api.getCreativeVideoStatus(),
      api.getCreativeVideoJobs(50),
      api.getCreativeVideoOptions()
    ]);
    setCreativeBusy(!!st.busy);
    setCreativeCfg({
      pexels_configured: !!st.pexels_configured,
      shotstack_configured: !!st.shotstack_configured
    });
    setCreativeJobs(jobs.jobs || []);
    setCreativeOptions({ characters: opt.characters || [], tones: opt.tones || [] });
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await api.getCreativeStudioSettings();
    setSettings(prev => {
      const merged = { ...prev, ...data };
      setLoadedSettings(merged);
      return merged;
    });
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadCreative(), loadSettings()]);
      } catch (e) {
        if (!cancel) setMessage({ type: 'error', text: e.message });
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [loadCreative, loadSettings]);

  useEffect(() => {
    const id = setInterval(() => {
      loadCreative().catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [loadCreative]);

  useEffect(() => {
    if (!activeLogJobId) {
      setActiveLogJob(null);
      setActiveLogLoading(false);
      return undefined;
    }
    let cancelled = false;
    const pull = async () => {
      setActiveLogLoading(true);
      try {
        const d = await api.getCreativeVideoJob(activeLogJobId);
        if (cancelled) return;
        setActiveLogJob(d.job || null);
        const st = String(d.job?.status || '').toLowerCase();
        if (st === 'completed' || st === 'failed') setActiveLogLoading(false);
      } catch {
        if (!cancelled) setActiveLogLoading(false);
      }
    };
    pull();
    const id = setInterval(pull, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeLogJobId]);

  const saveStudioSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {};
      const baseline = loadedSettings || {};
      for (const k of SETTINGS_PAYLOAD_KEYS) {
        const v = settings[k];
        if (v === undefined || v === null) continue;
        const normalized = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
        if (String(baseline[k] ?? '') !== normalized) {
          payload[k] = normalized;
        }
      }
      if (openaiKeyInput.trim()) payload.creative_openai_api_key = openaiKeyInput.trim();
      if (geminiKeyInput.trim()) payload.creative_gemini_api_key = geminiKeyInput.trim();
      if (pexelsKeyInput.trim()) payload.creative_pexels_api_key = pexelsKeyInput.trim();
      if (shotstackKeyInput.trim()) payload.creative_shotstack_api_key = shotstackKeyInput.trim();
      if (
        (settings.creative_llm_provider || 'template') === 'gemini' &&
        !geminiKeyInput.trim() &&
        !settings.creative_gemini_key_configured
      ) {
        setMessage({ type: 'error', text: 'נא להדביק מפתח Gemini או לעבור ל-Template.' });
        setSaving(false);
        return;
      }
      if (
        (settings.creative_llm_provider || 'template') === 'openai' &&
        !openaiKeyInput.trim() &&
        !settings.creative_openai_key_configured
      ) {
        setMessage({ type: 'error', text: 'נא להדביק מפתח OpenAI או לעבור ל-Template.' });
        setSaving(false);
        return;
      }
      if (Object.keys(payload).length === 0) {
        setMessage({ type: 'ok', text: 'לא זוהו שינויים לשמירה.' });
        setSaving(false);
        return;
      }
      await api.saveCreativeStudioSettings(payload);
      setOpenaiKeyInput('');
      setGeminiKeyInput('');
      setPexelsKeyInput('');
      setShotstackKeyInput('');
      await loadSettings();
      setMessage({ type: 'ok', text: 'הגדרות הסטודיו נשמרו.' });
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const buildProductionPayload = useCallback(async () => {
    const inspirationFilesPayload = await filesToAssetPayloads(inspirationFiles, 6);
    const illustrationFilesPayload = await filesToAssetPayloads(illustrationFiles, 6);
    const cameraPayload = await filesToAssetPayloads(cameraFiles, 4);
    const backgroundAudio = await singleAudioAsset(backgroundAudioFile);
    return {
      scriptInstructions: scriptInstructions.trim(),
      emphasis: emphasis.trim(),
      inspirationUrls: inspirationUrls.trim(),
      inspirationFiles: inspirationFilesPayload,
      illustrationFiles: illustrationFilesPayload,
      cameraCaptureFiles: cameraPayload,
      backgroundAudio,
      language: prodLanguage,
      genderPresentation: prodGender,
      ethnicityPresentation: prodEthnicity,
      ageGroup: prodAge,
      videoStyle
    };
  }, [
    scriptInstructions,
    emphasis,
    inspirationUrls,
    inspirationFiles,
    illustrationFiles,
    cameraFiles,
    backgroundAudioFile,
    prodLanguage,
    prodGender,
    prodEthnicity,
    prodAge,
    videoStyle
  ]);

  const handlePlanVideo = async () => {
    setMessage(null);
    setPlanning(true);
    try {
      if ((creativeDesc || '').trim().length < 8) {
        setMessage({ type: 'error', text: 'תיאור הסרטון קצר מדי (לפחות 8 תווים).' });
        return;
      }
      const production = await buildProductionPayload();
      const res = await api.planCreativeVideo({
        videoDescription: creativeDesc,
        scriptTone: creativeTone,
        userNotes: creativeNotes,
        production
      });
      setPlanDocument(res.planDocument || '');
      setEditableBriefJson(res.briefJson || JSON.stringify(res.brief, null, 2));
      setHasPlanned(true);
      setMessage({
        type: 'ok',
        text: 'נוצרה תכנית. ערכו את המסמך ו/או את ה-JSON, ואז לחצו ״צור סרטון״.'
      });
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setPlanning(false);
    }
  };

  const handleCreateVideoJob = async () => {
    setMessage(null);
    setCreatingVideo(true);
    try {
      if ((creativeDesc || '').trim().length < 8) {
        setMessage({ type: 'error', text: 'תיאור הסרטון קצר מדי.' });
        return;
      }
      if (!hasPlanned || !(editableBriefJson || '').trim()) {
        setMessage({ type: 'error', text: 'קודם לחצו ״תכנן את הסרטון״ וודאו שיש בריף JSON.' });
        return;
      }
      try {
        JSON.parse(editableBriefJson);
      } catch {
        setMessage({ type: 'error', text: 'ה-JSON של הבריף לא תקין — תקנו לפני שליחה.' });
        return;
      }
      const production = await buildProductionPayload();
      const started = await api.createCreativeVideoJob({
        videoDescription: creativeDesc,
        scriptTone: creativeTone,
        userNotes: creativeNotes,
        characterId: creativeCharacterId || undefined,
        production,
        planDocument,
        approvedBriefJson: editableBriefJson.trim()
      });
      const newId = normalizeCreateJobId(started);
      if (newId != null) {
        setActiveLogJobId(newId);
        try {
          const d = await api.getCreativeVideoJob(newId);
          setActiveLogJob(d.job || null);
        } catch {
          /* polling */
        }
      }
      setMessage({
        type: 'ok',
        text: 'ה-job נשלח לתור לרינדור. הלוג משמאל מתעדכן אוטומטית.'
      });
      setCreativeBusy(true);
      await loadCreative();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setCreatingVideo(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Sparkles className="text-gold-400" size={28} />
            סטודיו סרטונים (shortvid)
          </h1>
          <p className="text-midnight-400 text-sm" dir="rtl">
            אפליקציה עצמאית: תסריט (אופציונלי LLM), B-roll מ־Pexels, רינדור אנכי ב־Shotstack. מפתחות השרת (
            <code className="text-midnight-300">PEXELS_API_KEY</code>,{' '}
            <code className="text-midnight-300">SHOTSTACK_API_KEY</code>) מוגדרים בסביבת הריצה.
          </p>
        </div>
        {creativeBusy && (
          <div className="flex items-center gap-2 text-amber-400 text-sm">
            <Loader className="animate-spin" size={18} />
            רינדור… (Shotstack עלול לקחת מספר דקות)
          </div>
        )}
      </div>

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 flex items-center gap-2 ${
            message.type === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
          }`}
        >
          {message.type === 'ok' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-gold-500 text-midnight-950'
                : 'bg-midnight-800 text-midnight-200 hover:bg-midnight-700'
            }`}
          >
            <t.icon size={18} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'brief' && (
        <div
          dir="ltr"
          className="grid grid-cols-1 md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] gap-4 items-start"
        >
          <div
            className="glass rounded-xl p-4 border-2 border-midnight-500/70 ring-1 ring-white/10 min-h-[280px] flex flex-col"
            dir="rtl"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-midnight-400">log:</span>
              {activeLogLoading && <Loader className="animate-spin text-gold-400 shrink-0" size={16} />}
            </div>

            {(() => {
              const job = activeLogJob;
              const logBrief = job?.brief;
              const logDebug = logBrief?.debug || {};
              const provider = String(logDebug.llm_provider || settings.creative_llm_provider || 'template').toLowerCase();
              const providerLabel =
                provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Template (ללא LLM)';
              const logQueries = logBrief?.pexels_search_queries || logDebug?.pexels_queries_used || [];
              const timelineUrls =
                Array.isArray(logDebug.selected_timeline_video_urls) && logDebug.selected_timeline_video_urls.length
                  ? logDebug.selected_timeline_video_urls
                  : Array.isArray(logDebug.pexels_timeline_urls)
                    ? logDebug.pexels_timeline_urls
                    : [];
              const logCandidateUrls = logDebug.pexels_candidate_video_urls || job?.pexels_urls || [];
              const logScenes = logBrief?.scenes || [];

              const customerFromJob =
                job && [job.video_description, job.user_notes].filter(Boolean).join('\n\n').trim();
              const customerPreview = [creativeDesc, creativeNotes && `הערות: ${creativeNotes}`]
                .filter(Boolean)
                .join('\n\n')
                .trim();
              const customerBlock =
                customerFromJob ||
                customerPreview ||
                '— (מלאו תיאור ולחצו ״צור סרטון״ — או ״הצג לוג של ה-job האחרון״ למטה)';

              const narrationText =
                logBrief?.narration ||
                (!job && activeLogJobId != null
                  ? 'טוען / ממתין לנתונים מהשרת…'
                  : job && job.status === 'pending'
                    ? 'ממתין בתור…'
                    : job && job.status === 'processing'
                      ? 'מעבד: תסריט / Pexels / Shotstack…'
                      : '—');

              const firstClipName = timelineUrls.length ? urlTailLabel(timelineUrls[0]) : '';

              return (
                <div className="text-xs space-y-4 flex-1 overflow-y-auto max-h-[75vh] pr-0.5">
                  <section className="space-y-1">
                    <h4 className="text-[11px] font-semibold text-gold-400">הוראות שנכתבו על ידי הלקוח</h4>
                    <pre
                      dir="auto"
                      className="bg-midnight-950/90 rounded-md p-2.5 text-[11px] text-midnight-200 whitespace-pre-wrap max-h-40 overflow-y-auto border border-midnight-700/80"
                    >
                      {customerBlock}
                    </pre>
                  </section>

                  <section className="space-y-1">
                    <h4 className="text-[11px] font-semibold text-gold-400">
                      תסריט שנכתב על ידי {providerLabel}
                      {logDebug.llm_model ? ` · ${logDebug.llm_model}` : ''}
                    </h4>
                    {logDebug.fallback_from_llm && (
                      <p className="text-amber-400 text-[10px] leading-snug">
                        נפילה לתבנית ({String(logDebug.fallback_from_llm)}).
                      </p>
                    )}
                    <pre
                      dir="auto"
                      className="bg-midnight-950/90 rounded-md p-2.5 text-[11px] text-midnight-200 whitespace-pre-wrap max-h-44 overflow-y-auto border border-midnight-700/80"
                    >
                      {narrationText}
                    </pre>
                    {logDebug.prompt_user_block && (
                      <details className="text-[10px] text-midnight-500">
                        <summary className="cursor-pointer text-midnight-400 hover:text-midnight-300">
                          פרומפט מלא ל־LLM
                        </summary>
                        <pre dir="auto" className="mt-1 p-2 bg-midnight-900/60 rounded whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {logDebug.prompt_user_block}
                        </pre>
                      </details>
                    )}
                  </section>

                  <section className="space-y-1">
                    <h4 className="text-[11px] font-semibold text-gold-400">סרטון שנמצא במאגר (Pexels → טיימליין)</h4>
                    {timelineUrls.length ? (
                      <ul className="space-y-1.5 text-[11px] text-midnight-300">
                        {timelineUrls.map((u, i) => (
                          <li key={i} className="flex flex-col gap-0.5 border-b border-midnight-800/80 pb-1.5 last:border-0">
                            <span className="font-mono text-midnight-400 truncate" title={u}>
                              {urlTailLabel(u) || `clip_${i + 1}`}
                            </span>
                            <a href={u} className="text-gold-400/90 hover:underline break-all" target="_blank" rel="noreferrer">
                              פתח מקור
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-midnight-500 text-[11px]">
                        {job ? '— עדיין לא נבחרו קליפים (יעודכן אחרי Pexels).' : '—'}
                      </p>
                    )}
                    {firstClipName ? (
                      <p className="text-[10px] text-midnight-500">קליפ ראשון: {firstClipName}</p>
                    ) : null}
                  </section>

                  <section className="space-y-1">
                    <h4 className="text-[11px] font-semibold text-gold-400">מקורות נוספים</h4>
                    {logQueries.length ? (
                      <ul className="list-disc pr-4 text-midnight-400 space-y-0.5">
                        {logQueries.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-midnight-500 text-[11px]">—</p>
                    )}
                    {Array.isArray(logDebug.pexels_pages_used) && logDebug.pexels_pages_used.length > 0 && (
                      <ul className="mt-1 text-[10px] text-midnight-500 space-y-0.5 list-none">
                        {logDebug.pexels_pages_used.map((row, i) => (
                          <li key={i}>
                            חיפוש עמוד {row.page}: {row.query}
                          </li>
                        ))}
                      </ul>
                    )}
                    {logCandidateUrls.length > 0 && (
                      <details className="text-[10px] text-midnight-500">
                        <summary className="cursor-pointer text-midnight-400">
                          מועמדים מ־Pexels ({logCandidateUrls.length})
                        </summary>
                        <div className="mt-1 space-y-1 max-h-28 overflow-y-auto">
                          {logCandidateUrls.slice(0, 12).map((u, i) => (
                            <a
                              key={i}
                              href={u}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-gold-400/80 hover:underline truncate"
                            >
                              {i + 1}. {urlTailLabel(u)}
                            </a>
                          ))}
                        </div>
                      </details>
                    )}
                    {logDebug.character_image_url && (
                      <a
                        href={logDebug.character_image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-gold-400/90 hover:underline truncate text-[10px] mt-1"
                      >
                        תמונת דמות בפינה
                      </a>
                    )}
                  </section>

                  <section className="space-y-1">
                    <h4 className="text-[11px] font-semibold text-gold-400">כיתובים (scenes)</h4>
                    {logScenes.length ? (
                      <ul className="space-y-1 max-h-28 overflow-y-auto">
                        {logScenes.map((s, i) => (
                          <li key={i} className="text-[11px] text-midnight-300">
                            [{s.start_sec}s / {s.duration_sec}s] {s.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-midnight-500 text-[11px]">—</p>
                    )}
                  </section>

                  <section className="space-y-1">
                    <h4 className="text-[11px] font-semibold text-gold-400">קובץ סופי</h4>
                    {job?.output_url ? (
                      <div className="space-y-1">
                        <a
                          href={job.output_url}
                          className="text-gold-400 hover:underline break-all text-[11px] block"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {urlTailLabel(job.output_url) || 'הורד / צפה ב־MP4'}
                        </a>
                        <span className="text-[10px] text-midnight-500 font-mono break-all">{job.output_url}</span>
                      </div>
                    ) : job?.status === 'failed' ? (
                      <p className="text-red-400 text-[11px]">ה-job נכשל — אין קובץ סופי.</p>
                    ) : (
                      <p className="text-midnight-500 text-[11px]">— (אחרי Shotstack)</p>
                    )}
                  </section>

                  <div className="pt-2 border-t border-midnight-700/80 space-y-2">
                    {activeLogJobId != null && (
                      <p className="text-[10px] text-midnight-500 font-mono">
                        job #{activeLogJobId}
                        {job?.status ? ` · ${job.status}` : ''}
                      </p>
                    )}
                    {job?.error_message && (
                      <pre className="text-red-300 whitespace-pre-wrap text-[10px]">{job.error_message}</pre>
                    )}
                    {creativeJobs[0] && (
                      <button
                        type="button"
                        className="text-[11px] text-gold-400 hover:underline"
                        onClick={async () => {
                          const id = creativeJobs[0].id;
                          setActiveLogJobId(id);
                          try {
                            const d = await api.getCreativeVideoJob(id);
                            setActiveLogJob(d.job || null);
                          } catch (e) {
                            setMessage({ type: 'error', text: e.message });
                          }
                        }}
                      >
                        הצג לוג של ה-job האחרון (#{creativeJobs[0].id})
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="glass rounded-xl p-6 space-y-4" dir="rtl">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="text-gold-400" size={22} />
              יצירת סרטון קצר
            </h2>
            <p className="text-sm text-midnight-400" dir="rtl">
              בריף ייצור (תסריט, חיפושי B-roll, כיתובים), וידאו אנכי מ־
              <a href="https://www.pexels.com/" className="text-gold-400 underline mx-0.5" target="_blank" rel="noreferrer">
                Pexels
              </a>
              , רינדור ב־
              <a href="https://shotstack.io/docs/api/" className="text-gold-400 underline mx-0.5" target="_blank" rel="noreferrer">
                Shotstack
              </a>
              .
            </p>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className={creativeCfg.pexels_configured ? 'text-emerald-400' : 'text-amber-400'}>
                Pexels: {creativeCfg.pexels_configured ? 'מוגדר' : 'חסר מפתח'}
              </span>
              <span className={creativeCfg.shotstack_configured ? 'text-emerald-400' : 'text-amber-400'}>
                Shotstack: {creativeCfg.shotstack_configured ? 'מוגדר' : 'חסר מפתח'}
              </span>
            </div>
            <div>
              <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                1. תיאור הסרטון
              </label>
              <textarea
                className="input-dark w-full min-h-[100px]"
                dir="rtl"
                value={creativeDesc}
                onChange={e => setCreativeDesc(e.target.value)}
                placeholder="למשל: טיפים לקנייה חכמה באונליין…"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  2. סגנון תסריט (קהל)
                </label>
                <select className="input-dark w-full" value={creativeTone} onChange={e => setCreativeTone(e.target.value)}>
                  {(creativeOptions.tones || []).map(t => (
                    <option key={t.id} value={t.id}>
                      {t.label_he} ({t.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  דמות / תמונת פינה (אופציונלי)
                </label>
                <select
                  className="input-dark w-full"
                  value={creativeCharacterId}
                  onChange={e => setCreativeCharacterId(e.target.value)}
                >
                  <option value="">ברירת מחדל</option>
                  {(creativeOptions.characters || []).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                3. הוראות לתסריט, הדגשים, מבנה
              </label>
              <textarea
                className="input-dark w-full min-h-[80px]"
                dir="rtl"
                value={scriptInstructions}
                onChange={e => setScriptInstructions(e.target.value)}
                placeholder="איך לספר את הסיפור, סדר כרונולוגי, טון דיבור…"
              />
            </div>
            <div>
              <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                4. הדגשים / חובה לכלול
              </label>
              <textarea
                className="input-dark w-full min-h-[64px]"
                dir="rtl"
                value={emphasis}
                onChange={e => setEmphasis(e.target.value)}
                placeholder="משפטים, מסרים או ויזואל שחייבים להופיע…"
              />
            </div>

            <div>
              <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                5. קישורים להשראה (שורה לכל קישור)
              </label>
              <textarea
                className="input-dark w-full min-h-[56px] font-mono text-xs"
                dir="ltr"
                value={inspirationUrls}
                onChange={e => setInspirationUrls(e.target.value)}
                placeholder="https://…"
              />
            </div>

            <div className="grid sm:grid-cols-1 gap-3">
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  6. קבצי השראה (טקסט / תמונה / וידאו קצר, עד ~400KB לקובץ)
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,.txt,.md,text/plain"
                  className="text-xs text-midnight-300 w-full"
                  onChange={e => setInspirationFiles(Array.from(e.target.files || []))}
                />
                {inspirationFiles.length > 0 && (
                  <p className="text-[11px] text-midnight-500 mt-1">{inspirationFiles.length} קבצים נבחרו</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  7. תמונות להמחשה
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="text-xs text-midnight-300 w-full"
                  onChange={e => setIllustrationFiles(Array.from(e.target.files || []))}
                />
                {illustrationFiles.length > 0 && (
                  <p className="text-[11px] text-midnight-500 mt-1">{illustrationFiles.length} תמונות</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  8. צילום מהמצלמה (מובייל / מצלמת רשת)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="text-xs text-midnight-300 w-full"
                  onChange={e => setCameraFiles(Array.from(e.target.files || []))}
                />
                {cameraFiles.length > 0 && (
                  <p className="text-[11px] text-midnight-500 mt-1">{cameraFiles.length} צילומים</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  9. קול רקע / מוזיקה (מידע לתכנית; שילוב ברינדור Shotstack — בשלבים הבאים)
                </label>
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.ogg"
                  className="text-xs text-midnight-300 w-full"
                  onChange={e => setBackgroundAudioFile(e.target.files?.[0] || null)}
                />
                {backgroundAudioFile && (
                  <p className="text-[11px] text-midnight-500 mt-1">{backgroundAudioFile.name}</p>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  שפת תוכן
                </label>
                <select className="input-dark w-full" value={prodLanguage} onChange={e => setProdLanguage(e.target.value)}>
                  <option value="he">עברית</option>
                  <option value="en">אנגלית</option>
                  <option value="mixed">מעורב</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  דיבור / דמות (מגדר)
                </label>
                <select className="input-dark w-full" value={prodGender} onChange={e => setProdGender(e.target.value)}>
                  <option value="neutral">ניטרלי</option>
                  <option value="male">זכר</option>
                  <option value="female">נקבה</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  ייצוג (מראה)
                </label>
                <select className="input-dark w-full" value={prodEthnicity} onChange={e => setProdEthnicity(e.target.value)}>
                  <option value="any">כללי / לא רלוונטי</option>
                  <option value="black">שחור</option>
                  <option value="white">לבן</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  קבוצת גיל
                </label>
                <select className="input-dark w-full" value={prodAge} onChange={e => setProdAge(e.target.value)}>
                  <option value="child">ילד</option>
                  <option value="young">צעיר</option>
                  <option value="adult">בוגר</option>
                  <option value="senior">מבוגר / זקן</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
                <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                  סגנון וידאו
                </label>
                <select className="input-dark w-full" value={videoStyle} onChange={e => setVideoStyle(e.target.value)}>
                  <option value="young">צעיר</option>
                  <option value="nature">טבע</option>
                  <option value="kids">לילדים</option>
                  <option value="clubs">מועדונים</option>
                  <option value="professional">מקצועי</option>
                  <option value="spiritual">רוחני</option>
                  <option value="polished">מכופתר</option>
                  <option value="hippie">היפי</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                10. הערות נוספות (קצב, מותג…)
              </label>
              <textarea
                className="input-dark w-full min-h-[72px]"
                dir="rtl"
                value={creativeNotes}
                onChange={e => setCreativeNotes(e.target.value)}
                placeholder="קצב, שפה, מותג…"
              />
            </div>

            <button
              type="button"
              className="btn-gold flex items-center gap-2 disabled:opacity-50"
              disabled={creativeBusy || planning}
              onClick={handlePlanVideo}
            >
              <Sparkles size={18} />
              {planning ? 'מתכנן…' : 'תכנן את הסרטון'}
            </button>

            {hasPlanned && (
              <div className="rounded-xl border border-gold-500/35 bg-midnight-900/50 p-4 space-y-3 mt-2" dir="rtl">
                <h3 className="text-sm font-semibold text-gold-400">תכנית — עריכה לפני יצירה</h3>
                <p className="text-xs text-midnight-500">
                  מתחת: מסמך תכנית בעברית ובריף טכני ב־JSON (כולל narration, scenes, שאילתות Pexels). ערכו בזהירות —
                  JSON לא תקין ייעצר בשרת.
                </p>
                <div>
                  <label className="block text-xs text-midnight-400 mb-1">מסמך תכנית (ניתן לערוך)</label>
                  <textarea
                    className="input-dark w-full min-h-[180px] text-xs leading-relaxed"
                    value={planDocument}
                    onChange={e => setPlanDocument(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-midnight-400 mb-1">בריף JSON (ניתן לערוך)</label>
                  <textarea
                    dir="ltr"
                    className="input-dark w-full min-h-[240px] font-mono text-[11px] text-left"
                    spellCheck={false}
                    value={editableBriefJson}
                    onChange={e => setEditableBriefJson(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
                  disabled={creativeBusy || creatingVideo}
                  onClick={handleCreateVideoJob}
                >
                  <Sparkles size={18} />
                  {creatingVideo ? 'שולח…' : 'צור סרטון (שליחה לענן)'}
                </button>
              </div>
            )}

            <p className="text-xs text-midnight-500" dir="rtl">
              מקור תסריט LLM: טאב <strong>הגדרות סטודיו</strong>. מנגנון קול ברינדור נקבע שם תחת &quot;מנגנון יצירת קול&quot;.
            </p>
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="glass rounded-xl p-6">
          <h3 className="text-md font-semibold mb-3">Jobs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-midnight-500 border-b border-midnight-700">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Trigger</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {creativeJobs.map(j => (
                  <tr key={j.id} className="border-b border-midnight-800/80">
                    <td className="py-2 pr-2 font-mono">{j.id}</td>
                    <td className="py-2 pr-2 uppercase text-midnight-400">{j.status}</td>
                    <td className="py-2 pr-2 text-midnight-500">{j.trigger_source}</td>
                    <td className="py-2 pr-2 max-w-md truncate" title={j.video_description}>
                      {j.video_description}
                    </td>
                    <td className="py-2 pr-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-gold-400 hover:underline text-xs"
                        onClick={async () => {
                          try {
                            const d = await api.getCreativeVideoJob(j.id);
                            setCreativeDetail(d.job);
                            setActiveLogJobId(j.id);
                          } catch (e) {
                            setMessage({ type: 'error', text: e.message });
                          }
                        }}
                      >
                        Details
                      </button>
                      {j.status === 'completed' && j.output_url && (
                        <a
                          href={j.output_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:underline text-xs flex items-center gap-0.5"
                        >
                          <ExternalLink size={12} /> MP4
                        </a>
                      )}
                      {j.status === 'failed' && (
                        <button
                          type="button"
                          className="text-amber-400 hover:underline text-xs flex items-center gap-1"
                          disabled={creativeRetryingId === j.id || creativeBusy}
                          onClick={async () => {
                            setCreativeRetryingId(j.id);
                            try {
                              await api.retryCreativeVideoJob(j.id);
                              setMessage({ type: 'ok', text: `Job #${j.id} retry started.` });
                              setCreativeBusy(true);
                              await loadCreative();
                            } catch (e) {
                              setMessage({ type: 'error', text: e.message });
                            } finally {
                              setCreativeRetryingId(null);
                            }
                          }}
                        >
                          <RefreshCw size={12} className={creativeRetryingId === j.id ? 'animate-spin' : ''} />
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!creativeJobs.length && <p className="text-midnight-500 text-sm py-4">אין jobs עדיין.</p>}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="glass rounded-xl p-6 space-y-4 max-w-2xl">
          <h2 className="text-lg font-semibold">הגדרות סטודיו</h2>
          <p className="text-xs text-midnight-400" dir="rtl">
            מפתחות LLM נשמרים במסד הנתונים של shortvid (לא חובה אם משתמשים ב-Template).
          </p>

          <div className="border border-midnight-600 rounded-lg p-4 space-y-4 bg-midnight-900/20">
            <h3 className="text-sm font-semibold text-gold-300">תסריט (LLM)</h3>
            <div>
              <label className="block text-sm text-midnight-300 mb-1">מקור תסריט</label>
              <select
                className="input-dark w-full max-w-lg"
                value={settings.creative_llm_provider || 'template'}
                onChange={e => setSettings({ ...settings, creative_llm_provider: e.target.value })}
              >
                <option value="template">Template (ללא API)</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            {(settings.creative_llm_provider || 'template') === 'gemini' && (
              <>
                <div>
                  <label className="block text-sm text-midnight-300 mb-1">Gemini API key</label>
                  <p className="text-xs text-midnight-500 mb-1">
                    {settings.creative_gemini_key_configured ? 'מפתח שמור — הדבק רק להחלפה.' : 'לא הוגדר.'}
                  </p>
                  <input
                    type="text"
                    className="input-dark w-full font-mono text-sm"
                    value={geminiKeyInput}
                    onChange={e => setGeminiKeyInput(e.target.value)}
                    placeholder="AIza…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label className="block text-sm text-midnight-300 mb-1">מודל Gemini</label>
                  <input
                    className="input-dark w-full font-mono max-w-lg"
                    value={settings.creative_gemini_model || 'gemini-2.0-flash'}
                    onChange={e => setSettings({ ...settings, creative_gemini_model: e.target.value })}
                  />
                </div>
              </>
            )}
            {(settings.creative_llm_provider || 'template') === 'openai' && (
              <>
                <div>
                  <label className="block text-sm text-midnight-300 mb-1">OpenAI API key</label>
                  <p className="text-xs text-midnight-500 mb-1">
                    {settings.creative_openai_key_configured ? 'מפתח שמור.' : 'לא הוגדר.'}
                  </p>
                  <input
                    type="password"
                    className="input-dark w-full font-mono text-sm"
                    value={openaiKeyInput}
                    onChange={e => setOpenaiKeyInput(e.target.value)}
                    placeholder="sk-…"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm text-midnight-300 mb-1">מודל OpenAI</label>
                  <input
                    className="input-dark w-full max-w-md"
                    value={settings.creative_openai_model || 'gpt-4o-mini'}
                    onChange={e => setSettings({ ...settings, creative_openai_model: e.target.value })}
                  />
                </div>
              </>
            )}
            <div className="pt-3 border-t border-midnight-700/60">
              <label className="block text-sm text-midnight-300 mb-1" dir="rtl">
                מנגנון יצירת קול (ברינדור)
              </label>
              <select
                className="input-dark w-full max-w-lg"
                value={settings.creative_voice_mechanism || 'shotstack_tts'}
                onChange={e => setSettings({ ...settings, creative_voice_mechanism: e.target.value })}
              >
                <option value="shotstack_tts">Shotstack — דיבור (TTS) מובנה</option>
                <option value="captions_only">ללא דיבור — כיתובים בלבד</option>
              </select>
              <p className="text-[11px] text-midnight-500 mt-1" dir="rtl">
                ב&quot;ללא דיבור&quot; לא נשלח מסלול text-to-speech ל־Shotstack (רק וידאו Pexels + כיתובים).
              </p>
            </div>
          </div>

          <div className="border border-midnight-600 rounded-lg p-4 space-y-4 bg-midnight-900/20">
            <h3 className="text-sm font-semibold text-gold-300">Pexels → Shotstack</h3>
            <p className="text-xs text-midnight-400" dir="rtl">
              מפתחות: עדיפות ל־משתני סביבה (<code className="text-midnight-300">PEXELS_API_KEY</code>,{' '}
              <code className="text-midnight-300">SHOTSTACK_API_KEY</code>), אחרת הערכים השמורים כאן במסד.
            </p>
            <div className="space-y-2 pt-2 border-t border-midnight-700/80">
              <label className="block text-sm text-midnight-300 mb-1">מפתח API של Pexels</label>
              <p className="text-xs text-midnight-500 mb-1">
                {settings.creative_pexels_key_configured
                  ? 'מפתח שמור — הדבק רק להחלפה. ריק + שמירה לא מוחק (השאר ריק אם לא מחליפים).'
                  : 'לא הוגדר במסד — אפשר להדביק כאן או להגדיר בסביבה.'}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  type="password"
                  className="input-dark w-full font-mono text-sm flex-1"
                  value={pexelsKeyInput}
                  onChange={e => setPexelsKeyInput(e.target.value)}
                  placeholder="הדבק מפתח לבדיקה / שמירה"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border border-midnight-600 text-midnight-200 hover:bg-midnight-800 text-sm whitespace-nowrap"
                  disabled={pexelsTesting}
                  onClick={async () => {
                    setMessage(null);
                    setPexelsTesting(true);
                    try {
                      const r = await api.testPexelsKey(pexelsKeyInput.trim() || undefined);
                      setMessage({
                        type: 'ok',
                        text: `חיבור Pexels תקין (${r.videosReturned ?? 0} תוצאות לדוגמה).`
                      });
                      await loadCreative();
                    } catch (e) {
                      setMessage({ type: 'error', text: e.message });
                    } finally {
                      setPexelsTesting(false);
                    }
                  }}
                >
                  {pexelsTesting ? 'בודק…' : 'בדוק חיבור'}
                </button>
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t border-midnight-700/80">
              <label className="block text-sm text-midnight-300 mb-1">מפתח API של Shotstack</label>
              <p className="text-xs text-midnight-500 mb-1">
                {settings.creative_shotstack_key_configured
                  ? 'מפתח שמור — הדבק רק להחלפה.'
                  : 'לא הוגדר במסד — אפשר להדביק כאן או להגדיר SHOTSTACK_API_KEY בסביבה.'}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  type="password"
                  className="input-dark w-full font-mono text-sm flex-1"
                  value={shotstackKeyInput}
                  onChange={e => setShotstackKeyInput(e.target.value)}
                  placeholder="הדבק מפתח לבדיקה / שמירה"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border border-midnight-600 text-midnight-200 hover:bg-midnight-800 text-sm whitespace-nowrap"
                  disabled={shotstackTesting}
                  onClick={async () => {
                    setMessage(null);
                    setShotstackTesting(true);
                    try {
                      await api.testShotstackKey(shotstackKeyInput.trim() || undefined);
                      setMessage({ type: 'ok', text: 'חיבור Shotstack תקין (מפתח התקבל).' });
                      await loadCreative();
                    } catch (e) {
                      setMessage({ type: 'error', text: e.message });
                    } finally {
                      setShotstackTesting(false);
                    }
                  }}
                >
                  {shotstackTesting ? 'בודק…' : 'בדוק Shotstack'}
                </button>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-midnight-700/80">
              <div>
                <label className="block text-sm text-midnight-300 mb-1">תוצאות לחיפוש (per page)</label>
                <input
                  type="number"
                  min={1}
                  max={15}
                  className="input-dark w-full max-w-[8rem] font-mono"
                  value={settings.creative_pexels_per_page || '6'}
                  onChange={e => setSettings({ ...settings, creative_pexels_per_page: e.target.value })}
                />
                <p className="text-xs text-midnight-500 mt-1">1–15 (ברירת מחדל API)</p>
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1">כיוון וידאו</label>
                <select
                  className="input-dark w-full max-w-xs"
                  value={settings.creative_pexels_orientation || 'portrait'}
                  onChange={e => setSettings({ ...settings, creative_pexels_orientation: e.target.value })}
                >
                  <option value="portrait">אנכי (portrait)</option>
                  <option value="landscape">אופקי (landscape)</option>
                  <option value="square">מרובע (square)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1">Timeout חיפוש (שניות)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  className="input-dark w-full max-w-[8rem] font-mono"
                  value={settings.creative_pexels_timeout_sec || '45'}
                  onChange={e => setSettings({ ...settings, creative_pexels_timeout_sec: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm text-midnight-300 mb-1">עדיפות איכות קובץ</label>
                <select
                  className="input-dark w-full max-w-xs"
                  value={settings.creative_pexels_prefer_quality || 'hd'}
                  onChange={e => setSettings({ ...settings, creative_pexels_prefer_quality: e.target.value })}
                >
                  <option value="hd">HD (אז SD)</option>
                  <option value="sd">SD (אז HD)</option>
                  <option value="any">כל קישור זמין</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm text-midnight-300 mb-1">ספק רינדור</label>
              <select
                className="input-dark w-full max-w-lg"
                value={settings.creative_video_provider || 'shotstack'}
                onChange={e => setSettings({ ...settings, creative_video_provider: e.target.value })}
              >
                <option value="shotstack">Shotstack</option>
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.creative_video_auto_enabled === 'true'}
                onChange={e =>
                  setSettings({
                    ...settings,
                    creative_video_auto_enabled: e.target.checked ? 'true' : 'false'
                  })
                }
              />
              <span>אוטומציה מתוזמנת (נושא + טון למטה)</span>
            </label>
            <div>
              <label className="block text-sm text-midnight-300 mb-1">Cron (זמן שרת)</label>
              <input
                className="input-dark w-full font-mono"
                value={settings.creative_video_cron || '0 14 * * *'}
                onChange={e => setSettings({ ...settings, creative_video_cron: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-midnight-300 mb-1">תיאור לריצה אוטומטית</label>
              <textarea
                className="input-dark w-full min-h-[80px]"
                value={settings.creative_auto_description || ''}
                onChange={e => setSettings({ ...settings, creative_auto_description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-midnight-300 mb-1">טון לריצה אוטומטית (id)</label>
              <input
                className="input-dark w-full max-w-xs font-mono"
                value={settings.creative_auto_tone || 'adults'}
                onChange={e => setSettings({ ...settings, creative_auto_tone: e.target.value })}
              />
            </div>
          </div>

          <button type="button" className="btn-gold" onClick={saveStudioSettings} disabled={saving}>
            {saving ? 'שומר…' : 'שמור הגדרות'}
          </button>
        </div>
      )}

      {creativeDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setCreativeDetail(null)}>
          <div
            className="glass rounded-xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Job #{creativeDetail.id}</h3>
            <div className="space-y-2 text-sm text-midnight-300">
              <p>
                <span className="text-midnight-500">Status:</span> {creativeDetail.status}
              </p>
              <p dir="rtl">
                <span className="text-midnight-500">תיאור:</span> {creativeDetail.video_description}
              </p>
              {creativeDetail.error_message && (
                <p className="text-red-400">
                  <span className="text-midnight-500">Error:</span> {creativeDetail.error_message}
                </p>
              )}
              {creativeDetail.brief?.narration && (
                <div>
                  <span className="text-midnight-500">Narration:</span>
                  <pre className="mt-1 whitespace-pre-wrap text-xs bg-midnight-900/80 p-2 rounded max-h-40 overflow-y-auto">
                    {creativeDetail.brief.narration}
                  </pre>
                </div>
              )}
              {creativeDetail.output_url && (
                <a
                  href={creativeDetail.output_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-gold-400 hover:underline"
                >
                  <ExternalLink size={14} /> Open MP4
                </a>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" className="btn-gold flex-1" onClick={() => setCreativeDetail(null)}>
                סגור
              </button>
              {creativeDetail.status === 'failed' && (
                <button
                  type="button"
                  className="flex-1 border border-amber-500/50 text-amber-300 rounded-lg px-4 py-2"
                  disabled={!!creativeRetryingId || creativeBusy}
                  onClick={async () => {
                    const id = creativeDetail.id;
                    setCreativeRetryingId(id);
                    try {
                      await api.retryCreativeVideoJob(id);
                      setCreativeDetail(null);
                      setCreativeBusy(true);
                      await loadCreative();
                    } catch (e) {
                      setMessage({ type: 'error', text: e.message });
                    } finally {
                      setCreativeRetryingId(null);
                    }
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
