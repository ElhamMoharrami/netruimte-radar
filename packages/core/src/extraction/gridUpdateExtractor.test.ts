import { describe, expect, it } from 'vitest';
import {
  RuleBasedGridUpdateExtractor,
  detectOperatorFromUrl,
  detectRegions,
  detectUpdateType,
} from './gridUpdateExtractor.js';
import type { DiscoveredSource } from '../sources/types.js';

function src(url: string, rawText: string, publishedAt: string | null = null): DiscoveredSource {
  return {
    url,
    title: 'Update',
    rawText,
    discoveredAt: new Date().toISOString(),
    publishedAt,
    provider: 'test',
    sourceClass: 'grid_update',
  };
}

describe('detectOperatorFromUrl', () => {
  it('recognises Liander / Enexis / Stedin hosts + subdomains', () => {
    expect(detectOperatorFromUrl('https://liander.nl/nieuws/a')).toBe('Liander');
    expect(detectOperatorFromUrl('https://capaciteit.liander.nl/x')).toBe('Liander');
    expect(detectOperatorFromUrl('https://www.enexis.nl/afname')).toBe('Enexis');
    expect(detectOperatorFromUrl('https://transportkaart.enexis.nl/')).toBe('Enexis');
    expect(detectOperatorFromUrl('https://stedin.net/zakelijk/x')).toBe('Stedin');
  });

  it('returns Unknown for non-operator URLs', () => {
    expect(detectOperatorFromUrl('https://example.com/')).toBe('Unknown');
    expect(detectOperatorFromUrl('bogus')).toBe('Unknown');
  });
});

describe('detectUpdateType', () => {
  it('detects consumption-only', () => {
    expect(detectUpdateType('Wij hebben een nieuwe wachtlijst voor afname in Zuid-Holland.')).toBe(
      'consumption',
    );
  });
  it('detects feed-in-only', () => {
    expect(detectUpdateType('Nieuwe teruglevercapaciteit vrijgegeven in Groningen.')).toBe(
      'feed_in',
    );
  });
  it('detects both', () => {
    expect(
      detectUpdateType(
        'Zowel de afnamecapaciteit als de teruglevercapaciteit in Utrecht is beperkt.',
      ),
    ).toBe('both');
  });
  it('returns unknown when neither keyword appears', () => {
    expect(detectUpdateType('Onze klantendienst is bereikbaar op werkdagen.')).toBe('unknown');
  });
});

describe('detectRegions', () => {
  it('finds mentioned provinces and cities', () => {
    const t = 'Beperkingen in Groningen en Amsterdam; ook Noord-Brabant.';
    expect(detectRegions(t)).toEqual(['Amsterdam', 'Groningen', 'Noord-Brabant']);
  });
  it('is case-insensitive but returns the canonical name', () => {
    expect(detectRegions('utrecht en rotterdam')).toEqual(['Rotterdam', 'Utrecht']);
  });
  it('returns [] for text without a known region', () => {
    expect(detectRegions('geen concreet gebied')).toEqual([]);
  });
});

describe('RuleBasedGridUpdateExtractor', () => {
  it('extracts operator, updateType, regions, excerpt, publishedAt from a Liander page', async () => {
    const s = src(
      'https://www.liander.nl/nieuws/capaciteit-noord-holland-2026',
      'Liander heeft de capaciteitskaart voor Noord-Holland bijgewerkt. Voor afname geldt een wachtlijst in Amsterdam. De teruglevercapaciteit blijft ongewijzigd.',
      '2026-02-10T10:00:00.000Z',
    );
    const r = await new RuleBasedGridUpdateExtractor().extract({ source: s });
    expect(r.operator).toBe('Liander');
    expect(r.updateType).toBe('both');
    expect(r.mentionedRegions).toContain('Noord-Holland');
    expect(r.mentionedRegions).toContain('Amsterdam');
    expect(r.evidenceExcerpt.toLowerCase()).toContain('capaciteit');
    expect(r.publishedAt).toBe('2026-02-10T10:00:00.000Z');
    expect(r.extractor).toBe('rule-based-grid');
    expect(r.summary).toMatch(/Liander/);
  });

  it('reports Unknown operator when the URL is not a known grid host', async () => {
    const s = src(
      'https://example.com/random',
      'Nieuwe teruglevercapaciteit vrijgegeven.',
    );
    const r = await new RuleBasedGridUpdateExtractor().extract({ source: s });
    expect(r.operator).toBe('Unknown');
    expect(r.updateType).toBe('feed_in');
  });
});
