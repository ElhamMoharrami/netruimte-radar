import { useEffect, useState } from 'react';
import { api, type RunHistoryDto } from '../api.js';

const TRIGGER_COLOR: Record<string, string> = {
  scheduled: 'bg-sky-900/50 text-sky-300',
  manual: 'bg-slate-800 text-slate-300',
  demo: 'bg-amber-900/40 text-amber-300',
};

export default function RunsPage() {
  const [runs, setRuns] = useState<RunHistoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs(100).then(setRuns).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="text-rose-400 text-sm">error: {error}</div>;
  if (!runs) return <div className="text-slate-400 text-sm">loading…</div>;
  if (runs.length === 0) {
    return (
      <div className="text-slate-500 text-sm border border-dashed border-slate-700 rounded p-6 text-center">
        No runs recorded yet. Trigger one from the Radar page.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm uppercase tracking-wider text-slate-400">Autonomous runs</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase text-slate-400">
            <tr>
              <th className="text-left px-3 py-2">When</th>
              <th className="text-left px-3 py-2">Trigger</th>
              <th className="text-left px-3 py-2">Providers</th>
              <th className="text-right px-3 py-2">Sources</th>
              <th className="text-right px-3 py-2">Signals</th>
              <th className="text-right px-3 py-2">Opps</th>
              <th className="text-right px-3 py-2">Actions</th>
              <th className="text-right px-3 py-2">Failures</th>
              <th className="text-left px-3 py-2">Duration</th>
              <th className="text-left px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-900/40">
                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                  {new Date(r.startedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${TRIGGER_COLOR[r.trigger] ?? 'bg-slate-800 text-slate-300'}`}
                  >
                    {r.trigger}
                  </span>
                  {r.incomplete && (
                    <span className="ml-2 px-2 py-0.5 rounded text-xs bg-rose-900/40 text-rose-300">
                      incomplete
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-400 text-xs font-mono">
                  {r.sourceProvider} · {r.extractor} · {r.automationProvider}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.sourcesDiscovered}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.signalsDetected}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.opportunitiesCreated}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.actionsDispatched}
                  {r.actionsBlocked > 0 && (
                    <span className="text-xs text-amber-400 ml-1">
                      ({r.actionsBlocked} blocked)
                    </span>
                  )}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    r.failures > 0 ? 'text-rose-400' : 'text-slate-400'
                  }`}
                >
                  {r.failures}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">
                  {duration(r.startedAt, r.finishedAt)}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">{r.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function duration(start: string, end: string): string {
  const ms = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
