import type { EvidenceExtractor, ExtractionInput, ExtractionResult } from './types.js';

export interface FallbackOptions {
  /** Called whenever the primary extractor throws — good place to log. */
  onFallback?: (err: unknown, source: ExtractionInput['source']) => void;
}

/**
 * Wraps a primary extractor with a fallback. If the primary throws (network
 * failure, missing key, provider outage), we fall back to the secondary and
 * mark the extractor name so downstream observability can see it.
 *
 * The core pipeline uses this so a missing/broken AI provider degrades to the
 * rule-based extractor rather than blocking the autonomous run.
 */
export class FallbackEvidenceExtractor implements EvidenceExtractor {
  readonly name: string;

  constructor(
    private readonly primary: EvidenceExtractor,
    private readonly fallback: EvidenceExtractor,
    private readonly opts: FallbackOptions = {},
  ) {
    this.name = `fallback(${primary.name}→${fallback.name})`;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    try {
      return await this.primary.extract(input);
    } catch (err) {
      this.opts.onFallback?.(err, input.source);
      const result = await this.fallback.extract(input);
      return { ...result, extractor: `${this.fallback.name} (after ${this.primary.name} failed)` };
    }
  }
}
