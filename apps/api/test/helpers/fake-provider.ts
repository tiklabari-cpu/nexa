/**
 * A local HTTPS server standing in for an Apps provider (tm 263).
 *
 * The live adaptors (Brevo, Freshdesk, Telegram) are tested against this, never
 * against the real services: the suites send no packet off this machine. The
 * server presents the webhook receiver's throwaway certificate
 * (`webhook-certificates.ts`, `hooks.example.test`), and `http()` builds the
 * production client (`createSafeHttp`) with that CA trusted and that name
 * pinned to the loopback listener — the one seam the client exposes for tests.
 * Everything after the pin is the real path: TLS with name verification, the
 * timeout, the size cap, no redirects.
 *
 * Adaptors reach it through their endpoint overrides
 * (`base` + `/brevo`, `/freshdesk/<subdomain>`, `/telegram`), so a request's
 * path tells the handler which provider was called.
 */
import https from 'node:https';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSafeHttp, type SafeHttp } from '../../src/lib/safe-fetch.js';
import {
  WEBHOOK_RECEIVER_CERT_PEM,
  WEBHOOK_RECEIVER_KEY_PEM,
  WEBHOOK_TEST_CA_PEM,
} from './webhook-certificates.js';

export const FAKE_PROVIDER_HOST = 'hooks.example.test';

export interface ProviderRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export type ProviderHandler = (
  request: ProviderRequest,
  response: http.ServerResponse,
) => void | Promise<void>;

export interface FakeProvider {
  /** `https://hooks.example.test:<port>` — prefix it with a provider segment. */
  base: string;
  requests: ProviderRequest[];
  /** Replaces the handler for the following requests. */
  handle(handler: ProviderHandler): void;
  /** The production client, pinned to this server. */
  http(options?: { timeoutMs?: number; maxBytes?: number }): SafeHttp;
  close(): Promise<void>;
}

export function json(response: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(text)),
  });
  response.end(text);
}

export async function startFakeProvider(initial: ProviderHandler): Promise<FakeProvider> {
  let handler = initial;
  const requests: ProviderRequest[] = [];
  const server = https.createServer(
    { cert: WEBHOOK_RECEIVER_CERT_PEM, key: WEBHOOK_RECEIVER_KEY_PEM },
    (incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const request: ProviderRequest = {
          method: incoming.method ?? '',
          path: incoming.url ?? '',
          headers: incoming.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        requests.push(request);
        void Promise.resolve(handler(request, response)).catch(() => response.destroy());
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const sockets = new Set<import('node:stream').Duplex>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    base: `https://${FAKE_PROVIDER_HOST}:${port}`,
    requests,
    handle(next) {
      handler = next;
    },
    http(options = {}) {
      return createSafeHttp({
        ...options,
        ca: WEBHOOK_TEST_CA_PEM,
        // The name is pinned to this listener and to nothing else: a request
        // for any other host fails, so an adaptor that ignored its endpoint
        // override and dialled the real provider would fail rather than leave.
        resolveTarget: async (raw) => {
          const url = new URL(raw);
          if (url.hostname !== FAKE_PROVIDER_HOST) {
            throw new Error(`fake provider refuses ${url.hostname}`);
          }
          return { url, addresses: [{ address: '127.0.0.1', family: 4 }] };
        },
      });
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
