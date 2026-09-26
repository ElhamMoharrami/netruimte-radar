import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DemoSourceDiscoveryProvider } from './demoProvider.js';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '../../../..', 'data/demo/sources');

describe('DemoSourceDiscoveryProvider', () => {
  it('loads all three demo fixtures', async () => {
    const provider = new DemoSourceDiscoveryProvider(demoRoot);
    const docs = await provider.discover();
    expect(docs.length).toBe(3);
    // The provider must not disclose the "expected" signal for a source —
    // only its URL, title, and raw text.
    for (const doc of docs) {
      expect(doc.url).toMatch(/^https?:\/\//);
      expect(doc.rawText.length).toBeGreaterThan(200);
      expect(doc.provider).toBe('demo');
    }
    const titles = docs.map((d) => d.title);
    expect(titles.some((t) => t.includes('Van Rijn'))).toBe(true);
    expect(titles.some((t) => t.includes('Noord Cold Storage'))).toBe(true);
    expect(titles.some((t) => t.includes('Delta Printworks'))).toBe(true);
  });
});
