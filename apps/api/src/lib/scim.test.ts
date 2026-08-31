/**
 * SCIM protocol parsing (S11-e).
 *
 * The endpoints are covered end-to-end in `test/integration/scim.test.ts`; what
 * is pinned here is the part where the sharp edges live — what a filter, a patch
 * and a create body are allowed to mean. Three groups matter most:
 *
 *   - **the filter subset actually refuses everything outside it.** A filter
 *     that parses "close enough" is how a client asking for one person gets
 *     somebody else patched, so `and`, `co`, `sw` and friends are pinned as
 *     rejections rather than left to whatever the regex happens to do.
 *   - **the three PatchOp dialects real connectors send all arrive at the same
 *     result.** Deprovisioning is the operation that matters most, and it
 *     reaches us as `"Replace"`/`"False"` from one IdP and a path-less object
 *     from another.
 *   - **attributes this server does not own are not silently written**, with
 *     `userName` singled out as an assertion the caller must check rather than
 *     an ignorable one.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error.js';
import {
  SCIM_DEFAULT_PAGE_SIZE,
  SCIM_MAX_PAGE_SIZE,
  coerceScimBoolean,
  parseScimFilter,
  parseScimPage,
  readScimCreateUser,
  readScimGroupPatch,
  readScimGroupResource,
  readScimPatch,
  scimErrorBody,
  scimListResponse,
  scimProblem,
  serialiseScimGroup,
  serialiseScimUser,
} from './scim.js';

const USER_ATTRIBUTES = ['userName', 'externalId', 'id', 'active'] as const;
const CREATED = new Date('2026-08-01T10:00:00.000Z');
const BASE = 'https://api.example/api/v1/scim/v2';

describe('scim errors', () => {
  it('renders RFC 7644 §3.12 rather than the ADR-06 envelope', () => {
    const body = scimErrorBody(
      scimProblem('account_exists', 'That userName is taken.', 'uniqueness'),
    );
    expect(body).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      // A string, not a number — the specification says so, and connectors
      // parse it as one.
      status: '409',
      scimType: 'uniqueness',
      detail: 'That userName is taken.',
    });
  });

  it('keeps the status derived from the error type, not passed in', () => {
    expect(scimProblem('validation', 'no').status).toBe(400);
    expect(scimProblem('not_found', 'no').status).toBe(404);
    expect(scimProblem('authentication', 'no').status).toBe(401);
  });

  it('omits scimType when there is no useful one, rather than inventing one', () => {
    expect(scimErrorBody(scimProblem('not_found', 'User not found.'))).not.toHaveProperty(
      'scimType',
    );
  });

  it('renders an error raised elsewhere in the API — the shared hooks throw these', () => {
    // A 401 from the authentication plugin and a 429 from the rate limiter reach
    // a SCIM client through this renderer, so they have to survive it.
    expect(scimErrorBody(ApiError.authentication()).status).toBe('401');
    expect(scimErrorBody(ApiError.tooManyRequests(30)).status).toBe('429');
  });
});

describe('scim filters', () => {
  it('reads the two filters connectors actually send', () => {
    expect(parseScimFilter('userName eq "ada@example.com"', USER_ATTRIBUTES)).toEqual({
      ok: true,
      filter: { attribute: 'userName', value: 'ada@example.com' },
    });
    expect(parseScimFilter('externalId eq "4711"', USER_ATTRIBUTES)).toEqual({
      ok: true,
      filter: { attribute: 'externalId', value: '4711' },
    });
  });

  it('reads unquoted booleans, which is how `active` arrives', () => {
    expect(parseScimFilter('active eq false', USER_ATTRIBUTES)).toEqual({
      ok: true,
      filter: { attribute: 'active', value: false },
    });
    expect(parseScimFilter('active eq true', USER_ATTRIBUTES)).toEqual({
      ok: true,
      filter: { attribute: 'active', value: true },
    });
  });

  it('matches attribute names case-insensitively and answers in our casing', () => {
    // SCIM attribute names are case-insensitive; a client sending USERNAME must
    // not get a different answer from one sending userName.
    expect(parseScimFilter('USERNAME Eq "ada@example.com"', USER_ATTRIBUTES)).toEqual({
      ok: true,
      filter: { attribute: 'userName', value: 'ada@example.com' },
    });
  });

  it('unescapes the two escapes a JSON string can carry in', () => {
    expect(parseScimFilter(String.raw`externalId eq "a\"b\\c"`, USER_ATTRIBUTES)).toEqual({
      ok: true,
      filter: { attribute: 'externalId', value: 'a"b\\c' },
    });
  });

  it('refuses every operator that is not `eq`', () => {
    for (const filter of [
      'userName co "ada"',
      'userName sw "ada"',
      'userName ne "ada@example.com"',
      'userName pr',
      'meta.lastModified gt "2026-01-01T00:00:00Z"',
    ]) {
      expect(parseScimFilter(filter, USER_ATTRIBUTES)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('refuses compound filters instead of matching the first clause', () => {
    // The dangerous failure mode: parsing `A and B` as `A` answers a narrower
    // question with a wider result set.
    for (const filter of [
      'userName eq "ada@example.com" and active eq true',
      'userName eq "ada@example.com" or userName eq "bob@example.com"',
      'not (userName eq "ada@example.com")',
      '(userName eq "ada@example.com")',
      'emails[type eq "work"].value eq "ada@example.com"',
    ]) {
      expect(parseScimFilter(filter, USER_ATTRIBUTES).ok).toBe(false);
    }
  });

  it('refuses an attribute outside the allow-list, and says which kind of refusal it is', () => {
    // The two rejections are distinguished so the endpoint can tell a client
    // "we do not filter on that" from "that is not a filter".
    expect(parseScimFilter('displayName eq "Ada"', USER_ATTRIBUTES)).toEqual({
      ok: false,
      reason: 'unsupported_attribute',
    });
    expect(parseScimFilter('nonsense', USER_ATTRIBUTES)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('scim paging', () => {
  it('defaults to the first page', () => {
    expect(parseScimPage({})).toEqual({
      ok: true,
      page: { startIndex: 1, count: SCIM_DEFAULT_PAGE_SIZE },
    });
  });

  it('reads a startIndex below 1 as 1, per RFC 7644 §3.4.2.4', () => {
    expect(parseScimPage({ startIndex: '0' })).toMatchObject({ page: { startIndex: 1 } });
    expect(parseScimPage({ startIndex: '-5' })).toMatchObject({ page: { startIndex: 1 } });
  });

  it('keeps count=0 — that is how a client asks only for totalResults', () => {
    expect(parseScimPage({ count: '0' })).toMatchObject({ page: { count: 0 } });
  });

  it('caps an oversized count rather than refusing the sync', () => {
    expect(parseScimPage({ count: '100000' })).toMatchObject({
      page: { count: SCIM_MAX_PAGE_SIZE },
    });
  });

  it('refuses non-numeric paging, which is a client bug and not a preference', () => {
    expect(parseScimPage({ count: 'ten' }).ok).toBe(false);
    expect(parseScimPage({ startIndex: '1.5' }).ok).toBe(false);
  });
});

describe('scim user serialisation', () => {
  const source = {
    accountId: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    suspended: false,
    externalId: '4711',
    createdAt: CREATED,
  };

  it('maps a membership onto the core User schema', () => {
    expect(serialiseScimUser(source, BASE)).toEqual({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: source.accountId,
      externalId: '4711',
      userName: 'ada@example.com',
      name: { formatted: 'Ada Lovelace' },
      displayName: 'Ada Lovelace',
      emails: [{ value: 'ada@example.com', type: 'work', primary: true }],
      active: true,
      meta: {
        resourceType: 'User',
        created: CREATED.toISOString(),
        location: `${BASE}/Users/${source.accountId}`,
      },
    });
  });

  it('reports a suspended membership as inactive — that is what deprovisioned means here', () => {
    expect(serialiseScimUser({ ...source, suspended: true }, BASE).active).toBe(false);
  });

  it('omits externalId entirely when there is none, rather than sending null', () => {
    expect(serialiseScimUser({ ...source, externalId: null }, BASE)).not.toHaveProperty(
      'externalId',
    );
  });

  it('omits meta.lastModified rather than answering it with created', () => {
    // A lastModified that silently equalled created would make a client's
    // incremental sync skip every real update.
    expect(serialiseScimUser(source, BASE).meta).not.toHaveProperty('lastModified');
  });
});

describe('scim group serialisation', () => {
  it('renders the per-license integer id as text and links each member', () => {
    const group = serialiseScimGroup(
      {
        id: BigInt(7),
        name: 'Support',
        createdAt: CREATED,
        members: [{ accountId: '11111111-1111-4111-8111-111111111111', display: 'Ada' }],
      },
      BASE,
    );
    expect(group.id).toBe('7');
    expect(group.displayName).toBe('Support');
    expect(group.members).toEqual([
      {
        value: '11111111-1111-4111-8111-111111111111',
        display: 'Ada',
        $ref: `${BASE}/Users/11111111-1111-4111-8111-111111111111`,
      },
    ]);
    expect(group.meta.location).toBe(`${BASE}/Groups/7`);
  });
});

describe('scim list response', () => {
  it('reports totalResults across every page, and itemsPerPage for this one', () => {
    const list = scimListResponse({ resources: ['a', 'b'], totalResults: 57, startIndex: 21 });
    expect(list).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 57,
      startIndex: 21,
      itemsPerPage: 2,
      Resources: ['a', 'b'],
    });
  });
});

describe('reading a create', () => {
  it('takes userName as the address and defaults active to true', () => {
    const result = readScimCreateUser({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: ' ada@example.com ',
      externalId: '4711',
      displayName: 'Ada Lovelace',
    });
    expect(result).toEqual({
      ok: true,
      user: {
        userName: 'ada@example.com',
        externalId: '4711',
        active: true,
        displayName: 'Ada Lovelace',
      },
    });
  });

  it('accepts a body with no `schemas` — the URL already says which resource this is', () => {
    expect(readScimCreateUser({ userName: 'ada@example.com' }).ok).toBe(true);
  });

  it('builds a display name out of the three shapes clients send', () => {
    const from = (body: Record<string, unknown>) => {
      const result = readScimCreateUser({ userName: 'ada@example.com', ...body });
      return result.ok ? result.user.displayName : 'REJECTED';
    };
    expect(from({ displayName: 'Ada L' })).toBe('Ada L');
    expect(from({ name: { formatted: 'Ada Lovelace' } })).toBe('Ada Lovelace');
    expect(from({ name: { givenName: 'Ada', familyName: 'Lovelace' } })).toBe('Ada Lovelace');
    expect(from({ name: { givenName: 'Ada' } })).toBe('Ada');
    // Nothing usable: the caller falls back to the address, not to an empty name.
    expect(from({})).toBeNull();
  });

  it('refuses a userName that is not an address', () => {
    for (const userName of ['ada', 'ada@localhost', 'ada@@example.com', '']) {
      const result = readScimCreateUser({ userName });
      expect(result.ok).toBe(false);
    }
  });

  it('refuses an unusable externalId rather than storing a blank one', () => {
    expect(readScimCreateUser({ userName: 'a@b.com', externalId: '  ' }).ok).toBe(false);
    expect(readScimCreateUser({ userName: 'a@b.com', externalId: 'x'.repeat(256) }).ok).toBe(false);
    expect(readScimCreateUser({ userName: 'a@b.com', externalId: 42 }).ok).toBe(false);
    // Absent is fine — a directory that does not send one is normal.
    expect(readScimCreateUser({ userName: 'a@b.com' })).toMatchObject({
      user: { externalId: null },
    });
  });

  it('accepts a quoted boolean for active on create, as one IdP sends it', () => {
    expect(readScimCreateUser({ userName: 'a@b.com', active: 'False' })).toMatchObject({
      user: { active: false },
    });
    expect(readScimCreateUser({ userName: 'a@b.com', active: 'nope' }).ok).toBe(false);
  });

  it('refuses a body that is not an object at all', () => {
    expect(readScimCreateUser(null).ok).toBe(false);
    expect(readScimCreateUser(['a']).ok).toBe(false);
    expect(readScimCreateUser('userName=a').ok).toBe(false);
  });
});

describe('reading a patch', () => {
  const patch = (operations: unknown[]) => readScimPatch({ Operations: operations });

  it('reads the specification shape', () => {
    expect(patch([{ op: 'replace', path: 'active', value: false }])).toEqual({
      ok: true,
      patch: { changes: { active: false }, assertedUserNames: [] },
    });
  });

  it('reads the path-less shape one connector sends', () => {
    expect(patch([{ op: 'replace', value: { active: false } }])).toMatchObject({
      patch: { changes: { active: false } },
    });
  });

  it('reads the differently-cased shape another connector sends', () => {
    // "Replace" + "False" — refusing this would break deprovisioning, which is
    // the single most important operation on this endpoint.
    expect(patch([{ op: 'Replace', path: 'active', value: 'False' }])).toMatchObject({
      patch: { changes: { active: false } },
    });
  });

  it('reads a path qualified with the schema URN', () => {
    expect(
      patch([
        {
          op: 'replace',
          path: 'urn:ietf:params:scim:schemas:core:2.0:User:active',
          value: true,
        },
      ]),
    ).toMatchObject({ patch: { changes: { active: true } } });
  });

  it('treats removing externalId as clearing it', () => {
    expect(patch([{ op: 'remove', path: 'externalId' }])).toMatchObject({
      patch: { changes: { externalId: null } },
    });
  });

  it('reports a userName rather than applying it — the caller decides', () => {
    // The address is the sign-in identifier and lives on a globally shared
    // account, so this parser hands it back as an assertion rather than a change.
    expect(patch([{ op: 'replace', path: 'userName', value: ' Ada@example.com ' }])).toEqual({
      ok: true,
      patch: { changes: {}, assertedUserNames: ['Ada@example.com'] },
    });
  });

  it('accepts attributes this server does not own without writing anything', () => {
    expect(
      patch([
        { op: 'replace', path: 'displayName', value: 'Ada L' },
        { op: 'replace', path: 'name.givenName', value: 'Ada' },
        { op: 'add', path: 'title', value: 'Countess' },
        { op: 'remove', path: 'department' },
      ]),
    ).toEqual({ ok: true, patch: { changes: {}, assertedUserNames: [] } });
  });

  it('applies several operations in one request', () => {
    expect(
      patch([
        { op: 'replace', path: 'active', value: false },
        { op: 'replace', path: 'externalId', value: '4712' },
      ]),
    ).toMatchObject({ patch: { changes: { active: false, externalId: '4712' } } });
  });

  it('refuses a malformed PatchOp instead of guessing at it', () => {
    expect(readScimPatch({}).ok).toBe(false);
    expect(readScimPatch({ Operations: [] }).ok).toBe(false);
    expect(patch(['replace active false']).ok).toBe(false);
    expect(patch([{ op: 'delete', path: 'active' }]).ok).toBe(false);
    expect(patch([{ op: 'replace', path: 'active', value: 'maybe' }]).ok).toBe(false);
    expect(patch([{ op: 'replace', path: 42, value: true }]).ok).toBe(false);
    // A path-less operation whose value is not a map of attributes.
    expect(patch([{ op: 'replace', value: 'active' }]).ok).toBe(false);
    // remove needs a target.
    expect(patch([{ op: 'remove' }]).ok).toBe(false);
    // active is not optional in this model, so removing it is a path error.
    expect(patch([{ op: 'remove', path: 'active' }]).ok).toBe(false);
    expect(patch([{ op: 'remove', path: 'userName' }]).ok).toBe(false);
  });

  it('bounds how much one request may ask for', () => {
    const many = Array.from({ length: 51 }, () => ({ op: 'replace', path: 'active', value: true }));
    expect(patch(many)).toMatchObject({ ok: false, scimType: 'tooMany' });
  });
});

describe('reading a Group resource', () => {
  const ADA = '11111111-1111-4111-8111-111111111111';
  const GRACE = '22222222-2222-4222-8222-222222222222';

  it('reads a name and its members', () => {
    expect(
      readScimGroupResource({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: '  Support  ',
        members: [{ value: ADA, display: 'Ada' }, { value: GRACE }],
      }),
    ).toEqual({ ok: true, group: { displayName: 'Support', members: [ADA, GRACE] } });
  });

  it('takes a bare id as well as a member object', () => {
    // Both are unambiguous and some connectors send the short form; refusing it
    // would break provisioning over a spelling.
    expect(readScimGroupResource({ displayName: 'Support', members: [ADA] })).toMatchObject({
      group: { members: [ADA] },
    });
  });

  it('reads an absent members as an empty team, not as "leave it alone"', () => {
    // The one place `PUT` and `PATCH` differ, and the reason `PUT` says so in
    // the contract: a whole-resource write that quietly kept a membership it was
    // not sent leaves the directory and the product disagreeing about who is on
    // the team.
    expect(readScimGroupResource({ displayName: 'Support' })).toMatchObject({
      group: { members: [] },
    });
  });

  it('de-duplicates and normalises ids, keeping the order sent', () => {
    expect(
      readScimGroupResource({
        displayName: 'Support',
        members: [{ value: GRACE }, { value: ADA.toUpperCase() }, { value: GRACE }],
      }),
    ).toMatchObject({ group: { members: [GRACE, ADA] } });
  });

  it('refuses a body that names no team', () => {
    for (const body of [{}, { displayName: '' }, { displayName: '  ' }, { displayName: 7 }, null]) {
      expect(readScimGroupResource(body), JSON.stringify(body)).toMatchObject({ ok: false });
    }
  });

  it("holds displayName to the console's bound", () => {
    expect(readScimGroupResource({ displayName: 'x'.repeat(120) })).toMatchObject({ ok: true });
    expect(readScimGroupResource({ displayName: 'x'.repeat(121) })).toMatchObject({
      ok: false,
      scimType: 'invalidValue',
    });
  });

  it('refuses a members entry that cannot be an id', () => {
    for (const members of [[{ value: 'nope' }], [{ display: 'Ada' }], [42], [null]]) {
      expect(
        readScimGroupResource({ displayName: 'Support', members }),
        JSON.stringify(members),
      ).toMatchObject({ ok: false, scimType: 'invalidValue' });
    }
  });

  it('bounds how many members one request may name', () => {
    const many = Array.from({ length: 201 }, () => ({ value: ADA }));
    expect(readScimGroupResource({ displayName: 'Support', members: many })).toMatchObject({
      ok: false,
      scimType: 'tooMany',
    });
  });
});

describe('reading a Group patch', () => {
  const ADA = '11111111-1111-4111-8111-111111111111';
  const GRACE = '22222222-2222-4222-8222-222222222222';
  const patch = (operations: unknown[]) => readScimGroupPatch({ Operations: operations });

  it('reads the add and remove a connector sends most', () => {
    expect(patch([{ op: 'add', path: 'members', value: [{ value: ADA }] }])).toEqual({
      ok: true,
      steps: [{ kind: 'addMembers', members: [ADA] }],
    });
    expect(patch([{ op: 'remove', path: 'members', value: [{ value: ADA }] }])).toEqual({
      ok: true,
      steps: [{ kind: 'removeMembers', members: [ADA] }],
    });
  });

  it("reads Entra's value path, where the member is named by the path alone", () => {
    // The parse that matters most: read as "nothing to do", this removal would
    // leave a former member holding sight of the team's conversations while the
    // directory recorded a success.
    expect(patch([{ op: 'remove', path: `members[value eq "${ADA}"]` }])).toEqual({
      ok: true,
      steps: [{ kind: 'removeMembers', members: [ADA] }],
    });
    // Whitespace and casing vary between connectors.
    expect(patch([{ op: 'Remove', path: `members[ value EQ "${ADA}" ]` }])).toMatchObject({
      steps: [{ kind: 'removeMembers', members: [ADA] }],
    });
  });

  it('separates "remove these members" from "remove every member"', () => {
    // One absent field apart, and confusing them empties a team.
    expect(patch([{ op: 'remove', path: 'members' }])).toEqual({
      ok: true,
      steps: [{ kind: 'setMembers', members: [] }],
    });
  });

  it('reads replace on a multi-valued attribute as the whole set', () => {
    expect(patch([{ op: 'replace', path: 'members', value: [{ value: GRACE }] }])).toEqual({
      ok: true,
      steps: [{ kind: 'setMembers', members: [GRACE] }],
    });
  });

  it('reads the path-less attribute map, and a differently-cased op', () => {
    expect(patch([{ op: 'Replace', value: { displayName: 'Support EU' } }])).toEqual({
      ok: true,
      steps: [{ kind: 'rename', displayName: 'Support EU' }],
    });
  });

  it('keeps the operations in order rather than merging them', () => {
    expect(
      patch([
        { op: 'replace', path: 'members', value: [{ value: ADA }] },
        { op: 'add', path: 'members', value: [{ value: GRACE }] },
      ]),
    ).toEqual({
      ok: true,
      steps: [
        { kind: 'setMembers', members: [ADA] },
        { kind: 'addMembers', members: [GRACE] },
      ],
    });
  });

  it('accepts attributes it does not own and applies none of them', () => {
    expect(
      patch([
        { op: 'replace', path: 'externalId', value: 'idp-1' },
        {
          op: 'replace',
          path: 'urn:ietf:params:scim:schemas:core:2.0:Group:displayName',
          value: 'A',
        },
      ]),
    ).toEqual({ ok: true, steps: [{ kind: 'rename', displayName: 'A' }] });
  });

  it('refuses what would leave a team nameless or a path meaningless', () => {
    expect(patch([{ op: 'remove', path: 'displayName' }])).toMatchObject({
      ok: false,
      scimType: 'invalidPath',
    });
    expect(patch([{ op: 'replace', path: 'displayName', value: '' }])).toMatchObject({
      ok: false,
      scimType: 'invalidValue',
    });
    expect(patch([{ op: 'add', path: `members[value eq "${ADA}"]` }])).toMatchObject({
      ok: false,
      scimType: 'invalidPath',
    });
    expect(patch([{ op: 'remove', path: 'members[value eq "nope"]' }])).toMatchObject({
      ok: false,
      scimType: 'invalidValue',
    });
    expect(patch([{ op: 'remove' }])).toMatchObject({ ok: false, scimType: 'noTarget' });
    expect(patch([{ op: 'destroy', path: 'members' }])).toMatchObject({
      ok: false,
      scimType: 'invalidSyntax',
    });
    expect(patch([])).toMatchObject({ ok: false, scimType: 'invalidValue' });
    expect(readScimGroupPatch({})).toMatchObject({ ok: false, scimType: 'invalidSyntax' });
  });

  it('bounds how much one request may ask for', () => {
    const many = Array.from({ length: 51 }, () => ({ op: 'remove', path: 'members' }));
    expect(patch(many)).toMatchObject({ ok: false, scimType: 'tooMany' });
  });
});

describe('coerceScimBoolean', () => {
  it('accepts booleans and their quoted spellings, and nothing else', () => {
    expect(coerceScimBoolean(true)).toBe(true);
    expect(coerceScimBoolean(false)).toBe(false);
    expect(coerceScimBoolean('True')).toBe(true);
    expect(coerceScimBoolean(' false ')).toBe(false);
    // Not truthiness: `1` and `"yes"` are ambiguous and are refused, so a
    // connector sending something we did not anticipate fails loudly.
    expect(coerceScimBoolean(1)).toBeUndefined();
    expect(coerceScimBoolean('yes')).toBeUndefined();
    expect(coerceScimBoolean(null)).toBeUndefined();
  });
});
