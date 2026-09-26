import type { CongestionContext } from '@netruimte/shared';
import {
  NETBEHEER_NL_SNAPSHOT_AT,
  NETBEHEER_NL_SOURCE,
  NETBEHEER_NL_SOURCE_URL,
  lookupGemeente,
} from './netbeheerNlSnapshot.js';
import { PdokLocatieserverClient, normalizePostcode } from './pdokClient.js';
import type { GridContextProvider, GridQuery } from './types.js';

export interface NetbeheerNlGridContextProviderOptions {
  /** Injected in tests. Defaults to a live PDOK client. */
  pdok?: PdokLocatieserverClient;
}

/**
 * Real Dutch grid-context provider.
 *
 *   1. PDOK Locatieserver → resolve a postcode (or city/address) to the
 *      containing gemeente + coordinates. This part is live and hits the
 *      official Dutch geocoder.
 *   2. Netbeheer Nederland snapshot → look up the reported congestion
 *      status for that gemeente. This is a manually-verified snapshot with
 *      a snapshot date and public source URL — refreshed by hand from
 *      https://capaciteitskaart.netbeheernederland.nl/.
 *
 * When either step fails we return `unknown` (never guess). The response
 * always carries `source`, `sourceUrl`, and a `notes` field explaining why
 * we settled where we did, so downstream auditability holds.
 *
 * We never claim businesses are grid neighbours — congestion is per-gemeente
 * and reflects the aggregate reported by Netbeheer Nederland, not a per-
 * connection topology fact.
 */
export class NetbeheerNlGridContextProvider implements GridContextProvider {
  readonly name = 'netbeheer-nl';
  private readonly pdok: PdokLocatieserverClient;

  constructor(opts: NetbeheerNlGridContextProviderOptions = {}) {
    this.pdok = opts.pdok ?? new PdokLocatieserverClient();
  }

  async getGridContext(query: GridQuery): Promise<CongestionContext> {
    const now = new Date().toISOString();

    // 1. Resolve to a gemeente via PDOK.
    const lookup = await this.pdok.lookup({
      postcode: normalizePostcode(query.postcode) ?? undefined,
      city: query.city,
    });

    if (!lookup) {
      return {
        level: 'unknown',
        source: NETBEHEER_NL_SOURCE,
        sourceUrl: NETBEHEER_NL_SOURCE_URL,
        checkedAt: now,
        notes:
          'PDOK Locatieserver returned no match — cannot look up congestion for this location.',
      };
    }

    // 2. Snapshot lookup by gemeente name.
    const entry = lookupGemeente(lookup.gemeente);
    if (!entry) {
      return {
        level: 'unknown',
        source: NETBEHEER_NL_SOURCE,
        sourceUrl: NETBEHEER_NL_SOURCE_URL,
        checkedAt: now,
        notes: [
          `Resolved via PDOK to ${lookup.gemeente ?? '(unknown gemeente)'} `,
          `(${lookup.provincie ?? '?'}, ${lookup.latitude.toFixed(4)}, ${lookup.longitude.toFixed(4)}).`,
          ` No entry in the Netbeheer Nederland snapshot (snapshotAt=${NETBEHEER_NL_SNAPSHOT_AT}) — verify manually.`,
        ].join(''),
      };
    }

    return {
      level: entry.level,
      source: NETBEHEER_NL_SOURCE,
      sourceUrl: NETBEHEER_NL_SOURCE_URL,
      checkedAt: now,
      notes: [
        `Gemeente=${lookup.gemeente}, provincie=${lookup.provincie ?? '?'}, operator=${entry.operator}. `,
        `Snapshot ${NETBEHEER_NL_SNAPSHOT_AT}: ${entry.notes}`,
      ].join(''),
    };
  }
}
