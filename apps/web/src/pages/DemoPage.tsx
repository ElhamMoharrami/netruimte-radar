import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type OpportunitySummary, type RunSummaryDto } from '../api.js';

interface Feedback {
  message: string;
  tone: 'ok' | 'warn' | 'error';
}

export default function DemoPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunitySummary[]>([]);
  const navigate = useNavigate();

  const refresh = () => api.opportunities().then(setOpportunities).catch(() => setOpportunities([]));

  useEffect(() => {
    refresh();
  }, []);

  async function run(label: string, fn: () => Promise<{ summary?: RunSummaryDto; ok?: true }>) {
    setBusy(label);
    setFeedback(null);
    try {
      const result = await fn();
      if (result.summary) {
        setFeedback({
          message: `${label} → ${result.summary.opportunitiesCreated} new, ${result.summary.opportunitiesReassessed} reassessed, ${result.summary.actionsDispatched} actions, ${result.summary.failures} failures${result.summary.incomplete ? ' (INCOMPLETE)' : ''}`,
          tone: result.summary.failures > 0 || result.summary.incomplete ? 'warn' : 'ok',
        });
      } else {
        setFeedback({ message: `${label} → ok`, tone: 'ok' });
      }
      await refresh();
    } catch (err) {
      setFeedback({ message: `${label} → ${(err as Error).message}`, tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const promising = opportunities
    .filter((o) => o.status === 'promising')
    .sort((a, b) => b.score - a.score)[0];
  const rejected = opportunities
    .filter((o) => o.status === 'rejected')
    .sort((a, b) => a.score - b.score)[0];

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-sm uppercase tracking-wider text-slate-400">Demo controls</h2>
        <p className="text-xs text-slate-500 mt-1">
          Every button below invokes the real backend pipeline and writes to the real activity log.
          Nothing is faked in the frontend.
        </p>
      </header>

      <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        <ControlButton
          label="Reset demo"
          description="Wipe every record — start fresh."
          busy={busy}
          tone="danger"
          onClick={() => run('Reset demo', () => api.demo.reset())}
        />
        <ControlButton
          label="Run overnight scan"
          description="Full pipeline via wired providers."
          busy={busy}
          onClick={() => run('Overnight scan', () => api.demo.overnightScan())}
        />
        <ControlButton
          label="Inject conflicting evidence"
          description="Feed a contradicting source about the top opportunity."
          busy={busy}
          disabled={!promising}
          onClick={() =>
            run('Inject conflict', () =>
              promising
                ? api.demo.injectConflict(promising.id)
                : Promise.reject(new Error('no promising opportunity to conflict with')),
            )
          }
        />
        <ControlButton
          label="Simulate Apify failure"
          description="Provider throws twice — collection marked incomplete."
          busy={busy}
          tone="warn"
          onClick={() => run('Simulate Apify failure', () => api.demo.simulateApifyFail())}
        />
        <ControlButton
          label="Simulate n8n failure"
          description="Automation throws twice — delivery marked failed."
          busy={busy}
          tone="warn"
          onClick={() => run('Simulate n8n failure', () => api.demo.simulateN8nFail())}
        />
      </section>

      <section className="grid md:grid-cols-2 gap-3">
        <ShortcutCard
          label="Show a promising opportunity"
          value={promising ? `#${promising.id.slice(-6)} · score ${promising.score}` : 'none yet'}
          onClick={() => promising && navigate(`/opportunities/${promising.id}`)}
          disabled={!promising}
        />
        <ShortcutCard
          label="Show a rejected opportunity"
          value={rejected ? `#${rejected.id.slice(-6)} · score ${rejected.score}` : 'none yet'}
          onClick={() => rejected && navigate(`/opportunities/${rejected.id}`)}
          disabled={!rejected}
        />
      </section>

      {feedback && (
        <div
          className={`text-sm px-3 py-2 rounded border ${
            feedback.tone === 'ok'
              ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
              : feedback.tone === 'warn'
                ? 'border-amber-800 bg-amber-900/30 text-amber-200'
                : 'border-rose-800 bg-rose-900/30 text-rose-200'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <p className="text-xs text-slate-500">
        The demo control endpoints are only exposed when the API runs with{' '}
        <code className="text-slate-300 bg-slate-800/50 rounded px-1">DEMO_MODE=true</code>. In
        production mode they return 403.
      </p>
    </div>
  );
}

function ControlButton({
  label,
  description,
  onClick,
  busy,
  disabled,
  tone,
}: {
  label: string;
  description: string;
  onClick: () => void;
  busy: string | null;
  disabled?: boolean;
  tone?: 'warn' | 'danger';
}) {
  const isBusy = busy === label;
  const isDisabled = Boolean(busy) || disabled;
  const toneClass =
    tone === 'danger'
      ? 'border-rose-800 hover:bg-rose-900/20 text-rose-200'
      : tone === 'warn'
        ? 'border-amber-800 hover:bg-amber-900/20 text-amber-200'
        : 'border-radar-accent/30 hover:bg-radar-accent/10 text-radar-accent';
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`text-left rounded-lg border p-4 ${toneClass} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">{label}</div>
        {isBusy && <div className="text-xs opacity-60">running…</div>}
      </div>
      <div className="text-xs opacity-80 mt-1">{description}</div>
    </button>
  );
}

function ShortcutCard({
  label,
  value,
  onClick,
  disabled,
}: {
  label: string;
  value: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-left rounded-lg border border-slate-800 bg-radar-panel p-4 hover:bg-slate-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-slate-100 font-mono mt-1">{value}</div>
    </button>
  );
}

