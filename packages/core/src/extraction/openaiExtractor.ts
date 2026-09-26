import OpenAI from 'openai';
import {
  ExtractionSchema,
  IMPACT_CLASSES,
  SIGNAL_TYPES,
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseExtractionToResult,
  preparedSourceText,
} from './aiPromptAndSchema.js';
import type { EvidenceExtractor, ExtractionInput, ExtractionResult } from './types.js';

/**
 * OpenAI Structured Outputs JSON schema. The rules for strict mode are:
 *   - every property listed in `required` (all of them here)
 *   - `additionalProperties: false` on every object
 *   - nullable via `type: ["string", "null"]`
 *   - no `minimum`/`maximum`/`pattern` — those are enforced post-hoc by Zod.
 */
const OPENAI_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'companyName',
    'city',
    'address',
    'signalType',
    'summary',
    'evidenceExcerpt',
    'confidence',
    'estimatedImpactClass',
    'facts',
  ],
  properties: {
    companyName: { type: ['string', 'null'] },
    city: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    signalType: { type: 'string', enum: [...SIGNAL_TYPES] },
    summary: { type: 'string' },
    evidenceExcerpt: { type: 'string' },
    confidence: { type: 'number' },
    estimatedImpactClass: { type: 'string', enum: [...IMPACT_CLASSES] },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'quote', 'inferred'],
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          quote: { type: 'string' },
          inferred: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export interface OpenAIExtractorOptions {
  apiKey: string;
  model?: string;
  /** Optional base URL — supports Azure OpenAI + compatible proxies. */
  baseURL?: string;
  /** Injected client for tests. */
  client?: OpenAI;
}

/**
 * OpenAI extractor. Uses the Chat Completions endpoint with
 * `response_format: {type: "json_schema", ..., strict: true}` — the safest
 * structured-output path across GPT-4o family models.
 *
 * The system prompt and Zod validator are shared with the other AI providers
 * (see `./aiPromptAndSchema.ts`) so every provider produces the same domain
 * object.
 */
export class OpenAIEvidenceExtractor implements EvidenceExtractor {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: OpenAIExtractorOptions) {
    if (!opts.apiKey) throw new Error('OpenAIEvidenceExtractor requires an API key');
    this.model = opts.model ?? 'gpt-4o-mini';
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey,
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      });
    this.name = `openai:${this.model}`;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const { source } = input;
    const cleanText = preparedSourceText(source);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(source, cleanText) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'evidence_extraction',
          strict: true,
          schema: OPENAI_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('OpenAIEvidenceExtractor: empty response');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      throw new Error(`OpenAIEvidenceExtractor: response is not valid JSON: ${(err as Error).message}`);
    }
    const parsed = ExtractionSchema.parse(parsedJson);
    return parseExtractionToResult(parsed, source.sourceType, this.name);
  }
}
