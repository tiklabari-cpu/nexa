/**
 * What a Fastify server actually serves, in the contract's dialect — shared by
 * the two contract-parity suites (tenant `contract-parity.test.ts`, platform
 * `platform-contract-parity.test.ts`, tm 389.3), so both read the router the
 * same way.
 */
import type { FastifyInstance } from 'fastify';
import type { OpenApiDocument } from '@siyahtus/contract';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** `/api/v1/chats/:chatId` → `/chats/{chatId}`, so both sides speak one dialect. */
export function toContractPath(url: string, prefix: string): string {
  const withoutPrefix = url.startsWith(prefix) ? url.slice(prefix.length) : url;
  return (withoutPrefix || '/').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function implementedOperations(app: FastifyInstance, prefix: string): Set<string> {
  const operations = new Set<string>();

  // `printRoutes` is Fastify's public introspection surface and reflects the
  // router after `ready()` — i.e. what will actually be served, not what some
  // registration list claims.
  const tree = app.printRoutes({ commonPrefix: false, includeHooks: false });

  // Lines look like: "    chats (GET, POST)" nested under their parent segment.
  // Rebuild full paths by tracking indentation depth.
  const segments: string[] = [];
  for (const rawLine of tree.split('\n')) {
    if (!rawLine.trim()) continue;

    const content = rawLine.replace(/^[│├└─\s]+/, '');
    if (!content) continue;

    const depth = Math.max(0, Math.floor((rawLine.length - content.length) / 4));
    const methodMatch = /\s\((.+)\)$/.exec(content);
    const segment = methodMatch ? content.slice(0, methodMatch.index) : content;

    segments.length = depth;
    segments[depth] = segment;

    if (!methodMatch?.[1]) continue;

    const url = segments.slice(0, depth + 1).join('');
    for (const method of methodMatch[1].split(',').map((m) => m.trim().toLowerCase())) {
      // HEAD is auto-derived from GET and OPTIONS comes from CORS; neither is
      // something a contract should have to enumerate.
      if (!(HTTP_METHODS as readonly string[]).includes(method)) continue;
      operations.add(`${method} ${toContractPath(url, prefix).replace(/\/$/, '') || '/'}`);
    }
  }

  return operations;
}

export function documentedOperations(document: OpenApiDocument): Set<string> {
  const operations = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      if (item && typeof item === 'object' && method in item) {
        operations.add(`${method} ${path}`);
      }
    }
  }
  return operations;
}
