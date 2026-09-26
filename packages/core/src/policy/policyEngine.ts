import type { PolicyDecision, PolicyFlags, PolicyInput } from './types.js';

export const POLICY_VERSION = 'v0.1.0';

export interface PolicyEngineOptions {
  /** Injected clock for reproducible tests. */
  now?: () => string;
}

/**
 * Deterministic decision policy.
 *
 * Rules evaluated top-down; the FIRST match wins. Every decision returns the
 * full list of rules that matched (for audit), plus a single primary
 * `decision`. Never randomises, never mutates external state.
 *
 * Hard invariants (unbypassable unless the caller sets the corresponding
 * flag AND accepts the ActivityLog cost):
 *
 * - No automated outreach to discovered businesses.
 * - No claiming an energy hub is feasible without human sign-off.
 * - No claiming companies share grid infrastructure without verified
 *   grid-topology data.
 */
export class PolicyEngine {
  private readonly now: () => string;

  constructor(opts: PolicyEngineOptions = {}) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  evaluate(input: PolicyInput): PolicyDecision {
    const flags: PolicyFlags = input.flags ?? {};
    const triggered: string[] = [];

    // 1. Signal is too weak to keep looking at.
    if (input.extractionConfidence < 0.55) {
      triggered.push('low_confidence(<0.55)');
      return this.done('stop', 'Extractor confidence too low', triggered, 'rejected', 'Discard and move on');
    }

    if (input.scoring.score < 40) {
      triggered.push('score_below_reject_threshold(<40)');
      return this.done('stop', 'Score below reject threshold', triggered, 'rejected', 'Discard and move on');
    }

    // 2. Impact still unknown — do not act, gather more evidence.
    if (input.estimatedImpactClass === 'unknown') {
      triggered.push('impact_unknown');
      return this.done(
        'continue_investigation',
        'Signal impact is unknown; gather more evidence before scoring further',
        triggered,
        'investigating',
        'Run more focused source discovery for this company',
      );
    }

    // 3. Score is high enough to matter but grid context is missing.
    if (input.scoring.score >= 65 && (input.congestion === null || input.congestion.level === 'unknown')) {
      triggered.push('promising_without_congestion_context');
      return this.done(
        'continue_investigation',
        'Score is promising but grid congestion context is unknown; check congestion before acting',
        triggered,
        'investigating',
        'Fetch grid congestion for this location',
      );
    }

    // 4. High-confidence dossier candidate.
    if (
      input.scoring.score >= 65 &&
      input.congestion &&
      (input.congestion.level === 'high' || input.congestion.level === 'severe')
    ) {
      triggered.push('promising_score_and_severe_congestion');
      return this.done(
        'create_dossier',
        'Score is promising and grid congestion is high/severe at the site location',
        triggered,
        'promising',
        'Compile preliminary dossier and queue for human review',
      );
    }

    // 5. Promising but low/moderate congestion — surface for a human, no action.
    if (input.scoring.score >= 65) {
      triggered.push('promising_score_low_congestion');
      return this.done(
        'request_human',
        'Score is promising but grid congestion is not severe; human review before acting',
        triggered,
        'promising',
        'Flag for human review — low congestion means no urgency',
      );
    }

    // 6. Blocking rules that require flags to bypass.
    if (!flags.allowSharedGridClaims && wouldNeedGridNeighborClaim(input)) {
      triggered.push('would_need_grid_neighbor_verification');
      return this.done(
        'request_grid_verification',
        'Would need verified grid-neighbor topology; not permitted without allowSharedGridClaims flag',
        triggered,
        'blocked',
        'Confirm topology via authoritative source before making shared-grid claim',
      );
    }

    // 7. Fallback: score in the middle band; investigate further.
    triggered.push('mid_band_investigate');
    return this.done(
      'continue_investigation',
      'Score is above reject threshold but below promising; keep investigating',
      triggered,
      'investigating',
      'Gather at least one corroborating source before re-scoring',
    );
  }

  private done(
    decision: PolicyDecision['decision'],
    reason: string,
    rulesTriggered: string[],
    nextStatus: PolicyDecision['nextStatus'],
    recommendedNextStep: string,
  ): PolicyDecision {
    return {
      decision,
      reason,
      rulesTriggered,
      timestamp: this.now(),
      policyVersion: POLICY_VERSION,
      nextStatus,
      recommendedNextStep,
    };
  }
}

/**
 * Any next step whose write-up would require asserting that this business
 * shares a grid connection with a neighbour would need grid-topology data we
 * don't have. Currently this triggers only when the caller has requested we
 * consider such a claim — placeholder for future logic.
 */
function wouldNeedGridNeighborClaim(input: PolicyInput): boolean {
  // Placeholder — a future dossier template might ask for the claim.
  // For now, we only trigger if the caller *marked* the opportunity as
  // needing verified topology (gridNeighborStatus="unverified" while trying
  // to promote past investigating).
  return (
    input.gridNeighborStatus === 'unverified' &&
    (input.existingStatus === 'promising' || input.existingStatus === 'escalated')
  );
}
