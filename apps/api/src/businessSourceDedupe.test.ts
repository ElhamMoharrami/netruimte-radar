/**
 * Business-source deduplication contract.
 *
 * Regression guard for the production bug in which unchanged business pages
 * were being re-crawled every scan and duplicating evidence, which in turn
 * inflated corroboration and swung opportunity scores. The pre-extraction
 * guard in AutonomousRunService.processSource must:
 *
 *   1. Skip the extractor entirely when `(canonicalURL, contentHash)` has
 *      already produced Evidence — log BUSINESS_SOURCE_UNCHANGED.
 *   2. Run the extractor when the URL exists but the hash differs — log
 *      BUSINESS_SOURCE_CHANGED.
 *   3. Never dedupe two genuinely different URLs, even when they discuss
 *      the same company (that's real corroboration).
 *   4. Leave grid_update dedupe behaviour untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AutonomousRunService,
  DemoGridContextProvider,
  DisabledAutomationProvider,
  OpportunityScoringService,
  PolicyEngine,
  RuleBasedEvidenceExtractor,
  computeBusinessSourceContentHash,
  type DiscoveredSource,
  type SourceDiscoveryProvider,
} from '@netruimte/core';
import { openDb, createRepositories, type Db } from './persistence/index.js';

function stubProvider(name: string, docs: DiscoveredSource[]): SourceDiscoveryProvider {
  return {
    name,
    async discover() {
      return docs;
    },
  };
}

function buildService(db: Db, provider: SourceDiscoveryProvider) {
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

// A Van Rijn Logistics article that the rule-based extractor recognises as
// a fleet-electrification signal. Same body used across both scans to prove
// "unchanged" behaviour.
const VAN_RIJN_TEXT =
  'Van Rijn Logistics BV kondigt vandaag in Rotterdam aan dat het bedrijf 35 elektrische vrachtwagens in gebruik neemt. Daarmee vervangt Van Rijn 40% van zijn huidige dieselvloot.';

function vanRijnSource(url: string, text: string = VAN_RIJN_TEXT): DiscoveredSource {
  return {
    url,
    title: 'Van Rijn Logistics vernieuwt vloot',
    rawText: text,
    discoveredAt: new Date().toISOString(),
    publishedAt: null,
    sourceType: 'company_news',
    sourceClass: 'business_signal',
    provider: 'test',
  };
}

describe('business-source dedupe — pre-extraction guard', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('same URL + same content on the second scan → BUSINESS_SOURCE_UNCHANGED, exactly one Evidence row', async () => {
    const url = 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026';
    const provider = stubProvider('t', [vanRijnSource(url)]);

    // First scan — normal ingestion.
    await buildService(db, provider).run({ trigger: 'manual' });
    // Second scan — identical URL + text.
    await buildService(db, provider).run({ trigger: 'manual' });

    const repos = createRepositories(db);
    const companies = await repos.companies.list();
    expect(companies).toHaveLength(1);
    const evidence = await repos.evidence.listByCompany(companies[0]!.id);
    expect(evidence, 'exactly one Evidence row across two identical scans').toHaveLength(1);

    const activity = await repos.activity.listRecent(500);
    const unchanged = activity.filter((a) => a.eventType === 'BUSINESS_SOURCE_UNCHANGED');
    const extracted = activity.filter((a) => a.eventType === 'EVIDENCE_EXTRACTED');
    expect(unchanged).toHaveLength(1);
    expect(extracted, 'extractor runs only on scan #1').toHaveLength(1);
    // Metadata identifies the source class + carries the content hash so ops
    // can correlate with the persisted Evidence row.
    expect((unchanged[0]!.metadata as { sourceClass?: string }).sourceClass).toBe('business_signal');
    expect((unchanged[0]!.metadata as { contentHash?: string }).contentHash).toBe(
      computeBusinessSourceContentHash(VAN_RIJN_TEXT),
    );
  });

  it('same URL + changed content → BUSINESS_SOURCE_CHANGED and second Evidence row', async () => {
    const url = 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026';

    // Scan #1: original text.
    await buildService(db, stubProvider('t', [vanRijnSource(url)])).run({ trigger: 'manual' });

    // Scan #2: same URL, different text (still a valid business signal so the
    // pipeline actually persists Evidence — otherwise we'd be testing dedupe
    // vs. an extraction rejection instead of dedupe vs. an accepted signal).
    const updatedText =
      'Van Rijn Logistics BV heeft in Rotterdam laten weten dat het bedrijf de omschakeling versnelt: 60 elektrische vrachtwagens dit jaar in gebruik nemen.';
    await buildService(db, stubProvider('t', [vanRijnSource(url, updatedText)])).run({
      trigger: 'manual',
    });

    const repos = createRepositories(db);
    const companies = await repos.companies.list();
    expect(companies).toHaveLength(1);
    const evidence = await repos.evidence.listByCompany(companies[0]!.id);
    expect(evidence, 'both versions retained as separate Evidence rows').toHaveLength(2);

    const activity = await repos.activity.listRecent(500);
    const types = activity.map((a) => a.eventType);
    expect(types).toContain('BUSINESS_SOURCE_CHANGED');
    expect(types).not.toContain('BUSINESS_SOURCE_UNCHANGED');
    // Extractor ran BOTH scans since the content differed.
    expect(activity.filter((a) => a.eventType === 'EVIDENCE_EXTRACTED')).toHaveLength(2);
    const changed = activity.filter((a) => a.eventType === 'BUSINESS_SOURCE_CHANGED')[0]!;
    expect((changed.metadata as { priorHash?: string; contentHash?: string }).priorHash).toBe(
      computeBusinessSourceContentHash(VAN_RIJN_TEXT),
    );
    expect((changed.metadata as { contentHash?: string }).contentHash).toBe(
      computeBusinessSourceContentHash(updatedText),
    );
  });

  it('two genuinely different URLs about the same company are both retained (rule 6: no over-dedupe)', async () => {
    const urlA = 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026';
    const urlB = 'https://newsroom.example/2026/03/van-rijn-logistics-vloot';
    // Different text bodies so both survive as separate Evidence — the intent
    // here is to prove URL uniqueness, not text uniqueness.
    const textB =
      'Van Rijn Logistics BV neemt in Rotterdam een nieuw duurzaamheidsprogramma in gebruik: elektrische vrachtwagens vervangen dieselvloot.';
    const provider = stubProvider('t', [
      vanRijnSource(urlA, VAN_RIJN_TEXT),
      vanRijnSource(urlB, textB),
    ]);

    await buildService(db, provider).run({ trigger: 'manual' });

    const repos = createRepositories(db);
    const companies = await repos.companies.list();
    expect(companies).toHaveLength(1);
    const evidence = await repos.evidence.listByCompany(companies[0]!.id);
    expect(evidence, 'both URLs must produce Evidence — real corroboration').toHaveLength(2);
    const urls = new Set(evidence.map((e) => e.sourceUrl));
    expect(urls.has(urlA)).toBe(true);
    expect(urls.has(urlB)).toBe(true);

    const activity = await repos.activity.listRecent(500);
    // No dedupe events fired — both URLs are novel.
    expect(activity.some((a) => a.eventType === 'BUSINESS_SOURCE_UNCHANGED')).toBe(false);
    expect(activity.some((a) => a.eventType === 'BUSINESS_SOURCE_CHANGED')).toBe(false);
  });

  it('unchanged source cannot increase the opportunity score across scans', async () => {
    const url = 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026';
    const provider = stubProvider('t', [vanRijnSource(url)]);

    // Scan #1 establishes the opportunity + baseline score.
    await buildService(db, provider).run({ trigger: 'manual' });
    const repos = createRepositories(db);
    const opps1 = await repos.opportunities.list();
    expect(opps1).toHaveLength(1);
    const scoreAfterFirst = opps1[0]!.score;
    const updatedAtAfterFirst = opps1[0]!.updatedAt;

    // Scan #2, #3, #4 with the same content — score must stay identical.
    for (let i = 0; i < 3; i++) {
      await buildService(db, provider).run({ trigger: 'manual' });
    }
    const opps2 = await repos.opportunities.list();
    expect(opps2).toHaveLength(1);
    expect(opps2[0]!.score, 'unchanged source must not swing score').toBe(scoreAfterFirst);
    expect(opps2[0]!.updatedAt, 'no reassessment → updatedAt unchanged').toBe(updatedAtAfterFirst);

    // And no OPPORTUNITY_REASSESSED activity was emitted for the repeats.
    const activity = await repos.activity.listRecent(500);
    expect(
      activity.filter((a) => a.eventType === 'OPPORTUNITY_REASSESSED'),
      'no reassessment on identical re-scan',
    ).toHaveLength(0);
    expect(activity.filter((a) => a.eventType === 'BUSINESS_SOURCE_UNCHANGED')).toHaveLength(3);
  });

  it('unchanged source cannot trigger contradiction / reassessment', async () => {
    const url = 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026';
    const provider = stubProvider('t', [vanRijnSource(url)]);

    // Scan #1 — creates the opportunity + one decision.
    await buildService(db, provider).run({ trigger: 'manual' });
    const repos = createRepositories(db);
    const opps = await repos.opportunities.list();
    const decisionsAfterFirst = await repos.decisions.listByOpportunity(opps[0]!.id);
    expect(decisionsAfterFirst.length).toBeGreaterThanOrEqual(1);
    const decisionCountAfterFirst = decisionsAfterFirst.length;

    // Scan #2 — same URL + same content. Dedupe must short-circuit BEFORE the
    // reassessment path even considers "conflict" / "corroboration".
    await buildService(db, provider).run({ trigger: 'manual' });

    const decisionsAfterSecond = await repos.decisions.listByOpportunity(opps[0]!.id);
    expect(
      decisionsAfterSecond.length,
      'no new decision — reassessment did not fire',
    ).toBe(decisionCountAfterFirst);
    const activity = await repos.activity.listRecent(500);
    // Sanity: the reassessment / contradiction path never ran.
    expect(activity.some((a) => a.eventType === 'OPPORTUNITY_REASSESSED')).toBe(false);
    const unchanged = activity.filter((a) => a.eventType === 'BUSINESS_SOURCE_UNCHANGED');
    expect(unchanged).toHaveLength(1);
  });
});

// ── Regression guard: grid_update dedupe still works alongside the new one ─

describe('business-source dedupe does not disturb grid_update dedupe', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb({ path: ':memory:' });
  });
  afterEach(() => {
    db.close();
  });

  it('unchanged grid source still fires GRID_UPDATE_UNCHANGED, no BUSINESS_SOURCE_* events', async () => {
    const gridSource: DiscoveredSource = {
      url: 'https://www.liander.nl/nieuws/capaciteit-nh',
      title: 'Update capaciteitskaart',
      rawText:
        'Update capaciteitskaart Noord-Holland — nieuw knelpunt in Amsterdam. Voor afname geldt een wachtlijst. Onderstation Krommenie is beperkt.',
      discoveredAt: new Date().toISOString(),
      publishedAt: '2026-02-10T10:00:00.000Z',
      sourceClass: 'grid_update',
      provider: 'test',
    };
    await buildService(db, stubProvider('t', [gridSource])).run({ trigger: 'manual' });
    await buildService(db, stubProvider('t', [gridSource])).run({ trigger: 'manual' });

    const repos = createRepositories(db);
    const activity = await repos.activity.listRecent(500);
    const types = activity.map((a) => a.eventType);
    expect(types).toContain('GRID_UPDATE_DETECTED');
    expect(types).toContain('GRID_UPDATE_UNCHANGED');
    // Grid path never emits BUSINESS_SOURCE_*.
    expect(types).not.toContain('BUSINESS_SOURCE_UNCHANGED');
    expect(types).not.toContain('BUSINESS_SOURCE_CHANGED');
  });
});
