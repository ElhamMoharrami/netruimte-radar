import type { CongestionLevel, ImpactClass } from '@netruimte/shared';
import type {
  DecisionCategory,
  ScoreComponents,
  ScoringInput,
  ScoringResult,
} from './types.js';

const IMPACT_POINTS: Record<ImpactClass, number> = {
  high: 30,
  medium: 18,
  low: 5,
  unknown: 0,
};

const CONGESTION_POINTS: Record<CongestionLevel, number> = {
  severe: 20,
  high: 20,
  moderate: 12,
  low: 3,
  unknown: 0,
};

/**
 * Deterministic 0-100 scorer for grid-related opportunities.
 *
 * Design intent: this is the ONE place where policy-critical numbers live. AI
 * may produce evidence, but the scoring math is code — so a demo reviewer can
 * trace every point back to a source or a threshold. Never randomise, never
 * consult an external service beyond what's already passed in.
 */
export class OpportunityScoringService {
  score(input: ScoringInput): ScoringResult {
    const components = this.componentsFor(input);
    const score = Math.round(
      Object.values(components).reduce((a, b) => a + b, 0),
    );
    const clamped = Math.max(0, Math.min(100, score));
    return {
      score: clamped,
      components,
      explanation: this.explain(input, components),
      category: this.categorize(clamped),
    };
  }

  private componentsFor(input: ScoringInput): ScoreComponents {
    return {
      signalStrength: IMPACT_POINTS[input.estimatedImpactClass],
      confidence: Math.round(clamp01(input.extractionConfidence) * 20),
      congestion: input.congestion ? CONGESTION_POINTS[input.congestion.level] : 0,
      timing: this.timingPoints(input.sourcePublishedAt, input.now),
      corroboration: this.corroborationPoints(input.corroboratingSources),
      collaboration: input.onIndustrialPark ? 10 : 0,
    };
  }

  private timingPoints(publishedAt: string | null, nowIso?: string): number {
    if (!publishedAt) return 3; // no date → assume moderate
    const now = nowIso ? new Date(nowIso).getTime() : Date.now();
    const ageDays = (now - new Date(publishedAt).getTime()) / 86_400_000;
    if (ageDays <= 30) return 10;
    if (ageDays <= 90) return 7;
    if (ageDays <= 365) return 4;
    return 1;
  }

  private corroborationPoints(count: number): number {
    if (count <= 1) return 0;
    if (count === 2) return 4;
    if (count === 3) return 7;
    return 10;
  }

  private categorize(score: number): DecisionCategory {
    if (score < 40) return 'reject';
    if (score < 65) return 'investigate_more';
    if (score < 80) return 'promising';
    return 'create_dossier';
  }

  private explain(input: ScoringInput, c: ScoreComponents): string[] {
    const out: string[] = [];
    out.push(
      `signal_strength=${c.signalStrength} (impact=${input.estimatedImpactClass}, signalType=${input.signalType})`,
    );
    out.push(`confidence=${c.confidence} (extractor=${input.extractionConfidence.toFixed(2)})`);
    if (input.congestion) {
      out.push(
        `congestion=${c.congestion} (level=${input.congestion.level}, source=${input.congestion.source})`,
      );
    } else {
      out.push('congestion=0 (no grid context yet)');
    }
    out.push(`timing=${c.timing} (publishedAt=${input.sourcePublishedAt ?? 'unknown'})`);
    out.push(`corroboration=${c.corroboration} (sources=${input.corroboratingSources})`);
    out.push(`collaboration=${c.collaboration} (industrialPark=${input.onIndustrialPark})`);
    return out;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
