import { AnthropicEvidenceExtractor } from './anthropicExtractor.js';
import { FallbackEvidenceExtractor } from './fallback.js';
import { GeminiEvidenceExtractor } from './geminiExtractor.js';
import { OpenAIEvidenceExtractor } from './openaiExtractor.js';
import { RuleBasedEvidenceExtractor } from './ruleBasedExtractor.js';
import type { EvidenceExtractor } from './types.js';

export type AiProvider = 'rules' | 'anthropic' | 'openai' | 'gemini';

export interface ExtractorFactoryEnv {
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

export interface ExtractorFactoryOptions {
  env: ExtractorFactoryEnv;
  /** Called whenever the selected AI provider throws mid-request. */
  onFallback?: (err: unknown, source: { url: string; title: string }) => void;
}

export interface ExtractorFactoryResult {
  /** The extractor the pipeline should use — always non-null. */
  extractor: EvidenceExtractor;
  /** Which family is active (never a provider-specific name). */
  aiProvider: AiProvider;
  /** Full provider identifier including model, e.g. `openai:gpt-4o-mini`. */
  providerName: string;
  /** Human-readable explanation of the selection for the wiring report. */
  reason: string;
  /** True when a provider was requested but its credentials were missing. */
  disabled: boolean;
}

/**
 * Pick an evidence extractor from environment variables.
 *
 * Rules:
 *   - `AI_PROVIDER=rules`   → rule-based only, no fallback (it IS the fallback).
 *   - `AI_PROVIDER=<name>`  → the named provider. If its key is missing we
 *     degrade to rule-based rather than crashing at boot.
 *   - unset                 → back-compat: if ANTHROPIC_API_KEY is present use
 *     Anthropic, else OpenAI, else Gemini, else rule-based.
 *
 * The returned extractor is always wrapped in a `FallbackEvidenceExtractor`
 * when a real AI provider is active, so a request-time provider failure
 * degrades to rule-based and the run continues.
 */
export function chooseEvidenceExtractor(opts: ExtractorFactoryOptions): ExtractorFactoryResult {
  const { env } = opts;
  const rule = new RuleBasedEvidenceExtractor();
  const preferenceRaw = (env.AI_PROVIDER ?? '').trim().toLowerCase();

  if (preferenceRaw === 'rules' || preferenceRaw === 'none') {
    return {
      extractor: rule,
      aiProvider: 'rules',
      providerName: rule.name,
      reason: 'AI_PROVIDER=rules — rule-based extraction only',
      disabled: false,
    };
  }

  const explicit: AiProvider | null =
    preferenceRaw === 'anthropic'
      ? 'anthropic'
      : preferenceRaw === 'openai'
        ? 'openai'
        : preferenceRaw === 'gemini'
          ? 'gemini'
          : null;

  const desired: AiProvider | null = explicit ?? autoPick(env);

  if (desired === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const primary = new AnthropicEvidenceExtractor({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
    });
    return wrap(primary, rule, 'anthropic', explicit, opts.onFallback, 'ANTHROPIC_API_KEY');
  }
  if (desired === 'openai' && env.OPENAI_API_KEY) {
    const primary = new OpenAIEvidenceExtractor({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
    });
    return wrap(primary, rule, 'openai', explicit, opts.onFallback, 'OPENAI_API_KEY');
  }
  if (desired === 'gemini' && env.GEMINI_API_KEY) {
    const primary = new GeminiEvidenceExtractor({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
    return wrap(primary, rule, 'gemini', explicit, opts.onFallback, 'GEMINI_API_KEY');
  }

  // Explicit preference for a provider whose key is missing → degrade cleanly.
  if (explicit) {
    const keyName = ENV_KEY_FOR[explicit];
    return {
      extractor: rule,
      aiProvider: 'rules',
      providerName: rule.name,
      reason: `AI_PROVIDER=${explicit} but ${keyName} is not set — using rule-based`,
      disabled: true,
    };
  }

  // Auto mode + no keys → rule-based.
  return {
    extractor: rule,
    aiProvider: 'rules',
    providerName: rule.name,
    reason: 'no AI provider credentials configured — using rule-based',
    disabled: false,
  };
}

const ENV_KEY_FOR: Record<Exclude<AiProvider, 'rules'>, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

function autoPick(env: ExtractorFactoryEnv): AiProvider | null {
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

function wrap(
  primary: EvidenceExtractor,
  rule: EvidenceExtractor,
  aiProvider: Exclude<AiProvider, 'rules'>,
  explicit: AiProvider | null,
  onFallback: ExtractorFactoryOptions['onFallback'],
  keyName: string,
): ExtractorFactoryResult {
  const extractor = new FallbackEvidenceExtractor(primary, rule, {
    ...(onFallback ? { onFallback } : {}),
  });
  return {
    extractor,
    aiProvider,
    providerName: primary.name,
    reason: explicit
      ? `AI_PROVIDER=${aiProvider} — using ${primary.name} (fallback: rule-based)`
      : `${keyName} present — auto-selected ${primary.name} (fallback: rule-based)`,
    disabled: false,
  };
}
