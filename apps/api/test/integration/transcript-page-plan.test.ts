/**
 * A transcript page must not read the thread it is a page of (NFR-P6).
 *
 * The PRD prices `events` as "aylık RANGE partition + kompozit indeks + cursor
 * pagination -> sabit-zaman". Two of those three were in place and the third
 * was not: `chat-service.ts#listEvents` bounded and ordered a page by
 * `(split_part(id, '_', 2))::bigint` — the per-thread sequence that lives
 * inside the event id — and nothing indexed that expression, so every page
 * sorted the whole thread and threw all but fifty rows away. Measured before
 * the fix (`pnpm --filter @nexa/api measure:transcript-page 2000`): ten times
 * the events, 10.03 times the shared buffers, on every page.
 *
 * The fix is a stored generated column, `events.event_sequence`, and the reason
 * it is a column rather than an index over the expression is the thing this
 * file mostly guards. Under row level security PostgreSQL will not push a
 * non-leakproof qual into an index condition, and `split_part` is not
 * leakproof — so with an expression index the *first* page is perfect while
 * every page after it re-reads the thread from event one, and the plan says
 * `Index Scan` the whole time. Measured, same rows, same run: the page at
 * event 10 000 costs 24 buffers on the shipped column and 254 on the
 * expression index.
 *
 * What makes this a guard rather than a second copy of the query: the statement
 * under `EXPLAIN` is not written in this file. It is the `Prisma.Sql` value the
 * service itself builds, intercepted on its way to the database and explained
 * with its own parameters, its own tenant context and its own row level
 * security still attached. A rewritten copy would have missed both ways this
 * can regress — someone reaching back for `split_part`, and the cursor arriving
 * as some type the planner has to coerce the indexed column to (`numeric` and
 * `double precision` both do it) — because both leave the query *looking*
 * right.
 *
 * Cost is counted in shared buffers rather than milliseconds: buffers are a
 * property of the plan, so the assertion says what it means and cannot go red
 * because the machine was busy.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildEventId, generateShortId } from '@nexa/types';
import { ChatService } from '../../src/services/chat/chat-service.js';
import type { TenantClient } from '../../src/lib/tenant.js';
import type { AgentPrincipal, CustomerPrincipal } from '../../src/services/auth/principal.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** `listEvents` only reaches Redis on the write path; reads never do. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

/**
 * Small, then ten times small. Large enough that reading the whole thread is
 * the cheaper plan when no index matches — which is what makes the "before"
 * shape the one the audit found — and small enough that seeding is one
 * statement.
 */
const SMALL = 500;
const FACTOR = 10;
const PAGE = 50;

interface PlanNode {
  'Node Type': string;
  'Index Cond'?: string;
  Filter?: string;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}

const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

/**
 * How the transcript page is recognised on its way past.
 *
 * By its shape — a bounded, ordered read of `events` — rather than by naming
 * the key it pages on. Keying on `event_sequence` would mean a change back to
 * `split_part` slipped past the interceptor and failed this file with "no plan
 * captured", which says nothing about what broke; this way the old form is
 * still explained and fails on the assertion that names the defect.
 */
const EVENT_PAGE_SQL = /\bFROM events\b[\s\S]*\bORDER BY\b/i;

/**
 * A client that explains the transcript statement on its way through.
 *
 * `listEvents` runs its page inside `withTenant`, so the statement only ever
 * exists on the transaction client — which is why the wrapping starts at
 * `$transaction`. Explaining it there rather than re-issuing it afterwards is
 * the whole point: the tenant context, the row level security it turns on and
 * the parameter types Prisma chose are all exactly the ones the product gets.
 */
function explainingClient(base: PrismaClient, sink: (plan: PlanNode) => void): PrismaClient {
  const wrapTransaction = (tx: TenantClient): TenantClient =>
    new Proxy(tx, {
      get(target, property, receiver): unknown {
        if (property !== '$queryRaw') return Reflect.get(target, property, receiver);
        return async (statement: Prisma.Sql, ...rest: unknown[]): Promise<unknown> => {
          // Duck-typed rather than `instanceof`: `Prisma.Sql` is a type at
          // runtime, not a constructor, so an identity check throws here.
          const text: unknown = (statement as { text?: unknown } | undefined)?.text;
          if (typeof text === 'string' && EVENT_PAGE_SQL.test(text)) {
            const rows = await target.$queryRaw<Array<Record<string, unknown>>>(
              Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
            );
            const raw = Object.values(rows[0] ?? {})[0];
            const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{
              Plan: PlanNode;
            }>;
            sink(parsed[0]!.Plan);
          }
          return (target.$queryRaw as (...args: unknown[]) => Promise<unknown>)(statement, ...rest);
        };
      },
    }) as TenantClient;

  return new Proxy(base, {
    get(target, property, receiver): unknown {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return (fn: unknown, options?: unknown) =>
        typeof fn === 'function'
          ? target.$transaction(
              async (tx) => (fn as (tx: TenantClient) => Promise<unknown>)(wrapTransaction(tx)),
              options as Parameters<PrismaClient['$transaction']>[1],
            )
          : (target.$transaction as (...args: unknown[]) => Promise<unknown>)(fn, options);
    },
  });
}

describe('transcript page plan (NFR-P6)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let plans: PlanNode[];

  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });
  const chats = () =>
    new ChatService(
      explainingClient(appRole, (plan) => plans.push(plan)),
      NO_REDIS,
    );

  const agent = (t: TenantFixture): AgentPrincipal => ({
    kind: 'agent',
    accountId: t.agentAccountId,
    licenseId: t.licenseId,
    organizationId: t.organizationId,
    role: 'agent',
    scopes: ['chats--all:rw', 'chats--all:ro'],
    tokenId: 'test-token',
    tokenKind: 'pat',
  });

  /** A chat with one thread, seeded as the owner so RLS is not in the way. */
  async function seedThread(
    t: TenantFixture,
  ): Promise<{ chatId: string; threadId: string; customerId: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: 'Vic' },
      select: { id: true },
    });
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active: true },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: true },
    });
    return { chatId, threadId, customerId: customer.id };
  }

  /**
   * Grows the thread to exactly `total` events, ids shaped as the service mints
   * them (`<thread_id>_<sequence>`). One `INSERT ... SELECT` because the point
   * of the test is the read; every tenth event is an internal note so the
   * customer-facing page has something to skip.
   */
  async function growTo(
    t: TenantFixture,
    ids: { chatId: string; threadId: string },
    from: number,
    total: number,
  ): Promise<void> {
    await owner.$executeRaw`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text,
                          author_type, recipients, created_at)
      SELECT ${ids.threadId} || '_' || g, ${ids.threadId}, ${ids.chatId}, ${t.licenseId}, 'message',
             'message ' || g,
             CASE WHEN g % 2 = 0 THEN 'agent' ELSE 'customer' END,
             CASE WHEN g % 10 = 0 THEN 'agents' ELSE 'all' END,
             date_trunc('month', now()) + make_interval(secs => g::double precision)
      FROM generate_series(${from + 1}::bigint, ${total}::bigint) g
    `;
    await owner.$executeRaw`UPDATE threads SET event_sequence = ${total} WHERE id = ${ids.threadId}`;
    // Without fresh statistics the planner prices a table it has never looked
    // at, and the plan under test would be an artefact of that guess.
    await owner.$executeRawUnsafe('ANALYZE events');
  }

  /** Reads one page exactly as the route does, and returns the plan it ran. */
  async function pagePlan(
    t: TenantFixture,
    chatId: string,
    options: { sort?: 'oldest' | 'newest'; afterEventId?: string } = {},
  ): Promise<PlanNode> {
    plans = [];
    await chats().listEvents(ctx(t), agent(t), chatId, { limit: PAGE, ...options });
    if (plans.length !== 1) throw new Error(`expected one transcript plan, got ${plans.length}`);
    return plans[0]!;
  }

  const buffersOf = (plan: PlanNode): number =>
    (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);

  /** Every node type the plan used, so an assertion can name the ones it forbids. */
  const typesOf = (plan: PlanNode): string[] => flatten(plan).map((node) => node['Node Type']);

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    plans = [];
  });

  it('answers a page with an index scan on the sequence, and never sorts', async () => {
    const ids = await seedThread(fx.a);
    await growTo(fx.a, ids, 0, SMALL * FACTOR);

    for (const sort of ['newest', 'oldest'] as const) {
      const plan = await pagePlan(fx.a, ids.chatId, { sort });
      const types = typesOf(plan);

      expect(types, `${sort}: expected an index scan`).toEqual(
        expect.arrayContaining([expect.stringContaining('Index Scan')]),
      );
      // The two shapes the audit named. A sort means the page read rows it did
      // not return; a sequential scan means it read the whole thread to do it.
      expect(types, `${sort}: page must not sort`).not.toContain('Sort');
      expect(types, `${sort}: page must not sort`).not.toContain('Incremental Sort');
      expect(types, `${sort}: page must not scan the thread`).not.toContain('Seq Scan');
    }
  });

  it('drives the cursor from the index rather than filtering rows it read', async () => {
    const ids = await seedThread(fx.a);
    await growTo(fx.a, ids, 0, SMALL * FACTOR);

    const midpoint = buildEventId(ids.threadId, (SMALL * FACTOR) / 2);
    const plan = await pagePlan(fx.a, ids.chatId, { sort: 'oldest', afterEventId: midpoint });
    const nodes = flatten(plan);

    // The bound must be *in* the index condition. As a row filter the plan
    // still reads `Index Scan` while starting at event one and discarding
    // everything before the cursor — which is the cost this task removed, and
    // which an index over `split_part` could not remove at all.
    const conditions = nodes.flatMap((node) => node['Index Cond'] ?? []).join(' ');
    expect(conditions, 'the cursor must bound the index scan').toMatch(/event_sequence [<>]/);
    expect(
      nodes.flatMap((node) => node.Filter ?? []).join(' '),
      'the cursor must not be re-checked per row',
    ).not.toMatch(/event_sequence/);

    // And the proof that it holds: a page from the middle costs what the first
    // page costs, rather than half the thread more.
    const first = buffersOf(await pagePlan(fx.a, ids.chatId, { sort: 'oldest' }));
    expect(buffersOf(plan)).toBeLessThanOrEqual(Math.ceil(first * 1.5));
  });

  it('costs the same on a thread ten times the size', async () => {
    const ids = await seedThread(fx.a);

    await growTo(fx.a, ids, 0, SMALL);
    const small = buffersOf(await pagePlan(fx.a, ids.chatId, { sort: 'newest' }));

    await growTo(fx.a, ids, SMALL, SMALL * FACTOR);
    const large = buffersOf(await pagePlan(fx.a, ids.chatId, { sort: 'newest' }));

    // Not "equal": the page fans out over every partition either way, and a
    // btree gains a level eventually. Ten times the rows must not mean
    // materially more work — without the index this ratio was 10.03.
    expect(large).toBeLessThanOrEqual(Math.ceil(small * 1.5));
  });

  it('keeps the page constant for the customer-facing transcript too', async () => {
    // The widget's read adds `recipients = 'all'`, which is a filter rather
    // than an index column — so it is the one shape that could still degrade
    // into reading the thread. Asserted separately for that reason.
    const ids = await seedThread(fx.a);
    await growTo(fx.a, ids, 0, SMALL * FACTOR);

    const visitor: CustomerPrincipal = {
      kind: 'customer',
      customerId: ids.customerId,
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
    };

    plans = [];
    await chats().listEvents(ctx(fx.a), visitor, ids.chatId, { limit: PAGE, sort: 'newest' });
    const plan = plans[0]!;

    expect(
      flatten(plan)
        .flatMap((node) => node.Filter ?? [])
        .join(' '),
    ).toMatch(/recipients/);
    expect(typesOf(plan)).toEqual(expect.arrayContaining([expect.stringContaining('Index Scan')]));
    expect(typesOf(plan)).not.toContain('Seq Scan');
    expect(typesOf(plan)).not.toContain('Sort');
  });
});
