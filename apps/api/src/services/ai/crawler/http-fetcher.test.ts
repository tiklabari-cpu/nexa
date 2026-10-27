/**
 * The real crawl fetcher over real sockets (tm 312.2 · AI-17 · NFR-S7).
 *
 * The crawler is how a workspace makes this server read a URL from inside the
 * network, so these tests are mostly about where it does *not* connect: a
 * host that resolves inward, a redirect to a literal internal address or to
 * a name that resolves inward, a rebinding name — none of them reaches the
 * "internal service" listener below, and none is even dialled. Then the
 * defensive reading: ceilings, decompression bombs, deadlines, Retry-After,
 * bot walls, TLS.
 *
 * No real network: the process resolver (`dns.lookup`) is stubbed to answer
 * every name with 127.0.0.1 — the inside — so a fetch that asked DNS for
 * itself instead of using its pin would land on the internal listener and
 * fail the test; an egress guard destroys any socket about to dial an
 * address that is not loopback, at its `lookup` event, before `connect`. The
 * test site's names end in `.test` (RFC 6761) and are pinned to loopback by
 * the test's `resolveTarget` — they stand for public hosts; every other URL
 * goes through the real SSRF check with a stub resolver.
 */
import dns from 'node:dns';
import diagnostics from 'node:diagnostics_channel';
import http from 'node:http';
import https from 'node:https';
import { isIP, type AddressInfo, type Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEBHOOK_RECEIVER_CERT_PEM,
  WEBHOOK_RECEIVER_KEY_PEM,
  WEBHOOK_TEST_CA_PEM,
} from '../../../../test/helpers/webhook-certificates.js';
import {
  assertPublicHttpUrl,
  resolvePublicHttpTarget,
  type HostResolver,
  type PublicHttpTarget,
} from '../../../lib/ssrf.js';
import { CRAWLER_USER_AGENT, type CrawlFetchRequest, type CrawlFetchResult } from './fetcher.js';
import { HostGate } from './host-gate.js';
import { createHttpCrawlFetcher, INFLATE_RATIO_MAX } from './http-fetcher.js';

/** Stands for a public website; pinned to the loopback test site. */
const SITE = 'site.example.test';
/** The test receiver certificate's name, for the TLS cases. */
const TLS_SITE = 'hooks.example.test';
/** Documentation space (RFC 5737): public to the SSRF check, reached by nobody. */
const PUBLIC_IP = '203.0.113.10';

type Respond = (request: http.IncomingMessage, response: http.ServerResponse) => void;

interface Listener {
  port: number;
  requests: Array<{ path: string; headers: http.IncomingHttpHeaders; servername?: string }>;
  url(path: string, host?: string): string;
}

const servers: Array<http.Server | https.Server> = [];

async function listen(respond: Respond, options: { tls?: boolean } = {}): Promise<Listener> {
  const requests: Listener['requests'] = [];
  const handle = (request: http.IncomingMessage, response: http.ServerResponse): void => {
    requests.push({
      path: request.url ?? '',
      headers: request.headers,
      ...(options.tls ? { servername: String((request.socket as TLSSocket).servername) } : {}),
    });
    respond(request, response);
  };
  const server = options.tls
    ? https.createServer({ key: WEBHOOK_RECEIVER_KEY_PEM, cert: WEBHOOK_RECEIVER_CERT_PEM }, handle)
    : http.createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const scheme = options.tls ? 'https' : 'http';
  return {
    port,
    requests,
    url: (path, host = options.tls ? TLS_SITE : SITE) => `${scheme}://${host}:${port}${path}`,
  };
}

const html =
  (body: string, status = 200, headers: Record<string, string> = {}): Respond =>
  (_request, response) => {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    response.end(body);
  };

let dials: string[] = [];
let processLookups: string[] = [];
let stopGuard: () => void = () => {};
/** The internal service: any request reaching it is an SSRF breach. */
let internal: Listener;

beforeEach(async () => {
  dials = [];
  const onSocket = (message: unknown): void => {
    const { socket } = message as { socket: Socket };
    socket.on('lookup', (error: Error | null, address: string) => {
      if (error) return;
      dials.push(address);
      if (!(address.startsWith('127.') || address === '::1')) socket.destroy();
    });
  };
  diagnostics.subscribe('net.client.socket', onSocket);
  stopGuard = () => diagnostics.unsubscribe('net.client.socket', onSocket);

  processLookups = [];
  vi.spyOn(dns, 'lookup').mockImplementation(((
    hostname: string,
    options: unknown,
    callback?: unknown,
  ) => {
    const done = (typeof options === 'function' ? options : callback) as (
      e: NodeJS.ErrnoException | null,
      a?: string | dns.LookupAddress[],
      f?: number,
    ) => void;
    const literal = isIP(hostname) !== 0;
    if (!literal) processLookups.push(hostname);
    // Every name is "inside": an unpinned lookup would reach the internal listener.
    const address = literal ? hostname : '127.0.0.1';
    process.nextTick(() => {
      const all =
        typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
      if (all) done(null, [{ address, family: isIP(address) }]);
      else done(null, address, isIP(address));
    });
  }) as unknown as typeof dns.lookup);

  internal = await listen(html('<p>instance credentials</p>'));
});

afterEach(async () => {
  stopGuard();
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

interface Harness {
  fetch(
    request: Omit<CrawlFetchRequest, 'purpose'> & { purpose?: CrawlFetchRequest['purpose'] },
  ): Promise<CrawlFetchResult>;
  /** Every URL the fetcher asked to have checked, in order — one per hop and retry. */
  hops: string[];
  /** Retry-After waits, in ms. */
  waits: number[];
}

/**
 * The fetcher under test. `answers` is the stub resolver the real SSRF check
 * asks for any name that is not the test site's.
 */
function harness(
  options: {
    answers?: Record<string, () => string[]>;
    timeoutMs?: number;
    ca?: string | null;
    retryAfterMaxMs?: number;
  } = {},
): Harness {
  const hops: string[] = [];
  const waits: number[] = [];
  const resolver: HostResolver = async (hostname) => {
    const answer = options.answers?.[hostname];
    if (!answer) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return answer();
  };
  const resolveTarget = async (url: string): Promise<PublicHttpTarget> => {
    hops.push(url);
    const parsed = assertPublicHttpUrl(url);
    if (
      parsed.hostname === SITE ||
      parsed.hostname === TLS_SITE ||
      parsed.hostname === 'wrong.example.test'
    ) {
      return { url: parsed, addresses: [{ address: '127.0.0.1', family: 4 }] };
    }
    return resolvePublicHttpTarget(url, resolver);
  };
  const fetcher = createHttpCrawlFetcher({
    resolveTarget,
    gate: new HostGate({ intervalMs: 0 }),
    timeoutMs: options.timeoutMs ?? 5_000,
    ...(options.ca === null ? {} : { ca: options.ca ?? WEBHOOK_TEST_CA_PEM }),
    now: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    ...(options.retryAfterMaxMs === undefined ? {} : { retryAfterMaxMs: options.retryAfterMaxMs }),
  });
  return {
    hops,
    waits,
    fetch: (request) => fetcher.fetch({ purpose: 'page', ...request }),
  };
}

function expectFailed(result: CrawlFetchResult, error: string): void {
  expect(result).toMatchObject({ kind: 'failed', error });
}

describe('http crawl fetcher — reads a site (FR-MOD-06.3.2)', () => {
  it('fetches a page with the crawler’s headers, the site’s name in Host, pinned to its address', async () => {
    const site = await listen(html('<p>Merhaba</p>'));
    const { fetch } = harness();
    const result = await fetch({ url: site.url('/yardim') });
    expect(result).toMatchObject({
      kind: 'ok',
      status: 200,
      url: site.url('/yardim'),
      contentType: 'text/html; charset=utf-8',
      truncated: false,
      redirects: 0,
    });
    expect(result.kind === 'ok' && result.body.toString()).toBe('<p>Merhaba</p>');
    expect(result.bytes).toBe(14);
    const seen = site.requests[0]!;
    expect(seen.headers['host']).toBe(`${SITE}:${site.port}`);
    expect(seen.headers['user-agent']).toBe(CRAWLER_USER_AGENT);
    expect(seen.headers['accept']).toMatch(/^text\/html/);
    expect(seen.headers['accept-encoding']).toBe('gzip, deflate, br');
    expect(processLookups).toEqual([]);
  });

  it('asks robots.txt and sitemaps for their own media types', async () => {
    const site = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *');
    });
    const { fetch } = harness();
    expect((await fetch({ url: site.url('/robots.txt'), purpose: 'robots' })).kind).toBe('ok');
    expect((await fetch({ url: site.url('/sitemap.xml'), purpose: 'sitemap' })).kind).toBe('ok');
    expect(site.requests[0]!.headers['accept']).toMatch(/^text\/plain/);
    expect(site.requests[1]!.headers['accept']).toMatch(/^application\/xml/);
  });

  it('decodes gzip, deflate and brotli bodies', async () => {
    const page = '<p>sıkıştırılmış içerik</p>'.repeat(50);
    const encoders: Record<string, (b: Buffer) => Buffer> = {
      gzip: zlib.gzipSync,
      deflate: zlib.deflateSync,
      br: zlib.brotliCompressSync,
    };
    for (const [encoding, encode] of Object.entries(encoders)) {
      const site = await listen((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': encoding });
        response.end(encode(Buffer.from(page)));
      });
      const result = await harness().fetch({ url: site.url('/') });
      expect(result.kind === 'ok' && result.body.toString()).toBe(page);
    }
  });

  it('follows redirects on the site, checking every hop, and keeps no cookie between them', async () => {
    const site = await listen((request, response) => {
      const step = Number(request.url?.slice(1) || '0');
      if (step < 5) {
        response.writeHead(302, { location: `/${step + 1}`, 'set-cookie': 'session=abc' });
        response.end();
        return;
      }
      html('<p>son</p>')(request, response);
    });
    const { fetch, hops } = harness();
    const result = await fetch({ url: site.url('/0'), allowRedirect: () => true });
    expect(result).toMatchObject({ kind: 'ok', redirects: 5, url: site.url('/5') });
    expect(hops).toEqual([0, 1, 2, 3, 4, 5].map((n) => site.url(`/${n}`)));
    expect(site.requests.every((r) => r.headers['cookie'] === undefined)).toBe(true);
  });

  it('gives up after five redirects', async () => {
    const site = await listen((request, response) => {
      response.writeHead(301, { location: `${request.url}x` });
      response.end();
    });
    const result = await harness().fetch({ url: site.url('/a') });
    expectFailed(result, 'redirect_limit');
    expect(site.requests).toHaveLength(6);
  });

  it('reports a 404 and a 410 as statuses, not failures', async () => {
    for (const status of [404, 410, 500]) {
      const site = await listen(html('yok', status));
      expect(await harness().fetch({ url: site.url('/') })).toMatchObject({
        kind: 'http_error',
        status,
      });
    }
  });
});

describe('http crawl fetcher — never connects inward (NFR-S7 · FR-MOD-06.3.2)', () => {
  it('refuses a host that resolves to an internal address, without dialling it', async () => {
    const inward: Record<string, () => string[]> = {
      'ten.example': () => ['10.0.0.5'],
      'meta.example': () => ['169.254.169.254'],
      'loop.example': () => ['127.0.0.1'],
      'six.example': () => ['::1'],
      'mapped.example': () => ['::ffff:127.0.0.1'],
      'mixed.example': () => [PUBLIC_IP, '192.168.1.10'],
    };
    const { fetch } = harness({ answers: inward });
    for (const host of Object.keys(inward)) {
      expectFailed(await fetch({ url: `http://${host}:${internal.port}/` }), 'ssrf_refused');
    }
    expect(dials).toEqual([]);
    expect(internal.requests).toEqual([]);
  });

  it('refuses a literal internal address however it is spelled', async () => {
    const { fetch } = harness();
    for (const url of [
      `http://127.0.0.1:${internal.port}/`,
      `http://2130706433:${internal.port}/`,
      `http://0x7f.1:${internal.port}/`,
      `http://[::1]:${internal.port}/`,
      `http://[::ffff:7f00:1]:${internal.port}/`,
      'http://169.254.169.254/latest/meta-data/',
      `http://localhost:${internal.port}/`,
    ]) {
      expectFailed(await fetch({ url }), 'ssrf_refused');
    }
    expect(internal.requests).toEqual([]);
  });

  it('refuses a redirect to a literal internal address before asking for it', async () => {
    const site = await listen((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${internal.port}/secret` });
      response.end();
    });
    const result = await harness().fetch({ url: site.url('/'), allowRedirect: () => true });
    expectFailed(result, 'ssrf_refused');
    expect(result.url).toBe(`http://127.0.0.1:${internal.port}/secret`);
    expect(internal.requests).toEqual([]);
  });

  it('refuses a redirect to a name that resolves inward, without dialling it', async () => {
    const site = await listen((_request, response) => {
      response.writeHead(301, { location: `http://intranet.example:${internal.port}/` });
      response.end();
    });
    const { fetch, hops } = harness({ answers: { 'intranet.example': () => ['10.1.2.3'] } });
    expectFailed(await fetch({ url: site.url('/') }), 'ssrf_refused');
    expect(hops).toEqual([site.url('/'), `http://intranet.example:${internal.port}/`]);
    expect(dials).toEqual(['127.0.0.1']);
    expect(internal.requests).toEqual([]);
  });

  it('connects to the checked address, not to what the name answers next (DNS rebinding)', async () => {
    let asked = 0;
    const { fetch } = harness({
      answers: { 'rebind.example': () => (asked++ === 0 ? [PUBLIC_IP] : ['127.0.0.1']) },
    });
    const result = await fetch({ url: `http://rebind.example:${internal.port}/` });
    expectFailed(result, 'network');
    // Dialled the pinned public address — which the guard cut off — never
    // the loopback answer a second lookup would have given.
    expect(dials).toEqual([PUBLIC_IP]);
    expect(processLookups).toEqual([]);
    expect(internal.requests).toEqual([]);
  });

  it('refuses a redirect to another scheme, to credentials, or to nowhere', async () => {
    for (const location of ['file:///etc/passwd', 'gopher://site.example.test/', 'http://[', '']) {
      const site = await listen((_request, response) => {
        response.writeHead(302, location === '' ? {} : { location });
        response.end();
      });
      const result = await harness().fetch({ url: site.url('/') });
      if (location === '') expect(result).toMatchObject({ kind: 'http_error', status: 302 });
      else expectFailed(result, 'redirect_invalid');
    }
    const site = await listen((_request, response) => {
      response.writeHead(302, { location: `http://user:pw@${SITE}:${internal.port}/` });
      response.end();
    });
    expectFailed(await harness().fetch({ url: site.url('/') }), 'ssrf_refused');
    expect(internal.requests).toEqual([]);
  });

  it('does not ask for a redirect target outside the crawl’s scope', async () => {
    const elsewhere = await listen(html('<p>başka site</p>'));
    const site = await listen((_request, response) => {
      response.writeHead(302, { location: elsewhere.url('/', 'other.example.test') });
      response.end();
    });
    const allowRedirect = vi.fn((url: URL) => url.hostname === SITE);
    const result = await harness().fetch({ url: site.url('/'), allowRedirect });
    expectFailed(result, 'redirect_out_of_scope');
    expect(allowRedirect).toHaveBeenCalledWith(new URL(elsewhere.url('/', 'other.example.test')));
    expect(elsewhere.requests).toEqual([]);
  });

  it('fails a host that does not resolve as dns_failed', async () => {
    expectFailed(await harness().fetch({ url: 'http://nowhere.example/' }), 'dns_failed');
  });
});

describe('http crawl fetcher — reads a stranger’s answer defensively (NFR-S7 · FR-MOD-06.3.2)', () => {
  it('refuses a body past its ceiling, declared or streamed', async () => {
    const declared = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-length': '2048' });
      response.end('x'.repeat(2048));
    });
    expectFailed(await harness().fetch({ url: declared.url('/'), maxBytes: 1024 }), 'too_large');

    const streamed = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      for (let i = 0; i < 64; i += 1) response.write('y'.repeat(1024));
      response.end();
    });
    expectFailed(await harness().fetch({ url: streamed.url('/'), maxBytes: 4096 }), 'too_large');
  });

  it('keeps the first bytes instead when asked to truncate', async () => {
    const site = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('abcdefghij'.repeat(100));
    });
    const result = await harness().fetch({
      url: site.url('/robots.txt'),
      purpose: 'robots',
      maxBytes: 25,
      truncate: true,
    });
    expect(result).toMatchObject({ kind: 'ok', truncated: true });
    expect(result.kind === 'ok' && result.body.toString()).toBe('abcdefghijabcdefghijabcde');
  });

  it('stops a decompression bomb by its inflation ratio, even under the ceiling', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x20), { level: 9 });
    expect((4 * 1024 * 1024) / bomb.length).toBeGreaterThan(INFLATE_RATIO_MAX);
    const site = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end(bomb);
    });
    expectFailed(await harness().fetch({ url: site.url('/') }), 'compression_ratio');
  });

  it('stops a bomb that would inflate far past the ceiling', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(16 * 1024 * 1024), { level: 9 });
    const site = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end(bomb);
    });
    const result = await harness().fetch({ url: site.url('/') });
    expect(result.kind).toBe('failed');
    expect(['compression_ratio', 'too_large']).toContain(result.kind === 'failed' && result.error);
  });

  it('refuses an encoding it does not read, and a corrupt compressed body', async () => {
    const odd = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'compress' });
      response.end('x');
    });
    expectFailed(await harness().fetch({ url: odd.url('/') }), 'unsupported_encoding');
    const corrupt = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end('not gzip at all');
    });
    expectFailed(await harness().fetch({ url: corrupt.url('/') }), 'unsupported_encoding');
  });

  it('does not download a page that is not HTML', async () => {
    const site = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/pdf' });
      response.end(Buffer.alloc(1024));
    });
    const result = await harness().fetch({ url: site.url('/kurallar.pdf') });
    expectFailed(result, 'not_html');
    expect(result).toMatchObject({ status: 200 });
  });

  it('gives up on a site that never answers, or answers too slowly', async () => {
    const silent = await listen(() => {});
    const started = Date.now();
    expectFailed(await harness({ timeoutMs: 300 }).fetch({ url: silent.url('/') }), 'timeout');
    expect(Date.now() - started).toBeLessThan(5_000);

    const drip = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<p>');
    });
    expectFailed(await harness({ timeoutMs: 300 }).fetch({ url: drip.url('/') }), 'timeout');
  });

  it('stops when the job is cancelled', async () => {
    const silent = await listen(() => {});
    const controller = new AbortController();
    const pending = harness().fetch({ url: silent.url('/'), signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    expectFailed(await pending, 'cancelled');
    const before = new AbortController();
    before.abort();
    expectFailed(
      await harness().fetch({ url: silent.url('/'), signal: before.signal }),
      'cancelled',
    );
  });

  it('waits out a Retry-After it can afford, twice at most', async () => {
    let calls = 0;
    const site = await listen((request, response) => {
      calls += 1;
      if (calls <= 2) {
        response.writeHead(429, { 'retry-after': '2' });
        response.end();
        return;
      }
      html('<p>tamam</p>')(request, response);
    });
    const { fetch, waits, hops } = harness();
    expect(await fetch({ url: site.url('/') })).toMatchObject({ kind: 'ok' });
    expect(waits).toEqual([2000, 2000]);
    expect(hops).toHaveLength(3);

    const busy = await listen((_request, response) => {
      response.writeHead(503, { 'retry-after': '1' });
      response.end();
    });
    const second = harness();
    expect(await second.fetch({ url: busy.url('/') })).toMatchObject({
      kind: 'http_error',
      status: 503,
    });
    expect(busy.requests).toHaveLength(3);
  });

  it('does not wait out a Retry-After longer than it can afford, or one it cannot read', async () => {
    for (const retryAfter of ['3600', 'soon']) {
      const site = await listen((_request, response) => {
        response.writeHead(429, { 'retry-after': retryAfter });
        response.end();
      });
      const { fetch, waits } = harness();
      expect(await fetch({ url: site.url('/') })).toMatchObject({
        kind: 'http_error',
        status: 429,
      });
      expect(waits).toEqual([]);
    }
  });

  it('calls a bot wall blocked, without retrying it', async () => {
    const challenge = await listen((_request, response) => {
      response.writeHead(503, {
        'cf-mitigated': 'challenge',
        'retry-after': '1',
        server: 'cloudflare',
      });
      response.end('<title>Just a moment...</title>');
    });
    const { fetch, waits } = harness();
    expect(await fetch({ url: challenge.url('/') })).toMatchObject({
      kind: 'blocked',
      status: 503,
    });
    expect(waits).toEqual([]);

    const gzipped = await listen((_request, response) => {
      response.writeHead(403, { 'content-encoding': 'gzip', server: 'cloudflare' });
      response.end(
        zlib.gzipSync('<html><script src="/cdn-cgi/challenge-platform/h/b"></script></html>'),
      );
    });
    expect(await fetch({ url: gzipped.url('/') })).toMatchObject({ kind: 'blocked', status: 403 });
  });

  it('checks the certificate against the site’s name, and sends that name as SNI', async () => {
    const site = await listen(html('<p>güvenli</p>'), { tls: true });
    const ok = await harness().fetch({ url: site.url('/') });
    expect(ok).toMatchObject({ kind: 'ok', status: 200 });
    expect(site.requests[0]!.servername).toBe(TLS_SITE);

    expectFailed(await harness().fetch({ url: site.url('/', 'wrong.example.test') }), 'tls');
    expectFailed(await harness({ ca: null }).fetch({ url: site.url('/') }), 'tls');
  });
});
