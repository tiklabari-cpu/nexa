/**
 * The member token on the widget's side (ID-03 · K4 · tm 287.2, tm 287.3).
 *
 * A returning visitor is recognised by the member token the server signed for
 * this browser, never by the customer id. The token travels in a partitioned
 * `HttpOnly` cookie the widget cannot see — so the mint is credentialed — and,
 * for a browser that will not keep that cookie, in a localStorage copy the
 * server's answer keeps current: present when the cookie did not carry it,
 * absent (and the copy deleted) when it did. Everything is kept per
 * organization, because one site's partition is shared by every workspace on
 * it. The customer id is sent only by a browser from before member tokens, for
 * the single trade the server allows during the transition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_CUSTOMER_ID_KEY,
  LEGACY_MEMBER_TOKEN_KEY,
  WidgetApi,
  isReturningVisitor,
  storageKeys,
} from './api.js';

const ORG = '7f8b4a62-5c1e-4b9e-9a77-0d1e2f3a4b5c';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b2';
const API = 'https://api.example/api/v1';
const keys = storageKeys(ORG);

interface Call {
  url: string;
  init: RequestInit | undefined;
}

let calls: Call[] = [];
let mintBodies: Array<Record<string, unknown>> = [];
let mintAnswer: Record<string, unknown> = {};
let forgetAnswer: () => Response = () => ({ ok: true, status: 204 }) as Response;

beforeEach(() => {
  calls = [];
  mintBodies = [];
  mintAnswer = { token: 'nxc1.a.b', customer_id: 'cust-new', member_token: 'nxm1.1.body.sig' };
  forgetAnswer = () => ({ ok: true, status: 204 }) as Response;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/customer/token') && init?.method === 'DELETE') return forgetAnswer();
      if (url.endsWith('/customer/token')) {
        mintBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return { ok: true, status: 200, json: async () => mintAnswer } as unknown as Response;
      }
      // `connect` reads the conversation straight after the mint.
      return {
        ok: true,
        status: 200,
        json: async () => ({ chat: null, events: [] }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mints = (): Call[] =>
  calls.filter((c) => c.url.endsWith('/customer/token') && c.init?.method === 'POST');

describe('the member token (ID-03 · K4)', () => {
  it('mints with credentials, so the browser sends and keeps the partitioned cookie', async () => {
    await new WidgetApi(API, ORG).connect();

    expect(mints()).toHaveLength(1);
    expect(mints()[0]?.init?.credentials).toBe('include');
    // The bearer calls after it need no cookie and send none.
    const others = calls.filter((c) => !c.url.endsWith('/customer/token'));
    expect(others.length).toBeGreaterThan(0);
    for (const call of others) expect(call.init?.credentials).toBeUndefined();
  });

  it('sends the member token it holds, and no customer id beside it', async () => {
    window.localStorage.setItem(keys.memberToken, 'nxm1.1.kept.sig');
    window.localStorage.setItem(keys.customerId, 'cust-1');

    await new WidgetApi(API, ORG).connect();

    expect(mintBodies).toHaveLength(1);
    expect(mintBodies[0]).toMatchObject({ organization_id: ORG, member_token: 'nxm1.1.kept.sig' });
    // The id identifies; it never authenticated, and a browser that has a
    // token has nothing to trade it for.
    expect(mintBodies[0]).not.toHaveProperty('customer_id');
  });

  it('keeps the member token the mint hands back, for the next load', async () => {
    window.localStorage.setItem(keys.memberToken, 'nxm1.1.kept.sig');
    mintAnswer = { ...mintAnswer, member_token: 'nxm1.1.resigned.sig' };

    await new WidgetApi(API, ORG).connect();

    expect(window.localStorage.getItem(keys.memberToken)).toBe('nxm1.1.resigned.sig');
    expect(window.localStorage.getItem(keys.customerId)).toBe('cust-new');

    // The next load is the returning visitor: the re-signed token goes back.
    await new WidgetApi(API, ORG).connect();
    expect(mintBodies[1]).toMatchObject({ member_token: 'nxm1.1.resigned.sig' });
  });

  it('deletes its own copy when the cookie carried the token, so it lives only where no script reads it (NFR-S2)', async () => {
    window.localStorage.setItem(keys.memberToken, 'nxm1.1.kept.sig');
    window.localStorage.setItem(keys.customerId, 'cust-1');
    // The server leaves `member_token` out exactly when the cookie carried it.
    mintAnswer = { token: 'nxc1.a.b', customer_id: 'cust-1' };

    await new WidgetApi(API, ORG).connect();

    expect(window.localStorage.getItem(keys.memberToken)).toBeNull();
    // Still a returning visitor: the cookie speaks for them now.
    expect(window.localStorage.getItem(keys.customerId)).toBe('cust-1');
    expect(isReturningVisitor(ORG)).toBe(true);

    await new WidgetApi(API, ORG).connect();
    expect(mintBodies[1]).not.toHaveProperty('member_token');
    expect(mintBodies[1]).not.toHaveProperty('customer_id');
  });

  it('a first visit sends neither, and keeps what it is handed under its organization', async () => {
    expect(isReturningVisitor(ORG)).toBe(false);

    await new WidgetApi(API, ORG).connect();

    expect(mintBodies[0]).not.toHaveProperty('member_token');
    expect(mintBodies[0]).not.toHaveProperty('customer_id');
    expect(window.localStorage.getItem(keys.memberToken)).toBe('nxm1.1.body.sig');
    expect(isReturningVisitor(ORG)).toBe(true);
  });
});

describe('one slot per organization (tm 287.3)', () => {
  it("never sends one workspace's token to another, nor overwrites it", async () => {
    // Two workspaces on one site — every hosted Chat page shares the widget's.
    window.localStorage.setItem(keys.memberToken, 'nxm1.1.org-a.sig');
    window.localStorage.setItem(keys.customerId, 'cust-a');

    await new WidgetApi(API, OTHER_ORG).connect();

    expect(mintBodies[0]).not.toHaveProperty('member_token');
    expect(mintBodies[0]).not.toHaveProperty('customer_id');
    expect(isReturningVisitor(OTHER_ORG)).toBe(true);
    expect(window.localStorage.getItem(keys.memberToken)).toBe('nxm1.1.org-a.sig');
    expect(window.localStorage.getItem(keys.customerId)).toBe('cust-a');
  });

  it('is the same slot whatever case the snippet wrote the organization in', async () => {
    window.localStorage.setItem(keys.memberToken, 'nxm1.1.kept.sig');
    window.localStorage.setItem(keys.customerId, 'cust-1');

    await new WidgetApi(API, ORG.toUpperCase()).connect();

    expect(mintBodies[0]).toMatchObject({ member_token: 'nxm1.1.kept.sig' });
  });
});

describe('the transition from the shared slot', () => {
  it('a browser from before member tokens sends its old id, once, to trade it in', async () => {
    window.localStorage.setItem(LEGACY_CUSTOMER_ID_KEY, 'cust-legacy');
    expect(isReturningVisitor(ORG)).toBe(true);
    mintAnswer = { ...mintAnswer, customer_id: 'cust-legacy' };

    await new WidgetApi(API, ORG).connect();
    expect(mintBodies[0]).toMatchObject({ customer_id: 'cust-legacy' });
    expect(mintBodies[0]).not.toHaveProperty('member_token');
    // Traded: it moved under this workspace's keys, and the shared slot is empty.
    expect(window.localStorage.getItem(LEGACY_CUSTOMER_ID_KEY)).toBeNull();

    // From now on the token speaks for it.
    await new WidgetApi(API, ORG).connect();
    expect(mintBodies[1]).toMatchObject({ member_token: 'nxm1.1.body.sig' });
    expect(mintBodies[1]).not.toHaveProperty('customer_id');
  });

  it('moves the token a tm 287.2 widget kept in the shared slot', async () => {
    window.localStorage.setItem(LEGACY_MEMBER_TOKEN_KEY, 'nxm1.1.shared.sig');
    window.localStorage.setItem(LEGACY_CUSTOMER_ID_KEY, 'cust-1');
    mintAnswer = { ...mintAnswer, customer_id: 'cust-1', member_token: 'nxm1.1.mine.sig' };

    await new WidgetApi(API, ORG).connect();

    expect(mintBodies[0]).toMatchObject({ member_token: 'nxm1.1.shared.sig' });
    expect(mintBodies[0]).not.toHaveProperty('customer_id');
    expect(window.localStorage.getItem(keys.memberToken)).toBe('nxm1.1.mine.sig');
    expect(window.localStorage.getItem(LEGACY_MEMBER_TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_CUSTOMER_ID_KEY)).toBeNull();
  });

  it('leaves the shared slot to the workspace it belongs to, and reads it only before meeting this one', async () => {
    window.localStorage.setItem(LEGACY_MEMBER_TOKEN_KEY, 'nxm1.1.theirs.sig');
    window.localStorage.setItem(LEGACY_CUSTOMER_ID_KEY, 'cust-theirs');
    // This workspace does not recognise it: a new visitor here.

    await new WidgetApi(API, ORG).connect();
    expect(window.localStorage.getItem(LEGACY_MEMBER_TOKEN_KEY)).toBe('nxm1.1.theirs.sig');
    expect(window.localStorage.getItem(LEGACY_CUSTOMER_ID_KEY)).toBe('cust-theirs');

    // Met now: its own slot answers, and the shared one is not sent again.
    await new WidgetApi(API, ORG).connect();
    expect(mintBodies[1]).toMatchObject({ member_token: 'nxm1.1.body.sig' });
    mintAnswer = { token: 'nxc1.a.b', customer_id: 'cust-new' };
    await new WidgetApi(API, ORG).connect();
    await new WidgetApi(API, ORG).connect();
    expect(mintBodies[3]).not.toHaveProperty('member_token');
    expect(mintBodies[3]).not.toHaveProperty('customer_id');
  });
});

describe('forget — the widget half of siyahtus("logout") (tm 287.3)', () => {
  it("drops every workspace's identity on this site and asks the API to expire the cookies", async () => {
    window.localStorage.setItem(keys.memberToken, 'nxm1.1.a.sig');
    window.localStorage.setItem(keys.customerId, 'cust-a');
    window.localStorage.setItem(storageKeys(OTHER_ORG).customerId, 'cust-b');
    window.localStorage.setItem(LEGACY_MEMBER_TOKEN_KEY, 'nxm1.1.old.sig');
    window.localStorage.setItem(LEGACY_CUSTOMER_ID_KEY, 'cust-old');
    window.localStorage.setItem('siyahtus.greeting_dismissed', '1');
    const api = new WidgetApi(API, ORG);
    await api.connect();
    expect(api.authenticated).toBe(true);

    await api.forget();

    expect(api.authenticated).toBe(false);
    for (const key of [
      keys.memberToken,
      keys.customerId,
      storageKeys(OTHER_ORG).customerId,
      LEGACY_MEMBER_TOKEN_KEY,
      LEGACY_CUSTOMER_ID_KEY,
    ]) {
      expect(window.localStorage.getItem(key), key).toBeNull();
    }
    // Not an identity — left alone.
    expect(window.localStorage.getItem('siyahtus.greeting_dismissed')).toBe('1');
    expect(isReturningVisitor(ORG)).toBe(false);

    const deletes = calls.filter((c) => c.init?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.url).toBe(`${API}/customer/token`);
    // The cookie is HttpOnly: only a credentialed request can expire it.
    expect(deletes[0]?.init?.credentials).toBe('include');
  });

  it('lets a mint already out land before it forgets, so neither its copy nor its cookie survives', async () => {
    const api = new WidgetApi(API, ORG);
    const connecting = api.connect();
    await api.forget();
    await connecting.catch(() => undefined);

    const order = calls.filter((c) => c.url.endsWith('/customer/token')).map((c) => c.init?.method);
    expect(order).toEqual(['POST', 'DELETE']);
    expect(window.localStorage.getItem(keys.memberToken)).toBeNull();
    expect(window.localStorage.getItem(keys.customerId)).toBeNull();
  });

  it('mints for nobody afterwards — not even when a request comes back 401', async () => {
    const api = new WidgetApi(API, ORG);
    await api.connect();
    await api.forget();
    const before = mints().length;

    await expect(api.connect()).rejects.toThrow('signed out');
    expect(mints()).toHaveLength(before);
    expect(window.localStorage.getItem(keys.customerId)).toBeNull();
  });

  it('never throws, and says so when the cookie could not be expired', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(keys.customerId, 'cust-a');

    forgetAnswer = () => ({ ok: false, status: 500 }) as Response;
    await expect(new WidgetApi(API, ORG).forget()).resolves.toBeUndefined();
    forgetAnswer = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(new WidgetApi(API, ORG).forget()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(2);
    // The local copies go whatever the network did.
    expect(window.localStorage.getItem(keys.customerId)).toBeNull();
  });
});
