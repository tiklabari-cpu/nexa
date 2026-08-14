/**
 * SCIM 2.0 protocol shapes (RFC 7643/7644) — NFR-S11 · S11-e.
 *
 * Everything here is pure: no database, no Fastify, no clock beyond what the
 * caller passes in. `routes/scim.ts` owns authentication, the tenant context and
 * the writes; this file owns "what does the wire look like, and what did the
 * client just ask for". Same split as `lib/saml.ts` / `routes/saml.ts`, and for
 * the same reason — the parsing rules are where the sharp edges are, and they
 * are worth testing without a server in the way.
 *
 * ## The error envelope is not ADR-06 here, deliberately
 *
 * Every other response in this API carries `{ error: { type, message,
 * request_id } }`. SCIM specifies its own (RFC 7644 §3.12):
 *
 *     { "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
 *       "status": "409", "scimType": "uniqueness", "detail": "…" }
 *
 * and the clients that call these endpoints — Okta, Entra, OneLogin — are
 * closed-source connectors that parse exactly that. `scimType` in particular is
 * how a client tells "this user already exists, adopt it" from "your request was
 * malformed, stop retrying". An envelope of our own would be correct by our
 * documentation and useless to every caller the endpoint has.
 *
 * The *taxonomy* is untouched: routes still throw `ApiError` with the same
 * `ErrorType` values as everywhere else, so the status is still derived from the
 * type and the two still cannot drift. Only the rendering differs, and only
 * inside this one plugin. Recorded as a deliberate exception in PLAN §D.
 */
import { ApiError } from './api-error.js';
import type { ErrorType } from '@nexa/types';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** RFC 7644 §3.1 — what a SCIM endpoint sends and accepts. */
export const SCIM_CONTENT_TYPE = 'application/scim+json';

/** The subset of RFC 7644 §3.12 `scimType` values this server produces. */
export type ScimType =
  | 'invalidFilter'
  | 'invalidPath'
  | 'invalidSyntax'
  | 'invalidValue'
  | 'mutability'
  | 'noTarget'
  | 'tooMany'
  | 'uniqueness';

/**
 * The largest page a client may ask for.
 *
 * A directory sync pages through everybody, so the limit is about bounding one
 * response rather than discouraging the caller: 200 memberships with their
 * accounts joined is a few tens of kilobytes, and a client that asks for more
 * gets 200 rather than an error (RFC 7644 §3.4.2.4 lets the server decide the
 * maximum, and failing a sync over a paging preference would be absurd).
 */
export const SCIM_MAX_PAGE_SIZE = 200;
export const SCIM_DEFAULT_PAGE_SIZE = 100;

/**
 * An `ApiError` that the SCIM error renderer can turn into RFC 7644's envelope.
 *
 * The `scim_type` rides in `details`, which is where the ADR-06 envelope already
 * carries per-error extras — so a SCIM error thrown on a non-SCIM path (it never
 * is, but the type system does not know that) still renders as a valid ADR-06
 * body instead of losing information.
 */
export function scimProblem(type: ErrorType, detail: string, scimType?: ScimType): ApiError {
  return new ApiError(type, detail, scimType ? { details: { scim_type: scimType } } : {});
}

/** RFC 7644 §3.12. `status` is a *string* there — it is not a mistake. */
export interface ScimErrorBody {
  schemas: [typeof SCIM_ERROR_SCHEMA];
  status: string;
  scimType?: ScimType;
  detail: string;
}

export function scimErrorBody(error: ApiError): ScimErrorBody {
  const scimType = error.details?.scim_type;
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(error.status),
    ...(typeof scimType === 'string' ? { scimType: scimType as ScimType } : {}),
    // The message, not a rewrite of it: these are already written for a machine
    // operator reading a connector's failure log.
    detail: error.message,
  };
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface ScimUserSource {
  /** The account uuid — stable for as long as the membership exists. */
  accountId: string;
  email: string;
  name: string;
  suspended: boolean;
  externalId: string | null;
  /** When the *membership* was created: SCIM's view is per workspace. */
  createdAt: Date;
}

export interface ScimUser {
  schemas: [typeof SCIM_USER_SCHEMA];
  id: string;
  externalId?: string;
  userName: string;
  name: { formatted: string };
  displayName: string;
  emails: Array<{ value: string; type: 'work'; primary: true }>;
  active: boolean;
  meta: { resourceType: 'User'; created: string; location: string };
}

/**
 * `meta.lastModified` and `meta.version` are omitted rather than invented.
 * `agent_memberships` records when somebody joined, not when their row last
 * changed, and a `lastModified` that silently answered `created` would make a
 * client's "has anything changed since?" sync skip real updates. Both
 * sub-attributes are optional in RFC 7643 §3.1; a missing one is honest, a wrong
 * one is a data-loss bug in somebody else's connector.
 */
export function serialiseScimUser(source: ScimUserSource, baseUrl: string): ScimUser {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: source.accountId,
    ...(source.externalId === null ? {} : { externalId: source.externalId }),
    userName: source.email,
    name: { formatted: source.name },
    displayName: source.name,
    emails: [{ value: source.email, type: 'work', primary: true }],
    active: !source.suspended,
    meta: {
      resourceType: 'User',
      created: source.createdAt.toISOString(),
      location: `${baseUrl}/Users/${source.accountId}`,
    },
  };
}

export interface ScimGroupSource {
  id: bigint;
  name: string;
  createdAt: Date;
  members: Array<{ accountId: string; display: string }>;
}

export interface ScimGroup {
  schemas: [typeof SCIM_GROUP_SCHEMA];
  id: string;
  displayName: string;
  members: Array<{ value: string; display: string; $ref: string }>;
  meta: { resourceType: 'Group'; created: string; location: string };
}

export function serialiseScimGroup(source: ScimGroupSource, baseUrl: string): ScimGroup {
  const id = source.id.toString();
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id,
    displayName: source.name,
    members: source.members.map((member) => ({
      value: member.accountId,
      display: member.display,
      $ref: `${baseUrl}/Users/${member.accountId}`,
    })),
    meta: {
      resourceType: 'Group',
      created: source.createdAt.toISOString(),
      location: `${baseUrl}/Groups/${id}`,
    },
  };
}

export interface ScimListResponse<T> {
  schemas: [typeof SCIM_LIST_RESPONSE_SCHEMA];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export function scimListResponse<T>(input: {
  resources: T[];
  totalResults: number;
  startIndex: number;
}): ScimListResponse<T> {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: input.totalResults,
    startIndex: input.startIndex,
    itemsPerPage: input.resources.length,
    Resources: input.resources,
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface ScimPage {
  /** 1-based, as SCIM counts. */
  startIndex: number;
  count: number;
}

/**
 * RFC 7644 §3.4.2.4, including its two odd rules: a `startIndex` below 1 is
 * *interpreted as* 1 rather than refused, and `count` may legitimately be 0 —
 * that is how a client asks "how many are there?" without transferring anybody.
 * Non-numeric input is a client bug and is refused.
 */
export function parseScimPage(query: {
  startIndex?: unknown;
  count?: unknown;
}): { ok: true; page: ScimPage } | { ok: false; detail: string } {
  const startIndex = readInteger(query.startIndex);
  if (startIndex === 'invalid') return { ok: false, detail: 'startIndex must be an integer.' };
  const count = readInteger(query.count);
  if (count === 'invalid') return { ok: false, detail: 'count must be an integer.' };

  return {
    ok: true,
    page: {
      startIndex: startIndex === undefined ? 1 : Math.max(1, startIndex),
      count:
        count === undefined
          ? SCIM_DEFAULT_PAGE_SIZE
          : Math.min(SCIM_MAX_PAGE_SIZE, Math.max(0, count)),
    },
  };
}

function readInteger(value: unknown): number | undefined | 'invalid' {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isInteger(value) ? value : 'invalid';
  if (typeof value !== 'string') return 'invalid';
  if (!/^-?\d+$/.test(value.trim())) return 'invalid';
  return Number.parseInt(value, 10);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ScimFilter {
  /** Normalised to the casing this server uses, whatever the client sent. */
  attribute: string;
  value: string | boolean;
}

export type ScimFilterRejection = 'malformed' | 'unsupported_attribute';

/**
 * A deliberately small slice of the SCIM filter grammar: `<attr> eq <value>`,
 * and nothing else.
 *
 * The full grammar (RFC 7644 §3.4.2.2) has `and`/`or`/`not`, grouping,
 * value paths and nine operators. Implementing it means writing a query
 * translator that turns arbitrary client input into SQL, which is a large
 * surface for a feature whose real callers send exactly two filters:
 * `userName eq "…"` before a create, and `externalId eq "…"` when a rename has
 * broken the userName match. Anything richer is refused with `invalidFilter` —
 * which RFC 7644 §3.4.2.2 explicitly provides for ("the service provider MAY
 * return … invalidFilter") — rather than silently mis-answered, and a refused
 * filter is a bug report; a mis-answered one is somebody else's user getting
 * patched.
 *
 * Attribute names are matched case-insensitively (SCIM attribute names are
 * case-insensitive) and returned in this server's casing, so a caller sending
 * `USERNAME` gets the same answer as one sending `userName`.
 */
export function parseScimFilter(
  raw: string,
  allowed: readonly string[],
): { ok: true; filter: ScimFilter } | { ok: false; reason: ScimFilterRejection } {
  const match = /^\s*([A-Za-z][\w.$-]*)\s+eq\s+(?:"((?:[^"\\]|\\.)*)"|(true|false))\s*$/i.exec(raw);
  if (!match) return { ok: false, reason: 'malformed' };

  const [, rawAttribute, quoted, bare] = match;
  const attribute = allowed.find((name) => name.toLowerCase() === rawAttribute!.toLowerCase());
  if (!attribute) return { ok: false, reason: 'unsupported_attribute' };

  const value =
    quoted === undefined
      ? bare!.toLowerCase() === 'true'
      : // The only escapes JSON strings can carry into a filter.
        quoted.replace(/\\(["\\])/g, '$1');

  return { ok: true, filter: { attribute, value } };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * What a create or a patch asked this server to store.
 *
 * Only two fields are here because only two are ours to write. A membership row
 * carries `suspended` and `scim_external_id`; everything else a SCIM User names
 * — the address, the display name — lives on `accounts`, which is global to the
 * product (PRD §8.4). Workspace A's directory connector renaming a person who
 * also works for workspace B is the same cross-tenant write `S11-d`'s
 * provisioning resolver refuses by rule, and it is refused here for the same
 * reason.
 */
export interface ScimUserChanges {
  active?: boolean;
  externalId?: string | null;
}

export interface ScimCreateUser {
  userName: string;
  externalId: string | null;
  active: boolean;
  /** Used only if the account does not exist yet; never applied to one that does. */
  displayName: string | null;
}

/**
 * Read a `POST /Users` body.
 *
 * `schemas` is not enforced. It is a constant the URL already implies, and
 * failing a directory sync because a connector omitted it would trade a real
 * outage for a documentation point. `userName` is what matters, and it is the
 * account's e-mail address: this product identifies a person by their address,
 * so a SCIM resource whose userName is not one has nothing to map to.
 */
export function readScimCreateUser(
  body: unknown,
): { ok: true; user: ScimCreateUser } | { ok: false; detail: string; scimType: ScimType } {
  if (!isRecord(body)) {
    return {
      ok: false,
      detail: 'The request body must be a SCIM User object.',
      scimType: 'invalidSyntax',
    };
  }

  const userName = typeof body.userName === 'string' ? body.userName.trim() : '';
  if (!userName) {
    return { ok: false, detail: 'userName is required.', scimType: 'invalidValue' };
  }
  if (!isEmailAddress(userName)) {
    return {
      ok: false,
      detail: 'userName must be an e-mail address — this workspace identifies people by address.',
      scimType: 'invalidValue',
    };
  }

  const externalId = readExternalId(body.externalId);
  if (externalId === 'invalid') {
    return {
      ok: false,
      detail: 'externalId must be a non-empty string of at most 255 characters.',
      scimType: 'invalidValue',
    };
  }

  const active = body.active === undefined ? true : coerceScimBoolean(body.active);
  if (active === undefined) {
    return { ok: false, detail: 'active must be a boolean.', scimType: 'invalidValue' };
  }

  return {
    ok: true,
    user: { userName, externalId: externalId ?? null, active, displayName: readDisplayName(body) },
  };
}

/**
 * The name to give a *brand new* account, or null to let the resolver fall back
 * to the local part of the address.
 *
 * Reads the three shapes real clients send, in the order of how specific they
 * are. `givenName`/`familyName` are joined rather than stored apart because this
 * product's `accounts.name` is one string — splitting a person's name into two
 * columns to satisfy one protocol would be a schema change made by a client.
 */
function readDisplayName(body: Record<string, unknown>): string | null {
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    return body.displayName.trim();
  }
  const name = isRecord(body.name) ? body.name : undefined;
  if (name) {
    if (typeof name.formatted === 'string' && name.formatted.trim()) return name.formatted.trim();
    const parts = [name.givenName, name.familyName]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .map((part) => part.trim());
    if (parts.length > 0) return parts.join(' ');
  }
  return null;
}

export interface ScimPatchResult {
  changes: ScimUserChanges;
  /**
   * `userName` values the request asserted. The caller compares each against the
   * stored address and refuses a *change* — see `readScimPatch`.
   */
  assertedUserNames: string[];
}

/**
 * Interpret a `PatchOp` body (RFC 7644 §3.5.2).
 *
 * Three shapes are in the wild and all three are accepted: `{op, path, value}`
 * (the specification's), `{op, value: {attr: …}}` (Okta's, path omitted), and
 * `op`/boolean values arriving as differently-cased strings (`"Replace"`,
 * `"False"` — Entra's). Refusing any of them would be technically defensible and
 * would break provisioning for a large share of the enterprise IdPs this feature
 * exists for.
 *
 * Attributes this server does not own are accepted and not applied, with one
 * exception: `userName`. That one is the sign-in identifier, so quietly not
 * applying a change to it would leave the identity provider believing somebody's
 * address had moved when it had not — a divergence with security consequences,
 * unlike a stale display name. The caller therefore gets the asserted values back
 * and answers `mutability` when they differ from what is stored.
 */
export function readScimPatch(
  body: unknown,
): { ok: true; patch: ScimPatchResult } | { ok: false; detail: string; scimType: ScimType } {
  if (!isRecord(body) || !Array.isArray(body.Operations)) {
    return {
      ok: false,
      detail: 'Operations must be an array of patch operations.',
      scimType: 'invalidSyntax',
    };
  }
  if (body.Operations.length === 0) {
    return { ok: false, detail: 'Operations must not be empty.', scimType: 'invalidValue' };
  }
  if (body.Operations.length > 50) {
    return { ok: false, detail: 'Too many operations in one request.', scimType: 'tooMany' };
  }

  const changes: ScimUserChanges = {};
  const assertedUserNames: string[] = [];

  for (const raw of body.Operations) {
    if (!isRecord(raw)) {
      return { ok: false, detail: 'Each operation must be an object.', scimType: 'invalidSyntax' };
    }
    const op = typeof raw.op === 'string' ? raw.op.toLowerCase() : '';
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      return {
        ok: false,
        detail: `Unsupported op "${String(raw.op)}".`,
        scimType: 'invalidSyntax',
      };
    }

    // Path-less add/replace: the value is a map of attribute to new value.
    if (raw.path === undefined || raw.path === null || raw.path === '') {
      if (op === 'remove') {
        return { ok: false, detail: 'A remove operation requires a path.', scimType: 'noTarget' };
      }
      if (!isRecord(raw.value)) {
        return {
          ok: false,
          detail: 'A patch operation without a path must carry an object value.',
          scimType: 'invalidValue',
        };
      }
      for (const [attribute, value] of Object.entries(raw.value)) {
        const applied = applyPatchAttribute(
          attribute,
          'replace',
          value,
          changes,
          assertedUserNames,
        );
        if (applied) return applied;
      }
      continue;
    }

    if (typeof raw.path !== 'string') {
      return { ok: false, detail: 'path must be a string.', scimType: 'invalidPath' };
    }
    const applied = applyPatchAttribute(raw.path, op, raw.value, changes, assertedUserNames);
    if (applied) return applied;
  }

  return { ok: true, patch: { changes, assertedUserNames } };
}

/** Returns a rejection, or undefined when the attribute was handled. */
function applyPatchAttribute(
  path: string,
  op: 'add' | 'replace' | 'remove',
  value: unknown,
  changes: ScimUserChanges,
  assertedUserNames: string[],
): { ok: false; detail: string; scimType: ScimType } | undefined {
  // Clients qualify paths with the schema URN (`urn:…:User:active`); the
  // unqualified form means the same attribute.
  const attribute = path.replace(new RegExp(`^${SCIM_USER_SCHEMA}:`, 'i'), '').toLowerCase();

  if (attribute === 'active') {
    if (op === 'remove') {
      return { ok: false, detail: 'active cannot be removed.', scimType: 'invalidPath' };
    }
    const parsed = coerceScimBoolean(value);
    if (parsed === undefined) {
      return { ok: false, detail: 'active must be a boolean.', scimType: 'invalidValue' };
    }
    changes.active = parsed;
    return undefined;
  }

  if (attribute === 'externalid') {
    if (op === 'remove') {
      changes.externalId = null;
      return undefined;
    }
    const parsed = readExternalId(value);
    if (parsed === 'invalid') {
      return {
        ok: false,
        detail: 'externalId must be a non-empty string of at most 255 characters.',
        scimType: 'invalidValue',
      };
    }
    changes.externalId = parsed ?? null;
    return undefined;
  }

  if (attribute === 'username') {
    if (op === 'remove') {
      return { ok: false, detail: 'userName cannot be removed.', scimType: 'mutability' };
    }
    if (typeof value !== 'string') {
      return { ok: false, detail: 'userName must be a string.', scimType: 'invalidValue' };
    }
    assertedUserNames.push(value.trim());
    return undefined;
  }

  // Everything else — displayName, name.*, emails, title, department … — is
  // accepted and not applied. See the header on `ScimUserChanges`.
  return undefined;
}

/**
 * Entra sends `"True"`/`"False"` as strings for `active`. Accepting them is not
 * leniency for its own sake: a boolean that arrives quoted is unambiguous, and
 * refusing it would break deprovisioning — the single most important operation
 * this endpoint performs — for one of the two IdPs that matter most.
 */
export function coerceScimBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (normalised === 'true') return true;
    if (normalised === 'false') return false;
  }
  return undefined;
}

function readExternalId(value: unknown): string | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 255) return 'invalid';
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deliberately the same shape check the rest of the product applies to an
 * address, not a full RFC 5322 parser: `accounts.email` is a citext column with
 * a unique index, and what matters is that two spellings of one address cannot
 * become two people.
 */
function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= 254;
}
