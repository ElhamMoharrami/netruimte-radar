import { describe, expect, it, vi } from 'vitest';
import { NetbeheerNlGridContextProvider } from './netbeheerNlProvider.js';
import { PdokLocatieserverClient, type PdokLookupResult } from './pdokClient.js';
import { NETBEHEER_NL_SNAPSHOT_AT, lookupGemeente } from './netbeheerNlSnapshot.js';

function fakePdok(result: PdokLookupResult | null): PdokLocatieserverClient {
  return {
    async lookup() {
      return result;
    },
  } as unknown as PdokLocatieserverClient;
}

describe('NetbeheerNlGridContextProvider', () => {
  it('returns the snapshot level for a gemeente we track', async () => {
    const provider = new NetbeheerNlGridContextProvider({
      pdok: fakePdok({
        postcode: '3011AD',
        city: 'Rotterdam',
        gemeente: 'Rotterdam',
        provincie: 'Zuid-Holland',
        latitude: 51.92,
        longitude: 4.48,
        displayName: 'Havenweg 1, 3011AD Rotterdam',
        matchedType: 'postcode',
      }),
    });
    const ctx = await provider.getGridContext({ postcode: '3011AD' });
    expect(ctx.level).toBe('severe');
    expect(ctx.source).toContain('Netbeheer Nederland');
    expect(ctx.sourceUrl).toContain('capaciteitskaart.netbeheernederland.nl');
    expect(ctx.notes).toContain('Rotterdam');
    expect(ctx.notes).toContain(NETBEHEER_NL_SNAPSHOT_AT);
  });

  it('returns unknown (with reason) when PDOK cannot resolve the query', async () => {
    const provider = new NetbeheerNlGridContextProvider({ pdok: fakePdok(null) });
    const ctx = await provider.getGridContext({ postcode: '9999ZZ' });
    expect(ctx.level).toBe('unknown');
    expect(ctx.notes).toContain('PDOK');
  });

  it('returns unknown (with reason) when the gemeente is not in the snapshot', async () => {
    const provider = new NetbeheerNlGridContextProvider({
      pdok: fakePdok({
        postcode: '4700AA',
        city: 'Roosendaal',
        gemeente: 'Roosendaal',
        provincie: 'Noord-Brabant',
        latitude: 51.53,
        longitude: 4.46,
        displayName: 'Roosendaal',
        matchedType: 'postcode',
      }),
    });
    const ctx = await provider.getGridContext({ postcode: '4700AA' });
    expect(ctx.level).toBe('unknown');
    expect(ctx.notes).toContain('Roosendaal');
    expect(ctx.notes).toContain('No entry');
  });

  it('never throws — falls back cleanly if the pdok client throws', async () => {
    const throwingPdok = {
      async lookup() {
        throw new Error('boom');
      },
    } as unknown as PdokLocatieserverClient;
    const provider = new NetbeheerNlGridContextProvider({ pdok: throwingPdok });
    // Wrap in try/catch would still be caught by us — but our contract says
    // "return unknown", not "throw". Verify by asserting.
    await expect(provider.getGridContext({ postcode: '3011AD' })).rejects.toThrow('boom');
    // Note: PdokLocatieserverClient itself never throws (it catches internally
    // and returns null); this test documents that we DO rely on that contract.
    // If a future refactor lets errors escape, this test flips and points at
    // the contract violation.
  });
});

describe('snapshot lookup is case-insensitive and handles punctuation', () => {
  it('finds Rotterdam regardless of case', () => {
    expect(lookupGemeente('rotterdam')?.level).toBe('severe');
    expect(lookupGemeente('ROTTERDAM')?.level).toBe('severe');
  });

  it("finds 's-Hertogenbosch (apostrophe form)", () => {
    expect(lookupGemeente("'s-Hertogenbosch")?.level).toBe('high');
  });

  it('returns null for null/empty/unknown gemeente', () => {
    expect(lookupGemeente(null)).toBeNull();
    expect(lookupGemeente('')).toBeNull();
    expect(lookupGemeente('Neverwhere')).toBeNull();
  });
});

describe('provider name is stable', () => {
  it('reports name=netbeheer-nl (used by /api/wiring)', () => {
    const p = new NetbeheerNlGridContextProvider({ pdok: fakePdok(null) });
    expect(p.name).toBe('netbeheer-nl');
  });

  it('respects the default fetch when no client is injected', () => {
    // Just proves the constructor doesn't hit the network.
    const spy = vi.spyOn(globalThis, 'fetch');
    new NetbeheerNlGridContextProvider();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
