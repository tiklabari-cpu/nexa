/**
 * Risk flags on the API (tm 302.2 · SiyahTuş analysis AI-27):
 *
 *   - `POST /chats/{chatId}/risk-flags` — an agent flags a conversation they
 *     may write in; the type is required, a note optional;
 *   - `DELETE /risk-flags/{flagId}` — clear one, with a reason, by the type's
 *     clearer and up (AI-27-S2); `risk_flag.cleared` in the audit log;
 *   - `GET /customers/{customerId}/risk-flags` — a player's flags: their own
 *     wherever raised, and the conversation flags of conversations the caller
 *     sees;
 *   - `GET /risk-flags` — the workspace's, filtered (reports, the archive);
 *   - `GET`/`PUT /risk-flags/settings` — the Responsible Gaming team, the
 *     addresses an urgent flag is mailed to and which flags keep a player from
 *     campaigns (EN-01 · tm 350: the locked four always, fraud and a formal
 *     complaint as the workspace says; admin and up).
 *
 * Everyone who sees a conversation sees its flags' types; the note, the
 * evidence and the clear reason only the Responsible Gaming team and a Team
 * Lead and up (`riskFlagDetailsVisible`). A raise or a clear is announced once
 * committed (`RiskFlagAnnouncer`: push, webhook, urgent mail).
 */
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  PROMO_FLAG_LOCKED_REASON,
  PROMO_FLAG_NOT_CONFIGURABLE_REASON,
  RISK_FLAG_CLEAR_REASON_MAX,
  RISK_FLAG_EVIDENCE_MAX,
  RISK_FLAG_NOTE_MAX,
  RISK_FLAG_NOTIFY_EMAILS_MAX,
  RISK_FLAG_SEVERITIES,
  RISK_FLAG_SOURCES,
  RISK_FLAG_STATUSES,
  RISK_FLAG_TYPES,
  isLockedPromoFlag,
  isPromoPolicyFlag,
  isRiskFlagType,
  isShortId,
  type PromoPolicy,
  type RiskFlagType,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { highRiskReason, reasonMetadata } from '../lib/high-risk-reason.js';
import type { TenantClient } from '../lib/tenant.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { seesPlayerContact } from '../services/customers/player-contact.js';
import {
  canSeeChat,
  chatVisibilityFilter,
  resolveVisibility,
  type ChatVisibility,
} from '../services/chat/access.js';
import {
  clearRiskFlag,
  raiseRiskFlag,
  readRiskFlagSettings,
  riskFlagDetailsVisible,
  riskFlagVisibilityWhere,
  serialiseRiskFlag,
} from '../services/risk/risk-flags.js';
import { promoSuppressionOf, readPromoPolicy } from '../services/risk/promo-suppression.js';

const CHAT_WRITE = ['chats--all:rw', 'chats--access:rw'];
const CHAT_READ = ['chats--all:ro', 'chats--access:ro'];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const chatIdSchema = z.string().refine(isShortId, 'not a valid chat id');
const uuid = z.string().uuid();

const raiseBody = z
  .object({
    type: z.enum(RISK_FLAG_TYPES),
    note: z.string().trim().min(1).max(RISK_FLAG_NOTE_MAX).optional(),
    thread_id: z.string().min(1).max(64).optional(),
    evidence_event_ids: z.array(z.string().min(1).max(64)).max(RISK_FLAG_EVIDENCE_MAX).optional(),
  })
  .strict();

const clearBody = z
  .object({ reason: z.string().trim().min(1).max(RISK_FLAG_CLEAR_REASON_MAX) })
  .strict();

const page = {
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  page_id: z.string().max(512).optional(),
};

const customerQuery = z.object({ status: z.enum(RISK_FLAG_STATUSES).optional(), ...page });

const listQuery = z.object({
  status: z.enum(RISK_FLAG_STATUSES).optional(),
  type: z
    .string()
    .max(400)
    .transform((value) => [...new Set(value.split(',').map((part) => part.trim()))])
    .refine((types) => types.every(isRiskFlagType), 'one of the risk flag types, comma-separated')
    .optional(),
  severity: z.enum(RISK_FLAG_SEVERITIES).optional(),
  source: z.enum(RISK_FLAG_SOURCES).optional(),
  chat_id: chatIdSchema.optional(),
  customer_id: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  ...page,
});

const settingsBody = z
  .object({
    rg_group_id: z.number().int().min(1).nullable().optional(),
    notify_emails: z
      .array(z.string().trim().toLowerCase().email().max(254))
      .max(RISK_FLAG_NOTIFY_EMAILS_MAX)
      .optional(),
    promo_block: z
      .record(z.enum(RISK_FLAG_TYPES), z.boolean())
      .refine((value) => Object.keys(value).length > 0, 'promo_block: name at least one type')
      .optional(),
    reason: highRiskReason.optional(),
  })
  .strict()
  .refine(
    ({ reason: _reason, ...settings }) => Object.keys(settings).length > 0,
    'at least one setting is required',
  );

/**
 * The workspace's half of the promotion rule after `promo_block` (EN-01): a
 * locked type switched off is a 400, a type no workspace decides about too;
 * a locked type left on changes nothing.
 */
function promoPolicyAfter(
  before: PromoPolicy,
  change: Partial<Record<RiskFlagType, boolean>> | undefined,
): PromoPolicy {
  if (change === undefined) return before;
  const next = { ...before };
  for (const [key, block] of Object.entries(change)) {
    const type = key as RiskFlagType;
    if (block === undefined) continue;
    if (isLockedPromoFlag(type)) {
      if (!block) {
        throw ApiError.validation(`promo_block.${type}: locked — always blocks promotions.`, {
          reason: PROMO_FLAG_LOCKED_REASON,
          type,
        });
      }
      continue;
    }
    if (!isPromoPolicyFlag(type)) {
      throw ApiError.validation(`promo_block.${type}: not a workspace setting.`, {
        reason: PROMO_FLAG_NOT_CONFIGURABLE_REASON,
        type,
      });
    }
    next[type] = block;
  }
  return next;
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

interface FlagCursor {
  raisedAt: string;
  id: string;
}

function encodeCursor(cursor: FlagCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** A cursor this route did not write is a 400, not a fresh start. */
function decodeCursor(pageId: string): FlagCursor {
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as FlagCursor;
    if (
      typeof parsed?.id === 'string' &&
      uuid.safeParse(parsed.id).success &&
      typeof parsed?.raisedAt === 'string' &&
      !Number.isNaN(Date.parse(parsed.raisedAt))
    ) {
      return parsed;
    }
  } catch {
    // fall through
  }
  throw ApiError.validation('page_id: not a cursor from a previous page.');
}

/** The chat visibility filter, or null for a caller who sees every conversation. */
function chatWhereOf(visibility: ChatVisibility): Record<string, unknown> | null {
  return visibility.unrestricted ? null : chatVisibilityFilter(visibility);
}

export async function riskFlagRoutes(app: FastifyInstance): Promise<void> {
  /** One page of flags, newest first, under `where`. */
  async function listPage(
    tx: TenantClient,
    where: Prisma.RiskFlagWhereInput[],
    query: { limit?: number | undefined; page_id?: string | undefined },
  ) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filters = [...where];
    if (query.page_id) {
      const cursor = decodeCursor(query.page_id);
      const at = new Date(cursor.raisedAt);
      filters.push({ OR: [{ raisedAt: { lt: at } }, { raisedAt: at, id: { lt: cursor.id } }] });
    }
    const rows = await tx.riskFlag.findMany({
      where: { AND: filters },
      orderBy: [{ raisedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      next:
        rows.length > limit && last
          ? encodeCursor({ raisedAt: last.raisedAt.toISOString(), id: last.id })
          : null,
    };
  }

  // --- Raise ---------------------------------------------------------------

  app.post<{ Params: { chatId: string } }>(
    '/chats/:chatId/risk-flags',
    { config: { scopes: CHAT_WRITE, principals: ['agent'] } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const body = parse(raiseBody, request.body);
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();
      const tenant = request.tenant();

      const result = await request.withTenant(async (tx) => {
        const visibility = await resolveVisibility(tx, principal, 'write');
        const chat = await tx.chat.findUnique({
          where: { id: chatId },
          select: {
            customerId: true,
            access: { select: { groupId: true } },
            users: { select: { userId: true, userType: true } },
          },
        });
        // A conversation the caller may not write in reads as absent (NFR-S5).
        if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');
        if (body.thread_id) {
          const thread = await tx.thread.findFirst({
            where: { id: body.thread_id, chatId },
            select: { id: true },
          });
          if (!thread) throw ApiError.notFound('Thread not found.');
        }
        const evidence = [...new Set(body.evidence_event_ids ?? [])];
        if (evidence.length > 0) {
          const found = await tx.event.count({ where: { id: { in: evidence }, chatId } });
          if (found !== evidence.length) {
            throw ApiError.validation(
              'evidence_event_ids: every id must be an event of this chat.',
            );
          }
        }
        const raised = await raiseRiskFlag(tx, tenant.licenseId, {
          type: body.type,
          chatId,
          threadId: body.thread_id ?? null,
          source: 'agent',
          ruleRef: null,
          raisedBy: principal.accountId,
          note: body.note ?? null,
          evidenceEventIds: evidence,
        });
        return { ...raised, detailsVisible: await riskFlagDetailsVisible(tx, principal) };
      });

      if (result.created) app.riskFlags.announce(tenant, [{ kind: 'raised', flag: result.flag }]);
      return reply
        .code(result.created ? 201 : 200)
        .send(serialiseRiskFlag(result.flag, result.detailsVisible, seesPlayerContact(principal)));
    },
  );

  // --- Clear ---------------------------------------------------------------

  app.delete<{ Params: { flagId: string } }>(
    '/risk-flags/:flagId',
    { config: { scopes: CHAT_WRITE, principals: ['agent'] } },
    async (request, reply) => {
      const flagId = parse(uuid, request.params.flagId);
      const body = parse(clearBody, request.body ?? {});
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();
      const tenant = request.tenant();

      const result = await request.withTenant(async (tx) => {
        const visibility = await resolveVisibility(tx, principal, 'write');
        const where = riskFlagVisibilityWhere(chatWhereOf(visibility), { members: true });
        const seen = await tx.riskFlag.findFirst({
          where: { AND: [{ id: flagId }, where] },
          select: { id: true },
        });
        if (!seen) throw ApiError.notFound('Risk flag not found.');
        const flag = await clearRiskFlag(tx, {
          flagId,
          clearedBy: principal.accountId,
          role: principal.role,
          reason: body.reason,
        });
        // Who cleared what, never why: the reason may be about the player's
        // health, and is on the row for those entitled to it.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'risk_flag.cleared',
          target: `risk_flag:${flag.id}`,
          metadata: {
            type: flag.type,
            scope: flag.scope,
            severity: flag.severity,
            chat_id: flag.chatId,
            customer_id: flag.customerId,
          },
        });
        return { flag, detailsVisible: await riskFlagDetailsVisible(tx, principal) };
      });

      app.riskFlags.announce(tenant, [{ kind: 'cleared', flag: result.flag }]);
      return reply.send(
        serialiseRiskFlag(result.flag, result.detailsVisible, seesPlayerContact(principal)),
      );
    },
  );

  // --- Read ----------------------------------------------------------------

  app.get<{ Params: { customerId: string } }>(
    '/customers/:customerId/risk-flags',
    { config: { scopes: CHAT_READ, principals: ['agent', 'bot'] } },
    async (request, reply) => {
      const customerId = parse(uuid, request.params.customerId);
      const query = parse(customerQuery, request.query);
      const principal = request.requirePrincipal();

      const result = await request.withTenant(async (tx) => {
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        // Another organization's customer reads as absent (NFR-S5).
        if (!customer) throw ApiError.notFound('Customer not found.');
        const visibility = await resolveVisibility(tx, principal, 'read');
        const filters: Prisma.RiskFlagWhereInput[] = [
          { customerId },
          riskFlagVisibilityWhere(chatWhereOf(visibility), { members: true }),
        ];
        if (query.status) filters.push({ status: query.status });
        const page = await listPage(tx, filters, query);
        // Whether the player is shown campaigns (EN-01): every active flag of
        // theirs and of their linked records, seen by the caller or not —
        // what the campaign engine itself reads.
        const promo = (await promoSuppressionOf(tx, [customerId])).get(customerId) ?? null;
        return {
          ...page,
          promo,
          detailsVisible: await riskFlagDetailsVisible(tx, principal),
        };
      });

      return reply.send({
        items: result.items.map((row) =>
          serialiseRiskFlag(row, result.detailsVisible, seesPlayerContact(principal)),
        ),
        ...(result.next ? { next_page_id: result.next } : {}),
        promo_suppressed: result.promo !== null,
        promo_suppressed_reason: result.promo,
      });
    },
  );

  app.get(
    '/risk-flags',
    { config: { scopes: CHAT_READ, principals: ['agent', 'bot'] } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
        throw ApiError.validation('`from` must be before `to`.');
      }
      const principal = request.requirePrincipal();

      const result = await request.withTenant(async (tx) => {
        const visibility = await resolveVisibility(tx, principal, 'read');
        const filters: Prisma.RiskFlagWhereInput[] = [
          riskFlagVisibilityWhere(chatWhereOf(visibility), { members: false }),
        ];
        if (query.status) filters.push({ status: query.status });
        if (query.type) filters.push({ type: { in: query.type } });
        if (query.severity) filters.push({ severity: query.severity });
        if (query.source) filters.push({ source: query.source });
        if (query.chat_id) filters.push({ chatId: query.chat_id });
        if (query.customer_id) filters.push({ customerId: query.customer_id });
        if (query.from || query.to) {
          filters.push({
            raisedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          });
        }
        const page = await listPage(tx, filters, query);
        return { ...page, detailsVisible: await riskFlagDetailsVisible(tx, principal) };
      });

      return reply.send({
        items: result.items.map((row) =>
          serialiseRiskFlag(row, result.detailsVisible, seesPlayerContact(principal)),
        ),
        ...(result.next ? { next_page_id: result.next } : {}),
      });
    },
  );

  // --- Settings ------------------------------------------------------------

  const serialiseSettings = (
    settings: Awaited<ReturnType<typeof readRiskFlagSettings>>,
    promo: PromoPolicy,
  ) => ({
    rg_group_id: settings.rgGroupId === null ? null : Number(settings.rgGroupId),
    notify_emails: [...settings.notifyEmails],
    promo_block: { ...promo },
    updated_by: settings.updatedBy,
    updated_at: settings.updatedAt?.toISOString() ?? null,
  });

  app.get(
    '/risk-flags/settings',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const settings = await request.withTenant(async (tx) => ({
        view: await readRiskFlagSettings(tx),
        promo: await readPromoPolicy(tx),
      }));
      return reply.send(serialiseSettings(settings.view, settings.promo));
    },
  );

  app.put(
    '/risk-flags/settings',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin', principals: ['agent'] } },
    async (request, reply) => {
      const body = parse(settingsBody, request.body);
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;
      const tenant = request.tenant();

      const saved = await request.withTenant(async (tx) => {
        if (body.rg_group_id !== undefined && body.rg_group_id !== null) {
          const team = await tx.group.findFirst({
            where: { id: BigInt(body.rg_group_id) },
            select: { id: true },
          });
          if (!team) throw ApiError.validation('rg_group_id: not a team of this workspace.');
        }
        const before = await readRiskFlagSettings(tx);
        const promoBefore = await readPromoPolicy(tx);
        const promo = promoPolicyAfter(promoBefore, body.promo_block);
        const rgGroupId =
          body.rg_group_id === undefined
            ? before.rgGroupId
            : body.rg_group_id === null
              ? null
              : BigInt(body.rg_group_id);
        const notifyEmails =
          body.notify_emails === undefined
            ? [...before.notifyEmails]
            : [...new Set(body.notify_emails)];
        const data = {
          rgGroupId,
          notifyEmails,
          promoBlockFraud: promo.fraud_suspected,
          promoBlockComplaint: promo.complaint_formal,
          updatedBy: actor,
          updatedAt: new Date(),
        };
        await tx.riskFlagSettings.upsert({
          where: { licenseId: tenant.licenseId },
          create: { licenseId: tenant.licenseId, ...data },
          update: data,
        });
        // Who hears of an urgent flag: the team and how many addresses — the
        // addresses themselves are on the row. The promotion policy before and
        // after, and why: a high-risk setting (GV-06) — loosening it lets a
        // flagged player see bonuses again.
        const { reason, ...changed } = body;
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.risk_flags_updated',
          target: `license:${tenant.licenseId}`,
          metadata: {
            changed: Object.keys(changed),
            rg_group_id: rgGroupId === null ? null : Number(rgGroupId),
            notify_email_count: notifyEmails.length,
            ...(body.promo_block !== undefined
              ? { promo_block_before: { ...promoBefore }, promo_block: { ...promo } }
              : {}),
            ...reasonMetadata(reason),
          },
        });
        return { view: await readRiskFlagSettings(tx), promo };
      });

      return reply.send(serialiseSettings(saved.view, saved.promo));
    },
  );
}
