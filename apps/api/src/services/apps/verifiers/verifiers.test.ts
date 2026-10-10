/**
 * The live adaptors against a local HTTPS stand-in for each provider (tm 263).
 * No packet leaves the machine: `fake-provider.ts` pins its `.test` name to a
 * loopback listener and refuses every other host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { appSubdomainProblem, normaliseAppSubdomain } from '@siyahtus/types';
import {
  json,
  startFakeProvider,
  type FakeProvider,
} from '../../../../test/helpers/fake-provider.js';
import { createSafeHttp } from '../../../lib/safe-fetch.js';
import { brevoVerifier } from './brevo.js';
import { freshdeskVerifier } from './freshdesk.js';
import { sanitiseProviderMessage } from './provider-message.js';
import { APP_VERIFIERS, liveAppIds, liveVerifier } from './registry.js';
import {
  DEFAULT_PROVIDER_ENDPOINTS,
  ProviderReadError,
  type ProviderContext,
  type ProviderEndpoints,
} from './types.js';

const KEY = 'xkeysib-0123456789abcdef-FAKEKEY';
const FD_KEY = 'fd-0123456789abcdefFAKE';

let provider: FakeProvider | undefined;
afterEach(async () => {
  await provider?.close();
  provider = undefined;
});

function endpoints(base: string): ProviderEndpoints {
  return {
    brevo: `${base}/brevo`,
    freshdesk: (sub) => `${base}/freshdesk/${sub}`,
    telegram: `${base}/telegram`,
  };
}

function context(
  p: FakeProvider,
  options?: { timeoutMs?: number; maxBytes?: number },
): ProviderContext {
  return { http: p.http(options), endpoints: endpoints(p.base) };
}

describe('Brevo adaptor (tm 263 · FR-MOD-09.2)', () => {
  it('accepts a key the provider accepts, sending only that key, and names the account', async () => {
    provider = await startFakeProvider((_r, res) =>
      json(res, 200, { email: 'owner@acme.test', companyName: 'Acme Ltd', plan: [] }),
    );
    const result = await brevoVerifier.verify({ apiKey: KEY }, context(provider));
    expect(result).toEqual({ ok: true, accountLabel: 'Acme Ltd' });
    const [seen] = provider.requests;
    expect(seen!.method).toBe('GET');
    expect(seen!.path).toBe('/brevo/v3/account');
    expect(seen!.headers['api-key']).toBe(KEY);
    expect(seen!.headers['authorization']).toBeUndefined();
  });

  it('refuses a key the provider refuses (401, 403, and the 400 codes), with its message', async () => {
    provider = await startFakeProvider((_r, res) =>
      json(res, 401, { code: 'unauthorized', message: 'Key not found' }),
    );
    expect(await brevoVerifier.verify({ apiKey: KEY }, context(provider))).toEqual({
      ok: false,
      reason: 'invalid_key',
      providerMessage: 'Key not found',
    });
    provider.handle((_r, res) => json(res, 403, { message: 'Forbidden' }));
    expect(await brevoVerifier.verify({ apiKey: KEY }, context(provider))).toMatchObject({
      ok: false,
      reason: 'invalid_key',
    });
    provider.handle((_r, res) => json(res, 400, { code: 'unauthorized', message: 'nope' }));
    expect(await brevoVerifier.verify({ apiKey: KEY }, context(provider))).toMatchObject({
      reason: 'invalid_key',
    });
  });

  it('never repeats the key back, even when the provider echoes it', async () => {
    provider = await startFakeProvider((_r, res) =>
      json(res, 401, { message: `Key ${KEY} not found` }),
    );
    const result = await brevoVerifier.verify({ apiKey: KEY }, context(provider));
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain('0123456789abcdef');
    expect(result).toMatchObject({
      reason: 'invalid_key',
      providerMessage: 'Key [redacted] not found',
    });
  });

  it('reads 5xx as a provider error, a hang as unreachable, an endless body as a provider error', async () => {
    provider = await startFakeProvider((_r, res) => json(res, 502, { message: 'Bad gateway' }));
    expect(await brevoVerifier.verify({ apiKey: KEY }, context(provider))).toMatchObject({
      ok: false,
      reason: 'provider_error',
    });
    provider.handle(() => {
      /* hang */
    });
    expect(
      await brevoVerifier.verify({ apiKey: KEY }, context(provider, { timeoutMs: 250 })),
    ).toEqual({ ok: false, reason: 'unreachable' });
    provider.handle((_r, res) => json(res, 200, { email: 'x'.repeat(5_000) }));
    expect(
      await brevoVerifier.verify({ apiKey: KEY }, context(provider, { maxBytes: 1_000 })),
    ).toEqual({ ok: false, reason: 'provider_error' });
  });

  it('reads a contact: subscription, distinct campaigns opened, lists; a stranger is no record', async () => {
    provider = await startFakeProvider((request, res) => {
      if (request.path.startsWith('/brevo/v3/contacts/ada%40acme.test')) {
        json(res, 200, {
          email: 'ada@acme.test',
          emailBlacklisted: false,
          listIds: [2, 7],
          statistics: { opened: [{ campaignId: 1 }, { campaignId: 1 }, { campaignId: 4 }] },
        });
        return;
      }
      json(res, 404, { code: 'document_not_found', message: 'Contact does not exist' });
    });
    const ctx = context(provider);
    expect(
      await brevoVerifier.fetchChatData!({ apiKey: KEY }, { email: 'ada@acme.test' }, ctx),
    ).toEqual([
      { label: 'Subscribed', value: 'Yes' },
      { label: 'Campaigns opened (90d)', value: '2' },
      { label: 'Lists', value: '2' },
    ]);
    expect(
      await brevoVerifier.fetchChatData!({ apiKey: KEY }, { email: 'bob@acme.test' }, ctx),
    ).toBeNull();
    expect(await brevoVerifier.fetchChatData!({ apiKey: KEY }, { email: null }, ctx)).toBeNull();
  });

  it('throws on a provider it cannot read, so the caller shows "unavailable" rather than inventing', async () => {
    provider = await startFakeProvider((_r, res) => json(res, 500, {}));
    await expect(
      brevoVerifier.fetchChatData!({ apiKey: KEY }, { email: 'ada@acme.test' }, context(provider)),
    ).rejects.toBeInstanceOf(ProviderReadError);
  });
});

describe('Freshdesk adaptor (tm 263 · FR-MOD-09.2)', () => {
  it('verifies against the named helpdesk with Basic key:X and names the agent', async () => {
    provider = await startFakeProvider((_r, res) =>
      json(res, 200, { id: 1, contact: { email: 'agent@acme.test', name: 'Agent' } }),
    );
    const result = await freshdeskVerifier.verify(
      { apiKey: FD_KEY, subdomain: 'acme' },
      context(provider),
    );
    expect(result).toEqual({ ok: true, accountLabel: 'agent@acme.test (acme.freshdesk.com)' });
    const [seen] = provider.requests;
    expect(seen!.path).toBe('/freshdesk/acme/api/v2/agents/me');
    expect(seen!.headers['authorization']).toBe(
      `Basic ${Buffer.from(`${FD_KEY}:X`).toString('base64')}`,
    );
    expect(seen!.headers['api-key']).toBeUndefined();
  });

  it('maps 401/403 to a bad key, 404 to an unknown helpdesk, 5xx to a provider error', async () => {
    provider = await startFakeProvider((_r, res) =>
      json(res, 401, {
        code: 'invalid_credentials',
        message: 'You have to be logged in to perform this action.',
      }),
    );
    const ctx = context(provider);
    const creds = { apiKey: FD_KEY, subdomain: 'acme' };
    expect(await freshdeskVerifier.verify(creds, ctx)).toEqual({
      ok: false,
      reason: 'invalid_key',
      providerMessage: 'You have to be logged in to perform this action.',
    });
    provider.handle((_r, res) => json(res, 403, { code: 'access_denied' }));
    expect(await freshdeskVerifier.verify(creds, ctx)).toMatchObject({ reason: 'invalid_key' });
    provider.handle((_r, res) => json(res, 404, {}));
    expect(await freshdeskVerifier.verify(creds, ctx)).toMatchObject({ reason: 'not_found' });
    provider.handle((_r, res) => json(res, 503, {}));
    expect(await freshdeskVerifier.verify(creds, ctx)).toMatchObject({ reason: 'provider_error' });
    provider.handle(() => {});
    expect(await freshdeskVerifier.verify(creds, context(provider, { timeoutMs: 250 }))).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('counts the requester’s open tickets and shows the latest subject', async () => {
    provider = await startFakeProvider((request, res) => {
      expect(request.path).toBe(
        '/freshdesk/acme/api/v2/tickets?email=ada%2Bx%40acme.test&per_page=30',
      );
      json(res, 200, [
        { status: 2, subject: 'Refund please' },
        { status: 5, subject: 'Old' },
        { status: 6, subject: 'Waiting' },
      ]);
    });
    expect(
      await freshdeskVerifier.fetchChatData!(
        { apiKey: FD_KEY, subdomain: 'acme' },
        { email: 'ada+x@acme.test' },
        context(provider),
      ),
    ).toEqual([
      { label: 'Open tickets (30d)', value: '2' },
      { label: 'Tickets (30d)', value: '3' },
      { label: 'Latest ticket', value: 'Refund please' },
    ]);
  });

  it('never builds a URL from a subdomain that is not one DNS label (SSRF, first layer)', async () => {
    provider = await startFakeProvider((_r, res) => json(res, 200, {}));
    for (const bad of [
      'evil.com#',
      'acme.evil',
      '127.0.0.1',
      'acme:8443',
      'acme/..',
      '-acme',
      'ACME ',
      '',
      'a'.repeat(64),
    ]) {
      await expect(
        freshdeskVerifier.verify({ apiKey: FD_KEY, subdomain: bad }, context(provider)),
      ).rejects.toThrow(/validated DNS label/);
    }
    expect(provider.requests).toEqual([]);
  });

  it('builds the production URL under freshdesk.com only, and refuses one resolving inward (second layer)', async () => {
    expect(DEFAULT_PROVIDER_ENDPOINTS.freshdesk('acme')).toBe('https://acme.freshdesk.com');
    // A label whose name resolves to an internal address is refused by the
    // safe client before any socket opens.
    const http = createSafeHttp({ resolver: async () => ['10.0.0.8'] });
    expect(
      await freshdeskVerifier.verify(
        { apiKey: FD_KEY, subdomain: 'internal' },
        { http, endpoints: DEFAULT_PROVIDER_ENDPOINTS },
      ),
    ).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('reads the subdomain the way a person pastes it', () => {
    expect(normaliseAppSubdomain('  https://Acme.freshdesk.com/ ')).toBe('acme');
    expect(appSubdomainProblem('acme-support')).toBeNull();
    expect(appSubdomainProblem('https://acme.freshdesk.com')).toBeNull();
    expect(appSubdomainProblem('')).toBe('required');
    expect(appSubdomainProblem('acme.evil.com')).toBe('invalid');
    expect(appSubdomainProblem('https://a.b.freshdesk.com')).toBe('invalid');
  });
});

describe('verifier registry (tm 263)', () => {
  it('is live only when the card has an adaptor and the deployment names it', () => {
    expect(liveVerifier('brevo', [])).toBeNull();
    expect(liveVerifier('brevo', ['brevo'])).toBe(brevoVerifier);
    expect(liveVerifier('freshdesk', ['brevo'])).toBeNull();
    expect(liveVerifier('zendesk', ['brevo', 'freshdesk'])).toBeNull();
    expect(liveVerifier('toString', ['brevo'])).toBeNull();
    expect(liveVerifier('telegram', ['telegram'])).toBeNull();
    expect(liveAppIds(['brevo', 'telegram'])).toEqual(['brevo', 'telegram']);
    expect(Object.keys(APP_VERIFIERS).sort()).toEqual(['brevo', 'freshdesk']);
  });
});

describe('provider message hygiene (tm 263)', () => {
  it('cuts to one short line and removes any 8+ character run shared with a secret', () => {
    expect(sanitiseProviderMessage('bad\nkey\u0007', [KEY])).toBe('bad key');
    expect(sanitiseProviderMessage(`x ${KEY.slice(3, 15)} y`, [KEY])).toBe('x [redacted] y');
    expect(sanitiseProviderMessage(`x ${KEY.slice(3, 9)} y`, [KEY])).toBe(`x ${KEY.slice(3, 9)} y`);
    expect(sanitiseProviderMessage('z'.repeat(500), [])).toHaveLength(200);
    expect(sanitiseProviderMessage(42, [])).toBeUndefined();
    expect(sanitiseProviderMessage('   ', [])).toBeUndefined();
  });
});
