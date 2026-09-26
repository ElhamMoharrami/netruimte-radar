import { describe, expect, it, vi } from 'vitest';
import { ApifySourceDiscoveryProvider, extractDatePublished } from './apifyProvider.js';

/**
 * Fixture matching the exact shape of `apify/website-content-crawler` output
 * we verified against the PostNL press release:
 *   https://newsroom.postnl.nl/en-NL/259192-postnl-aims-to-develop-charging-hubs-for-truck-transport/
 */
const POSTNL_FIXTURE = {
  url: 'https://newsroom.postnl.nl/en-NL/259192-postnl-aims-to-develop-charging-hubs-for-truck-transport/',
  crawl: {
    loadedUrl:
      'https://newsroom.postnl.nl/en-NL/259192-postnl-aims-to-develop-charging-hubs-for-truck-transport/',
    loadedTime: '2026-01-15T09:12:44.317Z',
  },
  metadata: {
    title: 'PostNL aims to develop charging hubs for truck transport',
    description: 'PostNL press release on developing charging hubs.',
    jsonLd: [
      {
        '@type': 'NewsArticle',
        headline: 'PostNL aims to develop charging hubs for truck transport',
        datePublished: '2025-12-04T08:00:00+01:00',
      },
    ],
  },
  text: 'PostNL is exploring the development of dedicated charging hubs for electric truck transport across the Netherlands. The hubs will service PostNL fleets and third-party carriers.',
  markdown:
    '# PostNL aims to develop charging hubs for truck transport\n\nPostNL is exploring the development of dedicated charging hubs...',
  html: null,
  htmlUrl: null,
  screenshotUrl: null,
  debug: { requestHandlerMode: 'http' },
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('ApifySourceDiscoveryProvider — actor input', () => {
  it('builds the same JSON body we verified manually', () => {
    const p = new ApifySourceDiscoveryProvider({
      token: 'sk-test',
      // Synthetic id — the fake fetch never validates it. Must NOT match any
      // real APIFY_ACTOR_ID env value or Netlify's secret scanner rejects the build.
      actorId: 'actor_fake_test_id',
      startUrls: [
        'https://newsroom.postnl.nl/en-NL/259192-postnl-aims-to-develop-charging-hubs-for-truck-transport/',
      ],
    });
    const body = p.buildActorInput();
    expect(body).toEqual({
      startUrls: [
        {
          url: 'https://newsroom.postnl.nl/en-NL/259192-postnl-aims-to-develop-charging-hubs-for-truck-transport/',
        },
      ],
      maxRequestsPerCrawl: 1,
      crawlerType: 'cheerio',
      proxyConfiguration: { useApifyProxy: true },
      saveHtml: false,
      saveMarkdown: true,
      aggressivePrune: true,
    });
  });

  it('passes actorInput verbatim when supplied (overrides startUrls)', () => {
    const p = new ApifySourceDiscoveryProvider({
      token: 'sk-test',
      // Synthetic id — the fake fetch never validates it. Must NOT match any
      // real APIFY_ACTOR_ID env value or Netlify's secret scanner rejects the build.
      actorId: 'actor_fake_test_id',
      startUrls: ['https://ignored.example/'],
      actorInput: { startUrls: [{ url: 'https://kept.example/' }], custom: true },
    });
    expect(p.buildActorInput()).toEqual({
      startUrls: [{ url: 'https://kept.example/' }],
      custom: true,
    });
  });
});

describe('ApifySourceDiscoveryProvider — end-to-end against the PostNL fixture', () => {
  it('runs the actor, polls to terminal, fetches dataset, normalizes 1 record', async () => {
    const seen: Array<{ url: URL | string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const urlStr = input.toString();
      seen.push({ url: urlStr, init });
      // 1) POST /acts/<id>/runs   → returns RUNNING (forces the poller)
      if (urlStr.includes('/acts/') && urlStr.includes('/runs')) {
        return jsonResponse({
          data: {
            id: 'run_abc',
            status: 'RUNNING',
            defaultDatasetId: 'ds_xyz',
            startedAt: '2026-01-15T09:12:00.000Z',
            finishedAt: null,
          },
        });
      }
      // 2) GET /actor-runs/run_abc  → SUCCEEDED on the first poll
      if (urlStr.includes('/actor-runs/run_abc')) {
        return jsonResponse({
          data: { id: 'run_abc', status: 'SUCCEEDED', defaultDatasetId: 'ds_xyz' },
        });
      }
      // 3) GET /datasets/ds_xyz/items → the PostNL fixture
      if (urlStr.includes('/datasets/ds_xyz/items')) {
        return jsonResponse([POSTNL_FIXTURE]);
      }
      throw new Error('unexpected URL in fake fetch: ' + urlStr);
    };
    const events: Array<{ event: string; meta: Record<string, unknown> }> = [];
    const p = new ApifySourceDiscoveryProvider({
      token: 'sk-test',
      // Synthetic id — the fake fetch never validates it. Must NOT match any
      // real APIFY_ACTOR_ID env value or Netlify's secret scanner rejects the build.
      actorId: 'actor_fake_test_id',
      startUrls: [POSTNL_FIXTURE.url],
      fetchImpl,
      pollIntervalMs: 1,
      onEvent: (event, meta) => events.push({ event, meta }),
    });
    const docs = await p.discover();

    // Post-mortem: exactly one normalized source, coming from the fixture.
    expect(docs).toHaveLength(1);
    const doc = docs[0]!;
    expect(doc.url).toBe(POSTNL_FIXTURE.url);
    expect(doc.title).toBe('PostNL aims to develop charging hubs for truck transport');
    expect(doc.rawText).toContain('charging hubs for electric truck transport');
    expect(doc.publishedAt).toBe('2025-12-04T08:00:00+01:00');
    expect(doc.sourceType).toBe('news_article');
    expect(doc.provider).toBe('apify');

    // Diagnostic events fired in order (token never appears in any event).
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain('apify.input.built');
    expect(eventNames).toContain('apify.run.starting');
    expect(eventNames).toContain('apify.run.status');
    expect(eventNames).toContain('apify.run.terminal');
    expect(eventNames).toContain('apify.dataset.fetching');
    expect(eventNames).toContain('apify.dataset.fetched');
    expect(eventNames).toContain('apify.dataset.normalized');
    for (const e of events) {
      expect(JSON.stringify(e.meta)).not.toContain('sk-test');
    }

    // Token is never in a URL (always in Authorization header).
    for (const call of seen) {
      expect(call.url.toString()).not.toContain('sk-test');
      const auth = (call.init?.headers as Record<string, string> | undefined)?.authorization ?? '';
      if (auth) expect(auth).toBe('Bearer sk-test');
    }

    // POST body is the exact JSON we verified manually (startUrls + cheerio + proxy).
    const postCall = seen.find((c) => (c.init?.method ?? 'GET') === 'POST');
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall!.init!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      startUrls: [{ url: POSTNL_FIXTURE.url }],
      crawlerType: 'cheerio',
      proxyConfiguration: { useApifyProxy: true },
      saveHtml: false,
      saveMarkdown: true,
    });
  });

  it('throws with a clear message when the actor run finishes non-SUCCESS', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (input.toString().includes('/runs')) {
        return jsonResponse({
          data: { id: 'run_x', status: 'FAILED', defaultDatasetId: 'ds_x' },
        });
      }
      return jsonResponse([]);
    };
    const events: string[] = [];
    const p = new ApifySourceDiscoveryProvider({
      token: 'sk-test',
      actorId: 'a',
      startUrls: ['https://x.example/'],
      fetchImpl,
      onEvent: (e) => events.push(e),
    });
    await expect(p.discover()).rejects.toThrow(/status=FAILED/);
    expect(events).toContain('apify.error');
  });

  it('surfaces a helpful 400 body when the actor rejects the input', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            type: 'invalid-input',
            message: 'Field input.proxyConfiguration is required.',
          },
        }),
        { status: 400, statusText: 'Bad Request' },
      );
    const p = new ApifySourceDiscoveryProvider({
      token: 'sk-test',
      actorId: 'a',
      startUrls: ['https://x.example/'],
      fetchImpl,
    });
    await expect(p.discover()).rejects.toThrow(/Bad Request.*proxyConfiguration/s);
  });

  it('drops rows without url or text/markdown/html', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const s = input.toString();
      if (s.includes('/runs')) {
        return jsonResponse({
          data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'ds' },
        });
      }
      return jsonResponse([
        POSTNL_FIXTURE,
        { url: 'https://empty.example/', text: '' },
        { text: 'no url here' },
        { url: 'https://only-html.example/', html: '<html>body</html>' },
      ]);
    };
    const p = new ApifySourceDiscoveryProvider({
      token: 'sk-test',
      actorId: 'a',
      startUrls: [POSTNL_FIXTURE.url],
      fetchImpl,
    });
    const docs = await p.discover();
    expect(docs.map((d) => d.url)).toEqual([POSTNL_FIXTURE.url, 'https://only-html.example/']);
  });
});

describe('extractDatePublished', () => {
  it('reads datePublished from a NewsArticle node', () => {
    expect(
      extractDatePublished({ '@type': 'NewsArticle', datePublished: '2025-12-04T08:00:00+01:00' }),
    ).toBe('2025-12-04T08:00:00+01:00');
  });

  it('walks an array of nodes', () => {
    expect(
      extractDatePublished([{ '@type': 'Organization' }, { datePublished: '2025-01-01' }]),
    ).toBe('2025-01-01');
  });

  it('walks an @graph tree', () => {
    expect(
      extractDatePublished({
        '@graph': [{ '@type': 'NewsArticle', datePublished: '2025-02-02' }],
      }),
    ).toBe('2025-02-02');
  });

  it('returns null when nothing is found', () => {
    expect(extractDatePublished({ foo: 'bar' })).toBeNull();
    expect(extractDatePublished(null)).toBeNull();
    expect(extractDatePublished(undefined)).toBeNull();
  });
});
