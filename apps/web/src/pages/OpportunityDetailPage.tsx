import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type ActivityEntry,
  type DossierDto,
  type HistoryResponse,
  type OpportunityDetail,
} from '../api.js';

export default function OpportunityDetailPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [dossier, setDossier] = useState<DossierDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setActivity([]);
    setHistory(null);
    setDossier(null);
    setError(null);
    Promise.all([api.opportunity(id), api.activityFor(id), api.history(id)])
      .then(([d, a, h]) => {
        setDetail(d);
        setActivity(a);
        setHistory(h);
      })
      .catch((e) => setError((e as Error).message));
    // Dossier may 404 — that's fine, only shown when present.
    api
      .dossier(id)
      .then(setDossier)
      .catch(() => setDossier(null));
  }, [id]);

  if (error)
    return (
      <div>
        <BackLink />
        <div className="text-rose-400 text-sm mt-4">error: {error}</div>
      </div>
    );
  if (!detail) return <div className="text-slate-400 text-sm">loading…</div>;

  const { opportunity: o, company, signals, evidence, decisions } = detail;

  return (
    <div className="space-y-6">
      <BackLink />
      <header className="flex flex-wrap items-start gap-6 border-b border-slate-800 pb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Company</div>
          <div className="text-2xl font-semibold text-slate-100">
            {company?.name ?? '(unknown)'}
          </div>
          <div className="text-sm text-slate-400">
            {[company?.address, company?.city].filter(Boolean).join(', ')}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Score</div>
          <div className="text-3xl font-mono text-radar-accent tabular-nums">{o.score}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Status</div>
          <div className="text-lg text-slate-100">{o.status}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Grid congestion</div>
          <div className="text-lg text-slate-100">
            {o.congestionContext?.level ?? 'unknown'}{' '}
            <span className="text-xs text-slate-500">({o.congestionContext?.source ?? '?'})</span>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Grid neighbor</div>
          <div className="text-sm text-slate-300">
            {o.gridNeighborStatus === 'unknown'
              ? 'not established'
              : o.gridNeighborStatus === 'verified'
                ? 'verified'
                : 'claim needs verification'}
          </div>
        </div>
      </header>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Signals</h2>
        <ul className="space-y-2">
          {signals.map((s) => (
            <li
              key={s.id}
              className="rounded border border-slate-800 bg-radar-panel px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-3">
                <span className="text-radar-accent font-mono text-xs">{s.type}</span>
                <span className="text-xs text-slate-400">
                  impact={s.estimatedImpactClass} · conf={s.confidence.toFixed(2)}
                </span>
              </div>
              <div className="text-slate-100 mt-1">{s.description}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Evidence</h2>
        <ul className="space-y-3">
          {evidence.map((e) => (
            <li key={e.id} className="rounded border border-slate-800 bg-radar-panel px-3 py-2">
              <a
                href={e.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-radar-accent hover:underline"
              >
                {e.sourceTitle}
              </a>
              <div className="text-xs text-slate-500 mt-0.5">
                {e.sourceType} · confidence {e.confidence.toFixed(2)}
                {e.publishedAt && ` · published ${new Date(e.publishedAt).toLocaleDateString()}`}
              </div>
              <blockquote className="text-slate-300 text-sm mt-2 border-l-2 border-slate-700 pl-3 italic">
                {e.excerpt}
              </blockquote>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Decisions</h2>
        <ul className="space-y-2">
          {decisions.map((d) => (
            <li key={d.id} className="rounded border border-slate-800 bg-radar-panel px-3 py-2">
              <div className="text-xs text-slate-500 font-mono">
                {new Date(d.createdAt).toLocaleString()} · policy {d.policyVersion}
              </div>
              <div className="text-slate-100 text-sm mt-0.5">
                <span className="text-radar-accent">{d.decisionType}</span> — {d.reason}
              </div>
            </li>
          ))}
          {decisions.length === 0 && (
            <li className="text-slate-500 text-sm">No decisions recorded yet.</li>
          )}
        </ul>
      </section>

      {history && history.reassessments.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">
            Decision history — reassessments
          </h2>
          <ul className="space-y-2">
            {history.reassessments.map((r, i) => (
              <li
                key={i}
                className="rounded border border-amber-800/40 bg-amber-900/10 px-3 py-2"
              >
                <div className="text-xs text-slate-500 font-mono">
                  {new Date(r.at).toLocaleString()}
                  {r.conflict ? ' · conflict' : ' · corroboration'}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2">
                  <div>
                    <div className="text-xs text-slate-500">Prev score</div>
                    <div className="font-mono">{r.priorScore ?? '?'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">New score</div>
                    <div className="font-mono text-radar-accent">{r.newScore ?? '?'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Prev decision</div>
                    <div className="font-mono">{r.priorDecision ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">New decision</div>
                    <div className="font-mono text-radar-accent">{r.newDecision ?? '?'}</div>
                  </div>
                </div>
                {r.triggeringSourceUrl && (
                  <div className="text-xs text-slate-400 mt-2">
                    Triggered by:{' '}
                    <a
                      className="underline hover:text-radar-accent"
                      href={r.triggeringSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.triggeringSourceUrl}
                    </a>
                  </div>
                )}
                {r.reason && (
                  <div className="text-xs text-slate-300 mt-1">Reason: {r.reason}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dossier && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Dossier</h2>
          <div className="rounded border border-emerald-800/40 bg-emerald-900/10 p-4 space-y-3 text-sm">
            <DossierList
              title="Uncertainty"
              items={dossier.content.uncertainty}
              tone="amber"
            />
            <DossierList
              title="What we do NOT know"
              items={dossier.content.whatWeDoNotKnow}
              tone="rose"
            />
            <DossierList
              title="Missing information"
              items={dossier.content.missingInformation}
              tone="slate"
            />
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">
                Recommended next step
              </div>
              <div className="text-slate-100 mt-0.5">{dossier.content.recommendedNextStep}</div>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Activity</h2>
        <ol className="space-y-1">
          {activity.map((entry) => (
            <li key={entry.id} className="text-sm px-3 py-1.5 border-l border-slate-800">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 font-mono w-32">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
                <span className="text-xs font-mono text-slate-400 uppercase">
                  {entry.eventType.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="text-slate-100">{entry.message}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/opportunities" className="text-sm text-slate-400 hover:text-radar-accent">
      ← Back to opportunities
    </Link>
  );
}

function DossierList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'amber' | 'rose' | 'slate';
}) {
  if (items.length === 0) return null;
  const toneClass =
    tone === 'amber'
      ? 'text-amber-300'
      : tone === 'rose'
        ? 'text-rose-300'
        : 'text-slate-300';
  return (
    <div>
      <div className={`text-xs uppercase tracking-wider ${toneClass}`}>{title}</div>
      <ul className="mt-1 space-y-0.5 list-disc pl-4">
        {items.map((it, i) => (
          <li key={i} className="text-slate-200">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
