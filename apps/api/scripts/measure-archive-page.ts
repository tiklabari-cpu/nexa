/**
 * Measures the archive's first page (AR-01 · tm 335.1) at a million connections.
 *
 *     pnpm --filter @siyahtus/api measure:archive-page [connections]
 *
 * AR-01's acceptance: "1 milyon konuşmalı test verisinde ilk sayfa p95 < 800 ms".
 * This builds that workspace in a scratch database — a million closed
 * connections over a year, on 700 000 days of 300 000 players, two messages
 * each, a rating on every tenth, a tag on every fifth, a risk flag on every
 * hundredth, the days spread over five teams — and times
 * `ArchiveService.list` itself, not a copy of its SQL, as `siyahtus_app` inside
 * a read-only tenant transaction (row level security on, as in production):
 *
 *   - the Founder's first page (everything visible);
 *   - a Team Member's first page (one team of five, the EXISTS on
 *     `chat_access` doing the work);
 *   - a page deep in the list (the cursor doing the work);
 *   - one player's connections (`customer_id`);
 *   - AR-02's filters (tm 336.1): yesterday on the workspace's calendar, the
 *     last 30 days of one team (the most common pair), a Team Member's last
 *     week, and an agent, a tag exclusion, a rating, "AI solved" and a rare
 *     risk flag over the same month.
 *
 * Each is run `REPEATS` times after a warm-up; p50 and p95 are reported, and
 * the first page's plan is printed (EXPLAIN ANALYZE, BUFFERS) as the evidence
 * of which index served it.
 *
 * Nothing here touches the development database: a scratch `siyahtus_test_`
 * one is created, migrated, measured and dropped — the prefix the test harness
 * sweeps, so a window that dies mid-run leaves no orphan.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { capabilitiesForRole, localDayKey, shiftDayKey } from '@siyahtus/types';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { withTenantRead, type TenantContext } from '../src/lib/tenant.js';
import { ArchiveService } from '../src/services/archive/archive-service.js';
import type { AgentPrincipal } from '../src/services/auth/principal.js';
import {
  adminUrl,
  assertDroppableDatabaseName,
  isolatedDatabaseName,
  withDatabaseName,
} from './test-datastores.js';

loadEnvFile();

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

const REPEATS = 20;
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000a0001';
const FOUNDER_ID = '00000000-0000-4000-8000-0000000a0002';
const MEMBER_ID = '00000000-0000-4000-8000-0000000a0003';

const RETENTION = {
  RETENTION_THREAD_DAYS: 365,
  RETENTION_VISIT_DAYS: 90,
  RETENTION_MAIL_DAYS: 30,
  RETENTION_AUDIT_DAYS: 30,
};

function migrate(databaseUrl: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: '1' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

function principal(
  accountId: string,
  licenseId: bigint,
  role: 'owner' | 'agent',
  scopes: string[],
): AgentPrincipal {
  return {
    kind: 'agent',
    accountId,
    licenseId,
    organizationId: ORGANIZATION_ID,
    role,
    capabilities: capabilitiesForRole(role, []),
    scopes,
    tokenId: 'measure',
    tokenKind: 'pat',
  };
}

async function seed(
  owner: PrismaClient,
  connections: number,
): Promise<{ licenseId: bigint; customerId: string; memberGroup: bigint; tagId: string }> {
  const days = Math.round(connections * 0.7);
  const players = Math.round(connections * 0.3);
  await owner.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORGANIZATION_ID}::uuid, 'Archive measurement')`;
  const licence = await owner.license.create({
    data: { organizationId: ORGANIZATION_ID },
    select: { id: true },
  });
  const licenseId = licence.id;
  for (const [id, name] of [
    [FOUNDER_ID, 'Founder'],
    [MEMBER_ID, 'Member'],
  ] as const) {
    await owner.account.create({ data: { id, email: `${name.toLowerCase()}@measure.test`, name } });
  }
  const groups: bigint[] = [];
  for (let i = 0; i < 5; i += 1) {
    groups.push(
      (await owner.group.create({ data: { licenseId, name: `Team ${i}` }, select: { id: true } }))
        .id,
    );
  }
  await owner.groupAgent.create({ data: { licenseId, groupId: groups[0]!, agentId: MEMBER_ID } });
  const groupArray = `{${groups.join(',')}}`;

  // A year of partitions behind today.
  for (let month = 0; month <= 13; month += 1) {
    await owner.$executeRaw`SELECT events_ensure_partition(now() - make_interval(months => ${month}::int))`;
  }

  const started = Date.now();
  await owner.$executeRaw`
    INSERT INTO customers (id, organization_id, name, username)
    SELECT md5('player' || g)::uuid, ${ORGANIZATION_ID}::uuid, 'Player ' || g, 'player_' || g
    FROM generate_series(0, ${players - 1}::int) g`;
  await owner.$executeRaw`
    INSERT INTO chats (id, license_id, customer_id, active, created_at, last_event_at)
    SELECT 'H' || lpad(g::text, 9, '0'), ${licenseId}, md5('player' || (g % ${players}::int))::uuid, false,
           now() - make_interval(secs => g * 45.0), now() - make_interval(secs => g * 45.0)
    FROM generate_series(0, ${days - 1}::int) g`;
  await owner.$executeRaw`
    INSERT INTO chat_access (chat_id, group_id)
    SELECT 'H' || lpad(g::text, 9, '0'), (${groupArray}::bigint[])[1 + g % 5]
    FROM generate_series(0, ${days - 1}::int) g`;
  // Connection g sits on day (g * 7) % days; it started 30 s × g ago, lasted ten minutes.
  // Every other one records its team (ID-02); the rest fall back to the day's
  // `chat_access`, as connections opened before ID-02 do. A connection the AI
  // answered has no agent; the others list their assignee.
  await owner.$executeRaw`
    INSERT INTO threads (id, chat_id, license_id, active, created_at, closed_at, assignee_id, handled_by,
                         group_id, agent_ids)
    SELECT 'T' || lpad(g::text, 9, '0'), 'H' || lpad(((g::bigint * 7) % ${days}::int)::text, 9, '0'),
           ${licenseId}, false,
           now() - make_interval(secs => g * 30.0),
           now() - make_interval(secs => g * 30.0) + interval '10 minutes',
           CASE WHEN g % 2 = 0 THEN ${MEMBER_ID}::uuid ELSE ${FOUNDER_ID}::uuid END,
           (ARRAY['ai', 'human', 'mixed'])[1 + g % 3],
           CASE WHEN g % 2 = 0
                THEN (${groupArray}::bigint[])[1 + ((g::bigint * 7) % ${days}::int) % 5] END,
           CASE WHEN g % 3 = 0 THEN '{}'::uuid[]
                WHEN g % 2 = 0 THEN ARRAY[${MEMBER_ID}::uuid] ELSE ARRAY[${FOUNDER_ID}::uuid] END
    FROM generate_series(0, ${connections - 1}::int) g`;
  await owner.$executeRaw`
    INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, recipients, created_at)
    SELECT t.id || '_' || n, t.id, t.chat_id, ${licenseId}, 'message',
           CASE WHEN n = 1 THEN 'Çekim talebim ne zaman onaylanır? ' || t.id ELSE 'Kontrol ediyorum.' END,
           CASE WHEN n = 1 THEN 'customer' ELSE 'agent' END, 'all',
           t.created_at + make_interval(mins => n)
    FROM threads t CROSS JOIN generate_series(1, 2) n
    WHERE t.license_id = ${licenseId}`;
  await owner.$executeRaw`
    INSERT INTO ratings (id, chat_id, license_id, thread_id, value, comment, created_at)
    SELECT gen_random_uuid(), t.chat_id, ${licenseId}, t.id, CASE WHEN g % 20 = 0 THEN 'bad' ELSE 'good' END,
           CASE WHEN g % 20 = 0 THEN 'Geç cevap' END, t.closed_at + interval '1 minute'
    FROM generate_series(0, ${connections - 1}::int, 10) g
    JOIN threads t ON t.id = 'T' || lpad(g::text, 9, '0')`;
  const tag = await owner.tag.create({ data: { licenseId, name: 'bonus' }, select: { id: true } });
  await owner.$executeRaw`
    INSERT INTO thread_tags (thread_id, tag_id)
    SELECT 'T' || lpad(g::text, 9, '0'), ${tag.id}::uuid
    FROM generate_series(0, ${connections - 1}::int, 5) g`;
  await owner.$executeRaw`
    INSERT INTO risk_flags (id, license_id, scope, chat_id, thread_id, type, severity, source, raised_by)
    SELECT gen_random_uuid(), ${licenseId}, 'chat', t.chat_id, t.id, 'fraud_suspected', 'high', 'agent', ${FOUNDER_ID}::uuid
    FROM generate_series(0, ${connections - 1}::int, 100) g
    JOIN threads t ON t.id = 'T' || lpad(g::text, 9, '0')`;
  await owner.$executeRawUnsafe('ANALYZE');
  console.log(
    `seeded ${connections} connections in ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
  return {
    licenseId,
    memberGroup: groups[0]!,
    tagId: tag.id,
    customerId: (
      await owner.$queryRaw<Array<{ id: string }>>`SELECT md5('player0')::uuid::text AS id`
    )[0]!.id,
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

async function time(label: string, run: () => Promise<unknown>): Promise<void> {
  await run();
  const samples: number[] = [];
  for (let i = 0; i < REPEATS; i += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(34)} p50 ${percentile(samples, 50).toFixed(1).padStart(7)} ms · p95 ${percentile(samples, 95).toFixed(1).padStart(7)} ms · max ${samples.at(-1)!.toFixed(1).padStart(7)} ms`,
  );
}

async function main(): Promise<number> {
  const connections = Number(process.argv[2] ?? '1000000');
  if (!Number.isInteger(connections) || connections < 1000) {
    console.error('usage: measure-archive-page.ts [connections >= 1000]');
    return 2;
  }
  const ownerUrl = process.env['DATABASE_URL'];
  const appUrl = process.env['DATABASE_APP_URL'];
  if (!ownerUrl || !appUrl) throw new Error('DATABASE_URL and DATABASE_APP_URL must be set');

  const databaseName = isolatedDatabaseName();
  assertDroppableDatabaseName(databaseName);
  const admin = new PrismaClient({ datasourceUrl: adminUrl(ownerUrl) });
  const scratchOwnerUrl = withDatabaseName(ownerUrl, databaseName);
  console.log(`scratch database: ${databaseName} · ${connections} connections`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  const owner = new PrismaClient({ datasourceUrl: scratchOwnerUrl });
  const app = new PrismaClient({ datasourceUrl: withDatabaseName(appUrl, databaseName) });
  try {
    const migrated = await migrate(scratchOwnerUrl);
    if (migrated !== 0) throw new Error(`migrate deploy failed with exit ${migrated}`);
    const { licenseId, customerId, memberGroup, tagId } = await seed(owner, connections);
    const tenant: TenantContext = { licenseId, organizationId: ORGANIZATION_ID };
    const archive = new ArchiveService(RETENTION);
    const founder = principal(FOUNDER_ID, licenseId, 'owner', ['chats--all:ro']);
    const member = principal(MEMBER_ID, licenseId, 'agent', ['chats--access:ro']);
    const listAs = (who: AgentPrincipal, input: Parameters<ArchiveService['list']>[3]) =>
      withTenantRead(app, tenant, (tx) => archive.list(tx, tenant, who, input));

    const first = await listAs(founder, { status: 'closed', limit: 50 });
    console.log(
      `first page: ${first.items.length} rows · total ${first.total}${first.total_capped ? '+' : ''}`,
    );
    let deep: string | undefined = first.next_page_id;
    for (let i = 0; i < 200 && deep; i += 1) {
      deep = (await listAs(founder, { status: 'closed', limit: 50, pageId: deep })).next_page_id;
    }

    console.log(`\n=== ArchiveService.list as siyahtus_app, ${REPEATS} runs after a warm-up ===`);
    await time('Founder · first page (50)', () => listAs(founder, { status: 'closed', limit: 50 }));
    await time('Team Member · first page (50)', () =>
      listAs(member, { status: 'closed', limit: 50 }),
    );
    await time('Founder · page 201 (cursor)', () =>
      listAs(founder, { status: 'closed', limit: 50, ...(deep ? { pageId: deep } : {}) }),
    );
    await time('Founder · status=all', () => listAs(founder, { status: 'all', limit: 50 }));
    await time('Founder · one player', () =>
      listAs(founder, { status: 'closed', limit: 50, customerId }),
    );

    // AR-02 (tm 336.1). Days on the default workspace calendar (Istanbul).
    const today = localDayKey(new Date());
    const yesterday = shiftDayKey(today, -1);
    const month = { status: 'closed' as const, limit: 50 };
    const lastDays = (n: number) => ({ dateFrom: shiftDayKey(today, -n), dateTo: today });
    await time('Founder · yesterday', () =>
      listAs(founder, { ...month, filters: { dateFrom: yesterday, dateTo: yesterday } }),
    );
    await time('Founder · 30 days + one team', () =>
      listAs(founder, { ...month, filters: { ...lastDays(30), groupIds: [memberGroup] } }),
    );
    await time('Team Member · last 7 days', () =>
      listAs(member, { ...month, filters: lastDays(7) }),
    );
    await time('Founder · 30 days + agent', () =>
      listAs(founder, { ...month, filters: { ...lastDays(30), agentIds: [MEMBER_ID] } }),
    );
    await time('Founder · 30 days, not tagged bonus', () =>
      listAs(founder, {
        ...month,
        filters: { ...lastDays(30), tags: [tagId], tagMode: 'exclude' },
      }),
    );
    await time('Founder · 30 days + bad rating', () =>
      listAs(founder, { ...month, filters: { ...lastDays(30), rating: 'bad' } }),
    );
    await time('Founder · 30 days + AI solved', () =>
      listAs(founder, { ...month, filters: { ...lastDays(30), handledBy: ['ai'] } }),
    );
    await time('Founder · risk flag (1 %)', () =>
      listAs(founder, { ...month, filters: { riskFlags: ['fraud_suspected'] } }),
    );
    await time('Founder · tag all (20 %)', () =>
      listAs(founder, { ...month, filters: { tags: [tagId], tagMode: 'all' } }),
    );
    await time('Founder · tag any (20 %)', () =>
      listAs(founder, { ...month, filters: { tags: [tagId], tagMode: 'any' } }),
    );

    // The statements measured, written out (the service builds them): the
    // page CTE for each kind of caller, and the member's capped count. The
    // member's team probe twice: as shipped (`OFFSET 0`) and without it — the
    // form PostgreSQL rewrites into a hashed subplan over every row of the team.
    const memberSees = (fence: boolean) => Prisma.sql`(
      EXISTS (SELECT 1 FROM chat_access ca
              WHERE ca.chat_id = t.chat_id AND ca.group_id = ANY(${`{${memberGroup}}`}::bigint[])
              ${fence ? Prisma.sql`OFFSET 0` : Prisma.empty})
      OR EXISTS (SELECT 1 FROM chat_users cp
                 WHERE cp.chat_id = t.chat_id AND cp.user_id = ${MEMBER_ID} AND cp.user_type = 'agent')
    )`;
    const memberPage = (fence: boolean) => Prisma.sql`SELECT t.id FROM threads t
      JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
      WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL AND ${memberSees(fence)}
      ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`;
    const memberCount = (fence: boolean) => Prisma.sql`SELECT count(*) FROM (SELECT 1 FROM threads t
      JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
      WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL AND ${memberSees(fence)}
      LIMIT 1001) capped`;
    const statements: Array<[string, Prisma.Sql]> = [
      [
        'Founder · 30 days + one team, the page CTE (tm 336.1)',
        Prisma.sql`SELECT t.id FROM threads t
          JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
          WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL
            AND t.created_at >= now() - interval '30 days'
            AND (t.group_id = ANY(${[String(memberGroup)]}::bigint[])
                 OR (t.group_id IS NULL AND EXISTS (
                   SELECT 1 FROM chat_access ca WHERE ca.chat_id = t.chat_id
                     AND ca.group_id = ANY(${[String(memberGroup)]}::bigint[]) OFFSET 0)))
          ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`,
      ],
      [
        'Founder · one day a month ago + one team, the page CTE (tm 336.1)',
        Prisma.sql`SELECT t.id FROM threads t
          JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
          WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL
            AND t.created_at >= now() - interval '31 days' AND t.created_at < now() - interval '30 days'
            AND (t.group_id = ANY(${[String(memberGroup)]}::bigint[])
                 OR (t.group_id IS NULL AND EXISTS (
                   SELECT 1 FROM chat_access ca WHERE ca.chat_id = t.chat_id
                     AND ca.group_id = ANY(${[String(memberGroup)]}::bigint[]) OFFSET 0)))
          ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`,
      ],
      [
        'Founder · agent filter, the page CTE (tm 336.1)',
        Prisma.sql`SELECT t.id FROM threads t
          JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
          WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL
            AND t.agent_ids && ${[MEMBER_ID]}::uuid[]
          ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`,
      ],
      [
        'Founder · the page CTE',
        Prisma.sql`SELECT t.id FROM threads t
          JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
          WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL
          ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`,
      ],
      [
        'Team Member · last 7 days, the page CTE (tm 336.1)',
        Prisma.sql`SELECT t.id FROM threads t
          JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
          WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL
            AND t.created_at >= now() - interval '7 days'
            AND t.closed_at >= now() - interval '7 days' - interval '1 minute'
            AND ${memberSees(true)}
          ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`,
      ],
      [
        'Founder · tag all, the capped count (tm 336.1)',
        Prisma.sql`SELECT count(*) FROM (SELECT 1 FROM threads t
          JOIN chats c ON c.id = t.chat_id JOIN customers cu ON cu.id = c.customer_id
          WHERE t.license_id = ${licenseId} AND t.closed_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM thread_tags tt
                  WHERE tt.thread_id = t.id AND tt.tag_id = ${tagId}::uuid)
          LIMIT 1001) capped`,
      ],
      ['Team Member · the page CTE (OFFSET 0, shipped)', memberPage(true)],
      ['Team Member · the capped count (OFFSET 0, shipped)', memberCount(true)],
      ['Team Member · the page CTE, without OFFSET 0', memberPage(false)],
      ['Team Member · the capped count, without OFFSET 0', memberCount(false)],
    ];
    for (const [label, statement] of statements) {
      const plan = await withTenantRead(app, tenant, (tx) =>
        tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${statement}`,
        ),
      );
      console.log(`\n=== ${label}, as siyahtus_app ===`);
      for (const row of plan) console.log(`  ${row['QUERY PLAN']}`);
    }
    return 0;
  } finally {
    await owner.$disconnect();
    await app.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
