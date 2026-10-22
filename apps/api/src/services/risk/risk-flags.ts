/**
 * Risk flags (tm 302.2 · SiyahTuş analysis AI-27): raising, clearing and
 * reading the `risk_flags` rows 302.1 laid down, and the one reading of them
 * every caller shares — {@link chatRiskPolicy}, `riskPolicy` over a
 * conversation's own flags and its player's.
 *
 *   - **Raise** ({@link raiseRiskFlag}), in the caller's transaction: the AI's
 *     hand-over (`AiResponder`, with the hand-over itself), an agent's
 *     `POST /chats/{id}/risk-flags`. Type decides scope and severity
 *     (`RISK_FLAG_DEFAULTS`); `basis` is `declared` in F1 (AI-27-S3). A
 *     conversation carries one active flag of a type: a second raise returns
 *     the first, serialised by an advisory lock on (chat, type).
 *   - **Clear** ({@link clearRiskFlag}): with a reason, by the type's clearer
 *     and up (AI-27-S2, `canClearRiskFlag`), once. The row's trigger holds the
 *     rest — a flag is never rewritten, and never deleted.
 *   - **Read** ({@link chatRiskPolicy}): what the AI turn, the hand-back
 *     (`aiReturnBlockers`) and the panel ask of a conversation.
 *
 * Who reads a flag's note, evidence and clear reason ({@link riskFlagDetailsVisible}):
 * the Responsible Gaming team (`risk_flag_settings.rg_group_id`) and a Team
 * Lead and up — everyone else who sees the conversation sees its type.
 *
 * Nothing here announces: the caller hands what it raised or cleared to
 * `RiskFlagAnnouncer` once its transaction has committed.
 */
import type { Prisma, RiskFlag } from '@prisma/client';
import {
  RISK_FLAG_ALREADY_CLEARED_REASON,
  RISK_FLAG_CLEAR_MIN_ROLE,
  RISK_FLAG_CLEAR_ROLE_REASON,
  RISK_FLAG_DEFAULTS,
  RISK_FLAG_EVIDENCE_MAX,
  RISK_FLAG_MEMBER_KEY_MAX,
  canClearRiskFlag,
  canSeeRiskFlagDetails,
  isRiskFlagType,
  riskPolicy,
  type AgentRole,
  type RiskFlagBasis,
  type RiskFlagPush,
  type RiskFlagScope,
  type RiskFlagSeverity,
  type RiskFlagSignal,
  type RiskFlagSource,
  type RiskFlagStatus,
  type RiskFlagType,
  type RiskPolicy,
  type RiskPolicyFlag,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';

/** One flag to raise on a conversation. */
export interface RiskFlagRaise {
  readonly type: RiskFlagType;
  readonly chatId: string;
  /** The connection; null: the conversation's active one, else its latest. */
  readonly threadId: string | null;
  readonly source: RiskFlagSource;
  /** The guardrail rule, `G1`…`G19` — only with `ai_rule`. */
  readonly ruleRef: string | null;
  /** The account — only with `agent` or `qa`. */
  readonly raisedBy: string | null;
  readonly note: string | null;
  readonly evidenceEventIds: readonly string[];
}

export interface RaisedRiskFlag {
  readonly flag: RiskFlag;
  /** False: the conversation already carried an active flag of the type, which is `flag`. */
  readonly created: boolean;
}

/**
 * Raise a flag on a conversation, in the caller's transaction. A
 * conversation this workspace cannot see is `404` (the trigger would refuse
 * it too, as a foreign key error).
 */
export async function raiseRiskFlag(
  tx: TenantClient,
  licenseId: bigint,
  input: RiskFlagRaise,
): Promise<RaisedRiskFlag> {
  // One active flag of a type per conversation: two raises at once (the AI's
  // turn and an agent's click) land one row.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`risk_flag:${input.chatId}:${input.type}`}, 0))`;
  const existing = await tx.riskFlag.findFirst({
    where: { chatId: input.chatId, type: input.type, status: 'active' },
  });
  if (existing) return { flag: existing, created: false };

  const chat = await tx.chat.findUnique({
    where: { id: input.chatId },
    select: { customer: { select: { usernameNormalized: true } } },
  });
  if (!chat) throw ApiError.notFound('Chat not found.');
  const threadId =
    input.threadId ??
    (
      await tx.thread.findFirst({
        where: { chatId: input.chatId },
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
      })
    )?.id ??
    null;
  const username = chat.customer.usernameNormalized;
  const defaults = RISK_FLAG_DEFAULTS[input.type];

  const flag = await tx.riskFlag.create({
    data: {
      licenseId,
      scope: defaults.scope,
      chatId: input.chatId,
      threadId,
      // The trigger fills in the chat's customer.
      memberKey: username && username.length <= RISK_FLAG_MEMBER_KEY_MAX ? username : null,
      type: input.type,
      severity: defaults.severity,
      source: input.source,
      ruleRef: input.ruleRef,
      evidenceEventIds: [...new Set(input.evidenceEventIds)].slice(0, RISK_FLAG_EVIDENCE_MAX),
      note: input.note,
      basis: 'declared',
      raisedBy: input.raisedBy,
    },
  });
  return { flag, created: true };
}

/**
 * Clear a flag (AI-27-S2): `role` must be the type's clearer or above, the
 * reason is the caller's to require. Throws `404` for a flag this workspace
 * cannot see, `403 authorization` (`risk_flag_clear_role`) below the clearer,
 * `403 not_allowed` (`risk_flag_already_cleared`) for one cleared already.
 */
export async function clearRiskFlag(
  tx: TenantClient,
  input: { flagId: string; clearedBy: string; role: AgentRole; reason: string },
): Promise<RiskFlag> {
  // Under the row's lock: two clears at once, one wins and one is told.
  const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM risk_flags WHERE id = ${input.flagId}::uuid FOR UPDATE`;
  if (!locked) throw ApiError.notFound('Risk flag not found.');
  const row = await tx.riskFlag.findUniqueOrThrow({ where: { id: input.flagId } });
  const type = isRiskFlagType(row.type) ? row.type : null;
  if (!type || !canClearRiskFlag(type, input.role)) {
    const clearer = type ? RISK_FLAG_DEFAULTS[type].clearer : 'manager';
    throw ApiError.authorization('Your role cannot clear this risk flag.', {
      reason: RISK_FLAG_CLEAR_ROLE_REASON,
      required_role: RISK_FLAG_CLEAR_MIN_ROLE[clearer],
    });
  }
  if (row.status !== 'active') {
    throw new ApiError('not_allowed', 'This risk flag is already cleared.', {
      details: { reason: RISK_FLAG_ALREADY_CLEARED_REASON },
    });
  }
  return tx.riskFlag.update({
    where: { id: row.id },
    data: {
      status: 'cleared',
      clearedBy: input.clearedBy,
      clearedAt: new Date(),
      clearReason: input.reason,
    },
  });
}

/** A conversation's active flags as `riskPolicy` reads them, with their ids. */
export interface ActiveRiskFlag extends RiskPolicyFlag {
  readonly id: string;
}

export interface ChatRiskFlags {
  /** The conversation's own active flags and its player's active member flags. */
  readonly flags: readonly ActiveRiskFlag[];
  readonly policy: RiskPolicy;
}

const NO_FLAGS: ChatRiskFlags = {
  flags: [],
  policy: riskPolicy([], null),
};

/**
 * What a conversation's flags mean now (AI-27 §3, §6): its own active flags,
 * and the active member flags of its player raised in any conversation —
 * yesterday's self-exclusion request keeps today's conversation free of
 * promotions from the AI's first turn. A conversation this workspace cannot
 * see has none.
 */
export async function chatRiskPolicy(tx: TenantClient, chatId: string): Promise<ChatRiskFlags> {
  const chat = await tx.chat.findUnique({ where: { id: chatId }, select: { customerId: true } });
  if (!chat) return NO_FLAGS;
  const rows = await tx.riskFlag.findMany({
    where: {
      status: 'active',
      OR: [{ chatId }, { scope: 'member', customerId: chat.customerId }],
    },
    select: { id: true, type: true, scope: true, chatId: true, severity: true },
    orderBy: [{ raisedAt: 'asc' }, { id: 'asc' }],
  });
  const flags = rows.flatMap((row): ActiveRiskFlag[] =>
    isRiskFlagType(row.type)
      ? [
          {
            id: row.id,
            type: row.type,
            scope: row.scope as RiskFlagScope,
            chat_id: row.chatId,
            severity: row.severity as RiskFlagSeverity,
            status: 'active',
          },
        ]
      : [],
  );
  return { flags, policy: riskPolicy(flags, chatId) };
}

/** The workspace's settings as they stand: a team that no longer exists reads as none. */
export interface RiskFlagSettingsView {
  readonly rgGroupId: bigint | null;
  readonly notifyEmails: readonly string[];
  readonly updatedBy: string | null;
  readonly updatedAt: Date | null;
}

export async function readRiskFlagSettings(tx: TenantClient): Promise<RiskFlagSettingsView> {
  const row = await tx.riskFlagSettings.findFirst({});
  if (!row) return { rgGroupId: null, notifyEmails: [], updatedBy: null, updatedAt: null };
  const team =
    row.rgGroupId === null
      ? null
      : await tx.group.findFirst({ where: { id: row.rgGroupId }, select: { id: true } });
  return {
    rgGroupId: team?.id ?? null,
    notifyEmails: row.notifyEmails,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

/**
 * Whether the caller reads flags' notes, evidence and clear reasons: an agent
 * of the Responsible Gaming team, or a Team Lead and up. A bot or a token
 * that is no person's does not.
 */
export async function riskFlagDetailsVisible(
  tx: TenantClient,
  principal: Principal,
): Promise<boolean> {
  if (principal.kind !== 'agent') return false;
  if (canSeeRiskFlagDetails(principal.role, false)) return true;
  const { rgGroupId } = await readRiskFlagSettings(tx);
  if (rgGroupId === null) return false;
  const member = await tx.groupAgent.findFirst({
    where: { groupId: rgGroupId, agentId: principal.accountId },
    select: { agentId: true },
  });
  return canSeeRiskFlagDetails(principal.role, member !== null);
}

/**
 * A flag on the API (`RiskFlag` in the contract). `member_key` is the
 * player's folded pre-chat username: null to a caller whose role may not see
 * a player's contact details (`customers.contact.view`, tm 325.6).
 */
export function serialiseRiskFlag(row: RiskFlag, detailsVisible: boolean, contactVisible = true) {
  return {
    id: row.id,
    scope: row.scope as RiskFlagScope,
    chat_id: row.chatId,
    thread_id: row.threadId,
    customer_id: row.customerId,
    member_key: contactVisible ? row.memberKey : null,
    type: row.type as RiskFlagType,
    severity: row.severity as RiskFlagSeverity,
    source: row.source as RiskFlagSource,
    rule_ref: row.ruleRef,
    basis: row.basis as RiskFlagBasis,
    status: row.status as RiskFlagStatus,
    raised_by: row.raisedBy,
    raised_at: row.raisedAt.toISOString(),
    cleared_by: row.clearedBy,
    cleared_at: row.clearedAt?.toISOString() ?? null,
    note: detailsVisible ? row.note : null,
    evidence_event_ids: detailsVisible ? row.evidenceEventIds : null,
    clear_reason: detailsVisible ? row.clearReason : null,
    details_visible: detailsVisible,
  };
}

/** The webhook's body (AI-27-S4): what, where and whose — no text anyone wrote. */
export function riskFlagSignal(row: RiskFlag): RiskFlagSignal {
  return {
    flag_id: row.id,
    type: row.type as RiskFlagType,
    severity: row.severity as RiskFlagSeverity,
    scope: row.scope as RiskFlagScope,
    status: row.status as RiskFlagStatus,
    chat_id: row.chatId,
    thread_id: row.threadId,
    member_key: row.memberKey,
    raised_at: row.raisedAt.toISOString(),
    cleared_at: row.clearedAt?.toISOString() ?? null,
  };
}

/** The realtime push: the signal and what the panel shows without asking. */
export function riskFlagPush(row: RiskFlag): RiskFlagPush {
  // Not `member_key`: one frame reaches every recipient, and the username is a
  // per-person answer (`RiskFlagPush`, tm 325.6).
  const { member_key: _memberKey, ...signal } = riskFlagSignal(row);
  return {
    ...signal,
    customer_id: row.customerId,
    source: row.source as RiskFlagSource,
    rule_ref: row.ruleRef,
    basis: row.basis as RiskFlagBasis,
  };
}

/**
 * The flags a caller limited to their teams' conversations may list: those
 * of conversations they see (`chatWhere`, the chat visibility filter) — and,
 * with `members`, a player's own flags wherever they were raised, which is
 * what an agent needs the day after (AI-27 §6).
 */
export function riskFlagVisibilityWhere(
  chatWhere: Record<string, unknown> | null,
  options: { members: boolean },
): Prisma.RiskFlagWhereInput {
  if (chatWhere === null) return {};
  return {
    OR: [
      { chat: chatWhere as Prisma.ChatWhereInput },
      ...(options.members ? [{ scope: 'member' }] : []),
    ],
  };
}
