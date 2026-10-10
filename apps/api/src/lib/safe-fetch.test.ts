/**
 * The Apps provider client over real sockets (tm 263).
 *
 * No real network: the provider is a loopback HTTPS server
 * (`test/helpers/fake-provider.ts`), the process resolver is stubbed so no DNS
 * query leaves, and an egress guard destroys any socket about to dial an
 * address that is not loopback — at its `lookup` event, before `connect` — so a
 * test that reached for the internet fails instead of sending a packet.
 */
import dns from 'node:dns';
import diagnostics from 'node:diagnostics_channel';
import { isIP, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_PROVIDER_HOST,
  json,
  startFakeProvider,
  type FakeProvider,
} from '../../test/helpers/fake-provider.js';
import { createSafeHttp, SafeHttpError, SAFE_HTTP_USER_AGENT } from './safe-fetch.js';

const PUBLIC_IP = '203.0.113.10';

let dials: string[] = [];
let stopGuard: () => void = () => {};
let processLookups: string[] = [];
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
    if (isIP(hostname) === 0) processLookups.push(hostname);
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

async function expectKind(promise: Promise<unknown>, kind: string): Promise<SafeHttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SafeHttpError);
    expect((error as SafeHttpError).kind).toBe(kind);
    return error as SafeHttpError;
  }
  throw new Error(`expected a ${kind} failure`);
}

describe('safe provider client (tm 263 · FR-MOD-09.2)', () => {
  it('reads a JSON answer over verified TLS, with the provider name in Host and SNI', async () => {
    provider = await startFakeProvider((_request, response) => json(response, 200, { ok: true }));
    const answer = await provider.http().request({
      method: 'GET',
      url: `${provider.base}/brevo/v3/account`,
      headers: { 'api-key': 'k' },
    });
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ ok: true });
    const seen = provider.requests[0]!;
    expect(seen.path).toBe('/brevo/v3/account');
    expect(seen.headers['host']).toMatch(new RegExp(`^${FAKE_PROVIDER_HOST}:\\d+$`));
    expect(seen.headers['user-agent']).toBe(SAFE_HTTP_USER_AGENT);
    expect(seen.headers['api-key']).toBe('k');
  });

  it('sends a JSON body with its length', async () => {
    provider = await startFakeProvider((_request, response) => json(response, 200, {}));
    await provider.http().request({ method: 'POST', url: `${provider.base}/x`, json: { a: 1 } });
    expect(provider.requests[0]!.body).toBe('{"a":1}');
    expect(provider.requests[0]!.headers['content-type']).toBe('application/json');
  });

  it('returns 4xx and 5xx as answers for the adaptor to read', async () => {
    provider = await startFakeProvider((_request, response) =>
      json(response, 401, { message: 'Key not found' }),
    );
    expect(
      (await provider.http().request({ method: 'GET', url: `${provider.base}/a` })).status,
    ).toBe(401);
    provider.handle((_request, response) => json(response, 503, {}));
    expect(
      (await provider.http().request({ method: 'GET', url: `${provider.base}/a` })).status,
    ).toBe(503);
  });

  it('gives up on a provider that never answers', async () => {
    provider = await startFakeProvider(() => {
      /* never responds */
    });
    const started = Date.now();
    await expectKind(
      provider.http({ timeoutMs: 300 }).request({ method: 'GET', url: `${provider.base}/slow` }),
      'timeout',
    );
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('gives up on a body that keeps coming slowly', async () => {
    provider = await startFakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"a":');
      // ...and never finishes.
    });
    await expectKind(
      provider.http({ timeoutMs: 300 }).request({ method: 'GET', url: `${provider.base}/drip` }),
      'timeout',
    );
  });

  it('refuses a body past the cap, declared or streamed', async () => {
    provider = await startFakeProvider((_request, response) => {
      response.writeHead(200, { 'content-length': String(10_000) });
      response.end('x'.repeat(10_000));
    });
    await expectKind(
      provider.http({ maxBytes: 1_000 }).request({ method: 'GET', url: `${provider.base}/big` }),
      'too_large',
    );
    provider.handle((_request, response) => {
      response.writeHead(200); // chunked, no length
      for (let i = 0; i < 20; i += 1) response.write('y'.repeat(100));
      response.end();
    });
    await expectKind(
      provider.http({ maxBytes: 1_000 }).request({ method: 'GET', url: `${provider.base}/stream` }),
      'too_large',
    );
  });

  it('never follows a redirect', async () => {
    provider = await startFakeProvider((request, response) => {
      if (request.path === '/moved') {
        response.writeHead(302, { location: `${provider!.base}/elsewhere` });
        response.end();
        return;
      }
      json(response, 200, {});
    });
    const error = await expectKind(
      provider.http().request({ method: 'GET', url: `${provider.base}/moved` }),
      'redirect',
    );
    expect(error.code).toBe('302');
    expect(provider.requests.map((r) => r.path)).toEqual(['/moved']);
  });

  it('refuses plain http before any socket opens', async () => {
    const client = createSafeHttp();
    await expectKind(
      client.request({ method: 'GET', url: 'http://api.brevo.com/v3/account' }),
      'blocked',
    );
    await expectKind(client.request({ method: 'GET', url: 'not a url' }), 'blocked');
    expect(dials).toEqual([]);
  });

  it('refuses internal addresses, literal or resolved (SSRF)', async () => {
    const toLoopback = createSafeHttp({ resolver: async () => ['127.0.0.1'] });
    for (const url of [
      'https://127.0.0.1/',
      'https://10.1.2.3/',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/',
      'https://localhost/',
    ]) {
      await expectKind(toLoopback.request({ method: 'GET', url }), 'blocked');
    }
    await expectKind(
      toLoopback.request({ method: 'GET', url: 'https://acme.freshdesk.com/api/v2/agents/me' }),
      'blocked',
    );
    const mixed = createSafeHttp({ resolver: async () => [PUBLIC_IP, '192.168.1.5'] });
    await expectKind(
      mixed.request({ method: 'GET', url: 'https://acme.freshdesk.com/' }),
      'blocked',
    );
    expect(dials).toEqual([]);
  });

  it('connects to the address it checked, never to a second DNS answer (rebinding)', async () => {
    // The check sees a public address; a client that asked DNS again would get
    // whatever the attacker serves next. The pinned socket dials the checked
    // address (the egress guard then stops it) and the process resolver is
    // never asked for the name.
    let calls = 0;
    const client = createSafeHttp({
      resolver: async () => {
        calls += 1;
        return calls === 1 ? [PUBLIC_IP] : ['127.0.0.1'];
      },
      timeoutMs: 2_000,
    });
    await expectKind(
      client.request({ method: 'GET', url: 'https://rebind.example.test/' }),
      'network',
    );
    expect(calls).toBe(1);
    expect(dials).toEqual([PUBLIC_IP]);
    expect(processLookups).toEqual([]);
  });

  it('reports a name that does not resolve as a network failure', async () => {
    const client = createSafeHttp({
      resolver: async () => {
        throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
      },
    });
    const error = await expectKind(
      client.request({ method: 'GET', url: 'https://nobody.freshdesk.com/' }),
      'network',
    );
    expect(error.code).toBe('ENOTFOUND');
  });

  it('never puts the URL — or a token in its path — into an error', async () => {
    provider = await startFakeProvider(() => {
      /* never responds */
    });
    const token = '123456:SECRET-bot-token-value';
    const errors: unknown[] = [];
    for (const url of [
      `${provider.base}/telegram/bot${token}/getMe`,
      `http://api.telegram.org/bot${token}/getMe`,
    ]) {
      try {
        await provider.http({ timeoutMs: 200 }).request({ method: 'GET', url });
      } catch (error) {
        errors.push(error);
      }
    }
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(String(error)).not.toContain('SECRET');
      expect(JSON.stringify(error)).not.toContain('SECRET');
      expect((error as Error).stack ?? '').not.toContain('SECRET');
    }
  });
});
