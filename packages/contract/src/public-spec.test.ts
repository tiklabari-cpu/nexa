/**
 * The hosted API documentation's data and its guards (KN-04 · tm 376).
 *
 * Three families of test, in the order they matter:
 *
 *   1. LEAK — nothing internal reaches the published document. Run against the
 *      real bundle (`dist/openapi.json`, rebuilt by `pnpm build`), not a fixture:
 *      a fixture cannot notice that somebody stamped a root-panel route.
 *   2. SHAPE — the document is the stamped operations and exactly what they reach.
 *   3. FRESHNESS — the committed file, the changelog and the version agree with
 *      the contract, so the page is never silently stale.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  loadOpenApiDocument,
  loadPlatformOpenApiDocument,
  type OpenApiDocument,
} from './document.js';
import {
  composePublicSpec,
  composePublicSpecText,
  loadChangelog,
  PUBLIC_SPEC_PATH,
} from './public-docs.js';
import { buildPublicGuides, isPublicErrorType, publicErrorTypes } from './public-guide.js';
import {
  buildPublicSpec,
  INTERNAL_OPERATION_PATTERNS,
  internalReason,
  publicOperations,
  scrubInternalReferences,
  surfaceFingerprint,
} from './public-spec.js';

const document = loadOpenApiDocument();
const published = composePublicSpec(document);
const publishedText = JSON.stringify(published);
const operations = publicOperations(document);

const HTTP = ['get', 'post', 'put', 'patch', 'delete'];
function operationsOf(doc: {
  paths: Record<string, unknown>;
}): Array<{ path: string; id: string }> {
  const found: Array<{ path: string; id: string }> = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP) {
      const op = (item as Record<string, { operationId?: string } | undefined>)[method];
      if (op) found.push({ path, id: op.operationId ?? '' });
    }
  }
  return found;
}

/** A minimal two-operation document, one stamped and one not. */
function fixture(extra: Record<string, unknown> = {}): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: { title: 'x', version: '9.9.9' },
    tags: [{ name: 'A' }, { name: 'B' }],
    paths: {
      '/things': {
        get: {
          tags: ['A'],
          operationId: 'listThings',
          'x-public': true,
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
            },
          },
          ...extra,
        },
      },
      '/hidden': {
        get: {
          tags: ['B'],
          operationId: 'listHidden',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      schemas: {
        Thing: { type: 'object', properties: { part: { $ref: '#/components/schemas/Part' } } },
        Part: { type: 'string' },
        Unused: { type: 'string' },
      },
    },
  };
}

const input = { guides: [], changelog: [] };

describe('leak: internal operations never reach the published document', () => {
  it('publishes no operation whose path is internal by nature', () => {
    const offenders = operations
      .map((op) => ({ op, why: internalReason(op.path, op.operationId) }))
      .filter((entry) => entry.why);
    expect(offenders).toEqual([]);
  });

  it('keeps platform management, sandbox, impersonation, SCIM and deployment paths out', () => {
    const paths = Object.keys(published.paths);
    for (const forbidden of [
      /^\/platform(\/|$)/,
      /sandbox/i,
      /impersonation/i,
      /^\/scim/,
      /^\/deployment/,
      /^\/settings\//,
    ]) {
      expect(paths.filter((path) => forbidden.test(path))).toEqual([]);
    }
    expect(publishedText).not.toContain('/platform/');
  });

  it('shares no operation with the platform (root panel) contract', () => {
    const platformIds = new Set(operationsOf(loadPlatformOpenApiDocument()).map((op) => op.id));
    const shared = operationsOf(published).filter((op) => platformIds.has(op.id));
    expect(shared).toEqual([]);
    expect(operationsOf(published).filter((op) => /platform/i.test(op.id))).toEqual([]);
  });

  it('hides an operation until it is stamped: the default is closed', () => {
    const everything = operationsOf(document);
    expect(everything.length).toBeGreaterThan(operations.length * 3);
    const stampedIds = new Set(operations.map((op) => op.operationId));
    const shown = operationsOf(published);
    expect(shown.map((op) => op.id).sort()).toEqual([...stampedIds].sort());
    expect(shown.length).toBe(operations.length);
  });

  it('refuses to publish a stamped operation that is internal by pattern', () => {
    for (const { pattern, why } of INTERNAL_OPERATION_PATTERNS) {
      expect(why.length).toBeGreaterThan(0);
      expect(pattern).toBeInstanceOf(RegExp);
    }
    const doc = fixture();
    doc.paths['/platform/workspaces'] = {
      get: { tags: ['A'], operationId: 'listWorkspaces', 'x-public': true, responses: {} },
    };
    expect(() => buildPublicSpec(doc, input)).toThrow(/internal: root panel/);

    const sandbox = fixture();
    sandbox.paths['/ai/sandbox-sessions'] = {
      post: { tags: ['A'], operationId: 'createSandboxSession', 'x-public': true, responses: {} },
    };
    expect(() => buildPublicSpec(sandbox, input)).toThrow(/sandbox/);
  });

  it('removes the back-office error types from the shared error enum', () => {
    const enumValues = (published.components['schemas'] as Record<string, { enum?: string[] }>)[
      'ErrorType'
    ]?.enum;
    expect(enumValues).toBeDefined();
    expect(enumValues!.length).toBeGreaterThan(10);
    expect(enumValues!.filter((type) => !isPublicErrorType(type))).toEqual([]);
    expect(enumValues).toContain('validation');
    expect(publicErrorTypes().map((entry) => entry.type)).not.toContain('platform_workspace_state');
  });

  it('carries none of the x-public markers into the output', () => {
    expect(publishedText).not.toContain('"x-public"');
  });
});

describe('shape: the document is the stamped operations and what they reach', () => {
  it('carries only the components a published operation references', () => {
    const built = buildPublicSpec(fixture(), input);
    expect(Object.keys(built.paths)).toEqual(['/things']);
    expect(Object.keys(built.components['schemas'] as object)).toEqual(['Thing', 'Part']);
    expect((built.tags as Array<{ name: string }>).map((tag) => tag.name)).toEqual(['A']);
  });

  it('resolves every reference of the real document inside itself', () => {
    const refs = new Set<string>();
    JSON.stringify(published, (key, value: unknown) => {
      if (key === '$ref' && typeof value === 'string') refs.add(value);
      return value;
    });
    expect(refs.size).toBeGreaterThan(20);
    const components = published.components as Record<string, Record<string, unknown>>;
    const missing = [...refs].filter((ref) => {
      const [, , section, name] = ref.split('/');
      return !components[section!]?.[name!];
    });
    expect(missing).toEqual([]);
  });

  it('is much smaller than the full contract', () => {
    expect(Object.keys(published.paths).length).toBeLessThan(
      Object.keys(document.paths).length / 4,
    );
    expect(Object.keys(published.paths).length).toBeGreaterThan(20);
  });

  it('gives every published operation an operationId, a summary and a tag', () => {
    const lacking: string[] = [];
    for (const [path, item] of Object.entries(published.paths)) {
      for (const method of HTTP) {
        const op = (item as Record<string, Record<string, unknown> | undefined>)[method];
        if (op && !(op['operationId'] && op['summary'] && Array.isArray(op['tags']))) {
          lacking.push(`${method} ${path}`);
        }
      }
    }
    expect(lacking).toEqual([]);
  });

  it('strips provenance parentheticals from the prose, nothing else', () => {
    expect(scrubInternalReferences('Never echoed (NFR-S7) back.')).toBe('Never echoed back.');
    expect(scrubInternalReferences('A scope (RL-02 · tm 325.3). Next.')).toBe('A scope. Next.');
    expect(scrubInternalReferences('Rejected (SSRF, NFR-S7), and checked')).toBe(
      'Rejected (SSRF, NFR-S7), and checked',
    );
    expect(scrubInternalReferences('Set `scopes` (see the list)')).toBe(
      'Set `scopes` (see the list)',
    );
    expect(publishedText).not.toMatch(/\(tm \d+\)/);
  });

  it('writes a table of public error types with their HTTP status', () => {
    const guide = buildPublicGuides().find((entry) => entry.id === 'errors')!;
    expect(guide.markdown).toContain('| `validation` | 400 |');
    expect(guide.markdown).toContain('| `too_many_requests` | 429 |');
    expect(guide.markdown).not.toContain('platform_');
  });

  it('documents authentication, webhook signatures, rate limits and errors', () => {
    expect(buildPublicGuides().map((guide) => guide.id)).toEqual([
      'authentication',
      'webhooks',
      'rate-limits',
      'errors',
    ]);
    expect(published['x-guides']).toHaveLength(4);
  });
});

describe('freshness: the page cannot silently go stale', () => {
  it('matches the committed data file — run `pnpm contract:generate` after a contract change', () => {
    const committed = readFileSync(PUBLIC_SPEC_PATH, 'utf8').replace(/\r\n/g, '\n');
    expect(composePublicSpecText(document)).toBe(committed);
  });

  it('versions the document like the contract and names a change for it', () => {
    const changelog = loadChangelog();
    expect(changelog[0]!.version).toBe(document.info.version);
    expect(published.info['version']).toBe(document.info.version);
    for (const entry of changelog) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });

  it('records the published surface: adding or removing an operation needs a changelog entry', () => {
    // On failure: put this value in the first entry of openapi/public-changelog.yaml (a new
    // version, if the change is for readers) and describe the change under `changes`.
    expect(loadChangelog()[0]!.surface).toBe(surfaceFingerprint(operations));
  });
});
