import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DiscoveredSource, SourceDiscoveryProvider } from './types.js';

interface DemoManifestEntry {
  file: string;
  url: string;
  publishedAt: string | null;
  sourceType: DiscoveredSource['sourceType'];
  title: string;
}

/**
 * Deterministic file-backed source provider. Reads the HTML/text fixtures
 * in `data/demo/sources/` and returns them as `DiscoveredSource`s.
 *
 * The extractor / scorer never see the "expected" classification for a demo
 * fixture — they only see the raw document, exactly as they would for a live
 * Apify hit.
 */
export class DemoSourceDiscoveryProvider implements SourceDiscoveryProvider {
  readonly name = 'demo';

  constructor(private readonly rootDir: string) {}

  async discover(): Promise<DiscoveredSource[]> {
    const dir = resolve(this.rootDir);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.html') || f.endsWith('.txt'));
    const now = new Date().toISOString();

    const results: DiscoveredSource[] = [];
    for (const file of files.sort()) {
      const manifest = DEMO_MANIFEST[file];
      if (!manifest) continue;
      const rawText = await readFile(join(dir, file), 'utf8');
      results.push({
        url: manifest.url,
        title: manifest.title,
        rawText,
        discoveredAt: now,
        publishedAt: manifest.publishedAt,
        sourceType: manifest.sourceType,
        provider: this.name,
      });
    }
    return results;
  }
}

/**
 * Ground-truth metadata for each fixture: the URL it "would" have on the
 * public web, publication date, and its category. The extractor still has to
 * discover the company and signal from the text itself.
 */
const DEMO_MANIFEST: Record<string, Omit<DemoManifestEntry, 'file'>> = {
  'van-rijn-logistics-electric-trucks.html': {
    url: 'https://vanrijn-logistics.example/nieuws/elektrische-vloot-2026',
    publishedAt: '2026-03-12T09:00:00.000Z',
    sourceType: 'company_news',
    title: 'Van Rijn Logistics vernieuwt vloot met 35 elektrische trucks',
  },
  'noord-cold-storage-expansion.html': {
    url: 'https://regionaalnieuws-zwolle.example/artikel/noord-cold-storage-uitbreiding',
    publishedAt: '2026-02-03T07:30:00.000Z',
    sourceType: 'news_article',
    title: 'Noord Cold Storage bouwt nieuw diepvrieshuis in Zwolle',
  },
  'delta-printworks-sustainability.html': {
    url: 'https://delta-printworks.example/duurzaamheid',
    publishedAt: '2026-01-15T00:00:00.000Z',
    sourceType: 'sustainability_page',
    title: 'Delta Printworks — Onze duurzaamheidsreis',
  },
};
