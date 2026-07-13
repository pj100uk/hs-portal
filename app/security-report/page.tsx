'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';

function ReportForm() {
  const searchParams = useSearchParams();
  const uid = searchParams.get('uid') ?? '';

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/security/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, message }),
      });
      if (!res.ok) throw new Error();
      setDone(true);
    } catch {
      setError('Something went wrong. Please try again or contact us directly.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-xl font-black text-slate-900 tracking-tight">RiskDox</span>
          </div>
          <p className="text-xs text-indigo-500 font-semibold uppercase tracking-widest">Health &amp; Safety Portal</p>
          <p className="text-[11px] text-slate-400 mt-1">by McCormack Benson Health &amp; Safety</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border-t-4 border-indigo-600 border-x border-b border-indigo-100 overflow-hidden">
          {done ? (
            <div className="p-8 text-center">
              <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-4" />
              <h1 className="text-lg font-black text-slate-900 mb-2">Report received</h1>
              <p className="text-sm text-slate-500 leading-relaxed">
                Thank you. Our team has been notified and will investigate and secure your account as quickly as possible.
              </p>
              <p className="text-sm text-slate-500 mt-3">
                You can also reach us at{' '}
                <a href="https://www.mb-hs.com" className="text-indigo-600 hover:underline">www.mb-hs.com</a>
                {' '}or call <strong>01375 398 998</strong>.
              </p>
            </div>
          ) : (
            <div className="p-8">
              <div className="flex items-start gap-3 mb-6">
                <ShieldAlert size={22} className="text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <h1 className="text-base font-black text-slate-900 mb-1">Report unauthorised access</h1>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    If your RiskDox password was changed without your knowledge, please describe what happened below. Our team will investigate and secure your account immediately.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                    What happened?
                  </label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="e.g. I received an email about a password change I didn't make. I last logged in on..."
                    rows={5}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                  />
                </div>

                {error && (
                  <p className="text-xs text-rose-500">{error}</p>
                )}

                <button
                  onClick={submit}
                  disabled={loading || !message.trim()}
                  className="w-full py-3 bg-rose-600 text-white rounded-xl text-sm font-black uppercase tracking-wider hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Submitting…' : 'Submit Report'}
                </button>
              </div>

              <p className="text-[11px] text-slate-400 text-center mt-5 leading-relaxed">
                You can also call us on <strong className="text-slate-500">01375 398 998</strong> or visit{' '}
                <a href="https://www.mb-hs.com" className="text-indigo-500 hover:underline">www.mb-hs.com</a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SecurityReportPage() {
  return (
    <Suspense>
      <ReportForm />
    </Suspense>
  );
}
