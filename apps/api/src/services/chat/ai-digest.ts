/**
 * The AI's summary of each connection, as the chat side settles and reads it
 * (tm 294 · SiyahTuş analysis AI-02).
 *
 * `ai_conversations.digest` is written by the AI's turns
 * (`services/ai/conversation/daily-memory.ts`). This file holds its shape and
 * the two things done with it outside a turn: the close settles how the
 * connection ended ({@link settleDailyDigest}), and the day's summaries are
 * read for the AI's next connection and for the agent's screen
 * ({@link loadDailyDigests}). It lives beside `ai-mode.ts` for the same
 * reason: the close path, which the rule bot shares, reaches no module of the
 * AI service (`bots/rule-bot-isolation.test.ts`).
 */
import {
  AI_CONVERSATION_OUTCOMES,
  DAILY_DIGEST_LIMIT,
  type AiConversationOutcome,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { listDayConnections, type DayConnection } from './conversation-day.js';

/** A JSON column's object value. */
type JsonObject = Readonly<Record<string, unknown>>;

/** A slot as a summary keeps it: what to show, and how it was obtained. */
export interface DigestSlot {
  readonly display: string;
  readonly status: string;
}

/** How a connection was handed to a person, as far as the AI knows it. */
export interface DigestHandoff {
  /** The hand-off record (#304); null until there is one. */
  readonly id: string | null;
  readonly team_id: string | null;
  /** The team the skill named, while the connection is open. */
  readonly team_name: string | null;
  readonly reason_codes: readonly string[];
  readonly agent_replied: boolean;
}

/** What `ai_conversations.digest` holds — the connection's own summary of itself. */
export interface StoredDigest {
  /** The procedure (today: the skill's id). */
  readonly procedure_key: string | null;
  readonly procedure_name: string | null;
  readonly intent_label: string | null;
  readonly slots: Readonly<Record<string, DigestSlot>>;
  /** How it stands after the newest turn; the close settles it. */
  readonly outcome: AiConversationOutcome | null;
  /** The AI's newest message was a question the player has not answered. */
  readonly awaiting_answer: boolean;
  readonly handoff: DigestHandoff | null;
  readonly risk_flags: readonly string[];
  readonly last_ai_excerpt: string | null;
}

/** One earlier connection's summary as a later one reads it (`GET /chats/{chatId}/ai-digests`). */
export interface DailyDigest extends StoredDigest {
  readonly connection: { readonly chat_id: string; readonly thread_id: string };
  readonly started_at: string;
  readonly ended_at: string | null;
}

/**
 * Settle the connection's outcome as it closes (`ChatService` — an agent's
 * archive, the visitor's, the inactivity sweep), in the close's transaction:
 *
 *   - a person had it (`threads.ai_mode = 'human'`) → `handed_off`, with the
 *     team, the reason and whether an agent wrote to the player;
 *   - the AI never took a turn → `no_ai`;
 *   - the AI's last word was a question left unanswered → `abandoned` (the
 *     slots collected so far stay in the summary — read from the state as it
 *     closes);
 *   - otherwise what the newest turn left (`resolved`).
 *
 * No version check: the close holds the thread's row and outranks any turn —
 * one still thinking finds the connection closed and sends nothing. A
 * connection the AI never opened a conversation on has nothing to settle.
 */
export async function settleDailyDigest(
  tx: TenantClient,
  threadId: string,
  closedAt: Date,
): Promise<void> {
  const row = await tx.aiConversation.findFirst({
    where: { threadId },
    select: {
      id: true,
      digest: true,
      slots: true,
      counters: true,
      modeReason: true,
      createdAt: true,
    },
  });
  if (!row) return;
  const thread = await tx.thread.findUnique({
    where: { id: threadId },
    select: { aiMode: true, groupId: true },
  });
  const digest = row.digest ? readStoredDigest(row.digest as JsonObject) : null;
  const turns = (row.counters as JsonObject)['turns'];

  let outcome: AiConversationOutcome;
  let handoff = digest?.handoff ?? null;
  if (thread?.aiMode === 'human') {
    outcome = 'handed_off';
    const agentWrote = await tx.event.findFirst({
      where: { threadId, authorType: 'agent', type: 'message', recipients: 'all' },
      select: { id: true },
    });
    handoff = {
      id: handoff?.id ?? null,
      team_id: thread.groupId !== null ? thread.groupId.toString() : null,
      team_name: handoff?.team_name ?? null,
      reason_codes: row.modeReason ? [row.modeReason] : (handoff?.reason_codes ?? []),
      agent_replied: agentWrote !== null,
    };
  } else if (typeof turns !== 'number' || turns === 0 || !digest) {
    outcome = 'no_ai';
  } else if (digest.awaiting_answer) {
    outcome = 'abandoned';
  } else {
    outcome = digest.outcome ?? 'resolved';
  }

  await tx.aiConversation.updateMany({
    where: { id: row.id },
    data: {
      outcome,
      closedAt: closedAt < row.createdAt ? row.createdAt : closedAt,
      ...(digest
        ? {
            digest: {
              ...digest,
              // What the conversation holds as it closes, not as of its last turn.
              slots: digestSlots(row.slots as JsonObject),
              outcome,
              handoff,
            } as unknown as object,
          }
        : {}),
    },
  });
}

/**
 * The summaries of the day's connections other than `excludeThreadId`, newest
 * first, at most `limit` (all of them with `null`). The day comes from the
 * chat (`listDayConnections`): a chat filed under no day offers no earlier
 * connection. Row level security decides the workspace — another one's chat
 * reads as an empty day.
 */
export async function loadDailyDigests(
  tx: TenantClient,
  chatId: string,
  options: { excludeThreadId?: string; limit?: number | null } = {},
): Promise<DailyDigest[]> {
  const day = await listDayConnections(
    tx,
    chatId,
    options.excludeThreadId ? { excludeThreadId: options.excludeThreadId } : {},
  );
  return digestsOf(
    tx,
    chatId,
    day,
    options.limit === undefined ? DAILY_DIGEST_LIMIT : options.limit,
  );
}

/** The summaries of `day`'s connections, newest first. */
export async function digestsOf(
  tx: TenantClient,
  chatId: string,
  day: readonly DayConnection[],
  limit: number | null,
): Promise<DailyDigest[]> {
  if (day.length === 0) return [];
  const rows = await tx.aiConversation.findMany({
    where: { chatId, threadId: { in: day.map((connection) => connection.id) } },
    select: { threadId: true, digest: true, outcome: true },
  });
  const byThread = new Map(rows.map((row) => [row.threadId, row]));
  const digests: DailyDigest[] = [];
  // `listDayConnections` is oldest first.
  for (const connection of [...day].reverse()) {
    const row = byThread.get(connection.id);
    if (!row?.digest) continue;
    const stored = readStoredDigest(row.digest as JsonObject);
    digests.push({
      ...stored,
      outcome: isOutcome(row.outcome) ? row.outcome : stored.outcome,
      connection: { chat_id: chatId, thread_id: connection.id },
      started_at: connection.createdAt.toISOString(),
      ended_at: connection.closedAt ? connection.closedAt.toISOString() : null,
    });
    if (limit !== null && digests.length >= limit) break;
  }
  return digests;
}

/**
 * The slots as a summary keeps them. A slot is an object with a `display`
 * (or a `value`) and a `status` (AI-04, #295), or a bare string; an empty one
 * is left out, and so is a `pii: 'high'` one — its value stays on the
 * connection's record for the card and travels nowhere else (AI-04 §9).
 */
export function digestSlots(slots: JsonObject): Record<string, DigestSlot> {
  const kept: Record<string, DigestSlot> = {};
  for (const [name, slot] of Object.entries(slots)) {
    if (typeof slot === 'string') {
      if (slot.trim()) kept[name] = { display: slot.trim(), status: 'filled' };
      continue;
    }
    if (!slot || typeof slot !== 'object') continue;
    const fields = slot as Record<string, unknown>;
    if (fields['pii'] === 'high') continue;
    const shown = fields['display'] ?? fields['value'];
    const display =
      typeof shown === 'string' ? shown.trim() : typeof shown === 'number' ? String(shown) : '';
    if (!display) continue;
    const status = fields['status'];
    kept[name] = { display, status: typeof status === 'string' ? status : 'filled' };
  }
  return kept;
}

export function riskFlags(signals: JsonObject): string[] {
  const flags = signals['risk_flags'];
  return Array.isArray(flags)
    ? flags.filter((flag): flag is string => typeof flag === 'string')
    : [];
}

function isOutcome(value: unknown): value is AiConversationOutcome {
  return (
    typeof value === 'string' && (AI_CONVERSATION_OUTCOMES as readonly string[]).includes(value)
  );
}

/** A stored summary, read defensively: a field of the wrong shape reads as empty. */
export function readStoredDigest(raw: JsonObject): StoredDigest {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value !== '' ? value : null;
  const handoff = raw['handoff'];
  const handoffFields =
    handoff && typeof handoff === 'object' && !Array.isArray(handoff)
      ? (handoff as Record<string, unknown>)
      : null;
  const slots = raw['slots'];
  return {
    procedure_key: text(raw['procedure_key']),
    procedure_name: text(raw['procedure_name']),
    intent_label: text(raw['intent_label']),
    slots:
      slots && typeof slots === 'object' && !Array.isArray(slots)
        ? digestSlots(slots as JsonObject)
        : {},
    outcome: isOutcome(raw['outcome']) ? raw['outcome'] : null,
    awaiting_answer: raw['awaiting_answer'] === true,
    handoff: handoffFields
      ? {
          id: text(handoffFields['id']),
          team_id: text(handoffFields['team_id']),
          team_name: text(handoffFields['team_name']),
          reason_codes: Array.isArray(handoffFields['reason_codes'])
            ? handoffFields['reason_codes'].filter(
                (code): code is string => typeof code === 'string',
              )
            : [],
          agent_replied: handoffFields['agent_replied'] === true,
        }
      : null,
    risk_flags: riskFlags(raw),
    last_ai_excerpt: text(raw['last_ai_excerpt']),
  };
}
