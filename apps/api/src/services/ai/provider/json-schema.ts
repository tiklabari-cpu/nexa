/**
 * The JSON Schema a structured model call may ask for (tm 283.1 · ADR
 * `docs/adr/pilot-llm-embedding-provider.md` §6a.3, §6a.4).
 *
 * Three jobs, one subset:
 *
 * - {@link assertStrictJsonSchema} refuses a schema OpenAI's strict mode would
 *   refuse — before a request is sent. A schema it rejects comes back as a 400
 *   whose `param` is `response_format`, the same answer a model without
 *   structured outputs gives (§6a.4.1), so a mistake in a caller's schema would
 *   otherwise be remembered as "this model cannot do it" for the life of the
 *   process.
 * - {@link validateJson} is the server-side gate every reply passes, whatever
 *   wrote it (§6a.2: `strict` does not replace it). It answers with the first
 *   problem's path and rule — never with the value, which is the model's text.
 * - {@link exampleForSchema} is what `LLM_PROVIDER=mock` answers (§6a.6): one
 *   deterministic object that passes `validateJson`.
 *
 * **The subset** is what OpenAI's structured outputs guide lists for strict
 * mode (checked 2026-10-15 against
 * https://developers.openai.com/api/docs/guides/structured-outputs, "Supported
 * schemas"), narrowed to the keywords this file can also check: the root is an
 * object, every object lists all of its properties as `required` and sets
 * `additionalProperties: false`, an optional field is a type union with
 * `'null'`, `anyOf` is allowed below the root, at most 10 levels of nesting.
 * `pattern` and `format` are in OpenAI's list but not here: a regular
 * expression written for the provider's engine is not necessarily one
 * JavaScript reads the same way, and a gate that checks a different rule than
 * the one the model was given is a gate with a hole. A caller needing either
 * checks it after the gate, in its own code, where the decision lives anyway.
 */

export type JsonSchemaType =
  'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/** One node of a strict structured-output schema. Keys outside this list are refused. */
export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  enum?: ReadonlyArray<string | number | boolean | null>;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  anyOf?: readonly JsonSchema[];
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'type',
  'description',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
]);

const TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
]);

/** OpenAI's limit on nesting (the guide's "up to 10 levels"). */
export const JSON_SCHEMA_MAX_DEPTH = 10;

/** `response_format.json_schema.name`: letters, digits, `_` and `-`, at most 64. */
export const JSON_SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function typesOf(node: JsonSchema): JsonSchemaType[] {
  if (node.type === undefined) return [];
  return Array.isArray(node.type) ? node.type : [node.type];
}

/**
 * Throws when `schema` is outside the strict subset. A plain `Error`, not an
 * `LlmProviderError`: a schema is written by a developer, and a wrong one is a
 * defect to fix, not a conversation to hand to a human.
 */
export function assertStrictJsonSchema(name: string, schema: JsonSchema): void {
  if (!JSON_SCHEMA_NAME.test(name)) {
    throw new Error(`Structured output name "${name}" must match ${JSON_SCHEMA_NAME}.`);
  }
  if (typesOf(schema).join() !== 'object' || schema.anyOf) {
    throw new Error(`Structured output "${name}": the root must be {type: 'object'}, not anyOf.`);
  }
  checkNode(name, schema, '$', 1);
}

function checkNode(name: string, node: JsonSchema, path: string, depth: number): void {
  const refuse = (rule: string): never => {
    throw new Error(`Structured output "${name}" at ${path}: ${rule}`);
  };
  if (depth > JSON_SCHEMA_MAX_DEPTH) refuse(`nested deeper than ${JSON_SCHEMA_MAX_DEPTH} levels`);
  if (typeof node !== 'object' || node === null || Array.isArray(node)) refuse('not a schema');
  for (const key of Object.keys(node)) {
    if (!KNOWN_KEYS.has(key)) refuse(`keyword "${key}" is outside the strict subset`);
  }

  if (node.anyOf) {
    if (node.type !== undefined || node.enum) refuse('anyOf stands alone, without type or enum');
    if (node.anyOf.length < 2) refuse('anyOf needs at least two branches');
    node.anyOf.forEach((branch, i) => checkNode(name, branch, `${path}.anyOf[${i}]`, depth + 1));
    return;
  }

  const types = typesOf(node);
  if (types.length === 0 && !node.enum) refuse('needs a type or an enum');
  for (const type of types) if (!TYPES.has(type)) refuse(`unknown type "${type}"`);
  if (new Set(types).size !== types.length) refuse('a type is listed twice');

  if (types.includes('object')) {
    const properties = node.properties ?? {};
    const keys = Object.keys(properties);
    if (node.additionalProperties !== false) refuse('an object needs additionalProperties: false');
    const required = node.required ?? [];
    if (required.length !== keys.length || keys.some((key) => !required.includes(key))) {
      refuse('every property must be required (write an optional one as a union with "null")');
    }
    for (const key of keys) checkNode(name, properties[key]!, `${path}.${key}`, depth + 1);
  } else if (node.properties || node.required || node.additionalProperties !== undefined) {
    refuse('properties/required/additionalProperties belong to an object');
  }

  if (types.includes('array')) {
    if (!node.items) refuse('an array needs items');
    checkNode(name, node.items!, `${path}[]`, depth + 1);
    if (
      node.minItems !== undefined &&
      node.maxItems !== undefined &&
      node.minItems > node.maxItems
    ) {
      refuse('minItems is above maxItems');
    }
  } else if (node.items || node.minItems !== undefined || node.maxItems !== undefined) {
    refuse('items/minItems/maxItems belong to an array');
  }

  const numeric = types.includes('number') || types.includes('integer');
  if (!numeric && (node.minimum !== undefined || node.maximum !== undefined)) {
    refuse('minimum/maximum belong to a number');
  }
  if (node.enum && node.enum.length === 0) refuse('an enum needs at least one value');
}

/**
 * The first way `value` breaks `schema`, as `<path>: <rule>`, or `null` when
 * it conforms. The message names a place and a rule, never the value: it goes
 * into a log line and into the retry prompt (§6a.4.3), and the value is
 * whatever the model wrote — which can quote the customer.
 */
export function validateJson(value: unknown, schema: JsonSchema, path = '$'): string | null {
  if (schema.anyOf) {
    return schema.anyOf.some((branch) => validateJson(value, branch, path) === null)
      ? null
      : `${path}: matches no anyOf branch`;
  }

  if (schema.enum && !schema.enum.some((option) => option === value)) {
    return `${path}: not one of the enum values`;
  }

  const types = typesOf(schema);
  if (types.length > 0) {
    const type = types.find((candidate) => hasType(value, candidate));
    if (!type) return `${path}: expected ${types.join(' or ')}`;

    if (type === 'object') {
      const record = value as Record<string, unknown>;
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(record, key)) return `${path}: missing "${key}"`;
      }
      if (schema.additionalProperties === false) {
        const extra = Object.keys(record).find((key) => !Object.hasOwn(properties, key));
        if (extra !== undefined) return `${path}: unexpected property`;
      }
      for (const [key, child] of Object.entries(properties)) {
        if (!Object.hasOwn(record, key)) continue;
        const problem = validateJson(record[key], child, `${path}.${key}`);
        if (problem) return problem;
      }
    }

    if (type === 'array') {
      const list = value as unknown[];
      if (schema.minItems !== undefined && list.length < schema.minItems) {
        return `${path}: fewer than ${schema.minItems} items`;
      }
      if (schema.maxItems !== undefined && list.length > schema.maxItems) {
        return `${path}: more than ${schema.maxItems} items`;
      }
      if (schema.items) {
        for (let i = 0; i < list.length; i += 1) {
          const problem = validateJson(list[i], schema.items, `${path}[${i}]`);
          if (problem) return problem;
        }
      }
    }

    if (type === 'number' || type === 'integer') {
      const n = value as number;
      if (schema.minimum !== undefined && n < schema.minimum)
        return `${path}: below ${schema.minimum}`;
      if (schema.maximum !== undefined && n > schema.maximum)
        return `${path}: above ${schema.maximum}`;
    }
  }
  return null;
}

function hasType(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

/**
 * One object that passes `validateJson(…, schema)`, the same every time —
 * what the mock provider answers (§6a.6, MASTER-PROMPT "deterministic stub").
 *
 * The least committal value of each node: the first enum value, the first
 * `anyOf` branch, `null` where a field may be null, `false`, the minimum (or
 * 0), an empty string, an array of exactly `minItems` such values. Least
 * committal on purpose: a mock that answered "confident, wants a human,
 * procedure X" would make a decision in every test suite that nobody asked
 * for. A caller that needs a more telling stand-in builds it in its own task,
 * from its own input, on these terms.
 */
export function exampleForSchema(schema: JsonSchema): unknown {
  if (schema.anyOf) return exampleForSchema(schema.anyOf[0]!);
  if (schema.enum) return schema.enum[0];

  const types = typesOf(schema);
  if (types.includes('null')) return null;
  switch (types[0]) {
    case 'object':
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, child]) => [
          key,
          exampleForSchema(child),
        ]),
      );
    case 'array':
      return Array.from({ length: schema.minItems ?? 0 }, () => exampleForSchema(schema.items!));
    case 'number':
      return (
        schema.minimum ?? (schema.maximum !== undefined && schema.maximum < 0 ? schema.maximum : 0)
      );
    case 'integer':
      return schema.minimum !== undefined
        ? Math.ceil(schema.minimum)
        : schema.maximum !== undefined && schema.maximum < 0
          ? Math.floor(schema.maximum)
          : 0;
    case 'boolean':
      return false;
    default:
      return '';
  }
}
