/**
 * What an erasure and the retention sweep used to leave behind (tm 423 ·
 * tm 424 · NFR-C8 · GDPR Art. 17).
 *
 *   1. **The files.** Erasing a customer deleted every row that named their
 *      uploads and e-mailed files and none of the files — and since the store
 *      is only ever reached through those rows, nothing would delete them
 *      afterwards. Now the files go after the commit, the receipt counts them,
 *      a store outage queues them for the next retention pass, and two guards
 *      keep other people's files: another workspace's key is never deleted,
 *      and neither is a file another conversation still shows.
 *   2. **The AI run logs.** `skill_runs` is `SET NULL` on chat and thread, so
 *      the run outlived the conversation with the player's words in its log.
 *      Now the text is cleared — with the thread in the sweep, by age for a run
 *      with no thread, and before the chats go in an erasure — and the row
 *      stays as a usage count.
 *
 * Every assertion reads the store and the database, never only the response.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KNOWLEDGE_DOCUMENT_PDF, buildEventId, generateShortId } from '@siyahtus/types';
import type { RetentionPolicy } from '../../src/services/retention/policy.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import { LocalStore } from '../../src/services/storage/local-store.js';
import type { ObjectStore } from '../../src/services/storage/object-store.js';
import { StorageUnavailableError } from '../../src/services/storage/storage-error.js';
import {
  buildKey,
  buildKnowledgeKey,
  buildMailKey,
  UPLOAD_PATH_PREFIX,
} from '../../src/services/storage/upload-url.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const POLICY: RetentionPolicy = { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 };
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

interface Receipt {
  chats: number;
  files_deleted: number;
  files_pending: number;
  skill_run_logs: number;
}

describe('erasure and retention leave no files or run logs behind (tm 423 · tm 424)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let storageDir: string;
  let store: LocalStore;
  let eraseToken: string;

  beforeAll(async () => {
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-erasure-files-'));
    store = new LocalStore(storageDir);
    server = await startTestServer({ STORAGE_PROVIDER: 'local', STORAGE_LOCAL_DIR: storageDir });
  });

  afterAll(async () => {
    await server.close();
    await appRole.$disconnect();
    await owner.$disconnect();
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    eraseToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers.erase:rw'],
    });
  });

  const erase = (customerId: string, on: TestServer = server) =>
    on.post(`/customers/${customerId}/erase`, undefined, {
      authorization: `Bearer ${eraseToken}`,
    });

  const runner = (fileStore: ObjectStore = store) =>
    new RetentionRunner(appRole, {
      policy: POLICY,
      mailDir: join(storageDir, 'no-mail'),
      auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
      store: fileStore,
    });

  const mine = (report: { tenants: Array<{ licenseId: string }> }, t: TenantFixture) =>
    report.tenants.find((tenant) => tenant.licenseId === String(t.licenseId)) as
      { erasedFiles: number; skillRunLogs: number; threads: number } | undefined;

  /** A file in the store, under a key of `kind`'s shape for `t`'s licence. */
  async function storedFile(t: TenantFixture, kind: 'upload' | 'mail' | 'knowledge') {
    const key =
      kind === 'upload'
        ? buildKey(t.licenseId, 'image/png')
        : kind === 'mail'
          ? buildMailKey(t.licenseId, 'image/jpeg')
          : buildKnowledgeKey(t.licenseId, KNOWLEDGE_DOCUMENT_PDF);
    await store.put(key, PNG, kind === 'knowledge' ? KNOWLEDGE_DOCUMENT_PDF : 'image/png');
    return key;
  }

  async function newCustomer(t: TenantFixture, name: string): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name, email: `${name}-${Date.now()}@example.test` },
      select: { id: true },
    });
    return customer.id;
  }

  /** A closed conversation for `customerId`, one message per attachment URL (or one plain one). */
  async function conversation(
    t: TenantFixture,
    customerId: string,
    attachmentUrls: string[] = [],
    closedAt: Date = new Date(),
  ): Promise<{ chatId: string; threadId: string }> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId, active: false, createdAt: closedAt },
    });
    const threadId = generateShortId();
    const messages = attachmentUrls.length > 0 ? attachmentUrls : [null];
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: false,
        closedAt,
        createdAt: closedAt,
        eventSequence: messages.length,
      },
    });
    await owner.event.createMany({
      data: messages.map((url, i) => ({
        id: buildEventId(threadId, i + 1),
        threadId,
        chatId,
        licenseId: t.licenseId,
        type: url ? 'file' : 'message',
        text: url ? null : 'my passport number is in the photo',
        authorType: 'customer',
        authorId: customerId,
        ...(url ? { attachmentUrl: url } : {}),
      })),
    });
    return { chatId, threadId };
  }

  /** A ticket for `customerId` with one e-mailed message carrying `attachments`. */
  async function ticketWith(
    t: TenantFixture,
    customerId: string,
    attachments: Array<{ key: string; purged?: boolean }>,
  ): Promise<string> {
    const ticketId = generateShortId();
    await owner.ticket.create({
      data: { id: ticketId, licenseId: t.licenseId, customerId, subject: 'My documents' },
    });
    await owner.ticketMessage.create({
      data: {
        licenseId: t.licenseId,
        ticketId,
        kind: 'customer_message',
        authorType: 'customer',
        authorId: customerId,
        bodyText: 'Here is my ID card.',
        attachments: attachments.map(({ key, purged }) => ({
          key,
          name: 'kimlik.jpg',
          size: PNG.length,
          mime: 'image/jpeg',
          scan_status: 'clean',
          sensitive: true,
          ...(purged ? { purged: true } : {}),
        })),
      },
    });
    return ticketId;
  }

  const url = (key: string) => `${UPLOAD_PATH_PREFIX}${key}`;
  const pending = (t: TenantFixture) =>
    owner.pendingFileDeletion.findMany({
      where: { licenseId: t.licenseId },
      select: { key: true },
      orderBy: { key: 'asc' },
    });

  // ==========================================================================
  // Part 1 — the files (tm 423)
  // ==========================================================================

  describe('an erasure deletes the files its conversations and tickets carried', () => {
    it('deletes a chat upload and an e-mailed file, counts them, and leaves nothing queued (NFR-C8)', async () => {
      const subject = await newCustomer(fx.a, 'subject');
      const upload = await storedFile(fx.a, 'upload');
      const emailed = await storedFile(fx.a, 'mail');
      // Purged by the sensitive-file sweep already: its bytes are gone, and
      // it is not counted as deleted by this erasure.
      const purged = buildMailKey(fx.a.licenseId, 'image/jpeg');
      const knowledge = await storedFile(fx.a, 'knowledge');
      await conversation(fx.a, subject, [url(upload)]);
      await ticketWith(fx.a, subject, [{ key: emailed }, { key: purged, purged: true }]);

      const res = await erase(subject);

      expect(res.statusCode, res.body).toBe(200);
      const receipt = res.json<Receipt>();
      expect(receipt).toMatchObject({ chats: 1, files_deleted: 2, files_pending: 0 });
      expect(await store.exists(upload)).toBe(false);
      expect(await store.exists(emailed)).toBe(false);
      // A knowledge document is the workspace's, not the customer's.
      expect(await store.exists(knowledge)).toBe(true);
      expect(await pending(fx.a)).toEqual([]);

      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'data.subject_erased' },
      });
      expect(entry.metadata).toMatchObject({ files: 2 });
      // The count, never the keys.
      expect(JSON.stringify(entry.metadata)).not.toContain(upload);
    });

    it('never deletes another workspace’s file, even when a row in this one names it', async () => {
      const subject = await newCustomer(fx.a, 'planted');
      const theirUpload = await storedFile(fx.b, 'upload');
      const theirEmailed = await storedFile(fx.b, 'mail');
      // Planted as the owner, past every API check that would refuse it.
      await conversation(fx.a, subject, [url(theirUpload)]);
      await ticketWith(fx.a, subject, [{ key: theirEmailed }]);

      const res = await erase(subject);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<Receipt>()).toMatchObject({ files_deleted: 0, files_pending: 0 });
      expect(await store.exists(theirUpload)).toBe(true);
      expect(await store.exists(theirEmailed)).toBe(true);
      expect(await pending(fx.a)).toEqual([]);
    });

    it('cannot queue a key that is not this workspace’s upload or e-mailed file', async () => {
      // The table repeats the rule as a CHECK, so not even the owner role can
      // put another workspace's file — or a knowledge document — in the queue.
      const foreign = buildKey(fx.b.licenseId, 'image/png');
      const knowledge = buildKnowledgeKey(fx.a.licenseId, KNOWLEDGE_DOCUMENT_PDF);
      for (const key of [foreign, knowledge, '../etc/passwd']) {
        await expect(
          owner.pendingFileDeletion.create({ data: { licenseId: fx.a.licenseId, key } }),
        ).rejects.toThrow(/pending_file_deletions_key_check/);
      }
      await expect(
        owner.pendingFileDeletion.create({
          data: { licenseId: fx.a.licenseId, key: buildMailKey(fx.a.licenseId, 'image/png') },
        }),
      ).resolves.toBeTruthy();
    });

    it('keeps a file another conversation or ticket still shows', async () => {
      const subject = await newCustomer(fx.a, 'shared');
      const neighbour = await newCustomer(fx.a, 'neighbour');
      const brochure = await storedFile(fx.a, 'upload');
      const ticketCopy = await storedFile(fx.a, 'upload');
      const own = await storedFile(fx.a, 'upload');
      // An agent sent the same brochure to two people, and attached another
      // file to both their tickets.
      await conversation(fx.a, subject, [url(brochure), url(own)]);
      await conversation(fx.a, neighbour, [url(brochure)]);
      await ticketWith(fx.a, subject, [{ key: ticketCopy }]);
      await ticketWith(fx.a, neighbour, [{ key: ticketCopy }]);

      const res = await erase(subject);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<Receipt>()).toMatchObject({ files_deleted: 1, files_pending: 0 });
      expect(await store.exists(own)).toBe(false);
      expect(await store.exists(brochure)).toBe(true);
      expect(await store.exists(ticketCopy)).toBe(true);
    });
  });

  describe('a store that will not delete at the time of the erasure', () => {
    let failing: TestServer;
    let refusals = 0;

    /** The real store, except that every delete fails the way an unreachable bucket does. */
    const broken: ObjectStore = {
      put: (key, bytes, type) => store.put(key, bytes, type),
      get: (key) => store.get(key),
      exists: (key) => store.exists(key),
      stat: (key) => store.stat(key),
      delete: () => {
        refusals += 1;
        return Promise.reject(new StorageUnavailableError('bucket down'));
      },
      listKnowledge: (license) => store.listKnowledge(license),
    };

    beforeAll(async () => {
      failing = await startTestServer(
        { STORAGE_PROVIDER: 'local', STORAGE_LOCAL_DIR: storageDir },
        { erasureStore: broken },
      );
    });

    afterAll(async () => {
      await failing.close();
    });

    it('still erases and answers 200, queues the files, and the next retention pass deletes them', async () => {
      const subject = await newCustomer(fx.a, 'outage');
      const upload = await storedFile(fx.a, 'upload');
      const emailed = await storedFile(fx.a, 'mail');
      await conversation(fx.a, subject, [url(upload)]);
      await ticketWith(fx.a, subject, [{ key: emailed }]);
      refusals = 0;

      const res = await erase(subject, failing);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<Receipt>()).toMatchObject({ files_deleted: 0, files_pending: 2 });
      // One refusal stops the pass: a store that is down is not asked twice.
      expect(refusals).toBe(1);
      expect(await owner.customer.count({ where: { id: subject } })).toBe(0);
      expect(await store.exists(upload)).toBe(true);
      expect(await store.exists(emailed)).toBe(true);
      expect((await pending(fx.a)).map((row) => row.key)).toEqual([upload, emailed].sort());

      // Still down at the sweep: the step stops, the debt stays, the sweep runs.
      const stillDown = await runner(broken).run({ dryRun: false });
      expect(mine(stillDown, fx.a)?.erasedFiles).toBe(0);
      expect(await pending(fx.a)).toHaveLength(2);

      const preview = await runner().run({ dryRun: true });
      expect(mine(preview, fx.a)?.erasedFiles).toBe(2);
      expect(await store.exists(upload)).toBe(true);

      const report = await runner().run({ dryRun: false });
      expect(mine(report, fx.a)?.erasedFiles).toBe(2);
      expect(report.totals.erasedFiles).toBe(2);
      expect(await store.exists(upload)).toBe(false);
      expect(await store.exists(emailed)).toBe(false);
      expect(await pending(fx.a)).toEqual([]);
      const swept = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'data.retention_pruned' },
      });
      expect(swept).toHaveLength(1);
      expect(swept[0]!.metadata).toMatchObject({ erased_files: 2 });

      // Nothing left to do.
      expect(mine(await runner().run({ dryRun: false }), fx.a)?.erasedFiles).toBe(0);
    });
  });

  // ==========================================================================
  // Part 2 — the AI run logs (tm 424)
  // ==========================================================================

  describe('skill run logs lose the player’s words with the conversation', () => {
    const QUOTE = 'the player wrote: my card ends in 4242 and I live at 5 Elm Street';
    const envelope = (outcome: string) => ({
      outcome,
      entries: [{ step: 'answer', detail: QUOTE, ok: true }],
    });

    async function skill(t: TenantFixture): Promise<string> {
      const row = await owner.skill.create({
        data: { licenseId: t.licenseId, name: 'Refunds', kind: 'ai_agent' },
        select: { id: true },
      });
      return row.id;
    }

    async function run(
      t: TenantFixture,
      skillId: string,
      at: { chatId?: string; threadId?: string; ranAt?: Date },
      log: object = envelope('answered'),
    ): Promise<string> {
      const row = await owner.skillRun.create({
        data: {
          skillId,
          licenseId: t.licenseId,
          chatId: at.chatId ?? null,
          threadId: at.threadId ?? null,
          ranAt: at.ranAt ?? new Date(),
          log,
          llmInputTokens: 120,
        },
        select: { id: true },
      });
      return row.id;
    }

    const readRun = (id: string) =>
      owner.skillRun.findUnique({
        where: { id },
        select: { log: true, chatId: true, threadId: true, llmInputTokens: true },
      });

    it('the sweep clears a run on an expired thread with it, and a run with no thread by age (NFR-C8)', async () => {
      const skillId = await skill(fx.a);
      const expired = await conversation(fx.a, fx.a.customerId, [], daysAgo(400));
      const recent = await conversation(fx.a, fx.a.customerId, [], daysAgo(10));
      const onExpired = await run(fx.a, skillId, { ...expired, ranAt: daysAgo(400) });
      const onRecent = await run(fx.a, skillId, { ...recent, ranAt: daysAgo(10) });
      // A Copilot assist records the chat only; a run from before the
      // envelope is a plain array.
      const oldCopilot = await run(
        fx.a,
        skillId,
        { chatId: recent.chatId, ranAt: daysAgo(400) },
        envelope('copilot_summary'),
      );
      const oldLegacy = await run(fx.a, skillId, { ranAt: daysAgo(500) }, [
        { step: 'answer', detail: QUOTE, ok: true },
      ]);
      const newCopilot = await run(
        fx.a,
        skillId,
        { chatId: recent.chatId, ranAt: daysAgo(10) },
        envelope('copilot_summary'),
      );
      const before = await owner.skillRun.count({ where: { licenseId: fx.a.licenseId } });

      const preview = await runner().run({ dryRun: true });
      expect(mine(preview, fx.a)?.skillRunLogs).toBe(2);
      expect(JSON.stringify((await readRun(onExpired))!.log)).toContain(QUOTE);

      const report = await runner().run({ dryRun: false });

      expect(mine(report, fx.a)).toMatchObject({ threads: 1, skillRunLogs: 2 });
      expect(await owner.thread.count({ where: { id: expired.threadId } })).toBe(0);
      // The rows stay — they are usage counts — with the outcome and no words.
      expect(await owner.skillRun.count({ where: { licenseId: fx.a.licenseId } })).toBe(before);
      expect(await readRun(onExpired)).toEqual({
        log: { outcome: 'answered', entries: [] },
        chatId: expired.chatId,
        threadId: null,
        llmInputTokens: 120,
      });
      expect((await readRun(oldCopilot))!.log).toEqual({
        outcome: 'copilot_summary',
        entries: [],
      });
      expect((await readRun(oldLegacy))!.log).toEqual([]);
      // Inside the window: untouched.
      expect((await readRun(onRecent))!.log).toEqual(envelope('answered'));
      expect((await readRun(newCopilot))!.log).toEqual(envelope('copilot_summary'));
      const swept = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'data.retention_pruned' },
      });
      expect(swept.metadata).toMatchObject({ threads: 1, skill_run_logs: 2 });

      // Idempotent: a cleared log is not cleared again.
      expect(mine(await runner().run({ dryRun: false }), fx.a)?.skillRunLogs).toBe(0);
    });

    it('an erasure clears the logs on the subject’s conversations, not another customer’s', async () => {
      const skillId = await skill(fx.a);
      const subject = await newCustomer(fx.a, 'runs');
      const theirs = await conversation(fx.a, subject);
      const other = await conversation(fx.a, fx.a.customerId);
      const onThread = await run(fx.a, skillId, theirs);
      const copilot = await run(
        fx.a,
        skillId,
        { chatId: theirs.chatId },
        envelope('copilot_summary'),
      );
      const untouched = await run(fx.a, skillId, other);
      const elsewhereSkill = await skill(fx.b);
      const otherTenant = await run(
        fx.b,
        elsewhereSkill,
        await conversation(fx.b, fx.b.customerId),
      );

      const res = await erase(subject);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<Receipt>().skill_run_logs).toBe(2);
      expect(await readRun(onThread)).toEqual({
        log: { outcome: 'answered', entries: [] },
        chatId: null,
        threadId: null,
        llmInputTokens: 120,
      });
      expect((await readRun(copilot))!.log).toEqual({ outcome: 'copilot_summary', entries: [] });
      expect((await readRun(untouched))!.log).toEqual(envelope('answered'));
      expect((await readRun(otherTenant))!.log).toEqual(envelope('answered'));
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'data.subject_erased' },
      });
      expect(entry.metadata).toMatchObject({ skill_run_logs: 2 });
    });
  });
});
