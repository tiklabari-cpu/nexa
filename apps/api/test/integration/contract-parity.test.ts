/**
 * Contract ↔ implementation parity.
 *
 * ADR-05 makes the OpenAPI document the source of truth: types, the typed web
 * client and any third-party integration are generated from it. That only holds
 * while the document actually describes what the server serves.
 *
 * It stopped holding once already. Slices 6, 8 and 9 shipped reports, billing,
 * agent availability and the customer chat surface straight into `routes/`
 * without touching `openapi/`, and nothing noticed — every test passed, because
 * the tests called the routes directly. Ten endpoints existed with no contract,
 * so no generated types and no documentation.
 *
 * This test is the thing that would have noticed. It enumerates what Fastify
 * actually registered and compares it against the bundled document, in both
 * directions: an undocumented route fails, and so does a documented route that
 * nothing serves.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadOpenApiDocument } from '@nexa/contract';
import { API_PREFIX, buildServer } from '../../src/server.js';
import { testEnv } from '../helpers/fixtures.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** `/api/v1/chats/:chatId` → `/chats/{chatId}`, so both sides speak one dialect. */
function toContractPath(url: string): string {
  const withoutPrefix = url.startsWith(API_PREFIX) ? url.slice(API_PREFIX.length) : url;
  return (withoutPrefix || '/').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function implementedOperations(app: FastifyInstance): Set<string> {
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
      operations.add(`${method} ${toContractPath(url).replace(/\/$/, '') || '/'}`);
    }
  }

  return operations;
}

function documentedOperations(): Set<string> {
  const document = loadOpenApiDocument();
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

describe('OpenAPI contract covers the served API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ env: testEnv() });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('actually parses the router, rather than comparing two empty sets', () => {
    // Without this, a parser that silently produced nothing would make both
    // parity assertions below pass while checking nothing at all.
    const implemented = implementedOperations(app);
    expect(implemented.size).toBeGreaterThan(20);
    expect(implemented).toContain('post /chats/{chatId}/events');
    expect(implemented).toContain('get /health');
    expect(documentedOperations().size).toBeGreaterThan(20);
  });

  it('documents every route the server registers', () => {
    const undocumented = [...implementedOperations(app)]
      .filter((op) => !documentedOperations().has(op))
      .sort();

    expect(
      undocumented,
      `These routes are served but absent from packages/contract/openapi/. ` +
        `Add them there — clients generate their types from that document, so an ` +
        `undocumented endpoint is an endpoint nobody outside this repo can call correctly.`,
    ).toEqual([]);
  });

  it('serves every route the contract documents', () => {
    const unimplemented = [...documentedOperations()]
      .filter((op) => !implementedOperations(app).has(op))
      .sort();

    expect(
      unimplemented,
      `These operations are documented but not served. A contract that promises ` +
        `endpoints which 404 is worse than no contract.`,
    ).toEqual([]);
  });

  it('gives every operation a unique operationId', () => {
    // openapi-typescript keys generated types by operationId; a duplicate
    // silently overwrites one operation's types with another's.
    const document = loadOpenApiDocument();
    const ids: string[] = [];

    for (const item of Object.values(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = (item as Record<string, { operationId?: string }>)[method];
        if (operation?.operationId) ids.push(operation.operationId);
      }
    }

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, `duplicate operationId in ${ids.join(', ')}`).toBe(ids.length);
  });

  it('declares an error response shape on every non-public operation', () => {
    // A caller that cannot see which failures to expect writes a client that
    // treats every non-200 the same way.
    const document = loadOpenApiDocument();
    const missing: string[] = [];

    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = (
          item as Record<string, { responses?: Record<string, unknown>; security?: unknown[] }>
        )[method];
        if (!operation) continue;
        // `security: []` marks an intentionally public route (health).
        if (Array.isArray(operation.security) && operation.security.length === 0) continue;

        const codes = Object.keys(operation.responses ?? {});
        if (!codes.some((code) => code.startsWith('4'))) {
          missing.push(`${method} ${path}`);
        }
      }
    }

    expect(missing.sort()).toEqual([]);
  });
});
