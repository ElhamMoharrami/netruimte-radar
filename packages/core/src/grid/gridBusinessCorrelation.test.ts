import { describe, expect, it } from 'vitest';
import { GridBusinessCorrelationService } from './gridBusinessCorrelation.js';
import type { GridEvent } from '@netruimte/shared';

function ev(overrides: Partial<GridEvent> = {}): GridEvent {
  const base: GridEvent = {
    id: overrides.id ?? 'gev_1',
    operator: 'liander',
    eventType: 'new_bottleneck',
    regions: ['Noord-Holland'],
    municipalities: ['Amsterdam'],
    stations: ['Krommenie'],
    direction: 'consumption',
    summary: 'Liander: new_bottleneck — in Amsterdam',
    evidenceExcerpt: 'Voor afname is er een nieuw knelpunt in Amsterdam.',
    sourceUrl: 'https://www.liander.nl/x',
    publishedAt: '2026-02-10T10:00:00.000Z',
    detectedAt: '2026-03-01T10:00:00.000Z',
    confidence: 0.9,
    contentHash: 'hash',
    ...overrides,
  };
  return base;
}

const NOW = '2026-03-10T00:00:00.000Z';

describe('GridBusinessCorrelationService', () => {
  const svc = new GridBusinessCorrelationService();

  it('returns 0 bonus when no location evidence exists on the company', () => {
    const r = svc.correlate({
      company: { city: null, provincie: null },
      gridEvents: [ev()],
      now: NOW,
    });
    expect(r.freshnessBonus).toBe(0);
    expect(r.matchedEvents).toEqual([]);
    expect(r.confidence).toBe(0);
    expect(r.explanation).toMatch(/no location evidence/);
  });

  it('returns 0 bonus when no events match the location', () => {
    const r = svc.correlate({
      company: { city: 'Rotterdam', provincie: 'Zuid-Holland' },
      gridEvents: [ev()], // Amsterdam / Noord-Holland
      now: NOW,
    });
    expect(r.freshnessBonus).toBe(0);
    expect(r.matchedEvents).toEqual([]);
    expect(r.explanation).toMatch(/no recent grid_update events/i);
  });

  it('exact municipality match gives +10 and confidence 0.9', () => {
    const r = svc.correlate({
      company: { city: 'Amsterdam' },
      gridEvents: [ev()],
      now: NOW,
    });
    expect(r.freshnessBonus).toBe(10);
    expect(r.confidence).toBe(0.9);
    expect(r.matchedEvents.map((e) => e.id)).toEqual(['gev_1']);
    expect(r.explanation).toMatch(/municipality \(amsterdam\)/i);
    expect(r.explanation).toMatch(/does NOT imply grid-neighbor/);
  });

  it('region-only match gives +5 and confidence 0.5', () => {
    const r = svc.correlate({
      company: { city: 'Zaanstad', provincie: 'Noord-Holland' },
      gridEvents: [ev()], // municipalities:[Amsterdam], regions:[Noord-Holland]
      now: NOW,
    });
    expect(r.freshnessBonus).toBe(5);
    expect(r.confidence).toBe(0.5);
    expect(r.explanation).toMatch(/region \(noord-holland\)/i);
  });

  it('municipality match wins over a region-only match on the same event', () => {
    const r = svc.correlate({
      company: { city: 'Amsterdam', provincie: 'Noord-Holland' },
      gridEvents: [ev()],
      now: NOW,
    });
    // Same event, but we should NOT stack both — municipality wins.
    expect(r.freshnessBonus).toBe(10);
    expect(r.confidence).toBe(0.9);
    expect(r.matchedEvents).toHaveLength(1);
  });

  it('multiple matching events stack — capped at 15 by default', () => {
    const r = svc.correlate({
      company: { city: 'Amsterdam' },
      gridEvents: [ev({ id: 'a' }), ev({ id: 'b' }), ev({ id: 'c' })],
      now: NOW,
    });
    // Raw would be 30, cap trims to 15.
    expect(r.freshnessBonus).toBe(15);
    expect(r.explanation).toMatch(/\(capped\)/);
    expect(r.matchedEvents.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('events older than the recency window do NOT contribute', () => {
    const r = svc.correlate({
      company: { city: 'Amsterdam' },
      gridEvents: [
        ev({ id: 'old', detectedAt: '2025-01-01T00:00:00.000Z' }),
        ev({ id: 'recent', detectedAt: '2026-03-01T00:00:00.000Z' }),
      ],
      now: NOW,
      recencyDays: 30,
    });
    expect(r.matchedEvents.map((e) => e.id)).toEqual(['recent']);
    expect(r.freshnessBonus).toBe(10);
  });

  it('city / region match is case-insensitive', () => {
    const r = svc.correlate({
      company: { city: 'AMSTERDAM' },
      gridEvents: [ev({ municipalities: ['amsterdam'] })],
      now: NOW,
    });
    expect(r.freshnessBonus).toBe(10);
  });

  it('explanation states MENTION only and explicitly disclaims topology / direct impact', () => {
    const r = svc.correlate({
      company: { city: 'Amsterdam' },
      gridEvents: [ev()],
      now: NOW,
    });
    // Positive claim we make:
    expect(r.explanation).toMatch(/mention/i);
    // Positive disclaimers we require:
    expect(r.explanation).toMatch(/does NOT imply grid-neighbor topology/i);
    expect(r.explanation).toMatch(/direct impact/i);
    // Forbidden positive claims (should never appear):
    expect(r.explanation).not.toMatch(/directly affects|is affected by/i);
    expect(r.explanation).not.toMatch(/shares (a )?(?:grid|substation|connection)/i);
  });

  it('respects custom bonus/cap options', () => {
    const r = svc.correlate({
      company: { city: 'Amsterdam' },
      gridEvents: [ev({ id: 'a' }), ev({ id: 'b' })],
      now: NOW,
      municipalityBonus: 4,
      regionBonus: 2,
      totalCap: 6,
    });
    // raw 4+4=8, capped at 6
    expect(r.freshnessBonus).toBe(6);
  });
});
