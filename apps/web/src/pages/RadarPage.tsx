import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type ActivityEntry,
  type GridEventDto,
  type OpportunitySummary,
  type RunResponse,
} from '../api.js';
import { GridEventCard } from '../components/GridEventCard.js';
import { GridTopologyDisclaimer } from '../components/GridTopologyDisclaimer.js';

const EVENT_ICON: Record<string, string> = {
  SCAN_STARTED: '⏱',
  SOURCE_DISCOVERED: '🔍',
  EVIDENCE_EXTRACTED: '📄',
  SIGNAL_DETECTED: '⚡',
  GRID_CONTEXT_CHECKED: '🗺',
  GRID_UPDATE_DETECTED: '⚡',
  GRID_UPDATE_CHANGED: '🔄',
  GRID_UPDATE_UNCHANGED: '💤',
  OPPORTUNITY_SCORED: '📊',
  DECISION_MADE: '🧭',
  DOSSIER_CREATED: '📁',
  ACTION_DISPATCHED: '➡',
  ACTION_BLOCKED: '⛔',
  OPPORTUNITY_REJECTED: '✖',
  HUMAN_REVIEW_REQUESTED: '👤',
  RETRY_FAILED: '⚠',
  SCAN_COMPLETED: '✅',
};

export default function RadarPage() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunitySummary[]>([]);
  const [gridEvents, setGridEvents] = useState<GridEventDto[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [act, opps, ge] = await Promise.all([
        api.recentActivity(80),
        api.opportunities(),
        api.gridEvents(6),
      ]);
      setActivity(act);
      setOpportunities(opps);
      setGridEvents(ge);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function runDemo() {
    setRunning(true);
    setError(null);
    try {
      const r = await api.runDemo();
      setLastRun(r);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const metrics = deriveMetrics(opportunities, activity, lastRun);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="Businesses monitored" value={metrics.businesses} />
        <Metric label="New signals" value={metrics.newSignals} />
        <Metric label="Potential constraints" value={metrics.potentialConstraints} accent />
        <Metric label="Promising opportunities" value={metrics.promising} accent />
        <Metric label="Actions taken" value={metrics.actionsTaken} />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={runDemo}
          disabled={running}
          className="px-3 py-1.5 rounded bg-radar-accent/20 hover:bg-radar-accent/30 border border-radar-accent/40 text-radar-accent text-sm disabled:opacity-50"
        >
          {running ? 'running…' : 'Trigger autonomous scan'}
        </button>
        {lastRun && (
          <span className="text-xs text-slate-400">
            Last run: {lastRun.summary.sourcesDiscovered} sources, {lastRun.summary.opportunitiesCreated}{' '}
            opportunities, {lastRun.summary.actionsDispatched} actions, {lastRun.summary.failures}{' '}
            failures
          </span>
        )}
        {error && <span className="text-xs text-rose-400">error: {error}</span>}
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wider text-slate-400">
            Recent grid updates
          </h2>
          <Link to="/grid-events" className="text-xs text-radar-accent hover:underline">
            view all →
          </Link>
        </div>
        {gridEvents.length === 0 ? (
          <div className="text-slate-500 text-sm border border-dashed border-slate-700 rounded p-4">
            No grid updates yet. Feed{' '}
            <code className="text-slate-300 bg-slate-800/50 rounded px-1">liander.nl</code> /{' '}
            <code className="text-slate-300 bg-slate-800/50 rounded px-1">enexis.nl</code> /{' '}
            <code className="text-slate-300 bg-slate-800/50 rounded px-1">stedin.net</code> URLs
            into <code className="text-slate-300 bg-slate-800/50 rounded px-1">APIFY_START_URLS</code>{' '}
            and trigger a scan.
          </div>
        ) : (
          <ul className="space-y-2">
            {gridEvents.map((ge) => (
              <li key={ge.id}>
                <GridEventCard event={ge} variant="compact" />
              </li>
            ))}
          </ul>
        )}
        <GridTopologyDisclaimer variant="block" />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-3">
          Recent autonomous activity
        </h2>
        {activity.length === 0 ? (
          <div className="text-slate-500 text-sm border border-dashed border-slate-700 rounded p-6 text-center">
            No activity yet. Trigger a scan to see the autonomous loop in action.
          </div>
        ) : (
          <ol className="space-y-1">
            {activity.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-3 px-3 py-2 border-l border-slate-800 hover:bg-slate-900/40 rounded-r"
              >
                <span className="text-xs text-slate-500 font-mono w-20 pt-0.5">
                  {formatTime(entry.createdAt)}
                </span>
                <span className="text-lg leading-5 select-none">
                  {EVENT_ICON[entry.eventType] ?? '·'}
                </span>
                <div className="flex-1">
                  <div className="text-xs font-mono text-slate-400 uppercase">
                    {entry.eventType.replace(/_/g, ' ').toLowerCase()}
                  </div>
                  <div className="text-sm text-slate-100">
                    {entry.opportunityId ? (
                      <Link
                        to={`/opportunities/${entry.opportunityId}`}
                        className="hover:text-radar-accent"
                      >
                        {entry.message}
                      </Link>
                    ) : (
                      entry.message
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        accent ? 'border-radar-accent/30 bg-radar-accent/5' : 'border-slate-800 bg-radar-panel'
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div
        className={`text-3xl font-semibold tabular-nums mt-1 ${
          accent ? 'text-radar-accent' : 'text-slate-100'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function deriveMetrics(
  opportunities: OpportunitySummary[],
  activity: ActivityEntry[],
  lastRun: RunResponse | null,
) {
  const businesses = new Set(opportunities.map((o) => o.companyId)).size;
  const newSignals = activity.filter((a) => a.eventType === 'SIGNAL_DETECTED').length;
  const potentialConstraints = opportunities.filter(
    (o) => o.congestionContext && ['high', 'severe'].includes(o.congestionContext.level),
  ).length;
  const promising = opportunities.filter((o) => o.status === 'promising').length;
  const actionsTaken =
    lastRun?.summary.actionsDispatched ??
    activity.filter((a) => a.eventType === 'ACTION_DISPATCHED').length;
  return { businesses, newSignals, potentialConstraints, promising, actionsTaken };
}
