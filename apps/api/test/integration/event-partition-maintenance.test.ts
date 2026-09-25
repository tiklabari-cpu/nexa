/**
 * `events` partition maintenance under the runtime role (tm 255.14 · PLAN
 * §D131 → §D187 · SEMA-MIMARI.8.4c).
 *
 * `plugins/database.ts` opens the months ahead of "now" at boot and every six
 * hours, and it does so through `DATABASE_APP_URL` — `nexa_app`, the role that
 * owns nothing. Until migration `20260925100000_events_partition_definer`,
 * `events_ensure_partition` ran with its caller's rights, and `nexa_app` can
 * neither create in `public` nor own `events`. Measured 2026-08-28 (§D131) and
 * again 2026-09-25: `permission denied for schema public` — and with a
 * `CREATE` grant added by hand, `must be owner of table events`. It stayed
 * quiet only because every month it was asked for already existed; the first
 * month it had to open itself (2026-12 on the development database) would have
 * failed inside the plugin's `catch`, and every event after it would have gone
 * to `events_default`.
 *
 * Four things are proved here, in the order the task names them:
 *
 *  1. The runtime role opens a month that does not exist, through the function
 *     and the window the plugin uses — both red before the migration.
 *  2. What it opens is born secured, owned by the owner of `events`, and tenant
 *     isolation holds on it.
 *  3. The SECURITY DEFINER surface is exactly partition-shaped: a name that is
 *     not an `events` partition, or an instant outside the window, runs no DDL;
 *     EXECUTE is nobody's by default; `search_path` is pinned.
 *  4. A failing pass is visible — on `/health` and in the error log — and a
 *     month blocked by rows already in `events_default` fails alone, with the
 *     SQLSTATE that says so, until the table owner releases it.
 *
 * Every test works on months the migration did not open (+7 and beyond, or
 * the window's own +3 dropped for the occasion), and `afterEach` puts the
 * partition set back exactly as it found it, so the rest of the shard sees the
 * window it was migrated with.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildEventId, generateShortId } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { startTestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** First instant of the UTC month `offset` months from now. */
function monthStart(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

const monthKey = (month: Date): string => month.toISOString().slice(0, 7);
const partitionName = (month: Date): string => `events_${monthKey(month).replace('-', '_')}`;

/** The SQLSTATE a raw query failed with — Prisma reports it as `P2010`, the code in `meta`. */
function sqlStateOf(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const code = (error.meta as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function databaseMessageOf(error: unknown): string {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return '';
  const message = (error.meta as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message : '';
}

async function failureOf(query: PromiseLike<unknown>): Promise<unknown> {
  try {
    await query;
  } catch (error) {
    return error;
  }
  throw new Error('expected the query to fail, and it succeeded');
}

async function waitUntil(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Collects the lines pino actually wrote, so the assertion is on output. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
  withMessage(message: string): Array<Record<string, unknown>> {
    return this.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry['msg'] === message);
  }
}

interface EventPartitionsBody {
  interval_ms: number;
  months_ahead: number;
  months_behind: number;
  last_run_at: string | null;
  last_status: string | null;
  consecutive_errors: number;
  failed_months: Array<{ month: string; error_code: string }>;
}

interface HealthBody {
  status: string;
  service: string;
  event_partitions?: EventPartitionsBody;
}

let owner: PrismaClient;
let app: PrismaClient;
let fx: Fixtures;
let partitionsBefore: string[];

async function partitionNames(): Promise<string[]> {
  const rows = await owner.$queryRaw<Array<{ name: string }>>`
    SELECT c.relname AS name
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.events'::regclass
    ORDER BY c.relname
  `;
  return rows.map((row) => row.name);
}

async function partitionExists(name: string): Promise<boolean> {
  return (await partitionNames()).includes(name);
}

/** A chat with one open thread for `tenant`, written as the owner — the fixture, not the subject. */
async function openThread(tenant: TenantFixture): Promise<{ chatId: string; threadId: string }> {
  const chatId = generateShortId();
  const threadId = generateShortId();
  await owner.chat.create({
    data: { id: chatId, licenseId: tenant.licenseId, customerId: tenant.customerId, active: true },
  });
  await owner.thread.create({
    data: { id: threadId, chatId, licenseId: tenant.licenseId, active: true },
  });
  return { chatId, threadId };
}

async function addEvent(
  tenant: TenantFixture,
  thread: { chatId: string; threadId: string },
  createdAt: Date,
  sequence = 1,
): Promise<{ id: string }> {
  return owner.event.create({
    data: {
      id: buildEventId(thread.threadId, sequence),
      threadId: thread.threadId,
      chatId: thread.chatId,
      licenseId: tenant.licenseId,
      type: 'message',
      text: `event ${sequence}`,
      authorType: 'customer',
      properties: { sequence },
      createdAt,
    },
    select: { id: true },
  });
}

async function partitionOf(eventId: string): Promise<string | undefined> {
  const [row] = await owner.$queryRaw<Array<{ partition: string }>>`
    SELECT tableoid::regclass::text AS partition FROM events WHERE id = ${eventId}
  `;
  return row?.partition;
}

beforeAll(() => {
  owner = ownerClient();
  app = new PrismaClient({ datasourceUrl: APP_URL });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect()]);
});

beforeEach(async () => {
  fx = await seedFixtures(owner);
  partitionsBefore = await partitionNames();
});

afterEach(async () => {
  // Rows first: a month cannot be reopened while events_default holds rows
  // for it — which is precisely what one of these tests sets up.
  await owner.$executeRawUnsafe('TRUNCATE TABLE events');
  const now = await partitionNames();
  for (const name of now.filter((candidate) => !partitionsBefore.includes(candidate))) {
    await owner.$executeRawUnsafe(`DROP TABLE public."${name}"`);
  }
  for (const name of partitionsBefore.filter((candidate) => !now.includes(candidate))) {
    const [, year, month] = /^events_(\d{4})_(\d{2})$/.exec(name) ?? [];
    const start = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    await owner.$queryRaw`SELECT events_ensure_partition(${start}::timestamptz)`;
  }
});

describe('the runtime role opens months itself (SEMA-MIMARI.8.4c)', () => {
  it('opens a month that does not exist yet — the call that answered "permission denied for schema public" before 20260925100000', async () => {
    const month = monthStart(20);
    const name = partitionName(month);
    expect(await partitionExists(name)).toBe(false);

    const [row] = await app.$queryRaw<Array<{ partition: string }>>`
      SELECT events_ensure_partition(${month}::timestamptz) AS partition
    `;

    expect(row?.partition).toBe(name);
    expect(await partitionExists(name)).toBe(true);
  });

  it("runs the maintenance window one month past what the migration opened — §D131's December, wherever now is", async () => {
    // The domain migration opened −2…+6 when this database was migrated, so +7
    // is the first month nobody but the runtime will ever open.
    const name = partitionName(monthStart(7));
    expect(await partitionExists(name)).toBe(false);

    await app.$queryRaw`SELECT events_maintain_partitions(7::int, 1::int)`;

    expect(await partitionExists(name)).toBe(true);
  });

  it('opens it secured and owned like events, and tenants stay apart inside it (SEMA-MIMARI.8.4c · NFR-S4)', async () => {
    const month = monthStart(21);
    const name = partitionName(month);
    await app.$queryRaw`SELECT events_ensure_partition(${month}::timestamptz)`;

    // Owned by the owner of `events`, never by the caller: a table owner is
    // exempt from its own row level security, so a partition the runtime role
    // owned would be one it could read across tenants — and unprotect.
    const [shape] = await owner.$queryRaw<
      Array<{ rowSecurity: boolean; ownedLikeEvents: boolean; appOwns: boolean }>
    >`
      SELECT c.relrowsecurity AS "rowSecurity",
             c.relowner = (SELECT relowner FROM pg_class WHERE oid = 'public.events'::regclass) AS "ownedLikeEvents",
             pg_has_role('nexa_app', c.relowner, 'USAGE') AS "appOwns"
      FROM pg_class c WHERE c.oid = to_regclass(${`public.${name}`})
    `;
    expect(shape).toEqual({ rowSecurity: true, ownedLikeEvents: true, appOwns: false });

    const policies = await owner.$queryRaw<
      Array<{ policyname: string; qual: string; withCheck: string }>
    >`
      SELECT policyname, qual, with_check AS "withCheck" FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ${name}
    `;
    expect(policies).toEqual([
      {
        policyname: `${name}_tenant`,
        qual: expect.stringMatching(/nexa_current_license/),
        withCheck: expect.stringMatching(/nexa_current_license/),
      },
    ]);

    // Both tenants write into the month the runtime opened.
    const inMonth = new Date(month.getTime() + 10 * DAY_MS);
    const mine = await openThread(fx.a);
    const theirs = await openThread(fx.b);
    const own = await addEvent(fx.a, mine, inMonth);
    await addEvent(fx.b, theirs, inMonth);
    expect(await partitionOf(own.id)).toBe(name);

    // No tenant context — the shape of a query that slipped past withTenant.
    const [leaked] = await app.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM public."${name}"`,
    );
    expect(leaked?.count).toBe(0);

    const tenantA = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    const scoped = await withTenant(app, tenantA, async (tx) => ({
      direct: await tx.$queryRawUnsafe<Array<{ licenseId: bigint }>>(
        `SELECT license_id AS "licenseId" FROM public."${name}"`,
      ),
      throughParent: await tx.event.findMany({
        where: { createdAt: { gte: month } },
        select: { chatId: true },
      }),
    }));
    expect(scoped.direct.map((row) => row.licenseId)).toEqual([fx.a.licenseId]);
    expect(scoped.throughParent.map((event) => event.chatId)).toEqual([mine.chatId]);

    // And A cannot write B's row into it, named directly or not.
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO public."${name}" (id, thread_id, chat_id, license_id, type, author_type, created_at)
           VALUES ($1, $2, $3, $4, 'message', 'agent', $5)`,
          buildEventId(theirs.threadId, 99),
          theirs.threadId,
          theirs.chatId,
          fx.b.licenseId,
          inMonth,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('lets two callers race for the same month, and neither fails', async () => {
    // Two API instances booting together in the month a partition is due: the
    // second one's existence check runs before the first commits, and its
    // CREATE then waits on the first one's lock. It must come out of that wait
    // with the partition, not with "relation already exists" on /health.
    const month = monthStart(23);
    const name = partitionName(month);
    expect(await partitionExists(name)).toBe(false);

    let opened!: () => void;
    const firstHasOpened = new Promise<void>((resolve) => (opened = resolve));
    let commit!: () => void;
    const released = new Promise<void>((resolve) => (commit = resolve));

    const first = owner.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT events_ensure_partition(${month}::timestamptz)`;
        opened();
        await released;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );

    let second: Promise<Array<{ partition: string }>> | undefined;
    try {
      await firstHasOpened;
      second = (async () =>
        app.$queryRaw<Array<{ partition: string }>>`
          SELECT events_ensure_partition(${month}::timestamptz) AS partition
        `)();

      await waitUntil(async () => {
        const [row] = await owner.$queryRaw<Array<{ waiting: number }>>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND usename = 'nexa_app'
            AND wait_event_type = 'Lock' AND query LIKE '%events_ensure_partition%'
        `;
        return (row?.waiting ?? 0) > 0;
      }, 'the second caller waits on the first one’s lock');

      commit();
      await first;
      const [row] = await second;
      expect(row?.partition).toBe(name);
    } finally {
      commit();
      await first.catch(() => undefined);
      await second?.catch(() => undefined);
    }
  });

  it('gives up after a second instead of queueing every event write behind its lock', async () => {
    // A long reader — a report, an export — holds ACCESS SHARE on events. The
    // CREATE needs ACCESS EXCLUSIVE, and while it waits every new event write
    // queues behind it. Better to fail this pass (it is retried in six hours,
    // three months ahead of need) than to stall the chat.
    const month = monthStart(24);
    let holding!: () => void;
    const readerHolds = new Promise<void>((resolve) => (holding = resolve));
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));

    const reader = owner.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT count(*) FROM events`;
        holding();
        await done;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );

    try {
      await readerHolds;
      const startedAt = Date.now();
      const failure = await failureOf(
        app.$queryRaw`SELECT events_ensure_partition(${month}::timestamptz)`,
      );
      const waitedMs = Date.now() - startedAt;

      expect(sqlStateOf(failure)).toBe('55P03');
      expect(waitedMs).toBeGreaterThanOrEqual(900);
      expect(waitedMs).toBeLessThan(5_000);
    } finally {
      finish();
      await reader;
    }
    expect(await partitionExists(partitionName(month))).toBe(false);
  });
});

describe('the SECURITY DEFINER surface is exactly partition-shaped (NFR-S4)', () => {
  it('secures nothing that is not a partition of events — and changes nothing trying', async () => {
    // The attack a definer with a name parameter invites: aim it at a table
    // that must NOT carry the generic tenant policy. `audit_log` is append-only
    // at the policy level (SELECT + INSERT, nothing else); without the check,
    // this call succeeds and adds a FOR ALL policy to it.
    const surface = () => owner.$queryRaw<Array<{ policyname: string; cmd: string }>>`
      SELECT policyname, cmd FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'audit_log' ORDER BY policyname
    `;
    const before = await surface();
    expect(before.map((policy) => policy.cmd).sort()).toEqual(['INSERT', 'SELECT']);

    for (const name of [
      'audit_log',
      'events',
      'events_2026_13',
      'events_2026_09"; DROP TABLE chats; --',
      null,
    ]) {
      const failure = await failureOf(
        owner.$queryRaw`SELECT events_secure_partition(${name}::text)`,
      );
      expect(sqlStateOf(failure), `events_secure_partition(${String(name)})`).toBe('22023');
    }

    expect(await surface()).toEqual(before);
  });

  it('opens no month more than five years from now, and nothing that is not a finite instant', async () => {
    const before = await partitionNames();

    for (const offset of [61, -61]) {
      const failure = await failureOf(
        app.$queryRaw`SELECT events_ensure_partition(${monthStart(offset)}::timestamptz)`,
      );
      expect(sqlStateOf(failure), `offset ${offset}`).toBe('22023');
    }
    for (const literal of ['infinity', '-infinity']) {
      const failure = await failureOf(
        app.$queryRawUnsafe(`SELECT events_ensure_partition('${literal}'::timestamptz)`),
      );
      expect(sqlStateOf(failure), literal).toBe('22023');
    }
    const nullFailure = await failureOf(
      app.$queryRaw`SELECT events_ensure_partition(NULL::timestamptz)`,
    );
    expect(sqlStateOf(nullFailure)).toBe('22023');
    expect(await partitionNames()).toEqual(before);

    // The edge itself is inside: sixty months out still opens.
    const edge = monthStart(60);
    await app.$queryRaw`SELECT events_ensure_partition(${edge}::timestamptz)`;
    expect(await partitionExists(partitionName(edge))).toBe(true);
  });

  it('runs as the owner of events with a pinned search_path, and gives EXECUTE to nobody by default', async () => {
    const rows = await owner.$queryRaw<
      Array<{
        name: string;
        definer: boolean;
        config: string[] | null;
        ownedLikeEvents: boolean;
        publicCan: boolean;
        appCan: boolean;
      }>
    >`
      SELECT p.proname AS name,
             p.prosecdef AS definer,
             p.proconfig AS config,
             p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'public.events'::regclass) AS "ownedLikeEvents",
             has_function_privilege('public', p.oid, 'EXECUTE') AS "publicCan",
             has_function_privilege('nexa_app', p.oid, 'EXECUTE') AS "appCan"
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('events_ensure_partition', 'events_secure_partition',
                          'events_maintain_partitions', 'events_release_default_month')
      ORDER BY p.proname
    `;

    const pinned = 'search_path=public, pg_temp';
    expect(rows.map((row) => ({ ...row, config: [...(row.config ?? [])].sort() }))).toEqual([
      // The two that run DDL with the owner's rights, the only two SECURITY DEFINER.
      {
        name: 'events_ensure_partition',
        definer: true,
        config: ['lock_timeout=1s', pinned],
        ownedLikeEvents: true,
        publicCan: false,
        appCan: true,
      },
      // A loop over events_ensure_partition with the caller's own rights —
      // granting it adds nothing the runtime role does not already hold.
      {
        name: 'events_maintain_partitions',
        definer: false,
        config: [pinned],
        ownedLikeEvents: true,
        publicCan: false,
        appCan: true,
      },
      // The owner's repair tool: moves customer rows, so no grant at all.
      {
        name: 'events_release_default_month',
        definer: false,
        config: [pinned],
        ownedLikeEvents: true,
        publicCan: false,
        appCan: false,
      },
      {
        name: 'events_secure_partition',
        definer: true,
        config: [pinned],
        ownedLikeEvents: true,
        publicCan: false,
        appCan: false,
      },
    ]);
  });

  it('keeps events_secure_partition and the release out of the runtime role’s reach', async () => {
    const secure = await failureOf(app.$queryRaw`SELECT events_secure_partition('events_default')`);
    expect(sqlStateOf(secure)).toBe('42501');

    const release = await failureOf(
      app.$queryRaw`SELECT events_release_default_month(${monthStart(28)}::timestamptz)`,
    );
    expect(sqlStateOf(release)).toBe('42501');
  });
});

describe('a month whose rows already sit in events_default (SEMA-MIMARI.8.4c)', () => {
  it('refuses that month with check_violation naming it — and that month is all it refuses', async () => {
    const blocked = monthStart(25);
    const thread = await openThread(fx.a);
    const stray = await addEvent(fx.a, thread, new Date(blocked.getTime() + 3 * DAY_MS));
    expect(await partitionOf(stray.id)).toBe('events_default');

    const failure = await failureOf(
      app.$queryRaw`SELECT events_ensure_partition(${blocked}::timestamptz)`,
    );
    expect(sqlStateOf(failure)).toBe('23514');
    expect(databaseMessageOf(failure)).toContain(monthKey(blocked));
    expect(await partitionExists(partitionName(blocked))).toBe(false);

    const next = monthStart(26);
    await app.$queryRaw`SELECT events_ensure_partition(${next}::timestamptz)`;
    expect(await partitionExists(partitionName(next))).toBe(true);
  });

  it('opens once the table owner releases it: every row keeps every column, moves into the month, and stays tenant-scoped', async () => {
    const blocked = monthStart(27);
    const name = partitionName(blocked);
    const inMonth = new Date(blocked.getTime() + 5 * DAY_MS);
    const mine = await openThread(fx.a);
    const theirs = await openThread(fx.b);
    const ownEvents = [
      await addEvent(fx.a, mine, inMonth, 1),
      await addEvent(fx.a, mine, new Date(inMonth.getTime() + 1_000), 2),
    ];
    const otherEvent = await addEvent(fx.b, theirs, inMonth, 7);
    // Outside the month: the release must leave it where it is.
    const farFuture = await addEvent(fx.a, mine, new Date(Date.UTC(2098, 0, 1)), 3);
    const everything = () =>
      owner.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM events ORDER BY id');
    const before = await everything();

    const [released] = await owner.$queryRaw<Array<{ moved: bigint }>>`
      SELECT events_release_default_month(${blocked}::timestamptz) AS moved
    `;

    expect(released?.moved).toBe(3n);
    for (const event of [...ownEvents, otherEvent]) expect(await partitionOf(event.id)).toBe(name);
    expect(await partitionOf(farFuture.id)).toBe('events_default');
    // Every column, the generated event_sequence included — recomputed, not copied.
    expect(await everything()).toEqual(before);

    const visible = await withTenant(
      app,
      { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
      (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM public."${name}" ORDER BY id`),
    );
    expect(visible.map((row) => row.id)).toEqual(ownEvents.map((event) => event.id).sort());
  });
});

describe('GET /health — the maintenance pass is visible (SEMA-MIMARI.8.4c)', () => {
  let adminAuth: { authorization: string };

  beforeEach(async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [],
    });
    adminAuth = { authorization: `Bearer ${token}` };
  });

  it('reports the boot pass to an admin — the window, when it ran, that every month opened — and none of it to anyone else', async () => {
    const server = await startTestServer();
    try {
      const response = await server.get('/health', adminAuth);
      expect(response.statusCode).toBe(200);
      const body = response.json() as HealthBody;

      expect(body.event_partitions).toEqual({
        interval_ms: 6 * 60 * 60 * 1000,
        months_ahead: 3,
        months_behind: 1,
        last_run_at: expect.any(String),
        last_status: 'ok',
        consecutive_errors: 0,
        failed_months: [],
      });
      expect(Date.now() - Date.parse(body.event_partitions?.last_run_at ?? '')).toBeLessThan(
        60_000,
      );

      expect((await server.get('/health')).json()).toEqual({ status: 'ok', service: 'api' });
    } finally {
      await server.close();
    }
  });

  it('shows the §D131 failure itself — the runtime role without the owner’s rights — on /health and in the error log, while the process keeps serving', async () => {
    // Exactly the regression this task closes: a later migration re-creating
    // the function without SECURITY DEFINER. With EXECUTE on
    // events_secure_partition narrowed, it now fails on the very next boot for
    // every month — not silently, months later, on the first missing one.
    await owner.$executeRawUnsafe(
      'ALTER FUNCTION events_ensure_partition(timestamptz) SECURITY INVOKER',
    );
    try {
      const sink = new LineSink();
      const server = await startTestServer(
        { LOG_LEVEL: 'info' },
        { logStream: sink as unknown as NodeJS.WritableStream },
      );
      try {
        const window = [-1, 0, 1, 2, 3].map((offset) => monthKey(monthStart(offset)));

        // Not a readiness matter: the process serves, the orchestrator keeps
        // routing, and a restart would not fix a missing privilege.
        const health = await server.get('/health', adminAuth);
        expect(health.statusCode).toBe(200);
        expect((await server.get('/health/ready')).statusCode).toBe(200);

        const body = health.json() as HealthBody;
        expect(body.status).toBe('ok');
        expect(body.event_partitions).toMatchObject({
          last_status: 'error',
          consecutive_errors: 1,
          failed_months: window.map((month) => ({ month, error_code: '42501' })),
        });

        const [logged, ...more] = sink.withMessage('event partition maintenance failed');
        expect(more).toEqual([]);
        expect(logged?.['level']).toBe(50);
        expect(logged?.['consecutive_errors']).toBe(1);
        expect(logged?.['failed_months']).toEqual(
          window.map((month) => ({
            month,
            error_code: '42501',
            message: expect.stringMatching(/permission denied/),
          })),
        );
      } finally {
        await server.close();
      }
    } finally {
      await owner.$executeRawUnsafe(
        'ALTER FUNCTION events_ensure_partition(timestamptz) SECURITY DEFINER',
      );
    }
  });

  it('names the one month rows in events_default block, opens the rest, and clears once the owner releases it', async () => {
    const blocked = monthStart(3);
    await owner.$executeRawUnsafe(`DROP TABLE public."${partitionName(blocked)}"`);
    const thread = await openThread(fx.a);
    const stray = await addEvent(fx.a, thread, new Date(blocked.getTime() + DAY_MS));
    expect(await partitionOf(stray.id)).toBe('events_default');

    const sink = new LineSink();
    const server = await startTestServer(
      { LOG_LEVEL: 'info' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
    try {
      const failing = (await server.get('/health', adminAuth)).json() as HealthBody;
      expect(failing.event_partitions).toMatchObject({
        last_status: 'error',
        consecutive_errors: 1,
        failed_months: [{ month: monthKey(blocked), error_code: '23514' }],
      });

      await owner.$queryRaw`SELECT events_release_default_month(${blocked}::timestamptz)`;
      await server.app.eventPartitions.run();

      const cleared = (await server.get('/health', adminAuth)).json() as HealthBody;
      expect(cleared.event_partitions).toMatchObject({
        last_status: 'ok',
        consecutive_errors: 0,
        failed_months: [],
      });
      expect(sink.withMessage('event partition maintenance recovered')).toHaveLength(1);
      expect(await partitionOf(stray.id)).toBe(partitionName(blocked));
    } finally {
      await server.close();
    }
  });
});
