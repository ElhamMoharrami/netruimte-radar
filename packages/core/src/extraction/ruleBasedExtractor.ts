import type { ImpactClass, SignalType, SourceType } from '@netruimte/shared';
import { firstMatchingSentence, stripHtml } from './text.js';
import type {
  EvidenceExtractor,
  ExtractedFact,
  ExtractionInput,
  ExtractionResult,
} from './types.js';

/**
 * Deterministic keyword-based extractor. Its job is to:
 *   1. Recognize signals mentioned in Dutch or English business text.
 *   2. Attach an *estimated* impact class (never fabricate consumption numbers).
 *   3. Keep the supporting quote for every claim.
 *
 * When the text does not clearly match any signal we return
 * `signalType: 'unknown'` and low confidence — the pipeline treats that as a
 * cue to stop rather than guess.
 */
export class RuleBasedEvidenceExtractor implements EvidenceExtractor {
  readonly name = 'rule-based';

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const rawHtml = input.source.rawText;
    const text = stripHtml(rawHtml);
    const facts: ExtractedFact[] = [];

    const companyName = this.detectCompanyName(input.source.title, text);
    if (companyName) {
      facts.push({
        key: 'company_name',
        value: companyName,
        quote: companyName,
        inferred: false,
      });
    }

    const city = this.detectCity(text);
    if (city) {
      facts.push({ key: 'city', value: city, quote: city, inferred: false });
    }

    const address = this.detectAddress(text);
    if (address) {
      facts.push({ key: 'address', value: address, quote: address, inferred: false });
    }

    const match = pickBestSignal(text);
    const impact = match ? IMPACT_TABLE[match.signal] : 'unknown';
    const supportingSentence =
      match?.sentence ??
      firstMatchingSentence(text, /elektri|zonn|warmtepomp|batterij|laden|uitbreid/i) ??
      text.slice(0, 240);

    if (match) {
      facts.push({
        key: 'signal_evidence',
        value: match.signal,
        quote: supportingSentence,
        inferred: false,
      });
    }

    const confidence = computeConfidence({
      hasCompany: Boolean(companyName),
      hasCity: Boolean(city),
      matchScore: match?.score ?? 0,
    });

    const summary =
      match !== null
        ? `${companyName ?? 'A company'}: ${SIGNAL_HUMAN[match.signal]}`
        : companyName
          ? `${companyName}: no clear grid-relevant signal detected`
          : 'No clear signal detected';

    const sourceType = (input.source.sourceType ?? 'other') as SourceType;
    const signalType: SignalType = match?.signal ?? 'unknown';
    const estimatedImpactClass: ImpactClass = impact;

    return {
      companyName,
      location: { city, address },
      signalType,
      summary,
      evidenceExcerpt: supportingSentence.slice(0, 400),
      confidence,
      estimatedImpactClass,
      sourceType,
      extractedFacts: facts,
      extractor: this.name,
    };
  }

  // -------------------------------------------------------------------------
  // Company / location detection (deliberately conservative)
  // -------------------------------------------------------------------------

  private detectCompanyName(title: string, text: string): string | null {
    // 1. Dutch legal-form suffix wins if present (BV, B.V., N.V., Holding)
    const legal = text.match(
      /([A-Z][A-Za-zÀ-ÿ0-9&'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ0-9&'’\-]+){0,3})\s+(?:BV|B\.V\.|N\.V\.|Holding)\b/,
    );
    if (legal && legal[1]) return legal[1].trim();

    // 2. Fall back to the leading capitalized noun phrase in the title.
    const titleCleaned = title.replace(/[—-].*/, '').trim();
    const match = titleCleaned.match(
      /^([A-Z][A-Za-zÀ-ÿ0-9&'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ0-9&'’\-]+){0,3})/,
    );
    return match?.[1]?.trim() ?? null;
  }

  private detectCity(text: string): string | null {
    for (const city of DUTCH_CITIES) {
      if (new RegExp(`\\b${city}\\b`, 'i').test(text)) return city;
    }
    return null;
  }

  private detectAddress(text: string): string | null {
    const m = text.match(
      /\b([A-Z][a-zÀ-ÿ\-]+(?:straat|weg|laan|gracht|plein|kade|dijk|park))\s+(\d{1,4}[A-Za-z]?)/,
    );
    return m ? `${m[1]} ${m[2]}` : null;
  }
}

// ---------------------------------------------------------------------------
// Signal keyword table
//
// Each pattern includes both a Dutch and an English form. `score` is used to
// tie-break when multiple signals match; higher score wins.
// ---------------------------------------------------------------------------

interface SignalPattern {
  signal: SignalType;
  regex: RegExp;
  score: number;
}

const PATTERNS: SignalPattern[] = [
  {
    signal: 'fleet_electrification',
    regex:
      /(?:elektrische\s+(?:truck|vrachtwagen|bestelbus|voertuig)|electric\s+(?:truck|van|fleet|vehicle)s?)/i,
    score: 30,
  },
  {
    signal: 'charging_infrastructure',
    regex:
      /(?:snellaad|laadplein|laadpunt(?:en)?|charging\s+(?:hub|station|plaza)|350\s*kW)/i,
    score: 22,
  },
  {
    signal: 'facility_expansion',
    regex:
      /(?:nieuw(?:bouw|e?\s+(?:hal|magazijn|distributiecentrum|productiehal))|new\s+(?:warehouse|facility|production\s+hall)|uitbreiding|expansion|\d[\d.,]*\s*m²)/i,
    score: 18,
  },
  {
    signal: 'electric_machinery',
    regex:
      /(?:elektrische\s+(?:machine|drukpers|shovel|kraan|heftruck)|electric\s+(?:machinery|forklift|crane))/i,
    score: 20,
  },
  {
    signal: 'heat_electrification',
    regex:
      /(?:industri[eë]le\s+warmtepomp|warmtepomp(?:en)?|elektrische\s+(?:boiler|ketel)|heat\s+pump|van\s+gas\s+naar\s+(?:volledig\s+)?elektrisch|elektrificeren\s+.*koeling)/i,
    score: 22,
  },
  {
    signal: 'solar_installation',
    regex:
      /(?:pv[- ]?installatie|zonnepan(?:eel|elen)|zonnepaneelinstallatie|zonnepark(?:en)?|solar\s+(?:installation|panels|array)|\d[\d.,]*\s*MWp)/i,
    score: 14,
  },
  {
    signal: 'battery_installation',
    regex: /(?:batterij(?:opslag)?|energieopslag|battery\s+storage|BESS)/i,
    score: 16,
  },
  {
    signal: 'sustainability_target',
    regex:
      /(?:klimaatdoel|CO2-neutraal|net\s+zero|Paris\s+aligned|verduurzam|Zero\s+Emissie\s+Zone|MKB\s+Zero\s+Emissie)/i,
    score: 8,
  },
  {
    signal: 'energy_hiring',
    regex:
      /(?:vacature.*(?:energie|elektro|hoogspanning)|(?:energie|elektro|hoogspannings?)-?(?:coördinator|manager|monteur|engineer))/i,
    score: 10,
  },
];

/**
 * Impact class per signal type. Deliberately conservative: signals that would
 * clearly increase demand at a site get "high", supporting signals get
 * "medium" or "low". These are *estimates*, not measurements.
 */
const IMPACT_TABLE: Record<SignalType, ImpactClass> = {
  fleet_electrification: 'high',
  charging_infrastructure: 'high',
  facility_expansion: 'high',
  electric_machinery: 'medium',
  heat_electrification: 'high',
  solar_installation: 'low',
  battery_installation: 'medium',
  sustainability_target: 'low',
  energy_hiring: 'low',
  unknown: 'unknown',
};

const SIGNAL_HUMAN: Record<SignalType, string> = {
  fleet_electrification: 'electric-vehicle fleet expansion',
  charging_infrastructure: 'new charging infrastructure',
  facility_expansion: 'new or expanded facility',
  electric_machinery: 'new electric machinery',
  heat_electrification: 'heat/process electrification',
  solar_installation: 'solar installation',
  battery_installation: 'battery/energy-storage installation',
  sustainability_target: 'sustainability target announcement',
  energy_hiring: 'energy-focused hiring',
  unknown: 'no clear signal',
};

const DUTCH_CITIES = [
  'Amsterdam',
  'Rotterdam',
  'Den Haag',
  "'s-Gravenhage",
  'Utrecht',
  'Eindhoven',
  'Groningen',
  'Tilburg',
  'Almere',
  'Breda',
  'Nijmegen',
  'Enschede',
  'Haarlem',
  'Arnhem',
  'Zaanstad',
  "'s-Hertogenbosch",
  'Zwolle',
  'Leiden',
  'Maastricht',
  'Delft',
  'Dordrecht',
  'Alkmaar',
  'Amersfoort',
];

interface SignalMatch {
  signal: SignalType;
  score: number;
  sentence: string;
}

// Sentences that express the *absence* of something we look for. Matching
// "elektrische drukpersen" is not the same as *deploying* electric presses.
const NEGATION_MARKERS =
  /\b(geen|niet|nooit|zonder|no\s+plans|do\s+not|does\s+not|will\s+not|won't)\b/i;

function isNegated(sentence: string, keyword: RegExp): boolean {
  if (!NEGATION_MARKERS.test(sentence)) return false;
  const keywordMatch = keyword.exec(sentence);
  if (!keywordMatch) return false;
  // If a negation marker appears anywhere before the keyword in the same
  // sentence, treat it as negated. Cheap heuristic — good enough for demo text.
  const negMatch = NEGATION_MARKERS.exec(sentence);
  if (!negMatch) return false;
  return negMatch.index < keywordMatch.index;
}

function pickBestSignal(text: string): SignalMatch | null {
  const matches: SignalMatch[] = [];
  for (const p of PATTERNS) {
    // Find the first non-negated sentence that matches this pattern.
    let chosen: string | null = null;
    for (const s of text.split(/(?<=[.!?])\s+/)) {
      const trimmed = s.trim();
      if (!p.regex.test(trimmed)) continue;
      if (isNegated(trimmed, p.regex)) continue;
      chosen = trimmed;
      break;
    }
    if (!chosen) continue;
    matches.push({ signal: p.signal, score: p.score, sentence: chosen });
  }
  if (matches.length === 0) return null;

  // Prefer the highest-scoring signal; break ties by earlier occurrence.
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return text.indexOf(a.sentence) - text.indexOf(b.sentence);
  });
  return matches[0] ?? null;
}

function computeConfidence(inputs: {
  hasCompany: boolean;
  hasCity: boolean;
  matchScore: number;
}): number {
  if (inputs.matchScore === 0) return 0.2;
  let c = 0.4;
  if (inputs.hasCompany) c += 0.2;
  if (inputs.hasCity) c += 0.1;
  c += Math.min(0.3, inputs.matchScore / 100);
  return Math.max(0, Math.min(1, Number(c.toFixed(2))));
}
