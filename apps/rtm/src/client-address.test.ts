/**
 * The gateway never decides anything by the caller's network address
 * (tm 257.10, ADR pilot-public-readiness K-g).
 *
 * The api derives its client address from X-Forwarded-For and a trusted hop
 * count, and that count has to match the edge in front of it — the pilot's
 * Cloudflare Tunnel today, Caddy later. The gateway sits behind the same edge
 * and needs no such setting, because it reads no address at all: it rate
 * limits per socket and authorises by token. That is what
 * infra/helm/siyahtus/templates/networkpolicy.yaml relies on when it leaves
 * rtm out of the api's policy, and what "api and rtm follow the same rule"
 * means for the pilot's edge: there is nothing on this side to get wrong.
 *
 * So this is a guard on the source rather than a behaviour test. The day the
 * gateway starts reading an address — for a limit, a ban, a log field — this
 * fails, and whoever is doing it has to decide the hop count here as well.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Every production source file under apps/rtm/src — tests excluded. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const FILES = sources(SRC).map((path) => ({
  name: relative(SRC, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

/** What reading a client address looks like, by header, by socket, or by library. */
const ADDRESS_READS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'remoteAddress',
  'trustProxy',
  'proxy-addr',
];

describe('rtm reads no client address (tm 257.10)', () => {
  it('scans the real gateway (guards a vacuous pass)', () => {
    const names = FILES.map((file) => file.name);
    expect(names).toContain('server.ts');
    expect(names).toContain('connection.ts');
    expect(names.some((name) => name.endsWith('.test.ts'))).toBe(false);
    expect(FILES.find((file) => file.name === 'server.ts')!.text).toContain("http.on('upgrade'");
  });

  it.each(ADDRESS_READS)('no source file mentions %s', (needle) => {
    const hits = FILES.filter((file) => file.text.toLowerCase().includes(needle.toLowerCase()));
    expect(hits.map((file) => file.name)).toEqual([]);
  });

  it('reads one request header, authorization', () => {
    const read = new Set<string>();
    for (const file of FILES) {
      for (const match of file.text.matchAll(/headers(?:\.([\w-]+)|\[\s*['"]([^'"]+)['"]\s*\])/g)) {
        read.add((match[1] ?? match[2])!.toLowerCase());
      }
    }
    expect([...read]).toEqual(['authorization']);
  });
});
