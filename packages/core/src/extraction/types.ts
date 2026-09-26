import type { ImpactClass, SignalType, SourceType } from '@netruimte/shared';
import type { DiscoveredSource } from '../sources/types.js';

export interface ExtractionInput {
  source: DiscoveredSource;
}

export interface ExtractedFact {
  key: string;
  value: string;
  /** Verbatim substring from the source that supports this fact. */
  quote: string;
  inferred: boolean;
}

export interface ExtractionResult {
  /** Detected company name — null if the extractor is not confident. */
  companyName: string | null;
  location: {
    city: string | null;
    address: string | null;
  };
  signalType: SignalType;
  summary: string;
  evidenceExcerpt: string;
  /** [0, 1] — extractor's overall confidence in this extraction. */
  confidence: number;
  estimatedImpactClass: ImpactClass;
  /** Suggested `Evidence.sourceType`; defaults to source hint if provided. */
  sourceType: SourceType;
  /** Structured facts; each carries its supporting quote for auditability. */
  extractedFacts: ExtractedFact[];
  /** Name of the extractor that produced this result — for observability. */
  extractor: string;
}

export interface EvidenceExtractor {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
