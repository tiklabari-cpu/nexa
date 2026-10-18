/**
 * Where the AI stands in a conversation, as an agent reads it (tm 296.4 ·
 * SiyahTuş analysis AI-03 §13, AI-04 "AI'ın topladıkları").
 *
 * One shape for two readers: `GET /chats/{chatId}/ai-conversation` shows a
 * live connection's state to the agents who may see the chat, and
 * `POST /skills/preview` returns the state its dry turn would leave. Both read
 * a `TurnState`, so a preview shows exactly what the inbox would.
 *
 * **What it shows.** The procedure in progress — from the pinned snapshot,
 * never the skill as it is now (AI-03 §3): its name, the step and whether it
 * waits for the player; every slot the procedure defines, in its order, with
 * what the AI has of it (a slot nothing was said about is `missing`), and any
 * slot the state holds besides; the topic set aside (≤1, AI-03 §7); the turn
 * count and the outcome.
 *
 * **Personal data.** A slot's `display` is what the player gave, read back —
 * it is the agent's to see, as the transcript and the hand-over card are
 * (AI-04 §9). A `pii: 'high'` slot is shown, marked `sensitive`, for the
 * console to hide behind a reveal. The raw `value`, the attempts' history and
 * `previous_values` are not part of the view. Never served to a customer: the
 * route admits agents and bots only.
 */
import type {
  AiConversationMode,
  AiConversationOutcome,
  AiConversationStepStatus,
  SlotSource,
  SlotStatus,
  SlotType,
} from '@siyahtus/types';
import { readSnapshot, readSuspended, type ProcedureSnapshot } from './procedure/executor.js';
import { slotRecord } from './slots/extract.js';
import type { AiStateObject } from './state-store.js';
import { turnsTaken, type TurnState } from './turn.js';

/** One slot as the agent sees it. */
export interface AiConversationSlotView {
  name: string;
  /** The procedure's label for it; the name when the slot is not the procedure's. */
  label: string;
  /** Null when the slot is not one the procedure defines. */
  type: SlotType | null;
  status: SlotStatus;
  /** What it reads as — null while nothing usable was given. */
  display: string | null;
  source: SlotSource;
  /** How many times the AI asked for it. */
  attempts: number;
  /** A `pii: 'high'` slot: the console hides it until asked. */
  sensitive: boolean;
}

/** A procedure the conversation is in, or set aside. */
export interface AiConversationProcedureView {
  skill_id: string;
  /** The name it had when the conversation started it (the snapshot's); null without one. */
  skill_name: string | null;
  /** sha256 of the pinned definition (ADR-14b §2.9); null when none is pinned. */
  snapshot_hash: string | null;
  step_id: string | null;
  step_status: AiConversationStepStatus | null;
}

export interface AiConversationView {
  mode: AiConversationMode;
  procedure: AiConversationProcedureView | null;
  slots: AiConversationSlotView[];
  /** The topic set aside for the one in progress (AI-03 §7). */
  suspended: (AiConversationProcedureView & { slots: AiConversationSlotView[] }) | null;
  /** AI turns taken on the connection. */
  turns: number;
  outcome: AiConversationOutcome | null;
}

/** The view of a turn state. Pure: a stored row and a preview's next state read the same. */
export function conversationView(state: TurnState): AiConversationView {
  const snapshot = readSnapshot(state.procedureSnapshot);
  const suspended = readSuspended(state.suspended);
  return {
    mode: state.mode,
    procedure:
      state.activeSkillId !== null
        ? {
            skill_id: state.activeSkillId,
            skill_name: snapshot?.skill_name ?? null,
            snapshot_hash: state.procedureSnapshotHash,
            step_id: state.stepId,
            step_status: state.stepStatus,
          }
        : null,
    slots: slotViews(state.slots, snapshot),
    suspended: suspended
      ? {
          skill_id: suspended.skill_id,
          skill_name: suspended.snapshot.skill_name,
          snapshot_hash: suspended.snapshot_hash,
          step_id: suspended.step_id,
          step_status: suspended.step_status,
          slots: slotViews(suspended.slots, suspended.snapshot),
        }
      : null,
    turns: turnsTaken(state),
    outcome: state.outcome,
  };
}

/**
 * The procedure's slots in its order — those nothing was said about as
 * `missing` — then any other slot the state holds, by name.
 */
function slotViews(
  slots: AiStateObject,
  snapshot: ProcedureSnapshot | null,
): AiConversationSlotView[] {
  const defined = snapshot?.procedure.slots ?? [];
  const views: AiConversationSlotView[] = defined.map((def) => {
    const record = slotRecord(slots[def.name]);
    return {
      name: def.name,
      label: def.label,
      type: def.type,
      status: record.status,
      display: record.display,
      source: record.source,
      attempts: record.attempts,
      sensitive: def.pii === 'high' || record.pii === 'high',
    };
  });
  const names = new Set(defined.map((def) => def.name));
  for (const name of Object.keys(slots).sort()) {
    if (names.has(name) || slots[name] === null || slots[name] === undefined) continue;
    const record = slotRecord(slots[name]);
    views.push({
      name,
      label: name,
      type: null,
      status: record.status,
      display: record.display,
      source: record.source,
      attempts: record.attempts,
      sensitive: record.pii === 'high',
    });
  }
  return views;
}
