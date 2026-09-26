import type { SourceClass } from './sourceClass.js';

/**
 * A single document that a discovery provider surfaces from a public source.
 * The pipeline treats this as the raw input — it does NOT know at this stage
 * which company or signal it belongs to.
 */
export interface DiscoveredSource {
  /** Absolute, canonical source URL. */
  url: string;
  /** Best-effort human-readable title (page <title>, article headline, …). */
  title: string;
  /** Raw text or HTML. The pipeline strips HTML before analysis. */
  rawText: string;
  /** ISO date when the source was fetched. */
  discoveredAt: string;
  /** ISO date the source itself was published, if known. */
  publishedAt: string | null;
  /** Provider-supplied hint, useful for downstream classification. */
  sourceType?:
    | 'company_news'
    | 'sustainability_page'
    | 'vacancy'
    | 'planning_notice'
    | 'industrial_park'
    | 'news_article'
    | 'other';
  /**
   * Which pipeline this source is routed into. Optional so pre-existing
   * providers/tests that don't set it stay valid — the run engine treats
   * missing/undefined as `business_signal`.
   */
  sourceClass?: SourceClass;
  /** Origin provider name, for observability. */
  provider: string;
}

export interface SourceDiscoveryProvider {
  /** Provider name for logs and metrics. */
  readonly name: string;
  /** Returns the next batch of documents to feed into the pipeline. */
  discover(): Promise<DiscoveredSource[]>;
}
