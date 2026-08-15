/**
 * The access review's CSV shape (C6-e).
 *
 * Pure: these functions turn an already-built report into a table, so they are
 * tested without a database. What the *queries* produce — statuses, last
 * sign-ins, which credentials survive the live filter, cross-tenant isolation —
 * is `test/integration/access-review.test.ts`'s job, against real Postgres and
 * real RLS.
 *
 * What is pinned here is what a consumer of the export can rely on without
 * reading a single value: the header, the row width, that a spreadsheet cannot
 * be made to execute an agent's name, and that no column carries anything
 * resembling a credential.
 */
import { describe, expect, it } from 'vitest';
import { toCsv } from '../../routes/reports-export.js';
import {
  accessReviewCredentialTable,
  accessReviewFilename,
  accessReviewMemberTable,
  type AccessReviewReport,
} from './access-review.js';

const GENERATED_AT = new Date('2026-08-15T09:30:00.000Z');

function report(overrides: Partial<AccessReviewReport> = {}): AccessReviewReport {
  return {
    generated_at: GENERATED_AT.toISOString(),
    audit_trail_starts_at: '2026-07-16T00:00:00.000Z',
    members: [],
    credentials: [],
    ...overrides,
  };
}

const MEMBER = {
  account_id: '11111111-1111-4111-8111-111111111111',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  role: 'admin',
  status: 'active' as const,
  suspended: false,
  awaiting_approval: false,
  two_factor_enabled: true,
  provisioned_via: 'scim' as const,
  member_since: '2026-01-02T00:00:00.000Z',
  last_login_at: '2026-08-14T08:00:00.000Z',
  last_login_method: 'sso' as const,
};

const CREDENTIAL = {
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'pat',
  name: 'deploy bot',
  scopes: ['chats--all:ro', 'reports_read'],
  owner_id: MEMBER.account_id,
  owner_name: MEMBER.name,
  owner_email: MEMBER.email,
  owner_is_member: true,
  created_at: '2026-03-01T00:00:00.000Z',
  last_used_at: '2026-08-13T12:00:00.000Z',
  expires_at: null,
};

describe('access review CSV tables (C6-e)', () => {
  it('gives the member table a fixed header, and every row that width', () => {
    const table = accessReviewMemberTable(
      report({ members: [MEMBER, { ...MEMBER, last_login_at: null, last_login_method: null }] }),
    );

    expect(table.headers).toEqual([
      'account_id',
      'name',
      'email',
      'role',
      'status',
      'two_factor_enabled',
      'provisioned_via',
      'member_since',
      'last_login_at',
      'last_login_method',
    ]);
    for (const row of table.rows) expect(row).toHaveLength(table.headers.length);
  });

  it('writes booleans as true/false, not 1/0', () => {
    // A bare `1` under `two_factor_enabled` reads as a count to a human with a
    // spreadsheet open, which is the only audience this format has.
    const table = accessReviewMemberTable(
      report({ members: [MEMBER, { ...MEMBER, two_factor_enabled: false }] }),
    );

    expect(table.rows[0]?.[5]).toBe('true');
    expect(table.rows[1]?.[5]).toBe('false');
  });

  it('renders a member with no recorded sign-in as empty cells, not as text', () => {
    // "never" or "-" would be a value a script has to know to special-case, and
    // an auditor could read either as a claim. An empty cell is the absence it is.
    const table = accessReviewMemberTable(
      report({ members: [{ ...MEMBER, last_login_at: null, last_login_method: null }] }),
    );

    expect(toCsv(table.headers, table.rows).split('\r\n')[1]?.endsWith(',,')).toBe(true);
  });

  it('gives the credential table a fixed header, and every row that width', () => {
    const table = accessReviewCredentialTable(report({ credentials: [CREDENTIAL] }));

    expect(table.headers).toEqual([
      'credential_id',
      'kind',
      'name',
      'owner_id',
      'owner_email',
      'owner_is_member',
      'scopes',
      'created_at',
      'last_used_at',
      'expires_at',
    ]);
    for (const row of table.rows) expect(row).toHaveLength(table.headers.length);
  });

  it('joins scopes with spaces so the cell never needs quoting', () => {
    const table = accessReviewCredentialTable(report({ credentials: [CREDENTIAL] }));
    const csv = toCsv(table.headers, table.rows);

    expect(table.rows[0]?.[6]).toBe('chats--all:ro reports_read');
    // Reversible, and — the point of the choice — unquoted, so the column count
    // of a row is the column count of the header for a naive `split(',')` too.
    expect(csv).toContain(',chats--all:ro reports_read,');
  });

  it('carries no token value, digest or hash in any column', () => {
    // The inventory names credentials. Anything presentable, or anything an
    // offline attacker could grind against, must not be in the row — so the
    // guard is on the whole serialised table, not on a field list that a later
    // column could quietly step around.
    const table = accessReviewCredentialTable(report({ credentials: [CREDENTIAL] }));

    expect(table.headers.join(' ')).not.toMatch(/token|hash|secret|digest/i);
    expect(toCsv(table.headers, table.rows)).not.toMatch(/hash|secret/i);
  });

  it('neutralises a name that a spreadsheet would execute', () => {
    // An agent display name is user-controlled and lands in a cell. `toCsv`'s
    // formula guard is what stops that being a shell on someone's laptop; this
    // asserts the access review actually goes through it.
    const table = accessReviewMemberTable(
      report({ members: [{ ...MEMBER, name: '=cmd|" /c calc"!A1' }] }),
    );

    expect(toCsv(table.headers, table.rows)).toContain(`"'=cmd|"" /c calc""!A1"`);
  });

  it('names the download for the day of the snapshot, per section', () => {
    // No reporting window to name — unlike every other export, this one is a
    // snapshot of now — so the day is what keeps two reviews from colliding in
    // a downloads folder.
    expect(accessReviewFilename('members', GENERATED_AT)).toBe(
      'nexa-access-review-members-2026-08-15.csv',
    );
    expect(accessReviewFilename('credentials', GENERATED_AT)).toBe(
      'nexa-access-review-credentials-2026-08-15.csv',
    );
  });

  it('renders an empty workspace as a header row and nothing else', () => {
    // A review that found nothing is still evidence; an empty file would not
    // tell the reader the export ran.
    const table = accessReviewMemberTable(report());

    expect(table.rows).toEqual([]);
    expect(toCsv(table.headers, table.rows).split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});
