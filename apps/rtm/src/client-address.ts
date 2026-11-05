/**
 * The one client address the gateway reads (tm 405), and the only file that
 * reads it.
 *
 * It exists for one decision: how many sockets a single source may hold
 * before they log in (`prelogin-limit.ts`), counted per network — the address
 * reduced to an IPv4 address or an IPv6 /64 by `client-network.ts` (tm 409).
 * Nothing else in the gateway looks at an address — not a ban, not an
 * authorisation; the cap's one warn line names the network — and
 * `client-address.test.ts` fails the day something does.
 *
 * The address is derived exactly the way the api derives `request.ip`
 * (`apps/api/src/lib/trust-proxy.ts`, M-PROD-CFG-b · GHSA-3m5p-2c4r-xxw2): the
 * same library, the same internal-peer ranges, the same predicate, the same
 * `TRUST_PROXY_HOPS`. The two processes sit behind the same edge, so one number
 * describes both — and a gateway that believed a header the api ignores would
 * hand an attacker the very key this cap is counted on. Concretely:
 *
 *   - at `0` the socket peer is the address and any forwarded header is ignored;
 *   - otherwise the immediate peer counts as a proxy only if it connects from
 *     loopback, link-local or a private range. A caller on a public address is
 *     its own client address, whatever it wrote in its headers;
 *   - hops past the first are counted from the right, as the api counts them.
 *
 * Copied rather than imported: an app cannot import another app's source, and
 * `@siyahtus/types` is bundled into the widget loader, where a top-level
 * `compile()` call costs bytes. `client-address.test.ts` holds the copy to the
 * original, text against text, so the two cannot drift apart silently.
 */
import type { IncomingMessage } from 'node:http';
import proxyAddr from '@fastify/proxy-addr';

/**
 * Loopback, link-local and unique-local, v4 and v6. proxy-addr's own names;
 * IPv4-mapped IPv6 peers (`::ffff:10.0.0.5`) match too.
 */
export const isInternalPeer: (addr: string, i: number) => boolean = proxyAddr.compile([
  'loopback',
  'linklocal',
  'uniquelocal',
]);

/** The api's `trustProxyFor`, unchanged: `0` trusts nothing, the peer is the client. */
export function trustProxyFor(hops: number): false | ((addr: string, i: number) => boolean) {
  if (hops === 0) return false;
  return (addr, i) => i < hops && (i > 0 || isInternalPeer(addr, i));
}

/**
 * The address an upgrade request comes from, under `hops` trusted proxies.
 *
 * `proxyAddr(request, …)` is what Fastify itself calls to produce
 * `request.ip`, so for the same request and the same hop count the api and the
 * gateway arrive at the same string. An IPv4-mapped peer (`::ffff:127.0.0.1`)
 * is reported as Node reports it; `client-network.ts` counts it as the IPv4
 * client it carries.
 *
 * An empty string, never `undefined`: a socket that has already gone away has
 * no peer, and it still needs a key — it is about to be refused by the
 * handshake anyway.
 */
export function clientAddress(request: IncomingMessage, hops: number): string {
  const trust = trustProxyFor(hops);
  // Typed `string`, but it is the socket's own `remoteAddress` when nothing is
  // trusted, and that is `undefined` once the peer has gone.
  const address: string | undefined = proxyAddr(request, trust === false ? () => false : trust);
  return address ?? '';
}
