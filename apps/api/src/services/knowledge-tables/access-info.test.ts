/**
 * The access information resolver without a database (tm 310.4 · K13):
 * the fetch over real sockets — what an answer must hold, every way it fails,
 * and the SSRF refusals, none of which opens a connection — and the
 * resolver's cache, last value, back-off and shared fetch over a fake
 * runner. The database half (RLS, brands, knowledge sources, the engine) is
 * `test/integration/knowledge-tables-access-info.test.ts`.
 *
 * No real network, as in `lib/safe-fetch.test.ts`: the provider is a loopback
 * HTTPS server, the process resolver is stubbed, and an egress guard destroys
 * any socket about to dial an address that is not loopback.
 */
import dns from 'node:dns';
import diagnostics from 'node:diagnostics_channel';
import type { ServerResponse } from 'node:http';
import { isIP, type Socket } from 'node:net';
import type { AiAccessInfo } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, startFakeProvider, type FakeProvider } from '../../../test/helpers/fake-provider.js';
import { createSafeHttp } from '../../lib/safe-fetch.js';
import type { TenantRunner } from '../ai/conversation/turn.js';
import {
  ACCESS_INFO_FETCH_MAX_BYTES,
  ACCESS_INFO_USER_AGENT,
  AccessInfoResolver,
  accessInfoValueOf,
  cleanAccessText,
  createAccessInfoFetcher,
  fixedLinkText,
  type AccessInfoFetch,
  type AccessInfoFetcher,
} from './access-info.js';

let dials: string[] = [];
let stopGuard: () => void = () => {};
let provider: FakeProvider | undefined;

beforeEach(() => {
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
  // No name ever reaches real DNS; an IP literal answers as itself (listen() asks too).
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
    process.nextTick(() => {
      if (isIP(hostname) === 0) {
        const error: NodeJS.ErrnoException = new Error('ENOTFOUND');
        error.code = 'ENOTFOUND';
        done(error);
        return;
      }
      const all =
        typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
      if (all) done(null, [{ address: hostname, family: isIP(hostname) }]);
      else done(null, hostname, isIP(hostname));
    });
  }) as unknown as typeof dns.lookup);
});

afterEach(async () => {
  stopGuard();
  vi.restoreAllMocks();
  await provider?.close();
  provider = undefined;
});

function text(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

describe('the fetch (K13 · SSRF-guarded)', () => {
  it('reads a JSON value over verified TLS, as a GET with its own user agent', async () => {
    provider = await startFakeProvider((_request, response) =>
      json(response, 200, { url: 'https://giris7.ornek.com' }),
    );
    const fetcher = createAccessInfoFetcher(provider.http());
    expect(await fetcher.fetch(`${provider.base}/adres.json`)).toEqual({
      ok: true,
      value: 'https://giris7.ornek.com',
    });
    const seen = provider.requests[0]!;
    expect(seen.method).toBe('GET');
    expect(seen.path).toBe('/adres.json');
    expect(seen.headers['user-agent']).toBe(ACCESS_INFO_USER_AGENT);
  });

  it('reads plain text, a JSON string and the first known key of an object', async () => {
    provider = await startFakeProvider((_request, response) =>
      text(response, 200, '  https://giris8.ornek.com\n'),
    );
    const fetcher = createAccessInfoFetcher(provider.http());
    expect(await fetcher.fetch(`${provider.base}/a`)).toEqual({
      ok: true,
      value: 'https://giris8.ornek.com',
    });
    provider.handle((_request, response) => json(response, 200, 'https://giris9.ornek.com'));
    expect(await fetcher.fetch(`${provider.base}/a`)).toEqual({
      ok: true,
      value: 'https://giris9.ornek.com',
    });
    provider.handle((_request, response) =>
      json(response, 200, { status: 'ok', message: 'Yeni adresimiz giris10.ornek.com' }),
    );
    expect(await fetcher.fetch(`${provider.base}/a`)).toEqual({
      ok: true,
      value: 'Yeni adresimiz giris10.ornek.com',
    });
  });

  it.each([
    ['an HTML page', (r: ServerResponse) => text(r, 200, '<html>bot check</html>')],
    ['an empty answer', (r: ServerResponse) => text(r, 200, '   ')],
    ['JSON with no value', (r: ServerResponse) => json(r, 200, { ok: true })],
    ['a JSON array', (r: ServerResponse) => json(r, 200, ['https://x.ornek.com'])],
  ])('refuses %s as unreadable', async (_name, handler) => {
    provider = await startFakeProvider((_request, response) => handler(response));
    const fetcher = createAccessInfoFetcher(provider.http());
    expect(await fetcher.fetch(`${provider.base}/a`)).toEqual({ ok: false, failure: 'unreadable' });
  });

  it('fails on a status outside 2xx, a redirect, a body past the cap and a slow host', async () => {
    provider = await startFakeProvider((_request, response) => json(response, 503, {}));
    expect(await createAccessInfoFetcher(provider.http()).fetch(`${provider.base}/a`)).toEqual({
      ok: false,
      failure: 'status',
      code: '503',
    });

    // A redirect is never followed — the classic way round an address check.
    provider.handle((_request, response) => {
      response.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data' });
      response.end();
    });
    expect(await createAccessInfoFetcher(provider.http()).fetch(`${provider.base}/a`)).toEqual({
      ok: false,
      failure: 'redirect',
      code: '302',
    });

    provider.handle((_request, response) =>
      text(response, 200, 'x'.repeat(ACCESS_INFO_FETCH_MAX_BYTES + 1)),
    );
    const capped = createAccessInfoFetcher(
      provider.http({ maxBytes: ACCESS_INFO_FETCH_MAX_BYTES }),
    );
    expect(await capped.fetch(`${provider.base}/a`)).toEqual({ ok: false, failure: 'too_large' });

    provider.handle(() => new Promise<void>(() => {}));
    const slow = createAccessInfoFetcher(provider.http({ timeoutMs: 150 }));
    expect(await slow.fetch(`${provider.base}/a`)).toEqual({ ok: false, failure: 'timeout' });
  });

  describe('SSRF: what the server must never fetch', () => {
    const resolved = new Map<string, string[]>([
      ['metadata.evil.example', ['169.254.169.254']],
      ['split.evil.example', ['203.0.113.10', '10.0.0.7']],
      ['inside.evil.example', ['192.168.1.20']],
      ['v6.evil.example', ['fd00::1']],
    ]);
    const fetcher = createAccessInfoFetcher(
      createSafeHttp({
        timeoutMs: 1_000,
        resolver: async (host) => {
          const answer = resolved.get(host);
          if (!answer) throw new Error('ENOTFOUND');
          return answer;
        },
      }),
    );

    it.each([
      ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data'],
      ['a loopback literal', 'https://127.0.0.1:6379/'],
      ['an IPv6 loopback', 'https://[::1]/'],
      ['a private literal', 'https://10.1.2.3/adres'],
      ['this machine by name', 'https://localhost/adres'],
      ['a name that resolves to the metadata address', 'https://metadata.evil.example/a'],
      ['a name with one private answer among public ones', 'https://split.evil.example/a'],
      ['a name that resolves inside the network', 'https://inside.evil.example/a'],
      ['a name that resolves to a unique-local IPv6', 'https://v6.evil.example/a'],
      ['plain http', 'http://api.ornek.com/adres'],
      ['a URL with credentials', 'https://user:pass@api.ornek.com/adres'],
      ['another scheme', 'file:///etc/passwd'],
    ])('refuses %s without opening a connection', async (_name, url) => {
      const result = await fetcher.fetch(url);
      expect(result).toMatchObject({ ok: false, failure: 'blocked' });
      expect(dials).toEqual([]);
    });

    it('a name that does not resolve is a network failure, not a fetch', async () => {
      expect(await fetcher.fetch('https://nowhere.example/a')).toMatchObject({
        ok: false,
        failure: 'network',
      });
      expect(dials).toEqual([]);
    });
  });
});

describe('what a value is', () => {
  it('drops control and format characters, keeps one blank line, and cuts long text', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const bidi = String.fromCharCode(0x202e);
    const bom = String.fromCharCode(0xfeff);
    const bell = String.fromCharCode(7);
    expect(
      cleanAccessText(`${bom}giris${zeroWidth}.ornek.com${bidi}\r\n\r\n\r\n\tsatır${bell}`),
    ).toBe('giris.ornek.com\n\n satır');
    expect(cleanAccessText(' \n\t ')).toBeNull();
    const long = cleanAccessText(`${'kelime '.repeat(400)}son`)!;
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long.endsWith('kelime…')).toBe(true);
  });

  it('is markup-free and keyed', () => {
    expect(accessInfoValueOf({ text: '<!doctype html>', json: undefined })).toBeNull();
    expect(
      accessInfoValueOf({ text: '', json: { value: '  ', link: 'https://l.ornek.com' } }),
    ).toBe('https://l.ornek.com');
    expect(accessInfoValueOf({ text: '', json: 42 })).toBeNull();
  });

  it('a fixed link is the workspace’s sentence with the link, or the lead-in and the link', () => {
    expect(fixedLinkText(null, 'https://g.ornek.com', null)).toBe(
      'Güncel erişim bilgisi: https://g.ornek.com',
    );
    expect(fixedLinkText('  ', 'https://g.ornek.com', 'en')).toBe(
      'Current access information: https://g.ornek.com',
    );
    expect(fixedLinkText('Resmi adresimiz:', 'https://g.ornek.com', 'tr')).toBe(
      'Resmi adresimiz: https://g.ornek.com',
    );
    expect(
      fixedLinkText(
        'Adres https://g.ornek.com, duyurular Telegram’da.',
        'https://g.ornek.com',
        'tr',
      ),
    ).toBe('Adres https://g.ornek.com, duyurular Telegram’da.');
  });
});

// ---------------------------------------------------------------------------
// The resolver over a fake runner.
// ---------------------------------------------------------------------------

const BRAND = '7b0a3c6e-9f1d-4a2b-8c3d-111111111111';

function setting(fields: Partial<AiAccessInfo>): AiAccessInfo {
  const at = new Date('2026-10-21T09:00:00Z');
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    licenseId: 1n,
    brandId: null,
    sourceType: 'dynamic_url',
    kbSourceId: null,
    url: 'https://api.ornek.com/adres.json',
    cacheSeconds: 300,
    lastValue: null,
    lastFetchedAt: null,
    fixedText: null,
    createdBy: null,
    updatedBy: null,
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

function fakeDb(rows: AiAccessInfo[]) {
  const writes: Array<{ where: Record<string, unknown>; data: Partial<AiAccessInfo> }> = [];
  const tx = {
    aiAccessInfo: {
      findMany: async ({
        where,
      }: {
        where: { brandId?: null; OR?: Array<{ brandId: string | null }> };
      }) =>
        rows.filter(
          (row) =>
            row.brandId === null ||
            (where.OR ?? []).some((branch) => branch.brandId === row.brandId),
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<AiAccessInfo>;
      }) => {
        writes.push({ where, data });
        const hit = rows.filter((row) =>
          Object.entries(where).every(([key, value]) => row[key as keyof AiAccessInfo] === value),
        );
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
    },
  };
  const db: TenantRunner = (fn) => fn(tx as never);
  return { db, writes };
}

function scripted(...answers: AccessInfoFetch[]) {
  const urls: string[] = [];
  const fetcher: AccessInfoFetcher = {
    fetch: async (url) => {
      urls.push(url);
      return answers.shift() ?? { ok: false, failure: 'network' };
    },
  };
  return { fetcher, urls };
}

const read = (db: TenantRunner, brandId: string | null = null) => ({
  db,
  brandId,
  aiAgentId: null,
  now: new Date('2026-10-21T10:00:00Z'),
  language: 'tr' as const,
});

describe('the resolver (K13)', () => {
  it('nothing set is nothing to say', async () => {
    const { db } = fakeDb([]);
    expect(await new AccessInfoResolver({ fetcher: scripted().fetcher }).resolve(read(db))).toEqual(
      {
        kind: 'none',
        sourceType: null,
        reason: 'no_setting',
      },
    );
  });

  it('a fixed link says the link, the brand’s own setting over the every-brand one', async () => {
    const { db } = fakeDb([
      setting({ sourceType: 'fixed_link', url: 'https://tum.ornek.com' }),
      setting({
        id: 'a0000000-0000-4000-8000-000000000002',
        brandId: BRAND,
        sourceType: 'fixed_link',
        url: 'https://marka.ornek.com',
        fixedText: 'Markamızın adresi:',
      }),
    ]);
    const resolver = new AccessInfoResolver({ fetcher: scripted().fetcher });
    expect(await resolver.resolve(read(db))).toMatchObject({
      kind: 'answer',
      text: 'Güncel erişim bilgisi: https://tum.ornek.com',
      served: 'fixed',
    });
    expect(await resolver.resolve(read(db, BRAND))).toMatchObject({
      kind: 'answer',
      text: 'Markamızın adresi: https://marka.ornek.com',
    });
  });

  it('fetches, says and keeps the value — only while the row still names that URL', async () => {
    const row = setting({});
    const { db, writes } = fakeDb([row]);
    const clock = new Date('2026-10-21T10:00:00Z');
    const { fetcher, urls } = scripted({ ok: true, value: 'https://giris7.ornek.com' });
    const answer = await new AccessInfoResolver({ fetcher, clock: () => clock }).resolve(read(db));
    expect(answer).toEqual({
      kind: 'answer',
      text: 'Güncel erişim bilgisi: https://giris7.ornek.com',
      sourceType: 'dynamic_url',
      served: 'fetched',
    });
    expect(urls).toEqual(['https://api.ornek.com/adres.json']);
    expect(writes).toEqual([
      {
        where: { id: row.id, sourceType: 'dynamic_url', url: 'https://api.ornek.com/adres.json' },
        data: { lastValue: 'https://giris7.ornek.com', lastFetchedAt: clock },
      },
    ]);
  });

  it('within the cache window says the last value without asking; past it, asks', async () => {
    const fetchedAt = new Date('2026-10-21T10:00:00Z');
    const row = setting({
      lastValue: 'https://eski.ornek.com',
      lastFetchedAt: fetchedAt,
      cacheSeconds: 60,
    });
    const { db } = fakeDb([row]);
    let now = new Date(fetchedAt.getTime() + 59_000);
    const { fetcher, urls } = scripted({ ok: true, value: 'https://yeni.ornek.com' });
    const resolver = new AccessInfoResolver({ fetcher, clock: () => now });
    expect(await resolver.resolve(read(db))).toMatchObject({
      text: 'Güncel erişim bilgisi: https://eski.ornek.com',
      served: 'cached',
    });
    expect(urls).toEqual([]);
    now = new Date(fetchedAt.getTime() + 60_000);
    expect(await resolver.resolve(read(db))).toMatchObject({
      text: 'Güncel erişim bilgisi: https://yeni.ornek.com',
      served: 'fetched',
    });
    expect(urls).toHaveLength(1);
  });

  it('a failed fetch says the last known value, however old; with none, nothing', async () => {
    const old = setting({
      lastValue: 'https://eski.ornek.com',
      lastFetchedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const { db, writes } = fakeDb([old]);
    const resolver = new AccessInfoResolver({
      fetcher: scripted({ ok: false, failure: 'timeout' }).fetcher,
    });
    expect(await resolver.resolve(read(db))).toEqual({
      kind: 'answer',
      text: 'Güncel erişim bilgisi: https://eski.ornek.com',
      sourceType: 'dynamic_url',
      served: 'last_value',
      failure: 'timeout',
    });
    expect(writes).toEqual([]);

    const { db: empty } = fakeDb([setting({ id: 'a0000000-0000-4000-8000-000000000009' })]);
    expect(
      await new AccessInfoResolver({
        fetcher: scripted({ ok: false, failure: 'blocked', code: 'internal_address' }).fetcher,
      }).resolve(read(empty)),
    ).toEqual({
      kind: 'none',
      sourceType: 'dynamic_url',
      reason: 'fetch_failed',
      failure: 'blocked',
    });
  });

  it('a fetcher that throws is a network failure', async () => {
    const { db } = fakeDb([setting({})]);
    const fetcher: AccessInfoFetcher = { fetch: () => Promise.reject(new Error('boom')) };
    expect(await new AccessInfoResolver({ fetcher }).resolve(read(db))).toMatchObject({
      kind: 'none',
      reason: 'fetch_failed',
      failure: 'network',
    });
  });

  it('leaves a failing URL alone for the back-off, then asks again', async () => {
    const { db } = fakeDb([setting({})]);
    let now = new Date('2026-10-21T10:00:00Z');
    const { fetcher, urls } = scripted(
      { ok: false, failure: 'timeout' },
      { ok: true, value: 'https://geri.ornek.com' },
    );
    const resolver = new AccessInfoResolver({
      fetcher,
      clock: () => now,
      failureBackoffMs: 30_000,
    });
    expect(await resolver.resolve(read(db))).toMatchObject({ kind: 'none', failure: 'timeout' });
    now = new Date(now.getTime() + 29_000);
    expect(await resolver.resolve(read(db))).toMatchObject({ kind: 'none', failure: 'timeout' });
    expect(urls).toHaveLength(1);
    now = new Date(now.getTime() + 1_000);
    expect(await resolver.resolve(read(db))).toMatchObject({ served: 'fetched' });
    expect(urls).toHaveLength(2);
  });

  it('turns that ask at once share one fetch', async () => {
    const { db } = fakeDb([setting({})]);
    let release: (value: AccessInfoFetch) => void = () => {};
    const urls: string[] = [];
    const fetcher: AccessInfoFetcher = {
      fetch: (url) => {
        urls.push(url);
        return new Promise((resolve) => (release = resolve));
      },
    };
    const resolver = new AccessInfoResolver({ fetcher });
    const both = Promise.all([resolver.resolve(read(db)), resolver.resolve(read(db))]);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    release({ ok: true, value: 'https://tek.ornek.com' });
    const [first, second] = await both;
    expect(first).toMatchObject({ served: 'fetched' });
    expect(second).toMatchObject({ served: 'fetched' });
    expect(urls).toHaveLength(1);
  });
});
