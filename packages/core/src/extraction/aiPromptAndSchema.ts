import { z } from 'zod';
import type { ImpactClass, SignalType, SourceType } from '@netruimte/shared';
import { stripHtml } from './text.js';
import type {
  DiscoveredSource,
} from '../sources/types.js';
import type {
  ExtractedFact,
  ExtractionInput,
  ExtractionResult,
} from './types.js';

/**
 * Shared between AnthropicEvidenceExtractor, OpenAIEvidenceExtractor and
 * GeminiEvidenceExtractor. Each provider defines its own JSON-schema shape
 * (their APIs disagree on details) but the prompt, Zod validator, and
 * `parseExtractionToResult` conversion are the same everywhere — that's how we
 * guarantee "all providers return exactly the same validated domain object".
 */

export const SIGNAL_TYPES = [
  'fleet_electrification',
  'facility_expansion',
  'electric_machinery',
  'heat_electrification',
  'solar_installation',
  'battery_installation',
  'charging_infrastructure',
  'sustainability_target',
  'energy_hiring',
  'unknown',
] as const satisfies readonly SignalType[];

export const IMPACT_CLASSES = [
  'low',
  'medium',
  'high',
  'unknown',
] as const satisfies readonly ImpactClass[];

/**
 * The one and only validator for AI extraction output. Every provider MUST
 * produce data that survives `ExtractionSchema.parse()` — no exceptions.
 */
export const ExtractionSchema = z.object({
  companyName: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  signalType: z.enum(SIGNAL_TYPES),
  summary: z.string(),
  evidenceExcerpt: z.string(),
  confidence: z.number().min(0).max(1),
  estimatedImpactClass: z.enum(IMPACT_CLASSES),
  facts: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
        quote: z.string(),
        inferred: z.boolean(),
      }),
    )
    .default([]),
});
export type ParsedExtraction = z.infer<typeof ExtractionSchema>;

export const SYSTEM_PROMPT = `You extract structured evidence from Dutch or English business web pages for Netruimte Radar,
an autonomous early-warning agent for Dutch businesses that may face future electricity-grid constraints.

Your ONLY job is to detect and classify evidence. Deterministic code handles scoring, policy, and
any downstream action — do not opine on those.

Signal types (pick exactly one, use "unknown" if unsure):
  - fleet_electrification        : purchase/deployment of electric trucks, vans, buses, forklifts
  - facility_expansion           : new/expanded warehouse, production hall, distribution centre
  - electric_machinery           : new electric machines (presses, cranes, kilns, etc.)
  - heat_electrification         : industrial heat pumps, electric boilers, gas→electric switches
  - solar_installation           : PV panel installations
  - battery_installation         : stationary battery/energy storage
  - charging_infrastructure      : charging plazas, fast-charging hubs
  - sustainability_target        : announced climate/emission targets, ZEZ commitments
  - energy_hiring                : hiring energy coordinators, electrical engineers, hoogspanning roles
  - unknown                      : no clear grid-relevant signal

Estimated impact class (best judgement of *potential* grid-demand increase at this site):
  - high    : likely to materially increase peak demand (fleet electrification, large facility, heat electrification, large charging hub)
  - medium  : possible material demand increase (electric machinery, battery, mid-size PV displacing net-import)
  - low     : small or ambiguous demand impact (small PV, sustainability announcement, single hire)
  - unknown : not enough info to say

Rules:
  1. Never invent numbers. If a wattage / count / m² is not in the source, do NOT put it in the output.
  2. The evidenceExcerpt MUST be a verbatim substring from the source text (Dutch original if the source is Dutch).
  3. If the company or city cannot be identified with high confidence, set the field to null.
  4. Set confidence to your honest 0-1 confidence in the whole extraction.
  5. Every fact you emit must carry the exact quote that supports it. Mark inferred=true only if it is a
     reasonable inference from the text; never invent facts.
  6. If the text is not about a real, specific company (e.g. it is a generic industry news round-up),
     return companyName=null, signalType="unknown", low confidence.
  7. Do not summarize what the company should do about the grid. Report evidence only.

You MUST return valid JSON matching the provided schema exactly.
`;

export function buildUserPrompt(source: DiscoveredSource, cleanText: string): string {
  return [
    `Source URL: ${source.url}`,
    `Source title: ${source.title}`,
    `Source type hint: ${source.sourceType ?? 'other'}`,
    '',
    '--- BEGIN SOURCE TEXT ---',
    cleanText,
    '--- END SOURCE TEXT ---',
  ].join('\n');
}

export function preparedSourceText(source: DiscoveredSource, maxChars = 12_000): string {
  return stripHtml(source.rawText).slice(0, maxChars);
}

export function parseExtractionToResult(
  parsed: ParsedExtraction,
  sourceHint: ExtractionInput['source']['sourceType'],
  extractorName: string,
): ExtractionResult {
  const facts: ExtractedFact[] = parsed.facts.map((f) => ({
    key: f.key,
    value: f.value,
    quote: f.quote,
    inferred: f.inferred,
  }));
  const sourceType: SourceType = (sourceHint ?? 'other') as SourceType;
  return {
    companyName: parsed.companyName,
    location: { city: parsed.city, address: parsed.address },
    signalType: parsed.signalType,
    summary: parsed.summary,
    evidenceExcerpt: parsed.evidenceExcerpt.slice(0, 500),
    confidence: parsed.confidence,
    estimatedImpactClass: parsed.estimatedImpactClass,
    sourceType,
    extractedFacts: facts,
    extractor: extractorName,
  };
}
