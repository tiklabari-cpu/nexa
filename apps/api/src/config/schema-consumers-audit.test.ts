/**
 * Pins `scripts/audit/schema-consumers.cjs` — the §F.1/4 report that answers
 * "which Prisma model has nothing in the product reaching it" (tm 234).
 *
 * Why here: same reason as `req-coverage-audit.test.ts` beside it — the script
 * is a repo-root tool with no owning package, and `src/config` is inside the
 * `test:unit` shard CONVENTIONS §1.3 runs.
 *
 * The defect tm 234 fixed was a report wrong in the same way every round:
 * `password_reset_tokens`, `account_two_factor` and `two_factor_recovery_codes`
 * came out as having no consumer, because the api only reaches them through
 * SECURITY DEFINER functions that live in migrations. GL-11 and GL-13 each ruled
 * the three out by hand. Both directions are pinned here, because the cheap way
 * to silence a false positive is to create a false negative: `Workflow`
 * (ADR-14) is the one genuine finding and has to stay one.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/audit/schema-consumers.cjs');

interface Model {
  name: string;
  table: string;
}
interface Reaching {
  name: string;
  securityDefiner: boolean;
  migration: string;
  callers: string[];
}
interface Input {
  schema: string;
  migrations: { name: string; sql: string }[];
  sources: { file: string; text: string }[];
}
interface Analysis {
  models: Model[];
  clientCalls: string[];
  rawOnly: Model[];
  viaFunction: (Model & { functions: Reaching[] })[];
  orphans: Model[];
}
interface Module {
  analyse: (input: Input) => Analysis;
  splitStatements: (sql: string) => string[];
  currentFunctions: (
    migrations: Input['migrations'],
  ) => Map<string, { body: string; securityDefiner: boolean }>;
  readRepo: () => Input;
}

// CommonJS, and it reads paths relative to the repo root.
const load = (): Module => createRequire(import.meta.url)(SCRIPT) as Module;
const withRepoRoot = <T>(run: () => T): T => {
  const previous = process.cwd();
  process.chdir(REPO_ROOT);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
};

const SCHEMA = `
model Secret {
  id String @id
  @@map("secrets")
}

model SecretAudit {
  id String @id
  @@map("secrets_audit")
}
`;

const definer = (name: string, body: string): string => `
CREATE OR REPLACE FUNCTION ${name}(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  ${body};
  RETURN FOUND;
END;
$$;
`;

const caller = (fn: string) => ({
  file: 'apps/api/src/services/secret-service.ts',
  text: `await tx.$queryRaw\`SELECT ${fn}(\${id}::uuid) AS ok\`;`,
});

describe('schema consumers report (§F.1/4)', () => {
  it('takes the three SECURITY DEFINER tables out of NO CONSUMER FOUND, and keeps Workflow in it', () => {
    const audit = load();
    const analysis = withRepoRoot(() => audit.analyse(audit.readRepo()));
    const orphans = analysis.orphans.map((o) => o.name);
    const via = new Map(analysis.viaFunction.map((v) => [v.name, v]));

    for (const name of ['PasswordResetToken', 'AccountTwoFactor', 'TwoFactorRecoveryCode']) {
      expect(orphans, name).not.toContain(name);
      const entry = via.get(name);
      expect(entry, name).toBeDefined();
      // Each is reached by a SECURITY DEFINER function the api really calls.
      expect(
        entry!.functions.some((f) => f.securityDefiner && f.callers.length > 0),
        name,
      ).toBe(true);
    }
    expect(via.get('PasswordResetToken')!.functions.map((f) => f.name)).toContain(
      'auth_consume_password_reset',
    );
    // The regression sentinel: no function reaches `workflows`, nothing calls
    // one, and the report must go on saying so (ADR-14).
    expect(orphans).toContain('Workflow');
  });

  it('counts a table reached only through a function the api calls', () => {
    const { analyse } = load();
    const analysis = analyse({
      schema: SCHEMA,
      migrations: [{ name: '1_init', sql: definer('secret_touch', 'UPDATE secrets SET id = id') }],
      sources: [caller('secret_touch')],
    });

    expect(analysis.viaFunction.map((v) => v.name)).toEqual(['Secret']);
    expect(analysis.viaFunction[0]!.functions).toEqual([
      {
        name: 'secret_touch',
        securityDefiner: true,
        migration: '1_init',
        callers: ['apps/api/src/services/secret-service.ts'],
      },
    ]);
    // `secrets_audit` shares a prefix with `secrets` — a substring match would
    // have rescued it too. It has no consumer.
    expect(analysis.orphans.map((o) => o.name)).toEqual(['SecretAudit']);
  });

  it('does not rescue a table whose function nobody calls — the false negative to avoid', () => {
    const { analyse } = load();
    const analysis = analyse({
      schema: SCHEMA,
      migrations: [{ name: '1_init', sql: definer('secret_touch', 'UPDATE secrets SET id = id') }],
      sources: [{ file: 'apps/api/src/other.ts', text: '// secret_touch is documented here' }],
    });

    expect(analysis.viaFunction).toEqual([]);
    expect(analysis.orphans.map((o) => o.name)).toEqual(['Secret', 'SecretAudit']);
  });

  it('reads the definition that exists after every migration, not the first one', () => {
    const { analyse } = load();
    const input = (sql2: string): Input => ({
      schema: SCHEMA,
      migrations: [
        { name: '1_init', sql: definer('secret_touch', 'UPDATE secrets SET id = id') },
        { name: '2_later', sql: sql2 },
      ],
      sources: [caller('secret_touch')],
    });

    // Replaced by a body that no longer names the table.
    const replaced = analyse(input(definer('secret_touch', 'PERFORM 1')));
    expect(replaced.orphans.map((o) => o.name)).toContain('Secret');

    // Dropped outright.
    const dropped = analyse(input('DROP FUNCTION IF EXISTS secret_touch(UUID);'));
    expect(dropped.orphans.map((o) => o.name)).toContain('Secret');
  });

  it('does not count a table named only in a SQL comment', () => {
    const { analyse } = load();
    const analysis = analyse({
      schema: SCHEMA,
      migrations: [
        {
          name: '1_init',
          sql: definer('secret_touch', '-- mirrors what secrets used to do\n  PERFORM 1'),
        },
      ],
      sources: [caller('secret_touch')],
    });

    expect(analysis.orphans.map((o) => o.name)).toContain('Secret');
  });

  it('splits statements on the semicolons outside a $tag$ body and a string literal', () => {
    const { splitStatements, currentFunctions } = load();
    const sql = `
-- a comment with a ; and a $$ in it
CREATE FUNCTION a() RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM 'x;y';
  PERFORM 1;
END;
$fn$;
COMMENT ON TABLE secrets IS 'it''s; fine';
CREATE FUNCTION b() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1; $$;
`;

    const statements = splitStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^CREATE FUNCTION a\(\)/);
    expect(statements[2]).toMatch(/^CREATE FUNCTION b\(\)/);

    const fns = currentFunctions([{ name: '1', sql }]);
    expect([...fns.keys()]).toEqual(['a', 'b']);
    expect(fns.get('a')!.securityDefiner).toBe(false);
    expect(fns.get('b')!.securityDefiner).toBe(true);
  });
});
