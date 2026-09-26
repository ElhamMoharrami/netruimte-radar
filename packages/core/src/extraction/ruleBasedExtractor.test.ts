import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { DemoSourceDiscoveryProvider } from '../sources/demoProvider.js';
import { RuleBasedEvidenceExtractor } from './ruleBasedExtractor.js';
import type { DiscoveredSource } from '../sources/types.js';
import type { ExtractionResult } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '../../../..', 'data/demo/sources');

async function extractAll() {
  const provider = new DemoSourceDiscoveryProvider(demoRoot);
  const sources = await provider.discover();
  const extractor = new RuleBasedEvidenceExtractor();
  const map = new Map<string, { source: DiscoveredSource; result: ExtractionResult }>();
  for (const source of sources) {
    const result = await extractor.extract({ source });
    // Key by a stable substring of the URL so we don't rely on hard-coded IDs.
    if (source.url.includes('vanrijn')) map.set('vanRijn', { source, result });
    if (source.url.includes('noord-cold-storage')) map.set('noord', { source, result });
    if (source.url.includes('delta-printworks')) map.set('delta', { source, result });
  }
  return map;
}

describe('RuleBasedEvidenceExtractor on demo fixtures', () => {
  let results: Awaited<ReturnType<typeof extractAll>>;
  beforeAll(async () => {
    results = await extractAll();
  });

  it('classifies Van Rijn as high-impact fleet electrification in Rotterdam', () => {
    const r = results.get('vanRijn')?.result;
    expect(r?.signalType).toBe('fleet_electrification');
    expect(r?.estimatedImpactClass).toBe('high');
    expect(r?.location.city).toBe('Rotterdam');
    expect(r?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r?.evidenceExcerpt.toLowerCase()).toMatch(/elektrisch/);
    expect(r?.companyName).toMatch(/Van Rijn/i);
  });

  it('classifies Noord Cold Storage as high-impact expansion or heat electrification in Zwolle', () => {
    const r = results.get('noord')?.result;
    // Both facility_expansion and heat_electrification are high-impact — the
    // fixture legitimately supports either as the dominant signal.
    expect(['facility_expansion', 'heat_electrification']).toContain(r?.signalType);
    expect(r?.estimatedImpactClass).toBe('high');
    expect(r?.location.city).toBe('Zwolle');
    expect(r?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('classifies Delta Printworks as low-impact solar (or sustainability) in Utrecht', () => {
    const r = results.get('delta')?.result;
    expect(['solar_installation', 'sustainability_target']).toContain(r?.signalType);
    expect(r?.estimatedImpactClass).toBe('low');
    expect(r?.location.city).toBe('Utrecht');
    // The excerpt should reflect actual page content, not the "wat we niet doen" negatives.
    expect(r?.evidenceExcerpt.toLowerCase()).not.toMatch(/geen plannen voor elektrische/);
  });

  it('every extraction carries a supporting excerpt and known extractor name', () => {
    for (const { result } of results.values()) {
      expect(result.evidenceExcerpt.length).toBeGreaterThan(10);
      expect(result.extractor).toBe('rule-based');
    }
  });
});
