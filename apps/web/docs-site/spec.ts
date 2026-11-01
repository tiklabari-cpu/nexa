/**
 * The documentation viewer's model of the published OpenAPI document (KN-04 · tm 376).
 *
 * Pure functions, no DOM: reading the document, resolving references, flattening a
 * schema into rows a reader can scan, searching, and writing a request example. The
 * rendering lives in `render.ts`; keeping the two apart is what lets the search and
 * the schema rules be tested without a browser.
 */

export const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Method = (typeof METHODS)[number];

export interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  nullable?: boolean;
  default?: unknown;
  example?: unknown;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  additionalProperties?: boolean | Schema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
  $ref?: string;
}

interface MediaType {
  schema?: Schema;
  example?: unknown;
}

export interface Response {
  description?: string;
  content?: Record<string, MediaType>;
  headers?: Record<string, { description?: string; schema?: Schema }>;
  $ref?: string;
}

export interface Operation {
  tags?: string[];
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, MediaType>;
    $ref?: string;
  };
  responses?: Record<string, Response>;
  security?: Array<Record<string, string[]>>;
}

export interface Guide {
  id: string;
  title: string;
  markdown: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  changes: string[];
}

export interface Spec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: Record<string, Record<string, unknown>>;
  security?: Array<Record<string, string[]>>;
  'x-guides'?: Guide[];
  'x-changelog'?: ChangelogEntry[];
}

export interface OperationEntry {
  id: string;
  method: Method;
  path: string;
  tag: string;
  operation: Operation;
  pathParameters: Parameter[];
  /** Everything a search looks through, lower-cased once. */
  haystack: string;
}

export interface TagGroup {
  name: string;
  description: string;
  operations: OperationEntry[];
}

export interface Model {
  spec: Spec;
  operations: OperationEntry[];
  byId: Map<string, OperationEntry>;
  groups: TagGroup[];
}

export function buildModel(spec: Spec): Model {
  const operations: OperationEntry[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    const pathParameters = (item['parameters'] as Parameter[] | undefined) ?? [];
    for (const method of METHODS) {
      const operation = item[method] as Operation | undefined;
      if (!operation) continue;
      const tag = operation.tags?.[0] ?? 'Other';
      const parameterNames = [...pathParameters, ...(operation.parameters ?? [])]
        .map((parameter) => parameter.name ?? '')
        .join(' ');
      operations.push({
        id: operation.operationId,
        method,
        path,
        tag,
        operation,
        pathParameters,
        haystack: [
          method,
          path,
          operation.operationId,
          operation.summary ?? '',
          tag,
          operation.description ?? '',
          parameterNames,
        ]
          .join(' ')
          .toLowerCase(),
      });
    }
  }

  const order = (spec.tags ?? []).map((tag) => tag.name);
  const groups = new Map<string, TagGroup>();
  for (const entry of operations) {
    let group = groups.get(entry.tag);
    if (!group) {
      const declared = spec.tags?.find((tag) => tag.name === entry.tag);
      group = { name: entry.tag, description: declared?.description ?? '', operations: [] };
      groups.set(entry.tag, group);
    }
    group.operations.push(entry);
  }
  const sorted = [...groups.values()].sort((a, b) => {
    const ia = order.indexOf(a.name);
    const ib = order.indexOf(b.name);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.name.localeCompare(b.name);
  });

  return {
    spec,
    operations,
    byId: new Map(operations.map((entry) => [entry.id, entry])),
    groups: sorted,
  };
}

/** Every term must occur (any order) in the entry's method, path, id, summary, tag, text or parameters. */
export function searchOperations(model: Model, query: string): OperationEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return model.operations;
  return model.operations.filter((entry) => terms.every((term) => entry.haystack.includes(term)));
}

/** Resolve `#/components/...`; anything else is not a reference this document uses. */
export function resolveRef<T>(spec: Spec, node: T & { $ref?: string }): T {
  let current: unknown = node;
  const seen = new Set<string>();
  while (
    current !== null &&
    typeof current === 'object' &&
    typeof (current as { $ref?: unknown }).$ref === 'string'
  ) {
    const ref = (current as { $ref: string }).$ref;
    if (seen.has(ref)) break;
    seen.add(ref);
    const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref);
    const target = match ? spec.components?.[match[1]!]?.[match[2]!] : undefined;
    if (target === undefined) break;
    current = target;
  }
  return current as T;
}

/** The component name a reference points at (`#/components/schemas/Chat` → `Chat`). */
export function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf('/') + 1);
}

export interface SchemaRow {
  /** Dotted path from the root, `[]` for array items. */
  name: string;
  depth: number;
  type: string;
  required: boolean;
  description: string;
  constraints: string[];
  /** Allowed values, when the schema is an enumeration. */
  values: string[];
}

function typeLabel(spec: Spec, schema: Schema): string {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.enum) return 'enum';
  if (schema.type === 'array' && schema.items) return `array of ${typeLabel(spec, schema.items)}`;
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
  if (schema.oneOf) return 'one of';
  if (schema.anyOf) return 'any of';
  if (schema.allOf) return 'object';
  const base = type ?? (schema.properties ? 'object' : 'any');
  return schema.format ? `${base} (${schema.format})` : base;
}

function constraintsOf(schema: Schema): string[] {
  const out: string[] = [];
  if (schema.nullable) out.push('nullable');
  if (schema.minimum !== undefined) out.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) out.push(`max ${schema.maximum}`);
  if (schema.minLength !== undefined) out.push(`min length ${schema.minLength}`);
  if (schema.maxLength !== undefined) out.push(`max length ${schema.maxLength}`);
  if (schema.default !== undefined) out.push(`default ${JSON.stringify(schema.default)}`);
  return out;
}

/** The properties of an object schema, `allOf` merged, a reference followed. */
function objectOf(
  spec: Spec,
  schema: Schema,
): { properties: Record<string, Schema>; required: Set<string> } {
  const properties: Record<string, Schema> = {};
  const required = new Set<string>();
  const merge = (part: Schema): void => {
    const resolved = resolveRef(spec, part);
    Object.assign(properties, resolved.properties ?? {});
    for (const name of resolved.required ?? []) required.add(name);
    for (const sub of resolved.allOf ?? []) merge(sub);
  };
  merge(schema);
  return { properties, required };
}

export const MAX_SCHEMA_DEPTH = 4;
export const MAX_SCHEMA_ROWS = 200;

/**
 * A schema flattened into the rows a table shows. A reference that is already
 * being expanded further up is shown by name and not entered again, and the walk
 * stops at a fixed depth, so a recursive schema cannot make the page unbounded.
 */
export function schemaRows(spec: Spec, schema: Schema, root = 'body'): SchemaRow[] {
  const rows: SchemaRow[] = [];

  const visit = (
    node: Schema,
    name: string,
    depth: number,
    required: boolean,
    stack: string[],
  ): void => {
    if (rows.length >= MAX_SCHEMA_ROWS) return;
    const resolved = resolveRef(spec, node);
    const cyclic = node.$ref !== undefined && stack.includes(node.$ref);
    rows.push({
      name,
      depth,
      type: typeLabel(spec, node.$ref ? node : resolved),
      required,
      description: (resolved.description ?? node.description ?? '').trim(),
      constraints: constraintsOf(resolved),
      values: (resolved.enum ?? []).map((value) => String(value)),
    });
    if (cyclic || depth >= MAX_SCHEMA_DEPTH) return;
    const nextStack = node.$ref ? [...stack, node.$ref] : stack;

    if (resolved.type === 'array' && resolved.items) {
      visit(resolved.items, `${name}[]`, depth + 1, false, nextStack);
      return;
    }
    for (const variant of [...(resolved.oneOf ?? []), ...(resolved.anyOf ?? [])]) {
      visit(variant, `${name} (variant)`, depth + 1, false, nextStack);
    }
    const object = objectOf(spec, resolved);
    for (const [property, child] of Object.entries(object.properties)) {
      visit(child, `${name}.${property}`, depth + 1, object.required.has(property), nextStack);
    }
    if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      visit(resolved.additionalProperties, `${name}.<key>`, depth + 1, false, nextStack);
    }
  };

  visit(schema, root, 0, false, []);
  return rows;
}

/** A plausible value for a schema, for the request example. Never throws, never recurses forever. */
export function exampleValue(spec: Spec, schema: Schema, depth = 0, stack: string[] = []): unknown {
  if (depth > 5) return null;
  const resolved = resolveRef(spec, schema);
  if (schema.$ref) {
    if (stack.includes(schema.$ref)) return null;
    stack = [...stack, schema.$ref];
  }
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.enum?.length) return resolved.enum[0];
  const combined = resolved.oneOf?.[0] ?? resolved.anyOf?.[0];
  if (combined) return exampleValue(spec, combined, depth + 1, stack);
  if (resolved.type === 'array') {
    return resolved.items ? [exampleValue(spec, resolved.items, depth + 1, stack)] : [];
  }
  const object = objectOf(spec, resolved);
  if (Object.keys(object.properties).length > 0 || resolved.type === 'object') {
    const out: Record<string, unknown> = {};
    // Required properties first; optional ones only while the example stays short.
    const names = Object.keys(object.properties);
    const chosen = names.filter((name) => object.required.has(name));
    for (const name of names) if (chosen.length < 6 && !chosen.includes(name)) chosen.push(name);
    for (const name of chosen)
      out[name] = exampleValue(spec, object.properties[name]!, depth + 1, stack);
    return out;
  }
  const type = Array.isArray(resolved.type)
    ? resolved.type.find((t) => t !== 'null')
    : resolved.type;
  switch (type) {
    case 'integer':
    case 'number':
      return resolved.minimum ?? 0;
    case 'boolean':
      return false;
    case 'string':
      if (resolved.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
      if (resolved.format === 'date-time') return '2026-01-01T00:00:00Z';
      if (resolved.format === 'uri') return 'https://example.com/hook';
      if (resolved.format === 'email') return 'player@example.com';
      return 'string';
    default:
      return null;
  }
}

export interface CurlOptions {
  baseUrl: string;
}

/** The request as a `curl` command with the documented credential. */
export function curlExample(model: Model, entry: OperationEntry, options: CurlOptions): string {
  const spec = model.spec;
  const parameters = [...entry.pathParameters, ...(entry.operation.parameters ?? [])].map(
    (parameter) => resolveRef(spec, parameter),
  );
  let path = entry.path;
  for (const parameter of parameters.filter((p) => p.in === 'path')) {
    path = path.replace(`{${parameter.name}}`, `<${parameter.name}>`);
  }
  const query = parameters
    .filter((p) => p.in === 'query' && p.required)
    .map((p) => `${p.name}=<${p.name}>`);
  const url = `${options.baseUrl}${path}${query.length ? `?${query.join('&')}` : ''}`;

  const anonymous =
    Array.isArray(entry.operation.security) && entry.operation.security.length === 0;
  const lines = [`curl -X ${entry.method.toUpperCase()} "${url}"`];
  if (!anonymous) lines.push('  -u "$ACCOUNT_ID:$SIYAHTUS_PAT"');

  const body = entry.operation.requestBody
    ? resolveRef(spec, entry.operation.requestBody)
    : undefined;
  const json = body?.content?.['application/json'];
  if (json?.schema) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${JSON.stringify(json.example ?? exampleValue(spec, json.schema))}'`);
  }
  return lines.join(' \\\n');
}

/** The server the examples call: the first listed one that is not localhost, else the first. */
export function baseUrlOf(spec: Spec): string {
  const servers = spec.servers ?? [];
  const remote = servers.find((server) => !/localhost|127\.0\.0\.1/.test(server.url));
  return (remote ?? servers[0])?.url ?? '/api/v1';
}
