/**
 * Small pill communicating where a piece of information came from.
 *
 *   PUBLIC SOURCE — verifiable via a URL the operator can click through.
 *   INFERRED      — computed by an extractor (rule-based or AI); NOT a
 *                   verbatim quote from the source.
 *   UNKNOWN       — the pipeline was not able to establish this field.
 */
export type ProvenanceKind = 'public_source' | 'inferred' | 'unknown';

const LABEL: Record<ProvenanceKind, string> = {
  public_source: 'PUBLIC SOURCE',
  inferred: 'INFERRED',
  unknown: 'UNKNOWN',
};

const TONE: Record<ProvenanceKind, string> = {
  public_source: 'bg-emerald-900/40 text-emerald-200 border-emerald-800/60',
  inferred: 'bg-amber-900/30 text-amber-200 border-amber-800/60',
  unknown: 'bg-slate-800 text-slate-300 border-slate-700',
};

export function ProvenanceBadge({
  kind,
  className = '',
  title,
}: {
  kind: ProvenanceKind;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title ?? LABEL[kind]}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${TONE[kind]} ${className}`}
    >
      {LABEL[kind]}
    </span>
  );
}
