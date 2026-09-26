import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  DisabledAutomationProvider,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  type DiscoveredSource,
  type SourceDiscoveryProvider,
} from '@netruimte/core';
import { openDb, createRepositories, type Db } from './persistence/index.js';

/**
 * Confirms the router in AutonomousRunService.processSource() splits sources
 * by sourceClass:
 *   business_signal → existing EvidenceExtractor pipeline
 *   grid_update     → new GridUpdateExtractor pipeline, no company/opportunity
 *
 * The GridContextProvider is left completely untouched — verified by
 * inspecting activity log types and opportunity/company counts.
 */

function stubProvider(name: string, docs: DiscoveredSource[]): SourceDiscoveryProvider {
  return {
    name,
    async discover() {
      return docs;
    },
  };
}

function buildDeps(db: Db, provider: SourceDiscoveryProvider) {
  const repos = createRepositories(db);
  return new AutonomousRunService({
    repos,
    sources: provider,
    extractor: new RuleBasedEvidenceExtractor(),
    grid: new DemoGridContextProvider(),
    scoring: new OpportunityScoringService(),
    policy: new PolicyEngine(),
    automation: new DisabledAutomationProvider(),
  });
}

describe('source-class routing in the autonomous run engine', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('routes a business_signal source through the evidence pipeline', async () => {
    const provider = stubProvider('test', [
      {
        url: 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026',
        title: 'Van Rijn Logistics vernieuwt vloot met 35 elektrische trucks',
        rawText:
          'Van Rijn Logistics BV kondigt vandaag in Rotterdam aan dat het bedrijf 35 elektrische vrachtwagens in gebruik neemt.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceType: 'company_news',
        sourceClass: 'business_signal',
        provider: 'test',
      },
    ]);
    const service = buildDeps(db, provider);
    const summary = await service.run({ trigger: 'manual' });

    expect(summary.opportunitiesCreated).toBe(1);
    expect(summary.gridUpdatesDetected).toBe(0);

    const repos = createRepositories(db);
    const activity = await repos.activity.listRecent(200);
    const types = activity.map((a) => a.eventType);
    expect(types).toContain('EVIDENCE_EXTRACTED');
    expect(types).toContain('SIGNAL_DETECTED');
    expect(types).not.toContain('GRID_UPDATE_DETECTED');
  });

  it('routes a grid_update source through the GridUpdateExtractor and NEVER creates a company/opportunity', async () => {
    const provider = stubProvider('test', [
      {
        url: 'https://www.liander.nl/nieuws/capaciteit-noord-holland-2026',
        title: 'Update capaciteit Noord-Holland',
        rawText:
          'Liander heeft de capaciteitskaart voor Noord-Holland bijgewerkt. Voor afname geldt een wachtlijst in Amsterdam. De teruglevercapaciteit blijft ongewijzigd.',
        discoveredAt: new Date().toISOString(),
        publishedAt: '2026-02-10T10:00:00.000Z',
        sourceClass: 'grid_update',
        provider: 'test',
      },
    ]);
    const service = buildDeps(db, provider);
    const summary = await service.run({ trigger: 'manual' });

    expect(summary.gridUpdatesDetected).toBe(1);
    expect(summary.opportunitiesCreated).toBe(0);
    expect(summary.companiesProcessed).toBe(0);
    expect(summary.signalsDetected).toBe(0);

    const repos = createRepositories(db);
    const companies = await repos.companies.list();
    expect(companies).toHaveLength(0);
    const opportunities = await repos.opportunities.list();
    expect(opportunities).toHaveLength(0);

    const activity = await repos.activity.listRecent(200);
    const gridEvents = activity.filter((a) => a.eventType === 'GRID_UPDATE_DETECTED');
    expect(gridEvents).toHaveLength(1);
    const meta = gridEvents[0]!.metadata as Record<string, unknown>;
    expect(meta.operator).toBe('liander');
    expect(meta.direction).toBe('both');
    expect(meta.regions).toEqual(expect.arrayContaining(['Noord-Holland']));
    expect(meta.municipalities).toEqual(expect.arrayContaining(['Amsterdam']));
    expect(meta.publishedAt).toBe('2026-02-10T10:00:00.000Z');
    // New fields from the enriched schema:
    expect(meta.eventType).toBeDefined();
    expect(meta.stations).toBeDefined();
    expect(meta.confidence).toBeGreaterThan(0);
  });

  it('routes mixed sources in one run, preserving totals per class', async () => {
    const provider = stubProvider('test', [
      {
        url: 'https://vanrijn-logistics.example/x',
        title: 'Van Rijn',
        rawText: 'Van Rijn Logistics BV zet elektrische vrachtwagens in te Rotterdam.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'business_signal',
        provider: 'test',
      },
      {
        url: 'https://www.stedin.net/zakelijk/capaciteit',
        title: 'Stedin capaciteit',
        rawText: 'Stedin meldt wachtlijst voor afname in Utrecht en Rotterdam.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        sourceClass: 'grid_update',
        provider: 'test',
      },
    ]);
    const service = buildDeps(db, provider);
    const summary = await service.run({ trigger: 'manual' });

    expect(summary.sourcesDiscovered).toBe(2);
    expect(summary.opportunitiesCreated).toBe(1);
    expect(summary.gridUpdatesDetected).toBe(1);
  });

  it('treats a source with no sourceClass as business_signal (back-compat)', async () => {
    const provider = stubProvider('test', [
      {
        url: 'https://vanrijn-logistics.example/y',
        title: 'Van Rijn',
        rawText: 'Van Rijn Logistics BV zet elektrische vrachtwagens in te Rotterdam.',
        discoveredAt: new Date().toISOString(),
        publishedAt: null,
        // sourceClass intentionally omitted
        provider: 'test',
      },
    ]);
    const service = buildDeps(db, provider);
    const summary = await service.run({ trigger: 'manual' });

    expect(summary.opportunitiesCreated).toBe(1);
    expect(summary.gridUpdatesDetected).toBe(0);
  });
});
