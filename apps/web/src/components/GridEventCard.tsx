import type { GridEventDto } from '../api.js';
import { ProvenanceBadge, type ProvenanceKind } from './ProvenanceBadge.js';

/**
 * Compact grid-event card. Reused on:
 *   - /grid-events              (full list)
 *   - /radar                    (recent panel — variant="compact")
 *   - /opportunities/:id        (matching recent grid updates — variant="compact")
 *
 * Provenance badges are per-field:
 *   - Source URL              → PUBLIC SOURCE (always — the record carries a URL)
 *   - operator "unknown"      → UNKNOWN badge on the operator chip
 *   - eventType "other"       → INFERRED badge (no exact keyword matched)
 *   - direction "unknown"     → UNKNOWN badge on the direction chip
 *   - confidence < 0.7        → INFERRED badge next to the summary line
 */
export function GridEventCard({
  event,
  variant = 'default',
}: {
  event: GridEventDto;
  variant?: 'default' | 'compact';
}) {
  const compact = variant === 'compact';
  const opBadge: ProvenanceKind | null = event.operator === 'unknown' ? 'unknown' : null;
  const dirBadge: ProvenanceKind | null = event.direction === 'unknown' ? 'unknown' : null;
  const inferredBadge: ProvenanceKind | null =
    event.eventType === 'other' || event.confidence < 0.7 ? 'inferred' : null;

  return (
    <article
      className={`rounded-lg border border-slate-800 bg-radar-panel/60 ${compact ? 'p-3' : 'p-4'} space-y-2`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-xs font-mono uppercase ${
            event.operator === 'unknown' ? 'text-slate-400' : 'text-radar-accent'
          }`}
        >
          {event.operator}
        </span>
        {opBadge && <ProvenanceBadge kind={opBadge} />}
        <span className="inline-flex items-center rounded border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-xs font-mono text-slate-200">
          {event.eventType.replace(/_/g, ' ')}
        </span>
        <span
          className={`inline-flex items-center rounded border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-xs font-mono ${
            event.direction === 'unknown' ? 'text-slate-400' : 'text-slate-200'
          }`}
        >
          {event.direction.replace('_', '-')}
        </span>
        {dirBadge && <ProvenanceBadge kind={dirBadge} />}
        {inferredBadge && (
          <ProvenanceBadge
            kind={inferredBadge}
            title="Extracted by rule-based patterns; confirm against the source."
          />
        )}
        <div className="ml-auto text-[11px] font-mono text-slate-500 tabular-nums">
          conf {event.confidence.toFixed(2)}
        </div>
      </header>

      <div className="text-sm text-slate-100">{event.summary}</div>

      {(event.regions.length > 0 || event.municipalities.length > 0 || event.stations.length > 0) && (
        <div className="text-xs text-slate-300 space-x-2">
          {event.municipalities.length > 0 && (
            <span>
              <span className="text-slate-500">municipality: </span>
              {event.municipalities.join(', ')}
            </span>
          )}
          {event.regions.length > 0 && (
            <span>
              <span className="text-slate-500">region: </span>
              {event.regions.join(', ')}
            </span>
          )}
          {event.stations.length > 0 && (
            <span>
              <span className="text-slate-500">station: </span>
              {event.stations.join(', ')}
            </span>
          )}
        </div>
      )}

      {!compact && event.evidenceExcerpt && (
        <blockquote className="border-l-2 border-slate-700 pl-3 text-sm italic text-slate-300">
          “{event.evidenceExcerpt}”
        </blockquote>
      )}

      <footer className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="font-mono tabular-nums">
          detected {formatDate(event.detectedAt)}
          {event.publishedAt && (
            <span className="text-slate-600"> · published {formatDate(event.publishedAt)}</span>
          )}
        </span>
        <a
          href={event.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 truncate max-w-[420px] text-radar-accent hover:underline"
          title={event.sourceUrl}
        >
          <ProvenanceBadge kind="public_source" />
          <span className="truncate">{shortenUrl(event.sourceUrl)}</span>
        </a>
      </footer>
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname.length > 40 ? url.pathname.slice(0, 40) + '…' : url.pathname;
    return url.host + path;
  } catch {
    return u;
  }
}
