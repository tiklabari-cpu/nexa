/**
 * The widget keeps its token mint for the tab (tm 429 · audit F11).
 *
 * The widget minted on every page load, and the mint shared the API's
 * anonymous per-address budget with sign-in: behind one office NAT, ten
 * visitors opening three or four pages each spent it, and the widget said it
 * could not connect. A page of the same tab now takes on the last mint — the
 * token and everything that came with it — from sessionStorage, for half an
 * hour at most and never within a minute of the token's expiry, and reports
 * the page it is on (`POST /customer/visit`) as the mint would have. A 401
 * mints once past it and retries once. A first visit's mint is kept only once
 * the next mint has said whether the member cookie works.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetApi, WidgetApiError, storageKeys } from './api.js';

const ORG = '7f8b4a62-5c1e-4b9e-9a77-0d1e2f3a4b5c';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b2';
const API = 'https://api.example/api/v1';
const SITE = 'https://shop.example';
const MEMBER = 'nxm1.1.member.sig';

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
  bearer: string | undefined;
}

let calls: Call[] = [];
let minted = 0;
let expiresIn: number | undefined = 28_800;
/** Tokens the API no longer takes: their requests answer 401. */
let refused: (token: string | undefined) => boolean = () => false;
/**
 * Whether this browser keeps the partitioned member cookie. When it does, a
 * mint that presented the copy is answered without one — the cookie carried
 * it. Off by default: the browser of most tests holds its copy (below).
 */
let cookieWorks = false;

beforeEach(() => {
  calls = [];
  minted = 0;
  expiresIn = 28_800;
  refused = () => false;
  cookieWorks = false;
  window.localStorage.clear();
  // A browser that has met this workspace and keeps its member token in
  // storage — its cookie blocked — so every mint it makes is kept.
  window.localStorage.setItem(storageKeys(ORG).memberToken, MEMBER);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const bearer = headers['authorization']?.replace(/^Bearer /, '');
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ url, method: init?.method ?? 'GET', body, bearer });
      if (url.endsWith('/customer/token') && init?.method === 'DELETE') {
        return { ok: true, status: 204 } as Response;
      }
      if (url.endsWith('/customer/token')) {
        minted += 1;
        // A fresh object per answer: the widget keeps what it is handed.
        const answer = {
          token: `nxc1.token-${minted}.sig`,
          ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
          customer_id: 'cust-1',
          ...(cookieWorks && body?.['member_token'] ? {} : { member_token: MEMBER }),
          rtm_url: 'wss://rtm.example/rtm/customer',
          widget: { language: 'en', launcher_visibility: 'always' },
          file_sharing_enabled: false,
          campaign_tracking: true,
          pre_chat_form: [{ id: 'f1', label: 'Order number', type: 'text', required: false }],
        };
        return { ok: true, status: 200, json: async () => answer } as unknown as Response;
      }
      if (refused(bearer)) {
        return {
          ok: false,
          status: 401,
          headers: new Headers(),
          json: async () => ({ error: { type: 'authentication', message: 'Expired.' } }),
        } as unknown as Response;
      }
      if (url.endsWith('/customer/visit')) return { ok: true, status: 204 } as Response;
      return {
        ok: true,
        status: 200,
        json: async () => ({ chat: null, events: [] }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mints = (): Call[] =>
  calls.filter((c) => c.url.endsWith('/customer/token') && c.method === 'POST');
const visits = (): Call[] => calls.filter((c) => c.url.endsWith('/customer/visit'));

/** One page load of the tab: a new widget instance on `page`. */
function page(
  path: string,
  options: { org?: string; site?: string; from?: string; language?: string } = {},
): WidgetApi {
  const site = options.site ?? SITE;
  const api = new WidgetApi(API, options.org ?? ORG, site);
  if (options.language) api.localeHints = { language: options.language, browser: [] };
  api.pageHints = {
    host_url: `${site}${path}`,
    ...(options.from ? { host_referrer: `${site}${options.from}` } : {}),
  };
  return api;
}

describe('the token mint kept for the tab (tm 429)', () => {
  it('lets the next page reuse the token and everything minted with it, without minting', async () => {
    const first = page('/shoes');
    await first.connect();
    const second = page('/shoes/red', { from: '/shoes' });
    await second.connect();

    expect(mints()).toHaveLength(1);
    expect(second.token).toBe(first.token);
    expect(second.rtmUrl).toBe('wss://rtm.example/rtm/customer');
    expect(second.appearance).toEqual(first.appearance);
    expect(second.fileSharingEnabled).toBe(false);
    expect(second.campaignTracking).toBe(true);
    expect(second.preChatForm).toEqual(first.preChatForm);
    // The conversation is read with the kept token.
    expect(calls.at(-1)?.bearer).toBe('nxc1.token-1.sig');
  });

  it('reports the page the visitor moved to, as the mint would have (EN-04)', async () => {
    await page('/shoes').connect();
    expect(visits()).toEqual([]); // the mint recorded that one itself

    await page('/shoes/red', { from: '/shoes' }).connect();
    await vi.waitFor(() => expect(visits()).toHaveLength(1));
    expect(visits()[0]).toMatchObject({
      method: 'POST',
      bearer: 'nxc1.token-1.sig',
      body: { url: `${SITE}/shoes/red`, referrer: `${SITE}/shoes` },
    });
  });

  it('keeps the member token out of the tab’s storage, and its copy where it was', async () => {
    await page('/').connect();
    await page('/next').connect();

    const kept = Object.keys(window.sessionStorage).map((key) =>
      window.sessionStorage.getItem(key),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).not.toContain(MEMBER);
    // A reused mint carries no member token, and must not read as the cookie
    // having taken it: the localStorage copy stays.
    expect(window.localStorage.getItem(storageKeys(ORG).memberToken)).toBe(MEMBER);
  });

  it('mints again once half an hour has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    await page('/').connect();

    vi.setSystemTime(new Date('2026-11-08T10:29:00Z'));
    await page('/a').connect();
    expect(mints()).toHaveLength(1);

    vi.setSystemTime(new Date('2026-11-08T10:31:00Z'));
    await page('/b').connect();
    expect(mints()).toHaveLength(2);
  });

  it('does not reuse a token within a minute of its expiry', async () => {
    expiresIn = 90;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    await page('/').connect();

    vi.setSystemTime(new Date('2026-11-08T10:00:20Z'));
    await page('/a').connect();
    expect(mints()).toHaveLength(1);

    // 31 s later the token has 59 s left: not worth handing to a new page.
    vi.setSystemTime(new Date('2026-11-08T10:00:31Z'));
    await page('/b').connect();
    expect(mints()).toHaveLength(2);
  });

  it('keeps nothing from a server that does not say how long its token lives', async () => {
    expiresIn = undefined;
    await page('/').connect();
    await page('/a').connect();
    expect(mints()).toHaveLength(2);
  });

  it('keeps one mint per workspace, per site and per snippet language', async () => {
    window.localStorage.setItem(storageKeys(OTHER_ORG).memberToken, MEMBER);
    await page('/').connect();
    await page('/', { org: OTHER_ORG }).connect();
    await page('/', { site: 'https://blog.example' }).connect();
    await page('/', { language: 'tr' }).connect();
    expect(mints()).toHaveLength(4);
    expect(mints()[3]?.body?.['language']).toBe('tr');

    await page('/again').connect();
    await page('/again', { org: OTHER_ORG }).connect();
    await page('/again', { language: 'tr' }).connect();
    expect(mints()).toHaveLength(4);
  });

  it('mints a first visit’s second page once more, to learn the cookie took the member token', async () => {
    window.localStorage.clear();
    cookieWorks = true;

    // First visit: nothing presented, the token handed over in the body.
    await page('/').connect();
    expect(window.localStorage.getItem(storageKeys(ORG).memberToken)).toBe(MEMBER);
    // Not kept: the next page mints, presenting the copy — and the answer
    // without one says the cookie carried it, so the copy goes.
    await page('/a').connect();
    expect(mints()).toHaveLength(2);
    expect(mints()[1]?.body?.['member_token']).toBe(MEMBER);
    expect(window.localStorage.getItem(storageKeys(ORG).memberToken)).toBeNull();
    // Settled: from here the tab reuses.
    await page('/b').connect();
    expect(mints()).toHaveLength(2);
  });

  it('keeps the second mint where the cookie is refused, and the copy with it', async () => {
    window.localStorage.clear();

    await page('/').connect();
    await page('/a').connect();
    await page('/b').connect();
    expect(mints()).toHaveLength(2);
    expect(window.localStorage.getItem(storageKeys(ORG).memberToken)).toBe(MEMBER);
  });

  it('mints past the kept token on a 401, retries once, and keeps the new one', async () => {
    await page('/').connect();
    refused = (token) => token === 'nxc1.token-1.sig';

    const next = page('/a');
    const state = await next.connect();
    expect(state).toEqual({ chat: null, events: [] });
    expect(mints()).toHaveLength(2);
    expect(next.token).toBe('nxc1.token-2.sig');

    // The next page takes on the new mint.
    await page('/b').connect();
    expect(mints()).toHaveLength(2);
    expect(calls.at(-1)?.bearer).toBe('nxc1.token-2.sig');
  });

  it('takes a second 401 as the answer instead of minting in a loop', async () => {
    refused = (token) => token !== undefined;

    const error = await page('/')
      .connect()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WidgetApiError);
    expect((error as WidgetApiError).status).toBe(401);
    expect(mints()).toHaveLength(2);
  });

  it('mints when the page has just signed a member in (ID-03 · K28)', async () => {
    await page('/').connect();
    const identified = page('/account');
    identified.pageHints.identity = { member: 'signed-by-the-site' };
    await identified.connect();

    expect(mints()).toHaveLength(2);
    expect(mints()[1]?.body?.['identity']).toEqual({ member: 'signed-by-the-site' });
    expect(identified.token).toBe('nxc1.token-2.sig');
  });

  it('forgets the kept mint when the site signs its visitor out', async () => {
    const first = page('/');
    await first.connect();
    await first.forget();
    expect(Object.keys(window.sessionStorage)).toEqual([]);

    await page('/after').connect();
    expect(mints()).toHaveLength(2);
  });

  it('mints on every page, as before, where the tab’s storage refuses', async () => {
    const denied = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.stubGlobal('sessionStorage', {
      getItem: denied,
      setItem: denied,
      removeItem: denied,
      key: denied,
      get length() {
        return denied();
      },
    });

    await page('/').connect();
    await page('/a').connect();
    expect(mints()).toHaveLength(2);
  });
});
