/**
 * Cross-instance persistence tests for the libSQL/Turso adapter.
 *
 * Uses a `file:` URL against a temp file so the test exercises the *libsql*
 * client (not node:sqlite) end-to-end. Each case constructs TWO independent
 * clients against the same file, writes with the first, closes it, then
 * reads with the second — proving durability across what would be, in
 * production, two separate Netlify Function invocations.
 *
 * This is the regression guard for the reason we introduced Turso: in-memory
 * sqlite inside a Lambda cannot survive a cold start, and Netlify functions
 * routinely land on cold containers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeGridEventContentHash,
} from '@netruimte/core';
import { newId, nowIso } from '@netruimte/shared';
import { createRepositories, openLibsqlDb, type Db } from './index.js';

describe('libsql adapter — cross-instance persistence', () => {
  let tmpDir: string;
  let dbUrl: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'netruimte-libsql-'));
    // libsql accepts a `file:` URL; this bypasses Turso's remote endpoint
    // and exercises the same client code path against local storage.
    dbUrl = `file:${join(tmpDir, 'test.db')}`;
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function withClient<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const db = await openLibsqlDb({ url: dbUrl });
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  }

  it('grid events persist across two client instances', async () => {
    const event = {
      id: newId.gridEvent(),
      operator: 'liander' as const,
      eventType: 'new_bottleneck' as const,
      regions: ['Noord-Holland'],
      municipalities: ['Amsterdam'],
      stations: ['Krommenie'],
      direction: 'consumption' as const,
      summary: 'Liander: new_bottleneck — Amsterdam',
      evidenceExcerpt: 'Voor afname is er een nieuw knelpunt in Amsterdam.',
      sourceUrl: 'https://www.liander.nl/nieuws/x',
      publishedAt: '2026-02-10T10:00:00.000Z',
      detectedAt: nowIso(),
      confidence: 0.9,
      contentHash: 'placeholder',
    };
    event.contentHash = computeGridEventContentHash(event);

    await withClient(async (db) => {
      const repos = createRepositories(db);
      await repos.gridEvents.insert(event);
    });

    // Fresh client — same URL — must see the row. In production this
    // simulates a subsequent Netlify Function cold start reading what the
    // previous invocation wrote.
    const found = await withClient(async (db) => {
      const repos = createRepositories(db);
      return repos.gridEvents.findById(event.id);
    });
    expect(found).not.toBeNull();
    expect(found!.operator).toBe('liander');
    expect(found!.municipalities).toEqual(['Amsterdam']);
    expect(found!.contentHash).toBe(event.contentHash);
  });

  it('run history persists across two client instances', async () => {
    const run = {
      id: `run_${Math.random().toString(36).slice(2, 10)}`,
      trigger: 'scheduled' as const,
      sourceProvider: 'apify',
      extractor: 'rule-based',
      automationProvider: 'n8n',
      startedAt: '2026-02-10T10:00:00.000Z',
      finishedAt: '2026-02-10T10:00:30.000Z',
      sourcesDiscovered: 3,
      companiesProcessed: 0,
      signalsDetected: 0,
      opportunitiesCreated: 0,
      actionsDispatched: 0,
      actionsBlocked: 0,
      failures: 0,
      incomplete: false,
      decisions: {},
      notes: 'first prod run',
    };

    await withClient(async (db) => {
      const repos = createRepositories(db);
      await repos.runs.insert(run);
    });

    const rows = await withClient(async (db) => {
      const repos = createRepositories(db);
      return repos.runs.list(10);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(run.id);
    expect(rows[0]!.sourcesDiscovered).toBe(3);
    expect(rows[0]!.incomplete).toBe(false);
  });

  it('activity log persists across two client instances', async () => {
    const entry = {
      id: newId.activity(),
      opportunityId: null,
      eventType: 'GRID_UPDATE_DETECTED' as const,
      message: '[grid] Liander — new_bottleneck in Amsterdam',
      metadata: { operator: 'liander', municipalities: ['Amsterdam'] },
      createdAt: nowIso(),
    };

    await withClient(async (db) => {
      const repos = createRepositories(db);
      await repos.activity.append(entry);
    });

    const recent = await withClient(async (db) => {
      const repos = createRepositories(db);
      return repos.activity.listRecent(50);
    });
    expect(recent).toHaveLength(1);
    expect(recent[0]!.id).toBe(entry.id);
    expect(recent[0]!.eventType).toBe('GRID_UPDATE_DETECTED');
    expect(recent[0]!.metadata).toEqual({ operator: 'liander', municipalities: ['Amsterdam'] });
  });

  it('opportunities + companies persist across two client instances', async () => {
    const company = {
      id: newId.company(),
      name: 'Acme Cold Storage',
      website: 'https://acme.example',
      address: null,
      city: 'Amsterdam',
      latitude: 52.37,
      longitude: 4.9,
      sector: 'logistics',
      sourceUrls: ['https://acme.example/news/1'],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const opportunity = {
      id: newId.opportunity(),
      companyId: company.id,
      signalIds: [newId.signal()],
      status: 'promising' as const,
      score: 72,
      confidence: 0.7,
      congestionContext: {
        level: 'high' as const,
        source: 'demo',
        sourceUrl: null,
        checkedAt: nowIso(),
        notes: null,
        gemeente: 'Amsterdam',
        provincie: 'Noord-Holland',
      },
      gridNeighborStatus: 'unknown' as const,
      recommendedNextStep: 'schedule intake',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await withClient(async (db) => {
      const repos = createRepositories(db);
      await repos.companies.upsert(company);
      await repos.opportunities.insert(opportunity);
    });

    const { listed, byId } = await withClient(async (db) => {
      const repos = createRepositories(db);
      return {
        listed: await repos.opportunities.list(),
        byId: await repos.opportunities.findById(opportunity.id),
      };
    });
    expect(listed).toHaveLength(1);
    expect(byId).not.toBeNull();
    expect(byId!.companyId).toBe(company.id);
    expect(byId!.congestionContext?.gemeente).toBe('Amsterdam');
    expect(byId!.score).toBe(72);
  });
});
