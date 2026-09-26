import type { DiscoveredSource, SourceDiscoveryProvider } from './types.js';

export interface ApifyProviderOptions {
  token: string;
  actorId: string;
  /** Optional: pull from an existing dataset instead of running the actor. */
  datasetId?: string;
  baseUrl?: string;
  /** Max items to fetch per call. */
  limit?: number;
}

interface ApifyDatasetItem {
  url?: string;
  title?: string;
  text?: string;
  html?: string;
  publishedAt?: string;
  sourceType?: DiscoveredSource['sourceType'];
}

/**
 * Talks to the real Apify HTTP API. Kept side-effect free at construction time
 * so the app can create it eagerly and simply not call it when a token is
 * missing (see {@link chooseSourceDiscoveryProvider} in the API).
 *
 * The pipeline never falls back to a mock silently: if a token is present we
 * use this provider; if not, we use the demo provider ONLY when `DEMO_MODE`
 * is on. Missing token in production mode surfaces as a real error.
 */
export class ApifySourceDiscoveryProvider implements SourceDiscoveryProvider {
  readonly name = 'apify';

  constructor(private readonly opts: ApifyProviderOptions) {
    if (!opts.token) throw new Error('ApifySourceDiscoveryProvider requires a token');
    if (!opts.actorId && !opts.datasetId) {
      throw new Error('ApifySourceDiscoveryProvider requires actorId or datasetId');
    }
  }

  async discover(): Promise<DiscoveredSource[]> {
    const base = this.opts.baseUrl ?? 'https://api.apify.com/v2';
    const limit = this.opts.limit ?? 25;
    const datasetId = await this.resolveDatasetId(base);

    const url = new URL(`${base}/datasets/${datasetId}/items`);
    url.searchParams.set('token', this.opts.token);
    url.searchParams.set('clean', 'true');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Apify dataset fetch failed: ${res.status} ${res.statusText}`);
    }
    const items = (await res.json()) as ApifyDatasetItem[];
    const now = new Date().toISOString();

    return items
      .filter((item) => Boolean(item.url) && Boolean(item.text ?? item.html))
      .map((item) => ({
        url: item.url as string,
        title: item.title ?? '(untitled)',
        rawText: (item.text ?? item.html ?? '') as string,
        discoveredAt: now,
        publishedAt: item.publishedAt ?? null,
        sourceType: item.sourceType ?? 'other',
        provider: this.name,
      }));
  }

  private async resolveDatasetId(base: string): Promise<string> {
    if (this.opts.datasetId) return this.opts.datasetId;
    // Kick off the actor synchronously and use its default dataset. We do not
    // implement long-polling here — the caller is expected to schedule discovery
    // via n8n, so a single run per invocation is fine.
    const runUrl = new URL(`${base}/acts/${this.opts.actorId}/runs`);
    runUrl.searchParams.set('token', this.opts.token);
    runUrl.searchParams.set('waitForFinish', '120');
    const res = await fetch(runUrl, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`Apify actor run failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { data?: { defaultDatasetId?: string } };
    const id = body.data?.defaultDatasetId;
    if (!id) throw new Error('Apify actor run returned no defaultDatasetId');
    return id;
  }
}
