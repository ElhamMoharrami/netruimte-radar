import type { CongestionLevel } from '@netruimte/shared';

/**
 * ─── Netbeheer Nederland Capaciteitskaart snapshot ────────────────────────
 *
 * The Netbeheer Nederland capacity map (https://capaciteitskaart.netbeheernederland.nl/)
 * is served through a Remix app that fetches vector tiles from a domain-restricted
 * Maptiler key. There is no public JSON API for per-region congestion at the
 * time of writing (probed on the snapshot date below).
 *
 * This file is a manually-verified snapshot of widely-reported congestion
 * status per gemeente, gathered from:
 *   - Netbeheer Nederland's own press releases and quarterly updates,
 *   - the interactive capaciteitskaart,
 *   - reporting by NRC, FD, Trouw and RTLZ on grid constraints (2023-2026).
 *
 * Every entry is deliberately conservative: unknown-by-default. A gemeente
 * that isn't listed here returns `unknown` — we never guess.
 *
 * Refresh procedure:
 *   1. Open https://capaciteitskaart.netbeheernederland.nl/totaal/afname
 *   2. For each gemeente listed below, verify the "afname" traffic-light
 *      matches the level we record here.
 *   3. Bump SNAPSHOT_AT to today.
 *   4. Commit the change so provenance is preserved in git history.
 */

export const NETBEHEER_NL_SNAPSHOT_AT = '2026-09-26';
export const NETBEHEER_NL_SOURCE = 'Netbeheer Nederland Capaciteitskaart (manual snapshot)';
export const NETBEHEER_NL_SOURCE_URL = 'https://capaciteitskaart.netbeheernederland.nl/';

export interface GemeenteEntry {
  level: Exclude<CongestionLevel, 'unknown'>;
  operator: 'Liander' | 'Enexis' | 'Stedin' | 'TenneT';
  notes: string;
}

export const NETBEHEER_NL_SNAPSHOT: Readonly<Record<string, GemeenteEntry>> = Object.freeze({
  // ─── Groningen / Drenthe / Friesland (Enexis) ───────────────────────────
  Groningen: {
    level: 'severe',
    operator: 'Enexis',
    notes: 'Well-documented severe afname/teruglever congestion across Northern NL.',
  },
  Eemsdelta: {
    level: 'severe',
    operator: 'Enexis',
    notes: 'Heavy-industry zone (Delfzijl); teruglever + afname constraints reported.',
  },
  'Het Hogeland': {
    level: 'severe',
    operator: 'Enexis',
    notes: 'Northern Groningen — solar/wind teruglever congestion.',
  },
  Assen: {
    level: 'severe',
    operator: 'Enexis',
    notes: 'Drenthe capital — reported afname congestion.',
  },
  Emmen: {
    level: 'severe',
    operator: 'Enexis',
    notes: 'Drenthe industrial areas — reported afname congestion.',
  },
  Leeuwarden: {
    level: 'high',
    operator: 'Liander',
    notes: 'Friesland capital — reported afname pressure.',
  },

  // ─── Flevoland (Liander) ────────────────────────────────────────────────
  Almere: {
    level: 'severe',
    operator: 'Liander',
    notes: 'Flevoland — long-standing afname congestion; multiple public statements.',
  },
  Lelystad: {
    level: 'severe',
    operator: 'Liander',
    notes: 'Flevoland — reported afname congestion + data-centre pressure.',
  },
  Zeewolde: {
    level: 'severe',
    operator: 'Liander',
    notes: 'Data-centre zone — well-known transportation constraints.',
  },

  // ─── Noord-Holland (Liander) ────────────────────────────────────────────
  Amsterdam: {
    level: 'high',
    operator: 'Liander',
    notes: 'Amsterdam metro — reported afname + teruglever constraints (2023-2026).',
  },
  Haarlem: {
    level: 'high',
    operator: 'Liander',
    notes: 'Noord-Holland urban afname congestion reported.',
  },
  'Hollands Kroon': {
    level: 'severe',
    operator: 'Liander',
    notes: 'Wieringermeer / Middenmeer — data-centre cluster with severe constraints.',
  },
  Alkmaar: {
    level: 'moderate',
    operator: 'Liander',
    notes: 'Reported moderate afname pressure.',
  },

  // ─── Zuid-Holland (Stedin) ──────────────────────────────────────────────
  Rotterdam: {
    level: 'severe',
    operator: 'Stedin',
    notes: 'Rotterdam port + heavy industry — repeatedly cited severe congestion.',
  },
  'Den Haag': {
    level: 'high',
    operator: 'Stedin',
    notes: 'Reported urban afname pressure.',
  },
  Delft: {
    level: 'moderate',
    operator: 'Stedin',
    notes: 'Reported moderate afname pressure.',
  },
  Zoetermeer: {
    level: 'moderate',
    operator: 'Stedin',
    notes: 'Reported moderate afname pressure.',
  },
  Leiden: {
    level: 'moderate',
    operator: 'Stedin',
    notes: 'Reported moderate afname pressure.',
  },
  Dordrecht: {
    level: 'high',
    operator: 'Stedin',
    notes: 'Drecht region industry — reported afname pressure.',
  },

  // ─── Utrecht (Stedin) ───────────────────────────────────────────────────
  Utrecht: {
    level: 'high',
    operator: 'Stedin',
    notes: 'Utrecht region — reported afname congestion, 2022-2026.',
  },
  Amersfoort: {
    level: 'moderate',
    operator: 'Stedin',
    notes: 'Reported moderate afname pressure.',
  },
  Nieuwegein: {
    level: 'high',
    operator: 'Stedin',
    notes: 'Utrecht regio — reported afname pressure.',
  },

  // ─── Gelderland (Liander) ───────────────────────────────────────────────
  Arnhem: {
    level: 'high',
    operator: 'Liander',
    notes: 'Reported urban afname pressure.',
  },
  Nijmegen: {
    level: 'high',
    operator: 'Liander',
    notes: 'Reported urban afname pressure.',
  },
  Apeldoorn: {
    level: 'moderate',
    operator: 'Liander',
    notes: 'Reported moderate afname pressure.',
  },
  Ede: {
    level: 'moderate',
    operator: 'Liander',
    notes: 'Reported moderate afname pressure.',
  },

  // ─── Overijssel (Enexis) ────────────────────────────────────────────────
  Zwolle: {
    level: 'high',
    operator: 'Enexis',
    notes: 'Overijssel afname congestion widely reported for regional industry.',
  },
  Deventer: {
    level: 'moderate',
    operator: 'Enexis',
    notes: 'Reported moderate afname pressure.',
  },
  Enschede: {
    level: 'moderate',
    operator: 'Enexis',
    notes: 'Reported moderate afname pressure.',
  },
  Hengelo: {
    level: 'moderate',
    operator: 'Enexis',
    notes: 'Reported moderate afname pressure.',
  },

  // ─── Noord-Brabant (Enexis) ─────────────────────────────────────────────
  Eindhoven: {
    level: 'severe',
    operator: 'Enexis',
    notes: 'Brainport growth zone — high-tech expansion outpacing capacity.',
  },
  Helmond: {
    level: 'high',
    operator: 'Enexis',
    notes: 'Brainport corridor — reported afname pressure.',
  },
  Tilburg: {
    level: 'high',
    operator: 'Enexis',
    notes: 'Reported afname pressure — logistics + industry.',
  },
  Breda: {
    level: 'high',
    operator: 'Enexis',
    notes: 'Reported afname pressure.',
  },
  "'s-Hertogenbosch": {
    level: 'high',
    operator: 'Enexis',
    notes: 'Reported afname pressure.',
  },

  // ─── Limburg (Enexis) ───────────────────────────────────────────────────
  Maastricht: {
    level: 'moderate',
    operator: 'Enexis',
    notes: 'Reported moderate afname pressure.',
  },
  Sittard: {
    level: 'high',
    operator: 'Enexis',
    notes: 'Chemelot chemical cluster — reported afname pressure.',
  },
  Venlo: {
    level: 'high',
    operator: 'Enexis',
    notes: 'Logistics hub — reported afname pressure.',
  },
});

/**
 * Case-insensitive lookup; supports the small handful of Dutch gemeente
 * names with apostrophes ("'s-Hertogenbosch") and hyphens ("Den Haag").
 */
export function lookupGemeente(gemeente: string | null | undefined): GemeenteEntry | null {
  if (!gemeente) return null;
  const trimmed = gemeente.trim();
  if (trimmed in NETBEHEER_NL_SNAPSHOT) {
    return NETBEHEER_NL_SNAPSHOT[trimmed] ?? null;
  }
  const lower = trimmed.toLowerCase();
  for (const [key, value] of Object.entries(NETBEHEER_NL_SNAPSHOT)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}
