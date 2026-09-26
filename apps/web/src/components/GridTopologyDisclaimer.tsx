/**
 * The single copy of the required standing statement. Shown near every
 * surface that displays grid-update correlation (radar panel, /grid-events
 * list, opportunity detail's "matching recent grid updates" section).
 *
 * Wording is intentionally identical across surfaces so it reads as a
 * platform-level policy note, not per-page prose.
 */
export function GridTopologyDisclaimer({ variant = 'inline' }: { variant?: 'inline' | 'block' }) {
  const base = 'text-xs italic text-amber-200/80';
  if (variant === 'block') {
    return (
      <div className="mt-3 rounded border border-amber-800/40 bg-amber-900/10 px-3 py-2">
        <div className={base}>
          Grid update correlation does not establish grid-neighbor topology.
        </div>
      </div>
    );
  }
  return (
    <div className={base}>
      Grid update correlation does not establish grid-neighbor topology.
    </div>
  );
}
