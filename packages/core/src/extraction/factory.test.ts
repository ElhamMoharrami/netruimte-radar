import { describe, expect, it } from 'vitest';
import {
  AnthropicEvidenceExtractor,
  GeminiEvidenceExtractor,
  OpenAIEvidenceExtractor,
  RuleBasedEvidenceExtractor,
  chooseEvidenceExtractor,
} from './index.js';
import { FallbackEvidenceExtractor } from './fallback.js';
import type { EvidenceExtractor, ExtractionInput, ExtractionResult } from './types.js';

const testSource: ExtractionInput['source'] = {
  url: 'https://example.com/x',
  title: 'Van Rijn Logistics elektrische vloot',
  rawText: 'Van Rijn Logistics BV zet 20 elektrische vrachtwagens in te Rotterdam.',
  discoveredAt: new Date().toISOString(),
  publishedAt: null,
  sourceType: 'company_news',
  provider: 'test',
};

describe('chooseEvidenceExtractor — provider selection', () => {
  it('AI_PROVIDER=rules → rule-based, no fallback wrapper', () => {
    const r = chooseEvidenceExtractor({ env: { AI_PROVIDER: 'rules' } });
    expect(r.aiProvider).toBe('rules');
    expect(r.extractor.name).toBe('rule-based');
    expect(r.disabled).toBe(false);
    expect(r.reason).toContain('AI_PROVIDER=rules');
  });

  it('AI_PROVIDER=anthropic + ANTHROPIC_API_KEY → anthropic wrapped in fallback', () => {
    const r = chooseEvidenceExtractor({
      env: { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' },
    });
    expect(r.aiProvider).toBe('anthropic');
    expect(r.providerName).toContain('anthropic:');
    expect(r.extractor.name).toContain('anthropic');
    expect(r.extractor.name).toContain('rule-based');
    expect(r.disabled).toBe(false);
  });

  it('AI_PROVIDER=openai + OPENAI_API_KEY → openai wrapped in fallback', () => {
    const r = chooseEvidenceExtractor({
      env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' },
    });
    expect(r.aiProvider).toBe('openai');
    expect(r.providerName).toContain('openai:');
    expect(r.extractor.name).toContain('openai');
    expect(r.extractor.name).toContain('rule-based');
  });

  it('AI_PROVIDER=gemini + GEMINI_API_KEY → gemini wrapped in fallback', () => {
    const r = chooseEvidenceExtractor({
      env: { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'sk-test' },
    });
    expect(r.aiProvider).toBe('gemini');
    expect(r.providerName).toContain('gemini:');
    expect(r.extractor.name).toContain('gemini');
  });

  it('AI_PROVIDER=<name> but key missing → degrades to rule-based with disabled=true', () => {
    for (const name of ['anthropic', 'openai', 'gemini']) {
      const r = chooseEvidenceExtractor({ env: { AI_PROVIDER: name } });
      expect(r.aiProvider).toBe('rules');
      expect(r.extractor.name).toBe('rule-based');
      expect(r.disabled).toBe(true);
      expect(r.reason).toMatch(new RegExp(name, 'i'));
      expect(r.reason).toContain('_API_KEY');
    }
  });

  it('AI_PROVIDER unset + no keys → rule-based, disabled=false', () => {
    const r = chooseEvidenceExtractor({ env: {} });
    expect(r.aiProvider).toBe('rules');
    expect(r.extractor.name).toBe('rule-based');
    expect(r.disabled).toBe(false);
  });

  it('AI_PROVIDER unset + ANTHROPIC_API_KEY → auto-selects anthropic (backward compat)', () => {
    const r = chooseEvidenceExtractor({ env: { ANTHROPIC_API_KEY: 'sk-test' } });
    expect(r.aiProvider).toBe('anthropic');
    expect(r.reason).toContain('auto');
  });

  it('AI_PROVIDER unset + only OPENAI_API_KEY → auto-selects openai', () => {
    const r = chooseEvidenceExtractor({ env: { OPENAI_API_KEY: 'sk-test' } });
    expect(r.aiProvider).toBe('openai');
  });

  it('AI_PROVIDER unset + only GEMINI_API_KEY → auto-selects gemini', () => {
    const r = chooseEvidenceExtractor({ env: { GEMINI_API_KEY: 'sk-test' } });
    expect(r.aiProvider).toBe('gemini');
  });

  it('unknown AI_PROVIDER value → auto-picks based on keys, does not crash', () => {
    const r = chooseEvidenceExtractor({
      env: { AI_PROVIDER: 'bogus', OPENAI_API_KEY: 'sk-test' },
    });
    expect(r.aiProvider).toBe('openai');
  });

  it('AI_PROVIDER=none is treated as rules', () => {
    const r = chooseEvidenceExtractor({ env: { AI_PROVIDER: 'none' } });
    expect(r.aiProvider).toBe('rules');
  });

  it('never requires an AI provider for successful factory construction', () => {
    // Simulates "startup must succeed without any AI keys".
    const r = chooseEvidenceExtractor({ env: {} });
    expect(r.extractor).toBeInstanceOf(RuleBasedEvidenceExtractor);
  });
});

describe('chooseEvidenceExtractor — fallback semantics', () => {
  async function proveFallbackWorks(primary: EvidenceExtractor) {
    const wrapped = new FallbackEvidenceExtractor(primary, new RuleBasedEvidenceExtractor());
    const result = await wrapped.extract({ source: testSource });
    // If fallback kicks in, we get a rule-based extraction (which knows the
    // Van Rijn fleet_electrification pattern from the fixture text above).
    expect(result.signalType).toBe('fleet_electrification');
    // Name should record that the primary failed.
    expect(result.extractor).toContain('rule-based');
    expect(result.extractor).toContain(primary.name);
  }

  it('OpenAI failure → rule-based extraction succeeds', async () => {
    class FailingOpenAI implements EvidenceExtractor {
      readonly name = 'openai:fake';
      async extract(): Promise<ExtractionResult> {
        throw new Error('openai 500');
      }
    }
    await proveFallbackWorks(new FailingOpenAI());
  });

  it('Gemini failure → rule-based extraction succeeds', async () => {
    class FailingGemini implements EvidenceExtractor {
      readonly name = 'gemini:fake';
      async extract(): Promise<ExtractionResult> {
        throw new Error('gemini 429');
      }
    }
    await proveFallbackWorks(new FailingGemini());
  });

  it('Anthropic failure → rule-based extraction succeeds (regression cover)', async () => {
    class FailingAnthropic implements EvidenceExtractor {
      readonly name = 'anthropic:fake';
      async extract(): Promise<ExtractionResult> {
        throw new Error('anthropic 503');
      }
    }
    await proveFallbackWorks(new FailingAnthropic());
  });

  it('primary success passes through unchanged', async () => {
    const ok: ExtractionResult = {
      companyName: 'Fake Co',
      location: { city: 'Utrecht', address: null },
      signalType: 'sustainability_target',
      summary: 'test',
      evidenceExcerpt: 'test',
      confidence: 0.9,
      estimatedImpactClass: 'low',
      sourceType: 'company_news',
      extractedFacts: [],
      extractor: 'openai:test',
    };
    class Working implements EvidenceExtractor {
      readonly name = 'openai:working';
      async extract(): Promise<ExtractionResult> {
        return ok;
      }
    }
    const wrapped = new FallbackEvidenceExtractor(
      new Working(),
      new RuleBasedEvidenceExtractor(),
    );
    const r = await wrapped.extract({ source: testSource });
    expect(r.extractor).toBe('openai:test');
    expect(r.signalType).toBe('sustainability_target');
  });
});

describe('AI extractor constructors — safe without network', () => {
  it('AnthropicEvidenceExtractor constructs with a fake key', () => {
    const ex = new AnthropicEvidenceExtractor({ apiKey: 'sk-test' });
    expect(ex.name).toContain('anthropic');
  });

  it('OpenAIEvidenceExtractor constructs with a fake key', () => {
    const ex = new OpenAIEvidenceExtractor({ apiKey: 'sk-test' });
    expect(ex.name).toContain('openai');
  });

  it('GeminiEvidenceExtractor constructs with a fake key', () => {
    const ex = new GeminiEvidenceExtractor({ apiKey: 'sk-test' });
    expect(ex.name).toContain('gemini');
  });

  it('all three throw on empty API key rather than silently disabling', () => {
    expect(() => new AnthropicEvidenceExtractor({ apiKey: '' })).toThrow();
    expect(() => new OpenAIEvidenceExtractor({ apiKey: '' })).toThrow();
    expect(() => new GeminiEvidenceExtractor({ apiKey: '' })).toThrow();
  });
});
