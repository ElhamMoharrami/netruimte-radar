import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
  type Schema,
} from '@google/generative-ai';
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

const GEMINI_RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    companyName: { type: SchemaType.STRING, nullable: true },
    city: { type: SchemaType.STRING, nullable: true },
    address: { type: SchemaType.STRING, nullable: true },
    signalType: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: [...SIGNAL_TYPES],
    },
    summary: { type: SchemaType.STRING },
    evidenceExcerpt: { type: SchemaType.STRING },
    confidence: { type: SchemaType.NUMBER },
    estimatedImpactClass: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: [...IMPACT_CLASSES],
    },
    facts: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          key: { type: SchemaType.STRING },
          value: { type: SchemaType.STRING },
          quote: { type: SchemaType.STRING },
          inferred: { type: SchemaType.BOOLEAN },
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

export interface GeminiExtractorOptions {
  apiKey: string;
  model?: string;
  /** Injected model for tests. Bypasses network entirely. */
  modelFactory?: (opts: { apiKey: string; model: string }) => GenerativeModel;
}

/**
 * Google Gemini extractor. Uses `responseMimeType: "application/json"` +
 * `responseSchema` so the API returns validated JSON directly — no prose to
 * parse, no cleanup step.
 *
 * The system prompt and Zod validator are shared with Anthropic + OpenAI so
 * every provider produces the same domain object.
 */
export class GeminiEvidenceExtractor implements EvidenceExtractor {
  readonly name: string;
  private readonly model: string;
  private readonly generativeModel: GenerativeModel;

  constructor(opts: GeminiExtractorOptions) {
    if (!opts.apiKey) throw new Error('GeminiEvidenceExtractor requires an API key');
    this.model = opts.model ?? 'gemini-1.5-flash';
    this.name = `gemini:${this.model}`;
    this.generativeModel = opts.modelFactory
      ? opts.modelFactory({ apiKey: opts.apiKey, model: this.model })
      : new GoogleGenerativeAI(opts.apiKey).getGenerativeModel({
          model: this.model,
          systemInstruction: SYSTEM_PROMPT,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        });
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const { source } = input;
    const cleanText = preparedSourceText(source);
    const result = await this.generativeModel.generateContent(buildUserPrompt(source, cleanText));
    const text = result.response.text();
    if (!text) throw new Error('GeminiEvidenceExtractor: empty response');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch (err) {
      throw new Error(`GeminiEvidenceExtractor: response is not valid JSON: ${(err as Error).message}`);
    }
    const parsed = ExtractionSchema.parse(parsedJson);
    return parseExtractionToResult(parsed, source.sourceType, this.name);
  }
}
