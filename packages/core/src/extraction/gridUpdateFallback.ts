import type {
  GridUpdateExtraction,
  GridUpdateExtractor,
  GridUpdateExtractorInput,
} from './gridUpdateExtractor.js';

export interface GridUpdateFallbackOptions {
  /** Called when the primary extractor throws; useful for audit logging. */
  onFallback?: (err: unknown, source: GridUpdateExtractorInput['source']) => void;
}

/**
 * Small wrapper mirroring the pattern used for evidence extraction. Runs
 * `primary` first (typically `RuleBasedGridUpdateExtractor`); if it throws,
 * falls back to `secondary` (which may be an AI-driven extractor supplied
 * later — the interface is identical).
 *
 * We prefer rule-based first per the spec ("Use a deterministic/rule-based
 * extractor first. Optionally allow the existing AI provider as a
 * fallback/secondary extractor.").
 */
export class FallbackGridUpdateExtractor implements GridUpdateExtractor {
  readonly name: string;

  constructor(
    private readonly primary: GridUpdateExtractor,
    private readonly secondary: GridUpdateExtractor,
    private readonly opts: GridUpdateFallbackOptions = {},
  ) {
    this.name = `fallback-grid(${primary.name}→${secondary.name})`;
  }

  async extract(input: GridUpdateExtractorInput): Promise<GridUpdateExtraction[]> {
    try {
      return await this.primary.extract(input);
    } catch (err) {
      this.opts.onFallback?.(err, input.source);
      const results = await this.secondary.extract(input);
      // Stamp the extractor name so downstream audit records reflect the
      // fallback route.
      return results.map((r) => ({
        ...r,
        extractor: `${r.extractor} (after ${this.primary.name} failed)`,
      }));
    }
  }
}
