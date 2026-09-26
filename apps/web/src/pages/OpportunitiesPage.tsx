import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OpportunitySummary } from '../api.js';

const STATUS_COLOR: Record<string, string> = {
  detected: 'bg-slate-700 text-slate-200',
  investigating: 'bg-sky-900/60 text-sky-300',
  promising: 'bg-emerald-900/60 text-emerald-300',
  blocked: 'bg-amber-900/60 text-amber-300',
  rejected: 'bg-rose-900/40 text-rose-300',
  escalated: 'bg-fuchsia-900/60 text-fuchsia-300',
  actioned: 'bg-emerald-900/60 text-emerald-300',
};

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<OpportunitySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .opportunities()
      .then((data) => setOpportunities(data.sort((a, b) => b.score - a.score)))
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="text-rose-400 text-sm">error: {error}</div>;
  if (!opportunities) return <div className="text-slate-400 text-sm">loading…</div>;
  if (opportunities.length === 0) {
    return (
      <div className="text-slate-500 text-sm border border-dashed border-slate-700 rounded p-6 text-center">
        No opportunities yet. Head to the Radar page and trigger a scan.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm uppercase tracking-wider text-slate-400">Opportunities</h2>
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase text-slate-400">
            <tr>
              <th className="text-left px-4 py-2">Score</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Congestion</th>
              <th className="text-left px-4 py-2">Next step</th>
              <th className="text-left px-4 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-900/50">
                <td className="px-4 py-3 font-mono text-radar-accent tabular-nums">
                  <Link to={`/opportunities/${o.id}`}>{o.score.toString().padStart(3, ' ')}</Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${STATUS_COLOR[o.status] ?? 'bg-slate-800 text-slate-200'}`}
                  >
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {o.congestionContext?.level ?? 'unknown'}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {o.recommendedNextStep ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(o.updatedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
