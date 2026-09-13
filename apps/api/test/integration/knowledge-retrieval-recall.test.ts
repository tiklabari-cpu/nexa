/**
 * A ready knowledge source is used in retrieval, whatever plan Postgres picks
 * (FR-MOD-06.3.3 · tm 252).
 *
 * The defect this pins was measured, not guessed (GL-16 · tm 232). An e2e visitor
 * asked a question whose answer sat in the agent's knowledge base at 0.5810
 * similarity; the skill run logged "nothing in the knowledge base above 0.25"
 * and the chat went to the human queue. `retrieve()` ordered by the bare
 * distance operator, `ORDER BY embedding <=> $q LIMIT n`, which is the one shape
 * an approximate index can serve, and `idx_chunks_embedding` was approximate: an
 * IVFFlat index the domain-model migration built on an EMPTY table. Built that
 * way its 100 list centroids were random (pgvector's `RandomCenters`), and with
 * `ivfflat.probes` at its default of 1 a scan read one list in a hundred. A
 * passage filed under any other list did not exist for that question, and
 * nothing anywhere said so — "nothing above the threshold" is also what an
 * unanswerable question looks like.
 *
 * tm 254 dropped that index and built `idx_chunks_embedding_hnsw` in its place,
 * which retrieval reads on purpose above its exact-search ceiling
 * (`knowledge-retrieval-scale.test.ts`). This file's knowledge base sits below
 * the ceiling, so what it holds is unchanged: with the planner pinned on the
 * vector index — now the HNSW one — exact search still ranks every question
 * exactly. An approximate index is approximate whatever its kind, and the pin
 * is how a statistics shift would hand it the query.
 *
 * Two choices keep this reproduction from being a coin toss:
 *
 * 1. **The plan is pinned.** Whether the planner reaches for the index depends on
 *    statistics a test cannot hold still: GL-16's dev database chose it at 19
 *    chunks, this file's knowledge base on a fresh database does not, and a
 *    20,000-chunk tenant does. `SET LOCAL enable_sort = off` prices out the
 *    explicit sort, so an index that already returns rows in distance order
 *    becomes the only cheap plan — the dev database's plan. The premise is
 *    checked below rather than assumed. Production statistics are exactly as
 *    unpredictable, so exact search has to hold under the pin, not only without.
 * 2. **One pair would not do.** `migrate deploy` drew new centroids every time
 *    (the seed pgvector fixes is compiled into its benchmark build only), so no
 *    single question missed in every database — GL-16's own pair is the first
 *    row below and, alone, would pass in some of them. The table holds 24 pairs
 *    on unrelated topics, all asked of one agent, and any one that ranks
 *    differently from exact search is a red. Measured before the fix, in ten
 *    fresh databases: 17–22 of the 24 answered wrongly or not at all on the
 *    pinned plan, never fewer — and all 24 right without the pin, which is the
 *    e2e red's intermittency in miniature.
 *
 * The oracle is computed here, not in SQL: `embed()` and `similarity()` over the
 * chunk texts the database actually holds, ranked, cut at the threshold. It
 * cannot agree with a wrong plan by sharing its mistake. `vector` stores float4,
 * so the fixture guard below keeps every score clear of the threshold and of its
 * neighbours — a rounding difference can never reorder a list or move a row
 * across the line.
 *
 * The knowledge base also carries what a real one does: the seed's "Delivery and
 * returns" article, which competes with GL-16's passage above the threshold, and
 * three chunks with no searchable word in them. A zero vector has no cosine
 * distance (pgvector returns NaN) and Postgres sorts NaN above every number, so
 * an implementation that ranks by descending similarity hands those rows the
 * LIMIT's slots ahead of a real match. The second tenant mirrors the first, so
 * the table is shared the way production's is.
 */
import { PrismaClient } from '@prisma/client';
import { chunk, embed, similarity, toVectorLiteral } from '@nexa/ai-mock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import {
  KnowledgeService,
  RETRIEVAL_THRESHOLD,
  type RetrievedChunk,
} from '../../src/services/ai/knowledge-service.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** GL-16's run. Its marker and wording are the ones measured at 0.5810. */
const MARKER = 'parcelflux348166';

/** Each question is answered by its own source — the guard below proves it. */
const PAIRS: ReadonlyArray<{ name: string; content: string; question: string }> = [
  {
    name: 'Persona proof 348166',
    content:
      `Standard ${MARKER} delivery takes 3 to 5 working days. ` +
      `Tracking for a ${MARKER} order is emailed the moment it dispatches. ` +
      `A weekend ${MARKER} order leaves the warehouse on the next working day. ` +
      `International ${MARKER} delivery takes two extra days.`,
    question: `Where is my order — how long does ${MARKER} delivery take?`,
  },
  {
    name: 'Gift cards',
    content:
      'Gift cards never expire and can be spent online or in any of our stores. A lost gift card is replaced if you still have the receipt.',
    question: 'Do gift cards expire?',
  },
  {
    name: 'Password reset',
    content:
      'To reset a forgotten password, choose Forgot password on the sign-in page. The reset link arrives by email and stays valid for one hour.',
    question: 'How do I reset my password?',
  },
  {
    name: 'Appliance warranty',
    content:
      'Every appliance carries a two-year manufacturer warranty. Warranty claims need the serial number printed under the base.',
    question: 'Is my appliance still under warranty?',
  },
  {
    name: 'Showroom hours',
    content:
      'Our showroom opens at nine and closes at six on weekdays. On Saturdays the showroom closes early, at two.',
    question: 'When does the showroom close on Saturdays?',
  },
  {
    name: 'Cancelling a subscription',
    content:
      'Cancel a subscription at any moment from Billing settings. Cancelling stops the renewal but keeps access until the period ends.',
    question: 'How can I cancel my subscription?',
  },
  {
    name: 'Invoices',
    content:
      'Invoices are available as PDF downloads under Account, then Invoices. A corrected invoice can be requested within ninety days.',
    question: 'Where can I download an invoice as a PDF?',
  },
  {
    name: 'Click and collect',
    content:
      'Click and collect parcels wait at the pickup desk for seven days. Bring photo identification when collecting.',
    question: 'How long does click and collect wait at the pickup desk?',
  },
  {
    name: 'Shoe sizes',
    content:
      'Shoes can be exchanged for another size free of charge. The exchange ships once the original pair reaches our depot.',
    question: 'Can I exchange shoes for another size?',
  },
  {
    name: 'Deleting an account',
    content:
      'Deleting an account erases saved addresses and wishlists permanently. Deletion requests are processed within forty-eight hours.',
    question: 'How do I delete my account permanently?',
  },
  {
    name: 'Loyalty points',
    content:
      'Loyalty points are credited after each purchase and convert into vouchers at five hundred points.',
    question: 'When do loyalty points convert into vouchers?',
  },
  {
    name: 'Payment methods',
    content: 'We accept Visa, Mastercard, PayPal and bank transfer. Cash payment is not offered.',
    question: 'Do you accept PayPal?',
  },
  {
    name: 'Damaged items',
    content:
      'Photograph a damaged item and its packaging before contacting support. Damaged goods are replaced without needing a return.',
    question: 'What should I do if an item arrives damaged?',
  },
  {
    name: 'Pre-orders',
    content:
      'A pre-order is charged only when the title ships, and can be cancelled any time before then.',
    question: 'When is a pre-order charged?',
  },
  {
    name: 'Student discount',
    content:
      'Students receive a fifteen percent discount with a verified university email address.',
    question: 'Is there a student discount?',
  },
  {
    name: 'Newsletter',
    content: 'Unsubscribe from the newsletter with the link at the bottom of any newsletter.',
    question: 'How do I unsubscribe from the newsletter?',
  },
  {
    name: 'Two-factor authentication',
    content:
      'Two-factor authentication asks for a six-digit code from an authenticator app at sign-in.',
    question: 'How does two-factor authentication work?',
  },
  {
    name: 'Public holidays',
    content:
      'Parcels posted on public holidays are collected by the courier the next business day.',
    question: 'Does the courier collect on public holidays?',
  },
  {
    name: 'Price match',
    content:
      'We match a lower advertised price from a major competitor within fourteen days of purchase.',
    question: 'Do you match a competitor price?',
  },
  {
    name: 'Wholesale',
    content: 'Businesses ordering more than fifty units qualify for tiered wholesale pricing.',
    question: 'Do businesses get wholesale pricing?',
  },
  {
    name: 'Personal data',
    content: 'Download a copy of your personal data from Privacy settings as a ZIP archive.',
    question: 'Can I get a copy of my personal data?',
  },
  {
    name: 'Allergens',
    content: 'Every recipe page lists the fourteen major allergens, including nuts and gluten.',
    question: 'Does a recipe list allergens such as gluten?',
  },
  {
    name: 'Dogs on the terrace',
    content: 'Well-behaved dogs are welcome on the terrace but not inside the dining room.',
    question: 'Are dogs welcome on the terrace?',
  },
  {
    name: 'Parking',
    content: 'Free parking is available behind the station for up to three hours.',
    question: 'Is there free parking at the station?',
  },
];

/** Sources no question is about, each there for the reason the header gives. */
const OTHER_SOURCES: ReadonlyArray<{ name: string; content: string }> = [
  {
    name: 'Delivery and returns',
    // The seed's three chunks, one paragraph each so the chunker keeps them apart.
    content: [
      'Standard delivery takes 3 to 5 working days across the EU.',
      'Returns are accepted within 30 days if the item is unused and in its original packaging.',
      'Refunds are issued to the original payment method within 5 working days of receipt.',
    ].join('\n\n'),
  },
  // Every token is a stop word or a single letter, so each chunk embeds to zero.
  { name: 'Short answers', content: 'No.\n\nIt is.\n\nI do.' },
];

/** What the skill engine asks for when a persona wants a long answer. */
const LIMIT = 3;

/** How far a score must sit from the threshold and from its neighbours. */
const ROUNDING_CLEARANCE = 0.005;

interface Ranked {
  sourceName: string;
  score: number;
}

describe('knowledge retrieval — a ready source is found on any plan (FR-MOD-06.3.3)', () => {
  let owner: PrismaClient;
  /** Runs the planner as it comes. */
  let app: PrismaClient;
  /**
   * Runs the pinned queries, on connections of its own. Prisma prepares a
   * statement per connection and Postgres caches a generic plan for it after
   * five executions — a plan that does not remember `enable_sort`. Shared
   * connections let the pinned plan leak into the unpinned test (measured: the
   * second test then ran the first one's plan), which would make "the planner's
   * own choice" a second copy of the pin.
   */
  let pinned: PrismaClient;
  let fx: Fixtures;
  let tenant: TenantContext;
  let agentId: string;
  /** The ranking exact search owes each question, keyed by the question. */
  const oracle = new Map<string, Ranked[]>();
  /** Every score the question has against every chunk, for the fixture guard. */
  const allScores = new Map<string, number[]>();

  const knowledge = new KnowledgeService();

  async function seedKnowledgeBase(key: 'a' | 'b'): Promise<string> {
    const context: TenantContext = {
      licenseId: fx[key].licenseId,
      organizationId: fx[key].organizationId,
    };
    const agent = await owner.aiAgent.create({
      data: { licenseId: context.licenseId, kind: 'ai_agent', name: 'Ada' },
      select: { id: true },
    });
    for (const { name, content } of [...PAIRS, ...OTHER_SOURCES]) {
      const source = await owner.knowledgeSource.create({
        data: { aiAgentId: agent.id, licenseId: context.licenseId, type: 'article', name, content },
        select: { id: true },
      });
      // The writer the route uses, so the chunks are exactly what production stores.
      await knowledge.index(owner as TenantClient, context, source.id, content);
    }
    return agent.id;
  }

  /**
   * Price out the explicit sort for the rest of the transaction. The penalty
   * also lifts every plan's cost past `jit_above_cost`, and compiling each query
   * costs ~100 ms without changing its answer, so JIT goes too.
   */
  async function pinIndexPlan(tx: TenantClient): Promise<void> {
    await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
    await tx.$executeRawUnsafe('SET LOCAL jit = off');
  }

  /**
   * The pair's question through `retrieve()`, as the request path runs it: the
   * `nexa_app` role, RLS on, scoped to the agent the skill belongs to.
   */
  function retrieve(question: string, pin: boolean): Promise<RetrievedChunk[]> {
    return withTenant(pin ? pinned : app, tenant, async (tx) => {
      if (pin) await pinIndexPlan(tx);
      return knowledge.retrieve(tx, tenant, question, { aiAgentId: agentId, limit: LIMIT });
    });
  }

  /** Every question whose ranking differs from exact search, with both rankings. */
  async function rankingsThatDiffer(pin: boolean) {
    const differing: Array<{ question: string; expected: string[]; got: string[] }> = [];
    for (const { question } of PAIRS) {
      const expected = oracle.get(question)!;
      const got = await retrieve(question, pin);
      const sameRanking =
        got.length === expected.length &&
        got.every(
          (hit, index) =>
            hit.sourceName === expected[index]!.sourceName &&
            Math.abs(hit.score - expected[index]!.score) < 0.001,
        );
      if (!sameRanking) {
        differing.push({
          question,
          expected: expected.map((row) => `${row.sourceName} (${row.score.toFixed(4)})`),
          got: got.map((hit) => `${hit.sourceName} (${hit.score})`),
        });
      }
    }
    return differing;
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    pinned = new PrismaClient({ datasourceUrl: APP_URL });
    fx = await seedFixtures(owner);
    tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };

    agentId = await seedKnowledgeBase('a');
    await seedKnowledgeBase('b');

    const stored = await owner.knowledgeChunk.findMany({
      where: { licenseId: fx.a.licenseId, source: { aiAgentId: agentId } },
      select: { chunkText: true, source: { select: { name: true } } },
    });
    // The knowledge base is what the fixture says it is — no silent re-chunking.
    const expectedChunks = [...PAIRS, ...OTHER_SOURCES].flatMap((s) => chunk(s.content));
    expect(stored).toHaveLength(expectedChunks.length);

    for (const { question } of PAIRS) {
      const vector = embed(question);
      const scored = stored.map((row) => ({
        sourceName: row.source.name,
        score: similarity(vector, embed(row.chunkText)),
      }));
      allScores.set(
        question,
        scored.map((row) => row.score),
      );
      oracle.set(
        question,
        scored
          .filter((row) => row.score >= RETRIEVAL_THRESHOLD)
          .sort((left, right) => right.score - left.score)
          .slice(0, LIMIT),
      );
    }
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect(), pinned.$disconnect()]);
  });

  it('holds a fixture exact search can rank without a coin toss', () => {
    for (const { name, question } of PAIRS) {
      const ranking = oracle.get(question)!;
      // Answerable, and from its own passage first.
      expect(ranking[0]?.sourceName, question).toBe(name);
      // No score close enough to the threshold, or to another, for float4 to flip.
      for (const score of allScores.get(question)!) {
        expect(Math.abs(score - RETRIEVAL_THRESHOLD), question).toBeGreaterThan(ROUNDING_CLEARANCE);
      }
      for (let i = 1; i < ranking.length; i++) {
        expect(ranking[i - 1]!.score - ranking[i]!.score, question).toBeGreaterThan(
          ROUNDING_CLEARANCE,
        );
      }
    }
    // GL-16's pair, at the similarity it was measured at, with its competitor.
    expect(oracle.get(PAIRS[0]!.question)!.map((row) => row.sourceName)).toEqual([
      'Persona proof 348166',
      'Delivery and returns',
    ]);
    expect(oracle.get(PAIRS[0]!.question)![0]!.score).toBeCloseTo(0.581, 3);
  });

  it('pins a plan that really is the vector index (premise of the next test)', async () => {
    // The shape the old query had. If a future Postgres or pgvector stops reaching
    // for the index under this setting, the pinned test goes vacuous — so say so.
    const question = PAIRS[0]!.question;
    const plan = await withTenant(pinned, tenant, async (tx) => {
      await pinIndexPlan(tx);
      return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN SELECT c.id FROM knowledge_chunks c
         JOIN knowledge_sources s ON s.id = c.source_id
         WHERE c.license_id = $2::bigint AND s.status = 'ready' AND s.ai_agent_id = $3::uuid
         ORDER BY c.embedding <=> $1::vector LIMIT 3`,
        toVectorLiteral(embed(question)),
        tenant.licenseId.toString(),
        agentId,
      );
    });
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('idx_chunks_embedding_hnsw');
  });

  it('ranks every question as exact search does, with the planner pinned on the vector index', async () => {
    expect(await rankingsThatDiffer(true)).toEqual([]);
  });

  it("ranks every question as exact search does on the planner's own choice", async () => {
    expect(await rankingsThatDiffer(false)).toEqual([]);
  });
});
