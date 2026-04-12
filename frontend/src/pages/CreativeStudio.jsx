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
  'creative_pexels_prefer_quality'
];

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
  const [creativeStarting, setCreativeStarting] = useState(false);
  const [creativeDetail, setCreativeDetail] = useState(null);
  const [creativeRetryingId, setCreativeRetryingId] = useState(null);

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
    setSettings(prev => ({ ...prev, ...data }));
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

  const saveStudioSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {};
      for (const k of SETTINGS_PAYLOAD_KEYS) {
        const v = settings[k];
        if (v === undefined || v === null) continue;
        payload[k] = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
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
        <div className="glass rounded-xl p-6 space-y-4 max-w-3xl">
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
                2. סגנון תסריט
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
              3. הערות והנחיות
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
            disabled={creativeBusy || creativeStarting}
            onClick={async () => {
              setMessage(null);
              setCreativeStarting(true);
              try {
                await api.createCreativeVideoJob({
                  videoDescription: creativeDesc,
                  scriptTone: creativeTone,
                  userNotes: creativeNotes,
                  characterId: creativeCharacterId || undefined
                });
                setMessage({
                  type: 'ok',
                  text: 'ה-job נשלח לתור. הרשימה מתעדכנת אוטומטית.'
                });
                setCreativeBusy(true);
                await loadCreative();
              } catch (e) {
                setMessage({ type: 'error', text: e.message });
              } finally {
                setCreativeStarting(false);
              }
            }}
          >
            <Sparkles size={18} />
            {creativeStarting ? 'מתחיל…' : 'צור סרטון (ענן)'}
          </button>
          <p className="text-xs text-midnight-500" dir="rtl">
            מקור התסריט: טאב <strong>הגדרות סטודיו</strong> (Template / Gemini / OpenAI).
          </p>
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
