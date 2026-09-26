import { classifyByUrl } from './sourceClass.js';
import type { DiscoveredSource, SourceDiscoveryProvider } from './types.js';

/**
 * Event names emitted for diagnostics. Never carries the API token.
 * The API layer wires this to the ActivityLog so a demo reviewer can see
 * exactly which stage of the Apify flow failed.
 */
export type ApifyEvent =
  | 'apify.input.built'
  | 'apify.run.starting'
  | 'apify.run.status'
  | 'apify.run.terminal'
  | 'apify.dataset.fetching'
  | 'apify.dataset.fetched'
  | 'apify.dataset.normalized'
  | 'apify.error';

export type ApifyEventFn = (event: ApifyEvent, meta: Record<string, unknown>) => void;

export interface ApifyProviderOptions {
  token: string;
  actorId: string;
  /** Optional: pull from an existing dataset instead of running the actor. */
  datasetId?: string;
  baseUrl?: string;
  /** Max items to fetch per call. */
  limit?: number;
  /**
   * URLs the actor should crawl this run. Passed as
   * `{ startUrls: [{url}, …] }` alongside the safe defaults for
   * `apify/website-content-crawler`. Ignored when `actorInput` is provided.
   */
  startUrls?: string[];
  /**
   * Full raw JSON body to POST as the actor input. When supplied this
   * overrides the auto-built body — use it to run any non-website-crawler
   * actor without changing the provider.
   */
  actorInput?: Record<string, unknown>;
  /**
   * Max seconds to wait for the actor run to finish. Netlify Functions
   * default to a 10-second timeout; keep this well under any wrapping
   * timeout. Default: 240 s.
   */
  runTimeoutSeconds?: number;
  /**
   * Polling interval when the initial `waitForFinish` returned early.
   * Default: 3 s.
   */
  pollIntervalMs?: number;
  /**
   * Injected in tests to bypass the network entirely.
   */
  fetchImpl?: typeof fetch;
  /**
   * Diagnostic hook. Called at every meaningful stage; never receives the
   * token. Errors thrown from this callback are ignored.
   */
  onEvent?: ApifyEventFn;
}

/**
 * Actor output as emitted by `apify/website-content-crawler`. This is the
 * shape our real deploy consumes; the provider also accepts flat items with
 * top-level `title`/`text`/`html`/`publishedAt` for actors that emit those.
 */
interface ApifyDatasetItem {
  url?: string;
  title?: string;
  text?: string;
  markdown?: string;
  html?: string;
  publishedAt?: string;
  sourceType?: DiscoveredSource['sourceType'];
  metadata?: {
    title?: string | null;
    description?: string | null;
    jsonLd?: unknown;
  };
  crawl?: {
    loadedUrl?: string;
    loadedTime?: string;
  };
}

interface ApifyRunResponse {
  data?: {
    id?: string;
    status?: string;
    defaultDatasetId?: string;
    startedAt?: string;
    finishedAt?: string | null;
    statusMessage?: string | null;
  };
}

const TERMINAL_STATUSES = new Set([
  'SUCCEEDED',
  'FAILED',
  'ABORTED',
  'TIMED-OUT',
  'TIMEDOUT',
]);

/**
 * Talks to the real Apify HTTP API. Kept side-effect free at construction
 * time; missing token/actor at boot throws so the API refuses to start rather
 * than silently substituting demo data.
 *
 * The token is passed as `Authorization: Bearer …` (never in URL query
 * strings) so it doesn't leak into logs / access records.
 */
export class ApifySourceDiscoveryProvider implements SourceDiscoveryProvider {
  readonly name = 'apify';
  private readonly fetchImpl: typeof fetch;
  private readonly runTimeoutSeconds: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly opts: ApifyProviderOptions) {
    if (!opts.token) throw new Error('ApifySourceDiscoveryProvider requires a token');
    if (!opts.actorId && !opts.datasetId) {
      throw new Error('ApifySourceDiscoveryProvider requires actorId or datasetId');
    }
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.runTimeoutSeconds = opts.runTimeoutSeconds ?? 240;
    this.pollIntervalMs = opts.pollIntervalMs ?? 3_000;
  }

  async discover(): Promise<DiscoveredSource[]> {
    const base = this.opts.baseUrl ?? 'https://api.apify.com/v2';
    const limit = this.opts.limit ?? 25;

    let datasetId: string;
    let runId: string | null = null;
    try {
      const resolved = await this.resolveDatasetId(base);
      datasetId = resolved.datasetId;
      runId = resolved.runId;
    } catch (err) {
      this.emit('apify.error', {
        stage: 'run',
        actorId: this.opts.actorId,
        message: (err as Error).message,
      });
      throw err;
    }

    this.emit('apify.dataset.fetching', {
      actorId: this.opts.actorId,
      runId,
      datasetId,
      limit,
    });

    const url = new URL(`${base}/datasets/${datasetId}/items`);
    url.searchParams.set('clean', 'true');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(limit));

    const res = await this.fetchImpl(url, { headers: this.authHeaders() });
    if (!res.ok) {
      const err = new Error(`Apify dataset fetch failed: ${res.status} ${res.statusText}`);
      this.emit('apify.error', {
        stage: 'dataset',
        actorId: this.opts.actorId,
        runId,
        datasetId,
        message: err.message,
      });
      throw err;
    }
    const items = (await res.json()) as ApifyDatasetItem[];
    const now = new Date().toISOString();

    this.emit('apify.dataset.fetched', {
      actorId: this.opts.actorId,
      runId,
      datasetId,
      rawItemCount: items.length,
    });

    const normalized = items
      .map((item) => this.normalize(item, now))
      .filter((item): item is DiscoveredSource => item !== null);

    this.emit('apify.dataset.normalized', {
      actorId: this.opts.actorId,
      runId,
      datasetId,
      rawItemCount: items.length,
      normalizedItemCount: normalized.length,
      droppedItemCount: items.length - normalized.length,
    });

    return normalized;
  }

  // -------------------------------------------------------------------------
  // Actor input construction (visible so the API can log it for debugging)
  // -------------------------------------------------------------------------

  /**
   * The exact JSON body sent to the actor. Exposed as a public method so the
   * API can log it (safely — no token, no proxy secrets) before the run.
   */
  buildActorInput(): Record<string, unknown> {
    if (this.opts.actorInput) return this.opts.actorInput;
    const urls = this.opts.startUrls ?? [];
    return {
      startUrls: urls.map((url) => ({ url })),
      maxRequestsPerCrawl: Math.max(urls.length, 1),
      crawlerType: 'cheerio',
      proxyConfiguration: { useApifyProxy: true },
      saveHtml: false,
      saveMarkdown: true,
      aggressivePrune: true,
    };
  }

  // -------------------------------------------------------------------------
  // Actor run: kick off, wait, then poll if still running
  // -------------------------------------------------------------------------

  private async resolveDatasetId(
    base: string,
  ): Promise<{ datasetId: string; runId: string | null }> {
    if (this.opts.datasetId) {
      return { datasetId: this.opts.datasetId, runId: null };
    }

    const body = this.buildActorInput();
    this.emit('apify.input.built', {
      actorId: this.opts.actorId,
      startUrlCount: Array.isArray((body as { startUrls?: unknown }).startUrls)
        ? ((body as { startUrls: unknown[] }).startUrls.length)
        : null,
      inputKeys: Object.keys(body),
    });

    const initialWait = Math.min(120, this.runTimeoutSeconds);
    const runUrl = new URL(`${base}/acts/${this.opts.actorId}/runs`);
    runUrl.searchParams.set('waitForFinish', String(initialWait));

    this.emit('apify.run.starting', {
      actorId: this.opts.actorId,
      waitForFinish: initialWait,
    });

    const res = await this.fetchImpl(runUrl, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `Apify actor run failed to start: ${res.status} ${res.statusText}${
          errBody ? ' — ' + errBody.slice(0, 300) : ''
        }`,
      );
    }
    const runJson = (await res.json()) as ApifyRunResponse;
    const run = runJson.data ?? {};
    const runId = run.id ?? null;
    const datasetId = run.defaultDatasetId ?? null;
    let status = run.status ?? 'UNKNOWN';

    this.emit('apify.run.status', {
      actorId: this.opts.actorId,
      runId,
      datasetId,
      status,
      statusMessage: run.statusMessage ?? null,
    });

    if (!datasetId) {
      throw new Error(
        `Apify actor run returned no defaultDatasetId (status=${status}, runId=${runId ?? '?'})`,
      );
    }
    if (!runId) {
      // No runId means we can't poll — best-effort return the dataset.
      return { datasetId, runId: null };
    }

    if (!TERMINAL_STATUSES.has(status)) {
      status = await this.pollUntilTerminal(base, runId);
    }

    this.emit('apify.run.terminal', {
      actorId: this.opts.actorId,
      runId,
      datasetId,
      status,
    });

    if (status !== 'SUCCEEDED') {
      throw new Error(`Apify actor run finished with status=${status} (runId=${runId})`);
    }

    return { datasetId, runId };
  }

  private async pollUntilTerminal(base: string, runId: string): Promise<string> {
    const deadline = Date.now() + this.runTimeoutSeconds * 1000;
    let status = 'UNKNOWN';
    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      const res = await this.fetchImpl(new URL(`${base}/actor-runs/${runId}`), {
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        throw new Error(
          `Apify actor-runs/${runId} poll failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as ApifyRunResponse;
      status = body.data?.status ?? 'UNKNOWN';
      this.emit('apify.run.status', {
        actorId: this.opts.actorId,
        runId,
        status,
      });
      if (TERMINAL_STATUSES.has(status)) return status;
    }
    return 'TIMED-OUT';
  }

  // -------------------------------------------------------------------------
  // Dataset item → DiscoveredSource
  // -------------------------------------------------------------------------

  private normalize(item: ApifyDatasetItem, discoveredAt: string): DiscoveredSource | null {
    // URL — prefer the crawl-recorded URL (post-redirect) over the input URL.
    const url = item.crawl?.loadedUrl ?? item.url;
    if (!url) return null;

    // Body text — website-content-crawler emits `text` and `markdown`;
    // legacy actors may only emit `html`. We accept any of them.
    const rawText = item.text ?? item.markdown ?? item.html ?? '';
    if (!rawText.trim()) return null;

    const title =
      item.title ??
      item.metadata?.title ??
      safeHostname(url) ??
      '(untitled)';

    const publishedAt =
      item.publishedAt ??
      extractDatePublished(item.metadata?.jsonLd) ??
      item.crawl?.loadedTime ??
      null;

    return {
      url,
      title,
      rawText,
      discoveredAt,
      publishedAt,
      sourceType: item.sourceType ?? 'news_article',
      // Auto-classify by URL host. Grid-operator pages (liander.nl,
      // enexis.nl, stedin.net + subdomains) → 'grid_update'; everything else
      // → 'business_signal'. Kept in the generic provider so per-URL routing
      // works even when the crawler follows redirects.
      sourceClass: classifyByUrl(url),
      provider: this.name,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}` };
  }

  private emit(event: ApifyEvent, meta: Record<string, unknown>): void {
    if (!this.opts.onEvent) return;
    try {
      this.opts.onEvent(event, meta);
    } catch {
      /* ignore — diagnostics must never break the run */
    }
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Website-content-crawler routinely emits schema.org JSON-LD in
 * `metadata.jsonLd`. A common field is `datePublished` (news articles) or
 * `dateCreated` (press releases). Best-effort extraction — never throws.
 */
export function extractDatePublished(jsonLd: unknown): string | null {
  if (!jsonLd) return null;
  const candidates: unknown[] = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  for (const node of candidates) {
    if (node && typeof node === 'object') {
      const n = node as Record<string, unknown>;
      for (const key of ['datePublished', 'dateCreated', 'uploadDate']) {
        const value = n[key];
        if (typeof value === 'string' && value.trim().length > 0) return value;
      }
      // @graph nodes commonly nest the article one level down.
      const graph = n['@graph'];
      if (Array.isArray(graph)) {
        const nested = extractDatePublished(graph);
        if (nested) return nested;
      }
    }
  }
  return null;
}
