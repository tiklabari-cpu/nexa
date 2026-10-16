/**
 * The member token on the widget's side (ID-03 · K4 · tm 287.2).
 *
 * A returning visitor is recognised by the member token the server signed for
 * this browser, never by the customer id: the widget keeps the token the mint
 * hands it and sends it back on the next load. The customer id is sent only by
 * a browser that holds no member token — one from before member tokens, for
 * the single trade the server allows during the transition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMBER_TOKEN_KEY, WidgetApi } from './api.js';

const ORG = '7f8b4a62-5c1e-4b9e-9a77-0d1e2f3a4b5c';

let mintBodies: Array<Record<string, unknown>> = [];
let mintAnswer: Record<string, unknown> = {};

beforeEach(() => {
  mintBodies = [];
  mintAnswer = { token: 'nxc1.a.b', customer_id: 'cust-new', member_token: 'nxm1.1.body.sig' };
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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
});

describe('the member token (ID-03 · K4)', () => {
  it('sends the member token it holds, and no customer id beside it', async () => {
    window.localStorage.setItem(MEMBER_TOKEN_KEY, 'nxm1.1.kept.sig');
    window.localStorage.setItem('siyahtus.customer_id', 'cust-1');

    await new WidgetApi('https://api.example/api/v1', ORG).connect();

    expect(mintBodies).toHaveLength(1);
    expect(mintBodies[0]).toMatchObject({ organization_id: ORG, member_token: 'nxm1.1.kept.sig' });
    // The id identifies; it never authenticated, and a browser that has a
    // token has nothing to trade it for.
    expect(mintBodies[0]).not.toHaveProperty('customer_id');
  });

  it('keeps the member token the mint hands back, for the next load', async () => {
    window.localStorage.setItem(MEMBER_TOKEN_KEY, 'nxm1.1.kept.sig');
    mintAnswer = { ...mintAnswer, member_token: 'nxm1.1.resigned.sig' };

    await new WidgetApi('https://api.example/api/v1', ORG).connect();

    expect(window.localStorage.getItem(MEMBER_TOKEN_KEY)).toBe('nxm1.1.resigned.sig');
    expect(window.localStorage.getItem('siyahtus.customer_id')).toBe('cust-new');

    // The next load is the returning visitor: the re-signed token goes back.
    await new WidgetApi('https://api.example/api/v1', ORG).connect();
    expect(mintBodies[1]).toMatchObject({ member_token: 'nxm1.1.resigned.sig' });
  });

  it('a browser from before member tokens sends its old id, once, to trade it in', async () => {
    window.localStorage.setItem('siyahtus.customer_id', 'cust-legacy');
    mintAnswer = { ...mintAnswer, customer_id: 'cust-legacy' };

    await new WidgetApi('https://api.example/api/v1', ORG).connect();
    expect(mintBodies[0]).toMatchObject({ customer_id: 'cust-legacy' });
    expect(mintBodies[0]).not.toHaveProperty('member_token');

    // Traded: from now on the token speaks for it.
    await new WidgetApi('https://api.example/api/v1', ORG).connect();
    expect(mintBodies[1]).toMatchObject({ member_token: 'nxm1.1.body.sig' });
    expect(mintBodies[1]).not.toHaveProperty('customer_id');
  });

  it('a first visit sends neither', async () => {
    await new WidgetApi('https://api.example/api/v1', ORG).connect();

    expect(mintBodies[0]).not.toHaveProperty('member_token');
    expect(mintBodies[0]).not.toHaveProperty('customer_id');
    expect(window.localStorage.getItem(MEMBER_TOKEN_KEY)).toBe('nxm1.1.body.sig');
  });
});
