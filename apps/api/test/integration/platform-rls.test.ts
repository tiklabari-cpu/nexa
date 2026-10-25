/**
 * The platform role and its tables (tm 389.1 · docs/platform-admin/design.md
 * §B1, §B2) — the isolation the whole root panel rests on.
 *
 * Two walls, attacked from both sides through real role connections:
 *
 *   1. The tenant role (`siyahtus_app`, the request path of every workspace)
 *      cannot read or write a single platform row. A hole here hands any
 *      SQL-injection or RLS bug in the tenant API the operators' password
 *      hashes, sessions and the deployment's AI keys.
 *   2. The platform role (`siyahtus_platform`) reads every tenant without
 *      `set_config` — that is its job — but cannot rewrite the evidence: the
 *      tenant audit trail, issued invoices and members' second factor are
 *      UPDATE/DELETE-revoked, and its own trail refuses UPDATE and DELETE for
 *      every role, the owner included.
 *
 * What the tenant API may know of the platform goes through four SECURITY
 * DEFINER readers, and those are checked as the tenant role calls them.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerClient, platformClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

const PLATFORM_TABLES = [
  'platform_admins',
  'platform_admin_recovery_codes',
  'platform_admin_invites',
  'platform_sessions',
  'platform_audit_log',
  'platform_audit_chain_head',
  'platform_settings',
  'platform_notes',
  'platform_blocklist',
  'platform_impersonation_sessions',
  'platform_credits',
  'platform_alert_prefs',
] as const;

/** The tables whose rows are evidence: the platform may add to them, never rewrite. */
const EVIDENCE_TABLES = [
  'audit_log',
  'invoices',
  'invoice_line_items',
  'account_two_factor',
  'two_factor_recovery_codes',
] as const;

describe('platform role and tables (tm 389.1)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let platform: PrismaClient;
  let fx: Fixtures;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    platform = platformClient();
    fx = await seedFixtures(owner);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect(), platform.$disconnect()]);
  });

  describe('the test harness', () => {
    it('hands every run a platform URL on its own isolated database', () => {
      const configured = process.env['DATABASE_PLATFORM_URL'];
      expect(configured, 'with-test-datastores.ts must set DATABASE_PLATFORM_URL').toBeDefined();
      const platformUrl = new URL(configured!);
      const ownerUrl = new URL(process.env['DATABASE_URL']!);
      expect(platformUrl.username).toBe('siyahtus_platform');
      expect(platformUrl.pathname).toBe(ownerUrl.pathname);
    });

    it('connects as the platform role, not as the owner', async () => {
      const [row] = await platform.$queryRaw<Array<{ who: string }>>`SELECT current_user AS who`;
      expect(row!.who).toBe('siyahtus_platform');
    });
  });

  describe('the role', () => {
    it('is a BYPASSRLS login that is neither superuser nor able to create roles or databases', async () => {
      const [role] = await owner.$queryRaw<
        Array<{
          bypass: boolean;
          superuser: boolean;
          inherit: boolean;
          login: boolean;
          createRole: boolean;
          createDb: boolean;
        }>
      >`
        SELECT rolbypassrls AS bypass, rolsuper AS superuser, rolinherit AS inherit,
               rolcanlogin AS login, rolcreaterole AS "createRole", rolcreatedb AS "createDb"
        FROM pg_roles WHERE rolname = 'siyahtus_platform'`;
      expect(role).toEqual({
        bypass: true,
        superuser: false,
        inherit: false,
        login: true,
        createRole: false,
        createDb: false,
      });
    });

    it('owns no table — an owner would also skip the REVOKEs below', async () => {
      const owned = await owner.$queryRaw<Array<{ relname: string }>>`
        SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = 'siyahtus_platform'`;
      expect(owned).toEqual([]);
    });
  });

  describe('platform tables are invisible to the tenant role', () => {
    it('every platform table has row level security on and no policy at all', async () => {
      const tables = await owner.$queryRaw<Array<{ relname: string; rls: boolean }>>`
        SELECT relname, relrowsecurity AS rls FROM pg_class
        WHERE relkind = 'r' AND relname LIKE 'platform\\_%' ORDER BY relname`;
      expect(tables.map((t) => t.relname)).toEqual([...PLATFORM_TABLES].sort());
      expect(tables.every((t) => t.rls)).toBe(true);

      const policies = await owner.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_policies WHERE tablename LIKE 'platform\\_%'`;
      expect(policies).toEqual([]);
    });

    it('refuses siyahtus_app a SELECT on platform_admins: permission denied, not zero rows', async () => {
      await expect(app.$queryRawUnsafe('SELECT * FROM platform_admins')).rejects.toThrow(
        /permission denied for table platform_admins/,
      );
    });

    it.each(PLATFORM_TABLES)('refuses siyahtus_app any privilege on %s', async (table) => {
      const [grants] = await owner.$queryRawUnsafe<Array<{ any: boolean }>>(
        `SELECT has_table_privilege('siyahtus_app', '${table}',
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS any`,
      );
      expect(grants!.any).toBe(false);
      await expect(app.$queryRawUnsafe(`SELECT count(*) FROM ${table}`)).rejects.toThrow(
        /permission denied/,
      );
    });

    it('refuses siyahtus_app a write as well as a read', async () => {
      await expect(
        app.$executeRawUnsafe(
          `INSERT INTO platform_settings (key, value) VALUES ('signup_enabled', 'false')`,
        ),
      ).rejects.toThrow(/permission denied for table platform_settings/);
    });
  });

  describe('the platform role reads every tenant', () => {
    it('counts every licence without set_config — both tenants, not zero', async () => {
      const rows = await platform.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM licenses ORDER BY id`;
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(fx.a.licenseId);
      expect(ids).toContain(fx.b.licenseId);

      const [count] = await platform.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM licenses`;
      expect(count!.n).toBe(ids.length);
    });

    it('reads an RLS-scoped tenant table across tenants (memberships of both)', async () => {
      const rows = await platform.$queryRaw<Array<{ licenseId: bigint }>>`
        SELECT DISTINCT license_id AS "licenseId" FROM agent_memberships`;
      const licences = rows.map((r) => r.licenseId);
      expect(licences).toEqual(expect.arrayContaining([fx.a.licenseId, fx.b.licenseId]));

      // The contrast that makes the line above mean BYPASSRLS: the tenant role,
      // asking the same thing without a tenant, sees nothing.
      const [tenant] = await app.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM agent_memberships`;
      expect(tenant!.n).toBe(0);
    });
  });

  describe('the platform role cannot rewrite the evidence', () => {
    beforeAll(async () => {
      await owner.$executeRaw`
        INSERT INTO audit_log (id, license_id, action)
        VALUES (gen_random_uuid(), ${fx.a.licenseId}, 'test.seeded')`;
    });

    it('refuses UPDATE on audit_log: permission denied', async () => {
      await expect(
        platform.$executeRawUnsafe(`UPDATE audit_log SET action = 'tampered'`),
      ).rejects.toThrow(/permission denied for table audit_log/);
    });

    it('refuses DELETE on audit_log, and the row is still there', async () => {
      await expect(platform.$executeRawUnsafe('DELETE FROM audit_log')).rejects.toThrow(
        /permission denied for table audit_log/,
      );
      const [count] = await owner.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM audit_log WHERE action = 'test.seeded'`;
      expect(count!.n).toBe(1);
    });

    it.each(EVIDENCE_TABLES)(
      'holds SELECT and INSERT but not UPDATE or DELETE on %s',
      async (table) => {
        const [grants] = await owner.$queryRawUnsafe<
          Array<{ read: boolean; add: boolean; change: boolean; remove: boolean }>
        >(
          `SELECT has_table_privilege('siyahtus_platform', '${table}', 'SELECT') AS read,
                has_table_privilege('siyahtus_platform', '${table}', 'INSERT') AS add,
                has_table_privilege('siyahtus_platform', '${table}', 'UPDATE') AS change,
                has_table_privilege('siyahtus_platform', '${table}', 'DELETE') AS remove`,
        );
        expect(grants).toEqual({ read: true, add: true, change: false, remove: false });
      },
    );

    it('may still write an ordinary tenant table (the panel acts on workspaces)', async () => {
      const [grants] = await owner.$queryRaw<Array<{ change: boolean }>>`
        SELECT has_table_privilege('siyahtus_platform', 'licenses', 'UPDATE') AS change`;
      expect(grants!.change).toBe(true);
    });
  });

  describe('platform_audit_log is append-only', () => {
    beforeAll(async () => {
      await platform.$executeRaw`
        INSERT INTO platform_audit_log (chain_seq, action, target_type, reason, hash)
        VALUES (1, 'workspace.suspended', 'license', 'abuse report', 'h1')`;
    });

    it('accepts an INSERT from the platform role', async () => {
      const [count] = await platform.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM platform_audit_log`;
      expect(count!.n).toBe(1);
    });

    it('refuses UPDATE by trigger, for the platform role and for the owner', async () => {
      await expect(
        platform.$executeRawUnsafe(`UPDATE platform_audit_log SET reason = 'nothing happened'`),
      ).rejects.toThrow(/platform_audit_log is append-only: UPDATE refused/);
      await expect(
        owner.$executeRawUnsafe(`UPDATE platform_audit_log SET reason = 'nothing happened'`),
      ).rejects.toThrow(/platform_audit_log is append-only: UPDATE refused/);
    });

    it('refuses DELETE by trigger, even one that matches no row', async () => {
      await expect(platform.$executeRawUnsafe('DELETE FROM platform_audit_log')).rejects.toThrow(
        /platform_audit_log is append-only: DELETE refused/,
      );
      await expect(
        owner.$executeRawUnsafe('DELETE FROM platform_audit_log WHERE chain_seq = -1'),
      ).rejects.toThrow(/append-only: DELETE refused/);
      const [row] = await owner.$queryRaw<Array<{ reason: string }>>`
        SELECT reason FROM platform_audit_log WHERE chain_seq = 1`;
      expect(row!.reason).toBe('abuse report');
    });

    it('refuses a free-text action: the column holds dotted verbs', async () => {
      await expect(
        platform.$executeRawUnsafe(
          `INSERT INTO platform_audit_log (chain_seq, action, target_type, hash)
           VALUES (2, 'Suspended the workspace', 'license', 'h2')`,
        ),
      ).rejects.toThrow(/platform_audit_log_action_check/);
    });
  });

  describe('platform_settings', () => {
    it('refuses a key outside the dictionary', async () => {
      await expect(
        platform.$executeRawUnsafe(
          `INSERT INTO platform_settings (key, value) VALUES ('signup.enabled', 'true')`,
        ),
      ).rejects.toThrow(/platform_settings_key_check/);
    });

    it.each([
      ['signup_enabled', `'"yes"'`],
      ['trial_days', `'14.5'`],
      ['trial_days', `'-1'`],
      ['trial_days', `'"14"'`],
      ['maintenance', `'true'`],
    ])('refuses %s = %s (wrong shape for the key)', async (key, value) => {
      await expect(
        platform.$executeRawUnsafe(
          `INSERT INTO platform_settings (key, value) VALUES ('${key}', ${value}::jsonb)`,
        ),
      ).rejects.toThrow(/platform_settings_value_check/);
    });
  });

  describe('what the tenant role may read: the platform_* readers', () => {
    it('platform_public_settings() answers the tenant role with one row of NULLs while nothing is set', async () => {
      const rows = await app.$queryRaw<
        Array<{
          signup_enabled: boolean | null;
          trial_days: number | null;
          announcement: unknown;
          maintenance: unknown;
        }>
      >`SELECT * FROM platform_public_settings()`;
      expect(rows).toEqual([
        { signup_enabled: null, trial_days: null, announcement: null, maintenance: null },
      ]);
    });

    it('platform_public_settings() returns what the platform set — and only the public keys', async () => {
      await platform.$executeRawUnsafe(`
        INSERT INTO platform_settings (key, value) VALUES
          ('signup_enabled', 'false'),
          ('trial_days', '21'),
          ('maintenance', '{"enabled": true, "mode": "read_only", "message": "upgrade"}'),
          ('ai.llm', '{"provider": "openai", "api_key_ciphertext": "v1:abc", "api_key_last4": "wxyz"}')`);
      try {
        const [row] = await app.$queryRaw<Array<Record<string, unknown>>>`
          SELECT * FROM platform_public_settings()`;
        expect(row).toEqual({
          signup_enabled: false,
          trial_days: 21,
          announcement: null,
          maintenance: { enabled: true, mode: 'read_only', message: 'upgrade' },
        });

        // The AI reader hands the key over encrypted, as stored.
        const [ai] = await app.$queryRaw<Array<{ llm: Record<string, unknown> | null }>>`
          SELECT llm FROM platform_ai_settings()`;
        expect(ai!.llm).toEqual({
          provider: 'openai',
          api_key_ciphertext: 'v1:abc',
          api_key_last4: 'wxyz',
        });
      } finally {
        await owner.$executeRawUnsafe('DELETE FROM platform_settings');
      }
    });

    it('platform_ai_settings() and platform_billing_settings() answer one row of NULLs by default', async () => {
      const ai = await app.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM platform_ai_settings()`;
      expect(ai).toEqual([
        { llm: null, embedding: null, caps: null, prices: null, crisis_text_drafts: null },
      ]);
      const billing = await app.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM platform_billing_settings()`;
      expect(billing).toEqual([
        { providers: null, swift_bank_details: null, issuer_profile: null },
      ]);
    });

    it('platform_signup_blocked() matches an address, a domain with its subdomains, and a CIDR', async () => {
      await platform.$executeRawUnsafe(`
        INSERT INTO platform_blocklist (id, kind, value) VALUES
          (gen_random_uuid(), 'email', 'spam@example.com'),
          (gen_random_uuid(), 'domain', 'bad.test'),
          (gen_random_uuid(), 'ip', '203.0.113.0/24')`);
      try {
        const check = async (email: string | null, ip: string | null) => {
          const [row] = await app.$queryRaw<
            Array<{ blocked: boolean; matched_kind: string | null }>
          >`
            SELECT * FROM platform_signup_blocked(${email}::text, ${ip}::text)`;
          return row;
        };
        expect(await check('Spam@Example.com', null)).toEqual({
          blocked: true,
          matched_kind: 'email',
        });
        expect(await check('a@bad.test', null)).toEqual({ blocked: true, matched_kind: 'domain' });
        expect(await check('a@mail.bad.test', null)).toEqual({
          blocked: true,
          matched_kind: 'domain',
        });
        // A suffix that is not a label boundary is a different domain.
        expect(await check('a@notbad.test', null)).toEqual({ blocked: false, matched_kind: null });
        expect(await check('ok@example.com', '203.0.113.77')).toEqual({
          blocked: true,
          matched_kind: 'ip',
        });
        expect(await check('ok@example.com', '198.51.100.1')).toEqual({
          blocked: false,
          matched_kind: null,
        });
        // Garbage in the IP matches nothing rather than raising.
        expect(await check('ok@example.com', 'not-an-ip')).toEqual({
          blocked: false,
          matched_kind: null,
        });
      } finally {
        await owner.$executeRawUnsafe('DELETE FROM platform_blocklist');
      }
    });

    it('refuses a blocklist value that is not normalised or not an address', async () => {
      for (const [kind, value] of [
        ['email', 'Spam@Example.com'],
        ['domain', 'not a domain'],
        ['ip', '999.1.1.1'],
      ] as const) {
        await expect(
          platform.$executeRawUnsafe(
            `INSERT INTO platform_blocklist (id, kind, value) VALUES (gen_random_uuid(), '${kind}', '${value}')`,
          ),
        ).rejects.toThrow(/platform_blocklist_value_check/);
      }
    });

    it('the readers are executable by the tenant role, and by nobody through PUBLIC', async () => {
      const rows = await owner.$queryRaw<Array<{ fn: string; app: boolean; public: boolean }>>`
        SELECT p.proname AS fn,
               has_function_privilege('siyahtus_app', p.oid, 'EXECUTE') AS app,
               coalesce(array_to_string(p.proacl, ',') ~ '(^|,)=X', true) AS public
        FROM pg_proc p
        WHERE p.proname IN ('platform_public_settings', 'platform_signup_blocked',
                            'platform_ai_settings', 'platform_billing_settings')
        ORDER BY p.proname`;
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.app, row.fn).toBe(true);
        expect(row.public, row.fn).toBe(false);
      }
    });
  });
});
