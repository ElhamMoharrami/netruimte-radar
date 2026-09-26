import { useEffect, useMemo, useState } from 'react';
import { api, type GridEventDto, type GridOperatorDto } from '../api.js';
import { GridEventCard } from '../components/GridEventCard.js';
import { GridTopologyDisclaimer } from '../components/GridTopologyDisclaimer.js';

type OperatorFilter = 'all' | GridOperatorDto;

const OPERATORS: OperatorFilter[] = ['all', 'liander', 'enexis', 'stedin', 'unknown'];

export default function GridEventsPage() {
  const [events, setEvents] = useState<GridEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operator, setOperator] = useState<OperatorFilter>('all');

  useEffect(() => {
    api
      .gridEvents(200)
      .then(setEvents)
      .catch((e) => setError((e as Error).message));
  }, []);

  const filtered = useMemo(() => {
    if (!events) return [];
    if (operator === 'all') return events;
    return events.filter((e) => e.operator === operator);
  }, [events, operator]);

  const counts = useMemo(() => {
    if (!events) return null;
    const by: Record<string, number> = {};
    for (const e of events) by[e.operator] = (by[e.operator] ?? 0) + 1;
    return { total: events.length, by };
  }, [events]);

  if (error) return <div className="text-rose-400 text-sm">error: {error}</div>;
  if (!events) return <div className="text-slate-400 text-sm">loading…</div>;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-slate-400">Grid updates</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Deduped events from Liander / Enexis / Stedin capacity pages, most recent first.
          </p>
        </div>
        {counts && (
          <div className="ml-auto text-xs text-slate-400">
            <span className="font-mono">{counts.total}</span> events ·{' '}
            {Object.entries(counts.by).map(([op, n], i, arr) => (
              <span key={op}>
                <span className="text-slate-500">{op}</span>{' '}
                <span className="font-mono">{n}</span>
                {i < arr.length - 1 && <span className="text-slate-700"> · </span>}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="flex items-center gap-1 text-xs">
        {OPERATORS.map((op) => (
          <button
            key={op}
            onClick={() => setOperator(op)}
            className={`px-2.5 py-1 rounded border ${
              operator === op
                ? 'border-radar-accent/60 bg-radar-accent/10 text-radar-accent'
                : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {op}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-slate-500 text-sm border border-dashed border-slate-700 rounded p-6 text-center">
          No grid events {operator === 'all' ? 'yet' : `for ${operator}`}. Feed
          <code className="mx-1 text-slate-300 bg-slate-800/50 rounded px-1">
            liander.nl / enexis.nl / stedin.net
          </code>
          URLs into <code className="text-slate-300 bg-slate-800/50 rounded px-1">APIFY_START_URLS</code>{' '}
          then trigger a scan.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((e) => (
            <li key={e.id}>
              <GridEventCard event={e} />
            </li>
          ))}
        </ul>
      )}

      <GridTopologyDisclaimer variant="block" />
    </div>
  );
}
