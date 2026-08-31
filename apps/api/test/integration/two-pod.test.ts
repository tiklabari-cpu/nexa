/**
 * The fleet, measured for the first time (M-SCALE-a · NFR-R1).
 *
 * NFR-R1 asks for horizontal scale, and the code was written for it: the
 * scheduler takes a Redis leader lock before every sweep (`scheduler/lock.ts`),
 * fan-out goes through Redis pub/sub rather than through a process-local
 * registry (`apps/rtm/src/fanout.ts`), and both services are stateless by
 * intent. None of that had ever been *run* as more than one process. Every
 * suite in this repository — including the two-instance half of
 * `scheduler-e2e.test.ts` — builds its servers inside the test process, where
 * two "instances" share one event loop and cannot actually act at the same
 * instant, and where two gateway objects share one heap.
 *
 * So this file boots the real entrypoints as four separate OS processes — two
 * `apps/api/src/index.ts`, two `apps/rtm/src/index.ts`, the same files the
 * Dockerfile runs — and speaks to them only over HTTP and WebSocket
 * (`test/helpers/pods.ts` for how, and for why the children share this run's
 * isolated datastores instead of getting their own).
 *
 * Four questions, and each one has a decision hanging off it:
 *
 *   1. **Fan-out.** Does an agent holding a socket on rtm-A receive an event
 *      that was posted through api-B? This is the whole promise of the pub/sub
 *      design and the one thing a single process structurally cannot show:
 *      today's fan-out tests publish envelopes onto the bus by hand, so the
 *      seam between the API's publisher and the gateway's subscriber has never
 *      carried a real message at all, let alone across a process boundary.
 *   2. **Scheduler leadership.** With two API processes up, how many times does
 *      one interval sweep? "Twice" means retention deleting the same rows twice
 *      and two copies of a scheduled report in a customer's mailbox.
 *   3. **Sticky sessions.** If an agent's socket lands on rtm-A while their REST
 *      calls go to api-B, does anything break? A "yes" here is not a defect —
 *      it is a *requirement*, and it would have to be written into the
 *      deployment manifests M-IAC (tm 164) produces as session affinity.
 *   4. **Uploaded bytes.** An attachment PUT to api-A — can api-B serve it, and
 *      does api-B accept an event that points at it? This one is not a question
 *      about a mechanism that was written and never run; it is a defect that
 *      was found (audit D6) and fixed with the `s3` provider (M-STORE-a), and
 *      §3 below is where the fix stops being an argument and becomes a
 *      measurement — with the broken arrangement kept alongside it as the
 *      control, because a passing test whose failing case was never run is not
 *      evidence of anything.
 *
 * The answers are recorded in PLAN §D136 either way.
 *
 * What this is not: a load test (that is M-LOAD, tm 161) and not a deployment.
 * Four processes on one loopback interface is the smallest arrangement in which
 * "more than one of us" is a true statement, and truth is the whole point.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { PodSocket } from '../helpers/pod-socket.js';
import {
  podGet,
  podRequest,
  reserveFreePorts,
  startApiPod,
  startRtmPod,
  stopPods,
  type Pod,
} from '../helpers/pods.js';
import { startFakeBucket, type FakeBucket } from '../helpers/s3-bucket.js';

/** Booting four child processes from cold is the slow part, not the tests. */
const BOOT_TIMEOUT_MS = 180_000;

/** Everything the fleet's sockets subscribe to. */
const AGENT_PUSHES = [
  'incoming_chat',
  'incoming_event',
  'routing_status_set',
  'agent_conflict_warning',
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Long enough that "it did not arrive" means it is not coming.
 *
 * Every positive assertion in this file waits on the message itself, so this is
 * used only where the claim is a negative — and there the number has to be
 * generous, because a short one turns "the licence boundary held" into "the
 * machine was busy".
 */
const SETTLE_MS = 1_000;

interface Conversation {
  chatId: string;
  threadId: string;
  eventCount: number;
}

/**
 * A chat both agents are personally in, seeded straight into Postgres.
 *
 * Through the API this would take a routing decision, a queue and an
 * assignment; none of that is what is under test here, and a fixture that went
 * through them would make a fan-out failure look like a routing failure. What
 * matters downstream is only the shape `#audienceFor` reads: the teams the chat
 * is routed to and the agents personally in it.
 */
async function createConversation(
  db: PrismaClient,
  tenant: TenantFixture,
  input: { groupId: bigint; agentIds: string[]; messages?: string[] },
): Promise<Conversation> {
  const chatId = generateShortId();
  const threadId = generateShortId();

  await db.chat.create({
    data: { id: chatId, licenseId: tenant.licenseId, customerId: tenant.customerId, active: true },
  });
  await db.chatAccess.create({ data: { chatId, groupId: input.groupId } });
  await db.chatUser.create({
    data: { chatId, userId: tenant.customerId, userType: 'customer', present: true },
  });
  for (const agentId of input.agentIds) {
    await db.chatUser.create({
      data: { chatId, userId: agentId, userType: 'agent', present: true },
    });
  }
  await db.thread.create({
    data: { id: threadId, chatId, licenseId: tenant.licenseId, active: true },
  });

  const messages = input.messages ?? [];
  for (const [index, text] of messages.entries()) {
    await db.event.create({
      data: {
        id: `${threadId}_${index + 1}`,
        threadId,
        chatId,
        licenseId: tenant.licenseId,
        type: 'message',
        text,
        authorType: 'customer',
        recipients: 'all',
      },
    });
  }
  if (messages.length > 0) {
    await db.thread.update({ where: { id: threadId }, data: { eventSequence: messages.length } });
  }

  return { chatId, threadId, eventCount: messages.length };
}

/** A team, so the chat carries a `groupIds` audience as well as an agent one. */
async function createGroup(
  db: PrismaClient,
  tenant: TenantFixture,
  agentIds: string[],
): Promise<bigint> {
  const group = await db.group.create({
    data: { licenseId: tenant.licenseId, name: 'Support' },
    select: { id: true },
  });
  await db.groupAgent.createMany({
    data: agentIds.map((agentId) => ({
      licenseId: tenant.licenseId,
      groupId: group.id,
      agentId,
      priority: 'normal',
    })),
  });
  return group.id;
}

// ===========================================================================
// 1 · One Redis, two gateways, two APIs
// ===========================================================================

describe('a four-process fleet sharing one Postgres and one Redis', () => {
  let db: PrismaClient;
  let apiA: Pod;
  let apiB: Pod;
  let rtmA: Pod;
  let rtmB: Pod;
  let pods: Pod[] = [];

  let fx: Fixtures;
  let groupId: bigint;
  let conversation: Conversation;
  /** Unrestricted, and the identity every REST write in this block is made as. */
  let ownerToken: string;
  let agentToken: string;
  let outsiderToken: string;

  const sockets: PodSocket[] = [];

  /** Connect to a gateway and log in, subscribed to the pushes above. */
  async function login(pod: Pod, tenant: TenantFixture, token: string): Promise<PodSocket> {
    const socket = await PodSocket.connect(pod, { organizationId: tenant.organizationId });
    sockets.push(socket);
    const response = await socket.request('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': AGENT_PUSHES },
    });
    expect(response.success, `${pod.name} login: ${JSON.stringify(response.payload)}`).toBe(true);
    return socket;
  }

  beforeAll(async () => {
    db = ownerClient();
    fx = await seedFixtures(db);
    groupId = await createGroup(db, fx.a, [fx.a.ownerAccountId, fx.a.agentAccountId]);
    conversation = await createConversation(db, fx.a, {
      groupId,
      agentIds: [fx.a.ownerAccountId, fx.a.agentAccountId],
      messages: ['hello from the customer'],
    });

    ownerToken = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:ro'],
    });
    agentToken = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw', 'agents--my:rw', 'agents--all:ro'],
    });
    outsiderToken = await grantToken(db, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.agentAccountId,
      scopes: ['chats--all:rw'],
    });

    const [portApiA, portApiB, portRtmA, portRtmB] = (await reserveFreePorts(4)) as [
      number,
      number,
      number,
      number,
    ];
    [apiA, apiB, rtmA, rtmB] = await Promise.all([
      startApiPod('api-a', portApiA),
      startApiPod('api-b', portApiB),
      startRtmPod('rtm-a', portRtmA),
      startRtmPod('rtm-b', portRtmB),
    ]);
    pods = [apiA, apiB, rtmA, rtmB];
  }, BOOT_TIMEOUT_MS);

  // Sockets are closed between tests rather than at the end: a socket left over
  // from an earlier test is still subscribed, still in the audience, and would
  // quietly widen every assertion after it.
  afterEach(() => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await stopPods(pods);
    await db.$disconnect();
  }, BOOT_TIMEOUT_MS);

  // -------------------------------------------------------------------------
  // Question 1 — does fan-out cross the pod boundary?
  // -------------------------------------------------------------------------

  describe('fan-out', () => {
    it('is genuinely two gateways — each registry holds only its own socket', async () => {
      // Without this the rest of the block would be a construction argument:
      // "they must be separate, we spawned two". `connections` is
      // `registry.size`, and the registry is process-local by definition, so
      // one apiece is the fleet saying so itself. Two sockets on one gateway —
      // the shape an accidentally-shared pod would have — reads 2 and 0.
      await login(rtmA, fx.a, agentToken);
      await login(rtmB, fx.a, ownerToken);

      const [healthA, healthB] = await Promise.all([
        podGet(rtmA, '/health', { token: ownerToken }),
        podGet(rtmB, '/health', { token: ownerToken }),
      ]);

      for (const [pod, health] of [
        [rtmA, healthA],
        [rtmB, healthB],
      ] as const) {
        const body = health.body as { service?: string; connections?: number };
        expect(body.service, `${pod.name}: ${JSON.stringify(body)}`).toBe('rtm');
        expect(body.connections, pod.name).toBe(1);
      }
    });

    it('delivers one API write to sockets on both gateways, whichever API took it', async () => {
      const onA = await login(rtmA, fx.a, agentToken);
      const onB = await login(rtmB, fx.a, ownerToken);

      // Through api-B, read on rtm-A: neither process has ever seen the other,
      // and the only thing between them is the licence channel on Redis.
      const viaB = await podRequest(apiB, 'POST', `/chats/${conversation.chatId}/events`, {
        token: ownerToken,
        body: { type: 'message', text: 'posted through api-b' },
      });
      expect(viaB.status, JSON.stringify(viaB.body)).toBe(201);

      const [pushOnA, pushOnB] = await Promise.all([
        onA.waitForPush('incoming_event'),
        onB.waitForPush('incoming_event'),
      ]);
      for (const frame of [pushOnA, pushOnB]) {
        const event = frame.payload['event'] as { text: string };
        expect(frame.payload['chat_id']).toBe(conversation.chatId);
        expect(event.text).toBe('posted through api-b');
      }

      // The other direction, so the result is a property of the fleet rather
      // than of whichever process happened to be the publisher.
      const viaA = await podRequest(apiA, 'POST', `/chats/${conversation.chatId}/events`, {
        token: ownerToken,
        body: { type: 'message', text: 'posted through api-a' },
      });
      expect(viaA.status, JSON.stringify(viaA.body)).toBe(201);

      await Promise.all([
        onA.waitFor(
          (frame) =>
            frame.type === 'push' &&
            frame.action === 'incoming_event' &&
            (frame.payload['event'] as { text?: string }).text === 'posted through api-a',
        ),
        onB.waitFor(
          (frame) =>
            frame.type === 'push' &&
            frame.action === 'incoming_event' &&
            (frame.payload['event'] as { text?: string }).text === 'posted through api-a',
        ),
      ]);
    });

    it('keeps the licence boundary across pods — a foreign tenant on rtm-A hears nothing', async () => {
      const insider = await login(rtmA, fx.a, agentToken);
      const outsider = await login(rtmB, fx.b, outsiderToken);

      const posted = await podRequest(apiB, 'POST', `/chats/${conversation.chatId}/events`, {
        token: ownerToken,
        body: { type: 'message', text: 'tenant A only' },
      });
      expect(posted.status, JSON.stringify(posted.body)).toBe(201);

      // Wait for the message to have been delivered *somewhere* before
      // concluding it was not delivered here — otherwise this passes on any
      // machine slow enough.
      await insider.waitForPush('incoming_event');
      await sleep(SETTLE_MS);

      expect(outsider.pushes('incoming_event')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Question 3 — is a sticky session required?
  // -------------------------------------------------------------------------

  describe('an agent whose socket and REST calls land on different pods', () => {
    it('shares the read cursor: seen marked on api-B clears the badge read from api-A', async () => {
      const before = await podRequest(apiA, 'GET', '/chats', { token: agentToken });
      expect(before.status).toBe(200);
      const unreadBefore = (before.body as { items: Array<{ id: string; unread_count: number }> })
        .items;
      expect(unreadBefore.find((chat) => chat.id === conversation.chatId)?.unread_count).toBe(1);

      const seen = await podRequest(apiB, 'POST', `/chats/${conversation.chatId}/seen`, {
        token: agentToken,
        body: { seen_up_to: new Date(Date.now() + 1_000).toISOString() },
      });
      expect(seen.status, JSON.stringify(seen.body)).toBe(204);

      const after = await podRequest(apiA, 'GET', '/chats', { token: agentToken });
      const unreadAfter = (after.body as { items: Array<{ id: string; unread_count: number }> })
        .items;
      expect(unreadAfter.find((chat) => chat.id === conversation.chatId)?.unread_count).toBe(0);
    });

    it('shares presence: a status set on api-B is read back from api-A and pushed to rtm-A', async () => {
      const socket = await login(rtmA, fx.a, agentToken);

      const set = await podRequest(apiB, 'PUT', '/agents/me/routing-status', {
        token: agentToken,
        body: { routing_status: 'not_accepting_chats' },
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);

      const push = await socket.waitForPush('routing_status_set');
      expect(push.payload['agent_id']).toBe(fx.a.agentAccountId);
      expect(push.payload['status']).toBe('not_accepting_chats');

      const listed = await podRequest(apiA, 'GET', '/agents?status=all', { token: agentToken });
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const agents = (listed.body as { items: Array<{ id: string; routing_status: string }> })
        .items;
      expect(agents.find((agent) => agent.id === fx.a.agentAccountId)?.routing_status).toBe(
        'not_accepting_chats',
      );

      // Put it back: the next block's fixtures are cheaper if nobody is away.
      await podRequest(apiB, 'PUT', '/agents/me/routing-status', {
        token: agentToken,
        body: { routing_status: 'accepting_chats' },
      });
    });

    it('detects a composing conflict between two agents on different gateways', async () => {
      // The hardest of the three for a split fleet: the composer registry is a
      // Redis sorted set written by two gateways, the warning is published by
      // whichever gateway saw the second agent, and it has to be fanned out by
      // the *other* one to reach the first agent.
      const first = await login(rtmA, fx.a, agentToken);
      const second = await login(rtmB, fx.a, ownerToken);

      const typingOnA = await first.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      expect(typingOnA.success, JSON.stringify(typingOnA.payload)).toBe(true);

      const typingOnB = await second.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      expect(typingOnB.success, JSON.stringify(typingOnB.payload)).toBe(true);

      const [warnedOnA, warnedOnB] = await Promise.all([
        first.waitForPush('agent_conflict_warning'),
        second.waitForPush('agent_conflict_warning'),
      ]);

      for (const frame of [warnedOnA, warnedOnB]) {
        expect(frame.payload['chat_id']).toBe(conversation.chatId);
        const agents = frame.payload['agents'] as Array<{ agent_id: string }>;
        expect(agents.map((agent) => agent.agent_id).sort()).toEqual(
          [fx.a.agentAccountId, fx.a.ownerAccountId].sort(),
        );
      }
    });
  });
});

// ===========================================================================
// 2 · Two API processes, one interval
// ===========================================================================

/**
 * The leader lock, across a real process boundary.
 *
 * `scheduler-e2e.test.ts` already asserts `['ok', 'skipped']` for two servers —
 * but both of them are objects in the test's own process, so their timers can
 * never fire at the same instant and Node's event loop serialises the two
 * `SET NX` calls for free. That is the one arrangement in which a *broken* lock
 * would still look correct. Two processes have two event loops and two Redis
 * connections, and the only thing ordering them is Redis itself.
 *
 * Retention, SIEM and scheduled reports are parked at an interval nothing in
 * this file can reach: they write to disk, send mail and delete rows, and the
 * question here is who was allowed to run, not what a sweep does.
 */
describe('two API processes sharing one Redis leader lock', () => {
  const TICK_MS = '1500';
  const NEVER_MS = '600000';
  /** The jobs both processes race for — all three read-only on empty fixtures. */
  const RACED = ['chat_timeout', 'sla', 'webhook_redelivery'];

  interface JobRow {
    name: string;
    enabled: boolean;
    last_run_at: string | null;
    last_status: string | null;
    last_error_class?: string;
  }
  interface HealthBody {
    status: string;
    scheduler?: { enabled: boolean; jobs: JobRow[] };
  }

  let db: PrismaClient;
  let pods: Pod[] = [];
  let adminToken: string;
  let snapshots: Array<{ enabled: boolean; jobs: JobRow[] }>;

  async function schedulerOf(pod: Pod): Promise<{ enabled: boolean; jobs: JobRow[] }> {
    const response = await podRequest(pod, 'GET', '/health', { token: adminToken });
    const body = response.body as HealthBody;
    if (!body.scheduler) {
      throw new Error(`${pod.name} gave no scheduler body: ${JSON.stringify(body)}`);
    }
    return body.scheduler;
  }

  const tickedEverything = async (pod: Pod): Promise<boolean> => {
    const scheduler = await schedulerOf(pod);
    return scheduler.jobs
      .filter((job) => RACED.includes(job.name))
      .every((job) => job.last_status !== null);
  };

  beforeAll(async () => {
    db = ownerClient();
    // No conversations and no targets: a pass then costs one enumerator query,
    // which keeps this about who was allowed to run rather than how long a
    // sweep takes. The tenants themselves are only here for the admin
    // credential `/health` wants before it will report the scheduler at all.
    const fx = await seedFixtures(db);
    adminToken = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:ro'],
    });

    const schedulerEnv: NodeJS.ProcessEnv = {
      SCHEDULER_ENABLED: 'true',
      // Jitter off so each process ticks a fixed interval after its own boot.
      // With a lock that outlives 90% of the interval, the second process's
      // first tick then lands squarely inside the first one's lock, and "did
      // the lock hold?" has a deterministic answer instead of a probability.
      SCHEDULE_JITTER_PCT: '0',
      SCHEDULE_CHAT_TIMEOUT_MS: TICK_MS,
      SCHEDULE_SLA_MS: TICK_MS,
      SCHEDULE_WEBHOOK_REDELIVERY_MS: TICK_MS,
      SCHEDULE_SIEM_MS: NEVER_MS,
      SCHEDULE_SCHEDULED_REPORTS_MS: NEVER_MS,
      SCHEDULE_RETENTION_MS: NEVER_MS,
    };

    const [portOne, portTwo] = (await reserveFreePorts(2)) as [number, number];
    // Booted together so the gap between the two `scheduler.start()` calls is
    // as small as two concurrent process boots allow — it has to be under the
    // lock's TTL (90% of 1 500 ms) for the second one to find the interval
    // taken.
    pods = await Promise.all([
      startApiPod('sched-1', portOne, schedulerEnv),
      startApiPod('sched-2', portTwo, schedulerEnv),
    ]);

    const deadline = Date.now() + 60_000;
    for (;;) {
      const ticked = await Promise.all(pods.map(tickedEverything));
      if (ticked.every(Boolean)) break;
      if (Date.now() > deadline) throw new Error('a scheduler process never ticked');
      await sleep(100);
    }
    snapshots = await Promise.all(pods.map(schedulerOf));
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await stopPods(pods);
    await db.$disconnect();
  }, BOOT_TIMEOUT_MS);

  it('runs each interval once for the fleet, not once per process', () => {
    for (const name of RACED) {
      const statuses = snapshots
        .map((snapshot) => snapshot.jobs.find((job) => job.name === name)?.last_status)
        .sort();
      // One process did the work, the other was told the interval was taken.
      // Two `ok`s would mean the fleet sweeps once per pod — two retention
      // passes over the same rows, two copies of the same report in a
      // customer's mailbox.
      expect(statuses, name).toEqual(['ok', 'skipped']);
    }
  });

  it('keeps both processes scheduled and healthy, whichever one won', () => {
    for (const snapshot of snapshots) {
      expect(snapshot.enabled).toBe(true);
      for (const name of RACED) {
        const job = snapshot.jobs.find((row) => row.name === name);
        expect(job?.last_run_at, name).not.toBeNull();
        expect(job?.last_error_class, name).toBeUndefined();
      }
    }
  });
});

// ===========================================================================
// 3 · Two API processes, one bucket — and two API processes, two disks
// ===========================================================================

/**
 * The upload defect, and its fix, both run as a fleet (M-STORE-c · NFR-R1).
 *
 * `LocalStore` writes under `STORAGE_LOCAL_DIR`, a directory inside one
 * container. The chart scales the API to four replicas
 * (`infra/helm/nexa/values.yaml`, `api.hpa.maxReplicas: 4`) and mounts no shared
 * volume, so an attachment that landed on pod A is, to pod B, a file nobody
 * uploaded — a broken image on a good day, and on a bad one a *refused message*,
 * because `attachment.ts` reads `store.exists` before it will let an
 * `attachment_url` ride on an event. That is audit finding D6, and M-STORE-a
 * answered it with the `s3` provider. Until now the answer had never been run
 * as more than one process: `s3-store.test.ts` drives a stubbed `fetch` inside
 * one heap, which is the right shape for "what does the store do with a 403"
 * and structurally cannot show "does another *process* see the object".
 *
 * So four API pods, in two pairs, doing the same three steps:
 *
 *   * `s3-a` / `s3-b` share one bucket (`helpers/s3-bucket.ts`). The property
 *     claimed: grant on one, PUT on one, GET and send from the other.
 *   * `local-a` / `local-b` are the control, and they are the reason the pair
 *     above means anything. They run the shipped default, `STORAGE_PROVIDER=local`,
 *     with **a different `STORAGE_LOCAL_DIR` each** — which is not a contrivance
 *     but the only faithful model of the deployment, where each replica's
 *     filesystem is its own. Leaving the default in place would have both
 *     children resolve `.data/uploads` against the same `apps/api` working
 *     directory, and the "broken" arrangement would pass every assertion here
 *     while remaining broken in Kubernetes. A control that cannot fail is
 *     decoration; this one is asserted to fail, in the two specific ways the
 *     bug shows up in production.
 */
describe('an attachment uploaded through one API pod and read from another', () => {
  let db: PrismaClient;
  let bucket: FakeBucket;
  /** Two pods, one shared bucket — the arrangement M-STORE-a exists to allow. */
  let s3A: Pod;
  let s3B: Pod;
  /** Two pods, a private disk each — the arrangement the chart deploys today. */
  let localA: Pod;
  let localB: Pod;
  /** A private storage root per pod — see the note in `beforeAll`. */
  let podDirs: string[] = [];
  let pods: Pod[] = [];

  let fx: Fixtures;
  let conversation: Conversation;
  let token: string;

  /**
   * A real magic number and a body no default could produce by accident.
   *
   * `application/pdf` rather than the `image/png` the other upload suites use:
   * the type has to survive the round trip through storage, and `LocalStore`
   * keeps it in a `.type` sidecar while S3 keeps it as object metadata. A type
   * that could be guessed back from the `.pdf` extension would let a provider
   * that dropped it look correct.
   */
  const FILE = Buffer.from('%PDF-1.7\n% two-pod attachment, tm 177.3\n%%EOF\n', 'utf8');
  const CONTENT_TYPE = 'application/pdf';

  /** `POST /uploads` — permission, before a byte moves. */
  async function grantUpload(pod: Pod): Promise<{ uploadUrl: string; fileUrl: string }> {
    const granted = await podRequest(pod, 'POST', '/uploads', {
      token,
      body: { content_type: CONTENT_TYPE, size_bytes: FILE.byteLength },
    });
    expect(granted.status, `${pod.name}: ${JSON.stringify(granted.body)}`).toBe(201);
    const body = granted.body as { upload_url: string; file_url: string };
    return { uploadUrl: body.upload_url, fileUrl: body.file_url };
  }

  /**
   * `PUT /uploads/:key` — the bytes, authorised by the grant's signature.
   *
   * Raw `fetch` rather than `podRequest`: the body is binary and the route is
   * public, so neither the JSON encoding nor the bearer token belongs here.
   */
  async function putBytes(pod: Pod, uploadUrl: string): Promise<number> {
    const response = await fetch(`${pod.origin}${uploadUrl}`, {
      method: 'PUT',
      headers: { 'content-type': CONTENT_TYPE },
      body: FILE,
      signal: AbortSignal.timeout(15_000),
    });
    await response.arrayBuffer();
    return response.status;
  }

  interface Download {
    status: number;
    contentType: string | null;
    disposition: string | null;
    bytes: Buffer;
  }

  /** `GET /uploads/:key` — a session, and a licence prefix that has to match. */
  async function download(pod: Pod, fileUrl: string): Promise<Download> {
    const response = await fetch(`${pod.origin}${fileUrl}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      disposition: response.headers.get('content-disposition'),
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  }

  /** Sending the attachment on an event — where `assertUploadedAttachment` runs. */
  async function sendAttachment(
    pod: Pod,
    fileUrl: string,
  ): Promise<{ status: number; body: unknown }> {
    return podRequest(pod, 'POST', `/chats/${conversation.chatId}/events`, {
      token,
      body: { type: 'message', text: 'see attached', attachment_url: fileUrl },
    });
  }

  const keyOf = (fileUrl: string): string => fileUrl.slice('/api/v1/uploads/'.length);

  beforeAll(async () => {
    db = ownerClient();
    fx = await seedFixtures(db);
    const groupId = await createGroup(db, fx.a, [fx.a.ownerAccountId]);
    conversation = await createConversation(db, fx.a, {
      groupId,
      agentIds: [fx.a.ownerAccountId],
    });
    token = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });

    bucket = await startFakeBucket();
    // One private directory per pod, the `s3` pair included.
    //
    // Giving the `s3` pods a directory looks pointless — they are not supposed
    // to touch one — and it is the single most important line in this setup. It
    // was added because a mutation exposed the alternative: with the factory's
    // `s3` branch changed to return a `LocalStore`, only *one* of these tests
    // went red. The other two passed, because both children run with `cwd`
    // `apps/api`, so the default `STORAGE_LOCAL_DIR` (`.data/uploads`) resolves
    // to the same folder for both of them and a fallback to pod-local disk is
    // invisible on one machine. Four separate roots make every pod's disk
    // private, which is what a container's filesystem is, so any accidental
    // fall-through to local storage now fails the shared-bucket block outright.
    podDirs = await Promise.all(
      ['s3-a', 's3-b', 'local-a', 'local-b'].map((name) =>
        mkdtemp(join(tmpdir(), `nexa-pod-${name}-`)),
      ),
    );

    const [portS3A, portS3B, portLocalA, portLocalB] = (await reserveFreePorts(4)) as [
      number,
      number,
      number,
      number,
    ];
    [s3A, s3B, localA, localB] = await Promise.all([
      startApiPod('s3-a', portS3A, { ...bucket.env(), STORAGE_LOCAL_DIR: podDirs[0]! }),
      startApiPod('s3-b', portS3B, { ...bucket.env(), STORAGE_LOCAL_DIR: podDirs[1]! }),
      // Explicit rather than inherited: the repo's own `.env` sets both of
      // these, and a control that silently picked up a shared directory from it
      // would pass for the wrong reason.
      startApiPod('local-a', portLocalA, {
        STORAGE_PROVIDER: 'local',
        STORAGE_LOCAL_DIR: podDirs[2]!,
      }),
      startApiPod('local-b', portLocalB, {
        STORAGE_PROVIDER: 'local',
        STORAGE_LOCAL_DIR: podDirs[3]!,
      }),
    ]);
    pods = [s3A, s3B, localA, localB];
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await stopPods(pods);
    await bucket.close();
    await Promise.all(podDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    await db.$disconnect();
  }, BOOT_TIMEOUT_MS);

  // -------------------------------------------------------------------------
  // The shared bucket — the property M-STORE-a claims
  // -------------------------------------------------------------------------

  describe('with a shared bucket', () => {
    it('serves the bytes and the content type from the pod that never saw the upload', async () => {
      const { uploadUrl, fileUrl } = await grantUpload(s3A);
      expect(await putBytes(s3A, uploadUrl), bucket.log().join('\n')).toBe(201);

      // The bucket is holding it, laid out per licence — so the bytes really
      // did leave the pod rather than merely being readable from it.
      expect(bucket.keys()).toContain(`${fx.a.licenseId}/${keyOf(fileUrl)}`);

      const served = await download(s3B, fileUrl);
      expect(served.status, bucket.log().join('\n')).toBe(200);
      expect(served.bytes.equals(FILE)).toBe(true);
      expect(served.contentType).toBe(CONTENT_TYPE);
      // The GET is the real route, not a proxy to the bucket: it is the one
      // that refuses to serve a file inline.
      expect(served.disposition).toBe('attachment');
    });

    it('accepts an event on one pod that points at bytes uploaded to the other', async () => {
      const { uploadUrl, fileUrl } = await grantUpload(s3A);
      expect(await putBytes(s3A, uploadUrl)).toBe(201);

      // `assertUploadedAttachment` running on a pod that has never held these
      // bytes — the check that turns a storage split into a refused message.
      const sent = await sendAttachment(s3B, fileUrl);
      expect(sent.status, JSON.stringify(sent.body)).toBe(201);
      expect((sent.body as { attachment_url?: string }).attachment_url).toBe(fileUrl);
    });

    it('takes the bytes on whichever pod the grant did not come from', async () => {
      // The grant is a signature over `UPLOAD_SIGNING_KEY`, which is deployment
      // configuration rather than per-process state. If a pod ever minted its
      // own, every upload behind a load balancer would fail at the PUT — and it
      // would fail one time in N, which is the hardest kind of bug to be told
      // about.
      const { uploadUrl, fileUrl } = await grantUpload(s3A);
      expect(await putBytes(s3B, uploadUrl), bucket.log().join('\n')).toBe(201);

      const served = await download(s3A, fileUrl);
      expect(served.status).toBe(200);
      expect(served.bytes.equals(FILE)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // The control — the same three steps on pod-local disk
  // -------------------------------------------------------------------------

  describe('with pod-local disk, the arrangement the chart deploys today', () => {
    it('serves the file from the pod that received it and 404s on the other', async () => {
      const { uploadUrl, fileUrl } = await grantUpload(localA);
      expect(await putBytes(localA, uploadUrl)).toBe(201);

      // Half of the control is that the upload genuinely worked: without this
      // the 404 below would be satisfied by any broken upload path at all.
      const here = await download(localA, fileUrl);
      expect(here.status).toBe(200);
      expect(here.bytes.equals(FILE)).toBe(true);
      expect(here.contentType).toBe(CONTENT_TYPE);

      // The other half. A user whose next request is balanced onto the second
      // replica is told their own attachment does not exist.
      const there = await download(localB, fileUrl);
      expect(there.status).toBe(404);
    });

    it('refuses an event on the other pod as a file the workspace never uploaded', async () => {
      const { uploadUrl, fileUrl } = await grantUpload(localA);
      expect(await putBytes(localA, uploadUrl)).toBe(201);

      const sentHere = await sendAttachment(localA, fileUrl);
      expect(sentHere.status, JSON.stringify(sentHere.body)).toBe(201);

      // The expensive half of D6, and the reason this item was not filed as a
      // cosmetic bug: the message is rejected outright, with a 400 that says
      // the caller uploaded nothing — a validation error nobody retries and no
      // alert fires on.
      const sentThere = await sendAttachment(localB, fileUrl);
      expect(sentThere.status, JSON.stringify(sentThere.body)).toBe(400);
      const error = (sentThere.body as { error: { type: string; message: string } }).error;
      expect(error.type).toBe('validation');
      expect(error.message).toContain('a file this workspace uploaded');
    });
  });
});
