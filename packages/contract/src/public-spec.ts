/**
 * The publishable slice of the contract (KN-04 · tm 376).
 *
 * The OpenAPI source is the one truth, but most of its operations are the
 * panel's own plumbing (root-panel hooks, sandbox sessions, SCIM, impersonation,
 * settings screens). An operator's developer needs the small set a server-to-
 * server integration can actually use. An operation is published only when it
 * carries `x-public: true`; there is no opt-out marker, so an operation added
 * tomorrow is hidden until someone decides otherwise — the default is closed.
 *
 * Two independent guards stand behind that default:
 *
 *   1. {@link INTERNAL_OPERATION_PATTERNS} — paths that must never be published
 *      even if somebody stamps them. `buildPublicSpec` throws on a match, so the
 *      mistake fails the publish step instead of reaching a public page.
 *   2. `public-spec.test.ts` — the same check against the real contract, plus the
 *      platform (root panel) contract, which is a different file and must not
 *      share a single path with what is published.
 *
 * Everything here is pure (no I/O); `scripts/publish-docs.ts` does the reading
 * and writing so the same functions run in tests on the bundled document.
 */
import { createHash } from 'node:crypto';
import type { OpenApiDocument } from './document.js';
import { isPublicErrorType } from './public-guide.js';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** The marker an operation carries to be published. Stripped from the output. */
export const PUBLIC_MARKER = 'x-public';

/**
 * Paths that are internal by nature. A stamped operation matching one of these
 * is a mistake, not a decision: the publish step refuses it.
 */
export const INTERNAL_OPERATION_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^\/platform(\/|$)/, why: 'root panel (platform admin) surface' },
  { pattern: /^\/auth\/impersonation/, why: 'support impersonation' },
  { pattern: /sandbox/i, why: 'AI sandbox / test sessions' },
  { pattern: /(^|\/)reset(\/|$)|-reset(\/|$)/, why: 'reset / destructive maintenance actions' },
  { pattern: /^\/deployment(\/|$)/, why: 'deployment configuration (panel bootstrap)' },
  { pattern: /^\/scim(\/|$)/, why: 'SCIM provisioning (own credential, own documentation)' },
  {
    pattern: /^\/auth\/(login|signup|password|2fa|saml|sso|verify-email|invitations)/,
    why: 'panel sign-in flows',
  },
  {
    pattern: /^\/channels\/[^/]+\/(webhook|inbound)|^\/channels\/email\/inbound/,
    why: 'channel ingestion callbacks',
  },
  { pattern: /^\/settings\//, why: 'settings screens' },
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface PublicOperation {
  method: HttpMethod;
  path: string;
  operationId: string;
  tag: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  /** {@link surfaceFingerprint} of the published operations at this version. */
  surface: string;
  summary: string;
  changes: string[];
}

export interface GuideSection {
  id: string;
  title: string;
  markdown: string;
}

export interface PublicSpecInput {
  guides: GuideSection[];
  changelog: ChangelogEntry[];
}

export interface PublicSpec extends JsonObject {
  openapi: string;
  info: JsonObject;
  servers: Json;
  tags: Json;
  paths: JsonObject;
  components: JsonObject;
  security: Json;
  'x-guides': Json;
  'x-changelog': Json;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every operation of `document`, in document order, whether published or not. */
function allOperations(document: OpenApiDocument): Array<PublicOperation & { raw: JsonObject }> {
  const found: Array<PublicOperation & { raw: JsonObject }> = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (!isObject(item)) continue;
    for (const method of HTTP_METHODS) {
      const raw = item[method];
      if (!isObject(raw)) continue;
      const tags = Array.isArray(raw['tags']) ? raw['tags'] : [];
      found.push({
        method,
        path,
        operationId: String(raw['operationId'] ?? ''),
        tag: String(tags[0] ?? 'Other'),
        raw,
      });
    }
  }
  return found;
}

/** The published operations (those stamped `x-public: true`), in document order. */
export function publicOperations(document: OpenApiDocument): PublicOperation[] {
  return allOperations(document)
    .filter((operation) => operation.raw[PUBLIC_MARKER] === true)
    .map(({ raw: _raw, ...operation }) => operation);
}

/** The reason `path` may never be published, or `null` when nothing forbids it. */
export function internalReason(path: string, operationId = ''): string | null {
  for (const { pattern, why } of INTERNAL_OPERATION_PATTERNS) {
    if (pattern.test(path) || (operationId && pattern.test(operationId))) return why;
  }
  return null;
}

/**
 * A stable hash of WHICH operations are published. The changelog entry for the
 * current version records it, so adding or removing a published operation
 * without writing a changelog line turns a test red.
 */
export function surfaceFingerprint(operations: readonly PublicOperation[]): string {
  const lines = operations
    .map(
      (operation) => `${operation.method.toUpperCase()} ${operation.path} ${operation.operationId}`,
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/** `#/components/schemas/X` → `['schemas', 'X']`; anything else is a contract defect. */
function componentKey(ref: string): [string, string] {
  const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref);
  if (!match) throw new Error(`Only #/components/... references can be published, got ${ref}`);
  return [match[1]!, match[2]!.replace(/~1/g, '/').replace(/~0/g, '~')];
}

/** Collect every `$ref` string under `node` (a property *named* `$ref` is not a reference). */
function collectRefs(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectRefs(entry, into);
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') into.add(value);
    else collectRefs(value, into);
  }
}

/**
 * One internal reference: a task number, an ADR / NFR / FR code, a PRD section, a
 * decision record. The contract's prose carries them as provenance for the team;
 * a reader of the public page has no use for them.
 */
const INTERNAL_CODE = String.raw`(?:tm \d+(?:\.\d+)?|ADR-\d+[a-z]?(?: §[\d.]+)?|NFR-[A-Z]+\d+|FR-MOD-[\d.]+(?:-\.\d+)?(?: / [\d.]+)?|FR-ADMIN-\d+|[A-Z]{2,4}-\d{2}(?:-S\d+)?|M-[A-Z]+(?:-[A-Za-z0-9]+)?|§D\d+(?:[/ ][A-Z0-9]+)*(?: [A-Z]+(?: \([a-z]\))?)?|K\d+|PRD §[\d.]+(?: "[^"]*")?|PLAN §D\d+|SEMA-MIMARI[\d.a-z]*|v2-0\d §[\d.]+|RFC \d+ §[\d.]+)`;
const INTERNAL_REFERENCE = new RegExp(
  String.raw`\s*\(\s*${INTERNAL_CODE}(?:\s*[·,;]\s*${INTERNAL_CODE})*\s*\)`,
  'g',
);

/**
 * Prose with its provenance parentheticals — `(NFR-S7)`, `(tm 261)`,
 * `(RL-02 · tm 325.3)` — removed. Only a parenthesis made of nothing but codes
 * goes; a code inside a longer sentence is left alone rather than leave the
 * sentence broken.
 */
export function scrubInternalReferences(text: string): string {
  return text.replace(INTERNAL_REFERENCE, '');
}

/** `description` / `summary` strings of a published tree, scrubbed (the input is not modified). */
function scrubTree(node: Json): Json {
  if (Array.isArray(node)) return node.map(scrubTree);
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] =
      (key === 'description' || key === 'summary') && typeof value === 'string'
        ? scrubInternalReferences(value)
        : scrubTree(value);
  }
  return out;
}

/** The `x-public` marker removed from an operation (the output carries no internal markers). */
function withoutMarker(operation: JsonObject): JsonObject {
  const { [PUBLIC_MARKER]: _marker, ...rest } = operation;
  return rest;
}

/**
 * The public document: only the stamped operations, only the components they
 * reach, the platform's own title/description replaced by the public ones, the
 * guides and the changelog attached as `x-guides` / `x-changelog`.
 *
 * @throws when a stamped operation is internal by pattern, has no operationId, or
 *         references something outside `#/components`.
 */
export function buildPublicSpec(document: OpenApiDocument, input: PublicSpecInput): PublicSpec {
  const stamped = allOperations(document).filter(
    (operation) => operation.raw[PUBLIC_MARKER] === true,
  );
  if (stamped.length === 0)
    throw new Error('No operation carries x-public: true — nothing to publish');

  const paths: JsonObject = {};
  for (const operation of stamped) {
    const why = internalReason(operation.path, operation.operationId);
    if (why) {
      throw new Error(
        `${operation.method.toUpperCase()} ${operation.path} (${operation.operationId}) is stamped x-public ` +
          `but is internal: ${why}. Remove the stamp.`,
      );
    }
    if (!operation.operationId)
      throw new Error(`${operation.method} ${operation.path} has no operationId`);

    const source = document.paths[operation.path] as JsonObject;
    const item = (paths[operation.path] ??= {}) as JsonObject;
    // Path-level parameters apply to every method below; carry them along.
    if (source['parameters'] !== undefined) item['parameters'] = source['parameters'];
    item[operation.method] = withoutMarker(operation.raw);
  }

  // Components, by reachability: a schema that no published operation touches
  // (directly or through another schema) does not appear.
  const source = (document.components ?? {}) as Record<string, Record<string, Json>>;
  const reached = new Map<string, Set<string>>();
  const queue: string[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    const refs = new Set<string>();
    collectRefs(node, refs);
    for (const ref of refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      queue.push(ref);
    }
  };
  visit(paths);
  while (queue.length > 0) {
    const ref = queue.pop()!;
    const [section, name] = componentKey(ref);
    const target = source[section]?.[name];
    if (target === undefined)
      throw new Error(`Published operations reference ${ref}, which does not exist`);
    (reached.get(section) ?? reached.set(section, new Set()).get(section)!).add(name);
    visit(target);
  }

  const components: JsonObject = {};
  for (const [section, names] of reached) {
    const kept: JsonObject = {};
    // Source order, not discovery order, so the output is stable.
    for (const name of Object.keys(source[section] ?? {})) {
      if (names.has(name)) kept[name] = source[section]![name]!;
    }
    components[section] = kept;
  }
  // The error vocabulary is one shared enum; its back-office members (root panel,
  // impersonation, sandbox) are not something a public client can meet or should read.
  const schemas = components['schemas'];
  if (
    isObject(schemas) &&
    isObject(schemas['ErrorType']) &&
    Array.isArray(schemas['ErrorType']['enum'])
  ) {
    schemas['ErrorType'] = {
      ...schemas['ErrorType'],
      enum: schemas['ErrorType']['enum'].filter(
        (type) => typeof type === 'string' && isPublicErrorType(type),
      ),
    };
  }
  // Security schemes are not referenced by `$ref`; the document-level requirement names them.
  if (source['securitySchemes'])
    components['securitySchemes'] = source['securitySchemes'] as JsonObject;

  const usedTags = new Set(stamped.map((operation) => operation.tag));
  const tags = ((document['tags'] as JsonObject[] | undefined) ?? []).filter((tag) =>
    usedTags.has(String(tag['name'])),
  );

  const latest = input.changelog[0];
  return {
    openapi: document.openapi,
    info: {
      title: 'SiyahTuş API',
      version: document.info.version,
      description:
        'The SiyahTuş HTTP API: chats, customers, tickets, webhooks and uploads. ' +
        'Generated from the contract the server itself is built against.' +
        (latest ? ` Last changed ${latest.date}.` : ''),
    },
    servers: (document['servers'] as Json) ?? [],
    tags,
    paths: scrubTree(paths) as JsonObject,
    components: scrubTree(components) as JsonObject,
    security: (document['security'] as Json) ?? [],
    'x-guides': input.guides as unknown as Json,
    'x-changelog': input.changelog as unknown as Json,
  };
}

/** The deterministic text written to disk (and compared by the drift test). */
export function serializePublicSpec(spec: PublicSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
