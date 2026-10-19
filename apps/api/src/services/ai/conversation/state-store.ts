/**
 * The AI conversation state store (tm 292.1 · SiyahTuş analysis AI-01 §6,
 * AI-03 §2; ADR-14b §2.7).
 *
 * One `ai_conversations` row per connection holds where the AI is in it. This
 * file is the only way the API reads and writes that row, and it has three
 * doors:
 *
 *   - {@link loadConversation} — the row of a connection, or null.
 *   - {@link openConversation} — the row of a connection, opening it on first
 *     use. Idempotent under a race: two turns opening the same connection get
 *     the same row. The AI configuration version is pinned here, once, when
 *     the row is created (ADR-14b §2.7); a later open does not move it.
 *   - {@link saveConversation} — the optimistic lock. A turn reads the row,
 *     does its model work outside any transaction, and saves back only if
 *     `version` is still the one it read. If it is not, somebody else wrote in
 *     between — another worker answered, an agent took over (AI-11) — and the
 *     save throws {@link AiConversationConflictError}. Called inside the
 *     transaction that writes the reply, the throw rolls the reply back with
 *     it: a turn that lost the race sends nothing (AI-01 §6).
 *
 * The database keeps the rules a writer could get wrong (migration
 * 20261016200000): `version` is bumped by a trigger on every UPDATE and the
 * runtime role cannot write it, `config_version_id` cannot change once set,
 * `last_processed_event_seq` cannot move back, and a row can only be opened on
 * a thread of the writer's own workspace and chat. The store adds what the
 * database cannot see: a patch names only the fields a turn may change.
 *
 * Every call takes the caller's tenant client, so row level security decides
 * the workspace: another workspace's row is invisible here and a save against
 * it is a conflict, never a write.
 */
import { Prisma, type AiConversation } from '@prisma/client';
import type {
  AiConversationMode,
  AiConversationOutcome,
  AiConversationStepStatus,
} from '@siyahtus/types';
import { maskDeep } from '../../../lib/sensitive-mask.js';
import { type TenantClient, UUID_RE } from '../../../lib/tenant.js';

/**
 * A connection (05 §1.0, K1=A): `threadId` is the connection itself (panel
 * "Chat ID"), `chatId` the day container it belongs to (panel "Thread ID").
 */
export interface ConnectionRef {
  readonly chatId: string;
  readonly threadId: string;
}

/** A structured column's value: always a JSON object. */
export type AiStateObject = Readonly<Record<string, unknown>>;

/** One conversation's state, as the engine reads it. */
export interface AiConversationState {
  readonly id: string;
  readonly chatId: string;
  readonly threadId: string;
  readonly mode: AiConversationMode;
  readonly modeChangedAt: Date | null;
  readonly modeChangedBy: string | null;
  readonly modeReason: string | null;
  readonly activeSkillId: string | null;
  readonly procedureSnapshot: AiStateObject | null;
  readonly procedureSnapshotHash: string | null;
  readonly stepId: string | null;
  readonly stepStatus: AiConversationStepStatus | null;
  readonly slots: AiStateObject;
  readonly suspended: AiStateObject | null;
  readonly counters: AiStateObject;
  readonly signals: AiStateObject;
  readonly digest: AiStateObject | null;
  readonly outcome: AiConversationOutcome | null;
  /** The connection's `event_sequence` the last turn covered. */
  readonly lastProcessedEventSeq: number;
  /** The lock's counter — what {@link saveConversation} compares against. */
  readonly version: number;
  /** The pinned AI configuration version; null before versioning (tm 316). */
  readonly configVersionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly closedAt: Date | null;
}

/**
 * The fields a save may change — the column list `siyahtus_app` holds UPDATE
 * on. Identity, `version` and the timestamps are the database's.
 */
export const AI_CONVERSATION_PATCH_FIELDS = [
  'mode',
  'modeChangedAt',
  'modeChangedBy',
  'modeReason',
  'activeSkillId',
  'procedureSnapshot',
  'procedureSnapshotHash',
  'stepId',
  'stepStatus',
  'slots',
  'suspended',
  'counters',
  'signals',
  'digest',
  'outcome',
  'lastProcessedEventSeq',
  'configVersionId',
  'closedAt',
] as const satisfies ReadonlyArray<keyof AiConversationState>;
export type AiConversationPatchField = (typeof AI_CONVERSATION_PATCH_FIELDS)[number];

/** What one save writes. Fields left out keep their value. */
export type AiConversationPatch = Partial<Pick<AiConversationState, AiConversationPatchField>>;

const PATCH_FIELDS: ReadonlySet<string> = new Set(AI_CONVERSATION_PATCH_FIELDS);

/**
 * The columns that hold what the player said, reworded (AI-26 · tm 300.2):
 * the slots collected from their messages, a suspended topic's slots and the
 * connection's digest. Written from masked text already; masked again here so
 * a value a model reconstructed still comes to rest masked.
 */
const PLAYER_JSON_FIELDS: ReadonlySet<string> = new Set(['slots', 'suspended', 'digest']);

/** The nullable JSON columns: a null there is SQL NULL, not JSON `null`. */
const NULLABLE_JSON_FIELDS: ReadonlySet<string> = new Set([
  'procedureSnapshot',
  'suspended',
  'digest',
]);

/**
 * The row moved on since it was read: another writer saved first. The turn's
 * draft must not be sent; whoever saved first owns the reply.
 */
export class AiConversationConflictError extends Error {
  readonly code = 'ai_conversation_version_conflict';

  constructor(
    readonly conversationId: string,
    readonly expectedVersion: number,
  ) {
    super(`ai conversation ${conversationId} is past version ${expectedVersion}`);
    this.name = 'AiConversationConflictError';
  }
}

/** The connection's conversation, or null if the AI has not opened one. */
export async function loadConversation(
  tx: TenantClient,
  ref: ConnectionRef,
): Promise<AiConversationState | null> {
  const row = await tx.aiConversation.findFirst({
    where: { threadId: ref.threadId, chatId: ref.chatId },
  });
  return row ? toState(row) : null;
}

/**
 * The connection's conversation, opened on first use with the AI
 * configuration version it will run on (`ai_agents.published_version_id`;
 * null until tm 316). If the row already exists it is returned as it is — the
 * pinned version included (ADR-14b §2.7: pinned once, at opening).
 *
 * The licence is the tenant context's, not a parameter: a caller cannot open
 * a conversation under another workspace. A thread that is not a connection
 * of `ref.chatId` in this workspace is refused by the database.
 */
export async function openConversation(
  tx: TenantClient,
  ref: ConnectionRef,
  options: { configVersionId: string | null },
): Promise<AiConversationState> {
  const { configVersionId } = options;
  if (configVersionId !== null && !UUID_RE.test(configVersionId)) {
    throw new TypeError(`invalid config version id: ${configVersionId}`);
  }
  // ON CONFLICT: a second opener waits on the first one's unique-index entry,
  // then does nothing and reads the row the first one committed.
  await tx.$executeRaw`
    INSERT INTO ai_conversations (id, license_id, chat_id, thread_id, config_version_id)
    VALUES (gen_random_uuid(), siyahtus_current_license(), ${ref.chatId}, ${ref.threadId},
            ${configVersionId}::uuid)
    ON CONFLICT (license_id, chat_id, thread_id) DO NOTHING`;
  const state = await loadConversation(tx, ref);
  // Only reachable if the row was deleted between the two statements.
  if (!state) throw new Error(`ai conversation for thread ${ref.threadId} vanished on open`);
  return state;
}

/**
 * Write `patch` if the conversation is still at the version `current` was
 * read at, and return the saved state (its `version` one higher).
 *
 * Throws {@link AiConversationConflictError} when it is not — and, because it
 * throws, a save made in the reply's own transaction takes the reply down with
 * it. A row of another workspace is invisible here, so it conflicts too.
 */
export async function saveConversation(
  tx: TenantClient,
  current: Pick<AiConversationState, 'id' | 'version'>,
  patch: AiConversationPatch,
): Promise<AiConversationState> {
  const data = toUpdateData(patch);
  const saved = await tx.aiConversation.updateMany({
    where: { id: current.id, version: current.version },
    data,
  });
  if (saved.count === 0) throw new AiConversationConflictError(current.id, current.version);
  return toState(await tx.aiConversation.findUniqueOrThrow({ where: { id: current.id } }));
}

/**
 * The patch as Prisma update data. Refuses a key that is not a patch field — a
 * spread state object carrying `version` or `id` is a bug to surface, not to
 * drop silently — and an empty patch, which would write nothing yet still
 * claim the lock.
 */
function toUpdateData(patch: AiConversationPatch): Prisma.AiConversationUpdateManyMutationInput {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCH_FIELDS.has(key)) {
      throw new TypeError(`ai conversation field ${key} is not writable`);
    }
    if (value === undefined) continue;
    data[key] =
      value === null && NULLABLE_JSON_FIELDS.has(key)
        ? Prisma.DbNull
        : PLAYER_JSON_FIELDS.has(key)
          ? maskDeep(value, 'customer')
          : value;
  }
  if (Object.keys(data).length === 0) throw new TypeError('ai conversation patch is empty');
  return data as Prisma.AiConversationUpdateManyMutationInput;
}

function toState(row: AiConversation): AiConversationState {
  return {
    id: row.id,
    chatId: row.chatId,
    threadId: row.threadId,
    mode: row.mode as AiConversationMode,
    modeChangedAt: row.modeChangedAt,
    modeChangedBy: row.modeChangedBy,
    modeReason: row.modeReason,
    activeSkillId: row.activeSkillId,
    procedureSnapshot: row.procedureSnapshot as AiStateObject | null,
    procedureSnapshotHash: row.procedureSnapshotHash,
    stepId: row.stepId,
    stepStatus: row.stepStatus as AiConversationStepStatus | null,
    slots: row.slots as AiStateObject,
    suspended: row.suspended as AiStateObject | null,
    counters: row.counters as AiStateObject,
    signals: row.signals as AiStateObject,
    digest: row.digest as AiStateObject | null,
    outcome: row.outcome as AiConversationOutcome | null,
    lastProcessedEventSeq: row.lastProcessedEventSeq,
    version: row.version,
    configVersionId: row.configVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
  };
}
