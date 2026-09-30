/**
 * Which `X-Forwarded-For` entries `request.ip` may be read from (M-PROD-CFG-b,
 * tm 256.2).
 *
 * `TRUST_PROXY_HOPS` used to go to Fastify as a bare number. Fastify compiled
 * that to a predicate that never looked at the address — `i < hops` — so the
 * connecting peer was trusted as a proxy whoever it was. A caller who reached
 * this process directly, past the proxy, had their own header read as the
 * client address (GHSA-3m5p-2c4r-xxw2). Fastify 5.12.1 closed it by making the
 * numeric form trust nothing at all, which behind a real proxy puts every
 * request on the proxy's address: the anonymous rate limit, the IP ban and the
 * agent allow-list would all decide about one address for everybody.
 *
 * The predicate below keeps the hop count and adds the check the advisory says
 * was missing. The immediate peer counts as a proxy only if it connects from
 * loopback or a private range (RFC 1918, RFC 4193, link-local). A reverse proxy
 * we operate reaches this process that way in every topology we ship: a
 * compose network, a published port on the host, a Kubernetes pod network. A
 * caller on a public address is its own client address, whatever its header
 * says. Hops past the first are counted as before. The first hop has already
 * vouched for them, and a CDN edge in front of an ingress arrives from a public
 * address by design.
 *
 * What this does not close: a workload on the same private network that skips
 * the proxy (the M-SEC-e2 path in `test/integration/trust-proxy.test.ts`). That
 * one is still the NetworkPolicy's job.
 */
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

/**
 * The `trustProxy` value for a hop count. `0` stays `false`. Fastify then
 * skips the proxy decoration and `request.ip` is the socket peer.
 */
export function trustProxyFor(hops: number): false | ((addr: string, i: number) => boolean) {
  if (hops === 0) return false;
  return (addr, i) => i < hops && (i > 0 || isInternalPeer(addr, i));
}
