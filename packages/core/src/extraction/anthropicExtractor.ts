import Anthropic from '@anthropic-ai/sdk';
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

const EXTRACTION_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    companyName: {
      type: ['string', 'null'],
      description: 'Full legal or brand name of the company mentioned. Null if not clearly identified.',
    },
    city: {
      type: ['string', 'null'],
      description: 'Dutch city where the described facility/activity happens.',
    },
    address: {
      type: ['string', 'null'],
      description: 'Street address if given verbatim in the source.',
    },
    signalType: {
      type: 'string',
      enum: SIGNAL_TYPES,
    },
    summary: {
      type: 'string',
      description: 'One-sentence neutral summary of the evidence, in English.',
    },
    evidenceExcerpt: {
      type: 'string',
      description: 'Verbatim substring from the source text that supports the signal.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Honest 0-1 confidence in the whole extraction.',
    },
    estimatedImpactClass: {
      type: 'string',
      enum: IMPACT_CLASSES,
    },
    facts: {
      type: 'array',
      description: 'Individual extracted facts; every fact must carry the exact supporting quote.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          quote: { type: 'string' },
          inferred: { type: 'boolean' },
        },
        required: ['key', 'value', 'quote', 'inferred'],
      },
    },
  },
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
};

export interface AnthropicExtractorOptions {
  apiKey: string;
  model?: string;
  /** Injected client for tests. */
  client?: Anthropic;
}

/**
 * Anthropic Claude extractor. Structured output is enforced via a single
 * required tool call — the SDK's `messages.parse()` isn't available on the
 * vendored SDK version, and tool use is the most robust cross-version pattern.
 *
 * The system prompt is static and marked for prompt caching. Prompt + schema
 * live in `./aiPromptAndSchema.ts` — shared with the OpenAI and Gemini
 * extractors so all three producers write to the same domain object shape.
 */
export class AnthropicEvidenceExtractor implements EvidenceExtractor {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicExtractorOptions) {
    if (!opts.apiKey) throw new Error('AnthropicEvidenceExtractor requires an API key');
    this.model = opts.model ?? 'claude-opus-4-7';
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
    this.name = `anthropic:${this.model}`;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const { source } = input;
    const cleanText = preparedSourceText(source);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: 'record_extraction',
          description: 'Record the structured evidence extraction result for this source.',
          input_schema: EXTRACTION_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'record_extraction' },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildUserPrompt(source, cleanText) }],
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error('AnthropicEvidenceExtractor: model did not call record_extraction');
    }
    const parsed = ExtractionSchema.parse(toolUse.input);
    return parseExtractionToResult(parsed, source.sourceType, this.name);
  }
}
