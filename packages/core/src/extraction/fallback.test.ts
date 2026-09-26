import { describe, expect, it, vi } from 'vitest';
import { FallbackEvidenceExtractor } from './fallback.js';
import { RuleBasedEvidenceExtractor } from './ruleBasedExtractor.js';
import type { EvidenceExtractor, ExtractionResult } from './types.js';

const source = {
  url: 'https://example.com/x',
  title: 'Van Rijn Logistics elektrische vloot',
  rawText: 'Van Rijn Logistics BV zet 20 elektrische vrachtwagens in te Rotterdam.',
  discoveredAt: new Date().toISOString(),
  publishedAt: null,
  sourceType: 'company_news' as const,
  provider: 'test',
};

describe('FallbackEvidenceExtractor', () => {
  it('uses the primary when it succeeds', async () => {
    const primaryResult: ExtractionResult = {
      companyName: 'ok',
      location: { city: null, address: null },
      signalType: 'fleet_electrification',
      summary: 'ok',
      evidenceExcerpt: 'ok',
      confidence: 0.9,
      estimatedImpactClass: 'high',
      sourceType: 'company_news',
      extractedFacts: [],
      extractor: 'primary',
    };
    const primary: EvidenceExtractor = {
      name: 'primary',
      extract: vi.fn(async () => primaryResult),
    };
    const wrapped = new FallbackEvidenceExtractor(primary, new RuleBasedEvidenceExtractor());
    const r = await wrapped.extract({ source });
    expect(r.extractor).toBe('primary');
  });

  it('falls back to the secondary when the primary throws', async () => {
    const primary: EvidenceExtractor = {
      name: 'boom',
      extract: vi.fn(async () => {
        throw new Error('nope');
      }),
    };
    const onFallback = vi.fn();
    const wrapped = new FallbackEvidenceExtractor(primary, new RuleBasedEvidenceExtractor(), {
      onFallback,
    });
    const r = await wrapped.extract({ source });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(r.extractor).toContain('rule-based');
    expect(r.signalType).toBe('fleet_electrification');
  });
});
