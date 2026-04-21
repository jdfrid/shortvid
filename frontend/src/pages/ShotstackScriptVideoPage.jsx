import { useEffect, useState } from 'react';
import { Sparkles, Download, Loader } from 'lucide-react';
import api from '../services/api';

export default function ShotstackScriptVideoPage() {
  const [scriptText, setScriptText] = useState('');
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!jobId) return undefined;
    let cancel = false;
    const pull = async () => {
      try {
        const res = await api.getShotstackScriptVideoJob(jobId);
        if (!cancel) setJob(res.job || null);
      } catch (e) {
        if (!cancel) setError(e.message || 'שגיאה בקבלת סטטוס');
      }
    };
    pull();
    const id = setInterval(pull, 3000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [jobId]);

  const onCreate = async () => {
    setError('');
    setJob(null);
    if (scriptText.trim().length < 8) {
      setError('נא להזין תסריט של לפחות 8 תווים.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.createShotstackScriptVideoJob(scriptText.trim());
      setJobId(res.jobId || null);
    } catch (e) {
      setError(e.message || 'יצירת וידאו נכשלה');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-xl p-6 space-y-4 max-w-4xl mx-auto" dir="rtl">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <Sparkles className="text-gold-400" size={22} />
        Shotstack Script To Video
      </h1>
      <p className="text-sm text-midnight-400">
        עמוד נפרד לחלוטין: מזינים תסריט ומקבלים קובץ וידאו להורדה (Shotstack).
      </p>

      {error ? <div className="rounded-lg px-4 py-3 bg-red-500/15 text-red-300 text-sm">{error}</div> : null}

      <div>
        <label className="block text-sm text-midnight-300 mb-1">תסריט</label>
        <textarea
          className="input-dark w-full min-h-[200px]"
          value={scriptText}
          onChange={e => setScriptText(e.target.value)}
          placeholder="הדבק כאן תסריט מלא..."
        />
      </div>

      <button
        type="button"
        className="btn-gold flex items-center gap-2 disabled:opacity-50"
        disabled={loading}
        onClick={onCreate}
      >
        <Sparkles size={18} />
        {loading ? 'שולח ל-Shotstack…' : 'צור סרטון'}
      </button>

      <div className="rounded-lg border border-midnight-700/80 bg-midnight-900/40 p-4 text-sm space-y-2">
        <div className="text-midnight-300">
          סטטוס:{' '}
          <span className="font-mono text-midnight-200">{job?.status || (jobId ? 'ממתין...' : 'טרם נוצר job')}</span>
          {jobId ? <span className="text-midnight-500"> · job #{jobId}</span> : null}
        </div>

        {job?.status === 'processing' ? (
          <div className="flex items-center gap-2 text-amber-400">
            <Loader className="animate-spin" size={16} />
            מרנדר ב- Shotstack...
          </div>
        ) : null}

        {job?.status === 'failed' ? (
          <pre className="text-red-300 whitespace-pre-wrap text-xs">{job.error_message || 'ה-job נכשל'}</pre>
        ) : null}

        {job?.status === 'completed' && job?.output_url ? (
          <a
            href={job.output_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
          >
            <Download size={14} /> הורד MP4
          </a>
        ) : null}
      </div>
    </div>
  );
}
