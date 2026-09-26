import { describe, expect, it } from 'vitest';
import { PolicyEngine, POLICY_VERSION } from './policyEngine.js';
import type { PolicyInput } from './types.js';

const NOW = '2026-03-15T12:00:00.000Z';
const engine = new PolicyEngine({ now: () => NOW });

function baseInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    signalType: 'fleet_electrification',
    estimatedImpactClass: 'high',
    extractionConfidence: 0.8,
    scoring: {
      score: 72,
      components: {
        signalStrength: 30,
        confidence: 16,
        congestion: 20,
        timing: 4,
        corroboration: 0,
        collaboration: 0,
      },
      explanation: [],
      category: 'promising',
    },
    congestion: {
      level: 'severe',
      source: 'demo',
      sourceUrl: null,
      checkedAt: NOW,
      notes: null,
    },
    gridNeighborStatus: 'unknown',
    existingStatus: null,
    ...overrides,
  };
}

describe('PolicyEngine', () => {
  it('stops when confidence < 0.55', () => {
    const d = engine.evaluate(baseInput({ extractionConfidence: 0.4 }));
    expect(d.decision).toBe('stop');
    expect(d.nextStatus).toBe('rejected');
    expect(d.rulesTriggered[0]).toContain('low_confidence');
    expect(d.policyVersion).toBe(POLICY_VERSION);
  });

  it('stops when score < 40', () => {
    const d = engine.evaluate(
      baseInput({
        scoring: {
          score: 12,
          components: {
            signalStrength: 5,
            confidence: 3,
            congestion: 0,
            timing: 4,
            corroboration: 0,
            collaboration: 0,
          },
          explanation: [],
          category: 'reject',
        },
      }),
    );
    expect(d.decision).toBe('stop');
  });

  it('continues investigation when impact is unknown', () => {
    const d = engine.evaluate(baseInput({ estimatedImpactClass: 'unknown' }));
    expect(d.decision).toBe('continue_investigation');
    expect(d.rulesTriggered).toContain('impact_unknown');
  });

  it('continues investigation when score is promising but congestion is null', () => {
    const d = engine.evaluate(baseInput({ congestion: null }));
    expect(d.decision).toBe('continue_investigation');
    expect(d.rulesTriggered).toContain('promising_without_congestion_context');
  });

  it('continues investigation when score is promising but congestion is unknown', () => {
    const d = engine.evaluate(
      baseInput({
        congestion: {
          level: 'unknown',
          source: 'demo',
          sourceUrl: null,
          checkedAt: NOW,
          notes: null,
        },
      }),
    );
    expect(d.decision).toBe('continue_investigation');
  });

  it('creates dossier when score >= 65 AND congestion is severe', () => {
    const d = engine.evaluate(baseInput());
    expect(d.decision).toBe('create_dossier');
    expect(d.nextStatus).toBe('promising');
    expect(d.rulesTriggered).toContain('promising_score_and_severe_congestion');
  });

  it('requests human when promising but low congestion', () => {
    const d = engine.evaluate(
      baseInput({
        congestion: { level: 'low', source: 'demo', sourceUrl: null, checkedAt: NOW, notes: null },
      }),
    );
    expect(d.decision).toBe('request_human');
    expect(d.rulesTriggered).toContain('promising_score_low_congestion');
  });

  it('blocks with request_grid_verification when a shared-grid claim would be needed', () => {
    const d = engine.evaluate(
      baseInput({
        scoring: {
          score: 55,
          components: {
            signalStrength: 30,
            confidence: 10,
            congestion: 12,
            timing: 3,
            corroboration: 0,
            collaboration: 0,
          },
          explanation: [],
          category: 'investigate_more',
        },
        gridNeighborStatus: 'unverified',
        existingStatus: 'promising',
      }),
    );
    expect(d.decision).toBe('request_grid_verification');
    expect(d.nextStatus).toBe('blocked');
    expect(d.rulesTriggered).toContain('would_need_grid_neighbor_verification');
  });

  it('does NOT enable outreach even at maximum score without flag', () => {
    // Even a perfect score returns create_dossier — never a "contact/notify"
    // decision — because outreach is behind allowAutomatedOutreach and the
    // policy engine never emits it directly.
    const d = engine.evaluate(
      baseInput({
        scoring: {
          score: 100,
          components: {
            signalStrength: 30,
            confidence: 20,
            congestion: 20,
            timing: 10,
            corroboration: 10,
            collaboration: 10,
          },
          explanation: [],
          category: 'create_dossier',
        },
      }),
    );
    expect(['create_dossier', 'request_human']).toContain(d.decision);
    expect(d.decision).not.toBe('notify_stakeholder');
  });

  it('mid-band score falls through to continue_investigation', () => {
    const d = engine.evaluate(
      baseInput({
        scoring: {
          score: 50,
          components: {
            signalStrength: 18,
            confidence: 12,
            congestion: 12,
            timing: 4,
            corroboration: 0,
            collaboration: 4,
          },
          explanation: [],
          category: 'investigate_more',
        },
        congestion: {
          level: 'moderate',
          source: 'demo',
          sourceUrl: null,
          checkedAt: NOW,
          notes: null,
        },
      }),
    );
    expect(d.decision).toBe('continue_investigation');
    expect(d.rulesTriggered).toContain('mid_band_investigate');
  });
});
