/**
 * The Fastify server options both processes boot with (tm 389.3).
 *
 * Moved out of `buildServer` unchanged so the platform process
 * (`platform-server.ts`) gets the same logger redaction, request-id rule,
 * proxy trust, body limit and shutdown behaviour as the tenant API, rather than
 * a copy that drifts: a second list of redaction paths is a list somebody
 * forgets to extend. Every comment below was written for the tenant API and
 * holds for the platform one too — it sits behind the same single edge hop
 * (`TRUST_PROXY_HOPS`) and logs through the same pino.
 *
 * `service` is the one difference: the platform process names itself on every
 * log line (`service: 'platform'`), so the two processes' lines can be told
 * apart in one log stream. Left out — the tenant API — pino's default base
 * (`pid`, `hostname`) stays exactly as it was.
 */
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { LogController, type FastifyServerOptions } from 'fastify';
import { isAcceptableRequestId, LOG_KEYS } from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { logSafeUrl, PLATFORM_SECRET_LOG_PATHS, PROVIDER_SECRET_LOG_PATHS } from './log-redact.js';
import { trustProxyFor } from './trust-proxy.js';

export interface BaseFastifyOptionsInput {
  env: Env;
  /** Where log lines go — see `BuildServerOptions.logStream`. */
  logStream?: NodeJS.WritableStream;
  /** Written on every log line when set (the platform process: `platform`). */
  service?: string;
}

export function baseFastifyOptions({
  env,
  logStream,
  service,
}: BaseFastifyOptionsInput): FastifyServerOptions {
  return {
    logger: {
      level: env.LOG_LEVEL,
      ...(service ? { base: { pid: process.pid, hostname: hostname(), service } } : {}),
      // Secrets must never reach the log, even at trace level — and neither
      // must people (NFR-C4 · C4-e). The two are handled by one mechanism but
      // are not the same problem: a secret is removed, while `req.url` is
      // *masked* and survives, because the request line with no URL is a log
      // line with nothing to debug from. `lib/log-redact.ts` says why the
      // masking is unconditional rather than reserved for covered workspaces.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.client_secret',
          'req.body.code_verifier',
          'req.body.token',
          // A returning visitor's member token (ID-03 · K4) — whoever holds it
          // is that member to `POST /customer/token`. Its cookie twin is
          // covered by `req.headers.cookie` above and the `Set-Cookie` below.
          'req.body.member_token',
          // Telegram's connect body carries a caller-supplied bot token
          // (`08.5.8-b`) — a real credential, unlike the other channels' mock
          // OAuth `code`.
          'req.body.bot_token',
          // An `api_key` marketplace card is connected by pasting the provider's
          // key (`09.2`, POST /settings/apps/{appId}/connect). The server only
          // ever stores its hash, which would be worth little if the clear key
          // were sitting in the request log beside it.
          'req.body.api_key',
          'res.headers["set-cookie"]',
          // The provider credentials — the SMTP login (tm 255.3), the model's
          // key (tm 255.6), the embedding provider's key (tm 255.7) — and an
          // outbound request's Authorization header, wherever someone might log
          // the configuration or the request that holds them. The carriers
          // themselves never do. One list, in `lib/log-redact.ts` (tm 255.9).
          ...PROVIDER_SECRET_LOG_PATHS,
          // The operator sign-in (tm 389.4): codes, recovery sheets, TOTP
          // secrets and invitation links, in a body or a logged result.
          ...PLATFORM_SECRET_LOG_PATHS,
          // The request line. This API puts personal data in query strings —
          // the customer search takes an address — so the URL is where PII
          // reaches the log first, and it is not covered by any secret path.
          'req.url',
        ],
        // `map(String)` before `join`: a leading `*` path walks every key of
        // the log object, pino's own Symbol-keyed ones included, and `join`
        // throws on a Symbol — which took the whole log call down with it.
        censor: (value: unknown, path: Array<string | symbol>) =>
          path.map(String).join('.') === 'req.url' && typeof value === 'string'
            ? logSafeUrl(value)
            : '[redacted]',
      },
      ...(logStream
        ? { stream: logStream }
        : {
            transport:
              env.NODE_ENV === 'development'
                ? { target: 'pino/file' as const, options: { destination: 1 } }
                : undefined,
          }),
    },
    // Correlates the log line, the trace and the `request_id` the client sees.
    // The caller's `X-Request-Id` is kept only when it looks like an id
    // (ID-08): it lands on every line this request writes and in every error
    // body, so anything else — a newline, a 2 KB string, a shape nobody can
    // grep for — is replaced with a fresh UUID rather than trusted. There is no
    // `requestIdHeader` on purpose: with one set, Fastify reads the header
    // itself and calls this only when it is absent, which is how an unchecked
    // id used to get in.
    genReqId: (req) => {
      const supplied = req.headers['x-request-id'];
      return isAcceptableRequestId(supplied) ? supplied : randomUUID();
    },
    // Trust exactly `TRUST_PROXY_HOPS` proxy hops, not the whole
    // `X-Forwarded-For` chain.
    //
    // `request.ip` feeds security decisions — the anonymous rate-limit key, the
    // customer IP ban, and the agent IP allow-list (FR-MOD-08.9.6). With
    // `trustProxy: true` proxy-addr trusts every hop and returns the *left-most*
    // XFF entry, which is whatever the client wrote: a caller could send
    // `X-Forwarded-For: <an-allowed-ip>` and walk straight through the allow-list.
    // Trusting a bounded number of hops makes proxy-addr stop that many entries
    // from the right — at the address the outermost proxy *we* operate attested
    // — so a client-prepended value is ignored and cannot be spoofed.
    //
    // How many that is belongs to the deployment, not to this file
    // (M-PROD-CFG-b): one reverse proxy is the common case and the default, a
    // CDN in front of an ingress is two, and a process reached directly is zero.
    // This used to be the literal `1` with a comment declaring the assumption,
    // which meant a topology change silently produced either a bypass (count too
    // high) or every request appearing to come from our own proxy (too low).
    // `test/integration/trust-proxy.test.ts` runs both mistakes against the
    // allow-list. Zero is not "off": Fastify skips the decoration entirely and
    // `request.ip` is the socket peer, which is the correct — and the only safe
    // — reading when nothing in front of us appends to the header.
    //
    // The count only applies when the immediate peer is on loopback or a
    // private network. A bare number trusted any peer, which is
    // GHSA-3m5p-2c4r-xxw2; `lib/trust-proxy.ts` has the rest.
    trustProxy: trustProxyFor(env.TRUST_PROXY_HOPS),
    // A test that hands us a stream is asking to read the request line; every
    // other test keeps it off, because thousands of lines nobody reads is what
    // made it off in the first place. (The top-level option is FSTDEP023 from
    // Fastify 5.12; the controller takes the same value.)
    // `request_id`, not pino's `reqId`: one spelling for the id on the log line,
    // in the error body, on the span and in the RTM frame (ID-08 · LOG_KEYS).
    logController: new LogController({
      disableRequestLogging: env.isTest && !logStream,
      requestIdLogLabel: LOG_KEYS.requestId,
    }),
    bodyLimit: 1_048_576, // 1 MiB — attachments go through signed upload URLs
    // Do not let `close()` tear down live connections (M-OPS-b).
    //
    // This looks like it should be the default and is not. Fastify resolves an
    // unset `forceCloseConnections` to the string `'idle'`, and its close path
    // then reads `else if (serverHasCloseAllConnections && forceCloseConnections)`
    // — a truthiness check that `'idle'` passes — so the default calls
    // `closeAllConnections()` and destroys every socket, including the ones with
    // a request half-answered on them. Measured, not inferred: with the default,
    // `test/integration/graceful-shutdown.test.ts`'s in-flight request comes back
    // as a socket error with zero bytes read.
    //
    // `false` makes `close()` wait for connections to end instead. Idle
    // keep-alive sockets are handed back separately, in `plugins/lifecycle.ts`'s
    // `preClose` hook — otherwise a monitor's parked connection would hold the
    // shutdown open for a full `keepAliveTimeout`.
    forceCloseConnections: false,
  };
}
