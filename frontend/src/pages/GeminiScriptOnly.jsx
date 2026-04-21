import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import api from '../services/api';

export default function GeminiScriptOnly() {
  const [videoDescription, setVideoDescription] = useState('');
  const [script, setScript] = useState('');
  const [raw, setRaw] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onGenerate = async () => {
    setError('');
    setScript('');
    setRaw('');
    setPrompt('');
    setModel('');
    if (videoDescription.trim().length < 8) {
      setError('נא להזין תיאור של לפחות 8 תווים.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.mistralScriptOnly(videoDescription.trim());
      setScript(res.script || '');
      setRaw(res.llmRawText || '');
      setPrompt(res.promptFullText || '');
      setModel(res.model || '');
    } catch (e) {
      setError(e.message || 'יצירת תסריט נכשלה');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-xl p-6 space-y-4 max-w-4xl mx-auto" dir="rtl">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <Sparkles className="text-gold-400" size={22} />
        Mistral Script Only
      </h1>
      <p className="text-sm text-midnight-400">
        מסך מינימלי: תיאור אחד, קריאה ל־Mistral, והצגת תסריט.
      </p>

      {error ? (
        <div className="rounded-lg px-4 py-3 bg-red-500/15 text-red-300 text-sm">{error}</div>
      ) : null}

      <div>
        <label className="block text-sm text-midnight-300 mb-1">תיאור מה אתה רוצה בסרטון</label>
        <textarea
          className="input-dark w-full min-h-[120px]"
          value={videoDescription}
          onChange={e => setVideoDescription(e.target.value)}
          placeholder="כתוב כאן מה אתה רוצה שהסרטון יאמר..."
        />
      </div>

      <button
        type="button"
        className="btn-gold flex items-center gap-2 disabled:opacity-50"
        disabled={loading}
        onClick={onGenerate}
      >
        <Sparkles size={18} />
        {loading ? 'פונה ל-Mistral…' : 'צור תסריט'}
      </button>

      <div>
        <label className="block text-sm text-midnight-300 mb-1">התסריט שחזר מ־Mistral</label>
        <textarea
          className="input-dark w-full min-h-[220px]"
          value={script}
          readOnly
          placeholder="כאן יוצג התסריט..."
        />
        {model ? <p className="text-[11px] text-midnight-500 mt-1 font-mono">model: {model}</p> : null}
      </div>

      <details className="text-xs text-midnight-500">
        <summary className="cursor-pointer text-midnight-400">פרומפט מלא שנשלח</summary>
        <pre className="mt-2 p-2 bg-midnight-900/70 rounded whitespace-pre-wrap max-h-56 overflow-y-auto" dir="ltr">
          {prompt || '(empty)'}
        </pre>
      </details>

      <details className="text-xs text-midnight-500">
        <summary className="cursor-pointer text-midnight-400">תשובה גולמית מה־API</summary>
        <pre className="mt-2 p-2 bg-midnight-900/70 rounded whitespace-pre-wrap max-h-56 overflow-y-auto" dir="ltr">
          {raw || '(empty)'}
        </pre>
      </details>
    </div>
  );
}
