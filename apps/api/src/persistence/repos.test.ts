import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@netruimte/shared';
import { openDb, type Db } from './db.js';
import { createRepositories } from './index.js';

describe('sqlite repositories', () => {
  let db: Db;
  let repos: ReturnType<typeof createRepositories>;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repos = createRepositories(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upserts and reads a company', async () => {
    const now = nowIso();
    const company = {
      id: newId.company(),
      name: 'Van Rijn Logistics',
      website: 'https://vanrijn.example',
      address: 'Havenweg 1',
      city: 'Rotterdam',
      latitude: 51.9,
      longitude: 4.5,
      sector: 'logistics',
      sourceUrls: ['https://vanrijn.example/news'],
      createdAt: now,
      updatedAt: now,
    };
    await repos.companies.upsert(company);
    const found = await repos.companies.findByName('Van Rijn Logistics');
    expect(found?.id).toBe(company.id);
    expect(found?.sourceUrls).toEqual(['https://vanrijn.example/news']);
  });

  it('stores evidence and lists by company', async () => {
    const now = nowIso();
    const companyId = newId.company();
    await repos.companies.upsert({
      id: companyId,
      name: 'X',
      website: null,
      address: null,
      city: null,
      latitude: null,
      longitude: null,
      sector: null,
      sourceUrls: [],
      createdAt: now,
      updatedAt: now,
    });
    await repos.evidence.insert({
      id: newId.evidence(),
      companyId,
      sourceUrl: 'https://x.example/a',
      sourceTitle: 'a',
      sourceType: 'company_news',
      excerpt: 'e',
      detectedAt: now,
      publishedAt: null,
      rawTextHash: 'h',
      confidence: 0.8,
    });
    const list = await repos.evidence.listByCompany(companyId);
    expect(list).toHaveLength(1);
  });

  it('persists opportunity round-trip including congestion context', async () => {
    const now = nowIso();
    const companyId = newId.company();
    await repos.companies.upsert({
      id: companyId,
      name: 'Y',
      website: null,
      address: null,
      city: null,
      latitude: null,
      longitude: null,
      sector: null,
      sourceUrls: [],
      createdAt: now,
      updatedAt: now,
    });
    const signalId = newId.signal();
    await repos.signals.insert({
      id: signalId,
      companyId,
      evidenceIds: ['x'],
      type: 'fleet_electrification',
      description: 'd',
      estimatedImpactClass: 'high',
      confidence: 0.9,
      detectedAt: now,
    });
    const opp = {
      id: newId.opportunity(),
      companyId,
      signalIds: [signalId],
      status: 'detected' as const,
      score: 72,
      confidence: 0.8,
      congestionContext: {
        level: 'severe' as const,
        source: 'demo',
        sourceUrl: 'https://grid.example/x',
        checkedAt: now,
        notes: null,
      },
      gridNeighborStatus: 'unknown' as const,
      recommendedNextStep: null,
      createdAt: now,
      updatedAt: now,
    };
    await repos.opportunities.insert(opp);
    const found = await repos.opportunities.findById(opp.id);
    expect(found?.congestionContext?.level).toBe('severe');
    expect(found?.score).toBe(72);
  });

  it('activity log is append-only and returns chronological order', async () => {
    const opportunityId = newId.opportunity();
    for (const [ix, evt] of ['SCAN_STARTED', 'SIGNAL_DETECTED', 'DECISION_MADE'].entries()) {
      await repos.activity.append({
        id: newId.activity(),
        opportunityId,
        eventType: evt as never,
        message: `#${ix}`,
        metadata: { ix },
        createdAt: new Date(Date.UTC(2026, 0, 1, 12, 0, ix)).toISOString(),
      });
    }
    const list = await repos.activity.listByOpportunity(opportunityId);
    expect(list.map((l) => l.eventType)).toEqual([
      'SCAN_STARTED',
      'SIGNAL_DETECTED',
      'DECISION_MADE',
    ]);
  });
});
