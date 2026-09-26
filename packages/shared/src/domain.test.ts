import { describe, expect, it } from 'vitest';
import {
  CompanySchema,
  EvidenceSchema,
  OpportunitySchema,
  SignalSchema,
  DecisionSchema,
  ActivityLogSchema,
} from './domain.js';
import { newId, nowIso } from './ids.js';

describe('domain schemas', () => {
  const now = nowIso();

  it('accepts a valid Company', () => {
    const c = {
      id: newId.company(),
      name: 'Van Rijn Logistics',
      website: 'https://vanrijn.example',
      address: 'Havenweg 1',
      city: 'Rotterdam',
      latitude: 51.9,
      longitude: 4.5,
      sector: 'logistics',
      sourceUrls: ['https://vanrijn.example/news/electric-trucks'],
      createdAt: now,
      updatedAt: now,
    };
    expect(() => CompanySchema.parse(c)).not.toThrow();
  });

  it('rejects Evidence with invalid confidence', () => {
    const bad = {
      id: newId.evidence(),
      companyId: newId.company(),
      sourceUrl: 'https://example.com/x',
      sourceTitle: 't',
      sourceType: 'company_news',
      excerpt: '…',
      detectedAt: now,
      publishedAt: null,
      rawTextHash: 'abc',
      confidence: 1.5,
    };
    expect(() => EvidenceSchema.parse(bad)).toThrow();
  });

  it('requires at least one evidence for a Signal', () => {
    const bad = {
      id: newId.signal(),
      companyId: newId.company(),
      evidenceIds: [],
      type: 'fleet_electrification',
      description: 'x',
      estimatedImpactClass: 'high',
      confidence: 0.9,
      detectedAt: now,
    };
    expect(() => SignalSchema.parse(bad)).toThrow();
  });

  it('accepts a valid Opportunity with congestion context', () => {
    const o = {
      id: newId.opportunity(),
      companyId: newId.company(),
      signalIds: [newId.signal()],
      status: 'detected',
      score: 42,
      confidence: 0.7,
      congestionContext: {
        level: 'severe',
        source: 'demo',
        sourceUrl: 'https://example.com/grid',
        checkedAt: now,
        notes: null,
      },
      gridNeighborStatus: 'unknown',
      recommendedNextStep: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(() => OpportunitySchema.parse(o)).not.toThrow();
  });

  it('parses Decision + ActivityLog', () => {
    const d = {
      id: newId.decision(),
      opportunityId: newId.opportunity(),
      decisionType: 'create_dossier',
      reason: 'high score + severe congestion',
      policyVersion: 'v0.1',
      createdAt: now,
    };
    expect(() => DecisionSchema.parse(d)).not.toThrow();

    const a = {
      id: newId.activity(),
      opportunityId: d.opportunityId,
      eventType: 'DECISION_MADE',
      message: 'created dossier',
      metadata: { rulesTriggered: ['high_score+severe_congestion'] },
      createdAt: now,
    };
    expect(() => ActivityLogSchema.parse(a)).not.toThrow();
  });
});
