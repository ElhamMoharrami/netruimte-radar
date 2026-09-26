import { describe, expect, it } from 'vitest';
import { DemoGridContextProvider } from './demoProvider.js';

describe('DemoGridContextProvider', () => {
  const provider = new DemoGridContextProvider();

  it('returns severe for Rotterdam', async () => {
    const r = await provider.getGridContext({ city: 'Rotterdam' });
    expect(r.level).toBe('severe');
    expect(r.source).toBe('DemoGridContextProvider');
    expect(r.sourceUrl).toMatch(/capaciteitskaart/);
  });

  it('returns high for Zwolle', async () => {
    const r = await provider.getGridContext({ city: 'Zwolle' });
    expect(r.level).toBe('high');
  });

  it('returns unknown for unmapped cities without inventing data', async () => {
    const r = await provider.getGridContext({ city: 'Nowheretown' });
    expect(r.level).toBe('unknown');
    expect(r.source).toBe('DemoGridContextProvider');
    expect(r.notes).toContain('No demo entry');
  });

  it('handles missing city gracefully', async () => {
    const r = await provider.getGridContext({});
    expect(r.level).toBe('unknown');
  });
});
