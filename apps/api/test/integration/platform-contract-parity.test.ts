/**
 * Platform contract ↔ platform server parity (tm 389.3).
 *
 * `contract-parity.test.ts`'s rule for the second document: what
 * `buildPlatformServer` registers under `/platform/v1` is exactly what
 * `packages/contract/platform/openapi.yaml` documents, in both directions —
 * and the two contracts never overlap, because the two processes never serve
 * each other's paths.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadOpenApiDocument, loadPlatformOpenApiDocument } from '@siyahtus/contract';
import { buildPlatformServer, PLATFORM_PREFIX } from '../../src/platform-server.js';
import { testEnv } from '../helpers/fixtures.js';
import {
  documentedOperations,
  HTTP_METHODS,
  implementedOperations,
} from '../helpers/route-inventory.js';

describe('the platform contract covers the platform server (tm 389.3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildPlatformServer({ env: testEnv() });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  const implemented = () => implementedOperations(app, PLATFORM_PREFIX);
  const documented = () => documentedOperations(loadPlatformOpenApiDocument());

  it('actually parses both sides, rather than comparing two empty sets', () => {
    expect(implemented()).toContain('get /health/ready');
    expect(implemented()).toContain('get /meta');
    expect(documented().size).toBeGreaterThanOrEqual(4);
  });

  it('serves every route only under /platform/v1', () => {
    const tree = app.printRoutes({ commonPrefix: false, includeHooks: false });
    expect(tree).not.toContain('api/v1');
    for (const op of implemented()) expect(op).not.toMatch(/^\w+ \/platform\//);
  });

  it('documents every route the platform server registers', () => {
    const undocumented = [...implemented()].filter((op) => !documented().has(op)).sort();
    expect(undocumented, 'served by platform-api but absent from platform/openapi.yaml').toEqual(
      [],
    );
  });

  it('serves every route the platform contract documents', () => {
    const unimplemented = [...documented()].filter((op) => !implemented().has(op)).sort();
    expect(unimplemented, 'documented in platform/openapi.yaml but not served').toEqual([]);
  });

  it('keeps operationIds unique across both contracts, so neither generated client shadows the other', () => {
    const ids: string[] = [];
    for (const document of [loadOpenApiDocument(), loadPlatformOpenApiDocument()]) {
      for (const item of Object.values(document.paths)) {
        for (const method of HTTP_METHODS) {
          const operation = (item as Record<string, { operationId?: string }>)[method];
          if (operation?.operationId) ids.push(operation.operationId);
        }
      }
    }
    expect(new Set(ids).size, 'duplicate operationId').toBe(ids.length);
  });

  it('never names a /platform path in the tenant contract (the #376 leak check builds on this)', () => {
    const tenantPaths = Object.keys(loadOpenApiDocument().paths);
    expect(tenantPaths.filter((path) => path.startsWith('/platform'))).toEqual([]);
    expect(JSON.stringify(loadOpenApiDocument())).not.toContain('/platform/v1');
  });

  it('declares an error response on every operation that needs a session', () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(loadPlatformOpenApiDocument().paths)) {
      for (const method of HTTP_METHODS) {
        const operation = (
          item as Record<string, { responses?: Record<string, unknown>; security?: unknown[] }>
        )[method];
        if (!operation) continue;
        if (Array.isArray(operation.security) && operation.security.length === 0) continue;
        if (!Object.keys(operation.responses ?? {}).some((code) => code.startsWith('4'))) {
          missing.push(`${method} ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
