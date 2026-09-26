import { describe, expect, it, vi } from 'vitest';
import { PdokLocatieserverClient, normalizePostcode, parseCentroide } from './pdokClient.js';

describe('normalizePostcode', () => {
  it('accepts compact and spaced Dutch postcodes case-insensitively', () => {
    expect(normalizePostcode('3011AD')).toBe('3011AD');
    expect(normalizePostcode('3011 ad')).toBe('3011AD');
    expect(normalizePostcode('  1012ab  ')).toBe('1012AB');
  });
  it('rejects non-Dutch shapes', () => {
    expect(normalizePostcode('foo')).toBeNull();
    expect(normalizePostcode('12345')).toBeNull();
    expect(normalizePostcode('AB1234')).toBeNull();
    expect(normalizePostcode(undefined)).toBeNull();
  });
});

describe('parseCentroide', () => {
  it('parses PDOK WKT points', () => {
    expect(parseCentroide('POINT(4.47912816 51.9228326)')).toEqual({
      lon: 4.47912816,
      lat: 51.9228326,
    });
  });
  it('returns null for junk', () => {
    expect(parseCentroide('LINESTRING(0 0, 1 1)')).toBeNull();
    expect(parseCentroide('')).toBeNull();
    expect(parseCentroide(undefined)).toBeNull();
  });
});

describe('PdokLocatieserverClient', () => {
  function mockOkResponse(docs: unknown[]): typeof fetch {
    return vi.fn(async () =>
      new Response(JSON.stringify({ response: { docs } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  }

  it('resolves a postcode to gemeente + coordinates', async () => {
    const fetchImpl = mockOkResponse([
      {
        id: 'pcd-abc',
        type: 'postcode',
        weergavenaam: 'Havenweg 1, 3011AD Rotterdam',
        centroide_ll: 'POINT(4.47912816 51.9228326)',
        postcode: '3011AD',
        woonplaatsnaam: 'Rotterdam',
        gemeentenaam: 'Rotterdam',
        provincienaam: 'Zuid-Holland',
      },
    ]);
    const client = new PdokLocatieserverClient({ fetchImpl });
    const result = await client.lookup({ postcode: '3011ad' });
    expect(result).not.toBeNull();
    expect(result!.gemeente).toBe('Rotterdam');
    expect(result!.provincie).toBe('Zuid-Holland');
    expect(result!.latitude).toBeCloseTo(51.9228326);
    expect(result!.longitude).toBeCloseTo(4.47912816);
  });

  it('falls back cleanly to null on network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = new PdokLocatieserverClient({ fetchImpl });
    const result = await client.lookup({ postcode: '3011AD' });
    expect(result).toBeNull();
  });

  it('falls back cleanly to null on HTTP error', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('server error', { status: 500 }),
    ) as unknown as typeof fetch;
    const client = new PdokLocatieserverClient({ fetchImpl });
    const result = await client.lookup({ postcode: '3011AD' });
    expect(result).toBeNull();
  });

  it('returns null when the query cannot be built', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    const client = new PdokLocatieserverClient({ fetchImpl });
    const result = await client.lookup({});
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends fq=type:postcode when a postcode is provided', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(input.toString());
      return new Response(JSON.stringify({ response: { docs: [] } }), { status: 200 });
    };
    const client = new PdokLocatieserverClient({ fetchImpl });
    await client.lookup({ postcode: '1012AB' });
    expect(seen[0]).toContain('fq=type%3Apostcode');
    expect(seen[0]).toContain('q=1012AB');
  });

  it('falls back to city when no postcode is provided', async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(input.toString());
      return new Response(JSON.stringify({ response: { docs: [] } }), { status: 200 });
    };
    const client = new PdokLocatieserverClient({ fetchImpl });
    await client.lookup({ city: 'Utrecht' });
    expect(seen[0]).toContain('q=Utrecht');
    expect(seen[0]).toContain('type%3A%28woonplaats+OR+gemeente%29');
  });
});
