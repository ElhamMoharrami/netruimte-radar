/**
 * PDOK Locatieserver client.
 *
 * PDOK ("Publieke Dienstverlening op de Kaart") is the official Dutch
 * geospatial service. The Locatieserver is a public, unauthenticated Solr-
 * style search endpoint that resolves postcodes, addresses, cities, and
 * municipalities to WGS84 coordinates + administrative context.
 *
 *   Endpoint:  https://api.pdok.nl/bzk/locatieserver/search/v3_1/free
 *   Docs:      https://www.pdok.nl/restful-api/-/article/pdok-locatieserver
 *   Terms:     open data, attribution requested, no key needed.
 */

export interface PdokLookupInput {
  postcode?: string;
  city?: string;
  address?: string;
}

export interface PdokLookupResult {
  postcode: string | null;
  city: string | null;
  gemeente: string | null;
  provincie: string | null;
  latitude: number;
  longitude: number;
  displayName: string;
  matchedType: string;
}

export interface PdokClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface PdokDoc {
  id?: string;
  type?: string;
  weergavenaam?: string;
  centroide_ll?: string;
  postcode?: string;
  woonplaatsnaam?: string;
  gemeentenaam?: string;
  provincienaam?: string;
}

interface PdokResponse {
  response?: {
    numFound?: number;
    docs?: PdokDoc[];
  };
}

const DEFAULT_BASE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';

/**
 * Thin wrapper over PDOK Locatieserver /free search. Prefers postcode when
 * present (most specific), then address, then city. Returns null on any
 * failure — the caller (a GridContextProvider) is responsible for degrading
 * to `unknown`, never for retrying indefinitely.
 */
export class PdokLocatieserverClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: PdokClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async lookup(input: PdokLookupInput): Promise<PdokLookupResult | null> {
    const url = this.buildUrl(input);
    if (!url) return null;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as PdokResponse;
      const doc = body.response?.docs?.[0];
      if (!doc) return null;
      const coords = parseCentroide(doc.centroide_ll);
      if (!coords) return null;
      return {
        postcode: doc.postcode ?? null,
        city: doc.woonplaatsnaam ?? null,
        gemeente: doc.gemeentenaam ?? null,
        provincie: doc.provincienaam ?? null,
        latitude: coords.lat,
        longitude: coords.lon,
        displayName: doc.weergavenaam ?? '(unknown)',
        matchedType: doc.type ?? 'other',
      };
    } catch {
      // Timeout, DNS, JSON parse, or any transport error → caller degrades.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildUrl(input: PdokLookupInput): string | null {
    const url = new URL(this.baseUrl);
    // Prefer the most specific query available.
    const postcode = normalizePostcode(input.postcode);
    if (postcode) {
      url.searchParams.set('q', postcode);
      url.searchParams.set('fq', 'type:postcode');
    } else if (input.address && input.city) {
      url.searchParams.set('q', `${input.address} ${input.city}`);
      url.searchParams.set('fq', 'type:adres');
    } else if (input.address) {
      url.searchParams.set('q', input.address);
    } else if (input.city) {
      url.searchParams.set('q', input.city);
      url.searchParams.set('fq', 'type:(woonplaats OR gemeente)');
    } else {
      return null;
    }
    url.searchParams.set('rows', '1');
    return url.toString();
  }
}

/**
 * PDOK accepts both `1234AB` and `1234 AB` — normalise to the compact form.
 */
export function normalizePostcode(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^\d{4}[A-Z]{2}$/.test(trimmed)) return null;
  return trimmed;
}

/** Parse PDOK `POINT(lon lat)` WKT (EPSG:4326) to numbers. */
export function parseCentroide(wkt: string | undefined): { lon: number; lat: number } | null {
  if (!wkt) return null;
  const match = /^POINT\(([-\d.]+)\s+([-\d.]+)\)$/i.exec(wkt.trim());
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}
