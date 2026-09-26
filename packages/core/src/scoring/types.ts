import type {
  CongestionContext,
  ImpactClass,
  SignalType,
} from '@netruimte/shared';

export type DecisionCategory = 'reject' | 'investigate_more' | 'promising' | 'create_dossier';

export interface ScoreComponents {
  /** 0-30 — impact-class of the signal. */
  signalStrength: number;
  /** 0-20 — extractor confidence, scaled. */
  confidence: number;
  /** 0-20 — grid congestion at the site's postcode/city. */
  congestion: number;
  /** 0-10 — recency of the source. */
  timing: number;
  /** 0-10 — number of corroborating sources. */
  corroboration: number;
  /** 0-10 — local collaboration context (industrial park etc.). */
  collaboration: number;
}

export interface ScoringInput {
  signalType: SignalType;
  estimatedImpactClass: ImpactClass;
  /** Extractor-reported confidence, [0, 1]. */
  extractionConfidence: number;
  /** Publication date of the underlying source, ISO. Null if unknown. */
  sourcePublishedAt: string | null;
  /** Number of independent sources supporting this signal (>=1). */
  corroboratingSources: number;
  /** Set true when the address is on a known industrial park (demo data can flag this). */
  onIndustrialPark: boolean;
  /** Grid context; null when we have not yet checked. */
  congestion: CongestionContext | null;
  /** ISO date used as "now" — injected for reproducible tests. */
  now?: string;
}

export interface ScoringResult {
  score: number;
  components: ScoreComponents;
  explanation: string[];
  category: DecisionCategory;
}
