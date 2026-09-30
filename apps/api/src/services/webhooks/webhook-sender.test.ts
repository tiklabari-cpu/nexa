/**
 * The one way a webhook leaves this process, over real sockets (tm 256.9).
 *
 * `WebhookDispatcher.attempt` resolves the receiver's name and refuses it if
 * any address is internal. That check is only worth something if the
 * connection then goes to an address it approved: an HTTP client that looks
 * the name up again for itself gets a second answer, and a zero-TTL record can
 * make the first one public and the second one `127.0.0.1` (DNS rebinding,
 * TOCTOU). These tests pin that down against real TCP and TLS on loopback:
 *
 *   - the rebinding attacker's DNS answers public, then inward — and the
 *     signed POST never reaches the listener inside;
 *   - a delivery is made to the pinned address with the registered name still
 *     in `Host` and in TLS SNI, and the certificate is checked against that
 *     name, not against the address;
 *   - the unchanged parts stay unchanged: a redirect is a failure and is never
 *     followed, a slow receiver is an `AbortError`, anything but 2xx fails.
 *
 * No real network. The process resolver (`dns.lookup`) is stubbed for every
 * test, and an egress guard destroys any socket about to dial an address that
 * is not loopback — at its `lookup` event, before `connect` — so a test that
 * reached for the internet would fail rather than send a packet. The receiver
 * names end in `.test` (RFC 6761): nothing could resolve them anyway.
 */
import dns from 'node:dns';
import diagnostics from 'node:diagnostics_channel';
import http from 'node:http';
import https from 'node:https';
import { isIP, type AddressInfo, type Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicHttpTarget } from '../../lib/ssrf.js';
import {
  WEBHOOK_RECEIVER_CERT_PEM,
  WEBHOOK_RECEIVER_KEY_PEM,
  WEBHOOK_TEST_CA_PEM,
} from '../../../test/helpers/webhook-certificates.js';
import { signWebhook, verifyWebhook } from './signature.js';
import {
  WEBHOOK_USER_AGENT,
  WebhookDispatcher,
  createHttpWebhookSender,
  type DeliverableWebhook,
  type WebhookRequest,
} from './webhook-dispatcher.js';

/** The receiver name a workspace registered. */
const HOOK_HOST = 'hooks.example.test';
/** The name whose DNS the rebinding attacker controls. */
const REBIND_HOST = 'rebind.example.test';
/**
 * The attacker's "public" answer. Documentation space (RFC 5737): the SSRF
 * check treats it as public, and if the egress guard ever failed to stop the
 * dial the packet would still reach nobody.
 */
const PUBLIC_IP = '203.0.113.10';

// --- Harness: an egress guard, a stubbed process resolver, local receivers ---

interface Dial {
  host: string;
  address: string;
  family: number;
}

/**
 * Records where every client socket opened during a test was about to
 * connect, and destroys any bound for an address that is not loopback.
 *
 * `lookup` fires after the address is chosen and before the connect, and Node
 * checks `socket.connecting` right after it — a socket destroyed here never
 * dials. It fires for named hosts only; a literal IP connects without one,
 * which is why every test below addresses its receiver by name, except the
 * IPv6-literal case, which is loopback.
 */
function guardEgress(): { dials: Dial[]; stop: () => void } {
  const dials: Dial[] = [];
  const onSocket = (message: unknown): void => {
    const { socket } = message as { socket: Socket };
    socket.on('lookup', (error: Error | null, address: string, family: unknown, host: string) => {
      if (error) return;
      dials.push({ host, address, family: Number(family) });
      if (!isLoopback(address)) socket.destroy();
    });
  };
  diagnostics.subscribe('net.client.socket', onSocket);
  return { dials, stop: () => diagnostics.unsubscribe('net.client.socket', onSocket) };
}

function isLoopback(address: string): boolean {
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * Replaces the process resolver — what an HTTP client resolving a name for
 * itself would ask. Answers names through `answer`; a `null` answer is
 * ENOTFOUND, so no test ever sends a real DNS query. An IP literal is answered
 * as itself and not recorded: `server.listen(0, '127.0.0.1')` goes through
 * this function too, and a numeric host is not a DNS question.
 */
function stubProcessResolver(answer: (hostname: string) => string | null): { asked: string[] } {
  const asked: string[] = [];
  const lookup = (hostname: string, options: unknown, callback?: unknown): void => {
    const done = (typeof options === 'function' ? options : callback) as LookupCallback;
    const wantsAll = typeof options === 'object' && options !== null && 'all' in options;
    const literal = isIP(hostname) !== 0;
    if (!literal) asked.push(hostname);
    const address = literal ? hostname : answer(hostname);
    process.nextTick(() => {
      if (address === null) {
        const error: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
        error.code = 'ENOTFOUND';
        done(error);
        return;
      }
      const family = isIP(address);
      if (wantsAll && (options as { all?: boolean }).all) done(null, [{ address, family }]);
      else done(null, address, family);
    });
  };
  vi.spyOn(dns, 'lookup').mockImplementation(lookup as unknown as typeof dns.lookup);
  return { asked };
}

interface Received {
  method: string | undefined;
  path: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** The SNI name the client sent — TLS receivers only. */
  servername?: string | false | null;
}

type Respond = (request: http.IncomingMessage, response: http.ServerResponse) => void;

const answerOk: Respond = (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
};

interface Receiver {
  port: number;
  received: Received[];
}

const servers: Array<http.Server | https.Server> = [];

async function receiver(
  options: { host?: string; tls?: boolean; respond?: Respond } = {},
): Promise<Receiver> {
  const received: Received[] = [];
  const handle = (request: http.IncomingMessage, response: http.ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        ...(options.tls ? { servername: (request.socket as TLSSocket).servername } : {}),
      });
      (options.respond ?? answerOk)(request, response);
    });
  };
  const server = options.tls
    ? https.createServer({ key: WEBHOOK_RECEIVER_KEY_PEM, cert: WEBHOOK_RECEIVER_CERT_PEM }, handle)
    : http.createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, options.host ?? '127.0.0.1', () => resolve());
  });
  return { port: (server.address() as AddressInfo).port, received };
}

/** A port nothing listens on: bound once, then released. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const BODY = JSON.stringify({ action: 'chat_started', data: { chat_id: 'TJ1H8CFKRV' } });

function request(overrides: Partial<WebhookRequest> = {}): WebhookRequest {
  return {
    headers: {
      'content-type': 'application/json',
      'X-Webhook-Timestamp': '1767225600',
      'X-Webhook-Nonce': 'n0nce',
      'X-Webhook-Signature': 'sha256=feed',
    },
    body: BODY,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function target(url: string, ...addresses: string[]): PublicHttpTarget {
  return {
    url: new URL(url),
    addresses: addresses.map((address) => ({ address, family: isIP(address) as 4 | 6 })),
  };
}

let egress: ReturnType<typeof guardEgress>;
/** What the process resolver answers; every test starts with "nothing resolves". */
let processAnswer: (hostname: string) => string | null;
let processResolver: { asked: string[] };

beforeEach(() => {
  egress = guardEgress();
  processAnswer = () => null;
  processResolver = stubProcessResolver((hostname) => processAnswer(hostname));
});

afterEach(async () => {
  egress.stop();
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('webhook sender — the connection goes where the SSRF check said', () => {
  // --- Negative first: the rebinding attack is the point of the pin. --------

  describe('DNS rebinding (FR-MOD-08.8.4 · NFR-S7)', () => {
    it('never delivers to the inward second answer: the signed POST does not reach 127.0.0.1', async () => {
      // The internal service the attacker is aiming at.
      const inside = await receiver();

      // The attacker's authoritative DNS: public for the first question,
      // loopback for every one after. Installed both as the dispatcher's
      // resolver and as the process resolver, so it answers whichever of them
      // asks, in the order they ask — exactly as one zero-TTL record would.
      const asked: string[] = [];
      const attacker = (hostname: string): string => {
        asked.push(hostname);
        return asked.length === 1 ? PUBLIC_IP : '127.0.0.1';
      };
      processAnswer = attacker;

      const dispatcher = new WebhookDispatcher({
        sender: createHttpWebhookSender(),
        resolver: async (hostname) => [attacker(hostname)],
        timeoutMs: 5_000,
      });
      const webhook: DeliverableWebhook = {
        id: 'wh_rebind',
        url: `http://${REBIND_HOST}:${inside.port}/hook`,
        action: 'chat_started',
        secretKey: 'whsec_rebind',
      };

      const result = await dispatcher.attempt(webhook, BODY);

      // Nothing reached the listener inside — not the body, not the signature.
      expect(inside.received).toEqual([]);
      expect(result.ok).toBe(false);
      // The socket reached for the address the check approved and nothing
      // else, and DNS was asked once: by the check, never by the connection.
      expect(egress.dials).toEqual([{ host: REBIND_HOST, address: PUBLIC_IP, family: 4 }]);
      expect(asked).toEqual([REBIND_HOST]);
      expect(processResolver.asked).toEqual([]);
    });

    it('tries only pinned addresses when there are several, and delivers through one of them', async () => {
      const hook = await receiver();

      const result = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${hook.port}/receiver`, '127.0.0.1', '::1'),
        request(),
      );

      expect(result).toEqual({ ok: true, statusCode: 200 });
      expect(hook.received).toHaveLength(1);
      // Both addresses were offered to the socket, nothing else was.
      expect(egress.dials).toEqual([
        { host: HOOK_HOST, address: '127.0.0.1', family: 4 },
        { host: HOOK_HOST, address: '::1', family: 6 },
      ]);
    });

    it('refuses a target that pins no address, without opening a connection', async () => {
      const hook = await receiver();

      const result = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${hook.port}/receiver`),
        request(),
      );

      expect(result).toEqual({ ok: false, error: 'ERR_SSRF_UNPINNED' });
      expect(hook.received).toEqual([]);
      expect(egress.dials).toEqual([]);
      expect(processResolver.asked).toEqual([]);
    });

    it('refuses a literal-address URL whose address is not the one pinned', async () => {
      const hook = await receiver();

      // A literal host is connected to without any lookup, so the pin could not
      // steer it; the sender refuses rather than dial an address nobody checked.
      const result = await createHttpWebhookSender()(
        target(`http://127.0.0.1:${hook.port}/receiver`, PUBLIC_IP),
        request(),
      );

      expect(result).toEqual({ ok: false, error: 'ERR_SSRF_UNPINNED' });
      expect(hook.received).toEqual([]);
    });
  });

  describe('a redirect is a failure, never a second request (NFR-S7)', () => {
    it('does not follow a 3xx to the address in its Location', async () => {
      const stolen = await receiver();
      const hook = await receiver({
        respond: (_request, response) => {
          response.writeHead(302, { location: `http://${HOOK_HOST}:${stolen.port}/stolen` });
          response.end();
        },
      });

      const result = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${hook.port}/receiver`, '127.0.0.1'),
        request(),
      );

      expect(result).toEqual({ ok: false, statusCode: 302, error: 'http_302' });
      expect(hook.received).toHaveLength(1);
      expect(stolen.received).toEqual([]);
    });
  });

  describe('TLS follows the registered name, not the pinned address', () => {
    it('sends the registered name as SNI and verifies the certificate against it', async () => {
      const hook = await receiver({ tls: true });

      const result = await createHttpWebhookSender({ ca: WEBHOOK_TEST_CA_PEM })(
        target(`https://${HOOK_HOST}:${hook.port}/receiver`, '127.0.0.1'),
        request(),
      );

      expect(result).toEqual({ ok: true, statusCode: 200 });
      expect(hook.received).toHaveLength(1);
      expect(hook.received[0]?.servername).toBe(HOOK_HOST);
      expect(hook.received[0]?.headers.host).toBe(`${HOOK_HOST}:${hook.port}`);
      expect(processResolver.asked).toEqual([]);
    });

    it('refuses a receiver whose certificate is for another name, though the address is pinned', async () => {
      const hook = await receiver({ tls: true });

      // Same pinned address, same trusted CA — but the URL names a host the
      // certificate does not cover, so the handshake must fail.
      const result = await createHttpWebhookSender({ ca: WEBHOOK_TEST_CA_PEM })(
        target(`https://wrong.example.test:${hook.port}/receiver`, '127.0.0.1'),
        request(),
      );

      expect(result).toEqual({ ok: false, error: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      expect(hook.received).toEqual([]);
    });

    it('keeps verification on under NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
      const hook = await receiver({ tls: true });
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');

      // No test CA: the receiver's chain is untrusted. The environment switch
      // that turns verification off process-wide must not reach this sender.
      const result = await createHttpWebhookSender()(
        target(`https://${HOOK_HOST}:${hook.port}/receiver`, '127.0.0.1'),
        request(),
      );
      vi.unstubAllEnvs();

      expect(result).toEqual({ ok: false, error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
      expect(hook.received).toEqual([]);
    });
  });

  describe('timeouts and failures are results, never throws', () => {
    it('gives up on a receiver that never answers, as an AbortError', async () => {
      const hook = await receiver({ respond: () => {} });
      const started = Date.now();

      const result = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${hook.port}/receiver`, '127.0.0.1'),
        request({ timeoutMs: 200 }),
      );

      expect(result).toEqual({ ok: false, error: 'AbortError' });
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('reports a non-2xx answer with its status', async () => {
      const hook = await receiver({
        respond: (_request, response) => {
          response.writeHead(503);
          response.end('down');
        },
      });

      const result = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${hook.port}/receiver`, '127.0.0.1'),
        request(),
      );

      expect(result).toEqual({ ok: false, statusCode: 503, error: 'http_503' });
    });

    it('reports a refused connection by its code', async () => {
      const port = await closedPort();

      const result = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${port}/receiver`, '127.0.0.1'),
        request(),
      );

      expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' });
    });
  });

  // --- Then the positive: a delivery through the pin. -------------------------

  describe('delivery', () => {
    it('POSTs the signed body to the pinned address with the registered Host, never asking DNS', async () => {
      const hook = await receiver();
      const secret = 'whsec_delivery';
      // Signed exactly as `attempt` signs it. The dispatcher itself cannot be
      // the caller here: its check refuses 127.0.0.1, the only address a
      // local receiver can have — so the sender is handed the pin directly.
      const signed = signWebhook(secret, BODY);

      const result = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${hook.port}/receiver?source=zap`, '127.0.0.1'),
        request({ headers: { 'content-type': 'application/json', ...signed.headers } }),
      );

      expect(result).toEqual({ ok: true, statusCode: 200 });
      expect(hook.received).toHaveLength(1);
      const [delivered] = hook.received;
      expect(delivered?.method).toBe('POST');
      expect(delivered?.path).toBe('/receiver?source=zap');
      expect(delivered?.headers.host).toBe(`${HOOK_HOST}:${hook.port}`);
      expect(delivered?.headers['content-type']).toBe('application/json');
      expect(delivered?.headers['content-length']).toBe(String(Buffer.byteLength(BODY)));
      expect(delivered?.headers['user-agent']).toBe(WEBHOOK_USER_AGENT);
      expect(delivered?.body).toBe(BODY);
      // The signature survives the transport untouched: the receiver verifies it.
      expect(
        verifyWebhook(secret, {
          body: delivered?.body ?? '',
          timestamp: delivered?.headers['x-webhook-timestamp'] as string | undefined,
          nonce: delivered?.headers['x-webhook-nonce'] as string | undefined,
          signature: delivered?.headers['x-webhook-signature'] as string | undefined,
        }),
      ).toEqual({ ok: true });
      expect(egress.dials).toEqual([{ host: HOOK_HOST, address: '127.0.0.1', family: 4 }]);
      expect(processResolver.asked).toEqual([]);
    });

    it('pins an IPv6 answer, and connects a literal IPv6 URL to its own address', async () => {
      const hook = await receiver({ host: '::1' });

      const byName = await createHttpWebhookSender()(
        target(`http://${HOOK_HOST}:${hook.port}/by-name`, '::1'),
        request(),
      );
      const byLiteral = await createHttpWebhookSender()(
        target(`http://[::1]:${hook.port}/by-literal`, '::1'),
        request(),
      );

      expect(byName).toEqual({ ok: true, statusCode: 200 });
      expect(byLiteral).toEqual({ ok: true, statusCode: 200 });
      expect(hook.received.map((r) => [r.path, r.headers.host])).toEqual([
        ['/by-name', `${HOOK_HOST}:${hook.port}`],
        ['/by-literal', `[::1]:${hook.port}`],
      ]);
      // The literal needed no lookup at all; the name was answered by the pin.
      expect(egress.dials).toEqual([{ host: HOOK_HOST, address: '::1', family: 6 }]);
      expect(processResolver.asked).toEqual([]);
    });
  });
});
